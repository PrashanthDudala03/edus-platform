using System.Text.RegularExpressions;
using EduOS.ServiceAuth;
using Xunit;

/// <summary>
/// Structural checks of the AI persistence boundary, read from the migration files, the service source and the
/// compose file. They need no database, so they prove what the schema says, not how PostgreSQL enforces it.
/// </summary>
public class AiPersistenceTests
{
    static readonly string Root = FindRoot();
    static readonly IReadOnlyList<(string Id, string Sql)> Migrations = AiMigrations.Load(Path.Combine(AppContext.BaseDirectory, "Migrations"));
    static readonly string Sql = Regex.Replace(Regex.Replace(string.Join("\n", Migrations.Select(m => m.Sql)), "--[^\n]*", ""), @"\s+", " ");
    static readonly string Compose = File.ReadAllText(Path.Combine(Root, "docker-compose.yml")).Replace("\r\n", "\n");
    static readonly string[] Tables = Regex.Matches(Sql, @"CREATE TABLE IF NOT EXISTS (\S+) \(").Select(m => m.Groups[1].Value).ToArray();
    const string Scope = "USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school())";

    static string FindRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "docker-compose.yml"))) return directory.FullName;
        throw new InvalidOperationException("Repository root not found.");
    }
    static string Service(string name) => Regex.Match(Compose, @"(?ms)^  " + Regex.Escape(name) + @":\n(.*?)(?=^  [a-z][a-z0-9-]*:\n|^[a-z]+:\n)").Groups[1].Value;
    static string Body(string table) => Regex.Match(Sql, @"CREATE TABLE IF NOT EXISTS " + Regex.Escape(table) + @" \((.*?)\);").Groups[1].Value;

    [Fact]
    public void TheCoreMigrationShipsWithTheService()
    {
        Assert.Contains(Migrations, m => m.Id == "20261003_01_ai_core");
        Assert.Equal(Migrations.Select(m => m.Id).OrderBy(id => id, StringComparer.Ordinal), Migrations.Select(m => m.Id));
        Assert.Equal(new[] { "ai.school_settings", "ai.usage_events", "ai.audit", "ai.usage_reservations" }, Tables);
    }

    [Fact]
    public void EveryObjectLivesInTheAiSchema()
    {
        Assert.All(Tables, table => Assert.StartsWith("ai.", table));
        Assert.All(Regex.Matches(Sql, @"CREATE INDEX IF NOT EXISTS \S+ ON (\S+)").Select(m => m.Groups[1].Value), target => Assert.StartsWith("ai.", target));
        Assert.All(Regex.Matches(Sql, @"CREATE POLICY \S+ ON (\S+)").Select(m => m.Groups[1].Value), target => Assert.StartsWith("ai.", target));
        Assert.All(Regex.Matches(Sql, @"CREATE OR REPLACE FUNCTION (\S+)\(").Select(m => m.Groups[1].Value), name => Assert.StartsWith("ai.", name));
    }

    // Applies to every table any AI migration creates, so a later table cannot be added without the same protection.
    [Fact]
    public void EveryTableIsOwnedByASchoolAndProtectedByForcedRowLevelSecurity()
    {
        Assert.NotEmpty(Tables);
        foreach (var table in Tables)
        {
            Assert.Matches(@"school_id uuid (NOT NULL|PRIMARY KEY)", Body(table));
            Assert.Contains($"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;", Sql);
            Assert.Contains($"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;", Sql);
            Assert.Contains($"CREATE POLICY tenant_isolation ON {table} {Scope};", Sql);
        }
        Assert.Equal(Tables.Length, Regex.Matches(Sql, "CREATE POLICY").Count);
    }

    [Fact]
    public void MissingSchoolContextMatchesNothing()
    {
        // Unset or empty becomes NULL, and "school_id = NULL" is never true: no rows are visible and no insert passes the check.
        Assert.Contains("$$ SELECT NULLIF(current_setting('ai.school_id', true), '')::uuid $$", Sql);
        Assert.DoesNotContain("COALESCE", Sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotMatch(@"(?i)USING \((true|1 ?= ?1)\)|IS NULL\b[^;]*\bPOLICY|POLICY[^;]*\bOR\b", Sql);
        Assert.DoesNotMatch(@"(?i)DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY|SECURITY DEFINER", Sql);
    }

    [Fact]
    public void RuntimeAccountCannotBypassRowLevelSecurity()
    {
        Assert.Contains("ALTER ROLE ai_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;", Sql);
        Assert.DoesNotMatch(@"(?i)(?<!NO)BYPASSRLS|(?<!NO)SUPERUSER|OWNER TO|GRANT ALL|TO PUBLIC|WITH GRANT OPTION|PASSWORD", Sql);
        Assert.Contains("REVOKE ALL ON SCHEMA ai FROM PUBLIC;", Sql);
    }

    [Fact]
    public void RuntimeGrantsAreLeastPrivilege()
    {
        var grants = Regex.Matches(Sql, @"GRANT (.+?) ON (.+?) TO (\S+?);").Select(m => (Privileges: m.Groups[1].Value, Target: m.Groups[2].Value, Role: m.Groups[3].Value)).ToList();
        Assert.NotEmpty(grants);
        Assert.All(grants, g => Assert.Equal("ai_app", g.Role));
        Assert.All(grants.SelectMany(g => g.Privileges.Split(',', StringSplitOptions.TrimEntries)), privilege => Assert.Contains(privilege, new[] { "USAGE", "EXECUTE", "SELECT", "INSERT", "DELETE" }));
        // A school can read its settings but never raise its own budget; usage and audit are append-only.
        Assert.Equal("SELECT", grants.Single(g => g.Target == "ai.school_settings").Privileges);
        Assert.Equal("SELECT, INSERT", grants.Single(g => g.Target == "ai.usage_events").Privileges);
        Assert.Equal("SELECT, INSERT", grants.Single(g => g.Target == "ai.audit").Privileges);
        // Reservations are the only rows the service may remove, and nothing may be updated in place.
        Assert.Equal(new[] { "ai.usage_reservations" }, grants.Where(g => g.Privileges.Contains("DELETE")).Select(g => g.Target));
        Assert.DoesNotMatch(@"(?i)GRANT[^;]*\b(UPDATE|TRUNCATE|REFERENCES|TRIGGER)\b", Sql);
    }

    [Fact]
    public void MigrationsAreAdditiveAndNeverReferenceTheCoreDatabase()
    {
        Assert.DoesNotMatch(@"(?i)\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b|\bRENAME\b", Sql);
        foreach (var schema in new[] { "auth_db.", "school_db.", "student_db.", "teacher_db.", "parent_db.", "suite.", "billing." })
            Assert.DoesNotContain(schema, Sql);
    }

    [Fact]
    public void NoColumnCanHoldAQuestionAnAnswerOrDocumentText()
    {
        Assert.DoesNotMatch(@"(?i)\b(prompt|question|answer|response|content|message|body)\w* (text|varchar|jsonb|bytea)", Sql);
        // Usage goes through the tenant-scoped entry point only; the store opens no connection of its own.
        var store = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "Gateway", "AiUsage.cs"));
        Assert.DoesNotMatch(@"new NpgsqlConnection|NpgsqlDataSource|GetConnectionString", store);
        Assert.Equal(3, Regex.Matches(store, @"database\.InSchool\(tenant,").Count);
    }

    [Fact]
    public void VectorSupportIsReadyButNoDimensionIsFixedYet()
    {
        Assert.Contains("CREATE EXTENSION IF NOT EXISTS vector;", Sql);
        Assert.DoesNotMatch(@"(?i)\bvector\s*\(|\bembedding\b|\bhnsw\b|\bivfflat\b", Sql);
    }

    [Fact]
    public void RequestCodeSetsTheSchoolPerTransactionFromTheToken()
    {
        var source = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "AiDatabase.cs"));
        Assert.Contains("set_config('ai.school_id', @school, true)", source);
        Assert.Contains("tenant.SchoolId.ToString()", source);
        Assert.DoesNotMatch(@"(?i)SET (SESSION |LOCAL )?ai\.school_id|set_config\('ai\.school_id',[^)]*false\)", source);
    }

    [Fact]
    public void OnlyTheBootstrapUsesTheOwnerConnectionAndNothingReachesTheCoreDatabase()
    {
        var files = Directory.GetFiles(Path.Combine(Root, "services", "ai-service"), "*.cs").ToDictionary(file => Path.GetFileName(file), File.ReadAllText);
        Assert.Equal(new[] { "AiService.cs" }, files.Where(f => f.Value.Contains("AiDbMigrations")).Select(f => f.Key));
        Assert.Single(Regex.Matches(files["AiService.cs"], "AiDbMigrations"));
        Assert.All(files.Values, text => Assert.DoesNotMatch(@"DefaultConnection|Host=postgres|auth_db\.|school_db\.|student_db\.|suite\.|billing\.", text));
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-00000000e005", true)] [InlineData("00000000-0000-0000-0000-00000000e005", false)] [InlineData("00000000-0000-0000-0000-000000000000", false)]
    public async Task ThereIsNoDatabaseAccessWithoutASchool(string school, bool platformAuthority)
    {
        await using var database = new AiDatabase("Host=unused.invalid;Username=ai_app;Password=unused");
        var tenant = new TenantContext(Guid.Parse(school), Guid.NewGuid(), "SuperAdmin") { PlatformAuthority = platformAuthority };
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => database.InSchool(tenant, (_, _, _) => Task.FromResult(1)));
        Assert.Equal("AI data is always read and written for one school.", error.Message);
    }

    [Fact]
    public async Task AnUnconfiguredDatabaseIsRefusedBeforeAnyConnection()
    {
        await using var database = new AiDatabase(null);
        var tenant = new TenantContext(Guid.NewGuid(), Guid.NewGuid(), "Teacher");
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.InSchool(tenant, (_, _, _) => Task.FromResult(1)));
    }

    [Fact]
    public void AiDatabaseIsSeparateOptionalAndHasItsOwnVolume()
    {
        var aiDb = Service("ai-db"); var aiService = Service("ai-service"); var core = Service("postgres");
        Assert.Contains("profiles: [\"ai\"]", aiDb);
        Assert.Contains("image: pgvector/pgvector:pg16", aiDb);
        Assert.Contains("- ai_db_data:/var/lib/postgresql/data", aiDb);
        Assert.DoesNotContain("postgres_data", aiDb);
        Assert.DoesNotContain("ports:", aiDb);
        Assert.Contains("POSTGRES_PASSWORD: ${AI_DB_PASSWORD:-}", aiDb);
        // The core database keeps its image and its volume.
        Assert.Contains("image: postgres:16-alpine", core);
        Assert.Contains("- postgres_data:/var/lib/postgresql/data", core);
        Assert.DoesNotContain("ai_db_data", core);
        // The service reaches only ai-db: requests as ai_app, schema preparation as the owner, both from the environment.
        Assert.Contains("ConnectionStrings__AiDb: \"Host=ai-db;Port=5432;Database=${AI_DB_NAME:-eduos_ai};Username=ai_app;Password=${AI_DB_APP_PASSWORD:-};\"", aiService);
        Assert.Contains("ConnectionStrings__AiDbMigrations: \"Host=ai-db;", aiService);
        Assert.DoesNotMatch(@"Host=postgres;|POSTGRES_PASSWORD|DefaultConnection", aiService);
        Assert.Matches(@"(?m)^  ai_db_data:$", Compose);
    }
}

public class AiMigrationRunnerTests
{
    sealed class Target(params string[] applied) : IMigrationTarget
    {
        public List<string> Ran { get; } = [];
        public string? FailOn { get; init; }
        public Task<IReadOnlyCollection<string>> Applied(CancellationToken cancellation) => Task.FromResult<IReadOnlyCollection<string>>(applied);
        public Task Apply(string id, string sql, CancellationToken cancellation)
        {
            if (id == FailOn) throw new InvalidOperationException("failed");
            Ran.Add(id + ":" + sql); return Task.CompletedTask;
        }
    }
    static readonly (string, string)[] Files = [("20270101_02_b", "B"), ("20261003_01_a", "A"), ("20270101_01_c", "C")];

    [Fact]
    public async Task PendingMigrationsRunOnceInNameOrder()
    {
        var target = new Target();
        Assert.Equal(new[] { "20261003_01_a", "20270101_01_c", "20270101_02_b" }, await AiMigrations.Run(target, Files));
        Assert.Equal(new[] { "20261003_01_a:A", "20270101_01_c:C", "20270101_02_b:B" }, target.Ran);
    }

    [Fact]
    public async Task AppliedMigrationsAreSkipped()
    {
        var target = new Target("20261003_01_a", "20270101_02_b");
        Assert.Equal(new[] { "20270101_01_c" }, await AiMigrations.Run(target, Files));
        Assert.Empty(await AiMigrations.Run(new Target("20261003_01_a", "20270101_01_c", "20270101_02_b"), Files));
    }

    [Fact]
    public async Task AFailureStopsTheRunBeforeLaterMigrations()
    {
        var target = new Target { FailOn = "20270101_01_c" };
        await Assert.ThrowsAsync<InvalidOperationException>(() => AiMigrations.Run(target, Files));
        Assert.Equal(new[] { "20261003_01_a:A" }, target.Ran);
    }

    [Fact]
    public void LoadReadsSqlFilesInOrderAndIgnoresRollbackScripts()
    {
        var directory = Directory.CreateTempSubdirectory("eduos-ai-migrations").FullName;
        try
        {
            File.WriteAllText(Path.Combine(directory, "2_b.sql"), "B"); File.WriteAllText(Path.Combine(directory, "1_a.sql"), "A");
            File.WriteAllText(Path.Combine(directory, "1_a.rollback.sql"), "undo"); File.WriteAllText(Path.Combine(directory, "notes.txt"), "x");
            Assert.Equal(new[] { ("1_a", "A"), ("2_b", "B") }, AiMigrations.Load(directory));
            Assert.Empty(AiMigrations.Load(Path.Combine(directory, "missing")));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task ADatabaseThatCannotBePreparedLeavesTheServiceRunning()
    {
        var stub = new StubBootstrap(false);
        await using var host = await AiHost.Start(true, stub);
        Assert.Equal(1, stub.Runs);
        Assert.False(host.Database.Ready);
        Assert.Equal(System.Net.HttpStatusCode.OK, (await host.Get("/api/ai/health", null)).StatusCode);
    }
}

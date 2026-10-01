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
    // Tables that hold no school data and are read-only to the service. Everything else must be school-owned.
    static readonly string[] Shared = ["ai.embedding_spaces"];
    static readonly string[] SchoolTables = Tables.Except(Shared).ToArray();
    // The one change the service may make to a stored row: the embedding outcome of a document.
    const string StateGrant = "GRANT UPDATE (status, failure, embedding_space_id, embedded_tokens, embedded_at, updated_at) ON ai.knowledge_documents TO ai_app;";
    static readonly string Plain = Sql.Replace(StateGrant, "");

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
        Assert.Equal(new[] { "ai.school_settings", "ai.usage_events", "ai.audit", "ai.usage_reservations", "ai.knowledge_documents", "ai.knowledge_chunks", "ai.embedding_spaces", "ai.knowledge_embeddings" }, Tables);
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
        Assert.NotEmpty(SchoolTables);
        foreach (var table in SchoolTables)
        {
            Assert.Matches(@"school_id uuid (NOT NULL|PRIMARY KEY)", Body(table));
            Assert.Contains($"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;", Sql);
            Assert.Contains($"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;", Sql);
            Assert.Contains($"CREATE POLICY tenant_isolation ON {table} {Scope};", Sql);
        }
        Assert.Equal(SchoolTables.Length, Regex.Matches(Sql, "CREATE POLICY").Count);
    }

    [Fact]
    public void SharedTablesHoldNoSchoolDataAndAreReadOnlyToTheService()
    {
        foreach (var table in Shared)
        {
            Assert.DoesNotMatch(@"(?i)school|user|text text|title|audience", Body(table));
            Assert.Contains($"GRANT SELECT ON {table} TO ai_app;", Sql);
            Assert.Single(Regex.Matches(Sql, @"GRANT [^;]* ON " + Regex.Escape(table) + " TO"));
        }
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
        Assert.Single(Regex.Matches(Sql, Regex.Escape(StateGrant)));
        var grants = Regex.Matches(Plain, @"GRANT (.+?) ON (.+?) TO (\S+?);").Select(m => (Privileges: m.Groups[1].Value, Target: m.Groups[2].Value, Role: m.Groups[3].Value)).ToList();
        Assert.NotEmpty(grants);
        Assert.All(grants, g => Assert.Equal("ai_app", g.Role));
        Assert.All(grants.SelectMany(g => g.Privileges.Split(',', StringSplitOptions.TrimEntries)), privilege => Assert.Contains(privilege, new[] { "USAGE", "EXECUTE", "SELECT", "INSERT", "DELETE" }));
        // A school can read its settings but never raise its own budget; usage and audit are append-only.
        Assert.Equal("SELECT", grants.Single(g => g.Target == "ai.school_settings").Privileges);
        Assert.Equal("SELECT, INSERT", grants.Single(g => g.Target == "ai.usage_events").Privileges);
        Assert.Equal("SELECT, INSERT", grants.Single(g => g.Target == "ai.audit").Privileges);
        // Reservations are the only rows the service may remove, and nothing may be updated in place.
        Assert.Equal(new[] { "ai.usage_reservations", "ai.knowledge_documents", "ai.knowledge_embeddings" }, grants.Where(g => g.Privileges.Contains("DELETE")).Select(g => g.Target));
        // Chunks are written with their document and leave with it; they are never changed or removed on their own.
        Assert.Equal("SELECT, INSERT", grants.Single(g => g.Target == "ai.knowledge_chunks").Privileges);
        Assert.DoesNotMatch(@"(?i)GRANT[^;]*\b(UPDATE|TRUNCATE|REFERENCES|TRIGGER)\b", Plain);
    }

    [Fact]
    public void MigrationsAreAdditiveAndNeverReferenceTheCoreDatabase()
    {
        Assert.DoesNotMatch(@"(?i)\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b|\bRENAME\b", Sql);
        foreach (var schema in new[] { "auth_db.", "school_db.", "student_db.", "teacher_db.", "parent_db.", "suite.", "billing." })
            Assert.DoesNotContain(schema, Sql);
    }

    [Fact]
    public void NoColumnCanHoldAQuestionOrAnAnswerAndDocumentTextLivesOnlyInChunks()
    {
        Assert.DoesNotMatch(@"(?i)\b(prompt|question|answer|response|content|message|body)\w* (text|varchar|jsonb|bytea)", Sql);
        // The only free-text column for document content is knowledge_chunks.text; nothing stores a raw file.
        Assert.Single(Regex.Matches(Sql, @" text text NOT NULL"));
        Assert.DoesNotMatch(@"(?i)\bbytea\b|\bvector\s*\(|file_path|storage_path", Sql);
        Assert.Contains("FOREIGN KEY (school_id, document_id) REFERENCES ai.knowledge_documents (school_id, id) ON DELETE CASCADE", Sql);
        var knowledge = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "Knowledge", "KnowledgeStore.cs"));
        Assert.DoesNotMatch(@"new NpgsqlConnection|NpgsqlDataSource|GetConnectionString", knowledge);
        Assert.Equal(7, Regex.Matches(knowledge, @"database\.InSchool(<[^(]+>)?\(tenant,").Count);
        // The pipeline never touches the file system or the network.
        foreach (var file in Directory.GetFiles(Path.Combine(Root, "services", "ai-service", "Knowledge"), "*.cs"))
            Assert.DoesNotMatch(@"File\.(Write|Open|Create|Move|Copy)|FileStream|HttpClient|Process\.Start", File.ReadAllText(file));
        // Usage goes through the tenant-scoped entry point only; the store opens no connection of its own.
        var store = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "Gateway", "AiUsage.cs"));
        Assert.DoesNotMatch(@"new NpgsqlConnection|NpgsqlDataSource|GetConnectionString", store);
        Assert.Equal(3, Regex.Matches(store, @"database\.InSchool\(tenant,").Count);
    }

    [Fact]
    public void TheAssistantReachesKnowledgeOnlyThroughRetrievalAndTheContextCarriesNoIdentity()
    {
        var gateway = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "Gateway", "AiGateway.cs"));
        Assert.DoesNotMatch(@"IKnowledgeStore|IEmbeddingProvider|Npgsql|AiDatabase\b|\.Search\(", gateway);
        // One retrieval per question, for the school and the audience of the token, with nothing a caller chose.
        Assert.Single(Regex.Matches(gateway, @"retriever\.Retrieve\("));
        Assert.Contains("retriever.Retrieve(tenant, audience, question, null, cancellation)", gateway);
        Assert.Equal(new[] { "MaxOutputTokens", "Question" }, typeof(EduOS.Ai.Gateway.AssistantAsk).GetProperties().Select(p => p.Name).Order());
        // The builder has no school, user, chunk identifier, score, log or database to put in a prompt.
        var builder = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "Gateway", "AiRagContext.cs"));
        Assert.DoesNotMatch(@"TenantContext|SchoolId|UserId|ChunkId|Similarity|ILogger|Npgsql|DateTime|Random|Guid\.NewGuid", builder);
        Assert.Equal(new[] { "DocumentId", "Number", "Page", "Section", "Source", "Title" }, typeof(EduOS.Ai.Gateway.AssistantSource).GetProperties().Select(p => p.Name).Order());
        // The endpoint takes the audience from the token and nowhere else.
        var service = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "AiService.cs"));
        Assert.Contains("gateway.Ask(tenant, http.User.FindFirst(\"data_scope\")?.Value ?? \"\", ask, cancellation)", service);
    }

    [Fact]
    public void TheSearchIsExactAndBoundedBySchoolSpaceReadinessAndAudience()
    {
        var store = Regex.Replace(File.ReadAllText(Path.Combine(Root, "services", "ai-service", "Knowledge", "KnowledgeStore.cs")), @"\s+", " ");
        var search = Regex.Match(store, @"SELECT k\.id, k\.document_id.*?LIMIT @limit").Value;
        Assert.NotEmpty(search);
        foreach (var condition in new[]
        {
            "e.school_id = @school", "e.space_id = @space", "e.dimension = @dimension", "d.status = 'ready'", "d.embedding_space_id = @space", "@audience = ANY(d.audience)",
            "k.school_id = e.school_id", "d.school_id = k.school_id", "ORDER BY e.embedding <=> @query::vector, k.document_id, k.ordinal",
        }) Assert.Contains(condition, search);
        // Cosine distance only, every value a parameter, and the vector itself is never selected.
        Assert.DoesNotMatch(@"<->|<#>|\{|e\.embedding,|SELECT \*", search);
        // No approximate index exists yet, so the result does not depend on one.
        Assert.DoesNotMatch(@"(?i)\bhnsw\b|\bivfflat\b", Sql);
        // Retrieval calls the embedding provider and the store. It has no model and no connection of its own.
        var retrieval = File.ReadAllText(Path.Combine(Root, "services", "ai-service", "Knowledge", "KnowledgeRetrieval.cs"));
        Assert.DoesNotMatch(@"IModelProvider|Npgsql|AiDatabase\b|SchoolId", retrieval);
    }

    [Fact]
    public void VectorsAreStoredOnceWithADimensionTiedToTheirSpace()
    {
        Assert.Contains("CREATE EXTENSION IF NOT EXISTS vector;", Sql);
        // One vector column in the whole schema. It has no fixed size in the type: its size is the dimension of its space.
        Assert.Single(Regex.Matches(Sql, @"\bvector NOT NULL"));
        Assert.Contains("embedding vector NOT NULL CHECK (vector_dims(embedding) = dimension)", Body("ai.knowledge_embeddings"));
        Assert.Contains("FOREIGN KEY (space_id, dimension) REFERENCES ai.embedding_spaces (id, dimension)", Sql);
        Assert.Contains("FOREIGN KEY (school_id, chunk_id) REFERENCES ai.knowledge_chunks (school_id, id) ON DELETE CASCADE", Sql);
        Assert.Contains("PRIMARY KEY (chunk_id, space_id)", Body("ai.knowledge_embeddings"));
        Assert.Contains("CREATE UNIQUE INDEX IF NOT EXISTS embedding_spaces_one_active ON ai.embedding_spaces (active) WHERE active;", Sql);
        Assert.Contains("CHECK (status <> 'ready' OR embedding_space_id IS NOT NULL)", Sql);
        // No dimension is written in a migration or in application code, and there is no approximate index yet.
        Assert.DoesNotMatch(@"(?i)\bvector\s*\(\s*\d|\bhnsw\b|\bivfflat\b", Sql);
        foreach (var file in Directory.GetFiles(Path.Combine(Root, "services", "ai-service"), "*.cs", SearchOption.AllDirectories).Where(f => !f.Contains("FakeProviders") && !Regex.IsMatch(f, @"[\\/](bin|obj)[\\/]")))
            Assert.DoesNotMatch(@"(?i)vector\s*\(\s*\d|dimension\s*(=|==)\s*\d", File.ReadAllText(file));
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

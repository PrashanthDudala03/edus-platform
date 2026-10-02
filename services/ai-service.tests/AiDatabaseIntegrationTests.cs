using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Npgsql;
using Xunit;

/// <summary>
/// Runs only against a real AI database: set AI_TEST_DB_OWNER and AI_TEST_DB_RUNTIME to connection strings for
/// the owner and for ai_app. Without them these tests are skipped, never passed. Every test uses fresh synthetic
/// school ids, so the suite can be repeated on the same database.
/// </summary>
public sealed class DatabaseFactAttribute : FactAttribute
{
    public DatabaseFactAttribute() { if (!AiDatabaseFixture.Available) Skip = "Set AI_TEST_DB_OWNER and AI_TEST_DB_RUNTIME to run against a real AI database."; }
}

public sealed class AiDatabaseFixture : IAsyncLifetime
{
    public static string Owner => Environment.GetEnvironmentVariable("AI_TEST_DB_OWNER") ?? "";
    public static string Runtime => Environment.GetEnvironmentVariable("AI_TEST_DB_RUNTIME") ?? "";
    public static bool Available => Owner.Length > 0 && Runtime.Length > 0;
    public static string Migrations => Path.Combine(AppContext.BaseDirectory, "Migrations");
    public AiDatabase Database { get; private set; } = null!;
    /// <summary>The active embedding space of the test database: that of the fake provider.</summary>
    public EmbeddingSpace Space { get; private set; } = null!;
    public static NpgsqlAiDatabaseBootstrap Bootstrap(EmbeddingDescriptor? descriptor = null, bool adopt = false) => new(Owner, Runtime, Migrations, descriptor ?? new FakeEmbeddingProvider().Descriptor, adopt);

    public async Task InitializeAsync()
    {
        if (!Available) return;
        // The service's own start-up path, twice: the second run must find nothing to do.
        var bootstrap = Bootstrap();
        var first = await bootstrap.Run(default); var second = await bootstrap.Run(default);
        Space = second.Active ?? throw new InvalidOperationException("The test database has another active embedding space: " + second.Problem);
        if (first.Active?.Id != Space.Id) throw new InvalidOperationException("The embedding space changed between two starts.");
        Database = new AiDatabase(Runtime);
    }
    public async Task DisposeAsync() { if (Database is not null) await Database.DisposeAsync(); }

    public static async Task<T> AsOwner<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(Owner); await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return (T)(await command.ExecuteScalarAsync())!;
    }
    /// <summary>Rows written by the owner, who is outside row-level security, standing in for earlier activity of a school.</summary>
    public static Task<long> SeedUsage(Guid school, int rows) => AsOwner<long>(
        "WITH added AS (INSERT INTO ai.usage_events (school_id, user_id, feature, provider, model, tier, success) SELECT @school, gen_random_uuid(), 'test', 'fake', 'fake-chat-1', 1, true FROM generate_series(1, @rows) RETURNING 1) SELECT count(*) FROM added",
        ("school", school), ("rows", rows));
    public static TenantContext Tenant(Guid school) => new(school, Guid.NewGuid(), "Teacher");
    public static async Task<T> Scalar<T>(NpgsqlConnection connection, string sql, NpgsqlTransaction? transaction = null)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        return (T)(await command.ExecuteScalarAsync())!;
    }
    public static async Task Denied(Func<Task> action, string state = "42501") => Assert.Equal(state, (await Assert.ThrowsAsync<PostgresException>(action)).SqlState);
}

public class AiDatabaseSecurityTests(AiDatabaseFixture fixture) : IClassFixture<AiDatabaseFixture>
{
    const string InsertUsage = "INSERT INTO ai.usage_events (school_id, user_id, feature, provider, model, tier, success) VALUES (@school, gen_random_uuid(), 'test', 'fake', 'fake-chat-1', 1, true)";
    static readonly string[] SchoolTables = ["school_settings", "usage_events", "audit", "usage_reservations", "knowledge_documents", "knowledge_chunks", "knowledge_embeddings"];

    Task<long> CountAs(Guid school, string table = "usage_events") =>
        fixture.Database.InSchool(AiDatabaseFixture.Tenant(school), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, $"SELECT count(*) FROM ai.{table}", t));
    Task<int> InsertAs(Guid context, Guid rowSchool) => fixture.Database.InSchool(AiDatabaseFixture.Tenant(context), async (c, t, _) =>
    {
        await using var command = new NpgsqlCommand(InsertUsage, c, t); command.Parameters.AddWithValue("school", rowSchool);
        return await command.ExecuteNonQueryAsync();
    });
    Task<int> RunAs(Guid school, string sql) => fixture.Database.InSchool(AiDatabaseFixture.Tenant(school), async (c, t, _) =>
    {
        await using var command = new NpgsqlCommand(sql, c, t); return await command.ExecuteNonQueryAsync();
    });

    [DatabaseFact]
    public async Task PgvectorIsInstalledAndUsable()
    {
        Assert.False(string.IsNullOrEmpty(await AiDatabaseFixture.AsOwner<string>("SELECT extversion FROM pg_extension WHERE extname = 'vector'")));
        Assert.Equal(3, await AiDatabaseFixture.AsOwner<int>("SELECT vector_dims('[1,2,3]'::vector)"));
    }

    [DatabaseFact]
    public async Task MigrationsAreAppliedOnceAndRecorded()
    {
        var files = AiMigrations.Load(AiDatabaseFixture.Migrations).Select(m => m.Id).ToList();
        Assert.NotEmpty(files);
        Assert.Equal(files.Count, (int)await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.schema_migrations"));
        Assert.Equal(files.Count, (int)await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.schema_migrations WHERE id = ANY(@ids)", ("ids", files.ToArray())));
        Assert.Equal(0, (int)await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth_db','school_db','student_db','teacher_db','parent_db','suite','billing')"));
    }

    [DatabaseFact]
    public async Task TheRuntimeAccountAuthenticatesOnlyWithItsPassword()
    {
        await using var connection = new NpgsqlConnection(AiDatabaseFixture.Runtime); await connection.OpenAsync();
        Assert.Equal("ai_app", await AiDatabaseFixture.Scalar<string>(connection, "SELECT current_user::text"));
        var wrong = new NpgsqlConnectionStringBuilder(AiDatabaseFixture.Runtime) { Password = "not-the-password", Pooling = false }.ConnectionString;
        await AiDatabaseFixture.Denied(async () => { await using var bad = new NpgsqlConnection(wrong); await bad.OpenAsync(); }, "28P01");
    }

    [DatabaseFact]
    public async Task TheRuntimeAccountHasNoElevatedAttributesAndOwnsNothing()
    {
        Assert.Equal("f,f,f,f,f", await AiDatabaseFixture.AsOwner<string>("SELECT concat_ws(',', rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication) FROM pg_roles WHERE rolname = 'ai_app'"));
        Assert.Equal(0, (int)await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'ai_app'"));
        Assert.Equal(0, (int)await AiDatabaseFixture.AsOwner<long>("SELECT (SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = 'ai_app') + (SELECT count(*) FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = 'ai_app') + (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'ai_app')"));
    }

    [DatabaseFact]
    public async Task RowLevelSecurityIsEnabledForcedAndHasAPolicyOnEverySchoolTable()
    {
        var unprotected = await AiDatabaseFixture.AsOwner<long>("""
            SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'ai' AND c.relkind = 'r' AND c.relname NOT IN ('schema_migrations', 'embedding_spaces')
            AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'ai' AND p.tablename = c.relname))
            """);
        Assert.Equal(0, unprotected);
        Assert.True(await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ai' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity") >= SchoolTables.Length);
    }

    [DatabaseFact]
    public async Task WithoutASchoolNothingIsVisibleAndNothingCanBeWritten()
    {
        var school = Guid.NewGuid(); await AiDatabaseFixture.SeedUsage(school, 3);
        await using var connection = new NpgsqlConnection(AiDatabaseFixture.Runtime); await connection.OpenAsync();
        foreach (var table in SchoolTables) Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, $"SELECT count(*) FROM ai.{table}"));
        Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, $"SELECT count(*) FROM ai.usage_events WHERE school_id = '{school}'"));
        await AiDatabaseFixture.Denied(async () =>
        {
            await using var insert = new NpgsqlCommand(InsertUsage, connection); insert.Parameters.AddWithValue("school", school); await insert.ExecuteNonQueryAsync();
        });
        // An empty setting behaves like a missing one, and a malformed one is an error rather than a match.
        await using var transaction = await connection.BeginTransactionAsync();
        await AiDatabaseFixture.Scalar<string>(connection, "SELECT set_config('ai.school_id', '', true)", transaction);
        Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.usage_events", transaction));
        await AiDatabaseFixture.Scalar<string>(connection, "SELECT set_config('ai.school_id', 'not-a-uuid', true)", transaction);
        await AiDatabaseFixture.Denied(() => AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.usage_events", transaction), "22P02");
    }

    [DatabaseFact]
    public async Task EachSchoolReadsAndWritesOnlyItsOwnRows()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        await AiDatabaseFixture.SeedUsage(a, 2); await AiDatabaseFixture.SeedUsage(b, 5);
        Assert.Equal(2, await CountAs(a)); Assert.Equal(5, await CountAs(b));
        Assert.Equal(1, await InsertAs(a, a)); Assert.Equal(1, await InsertAs(b, b));
        Assert.Equal(3, await CountAs(a)); Assert.Equal(6, await CountAs(b));
        // Naming the other school in a filter finds nothing, and writing a row for it is refused, in both directions.
        Assert.Equal(0, await fixture.Database.InSchool(AiDatabaseFixture.Tenant(a), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, $"SELECT count(*) FROM ai.usage_events WHERE school_id = '{b}'", t)));
        Assert.Equal(0, await fixture.Database.InSchool(AiDatabaseFixture.Tenant(b), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, $"SELECT count(*) FROM ai.usage_events WHERE school_id = '{a}'", t)));
        await AiDatabaseFixture.Denied(() => InsertAs(a, b)); await AiDatabaseFixture.Denied(() => InsertAs(b, a));
        Assert.Equal(3, await CountAs(a)); Assert.Equal(6, await CountAs(b));
        // The same holds for settings and audit rows written for another school.
        await AiDatabaseFixture.AsOwner<int>("WITH x AS (INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES (@a, true, 100), (@b, true, 200) RETURNING 1) SELECT count(*)::int FROM x", ("a", a), ("b", b));
        Assert.Equal(100, await fixture.Database.InSchool(AiDatabaseFixture.Tenant(a), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, "SELECT sum(monthly_token_budget)::bigint FROM ai.school_settings", t)));
        Assert.Equal(200, await fixture.Database.InSchool(AiDatabaseFixture.Tenant(b), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, "SELECT sum(monthly_token_budget)::bigint FROM ai.school_settings", t)));
        await AiDatabaseFixture.Denied(() => RunAs(a, $"INSERT INTO ai.audit (school_id, action) VALUES ('{b}', 'test')"));
        Assert.Equal(1, await RunAs(a, $"INSERT INTO ai.audit (school_id, action) VALUES ('{a}', 'test')"));
        Assert.Equal(0, await CountAs(b, "audit"));
    }

    [DatabaseFact]
    public async Task TheSchoolOfATransactionEndsWithIt()
    {
        var school = Guid.NewGuid(); await AiDatabaseFixture.SeedUsage(school, 4);
        await using var connection = new NpgsqlConnection(AiDatabaseFixture.Runtime); await connection.OpenAsync();
        await using (var transaction = await connection.BeginTransactionAsync())
        {
            await AiDatabaseFixture.Scalar<string>(connection, $"SELECT set_config('ai.school_id', '{school}', true)", transaction);
            Assert.Equal(4, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.usage_events", transaction));
            await transaction.CommitAsync();
        }
        // Same open connection, no pool involved: the setting is gone and so are the rows.
        Assert.Equal("", await AiDatabaseFixture.Scalar<string>(connection, "SELECT COALESCE(current_setting('ai.school_id', true), '')"));
        Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.usage_events"));
        await using (var rolledBack = await connection.BeginTransactionAsync())
        {
            await AiDatabaseFixture.Scalar<string>(connection, $"SELECT set_config('ai.school_id', '{school}', true)", rolledBack);
            await rolledBack.RollbackAsync();
        }
        Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.usage_events"));
    }

    [DatabaseFact]
    public async Task AReusedPooledConnectionCarriesNoSchoolToTheNextRequest()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        await AiDatabaseFixture.SeedUsage(a, 2); await AiDatabaseFixture.SeedUsage(b, 7);
        // One physical connection, and the pool's own reset switched off, so only the transaction scope can protect.
        var single = new NpgsqlConnectionStringBuilder(AiDatabaseFixture.Runtime) { MaxPoolSize = 1, NoResetOnClose = true, ApplicationName = "pool-" + Guid.NewGuid() }.ConnectionString;
        await using var database = new AiDatabase(single);
        var first = await database.InSchool(AiDatabaseFixture.Tenant(a), async (c, t, _) => (Pid: await AiDatabaseFixture.Scalar<int>(c, "SELECT pg_backend_pid()", t), Rows: await AiDatabaseFixture.Scalar<long>(c, "SELECT count(*) FROM ai.usage_events", t)));
        var second = await database.InSchool(AiDatabaseFixture.Tenant(b), async (c, t, _) => (Pid: await AiDatabaseFixture.Scalar<int>(c, "SELECT pg_backend_pid()", t), Rows: await AiDatabaseFixture.Scalar<long>(c, "SELECT count(*) FROM ai.usage_events", t)));
        Assert.Equal(first.Pid, second.Pid);
        Assert.Equal((2L, 7L), (first.Rows, second.Rows));
        // A failed unit of work leaves nothing behind either.
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.InSchool<int>(AiDatabaseFixture.Tenant(a), (_, _, _) => throw new InvalidOperationException("stop")));
        Assert.Equal(7, await database.InSchool(AiDatabaseFixture.Tenant(b), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, "SELECT count(*) FROM ai.usage_events", t)));

        // The same physical connection taken straight from a pool, with no school set, sees nothing.
        await using var pool = NpgsqlDataSource.Create(single);
        int pid;
        await using (var used = await pool.OpenConnectionAsync())
        {
            await using var transaction = await used.BeginTransactionAsync();
            await AiDatabaseFixture.Scalar<string>(used, $"SELECT set_config('ai.school_id', '{a}', true)", transaction);
            pid = await AiDatabaseFixture.Scalar<int>(used, "SELECT pg_backend_pid()", transaction);
            Assert.Equal(2, await AiDatabaseFixture.Scalar<long>(used, "SELECT count(*) FROM ai.usage_events", transaction));
            await transaction.CommitAsync();
        }
        await using var reused = await pool.OpenConnectionAsync();
        Assert.Equal(pid, await AiDatabaseFixture.Scalar<int>(reused, "SELECT pg_backend_pid()"));
        Assert.Equal("", await AiDatabaseFixture.Scalar<string>(reused, "SELECT COALESCE(current_setting('ai.school_id', true), '')"));
        Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(reused, "SELECT count(*) FROM ai.usage_events"));
    }

    [DatabaseFact]
    public async Task TheRuntimeAccountCannotExceedItsGrantsOrSwitchOffTheProtection()
    {
        var school = Guid.NewGuid(); await AiDatabaseFixture.SeedUsage(school, 1);
        await AiDatabaseFixture.AsOwner<int>("WITH x AS (INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES (@s, true, 100) RETURNING 1) SELECT count(*)::int FROM x", ("s", school));
        foreach (var sql in new[]
        {
            "UPDATE ai.usage_events SET input_tokens = 0", "DELETE FROM ai.usage_events", "TRUNCATE ai.usage_events", "DELETE FROM ai.audit", "UPDATE ai.audit SET action = 'x'",
            "UPDATE ai.school_settings SET monthly_token_budget = 999999999", "UPDATE ai.school_settings SET enabled = true", "DELETE FROM ai.school_settings",
            $"INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES ('{Guid.NewGuid()}', true, 1)",
            "SELECT * FROM ai.schema_migrations", "DELETE FROM ai.schema_migrations", "CREATE TABLE ai.mine (id int)", "CREATE TABLE public.mine (id int)",
            "ALTER TABLE ai.usage_events DISABLE ROW LEVEL SECURITY", "ALTER TABLE ai.usage_events NO FORCE ROW LEVEL SECURITY", "DROP POLICY tenant_isolation ON ai.usage_events",
            "CREATE POLICY open ON ai.usage_events USING (true)", "ALTER ROLE ai_app BYPASSRLS", "ALTER ROLE ai_app SUPERUSER", "DROP SCHEMA ai CASCADE",
            "SET LOCAL row_security = off; SELECT count(*) FROM ai.usage_events",
        })
        {
            var error = await Assert.ThrowsAsync<PostgresException>(() => RunAs(school, sql));
            Assert.True(error.SqlState == "42501", sql + " -> " + error.SqlState + " " + error.MessageText);
        }
        var owner = new NpgsqlConnectionStringBuilder(AiDatabaseFixture.Owner).Username;
        Assert.NotEqual("ai_app", owner);
        var switched = await Assert.ThrowsAsync<PostgresException>(() => RunAs(school, $"SET LOCAL ROLE \"{owner}\""));
        Assert.Equal("42501", switched.SqlState);
        // What it may do: read its own settings, and read and append its own usage and audit rows.
        Assert.Equal(100, await fixture.Database.InSchool(AiDatabaseFixture.Tenant(school), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, "SELECT monthly_token_budget FROM ai.school_settings", t)));
        Assert.Equal(1, await InsertAs(school, school));
        Assert.Equal(2, await CountAs(school));
    }
}

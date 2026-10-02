using Npgsql;

public interface IMigrationTarget
{
    Task<IReadOnlyCollection<string>> Applied(CancellationToken cancellation);
    /// <summary>Applies one migration and records it, atomically.</summary>
    Task Apply(string id, string sql, CancellationToken cancellation);
}

/// <summary>Idempotent SQL files applied once each, in name order, to the AI database only.</summary>
public static class AiMigrations
{
    public static IReadOnlyList<(string Id, string Sql)> Load(string directory) =>
        !Directory.Exists(directory) ? [] : Directory.GetFiles(directory, "*.sql")
            .Where(file => !file.EndsWith(".rollback.sql", StringComparison.OrdinalIgnoreCase))
            .Select(file => (Id: Path.GetFileNameWithoutExtension(file), Sql: File.ReadAllText(file)))
            .OrderBy(m => m.Id, StringComparer.Ordinal).ToList();

    /// <returns>The migrations applied by this call. A failure stops the run; later files are not attempted.</returns>
    public static async Task<IReadOnlyList<string>> Run(IMigrationTarget target, IEnumerable<(string Id, string Sql)> migrations, CancellationToken cancellation = default)
    {
        var applied = (await target.Applied(cancellation)).ToHashSet(StringComparer.Ordinal);
        var done = new List<string>();
        foreach (var migration in migrations.OrderBy(m => m.Id, StringComparer.Ordinal))
        {
            if (!applied.Add(migration.Id)) continue;
            await target.Apply(migration.Id, migration.Sql, cancellation);
            done.Add(migration.Id);
        }
        return done;
    }
}

public sealed class NpgsqlMigrationTarget(NpgsqlConnection connection) : IMigrationTarget
{
    public async Task<IReadOnlyCollection<string>> Applied(CancellationToken cancellation)
    {
        await using (var prepare = new NpgsqlCommand("CREATE SCHEMA IF NOT EXISTS ai; CREATE TABLE IF NOT EXISTS ai.schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())", connection))
            await prepare.ExecuteNonQueryAsync(cancellation);
        var ids = new List<string>();
        await using var command = new NpgsqlCommand("SELECT id FROM ai.schema_migrations", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        while (await reader.ReadAsync(cancellation)) ids.Add(reader.GetString(0));
        return ids;
    }

    public async Task Apply(string id, string sql, CancellationToken cancellation)
    {
        await using var transaction = await connection.BeginTransactionAsync(cancellation);
        await using (var run = new NpgsqlCommand(sql, connection, transaction)) await run.ExecuteNonQueryAsync(cancellation);
        await using (var record = new NpgsqlCommand("INSERT INTO ai.schema_migrations (id) VALUES (@id)", connection, transaction))
        {
            record.Parameters.AddWithValue("id", id);
            await record.ExecuteNonQueryAsync(cancellation);
        }
        await transaction.CommitAsync(cancellation);
    }
}

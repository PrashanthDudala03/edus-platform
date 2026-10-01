using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Npgsql;

/// <summary>Whether the AI database is configured and has been prepared. The service runs without it.</summary>
public sealed class AiDatabaseState(bool configured)
{
    volatile bool ready;
    public bool Configured => configured;
    public bool Ready { get => ready; set => ready = value; }
    /// <summary>The embedding space the vector storage holds, decided when the database was prepared. Null until then.</summary>
    public EmbeddingSpaceStatus? Embedding { get; set; }
    /// <summary>Completes after the first preparation attempt, successful or not.</summary>
    public TaskCompletionSource FirstAttempt { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
}

public interface IAiDatabaseBootstrap
{
    /// <summary>
    /// Applies pending migrations, sets the runtime account's password and settles the active embedding space.
    /// Uses the owner connection only here.
    /// </summary>
    Task<EmbeddingSpaceStatus> Run(CancellationToken cancellation);
}

/// <summary>
/// The only way request code reaches the AI database. It connects as the restricted ai_app account, and every
/// unit of work runs in a transaction whose school is taken from the verified token, which row-level security
/// then enforces. There is deliberately no method that works without a school.
/// </summary>
public sealed class AiDatabase(string? runtimeConnection) : IAsyncDisposable
{
    public const string RuntimeRole = "ai_app";
    readonly Lazy<NpgsqlDataSource> source = new(() => NpgsqlDataSource.Create(
        string.IsNullOrWhiteSpace(runtimeConnection) ? throw new InvalidOperationException("The AI database is not configured.") : runtimeConnection));

    public async Task<T> InSchool<T>(TenantContext tenant, Func<NpgsqlConnection, NpgsqlTransaction, CancellationToken, Task<T>> work, CancellationToken cancellation = default)
    {
        // A platform user has no school, so there is nothing a school-scoped transaction could mean for one.
        if (tenant.IsPlatform || tenant.SchoolId == EduOSTenants.Platform || tenant.SchoolId == Guid.Empty)
            throw new InvalidOperationException("AI data is always read and written for one school.");
        await using var connection = await source.Value.OpenConnectionAsync(cancellation);
        await using var transaction = await connection.BeginTransactionAsync(cancellation);
        // Transaction-local: the setting ends with the transaction and cannot leak through the connection pool.
        await using (var scope = new NpgsqlCommand("SELECT set_config('ai.school_id', @school, true)", connection, transaction))
        {
            scope.Parameters.AddWithValue("school", tenant.SchoolId.ToString());
            await scope.ExecuteNonQueryAsync(cancellation);
        }
        var result = await work(connection, transaction, cancellation);
        await transaction.CommitAsync(cancellation);
        return result;
    }

    public ValueTask DisposeAsync() => source.IsValueCreated ? source.Value.DisposeAsync() : ValueTask.CompletedTask;
}

public sealed class NpgsqlAiDatabaseBootstrap(string ownerConnection, string runtimeConnection, string migrationsDirectory, EmbeddingDescriptor embedding, bool adoptEmbeddingModel) : IAiDatabaseBootstrap
{
    public async Task<EmbeddingSpaceStatus> Run(CancellationToken cancellation)
    {
        var runtime = new NpgsqlConnectionStringBuilder(runtimeConnection);
        if (runtime.Username != AiDatabase.RuntimeRole || string.IsNullOrEmpty(runtime.Password))
            throw new InvalidOperationException("The AI database runtime connection must use the ai_app account with a password.");
        // Not pooled: the owner session ends here, and its advisory lock is released with it.
        await using var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(ownerConnection) { Pooling = false }.ConnectionString);
        await connection.OpenAsync(cancellation);
        await using (var serialize = new NpgsqlCommand("SELECT pg_advisory_lock(810200201)", connection)) await serialize.ExecuteNonQueryAsync(cancellation);
        await AiMigrations.Run(new NpgsqlMigrationTarget(connection), AiMigrations.Load(migrationsDirectory), cancellation);
        await using var transaction = await connection.BeginTransactionAsync(cancellation);
        // The password travels as a parameter and is quoted by the server; it never appears in SQL text.
        await using (var secret = new NpgsqlCommand("SELECT set_config('ai.app_password', @password, true)", connection, transaction))
        {
            secret.Parameters.AddWithValue("password", runtime.Password);
            await secret.ExecuteNonQueryAsync(cancellation);
        }
        await using (var apply = new NpgsqlCommand("DO $$ BEGIN EXECUTE format('ALTER ROLE ai_app PASSWORD %L', current_setting('ai.app_password')); END $$", connection, transaction))
            await apply.ExecuteNonQueryAsync(cancellation);
        // The dimension of the vector storage comes from the configured embedding provider and is settled here, once.
        var space = await EmbeddingSpaces.Ensure(connection, transaction, embedding, adoptEmbeddingModel, cancellation);
        await transaction.CommitAsync(cancellation);
        return space;
    }
}

/// <summary>Prepares the database in the background and keeps trying, so a missing database never stops the service.</summary>
public sealed class AiDatabaseInitializer(AiDatabaseState state, IServiceProvider services, ILogger<AiDatabaseInitializer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!state.Configured) { state.FirstAttempt.TrySetResult(); return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                state.Embedding = await services.GetRequiredService<IAiDatabaseBootstrap>().Run(stoppingToken);
                state.Ready = true;
                logger.LogInformation("AI database is ready");
                if (state.Embedding.Active is { } space) logger.LogInformation("Active embedding space: {Provider} {Model}, {Dimension} dimensions", space.Provider, space.Model, space.Dimension);
                else logger.LogError("The configured embedding model does not match the active embedding space ({Problem}); knowledge is stored but not embedded", state.Embedding.Problem);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // The exception type only: a provider message can carry a host or account name.
                logger.LogWarning("AI database is unavailable ({Error}); retrying", ex.GetType().Name);
            }
            state.FirstAttempt.TrySetResult();
            if (state.Ready) return;
            try { await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }
}

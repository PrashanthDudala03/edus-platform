using System.Diagnostics;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;
using Npgsql;

namespace EduOS.Ai.Knowledge;

/// <summary>One embedding model at one dimension. Vectors of different spaces are never compared.</summary>
public sealed record EmbeddingSpace(Guid Id, string Provider, string Model, int Dimension)
{
    public bool Is(EmbeddingDescriptor descriptor) => Provider == descriptor.Provider && Model == descriptor.Model && Dimension == descriptor.Dimension;
}

/// <summary>The active space when it is the one the configured provider produces; otherwise why embedding is off.</summary>
public sealed record EmbeddingSpaceStatus(EmbeddingSpace? Active, string? Problem);

public enum SpaceDecision { Use, Activate, Mismatch }

/// <summary>
/// The single place that decides which dimension the vector storage holds. It comes from the configured
/// embedding provider and is recorded in the database; no dimension is written in application code.
/// </summary>
public static class EmbeddingSpaces
{
    /// <summary>
    /// The first provider ever configured becomes the active space. A different provider or dimension later is a
    /// mismatch and embedding stays off, unless the deployment explicitly adopts the new model.
    /// </summary>
    public static SpaceDecision Decide(EmbeddingSpace? active, EmbeddingSpace configured, bool adopt) =>
        active is null ? SpaceDecision.Activate : active.Id == configured.Id ? SpaceDecision.Use : adopt ? SpaceDecision.Activate : SpaceDecision.Mismatch;

    /// <summary>Runs as the owner, in the caller's transaction.</summary>
    public static async Task<EmbeddingSpaceStatus> Ensure(NpgsqlConnection connection, NpgsqlTransaction transaction, EmbeddingDescriptor descriptor, bool adopt, CancellationToken cancellation)
    {
        await using (var register = new NpgsqlCommand("INSERT INTO ai.embedding_spaces (provider, model, dimension) VALUES (@provider, @model, @dimension) ON CONFLICT (provider, model, dimension) DO NOTHING", connection, transaction))
        {
            register.Parameters.AddWithValue("provider", descriptor.Provider); register.Parameters.AddWithValue("model", descriptor.Model); register.Parameters.AddWithValue("dimension", descriptor.Dimension);
            await register.ExecuteNonQueryAsync(cancellation);
        }
        EmbeddingSpace? active = null, configured = null;
        await using (var read = new NpgsqlCommand("SELECT id, provider, model, dimension, active FROM ai.embedding_spaces", connection, transaction))
        await using (var row = await read.ExecuteReaderAsync(cancellation))
            while (await row.ReadAsync(cancellation))
            {
                var space = new EmbeddingSpace(row.GetGuid(0), row.GetString(1), row.GetString(2), row.GetInt32(3));
                if (row.GetBoolean(4)) active = space;
                if (space.Is(descriptor)) configured = space;
            }
        switch (Decide(active, configured!, adopt))
        {
            case SpaceDecision.Use: return new(active, null);
            case SpaceDecision.Mismatch: return new(null, "embedding-mismatch");
            default:
                // Two statements: at no moment are two spaces active.
                await using (var off = new NpgsqlCommand("UPDATE ai.embedding_spaces SET active = false WHERE active", connection, transaction)) await off.ExecuteNonQueryAsync(cancellation);
                await using (var on = new NpgsqlCommand("UPDATE ai.embedding_spaces SET active = true WHERE id = @id", connection, transaction))
                {
                    on.Parameters.AddWithValue("id", configured!.Id);
                    await on.ExecuteNonQueryAsync(cancellation);
                }
                return new(configured, null);
        }
    }
}

public sealed record StoredChunk(Guid Id, int Ordinal, string Text);

public sealed record ChunkVector(Guid ChunkId, float[] Vector);

/// <summary>
/// Step 6 of ingestion, kept apart from the upload so a background worker can run it later: gives every chunk of
/// one stored document a vector in the active space. The provider is sent the chunk texts and nothing else. The
/// document becomes ready only when all vectors are stored, in the same transaction; otherwise it is marked failed
/// and can be embedded again. Running it again replaces the document's vectors and never duplicates them.
/// </summary>
public sealed class KnowledgeEmbedder(IEmbeddingProvider provider, IKnowledgeStore store, AiDatabaseState database, IOptions<AiKnowledgeOptions> options, ILogger<KnowledgeEmbedder> logger)
{
    public const string Ready = "ready", Failed = "failed";

    /// <returns>The document's state afterwards and, when it is not ready, a reason that is safe to show. Null when the school has no such document.</returns>
    public async Task<(string Status, string? Reason)?> Embed(TenantContext tenant, Guid documentId, CancellationToken cancellation)
    {
        IReadOnlyList<StoredChunk>? chunks;
        try { chunks = await store.Chunks(tenant, documentId, cancellation); }
        catch (Exception ex) when (ex is not OperationCanceledException) { return await Fail(tenant, documentId, "embedding-failed", ex.GetType().Name); }
        if (chunks is null) return null;
        var descriptor = provider.Descriptor;
        // Never embed into a space of another model or dimension: the vectors would be meaningless next to the others.
        if (database.Embedding?.Active is not { } space || !space.Is(descriptor)) return await Fail(tenant, documentId, "embedding-unavailable", database.Embedding?.Problem ?? "no-space");
        var clock = Stopwatch.StartNew();
        try
        {
            var size = Math.Clamp(options.Value.EmbeddingBatchSize, 1, descriptor.MaxBatchSize);
            var vectors = new List<ChunkVector>(chunks.Count); var tokens = 0; var batches = 0;
            foreach (var batch in chunks.Chunk(size))
            {
                var response = await provider.Embed(batch.Select(c => c.Text).ToList(), cancellation);
                // The count and the dimension are checked here as well as in the provider guard: a vector is stored as given or not at all.
                if (response.Vectors.Count != batch.Length || response.Vectors.Any(v => v is null || v.Length != space.Dimension))
                    throw new AiProviderException(descriptor.Provider, AiProviderError.InvalidResponse);
                vectors.AddRange(batch.Zip(response.Vectors, (chunk, vector) => new ChunkVector(chunk.Id, vector)));
                tokens += response.Usage?.InputTokens ?? 0; batches++;
            }
            await store.CompleteEmbedding(tenant, documentId, space, vectors, tokens, cancellation);
            logger.LogInformation("Knowledge document {Document} embedded: {Chunks} chunks in {Batches} batches, {Tokens} tokens, {Milliseconds} ms, {Provider} {Model}",
                documentId, chunks.Count, batches, tokens, clock.ElapsedMilliseconds, descriptor.Provider, descriptor.Model);
            return (Ready, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return await Fail(tenant, documentId, "embedding-failed", ex is AiProviderException failure ? failure.Error.ToString() : ex.GetType().Name);
        }
    }

    async Task<(string, string?)?> Fail(TenantContext tenant, Guid documentId, string reason, string category)
    {
        logger.LogWarning("Knowledge document {Document} was not embedded: {Reason} ({Category})", documentId, reason, category);
        try { await store.FailEmbedding(tenant, documentId, reason, CancellationToken.None); }
        catch (Exception ex) { logger.LogWarning("Knowledge document {Document} state could not be written ({Error})", documentId, ex.GetType().Name); }
        return (Failed, reason);
    }
}

using System.Diagnostics;
using EduOS.Ai.Gateway;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;

namespace EduOS.Ai.Knowledge;

/// <summary>Limits for retrieval, bound from "Ai:Retrieval". They bound what can ever be put in front of a model.</summary>
public sealed class AiRetrievalOptions
{
    public const string Section = "Ai:Retrieval";
    /// <summary>No configuration and no caller can ask for more results than this.</summary>
    public const int HardMaxTopK = 20;
    public int MaxQueryChars { get; set; } = 1000;
    public int TopK { get; set; } = 5;
    /// <summary>The most a caller may ask for.</summary>
    public int MaxTopK { get; set; } = 10;
    /// <summary>Cosine similarity below which a chunk is not relevant enough to return. It depends on the embedding model and is set again when the model changes.</summary>
    public double MinSimilarity { get; set; } = 0.5;
    /// <summary>The most chunk text one retrieval returns, in characters: the context budget.</summary>
    public int MaxContextChars { get; set; } = 6000;

    public static string? Problem(AiRetrievalOptions o, int chunkMaxChars) =>
        o.MaxQueryChars is < 1 or > 4000 ? "Ai:Retrieval:MaxQueryChars must be between 1 and 4000."
        : o.MaxTopK is < 1 or > HardMaxTopK ? $"Ai:Retrieval:MaxTopK must be between 1 and {HardMaxTopK}."
        : o.TopK < 1 || o.TopK > o.MaxTopK ? "Ai:Retrieval:TopK must be between 1 and MaxTopK."
        : !(o.MinSimilarity >= 0 && o.MinSimilarity <= 1) ? "Ai:Retrieval:MinSimilarity must be between 0 and 1."
        // The best chunk must always fit, or a relevant answer could never be returned.
        : o.MaxContextChars < chunkMaxChars || o.MaxContextChars > 40000 ? "Ai:Retrieval:MaxContextChars must be at least Ai:Knowledge:ChunkMaxChars and at most 40000." : null;
}

/// <summary>A candidate as the store ranks it, with what selection needs. It never leaves the service.</summary>
public sealed record KnowledgeMatch(Guid ChunkId, Guid DocumentId, string Title, string FileName, int Ordinal, string Text, string? Section, int? Page, int CharStart, int CharEnd, double Similarity);

/// <summary>What a later answer needs to use and cite a chunk. No vector, no school, no path.</summary>
public sealed record RetrievedChunk(Guid DocumentId, string Title, string Source, Guid ChunkId, int Ordinal, string Text, string? Section, int? Page, double Similarity);

public sealed record RetrievalRequest(int? TopK = null);

/// <summary>
/// Exactly one outcome: a rejected query, an unavailable retrieval, or a list of chunks. An empty list means
/// nothing relevant was found; it is a normal result, not a failure.
/// </summary>
public sealed record RetrievalResult(string? Invalid, string? Unavailable, IReadOnlyList<RetrievedChunk> Chunks, int Characters = 0, int Tokens = 0)
{
    public static RetrievalResult Rejected(string message) => new(message, null, []);
    public static RetrievalResult Off(string reason) => new(null, reason, []);
}

/// <summary>Chooses what to return from the ranked candidates. Pure and deterministic; no model is involved.</summary>
public static class KnowledgeSelection
{
    /// <summary>
    /// Takes candidates in rank order and stops at the first one below the threshold, at the requested count, or
    /// at the first chunk that no longer fits in the budget. A chunk is skipped when its text is already chosen,
    /// or when more than half of it lies inside a chosen chunk of the same document. Neighbouring chunks, which
    /// share only their overlap, are both kept. Text is never cut to fit.
    /// </summary>
    public static IReadOnlyList<KnowledgeMatch> Select(IEnumerable<KnowledgeMatch> candidates, int topK, double minSimilarity, int maxChars)
    {
        var chosen = new List<KnowledgeMatch>(); var characters = 0;
        foreach (var candidate in candidates.OrderByDescending(c => c.Similarity).ThenBy(c => c.DocumentId).ThenBy(c => c.Ordinal))
        {
            if (chosen.Count >= topK || candidate.Similarity < minSimilarity) break;
            if (chosen.Any(c => c.Text == candidate.Text || (c.DocumentId == candidate.DocumentId && Shared(c, candidate) * 2 > candidate.CharEnd - candidate.CharStart))) continue;
            if (characters + candidate.Text.Length > maxChars) break;
            chosen.Add(candidate); characters += candidate.Text.Length;
        }
        return chosen;
    }
    static int Shared(KnowledgeMatch a, KnowledgeMatch b) => Math.Max(0, Math.Min(a.CharEnd, b.CharEnd) - Math.Max(a.CharStart, b.CharStart));
}

/// <summary>
/// Finds the knowledge chunks of the caller's school that are closest in meaning to a question. The school comes
/// from the verified token and the audience from the caller's data scope; the search runs inside the tenant-scoped
/// database path, so row-level security bounds it whatever the query says. It calls the embedding provider with
/// the question only, never a model, and it logs counts and timings, never the question or the chunks.
/// </summary>
public sealed class KnowledgeRetriever(IOptions<AiOptions> ai, IOptions<AiRetrievalOptions> options, AiDatabaseState database, IAiUsageStore schools,
    IEmbeddingProvider provider, IKnowledgeStore store, ILogger<KnowledgeRetriever> logger)
{
    /// <param name="tenant">From the verified token: the only source of the school.</param>
    /// <param name="audience">The reader's data scope: school, teacher, parent or student. Only documents addressed to it are searched.</param>
    public async Task<RetrievalResult> Retrieve(TenantContext tenant, string audience, string? query, RetrievalRequest? request, CancellationToken cancellation)
    {
        if (!ai.Value.Enabled || !database.Configured) return RetrievalResult.Off("not-configured");
        if (!database.Ready) return RetrievalResult.Off("database-unavailable");
        if (tenant.IsPlatform || !KnowledgeValidation.Audiences.Contains(audience)) return RetrievalResult.Off("not-permitted");

        var settings = options.Value;
        var question = query?.Trim() ?? "";
        if (question.Length == 0 || question.Length > settings.MaxQueryChars) return RetrievalResult.Rejected($"Enter a question of at most {settings.MaxQueryChars} characters.");
        var topK = request?.TopK ?? settings.TopK;
        if (topK < 1 || topK > settings.MaxTopK) return RetrievalResult.Rejected($"topK must be between 1 and {settings.MaxTopK}.");

        try { if (!(await schools.Summary(tenant, cancellation)).Enabled) return RetrievalResult.Off("school-disabled"); }
        catch (Exception ex) when (ex is not OperationCanceledException) { return Failed("database-unavailable", ex); }

        // Only the active space is searched, and only with a provider that produces vectors of that space.
        var descriptor = provider.Descriptor;
        if (database.Embedding?.Active is not { } space || !space.Is(descriptor)) return RetrievalResult.Off("embedding-unavailable");

        var clock = Stopwatch.StartNew();
        float[] vector;
        try
        {
            // The provider is sent the question and nothing else.
            var response = await provider.Embed([question], cancellation);
            if (response.Vectors.Count != 1 || response.Vectors[0] is not { } single || single.Length != space.Dimension || !single.All(float.IsFinite) || single.All(v => v == 0))
                throw new AiProviderException(descriptor.Provider, AiProviderError.InvalidResponse);
            vector = single;
        }
        catch (AiProviderException ex) { return Failed(ex.Error == AiProviderError.Timeout ? "provider-timeout" : "provider-unavailable", ex); }
        catch (ArgumentException) { return RetrievalResult.Rejected("The question is too long to search for."); }
        catch (Exception ex) when (ex is not OperationCanceledException) { return Failed("provider-unavailable", ex); }

        IReadOnlyList<KnowledgeMatch> candidates;
        // A few more than asked for, so that duplicates can be dropped without coming back short.
        try { candidates = await store.Search(tenant, space, audience, vector, Math.Min(topK * 4, AiRetrievalOptions.HardMaxTopK * 4), cancellation); }
        catch (Exception ex) when (ex is not OperationCanceledException) { return Failed("database-unavailable", ex); }

        var chosen = KnowledgeSelection.Select(candidates, topK, settings.MinSimilarity, settings.MaxContextChars);
        var chunks = chosen.Select(c => new RetrievedChunk(c.DocumentId, c.Title, c.FileName, c.ChunkId, c.Ordinal, c.Text, c.Section, c.Page, c.Similarity)).ToList();
        logger.LogInformation("Knowledge retrieval: {Results} of {Candidates} candidates, {Characters} characters, {Milliseconds} ms, {Provider} {Model}",
            chunks.Count, candidates.Count, chunks.Sum(c => c.Text.Length), clock.ElapsedMilliseconds, descriptor.Provider, descriptor.Model);
        return new RetrievalResult(null, null, chunks, chunks.Sum(c => c.Text.Length), chunks.Sum(c => AiTokens.Estimate(c.Text)));
    }

    // The category and the exception type only: never the question, and never a message that could carry an address.
    RetrievalResult Failed(string reason, Exception ex)
    {
        logger.LogWarning("Knowledge retrieval unavailable: {Reason} ({Error})", reason, ex is AiProviderException failure ? failure.Error.ToString() : ex.GetType().Name);
        return RetrievalResult.Off(reason);
    }
}

using EduOS.Ai.Gateway;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;

namespace EduOS.Ai.Knowledge;

/// <summary>Limits for knowledge documents, bound from "Ai:Knowledge".</summary>
public sealed class AiKnowledgeOptions
{
    public const string Section = "Ai:Knowledge";
    public int MaxUploadBytes { get; set; } = 512 * 1024;
    /// <summary>The most text one document may hold after extraction and normalisation.</summary>
    public int MaxTextChars { get; set; } = 400_000;
    public int ChunkMaxChars { get; set; } = 1200;
    public int ChunkOverlapChars { get; set; } = 150;
    /// <summary>Chunks sent to the embedding provider per call. A provider with a lower limit lowers it further.</summary>
    public int EmbeddingBatchSize { get; set; } = 32;
    /// <summary>
    /// Off by default. When on, a start with a different embedding model or dimension makes that the active space;
    /// documents embedded in the old one then wait to be embedded again. When off, such a start leaves embedding unavailable.
    /// </summary>
    public bool AdoptEmbeddingModel { get; set; }

    public static string? Problem(AiKnowledgeOptions o) =>
        o.MaxUploadBytes is < 1024 or > 5 * 1024 * 1024 ? "Ai:Knowledge:MaxUploadBytes must be between 1 KB and 5 MB."
        : o.MaxTextChars is < 1000 or > 2_000_000 ? "Ai:Knowledge:MaxTextChars must be between 1000 and 2000000."
        : o.EmbeddingBatchSize is < 1 or > 256 ? "Ai:Knowledge:EmbeddingBatchSize must be between 1 and 256."
        : KnowledgeChunker.Problem(o.ChunkMaxChars, o.ChunkOverlapChars);
}

/// <summary>Exactly one of Rejected, Unavailable and Saved is set.</summary>
public sealed record IngestionOutcome(KnowledgeRejection? Rejected, string? Unavailable, KnowledgeSaved? Saved, int? RetryAfterSeconds = null);

/// <summary>
/// Adds, lists and removes the knowledge documents of the caller's school. Ingestion runs separate steps:
/// validation, extraction, normalisation, chunking, persistence and embedding. It reads no EduOS record, writes
/// no file, and logs counts and categories only, never text or vectors.
/// </summary>
public sealed class KnowledgeService(IOptions<AiOptions> ai, IOptions<AiKnowledgeOptions> options, AiDatabaseState database, IAiUsageStore schools,
    IKnowledgeStore store, KnowledgeEmbedder embedder, AiRateLimiter limiter, ILogger<KnowledgeService> logger)
{
    /// <summary>Null when knowledge can be managed; otherwise why not. Includes the school's own AI switch.</summary>
    public async Task<string?> UnavailableFor(TenantContext tenant, CancellationToken cancellation)
    {
        if (Deployment() is string reason) return reason;
        try { return (await schools.Summary(tenant, cancellation)).Enabled ? null : "school-disabled"; }
        catch (Exception ex) when (ex is not OperationCanceledException) { return Failed("read", ex); }
    }
    string? Deployment() => !ai.Value.Enabled || !database.Configured ? "not-configured" : !database.Ready ? "database-unavailable" : null;

    /// <summary>
    /// What a client is told. A document is "ready" only while its vectors are in the active embedding space; one
    /// that was embedded with an earlier model is "pending" until it is embedded again.
    /// </summary>
    string Effective(string status, Guid? space) => status == KnowledgeEmbedder.Ready && space != database.Embedding?.Active?.Id ? "pending" : status;

    public async Task<IngestionOutcome> Ingest(TenantContext tenant, KnowledgeUpload upload, CancellationToken cancellation)
    {
        // The rate limit comes before anything that touches the database.
        if (Deployment() is string off) return new(null, off, null);
        if (limiter.Admit(tenant) is > 0 and var wait) return new(null, "rate-limited", null, wait);
        if (await UnavailableFor(tenant, cancellation) is string reason) return new(null, reason, null);
        KnowledgeSaved saved;
        try
        {
            var settings = options.Value;
            var valid = KnowledgeValidation.Check(upload, settings.MaxUploadBytes);
            var text = KnowledgeNormalization.Normalize(KnowledgeExtraction.Text(valid));
            if (text.Length == 0) throw new KnowledgeRejection(400, "no-text", "The file contains no text.");
            if (text.Length > settings.MaxTextChars) throw new KnowledgeRejection(413, "text-too-long", $"The document has more than {settings.MaxTextChars} characters of text. Split it into smaller documents.");
            var chunks = KnowledgeChunker.Split(text, settings.ChunkMaxChars, settings.ChunkOverlapChars, valid.MediaType == KnowledgeValidation.Markdown);
            saved = await store.Save(tenant, new NewKnowledgeDocument(valid.Title, valid.FileName, valid.MediaType, valid.Audience, valid.Bytes.Length, text.Length, KnowledgeNormalization.Hash(text)), chunks, cancellation);
            logger.LogInformation("Knowledge document {Document} {Result}: {Bytes} bytes, {Characters} characters, {Chunks} chunks", saved.Id, saved.Duplicate ? "already present" : "stored", valid.Bytes.Length, text.Length, saved.Chunks);
        }
        catch (KnowledgeRejection rejection)
        {
            logger.LogInformation("Knowledge document rejected: {Category}, {Bytes} bytes", rejection.Category, upload.Bytes.Length);
            return new(rejection, null, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException) { return new(null, Failed("write", ex), null); }

        // The text is safely stored. Embedding follows; if it fails the document stays, not ready, and can be embedded again.
        var status = Effective(saved.Status, saved.SpaceId); string? why = null;
        if (status != KnowledgeEmbedder.Ready) (status, why) = await embedder.Embed(tenant, saved.Id, cancellation) ?? (KnowledgeEmbedder.Failed, "embedding-failed");
        return new(null, null, saved with { Status = status, Reason = why });
    }

    /// <summary>Embeds a stored document again. Null status when the school has no such document.</summary>
    public async Task<(string? Status, string? Reason, string? Unavailable, int? RetryAfterSeconds)> Embed(TenantContext tenant, Guid id, CancellationToken cancellation)
    {
        if (Deployment() is string off) return (null, null, off, null);
        if (limiter.Admit(tenant) is > 0 and var wait) return (null, null, "rate-limited", wait);
        if (await UnavailableFor(tenant, cancellation) is string reason) return (null, null, reason, null);
        var outcome = await embedder.Embed(tenant, id, cancellation);
        return (outcome?.Status, outcome?.Reason, null, null);
    }

    public async Task<(IReadOnlyList<KnowledgeDocumentInfo>? Documents, string? Reason)> List(TenantContext tenant, CancellationToken cancellation)
    {
        if (await UnavailableFor(tenant, cancellation) is string reason) return (null, reason);
        try { return ((await store.List(tenant, cancellation)).Select(d => d with { Status = Effective(d.Status, d.EmbeddingSpaceId) }).ToList(), null); }
        catch (Exception ex) when (ex is not OperationCanceledException) { return (null, Failed("read", ex)); }
    }

    public async Task<(bool? Deleted, string? Reason)> Delete(TenantContext tenant, Guid id, CancellationToken cancellation)
    {
        if (await UnavailableFor(tenant, cancellation) is string reason) return (null, reason);
        try
        {
            var deleted = await store.Delete(tenant, id, cancellation);
            if (deleted) logger.LogInformation("Knowledge document {Document} removed", id);
            return (deleted, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException) { return (null, Failed("write", ex)); }
    }

    // The exception type only: a provider message can carry a host name, and must never carry text of a document.
    string Failed(string operation, Exception ex)
    {
        logger.LogWarning("Knowledge {Operation} failed ({Error})", operation, ex.GetType().Name);
        return "database-unavailable";
    }
}

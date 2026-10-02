using System.Globalization;
using System.Text.Json.Serialization;
using EduOS.ServiceAuth;
using Npgsql;

namespace EduOS.Ai.Knowledge;

public sealed record NewKnowledgeDocument(string Title, string FileName, string MediaType, string[] Audience, int ByteCount, int CharCount, string TextSha256);

/// <param name="Duplicate">True when the school already holds a document with exactly this text; that document is returned and nothing is written.</param>
/// <param name="Status">The stored state. A new document is "processing" until its chunks are embedded.</param>
/// <param name="Reason">Why the document is not ready, when it is not.</param>
public sealed record KnowledgeSaved(Guid Id, string Title, int Chunks, int Characters, bool Duplicate, string Status = "processing", Guid? SpaceId = null, string? Reason = null);

/// <param name="EmbeddingSpaceId">The space the document's vectors are in. Internal: never sent to a client.</param>
public sealed record KnowledgeDocumentInfo(Guid Id, string Title, string FileName, string MediaType, string[] Audience, string Status, int Bytes, int Characters, int Chunks, DateTimeOffset CreatedAt,
    [property: JsonIgnore] Guid? EmbeddingSpaceId = null);

/// <summary>
/// Knowledge of the school in the verified token, and of no other; there is no way to name a school. Documents,
/// chunks and vectors live in one store because a document's state and its vectors must change in one transaction.
/// </summary>
public interface IKnowledgeStore
{
    /// <summary>Writes the document and all of its chunks, or nothing. The document is not searchable until it is embedded.</summary>
    Task<KnowledgeSaved> Save(TenantContext tenant, NewKnowledgeDocument document, IReadOnlyList<KnowledgeChunk> chunks, CancellationToken cancellation);
    Task<IReadOnlyList<KnowledgeDocumentInfo>> List(TenantContext tenant, CancellationToken cancellation);
    /// <summary>Removes the document with its chunks and vectors. False when the school has no such document.</summary>
    Task<bool> Delete(TenantContext tenant, Guid id, CancellationToken cancellation);
    /// <summary>The chunks of one document in order, or null when the school has no such document.</summary>
    Task<IReadOnlyList<StoredChunk>?> Chunks(TenantContext tenant, Guid documentId, CancellationToken cancellation);
    /// <summary>
    /// Replaces the document's vectors in this space and marks it ready, in one transaction. It fails, changing
    /// nothing, unless there is exactly one vector of the space's dimension for every chunk of the document.
    /// </summary>
    Task CompleteEmbedding(TenantContext tenant, Guid documentId, EmbeddingSpace space, IReadOnlyList<ChunkVector> vectors, int tokens, CancellationToken cancellation);
    /// <summary>Marks a document that is not ready as failed. A ready document keeps its state and its vectors.</summary>
    Task FailEmbedding(TenantContext tenant, Guid documentId, string failure, CancellationToken cancellation);
    /// <summary>
    /// The chunks nearest to the query vector by cosine similarity, best first. Only the caller's school, only
    /// documents that are ready in this space and addressed to this audience, and only vectors of this space.
    /// </summary>
    Task<IReadOnlyList<KnowledgeMatch>> Search(TenantContext tenant, EmbeddingSpace space, string audience, float[] query, int limit, CancellationToken cancellation);
}

public sealed class PostgresKnowledgeStore(AiDatabase database) : IKnowledgeStore
{
    /// <summary>pgvector's text form. Every component is written exactly as it is, in a culture-independent way.</summary>
    public static string Literal(float[] vector) => "[" + string.Join(",", vector.Select(v => v.ToString("R", CultureInfo.InvariantCulture))) + "]";

    public Task<KnowledgeSaved> Save(TenantContext tenant, NewKnowledgeDocument document, IReadOnlyList<KnowledgeChunk> chunks, CancellationToken cancellation) =>
        database.InSchool(tenant, async (connection, transaction, token) =>
        {
            // One upload of a school at a time decides whether the text is already there.
            await using (var serialize = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended(@key, 0))", connection, transaction))
            {
                serialize.Parameters.AddWithValue("key", "ai-knowledge:" + tenant.SchoolId);
                await serialize.ExecuteNonQueryAsync(token);
            }
            await using (var existing = new NpgsqlCommand("SELECT id, title, chunk_count, char_count, status, embedding_space_id FROM ai.knowledge_documents WHERE text_sha256 = @hash", connection, transaction))
            {
                existing.Parameters.AddWithValue("hash", document.TextSha256);
                await using var row = await existing.ExecuteReaderAsync(token);
                if (await row.ReadAsync(token))
                    return new KnowledgeSaved(row.GetGuid(0), row.GetString(1), row.GetInt32(2), row.GetInt32(3), true, row.GetString(4), row.IsDBNull(5) ? null : row.GetGuid(5));
            }
            Guid id;
            await using (var insert = new NpgsqlCommand("""
                INSERT INTO ai.knowledge_documents (school_id, title, file_name, media_type, audience, status, byte_count, char_count, chunk_count, text_sha256, uploaded_by)
                VALUES (@school, @title, @file, @type, @audience, 'processing', @bytes, @chars, @chunks, @hash, @user) RETURNING id
                """, connection, transaction))
            {
                insert.Parameters.AddWithValue("school", tenant.SchoolId); insert.Parameters.AddWithValue("title", document.Title); insert.Parameters.AddWithValue("file", document.FileName);
                insert.Parameters.AddWithValue("type", document.MediaType); insert.Parameters.AddWithValue("audience", document.Audience); insert.Parameters.AddWithValue("bytes", document.ByteCount);
                insert.Parameters.AddWithValue("chars", document.CharCount); insert.Parameters.AddWithValue("chunks", chunks.Count); insert.Parameters.AddWithValue("hash", document.TextSha256);
                insert.Parameters.AddWithValue("user", tenant.UserId);
                id = (Guid)(await insert.ExecuteScalarAsync(token))!;
            }
            // All chunks in one statement, in the same transaction as the document: a failure here removes both.
            await using (var pieces = new NpgsqlCommand("""
                INSERT INTO ai.knowledge_chunks (school_id, document_id, ordinal, text, char_start, char_end, section, page, token_estimate)
                SELECT @school, @document, * FROM unnest(@ordinals, @texts, @starts, @ends, @sections, @pages, @tokens)
                """, connection, transaction))
            {
                pieces.Parameters.AddWithValue("school", tenant.SchoolId); pieces.Parameters.AddWithValue("document", id);
                pieces.Parameters.AddWithValue("ordinals", chunks.Select(c => c.Ordinal).ToArray()); pieces.Parameters.AddWithValue("texts", chunks.Select(c => c.Text).ToArray());
                pieces.Parameters.AddWithValue("starts", chunks.Select(c => c.CharStart).ToArray()); pieces.Parameters.AddWithValue("ends", chunks.Select(c => c.CharEnd).ToArray());
                pieces.Parameters.Add(new NpgsqlParameter<string?[]>("sections", chunks.Select(c => c.Section).ToArray()));
                pieces.Parameters.Add(new NpgsqlParameter<int?[]>("pages", chunks.Select(c => c.Page).ToArray()));
                pieces.Parameters.AddWithValue("tokens", chunks.Select(c => c.TokenEstimate).ToArray());
                await pieces.ExecuteNonQueryAsync(token);
            }
            return new KnowledgeSaved(id, document.Title, chunks.Count, document.CharCount, false);
        }, cancellation);

    public Task<IReadOnlyList<KnowledgeDocumentInfo>> List(TenantContext tenant, CancellationToken cancellation) =>
        database.InSchool<IReadOnlyList<KnowledgeDocumentInfo>>(tenant, async (connection, transaction, token) =>
        {
            var documents = new List<KnowledgeDocumentInfo>();
            await using var read = new NpgsqlCommand("SELECT id, title, file_name, media_type, audience, status, byte_count, char_count, chunk_count, created_at, embedding_space_id FROM ai.knowledge_documents ORDER BY created_at DESC, id LIMIT 500", connection, transaction);
            await using var row = await read.ExecuteReaderAsync(token);
            while (await row.ReadAsync(token))
                documents.Add(new KnowledgeDocumentInfo(row.GetGuid(0), row.GetString(1), row.GetString(2), row.GetString(3), row.GetFieldValue<string[]>(4), row.GetString(5), row.GetInt32(6), row.GetInt32(7), row.GetInt32(8),
                    row.GetFieldValue<DateTimeOffset>(9), row.IsDBNull(10) ? null : row.GetGuid(10)));
            return documents;
        }, cancellation);

    public Task<bool> Delete(TenantContext tenant, Guid id, CancellationToken cancellation) =>
        database.InSchool(tenant, async (connection, transaction, token) =>
        {
            await using var delete = new NpgsqlCommand("DELETE FROM ai.knowledge_documents WHERE id = @id", connection, transaction);
            delete.Parameters.AddWithValue("id", id);
            return await delete.ExecuteNonQueryAsync(token) > 0;
        }, cancellation);

    public Task<IReadOnlyList<StoredChunk>?> Chunks(TenantContext tenant, Guid documentId, CancellationToken cancellation) =>
        database.InSchool<IReadOnlyList<StoredChunk>?>(tenant, async (connection, transaction, token) =>
        {
            await using (var exists = new NpgsqlCommand("SELECT 1 FROM ai.knowledge_documents WHERE id = @id", connection, transaction))
            {
                exists.Parameters.AddWithValue("id", documentId);
                if (await exists.ExecuteScalarAsync(token) is null) return null;
            }
            var chunks = new List<StoredChunk>();
            await using var read = new NpgsqlCommand("SELECT id, ordinal, text FROM ai.knowledge_chunks WHERE document_id = @id ORDER BY ordinal", connection, transaction);
            read.Parameters.AddWithValue("id", documentId);
            await using var row = await read.ExecuteReaderAsync(token);
            while (await row.ReadAsync(token)) chunks.Add(new StoredChunk(row.GetGuid(0), row.GetInt32(1), row.GetString(2)));
            return chunks;
        }, cancellation);

    public Task CompleteEmbedding(TenantContext tenant, Guid documentId, EmbeddingSpace space, IReadOnlyList<ChunkVector> vectors, int tokens, CancellationToken cancellation)
    {
        // A vector is stored exactly as the model produced it, or not at all. The table refuses a wrong size as well.
        if (vectors.Any(v => v.Vector.Length != space.Dimension)) throw new InvalidOperationException("A vector does not have the dimension of its embedding space.");
        return database.InSchool(tenant, async (connection, transaction, token) =>
        {
            await using (var replace = new NpgsqlCommand("DELETE FROM ai.knowledge_embeddings e USING ai.knowledge_chunks k WHERE k.id = e.chunk_id AND k.document_id = @document AND e.space_id = @space", connection, transaction))
            {
                replace.Parameters.AddWithValue("document", documentId); replace.Parameters.AddWithValue("space", space.Id);
                await replace.ExecuteNonQueryAsync(token);
            }
            // Only chunks of this document are accepted; a chunk id from anywhere else is simply not matched.
            await using (var insert = new NpgsqlCommand("""
                INSERT INTO ai.knowledge_embeddings (school_id, chunk_id, space_id, dimension, embedding)
                SELECT @school, k.id, @space, @dimension, v.value::vector FROM unnest(@chunks, @vectors) AS v(chunk_id, value)
                JOIN ai.knowledge_chunks k ON k.id = v.chunk_id AND k.document_id = @document
                """, connection, transaction))
            {
                insert.Parameters.AddWithValue("school", tenant.SchoolId); insert.Parameters.AddWithValue("space", space.Id); insert.Parameters.AddWithValue("dimension", space.Dimension);
                insert.Parameters.AddWithValue("document", documentId); insert.Parameters.AddWithValue("chunks", vectors.Select(v => v.ChunkId).ToArray());
                insert.Parameters.AddWithValue("vectors", vectors.Select(v => Literal(v.Vector)).ToArray());
                await insert.ExecuteNonQueryAsync(token);
            }
            await using (var check = new NpgsqlCommand("""
                SELECT (SELECT count(*) FROM ai.knowledge_chunks WHERE document_id = @document),
                       (SELECT count(*) FROM ai.knowledge_embeddings e JOIN ai.knowledge_chunks k ON k.id = e.chunk_id WHERE k.document_id = @document AND e.space_id = @space)
                """, connection, transaction))
            {
                check.Parameters.AddWithValue("document", documentId); check.Parameters.AddWithValue("space", space.Id);
                await using var row = await check.ExecuteReaderAsync(token);
                await row.ReadAsync(token);
                // Throwing rolls the transaction back, so a document never ends up with vectors for only some of its chunks.
                if (row.GetInt64(0) == 0 || row.GetInt64(0) != row.GetInt64(1)) throw new InvalidOperationException("The vectors do not cover every chunk of the document.");
            }
            await using var ready = new NpgsqlCommand("UPDATE ai.knowledge_documents SET status = 'ready', failure = NULL, embedding_space_id = @space, embedded_tokens = @tokens, embedded_at = now(), updated_at = now() WHERE id = @document", connection, transaction);
            ready.Parameters.AddWithValue("space", space.Id); ready.Parameters.AddWithValue("tokens", tokens); ready.Parameters.AddWithValue("document", documentId);
            if (await ready.ExecuteNonQueryAsync(token) != 1) throw new InvalidOperationException("The document is not available.");
            return 0;
        }, cancellation);
    }

    public Task<IReadOnlyList<KnowledgeMatch>> Search(TenantContext tenant, EmbeddingSpace space, string audience, float[] query, int limit, CancellationToken cancellation)
    {
        // A query of another size is never compared with stored vectors.
        if (query.Length != space.Dimension) throw new InvalidOperationException("The query vector does not have the dimension of the embedding space.");
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        return database.InSchool<IReadOnlyList<KnowledgeMatch>>(tenant, async (connection, transaction, token) =>
        {
            // An exact search: every vector of the school in this space is compared. The school is filtered here and,
            // independently, by row-level security on all three tables. The joins repeat the school so that a chunk,
            // its document and its vector can only ever be of one school.
            await using var search = new NpgsqlCommand("""
                SELECT k.id, k.document_id, d.title, d.file_name, k.ordinal, k.text, k.section, k.page, k.char_start, k.char_end,
                       1 - (e.embedding <=> @query::vector) AS similarity
                FROM ai.knowledge_embeddings e
                JOIN ai.knowledge_chunks k ON k.id = e.chunk_id AND k.school_id = e.school_id
                JOIN ai.knowledge_documents d ON d.id = k.document_id AND d.school_id = k.school_id
                WHERE e.school_id = @school AND e.space_id = @space AND e.dimension = @dimension
                  AND d.status = 'ready' AND d.embedding_space_id = @space AND @audience = ANY(d.audience)
                ORDER BY e.embedding <=> @query::vector, k.document_id, k.ordinal
                LIMIT @limit
                """, connection, transaction);
            search.Parameters.AddWithValue("query", Literal(query)); search.Parameters.AddWithValue("school", tenant.SchoolId); search.Parameters.AddWithValue("space", space.Id);
            search.Parameters.AddWithValue("dimension", space.Dimension); search.Parameters.AddWithValue("audience", audience); search.Parameters.AddWithValue("limit", limit);
            var matches = new List<KnowledgeMatch>();
            await using var row = await search.ExecuteReaderAsync(token);
            while (await row.ReadAsync(token))
                matches.Add(new KnowledgeMatch(row.GetGuid(0), row.GetGuid(1), row.GetString(2), row.GetString(3), row.GetInt32(4), row.GetString(5), row.IsDBNull(6) ? null : row.GetString(6),
                    row.IsDBNull(7) ? null : row.GetInt32(7), row.GetInt32(8), row.GetInt32(9), row.GetDouble(10)));
            return matches;
        }, cancellation);
    }

    public Task FailEmbedding(TenantContext tenant, Guid documentId, string failure, CancellationToken cancellation) =>
        database.InSchool(tenant, async (connection, transaction, token) =>
        {
            await using var failed = new NpgsqlCommand("UPDATE ai.knowledge_documents SET status = 'failed', failure = @failure, updated_at = now() WHERE id = @document AND status <> 'ready'", connection, transaction);
            failed.Parameters.AddWithValue("failure", failure); failed.Parameters.AddWithValue("document", documentId);
            return await failed.ExecuteNonQueryAsync(token);
        }, cancellation);
}

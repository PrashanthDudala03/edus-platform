using System.Net;
using System.Text;
using EduOS.Ai.Gateway;
using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Npgsql;
using Xunit;

/// <summary>Vectors in real pgvector, as ai_app. Skipped without AI_TEST_DB_*.</summary>
public class AiEmbeddingIntegrationTests(AiDatabaseFixture fixture) : IClassFixture<AiDatabaseFixture>
{
    static readonly FakeEmbeddingProvider Fake = new();
    PostgresKnowledgeStore Store => new(fixture.Database);
    static Task<long> Count(string table, Guid school) => AiDatabaseFixture.AsOwner<long>($"SELECT count(*) FROM ai.{table} WHERE school_id = @s", ("s", school));
    Task<int> RunAs(Guid school, string sql) => fixture.Database.InSchool(AiDatabaseFixture.Tenant(school), async (c, t, _) => { await using var command = new NpgsqlCommand(sql, c, t); return await command.ExecuteNonQueryAsync(); });
    Task<long> CountAs(Guid school, string table) => fixture.Database.InSchool(AiDatabaseFixture.Tenant(school), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, $"SELECT count(*) FROM ai.{table}", t));

    /// <summary>A stored, not yet embedded document of a new school, with its chunks and the vectors the fake provider gives them.</summary>
    async Task<(TenantContext Caller, Guid Document, IReadOnlyList<StoredChunk> Chunks, List<ChunkVector> Vectors)> Stored(string marker, Guid? school = null)
    {
        var caller = AiDatabaseFixture.Tenant(school ?? Guid.NewGuid());
        var text = KnowledgeNormalization.Normalize("# Rules\n\n" + string.Join(" ", Enumerable.Range(0, 120).Select(i => marker + i)));
        var saved = await Store.Save(caller, new NewKnowledgeDocument("Rules", "rules.md", "text/markdown", ["school"], text.Length, text.Length, KnowledgeNormalization.Hash(text)), KnowledgeChunker.Split(text, 200, 40, true), default);
        var chunks = (await Store.Chunks(caller, saved.Id, default))!;
        var vectors = (await Fake.Embed(chunks.Select(c => c.Text).ToList(), default)).Vectors;
        return (caller, saved.Id, chunks, chunks.Zip(vectors, (c, v) => new ChunkVector(c.Id, v)).ToList());
    }
    static Task<string> State(Guid document) => AiDatabaseFixture.AsOwner<string>(
        "SELECT concat_ws('|', status, COALESCE(failure, ''), COALESCE(embedding_space_id::text, ''), COALESCE(embedded_tokens::text, '')) FROM ai.knowledge_documents WHERE id = @id", ("id", document));

    [DatabaseFact]
    public async Task TheActiveSpaceIsTheConfiguredProvidersAndStaysTheSameAcrossStarts()
    {
        Assert.True(fixture.Space.Is(Fake.Descriptor));
        Assert.Equal(fixture.Space.Id, (await AiDatabaseFixture.Bootstrap().Run(default)).Active?.Id);
        Assert.Equal($"{fixture.Space.Id}|fake|fake-embed-1|{Fake.Descriptor.Dimension}", await AiDatabaseFixture.AsOwner<string>("SELECT concat_ws('|', id, provider, model, dimension) FROM ai.embedding_spaces WHERE active"));
        Assert.Equal(1, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.embedding_spaces WHERE active"));
    }

    [DatabaseFact]
    public async Task AnotherModelOrDimensionIsAMismatchUnlessTheDeploymentAdoptsIt()
    {
        // Run inside a transaction that is rolled back, so the test database keeps its active space.
        var other = new EmbeddingDescriptor("fake", "fake-embed-1", DataBoundary.Local, Fake.Descriptor.Dimension * 2, 512, 64);
        await using var connection = new NpgsqlConnection(AiDatabaseFixture.Owner); await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        var refused = await EmbeddingSpaces.Ensure(connection, transaction, other, false, default);
        Assert.Equal((null, "embedding-mismatch"), (refused.Active, refused.Problem));
        Assert.Equal(fixture.Space.Id, await AiDatabaseFixture.Scalar<Guid>(connection, "SELECT id FROM ai.embedding_spaces WHERE active", transaction));
        var adopted = await EmbeddingSpaces.Ensure(connection, transaction, other, true, default);
        Assert.True(adopted.Active!.Is(other)); Assert.NotEqual(fixture.Space.Id, adopted.Active.Id);
        Assert.Equal(adopted.Active.Id, await AiDatabaseFixture.Scalar<Guid>(connection, "SELECT id FROM ai.embedding_spaces WHERE active", transaction));
        Assert.Equal(1, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.embedding_spaces WHERE active", transaction));
        // The original provider is now the one that does not match.
        Assert.Equal("embedding-mismatch", (await EmbeddingSpaces.Ensure(connection, transaction, Fake.Descriptor, false, default)).Problem);
        await transaction.RollbackAsync();
        Assert.Equal(fixture.Space.Id, await AiDatabaseFixture.AsOwner<Guid>("SELECT id FROM ai.embedding_spaces WHERE active"));
    }

    [DatabaseFact]
    public async Task VectorsAreStoredExactlyAndTheDocumentBecomesReadyWithThem()
    {
        var (caller, document, chunks, vectors) = await Stored("alpha");
        Assert.Equal("processing|||", await State(document));
        await Store.CompleteEmbedding(caller, document, fixture.Space, vectors, 321, default);
        Assert.Equal($"ready||{fixture.Space.Id}|321", await State(document));
        Assert.Equal(chunks.Count, await Count("knowledge_embeddings", caller.SchoolId));
        Assert.Equal($"{chunks.Count}|{fixture.Space.Dimension}|{fixture.Space.Dimension}|{fixture.Space.Id}", await AiDatabaseFixture.AsOwner<string>(
            "SELECT concat_ws('|', count(*), min(vector_dims(embedding)), max(dimension), min(space_id::text)) FROM ai.knowledge_embeddings WHERE school_id = @s", ("s", caller.SchoolId)));
        // What comes back is what was stored, component for component, and pgvector can measure with it.
        var stored = await AiDatabaseFixture.AsOwner<string>("SELECT embedding::text FROM ai.knowledge_embeddings WHERE chunk_id = @c", ("c", chunks[0].Id));
        Assert.Equal(vectors[0].Vector, stored.Trim('[', ']').Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)));
        Assert.Equal(0d, await AiDatabaseFixture.AsOwner<double>("SELECT max(embedding <=> embedding) FROM ai.knowledge_embeddings WHERE school_id = @s", ("s", caller.SchoolId)), 6);
        Assert.Equal("ready", Assert.Single(await Store.List(caller, default)).Status);
        Assert.Equal(fixture.Space.Id, Assert.Single(await Store.List(caller, default)).EmbeddingSpaceId);
    }

    [DatabaseFact]
    public async Task AVectorOfAnotherDimensionIsRefusedNotCutOrPadded()
    {
        var (caller, document, chunks, vectors) = await Stored("bravo");
        var half = fixture.Space.Dimension / 2;
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.CompleteEmbedding(caller, document, fixture.Space, vectors.Select(v => v with { Vector = v.Vector[..half] }).ToList(), 0, default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.CompleteEmbedding(caller, document, fixture.Space, vectors.Take(1).Select(v => v with { Vector = [.. v.Vector, 0f] }).Concat(vectors.Skip(1)).ToList(), 0, default));
        // The table refuses it too, whatever the application does: the size must equal the declared dimension, and that must be the space's.
        var literal = PostgresKnowledgeStore.Literal(vectors[0].Vector[..half]);
        var insert = $"INSERT INTO ai.knowledge_embeddings (school_id, chunk_id, space_id, dimension, embedding) VALUES ('{caller.SchoolId}', '{chunks[0].Id}', '{fixture.Space.Id}', {{0}}, '{literal}'::vector)";
        await AiDatabaseFixture.Denied(() => RunAs(caller.SchoolId, string.Format(insert, fixture.Space.Dimension)), "23514");
        await AiDatabaseFixture.Denied(() => RunAs(caller.SchoolId, string.Format(insert, half)), "23503");
        Assert.Equal("processing|||", await State(document));
        Assert.Equal(0, await Count("knowledge_embeddings", caller.SchoolId));
    }

    [DatabaseFact]
    public async Task ADocumentIsReadyOnlyWhenEveryChunkHasAVector()
    {
        var (caller, document, _, vectors) = await Stored("charlie");
        var (_, _, foreignChunks, foreignVectors) = await Stored("charlie-other");
        // One vector short, one vector twice, and a vector for a chunk of another document: all refused, nothing kept.
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.CompleteEmbedding(caller, document, fixture.Space, vectors.Skip(1).ToList(), 0, default));
        await Assert.ThrowsAsync<PostgresException>(() => Store.CompleteEmbedding(caller, document, fixture.Space, vectors.Append(vectors[0]).ToList(), 0, default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.CompleteEmbedding(caller, document, fixture.Space, vectors.Skip(1).Append(foreignVectors[0]).ToList(), 0, default));
        Assert.Equal("processing|||", await State(document));
        Assert.Equal(0, await Count("knowledge_embeddings", caller.SchoolId));
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.knowledge_embeddings WHERE chunk_id = @c", ("c", foreignChunks[0].Id)));
        // A document that cannot be embedded is marked failed and can be embedded later.
        await Store.FailEmbedding(caller, document, "embedding-failed", default);
        Assert.Equal("failed|embedding-failed||", await State(document));
        await Store.CompleteEmbedding(caller, document, fixture.Space, vectors, 10, default);
        Assert.Equal($"ready||{fixture.Space.Id}|10", await State(document));
        // Once ready, a later failure does not take the document or its vectors away.
        await Store.FailEmbedding(caller, document, "embedding-failed", default);
        Assert.Equal($"ready||{fixture.Space.Id}|10", await State(document));
    }

    [DatabaseFact]
    public async Task EmbeddingAgainReplacesTheVectorsAndNeverDuplicatesThem()
    {
        var (caller, document, chunks, vectors) = await Stored("delta");
        await Store.CompleteEmbedding(caller, document, fixture.Space, vectors, 1, default);
        await Store.CompleteEmbedding(caller, document, fixture.Space, vectors.Select(v => v with { Vector = v.Vector.Reverse().ToArray() }).ToList(), 2, default);
        Assert.Equal(chunks.Count, await Count("knowledge_embeddings", caller.SchoolId));
        Assert.Equal(PostgresKnowledgeStore.Literal(vectors[0].Vector.Reverse().ToArray()), await AiDatabaseFixture.AsOwner<string>("SELECT embedding::text FROM ai.knowledge_embeddings WHERE chunk_id = @c", ("c", chunks[0].Id)));
        Assert.EndsWith("|2", await State(document));
        // The table itself allows one vector per chunk and space.
        var literal = PostgresKnowledgeStore.Literal(vectors[0].Vector);
        await AiDatabaseFixture.Denied(() => RunAs(caller.SchoolId, $"INSERT INTO ai.knowledge_embeddings (school_id, chunk_id, space_id, dimension, embedding) VALUES ('{caller.SchoolId}', '{chunks[0].Id}', '{fixture.Space.Id}', {fixture.Space.Dimension}, '{literal}'::vector)"), "23505");
        // Removing the document removes its chunks and its vectors.
        Assert.True(await Store.Delete(caller, document, default));
        Assert.Equal((0L, 0L), (await Count("knowledge_chunks", caller.SchoolId), await Count("knowledge_embeddings", caller.SchoolId)));
    }

    [DatabaseFact]
    public async Task VectorsAreInvisibleWithoutASchoolAndToEveryOtherSchool()
    {
        var a = await Stored("echo"); var b = await Stored("foxtrot");
        await Store.CompleteEmbedding(a.Caller, a.Document, fixture.Space, a.Vectors, 0, default);
        await Store.CompleteEmbedding(b.Caller, b.Document, fixture.Space, b.Vectors, 0, default);
        await using (var connection = new NpgsqlConnection(AiDatabaseFixture.Runtime))
        {
            await connection.OpenAsync();
            Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.knowledge_embeddings"));
            Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, $"SELECT count(*) FROM ai.knowledge_embeddings WHERE chunk_id = '{a.Chunks[0].Id}'"));
            // Not even through a distance calculation against another vector.
            Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, $"SELECT count(*) FROM (SELECT embedding <=> '{PostgresKnowledgeStore.Literal(a.Vectors[0].Vector)}'::vector FROM ai.knowledge_embeddings ORDER BY 1 LIMIT 5) nearest"));
        }
        Assert.Equal((long)a.Chunks.Count, await CountAs(a.Caller.SchoolId, "knowledge_embeddings"));
        Assert.Equal((long)b.Chunks.Count, await CountAs(b.Caller.SchoolId, "knowledge_embeddings"));
        // A nearest-neighbour query run for school A can only ever return chunks of school A.
        Assert.Equal(0, await fixture.Database.InSchool(a.Caller, (c, t, _) => AiDatabaseFixture.Scalar<long>(c,
            $"SELECT count(*) FROM (SELECT e.school_id FROM ai.knowledge_embeddings e ORDER BY e.embedding <=> '{PostgresKnowledgeStore.Literal(b.Vectors[0].Vector)}'::vector LIMIT 100) nearest WHERE school_id <> '{a.Caller.SchoolId}'", t)));
        var literal = PostgresKnowledgeStore.Literal(a.Vectors[0].Vector); var into = "INSERT INTO ai.knowledge_embeddings (school_id, chunk_id, space_id, dimension, embedding) VALUES";
        // School A cannot write a vector for school B, nor attach one of its own to a chunk of school B.
        await AiDatabaseFixture.Denied(() => RunAs(a.Caller.SchoolId, $"{into} ('{b.Caller.SchoolId}', '{b.Chunks[0].Id}', '{fixture.Space.Id}', {fixture.Space.Dimension}, '{literal}'::vector)"));
        // Taken alone, a row carrying A's own school passes row-level security; the reference to (school, chunk) is what refuses it.
        var unembedded = await Stored("foxtrot-two", b.Caller.SchoolId);
        await AiDatabaseFixture.Denied(() => RunAs(a.Caller.SchoolId, $"{into} ('{a.Caller.SchoolId}', '{unembedded.Chunks[0].Id}', '{fixture.Space.Id}', {fixture.Space.Dimension}, '{literal}'::vector)"), "23503");
        // Where B already has a vector for the chunk, the one-vector-per-chunk rule refuses it first.
        await AiDatabaseFixture.Denied(() => RunAs(a.Caller.SchoolId, $"{into} ('{a.Caller.SchoolId}', '{b.Chunks[0].Id}', '{fixture.Space.Id}', {fixture.Space.Dimension}, '{literal}'::vector)"), "23505");
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.knowledge_embeddings WHERE school_id = @s AND chunk_id = ANY(@c)", ("s", a.Caller.SchoolId), ("c", new[] { b.Chunks[0].Id, unembedded.Chunks[0].Id })));
        // Nor complete, fail or remove another school's document.
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.CompleteEmbedding(a.Caller, b.Document, fixture.Space, b.Vectors, 0, default));
        await Store.FailEmbedding(a.Caller, b.Document, "embedding-failed", default);
        Assert.Null(await Store.Chunks(a.Caller, b.Document, default));
        Assert.Equal(0, await RunAs(a.Caller.SchoolId, $"DELETE FROM ai.knowledge_embeddings WHERE chunk_id = '{b.Chunks[0].Id}'"));
        Assert.StartsWith("ready|", await State(b.Document));
        Assert.Equal(b.Chunks.Count, await Count("knowledge_embeddings", b.Caller.SchoolId));
    }

    [DatabaseFact]
    public async Task TheRuntimeAccountCanOnlyRecordTheEmbeddingOutcome()
    {
        var (caller, document, _, vectors) = await Stored("golf");
        await Store.CompleteEmbedding(caller, document, fixture.Space, vectors, 0, default);
        foreach (var sql in new[]
        {
            "UPDATE ai.knowledge_embeddings SET dimension = 1", "UPDATE ai.knowledge_embeddings SET embedding = embedding", "TRUNCATE ai.knowledge_embeddings",
            "INSERT INTO ai.embedding_spaces (provider, model, dimension) VALUES ('x', 'y', 3)", "UPDATE ai.embedding_spaces SET active = false", "DELETE FROM ai.embedding_spaces",
            "UPDATE ai.knowledge_documents SET title = 'x'", "UPDATE ai.knowledge_documents SET chunk_count = 1", "UPDATE ai.knowledge_documents SET uploaded_by = gen_random_uuid()",
            "ALTER TABLE ai.knowledge_embeddings DISABLE ROW LEVEL SECURITY", "DROP POLICY tenant_isolation ON ai.knowledge_embeddings", "CREATE INDEX mine ON ai.knowledge_embeddings (space_id)",
        })
        {
            var error = await Assert.ThrowsAsync<PostgresException>(() => RunAs(caller.SchoolId, sql));
            Assert.True(error.SqlState == "42501", sql + " -> " + error.SqlState);
        }
        // It may read the active space, and may not mark a document ready without one.
        Assert.Equal(1, await fixture.Database.InSchool(caller, (c, t, _) => AiDatabaseFixture.Scalar<long>(c, "SELECT count(*) FROM ai.embedding_spaces WHERE active", t)));
        await AiDatabaseFixture.Denied(() => RunAs(caller.SchoolId, "UPDATE ai.knowledge_documents SET status = 'ready', embedding_space_id = NULL"), "23514");
    }

    [DatabaseFact]
    public async Task AnUploadIsEmbeddedThroughTheRealDatabaseWithoutTouchingTheAllowance()
    {
        Guid school = Guid.NewGuid(), other = Guid.NewGuid();
        foreach (var id in new[] { school, other })
            await AiDatabaseFixture.AsOwner<int>("WITH x AS (INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES (@s, true, 500) RETURNING 1) SELECT count(*)::int FROM x", ("s", id));
        var provider = new RecordingEmbedding();
        await using var host = await AiHost.Start(true, new StubBootstrap(true, new(fixture.Space, null)), new() { ["Ai:Knowledge:ChunkMaxChars"] = "200", ["Ai:Knowledge:ChunkOverlapChars"] = "0", ["Ai:Knowledge:EmbeddingBatchSize"] = "4" },
            usage: new PostgresAiUsageStore(fixture.Database, TimeProvider.System), knowledge: Store, embedding: new GuardedEmbeddingProvider(provider, TimeSpan.FromSeconds(30)));
        var text = Encoding.UTF8.GetBytes(string.Join("\n\n", Enumerable.Range(1, 9).Select(i => $"Paragraph {i}, kestrel-anchor. " + string.Join(" ", Enumerable.Repeat("rule" + i, 22)) + ".")));
        var token = host.Token(school: school, permissions: "ai.knowledge.manage");
        var created = await host.Upload(token, "handbook.txt", text);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var data = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(await created.Content.ReadAsStringAsync()).GetProperty("data");
        Assert.Equal(("ready", 9), (data.GetProperty("status").GetString(), data.GetProperty("chunks").GetInt32()));
        Assert.Equal(new[] { 4, 4, 1 }, provider.Calls.Select(c => c.Count));
        Assert.Equal((9L, 9L, 0L), (await Count("knowledge_chunks", school), await Count("knowledge_embeddings", school), await Count("knowledge_embeddings", other)));
        Assert.StartsWith($"ready||{fixture.Space.Id}|", await State(data.GetProperty("id").GetGuid()));
        // Embedding again through the endpoint keeps one vector per chunk.
        Assert.Equal(HttpStatusCode.OK, (await host.Post(AiHost.Knowledge + "/" + data.GetProperty("id").GetGuid() + "/embedding", token, "")).StatusCode);
        Assert.Equal(9, await Count("knowledge_embeddings", school));
        // Nothing was metered or held: the school's assistant allowance is exactly as it was.
        Assert.Equal((0L, 0L), (await Count("usage_events", school), await Count("usage_reservations", school)));
        var usage = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token(school: school, permissions: "ai.usage.view")));
        Assert.Equal((0, 500), (usage.GetProperty("tokensUsed").GetInt64(), usage.GetProperty("tokensRemaining").GetInt64()));
        // The vector table holds no text of the document.
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.knowledge_embeddings e WHERE school_id = @s AND to_jsonb(e)::text ILIKE '%kestrel%'", ("s", school)));
    }
}

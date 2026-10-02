using System.Net;
using System.Text;
using System.Text.Json;
using EduOS.Ai.Gateway;
using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Npgsql;
using Xunit;

/// <summary>Nearest-neighbour search in real pgvector, as ai_app, with row-level security. Skipped without AI_TEST_DB_*.</summary>
public class AiRetrievalIntegrationTests(AiDatabaseFixture fixture) : IClassFixture<AiDatabaseFixture>
{
    PostgresKnowledgeStore Store => new(fixture.Database);
    static string P(string lead) => lead + " " + string.Join(" ", Enumerable.Repeat("lorem", (165 - lead.Length) / 6));
    static float[] About(string topic) => KeywordEmbedding.Vector(topic);
    static Task<long> Count(string table, Guid school) => AiDatabaseFixture.AsOwner<long>($"SELECT count(*) FROM ai.{table} WHERE school_id = @s", ("s", school));

    /// <summary>A stored document, one chunk per paragraph. With <paramref name="embed"/> it is ready in the active space.</summary>
    async Task<(TenantContext Caller, Guid Document, IReadOnlyList<StoredChunk> Chunks)> Document(Guid school, string title, string file, string[] audience, bool embed, params string[] paragraphs)
    {
        var caller = AiDatabaseFixture.Tenant(school); var text = KnowledgeNormalization.Normalize(string.Join("\n\n", paragraphs));
        var saved = await Store.Save(caller, new NewKnowledgeDocument(title, file, "text/plain", audience, text.Length, text.Length, KnowledgeNormalization.Hash(text)), KnowledgeChunker.Split(text, 200, 0, false), default);
        var chunks = (await Store.Chunks(caller, saved.Id, default))!;
        if (embed) await Store.CompleteEmbedding(caller, saved.Id, fixture.Space, chunks.Select(c => new ChunkVector(c.Id, KeywordEmbedding.Vector(c.Text))).ToList(), 0, default);
        return (caller, saved.Id, chunks);
    }
    Task<(TenantContext Caller, Guid Document, IReadOnlyList<StoredChunk> Chunks)> Handbook(Guid school, string marker) => Document(school, "Handbook " + marker, marker + "-handbook.txt", ["school", "teacher"], true,
        P($"Fees are due on the fifth; the fees office is {marker}."), P($"Fees for transport are billed together: fees and transport, {marker}."),
        P($"Transport routes change on Mondays for transport users, {marker}."), P($"Uniform rules apply to all pupils; the uniform shop is {marker}."));

    [DatabaseFact]
    public async Task TheNearestChunksComeBackInExactCosineOrderWithTheirSource()
    {
        var (caller, document, chunks) = await Handbook(Guid.NewGuid(), "alpha");
        var matches = await Store.Search(caller, fixture.Space, "school", About("fees"), 10, default);
        Assert.Equal(new[] { 0, 1, 2, 3 }, matches.Select(m => m.Ordinal));
        Assert.Equal(new[] { 1d, 0.707107, 0d, 0d }, matches.Select(m => Math.Round(m.Similarity, 6)));
        Assert.Equal((document, "Handbook alpha", "alpha-handbook.txt", chunks[0].Id, chunks[0].Text, (string?)null, (int?)null), (matches[0].DocumentId, matches[0].Title, matches[0].FileName, matches[0].ChunkId, matches[0].Text, matches[0].Section, matches[0].Page));
        Assert.Equal(new[] { 1, 0, 2, 3 }, (await Store.Search(caller, fixture.Space, "school", About("fees and transport"), 10, default)).Select(m => m.Ordinal));
        Assert.Equal(new[] { 2, 1 }, (await Store.Search(caller, fixture.Space, "school", About("transport"), 2, default)).Select(m => m.Ordinal));
        Assert.Equal(new[] { 3 }, (await Store.Search(caller, fixture.Space, "teacher", About("uniform"), 1, default)).Select(m => m.Ordinal));
        // The same order pgvector gives when asked directly, with no index involved.
        Assert.Equal("0,1,2,3", await AiDatabaseFixture.AsOwner<string>(
            "SELECT string_agg(k.ordinal::text, ',' ORDER BY e.embedding <=> @q::vector, k.ordinal) FROM ai.knowledge_embeddings e JOIN ai.knowledge_chunks k ON k.id = e.chunk_id WHERE e.school_id = @s",
            ("q", PostgresKnowledgeStore.Literal(About("fees"))), ("s", caller.SchoolId)));
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM pg_indexes WHERE schemaname = 'ai' AND (indexdef ILIKE '%hnsw%' OR indexdef ILIKE '%ivfflat%')"));
    }

    [DatabaseFact]
    public async Task EachSchoolSearchesOnlyItsOwnVectorsWhateverTheQuery()
    {
        var a = await Handbook(Guid.NewGuid(), "alpha"); var b = await Handbook(Guid.NewGuid(), "bravo");
        var forA = await Store.Search(a.Caller, fixture.Space, "school", About("fees"), 80, default);
        var forB = await Store.Search(b.Caller, fixture.Space, "school", About("fees"), 80, default);
        Assert.Equal(4, forA.Count); Assert.Equal(4, forB.Count);
        Assert.All(forA, m => Assert.Equal(a.Document, m.DocumentId)); Assert.All(forB, m => Assert.Equal(b.Document, m.DocumentId));
        // Nothing of the other school in any field: text, title, file label, document or chunk.
        var seenByA = JsonSerializer.Serialize(forA); var seenByB = JsonSerializer.Serialize(forB);
        Assert.DoesNotMatch($"bravo|{b.Document}|{b.Chunks[0].Id}", seenByA); Assert.DoesNotMatch($"alpha|{a.Document}|{a.Chunks[0].Id}", seenByB);
        // Even a query that is exactly the vector of another school's chunk finds only one's own chunks.
        var stolen = KeywordEmbedding.Vector(b.Chunks[1].Text);
        Assert.All(await Store.Search(a.Caller, fixture.Space, "school", stolen, 80, default), m => Assert.Equal(a.Document, m.DocumentId));

        // With the school filter left out of the query, row-level security still returns only the caller's rows.
        const string unfiltered = "SELECT count(*) FILTER (WHERE d.school_id <> ai.current_school()) || '/' || count(*) FROM (SELECT e.chunk_id FROM ai.knowledge_embeddings e ORDER BY e.embedding <=> '{0}'::vector LIMIT 1000) n JOIN ai.knowledge_chunks k ON k.id = n.chunk_id JOIN ai.knowledge_documents d ON d.id = k.document_id";
        Assert.Equal("0/4", await fixture.Database.InSchool(a.Caller, (c, t, _) => AiDatabaseFixture.Scalar<string>(c, string.Format(unfiltered, PostgresKnowledgeStore.Literal(stolen)), t)));
        Assert.Equal("0/4", await fixture.Database.InSchool(b.Caller, (c, t, _) => AiDatabaseFixture.Scalar<string>(c, string.Format(unfiltered, PostgresKnowledgeStore.Literal(stolen)), t)));
        // And with no school at all there is nothing to find.
        await using var connection = new NpgsqlConnection(AiDatabaseFixture.Runtime); await connection.OpenAsync();
        Assert.Equal("0/0", await AiDatabaseFixture.Scalar<string>(connection, string.Format(unfiltered, PostgresKnowledgeStore.Literal(stolen))));
        Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, $"SELECT count(*) FROM ai.knowledge_embeddings e JOIN ai.knowledge_chunks k ON k.id = e.chunk_id JOIN ai.knowledge_documents d ON d.id = k.document_id WHERE d.id IN ('{a.Document}', '{b.Document}')"));
        // The store has no way to search without a school.
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.Search(new TenantContext(EduOSTenants.Platform, Guid.NewGuid(), "SuperAdmin") { PlatformAuthority = true }, fixture.Space, "school", About("fees"), 10, default));
    }

    [DatabaseFact]
    public async Task OnlyReadyDocumentsOfTheActiveSpaceAddressedToTheReaderAreFound()
    {
        var school = Guid.NewGuid();
        var ready = await Document(school, "Ready", "ready.txt", ["school"], true, P("Fees are due on the fifth of the month, fees desk one."));
        var processing = await Document(school, "Processing", "processing.txt", ["school"], false, P("Fees are due on the sixth of the month, fees desk two."));
        var failed = await Document(school, "Failed", "failed.txt", ["school"], false, P("Fees are due on the seventh of the month, fees desk three."));
        await Store.FailEmbedding(failed.Caller, failed.Document, "embedding-failed", default);
        var parents = await Document(school, "Parents", "parents.txt", ["parent"], true, P("Fees letter for families: fees are due on the eighth."));
        // A document embedded with an earlier model: ready, but in a space that is no longer the active one.
        var old = await Document(school, "Old", "old.txt", ["school"], false, P("Fees are due on the ninth of the month, fees desk five."));
        var oldSpace = await AiDatabaseFixture.AsOwner<Guid>("INSERT INTO ai.embedding_spaces (provider, model, dimension) VALUES ('fake', @m, @d) RETURNING id", ("m", "retired-" + Guid.NewGuid()), ("d", fixture.Space.Dimension));
        await AiDatabaseFixture.AsOwner<int>("""
            WITH v AS (INSERT INTO ai.knowledge_embeddings (school_id, chunk_id, space_id, dimension, embedding) SELECT school_id, id, @space, @d, @q::vector FROM ai.knowledge_chunks WHERE document_id = @doc RETURNING 1),
                 u AS (UPDATE ai.knowledge_documents SET status = 'ready', embedding_space_id = @space WHERE id = @doc RETURNING 1)
            SELECT (SELECT count(*) FROM v)::int + (SELECT count(*) FROM u)::int
            """, ("space", oldSpace), ("d", fixture.Space.Dimension), ("q", PostgresKnowledgeStore.Literal(About("fees"))), ("doc", old.Document));

        Assert.Equal(new[] { ready.Document }, (await Store.Search(ready.Caller, fixture.Space, "school", About("fees"), 80, default)).Select(m => m.DocumentId));
        Assert.Equal(new[] { parents.Document }, (await Store.Search(ready.Caller, fixture.Space, "parent", About("fees"), 80, default)).Select(m => m.DocumentId));
        Assert.Empty(await Store.Search(ready.Caller, fixture.Space, "student", About("fees"), 80, default));
        Assert.Empty(await Store.Search(ready.Caller, fixture.Space, "everyone", About("fees"), 80, default));
        // Vectors of the two spaces are never mixed, whichever space is asked for.
        Assert.Equal(new[] { old.Document }, (await Store.Search(ready.Caller, new EmbeddingSpace(oldSpace, "fake", "retired", fixture.Space.Dimension), "school", About("fees"), 80, default)).Select(m => m.DocumentId));
        // Once the unfinished documents are embedded they are found too.
        foreach (var later in new[] { processing, failed })
            await Store.CompleteEmbedding(later.Caller, later.Document, fixture.Space, later.Chunks.Select(c => new ChunkVector(c.Id, KeywordEmbedding.Vector(c.Text))).ToList(), 0, default);
        Assert.Equal(new[] { ready.Document, processing.Document, failed.Document }.Order(), (await Store.Search(ready.Caller, fixture.Space, "school", About("fees"), 80, default)).Select(m => m.DocumentId).Order());
    }

    [DatabaseFact]
    public async Task AQueryOfAnotherDimensionIsNeverCompared()
    {
        var (caller, _, _) = await Handbook(Guid.NewGuid(), "charlie");
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.Search(caller, fixture.Space, "school", new float[fixture.Space.Dimension / 2], 10, default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.Search(caller, fixture.Space, "school", new float[fixture.Space.Dimension + 1], 10, default));
        // pgvector itself refuses to measure vectors of different sizes.
        var refused = await Assert.ThrowsAsync<PostgresException>(() => AiDatabaseFixture.AsOwner<double>("SELECT '[1,0]'::vector <=> '[1,0,0]'::vector"));
        Assert.Contains("different vector dimensions", refused.MessageText);
    }

    [DatabaseFact]
    public async Task RetrievalThroughTheServiceStaysInsideTheSchoolCallsNoModelAndChargesNothing()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        foreach (var school in new[] { a, b })
            await AiDatabaseFixture.AsOwner<int>("WITH x AS (INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES (@s, true, 500) RETURNING 1) SELECT count(*)::int FROM x", ("s", school));
        var embedding = new KeywordEmbedding(); var model = new RecordingModel();
        await using var host = await AiHost.Start(true, new StubBootstrap(true, new(fixture.Space, null)), new() { ["Ai:Knowledge:ChunkMaxChars"] = "200", ["Ai:Knowledge:ChunkOverlapChars"] = "0" },
            new GuardedModelProvider(model, TimeSpan.FromSeconds(30)), usage: new PostgresAiUsageStore(fixture.Database, TimeProvider.System), knowledge: Store, embedding: new GuardedEmbeddingProvider(embedding, TimeSpan.FromSeconds(30)));
        var tokenA = host.Token("Administrator", "school", a, permissions: "ai.knowledge.manage"); var tokenB = host.Token("Administrator", "school", b, permissions: "ai.knowledge.manage");
        string Text(string marker) => string.Join("\n\n", P($"Fees are due on the fifth; the fees office is {marker}."), P($"Transport routes change on Mondays for transport users, {marker}."));
        Assert.Equal(HttpStatusCode.Created, (await host.Upload(tokenA, "alpha-rules.txt", Encoding.UTF8.GetBytes(Text("heron-compass")), audience: "school", title: "Alpha rules")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await host.Upload(tokenB, "bravo-rules.txt", Encoding.UTF8.GetBytes(Text("kestrel-anchor")), audience: "school", title: "Bravo rules")).StatusCode);
        embedding.Calls.Clear();

        var response = await host.Post("/api/ai/knowledge/search", tokenA, JsonSerializer.Serialize(new { query = "What are the fees?", topK = 10, schoolId = a }));
        var body = await response.Content.ReadAsStringAsync();
        var result = Assert.Single((await AiGatewayTests.Data(response)).GetProperty("results").EnumerateArray());
        Assert.Equal(("Alpha rules", "alpha-rules.txt", 0, 1d), (result.GetProperty("title").GetString(), result.GetProperty("source").GetString(), result.GetProperty("ordinal").GetInt32(), result.GetProperty("similarity").GetDouble()));
        Assert.Contains("heron-compass", result.GetProperty("text").GetString());
        Assert.DoesNotMatch("(?i)kestrel-anchor|Bravo rules|bravo-rules|vector|embedding|" + b, body);
        var forB = Assert.Single((await AiGatewayTests.Data(await host.Post("/api/ai/knowledge/search", tokenB, JsonSerializer.Serialize(new { query = "What are the fees?" })))).GetProperty("results").EnumerateArray());
        Assert.Equal("Bravo rules", forB.GetProperty("title").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post("/api/ai/knowledge/search", tokenA, JsonSerializer.Serialize(new { query = "fees", schoolId = b }))).StatusCode);
        // The provider saw the questions only; no model was called; nothing was metered or held for either school.
        Assert.Equal(new[] { "What are the fees?", "What are the fees?" }, embedding.Calls.SelectMany(c => c));
        Assert.Empty(model.Requests);
        foreach (var school in new[] { a, b }) Assert.Equal((0L, 0L), (await Count("usage_events", school), await Count("usage_reservations", school)));
    }
}

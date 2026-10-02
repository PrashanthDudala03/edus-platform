using System.Net;
using System.Text;
using System.Text.Json;
using EduOS.Ai.Gateway;
using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using Xunit;

/// <summary>The fake chat provider itself, with a record of what it was sent.</summary>
public sealed class WatchedFakeModel : IModelProvider
{
    readonly FakeModelProvider inner = new();
    public List<ModelRequest> Requests { get; } = [];
    public ModelDescriptor Descriptor => inner.Descriptor;
    public Task<ModelResponse> Complete(ModelRequest request, CancellationToken cancellation)
    {
        lock (Requests) Requests.Add(request);
        return inner.Complete(request, cancellation);
    }
}

/// <summary>
/// The whole path against real PostgreSQL and pgvector, as ai_app: upload, chunks, vectors, retrieval, context,
/// fake model, answer, sources and metering, for two synthetic schools. Skipped without AI_TEST_DB_*.
/// </summary>
public class AiRagIntegrationTests(AiDatabaseFixture fixture) : IClassFixture<AiDatabaseFixture>
{
    const string Ask = "/api/ai/assistant/ask", Question = "What are the fees, zebra-quartz?";
    static string P(string lead) => lead + " " + string.Join(" ", Enumerable.Repeat("lorem", (165 - lead.Length) / 6));
    static string Rules(string marker) => string.Join("\n\n", P($"Fees are due on the fifth; the fees office is {marker}."), P($"Transport routes change on Mondays for transport users, {marker}."));
    static Task<long> Count(string table, Guid school) => AiDatabaseFixture.AsOwner<long>($"SELECT count(*) FROM ai.{table} WHERE school_id = @s", ("s", school));
    static readonly string Body = JsonSerializer.Serialize(new { question = Question });

    [DatabaseFact]
    public async Task ADocumentBecomesAGroundedAnswerForItsOwnSchoolAndNoOther()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        foreach (var school in new[] { a, b })
            await AiDatabaseFixture.AsOwner<int>("WITH x AS (INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES (@s, true, 100000) RETURNING 1) SELECT count(*)::int FROM x", ("s", school));
        var embedding = new KeywordEmbedding(); var model = new WatchedFakeModel();
        await using var host = await AiHost.Start(true, new StubBootstrap(true, new(fixture.Space, null)), new() { ["Ai:Knowledge:ChunkMaxChars"] = "200", ["Ai:Knowledge:ChunkOverlapChars"] = "0" },
            new GuardedModelProvider(model, TimeSpan.FromSeconds(30)), usage: new PostgresAiUsageStore(fixture.Database, TimeProvider.System), knowledge: new PostgresKnowledgeStore(fixture.Database),
            embedding: new GuardedEmbeddingProvider(embedding, TimeSpan.FromSeconds(30)));
        string Manager(Guid school) => host.Token("Administrator", "school", school, permissions: "ai.knowledge.manage");
        string Teacher(Guid school) => host.Token("Teacher", "teacher", school, permissions: "ai.assistant.use");
        async Task<Guid> Add(Guid school, string file, string title, string marker)
        {
            var response = await host.Upload(Manager(school), file, Encoding.UTF8.GetBytes(Rules(marker)), audience: "school,teacher", title: title);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            return JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync()).GetProperty("data").GetProperty("id").GetGuid();
        }
        async Task<(JsonElement Data, string Text)> Call(Guid school)
        {
            var response = await host.Post(Ask, Teacher(school), Body); var text = await response.Content.ReadAsStringAsync();
            return (await AiGatewayTests.Data(response), text);
        }

        var documentA = await Add(a, "alpha-rules.txt", "Alpha rules", "heron-compass");
        // School B has no knowledge yet. School A's is not used for it, and no model is called.
        var (nothing, nothingText) = await Call(b);
        Assert.Equal((false, "insufficient-knowledge"), (nothing.GetProperty("available").GetBoolean(), nothing.GetProperty("reason").GetString()));
        Assert.DoesNotMatch($"heron-compass|Alpha rules|alpha-rules|{documentA}", nothingText);
        Assert.Empty(model.Requests);
        var documentB = await Add(b, "bravo-rules.txt", "Bravo rules", "kestrel-anchor");

        // School A: its own chunk reaches the model, and the answer comes back with its own source.
        var (forA, textA) = await Call(a);
        var requestA = Assert.Single(model.Requests);
        Assert.Equal((true, "[fake] " + Question, "fake-chat-1"), (forA.GetProperty("available").GetBoolean(), forA.GetProperty("answer").GetString(), forA.GetProperty("model").GetString()));
        Assert.Equal((new ChatMessage(ChatRole.System, AiGateway.SystemPrompt), new ChatMessage(ChatRole.User, Question), 3), (requestA.Messages[0], requestA.Messages[2], requestA.Messages.Count));
        Assert.Contains("heron-compass", requestA.Messages[1].Content);
        Assert.StartsWith(RagContextBuilder.Preamble + "\n\n[source 1] title: Alpha rules\nFees are due on the fifth;", requestA.Messages[1].Content);
        Assert.DoesNotMatch($"kestrel-anchor|Bravo rules|Transport routes|{a}|{b}|{documentA}", string.Join("\n", requestA.Messages.Select(m => m.Content)));
        var sourceA = Assert.Single(forA.GetProperty("sources").EnumerateArray());
        Assert.Equal((1, documentA, "Alpha rules", "alpha-rules.txt"), (sourceA.GetProperty("number").GetInt32(), sourceA.GetProperty("documentId").GetGuid(), sourceA.GetProperty("title").GetString(), sourceA.GetProperty("source").GetString()));
        Assert.DoesNotMatch($"(?i)kestrel-anchor|Bravo rules|bravo-rules|vector|embedding|similarity|{documentB}|{a}|{b}", textA);

        // School B asks the same question and gets its own.
        var (forB, textB) = await Call(b);
        Assert.Equal(2, model.Requests.Count);
        Assert.Contains("kestrel-anchor", model.Requests[1].Messages[1].Content); Assert.DoesNotMatch("heron-compass|Alpha rules", model.Requests[1].Messages[1].Content);
        Assert.Equal(documentB, Assert.Single(forB.GetProperty("sources").EnumerateArray()).GetProperty("documentId").GetGuid());
        Assert.DoesNotMatch($"heron-compass|Alpha rules|alpha-rules|{documentA}", textB);
        // Nothing School B sends reaches School A's knowledge.
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post(Ask, Teacher(b), JsonSerializer.Serialize(new { question = Question, schoolId = a }))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post(Ask + "?schoolId=" + a, Teacher(b), Body)).StatusCode);
        var (stillB, _) = await Call(b);
        var widened = await AiGatewayTests.Data(await host.Post(Ask, Teacher(b), JsonSerializer.Serialize(new { question = Question, school = a, school_id = a, tenantId = a, documentId = documentA, documentIds = new[] { documentA }, audience = "school" })));
        Assert.All(new[] { stillB, widened }, data => Assert.Equal(documentB, Assert.Single(data.GetProperty("sources").EnumerateArray()).GetProperty("documentId").GetGuid()));
        Assert.All(model.Requests.Skip(1), r => Assert.DoesNotMatch("heron-compass|Alpha rules", r.Messages[1].Content));

        // Metered per school in the real database: one answered call for A with its one chunk, three for B, nothing held.
        var usage = forA.GetProperty("usage");
        Assert.Equal($"assistant.ask|fake|fake-chat-1|{usage.GetProperty("inputTokens").GetInt32()}|{usage.GetProperty("outputTokens").GetInt32()}|1|t", await AiDatabaseFixture.AsOwner<string>(
            "SELECT concat_ws('|', feature, provider, model, input_tokens, output_tokens, retrieved_chunks, success) FROM ai.usage_events WHERE school_id = @s", ("s", a)));
        Assert.Equal(requestA.Messages.Sum(m => AiTokens.Estimate(m.Content)), usage.GetProperty("inputTokens").GetInt32());
        Assert.Equal((1L, 3L, 0L, 0L), (await Count("usage_events", a), await Count("usage_events", b), await Count("usage_reservations", a), await Count("usage_reservations", b)));
        // Nothing stored about the calls holds the question, the answer or the evidence.
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.usage_events e WHERE school_id IN (@a, @b) AND to_jsonb(e)::text ~* 'zebra|fees|heron|kestrel|fake\\]'", ("a", a), ("b", b)));
        // The embedding provider was sent the documents' chunks and the five questions, nothing else.
        var embedded = embedding.Calls.SelectMany(c => c).ToList();
        Assert.Equal(5, embedded.Count(text => text == Question));
        Assert.All(embedded.Where(text => text != Question), text => Assert.Matches("^(Fees are due|Transport routes)", text));
    }
}

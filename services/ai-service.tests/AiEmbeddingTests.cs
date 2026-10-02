using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;
using Xunit;

/// <summary>
/// An embedding provider with the identity of the fake one that records what it was sent. The behaviour may
/// return another response or throw; null means "answer like the fake provider".
/// </summary>
public sealed class RecordingEmbedding(int dimension = 16, int maxBatch = 64, Func<IReadOnlyList<string>, int, EmbeddingResponse?>? behaviour = null) : IEmbeddingProvider
{
    readonly FakeEmbeddingProvider fake = new(dimension);
    public List<IReadOnlyList<string>> Calls { get; } = [];
    public EmbeddingDescriptor Descriptor { get; } = new("fake", "fake-embed-1", DataBoundary.Local, dimension, 512, maxBatch);

    public async Task<EmbeddingResponse> Embed(IReadOnlyList<string> texts, CancellationToken cancellation)
    {
        int call;
        lock (Calls) { Calls.Add(texts.ToList()); call = Calls.Count; }
        return behaviour?.Invoke(texts, call) ?? await fake.Embed(texts, cancellation);
    }
}

public class AiEmbeddingTests
{
    const string Manage = "ai.knowledge.manage", Marker = "ibis-harbour";
    // Nine paragraphs that each become one chunk at a chunk size of 200.
    static readonly byte[] Nine = Encoding.UTF8.GetBytes(string.Join("\n\n", Enumerable.Range(1, 9).Select(i => $"Paragraph {i} of the {Marker} handbook. " + string.Join(" ", Enumerable.Repeat("rule" + i, 22)) + ".")));
    static readonly Dictionary<string, string?> Small = new() { ["Ai:Knowledge:ChunkMaxChars"] = "200", ["Ai:Knowledge:ChunkOverlapChars"] = "0", ["Ai:Knowledge:EmbeddingBatchSize"] = "4" };
    static IEmbeddingProvider Guarded(IEmbeddingProvider provider) => new GuardedEmbeddingProvider(provider, TimeSpan.FromSeconds(30));
    static Task<AiHost> On(InMemoryKnowledgeStore store, IEmbeddingProvider? embedding = null, EmbeddingSpaceStatus? space = null, InMemoryUsageStore? usage = null, Dictionary<string, string?>? settings = null) =>
        AiGatewayTests.On(settings: settings ?? Small, usage: usage, knowledge: store, embedding: embedding, space: space);
    static async Task<JsonElement> Data(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"{(int)response.StatusCode}: {body}");
        return JsonSerializer.Deserialize<JsonElement>(body).GetProperty("data");
    }
    static string Retry(Guid id) => AiHost.Knowledge + "/" + id + "/embedding";
    static List<ChunkVector> Active(InMemoryKnowledgeStore store, Guid document, Guid? space = null) => store.Vectors[document].GetValueOrDefault(space ?? StubBootstrap.FakeSpace.Id) ?? [];

    [Fact]
    public async Task EveryChunkIsEmbeddedInBatchesAndOnlyThenIsTheDocumentReady()
    {
        var store = new InMemoryKnowledgeStore(); var provider = new RecordingEmbedding();
        await using var host = await On(store, Guarded(provider));
        var added = await Data(await host.Upload(host.Token(permissions: Manage), "handbook.md", Nine, "text/markdown", title: "Staff handbook"), HttpStatusCode.Created);
        Assert.Equal(("ready", (string?)null, 9), (added.GetProperty("status").GetString(), added.GetProperty("reason").GetString(), added.GetProperty("chunks").GetInt32()));
        var (school, user, id, _, chunks) = Assert.Single(store.Documents);
        Assert.Equal(new[] { 4, 4, 1 }, provider.Calls.Select(c => c.Count));
        // The provider was sent the chunk texts, in order, and nothing else.
        Assert.Equal(chunks.Select(c => c.Text), provider.Calls.SelectMany(c => c));
        var sent = string.Join("\n", provider.Calls.SelectMany(c => c));
        foreach (var secret in new[] { school.ToString(), user.ToString(), id.ToString(), "Staff handbook", "handbook.md", "teacher" }) Assert.DoesNotContain(secret, sent);
        // One vector per chunk, each of the dimension the provider declares, in the active space.
        var vectors = Active(store, id);
        Assert.Equal(9, vectors.Count); Assert.Equal(9, vectors.Select(v => v.ChunkId).Distinct().Count());
        Assert.All(vectors, v => Assert.Equal(provider.Descriptor.Dimension, v.Vector.Length));
        Assert.Equal(("ready", (Guid?)StubBootstrap.FakeSpace.Id, (string?)null), (store.States[id].Status, store.States[id].Space, store.States[id].Failure));
        Assert.Equal(chunks.Sum(c => AiTokens.Estimate(c.Text)), store.States[id].Tokens);
    }

    [Fact]
    public async Task TheBatchSizeNeverExceedsWhatTheProviderAccepts()
    {
        var store = new InMemoryKnowledgeStore(); var provider = new RecordingEmbedding(maxBatch: 2);
        await using var host = await On(store, Guarded(provider));
        Assert.Equal("ready", (await Data(await host.Upload(host.Token(permissions: Manage), "a.txt", Nine), HttpStatusCode.Created)).GetProperty("status").GetString());
        Assert.Equal(new[] { 2, 2, 2, 2, 1 }, provider.Calls.Select(c => c.Count));
    }

    [Theory]
    [InlineData("wrong-dimension", true)] [InlineData("wrong-dimension", false)] [InlineData("missing-vector", true)] [InlineData("missing-vector", false)]
    [InlineData("not-finite", true)] [InlineData("throws", true)] [InlineData("throws", false)] [InlineData("fails-in-last-batch", false)]
    public async Task ABadOrFailedEmbeddingLeavesTheDocumentStoredNotReadyAndWithoutVectors(string problem, bool guarded)
    {
        var store = new InMemoryKnowledgeStore();
        var provider = new RecordingEmbedding(behaviour: (texts, call) => problem switch
        {
            "wrong-dimension" => new EmbeddingResponse("fake", "fake-embed-1", texts.Select(_ => new float[8]).ToList(), null),
            "missing-vector" => new EmbeddingResponse("fake", "fake-embed-1", texts.Skip(1).Select(_ => new float[16]).ToList(), null),
            "not-finite" => new EmbeddingResponse("fake", "fake-embed-1", texts.Select(_ => Enumerable.Repeat(float.NaN, 16).ToArray()).ToList(), null),
            "throws" => throw new HttpRequestException("POST https://embed.internal.example/v1?key=sk-secret refused"),
            _ => call == 3 ? throw new TimeoutException("embed.internal.example") : null,
        });
        await using var host = await On(store, guarded ? Guarded(provider) : provider);
        var response = await host.Upload(host.Token(permissions: Manage), "a.txt", Nine);
        var text = await response.Content.ReadAsStringAsync();
        var data = await Data(response, HttpStatusCode.Created);
        Assert.Equal(("failed", "embedding-failed"), (data.GetProperty("status").GetString(), data.GetProperty("reason").GetString()));
        Assert.DoesNotMatch("internal\\.example|sk-secret|Exception|InvalidResponse", text);
        // The text is kept, nothing is searchable, and no vector of an earlier batch remains.
        var id = Assert.Single(store.Documents).Id;
        Assert.Equal(("failed", "embedding-failed"), (store.States[id].Status, store.States[id].Failure));
        Assert.Empty(Active(store, id));
        var listed = Assert.Single((await Data(await host.Get(AiHost.Knowledge, host.Token(permissions: Manage)))).GetProperty("documents").EnumerateArray());
        Assert.Equal("failed", listed.GetProperty("status").GetString());
    }

    [Fact]
    public async Task AFailedDocumentCanBeEmbeddedAgainAndRepeatingItNeverDuplicatesVectors()
    {
        var healthy = false; var store = new InMemoryKnowledgeStore();
        var provider = new RecordingEmbedding(behaviour: (_, call) => healthy || call < 2 ? null : throw new HttpRequestException("down"));
        await using var host = await On(store, Guarded(provider));
        var token = host.Token(permissions: Manage);
        var id = (await Data(await host.Upload(token, "a.txt", Nine), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        Assert.Equal("failed", store.States[id].Status); Assert.Empty(Active(store, id));
        // Still down: the same safe outcome, and still nothing stored.
        Assert.Equal(("failed", "embedding-failed"), ((await Data(await host.Post(Retry(id), token, ""))).GetProperty("status").GetString(), store.States[id].Failure));
        healthy = true;
        var retried = await Data(await host.Post(Retry(id), token, ""));
        Assert.Equal(("ready", (string?)null), (retried.GetProperty("status").GetString(), retried.GetProperty("reason").GetString()));
        Assert.Equal(9, Active(store, id).Count);
        var first = Active(store, id).Select(v => (v.ChunkId, Sum: v.Vector.Sum())).ToList();
        // Again, and by uploading the same text again: still one vector per chunk, with the same values.
        Assert.Equal("ready", (await Data(await host.Post(Retry(id), token, ""))).GetProperty("status").GetString());
        var again = await Data(await host.Upload(token, "copy.txt", Nine));
        Assert.Equal((true, id, "ready"), (again.GetProperty("duplicate").GetBoolean(), again.GetProperty("id").GetGuid(), again.GetProperty("status").GetString()));
        Assert.Equal(first, Active(store, id).Select(v => (v.ChunkId, Sum: v.Vector.Sum())));
        Assert.Single(store.Vectors[id]); Assert.Single(store.Documents);
    }

    [Fact]
    public async Task UploadingAFailedDocumentAgainEmbedsIt()
    {
        var healthy = false; var store = new InMemoryKnowledgeStore();
        var provider = new RecordingEmbedding(behaviour: (_, _) => healthy ? null : throw new HttpRequestException("down"));
        await using var host = await On(store, provider);
        var token = host.Token(permissions: Manage);
        var id = (await Data(await host.Upload(token, "a.txt", Nine), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        healthy = true;
        var again = await Data(await host.Upload(token, "a.txt", Nine));
        Assert.Equal((true, id, "ready"), (again.GetProperty("duplicate").GetBoolean(), again.GetProperty("id").GetGuid(), again.GetProperty("status").GetString()));
        Assert.Equal(9, Active(store, id).Count);
    }

    [Theory]
    [InlineData("mismatch")] [InlineData("other-dimension")] [InlineData("other-model")]
    public async Task AModelThatDoesNotMatchTheActiveSpaceIsNeverUsed(string problem)
    {
        var store = new InMemoryKnowledgeStore(); var provider = new RecordingEmbedding();
        var space = problem switch
        {
            "mismatch" => new EmbeddingSpaceStatus(null, "embedding-mismatch"),
            "other-dimension" => new EmbeddingSpaceStatus(new EmbeddingSpace(Guid.NewGuid(), "fake", "fake-embed-1", 32), null),
            _ => new EmbeddingSpaceStatus(new EmbeddingSpace(Guid.NewGuid(), "fake", "fake-embed-2", 16), null),
        };
        await using var host = await On(store, provider, space);
        var token = host.Token(permissions: Manage);
        var data = await Data(await host.Upload(token, "a.txt", Nine), HttpStatusCode.Created);
        Assert.Equal(("failed", "embedding-unavailable"), (data.GetProperty("status").GetString(), data.GetProperty("reason").GetString()));
        var id = data.GetProperty("id").GetGuid();
        Assert.Equal("embedding-unavailable", (await Data(await host.Post(Retry(id), token, ""))).GetProperty("reason").GetString());
        // The text is stored; the provider was never called and no vector exists.
        Assert.Single(store.Documents); Assert.Empty(provider.Calls); Assert.Empty(store.Vectors[id]);
    }

    [Fact]
    public async Task ADocumentEmbeddedInAnEarlierSpaceIsPendingUntilItIsEmbeddedInTheActiveOne()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        var id = (await Data(await host.Upload(token, "a.txt", Nine), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        // The deployment adopts a new model: another space becomes the active one.
        var next = new EmbeddingSpace(Guid.NewGuid(), "fake", "fake-embed-1", 16);
        host.Database.Embedding = new(next, null);
        Assert.Equal("pending", Assert.Single((await Data(await host.Get(AiHost.Knowledge, token))).GetProperty("documents").EnumerateArray()).GetProperty("status").GetString());
        Assert.Equal("ready", (await Data(await host.Post(Retry(id), token, ""))).GetProperty("status").GetString());
        Assert.Equal("ready", Assert.Single((await Data(await host.Get(AiHost.Knowledge, token))).GetProperty("documents").EnumerateArray()).GetProperty("status").GetString());
        // One vector per chunk in the active space; the old space's vectors are not mixed in.
        Assert.Equal((next.Id, 9, 9), (store.States[id].Space!.Value, Active(store, id, next.Id).Count, Active(store, id).Count));
    }

    [Fact]
    public async Task VectorsAndProviderDetailsNeverLeaveThroughTheApiOrTheLogs()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        var upload = await host.Upload(token, "a.txt", Nine);
        var id = (await Data(upload, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var bodies = new[] { await upload.Content.ReadAsStringAsync(), await (await host.Get(AiHost.Knowledge, token)).Content.ReadAsStringAsync(), await (await host.Post(Retry(id), token, "")).Content.ReadAsStringAsync() };
        foreach (var body in bodies)
        {
            Assert.DoesNotMatch("(?i)vector|embedding\"|space|dimension|fake-embed|-?0\\.\\d{4,}", body);
            Assert.DoesNotContain(Marker, body);
        }
        var listed = Assert.Single(JsonSerializer.Deserialize<JsonElement>(bodies[1]).GetProperty("data").GetProperty("documents").EnumerateArray());
        Assert.Equal(new[] { "audience", "bytes", "characters", "chunks", "createdAt", "fileName", "id", "mediaType", "status", "title" }, listed.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        // Logs carry counts and identifiers: no chunk text and no vector component.
        Assert.Contains(host.Logs, line => line.Contains($"Knowledge document {id} embedded: 9 chunks in 3 batches"));
        Assert.DoesNotContain(host.Logs, line => line.Contains(Marker) || line.Contains("rule1") || Regex.IsMatch(line, "-?0\\.\\d{5,}"));
    }

    [Fact]
    public async Task EmbeddingDoesNotTouchTheAssistantAllowance()
    {
        var store = new InMemoryKnowledgeStore(); var usage = new InMemoryUsageStore { Default = new() { Enabled = true, Budget = 300 } };
        await using var host = await On(store, usage: usage);
        Assert.Equal("ready", (await Data(await host.Upload(host.Token(permissions: Manage), "a.txt", Nine), HttpStatusCode.Created)).GetProperty("status").GetString());
        // Hundreds of tokens were embedded, yet nothing was metered or reserved against the 300-token allowance.
        Assert.True(store.States.Values.Single().Tokens > 300);
        Assert.Empty(usage.Records); Assert.Empty(usage.Reservations);
        // The allowance is exactly one answer's worst case, and it is still whole: neither the document nor the question's embedding took any of it.
        store.Evidence = InMemoryKnowledgeStore.Sample; usage.Default!.Budget = AiGatewayTests.Sent("When does the term start?").InputTokens + 256;
        var answer = await AiGatewayTests.Data(await host.Post("/api/ai/assistant/ask", host.Token(permissions: "ai.assistant.use"), "{\"question\":\"When does the term start?\"}"));
        Assert.True(answer.GetProperty("available").GetBoolean());
        Assert.Equal("assistant.ask", Assert.Single(usage.Records).Record.Feature);
    }

    [Fact]
    public async Task EmbeddingAgainNeedsThePermissionTheSchoolAndAnExistingDocument()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store, settings: new(Small) { ["Ai:Limits:UserRequestsPerMinute"] = "3" });
        var token = host.Token(permissions: Manage); var other = host.Token(school: Guid.NewGuid(), permissions: Manage);
        var id = (await Data(await host.Upload(token, "a.txt", Nine), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Post(Retry(id), null, "")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post(Retry(id), host.Token(permissions: "ai.assistant.use"), "")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post(Retry(id), host.Token("SuperAdmin", "platform", EduOSTenants.Platform, null, "platform.manage", Manage), "")).StatusCode);
        // Another school cannot embed, or even learn of, this document.
        Assert.Equal(HttpStatusCode.NotFound, (await host.Post(Retry(id), other, "")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.Post(Retry(Guid.NewGuid()), token, "")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post(Retry(id) + "?schoolId=" + Guid.NewGuid(), token, "")).StatusCode);
        Assert.Equal("ready", (await Data(await host.Post(Retry(id), token, ""))).GetProperty("status").GetString());
        Assert.Equal("rate-limited", (await Data(await host.Post(Retry(id), token, ""))).GetProperty("reason").GetString());
    }

    [Theory]
    [InlineData(null, "a", false, SpaceDecision.Activate)] [InlineData(null, "a", true, SpaceDecision.Activate)] [InlineData("a", "a", false, SpaceDecision.Use)] [InlineData("a", "a", true, SpaceDecision.Use)]
    [InlineData("a", "b", false, SpaceDecision.Mismatch)] [InlineData("a", "b", true, SpaceDecision.Activate)]
    public void TheActiveSpaceChangesOnlyWhenTheDeploymentAdoptsANewModel(string? active, string configured, bool adopt, SpaceDecision expected)
    {
        var spaces = new Dictionary<string, EmbeddingSpace> { ["a"] = new(Guid.NewGuid(), "fake", "model-a", 16), ["b"] = new(Guid.NewGuid(), "fake", "model-a", 32) };
        Assert.Equal(expected, EmbeddingSpaces.Decide(active is null ? null : spaces[active], spaces[configured], adopt));
        Assert.True(spaces["a"].Is(new EmbeddingDescriptor("fake", "model-a", DataBoundary.Local, 16, 512, 64)));
        Assert.False(spaces["a"].Is(new EmbeddingDescriptor("fake", "model-a", DataBoundary.Local, 32, 512, 64)));
        Assert.False(spaces["a"].Is(new EmbeddingDescriptor("other", "model-a", DataBoundary.Local, 16, 512, 64)));
    }

    [Theory]
    [InlineData("0")] [InlineData("257")]
    public async Task AnInvalidBatchSizeStopsTheServiceAtStart(string value) =>
        await Assert.ThrowsAsync<OptionsValidationException>(() => AiGatewayTests.On(settings: new() { ["Ai:Knowledge:EmbeddingBatchSize"] = value }));
}

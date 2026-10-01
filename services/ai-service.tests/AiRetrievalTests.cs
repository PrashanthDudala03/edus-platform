using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

/// <summary>
/// An embedding provider whose geometry a test can reason about: one axis per topic word, so a text about fees
/// and a question about fees point the same way. It has the identity of the fake provider.
/// </summary>
public sealed class KeywordEmbedding : IEmbeddingProvider
{
    public static readonly string[] Axes = ["fees", "transport", "uniform", "exam", "library", "sports", "canteen", "holiday"];
    public EmbeddingDescriptor Descriptor { get; } = new("fake", "fake-embed-1", DataBoundary.Local, 16, 512, 64);
    public List<IReadOnlyList<string>> Calls { get; } = [];
    /// <summary>When set, answers instead of the keyword geometry. It may throw or never complete.</summary>
    public Func<IReadOnlyList<string>, Task<EmbeddingResponse>>? Override;

    public static float[] Vector(string text)
    {
        var vector = new float[16];
        for (var i = 0; i < Axes.Length; i++) vector[i] = Regex.Matches(text, "\\b" + Axes[i], RegexOptions.IgnoreCase).Count;
        if (vector.All(v => v == 0)) vector[15] = 1;
        var length = MathF.Sqrt(vector.Sum(v => v * v));
        return vector.Select(v => v / length).ToArray();
    }

    public Task<EmbeddingResponse> Embed(IReadOnlyList<string> texts, CancellationToken cancellation)
    {
        lock (Calls) Calls.Add(texts.ToList());
        return Override?.Invoke(texts) ?? Task.FromResult(new EmbeddingResponse("fake", "fake-embed-1", texts.Select(Vector).ToList(), null));
    }
}

public class KnowledgeSelectionTests
{
    static readonly Guid One = Guid.Parse("00000000-0000-0000-0000-000000000001"), Two = Guid.Parse("00000000-0000-0000-0000-000000000002");
    static KnowledgeMatch Match(Guid document, int ordinal, double similarity, int start, int end, string? text = null) =>
        new(Guid.NewGuid(), document, "Title", "file.txt", ordinal, text ?? new string((char)('a' + ordinal), end - start), null, null, start, end, similarity);

    [Fact]
    public void ResultsFollowSimilarityThenDocumentAndOrderAndStopAtTheCount()
    {
        var candidates = new[] { Match(Two, 0, 0.7, 0, 100), Match(One, 3, 0.7, 300, 400), Match(One, 1, 0.9, 100, 200), Match(One, 2, 0.7, 200, 300), Match(One, 9, 0.95, 900, 1000) };
        var chosen = KnowledgeSelection.Select(candidates, 4, 0.5, 10_000);
        Assert.Equal(new[] { (One, 9), (One, 1), (One, 2), (One, 3) }, chosen.Select(c => (c.DocumentId, c.Ordinal)));
        Assert.Equal(chosen, KnowledgeSelection.Select(candidates.Reverse(), 4, 0.5, 10_000));
        Assert.Single(KnowledgeSelection.Select(candidates, 1, 0.5, 10_000));
    }

    [Fact]
    public void NothingBelowTheThresholdIsReturned()
    {
        var candidates = new[] { Match(One, 0, 0.81, 0, 100), Match(One, 1, 0.8, 100, 200), Match(One, 2, 0.7999, 200, 300), Match(One, 3, -0.2, 300, 400) };
        Assert.Equal(new[] { 0, 1 }, KnowledgeSelection.Select(candidates, 10, 0.8, 10_000).Select(c => c.Ordinal));
        Assert.Empty(KnowledgeSelection.Select(candidates, 10, 0.9, 10_000));
        Assert.Equal(4, KnowledgeSelection.Select(candidates, 10, -1, 10_000).Count);
    }

    [Fact]
    public void TheContextBudgetIsNeverExceededAndTextIsNeverCut()
    {
        var candidates = new[] { Match(One, 0, 0.9, 0, 400), Match(One, 1, 0.8, 400, 800), Match(One, 2, 0.7, 800, 900) };
        var chosen = KnowledgeSelection.Select(candidates, 10, 0.5, 799);
        // The second chunk does not fit, and selection stops there rather than reaching past it for a less relevant one.
        Assert.Equal(new[] { 0 }, chosen.Select(c => c.Ordinal));
        Assert.Equal(400, chosen[0].Text.Length);
        Assert.Equal(new[] { 0, 1 }, KnowledgeSelection.Select(candidates, 10, 0.5, 800).Select(c => c.Ordinal));
        Assert.Empty(KnowledgeSelection.Select(candidates, 10, 0.5, 399));
    }

    [Fact]
    public void RepeatedAndMostlyContainedChunksAreDroppedButNeighboursAreKept()
    {
        var candidates = new[]
        {
            Match(One, 0, 0.9, 0, 1000),
            Match(One, 1, 0.89, 850, 1850),              // a neighbour sharing only its overlap: kept
            Match(One, 2, 0.88, 400, 1100),              // more than half inside the first: dropped
            Match(Two, 0, 0.87, 0, 1000, new string('a', 1000)), // the same text in another document: dropped
            Match(Two, 1, 0.86, 400, 1100),              // same range, other document: kept
        };
        Assert.Equal(new[] { (One, 0), (One, 1), (Two, 1) }, KnowledgeSelection.Select(candidates, 10, 0.5, 100_000).Select(c => (c.DocumentId, c.Ordinal)));
    }
}

public class AiRetrievalTests
{
    const string Manage = "ai.knowledge.manage", Search = "/api/ai/knowledge/search", Marker = "ibis-harbour";
    static string P(string lead) => lead + " " + string.Join(" ", Enumerable.Repeat("lorem", (165 - lead.Length) / 6));
    static readonly string[] Paragraphs =
    [
        P($"Fees are due on the fifth; the fees office is {Marker}."), P("Fees for transport are billed together: fees and transport."),
        P("Transport routes change on Mondays for transport users."), P("Uniform rules apply to all pupils; the uniform shop opens Friday."),
    ];
    static readonly byte[] Handbook = Encoding.UTF8.GetBytes(string.Join("\n\n", Paragraphs));
    static Dictionary<string, string?> Settings(params (string Key, string Value)[] more) =>
        new Dictionary<string, string?> { ["Ai:Knowledge:ChunkMaxChars"] = "200", ["Ai:Knowledge:ChunkOverlapChars"] = "0" }.Concat(more.Select(m => new KeyValuePair<string, string?>(m.Key, m.Value))).ToDictionary();
    static string Query(string query, int? topK = null, string? audience = null) => JsonSerializer.Serialize(new { query, topK, audience });

    sealed record Setup(AiHost Host, InMemoryKnowledgeStore Store, KeywordEmbedding Embedding, RecordingModel Model, InMemoryUsageStore Usage, string Token) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Host.DisposeAsync();
        public async Task<JsonElement> Find(string query, int? topK = null, string? audience = null, string? token = null) => await AiGatewayTests.Data(await Host.Post(Search, token ?? Token, Query(query, topK, audience)));
        public async Task<Guid> Add(byte[] text, string name = "handbook.txt", string audience = "school,teacher", string? token = null, string? title = null)
        {
            var response = await Host.Upload(token ?? Token, name, text, audience: audience, title: title);
            return JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync()).GetProperty("data").GetProperty("id").GetGuid();
        }
    }
    static async Task<Setup> Start(Dictionary<string, string?>? settings = null, bool guarded = true, TimeSpan? timeout = null, EmbeddingSpaceStatus? space = null, bool upload = true)
    {
        var store = new InMemoryKnowledgeStore(); var embedding = new KeywordEmbedding(); var model = new RecordingModel(); var usage = new InMemoryUsageStore();
        var host = await AiGatewayTests.On(model, settings ?? Settings(), usage: usage, knowledge: store, space: space,
            embedding: guarded ? new GuardedEmbeddingProvider(embedding, timeout ?? TimeSpan.FromSeconds(30)) : embedding);
        var setup = new Setup(host, store, embedding, model, usage, host.Token("Administrator", "school", permissions: Manage));
        if (upload) await setup.Add(Handbook);
        return setup;
    }
    static IEnumerable<(int Ordinal, double Similarity)> Ranked(JsonElement data) => data.GetProperty("results").EnumerateArray().Select(r => (r.GetProperty("ordinal").GetInt32(), r.GetProperty("similarity").GetDouble()));

    [Fact]
    public async Task ChunksAreReturnedInOrderOfSimilarityWithWhatACitationNeeds()
    {
        await using var s = await Start();
        var data = await s.Find("What are the fees?");
        Assert.True(data.GetProperty("available").GetBoolean());
        // The chunk about fees alone, then the one about fees and transport; the others are not relevant enough.
        Assert.Equal(new[] { (0, 1d), (1, 0.7071) }, Ranked(data));
        var first = data.GetProperty("results")[0]; var (_, _, id, document, chunks) = Assert.Single(s.Store.Documents);
        Assert.Equal((id, "handbook", "handbook.txt", chunks[0].Text), (first.GetProperty("documentId").GetGuid(), first.GetProperty("title").GetString(), first.GetProperty("source").GetString(), first.GetProperty("text").GetString()));
        Assert.Equal(new[] { "chunkId", "documentId", "ordinal", "page", "section", "similarity", "source", "text", "title" }, first.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal((chunks[0].Text.Length + chunks[1].Text.Length, AiTokens.Estimate(chunks[0].Text) + AiTokens.Estimate(chunks[1].Text)), (data.GetProperty("characters").GetInt32(), data.GetProperty("tokens").GetInt32()));
        // A question about both topics ranks the chunk about both first; equal scores keep document order.
        Assert.Equal(new[] { 1, 0, 2 }, Ranked(await s.Find("fees and transport")).Select(r => r.Ordinal));
    }

    [Fact]
    public async Task AQuestionWithNothingRelevantReturnsNothingRatherThanTheNearestChunks()
    {
        await using var s = await Start();
        var data = await s.Find("When is sports day?");
        Assert.Equal((true, 0, 0), (data.GetProperty("available").GetBoolean(), data.GetProperty("results").GetArrayLength(), data.GetProperty("characters").GetInt32()));
        Assert.Equal(1, s.Store.Searches);
        await using var strict = await Start(Settings(("Ai:Retrieval:MinSimilarity", "0.9")));
        Assert.Equal(new[] { 0 }, Ranked(await strict.Find("fees")).Select(r => r.Ordinal));
        await using var loose = await Start(Settings(("Ai:Retrieval:MinSimilarity", "0")));
        Assert.Equal(4, (await loose.Find("fees")).GetProperty("results").GetArrayLength());
    }

    [Fact]
    public async Task TheNumberOfResultsIsBoundedByTheRequestTheDefaultAndAHardMaximum()
    {
        await using var s = await Start(Settings(("Ai:Retrieval:MinSimilarity", "0"), ("Ai:Retrieval:TopK", "3"), ("Ai:Retrieval:MaxTopK", "4")));
        Assert.Equal(3, (await s.Find("fees")).GetProperty("results").GetArrayLength());
        Assert.Equal(1, (await s.Find("fees", 1)).GetProperty("results").GetArrayLength());
        Assert.Equal(4, (await s.Find("fees", 4)).GetProperty("results").GetArrayLength());
        foreach (var topK in new[] { 0, -1, 5, 1000, int.MaxValue })
        {
            var response = await s.Host.Post(Search, s.Token, Query("fees", topK));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("between 1 and 4", await response.Content.ReadAsStringAsync());
        }
        Assert.Equal(3, s.Store.Searches);
    }

    [Theory]
    [InlineData("Ai:Retrieval:MaxTopK", "21")] [InlineData("Ai:Retrieval:MaxTopK", "0")] [InlineData("Ai:Retrieval:TopK", "11")] [InlineData("Ai:Retrieval:MinSimilarity", "1.5")]
    [InlineData("Ai:Retrieval:MaxQueryChars", "0")] [InlineData("Ai:Retrieval:MaxContextChars", "199")] [InlineData("Ai:Retrieval:MaxContextChars", "50000")]
    public async Task UnreasonableRetrievalLimitsStopTheServiceAtStart(string key, string value) =>
        await Assert.ThrowsAsync<OptionsValidationException>(() => Start(Settings((key, value)), upload: false));

    [Fact]
    public async Task TheContextBudgetBoundsTheTextReturned()
    {
        await using var s = await Start(Settings(("Ai:Retrieval:MaxContextChars", "330")));
        var data = await s.Find("fees and transport");
        // Three chunks are relevant; two fit in the budget.
        Assert.Equal(new[] { 1, 0 }, Ranked(data).Select(r => r.Ordinal));
        Assert.InRange(data.GetProperty("characters").GetInt32(), 1, 330);
        Assert.All(data.GetProperty("results").EnumerateArray(), r => Assert.Contains(r.GetProperty("text").GetString(), Paragraphs));
    }

    [Fact]
    public async Task TheSameParagraphInTwoDocumentsIsReturnedOnce()
    {
        await using var s = await Start();
        await s.Add(Encoding.UTF8.GetBytes(Paragraphs[0] + "\n\n" + P("Canteen menus are posted weekly in the canteen.")), "second.txt");
        var data = await s.Find("fees", 10);
        Assert.Equal(2, data.GetProperty("results").GetArrayLength());
        Assert.Single(data.GetProperty("results").EnumerateArray(), r => r.GetProperty("text").GetString() == Paragraphs[0]);
    }

    [Fact]
    public async Task OnlyReadyDocumentsOfTheActiveSpaceAreSearched()
    {
        await using var s = await Start();
        // A document whose embedding failed is stored but never retrieved.
        s.Embedding.Override = _ => throw new HttpRequestException("down");
        var failed = await s.Add(Encoding.UTF8.GetBytes(P("Fees, fees and more fees for the fees ledger.")), "failed.txt");
        s.Embedding.Override = null;
        Assert.Equal("failed", s.Store.States[failed].Status);
        var ready = s.Store.Documents[0].Id;
        Assert.All((await s.Find("fees", 10)).GetProperty("results").EnumerateArray(), r => Assert.Equal(ready, r.GetProperty("documentId").GetGuid()));
        // The deployment adopts another model: nothing embedded with the old one is searched.
        s.Host.Database.Embedding = new(new EmbeddingSpace(Guid.NewGuid(), "fake", "fake-embed-1", 16), null);
        Assert.Equal(0, (await s.Find("fees")).GetProperty("results").GetArrayLength());
        // Once a document is embedded in the new space it is found again, and only it.
        await s.Host.Post(AiHost.Knowledge + "/" + failed + "/embedding", s.Token, "");
        Assert.Equal(failed, Assert.Single((await s.Find("fees", 10)).GetProperty("results").EnumerateArray()).GetProperty("documentId").GetGuid());
    }

    [Theory]
    [InlineData("mismatch")] [InlineData("other-dimension")] [InlineData("other-model")]
    public async Task AModelThatDoesNotMatchTheActiveSpaceMeansNoSearchAtAll(string problem)
    {
        var space = problem switch
        {
            "mismatch" => new EmbeddingSpaceStatus(null, "embedding-mismatch"),
            "other-dimension" => new EmbeddingSpaceStatus(new EmbeddingSpace(Guid.NewGuid(), "fake", "fake-embed-1", 32), null),
            _ => new EmbeddingSpaceStatus(new EmbeddingSpace(Guid.NewGuid(), "fake", "fake-embed-2", 16), null),
        };
        await using var s = await Start(space: space, upload: false);
        var data = await s.Find("fees");
        Assert.Equal((false, "embedding-unavailable"), (data.GetProperty("available").GetBoolean(), data.GetProperty("reason").GetString()));
        Assert.Empty(s.Embedding.Calls); Assert.Equal(0, s.Store.Searches);
    }

    [Theory]
    [InlineData("wrong-dimension", true)] [InlineData("wrong-dimension", false)] [InlineData("two-vectors", true)] [InlineData("two-vectors", false)] [InlineData("no-vector", false)]
    [InlineData("not-finite", true)] [InlineData("not-finite", false)] [InlineData("zero-vector", true)] [InlineData("other-provider", true)]
    public async Task AMalformedQueryEmbeddingIsRefusedBeforeAnySearch(string problem, bool guarded)
    {
        await using var s = await Start(guarded: guarded);
        s.Embedding.Override = texts => Task.FromResult(problem switch
        {
            "wrong-dimension" => new EmbeddingResponse("fake", "fake-embed-1", [new float[8]], null),
            "two-vectors" => new EmbeddingResponse("fake", "fake-embed-1", [KeywordEmbedding.Vector("fees"), KeywordEmbedding.Vector("fees")], null),
            "no-vector" => new EmbeddingResponse("fake", "fake-embed-1", [], null),
            "not-finite" => new EmbeddingResponse("fake", "fake-embed-1", [Enumerable.Repeat(float.PositiveInfinity, 16).ToArray()], null),
            "zero-vector" => new EmbeddingResponse("fake", "fake-embed-1", [new float[16]], null),
            _ => new EmbeddingResponse("someone-else", "fake-embed-1", [KeywordEmbedding.Vector("fees")], null),
        });
        var data = await s.Find("fees");
        Assert.Equal((false, "provider-unavailable"), (data.GetProperty("available").GetBoolean(), data.GetProperty("reason").GetString()));
        Assert.Equal(0, s.Store.Searches);
    }

    [Fact]
    public async Task ProviderFailuresAndTimeoutsAreReportedSafely()
    {
        await using var s = await Start(timeout: TimeSpan.FromMilliseconds(80));
        s.Embedding.Override = _ => throw new HttpRequestException("POST https://embed.internal.example/v1?key=sk-secret refused");
        var failed = await s.Host.Post(Search, s.Token, Query("fees"));
        Assert.DoesNotMatch("internal\\.example|sk-secret|Exception", await failed.Content.ReadAsStringAsync());
        Assert.Equal("provider-unavailable", (await AiGatewayTests.Data(failed)).GetProperty("reason").GetString());
        s.Embedding.Override = _ => new TaskCompletionSource<EmbeddingResponse>().Task;
        Assert.Equal("provider-timeout", (await s.Find("fees")).GetProperty("reason").GetString());
        s.Embedding.Override = null; s.Store.FailReads = true;
        var down = await s.Host.Post(Search, s.Token, Query("fees"));
        Assert.DoesNotContain("internal.example", await down.Content.ReadAsStringAsync());
        Assert.Equal("database-unavailable", (await AiGatewayTests.Data(down)).GetProperty("reason").GetString());
        Assert.Equal(0, s.Store.Searches);
    }

    [Fact]
    public async Task TheProviderIsSentTheQuestionAndNothingElse()
    {
        await using var s = await Start();
        s.Embedding.Calls.Clear();
        await s.Find("  What are the fees?  ", audience: "teacher");
        Assert.Equal(new[] { "What are the fees?" }, Assert.Single(s.Embedding.Calls));
        var school = s.Host.School.ToString();
        Assert.DoesNotMatch($"{school}|teacher|Administrator|handbook", string.Join("\n", s.Embedding.Calls.SelectMany(c => c)));
    }

    [Fact]
    public async Task RetrievalCallsNoModelChargesNoQuotaAndLogsNoText()
    {
        await using var s = await Start();
        var response = await s.Host.Post(Search, s.Token, Query("What are the fees, zebra-quartz?"));
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(2, (await AiGatewayTests.Data(response)).GetProperty("results").GetArrayLength());
        Assert.Empty(s.Model.Requests); Assert.Empty(s.Usage.Records); Assert.Empty(s.Usage.Reservations);
        // The answer carries text and scores, never a vector, a space or a provider.
        Assert.DoesNotMatch("(?i)vector|embedding|space|dimension|fake-embed|schoolId|school_id", body);
        Assert.DoesNotContain(s.Host.School.ToString(), body);
        // The log has counts and timings. It has neither the question nor a chunk nor a vector component.
        Assert.Contains(s.Host.Logs, line => line.Contains("Knowledge retrieval: 2 of 4 candidates"));
        Assert.DoesNotContain(s.Host.Logs, line => line.Contains("zebra-quartz") || line.Contains(Marker) || line.Contains("lorem") || Regex.IsMatch(line, "0\\.7071|-?0\\.\\d{5,}"));
    }

    [Fact]
    public async Task EachSchoolRetrievesOnlyItsOwnKnowledge()
    {
        await using var s = await Start();
        var other = Guid.NewGuid(); var theirs = s.Host.Token("Administrator", "school", other, permissions: Manage);
        var theirDocument = await s.Add(Encoding.UTF8.GetBytes(P("Fees at the other school are paid termly: fees desk kestrel-anchor.")), "other-fees.txt", token: theirs, title: "Other school fees");
        var mine = await s.Host.Post(Search, s.Token, Query("fees", 10));
        var mineBody = await mine.Content.ReadAsStringAsync();
        Assert.Equal(new[] { 0, 1 }, Ranked(await AiGatewayTests.Data(mine)).Select(r => r.Ordinal));
        // Nothing of the other school: not its text, title, file name or document id.
        Assert.DoesNotMatch($"kestrel-anchor|Other school fees|other-fees|{theirDocument}", mineBody);
        var their = await s.Host.Post(Search, theirs, Query("fees", 10));
        var theirBody = await their.Content.ReadAsStringAsync();
        Assert.Equal(theirDocument, Assert.Single((await AiGatewayTests.Data(their)).GetProperty("results").EnumerateArray()).GetProperty("documentId").GetGuid());
        Assert.DoesNotMatch($"{Marker}|handbook", theirBody);
        // Naming the other school changes nothing but the status code.
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Host.Post(Search + "?schoolId=" + other, s.Token, Query("fees"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Host.Post(Search, s.Token, JsonSerializer.Serialize(new { query = "fees", schoolId = other }))).StatusCode);
        Assert.Equal(2, (await AiGatewayTests.Data(await s.Host.Post(Search, s.Token, JsonSerializer.Serialize(new { query = "fees", school = other, school_id = other, tenantId = other })))).GetProperty("results").GetArrayLength());
    }

    [Fact]
    public async Task OnlyDocumentsAddressedToTheReaderAreSearched()
    {
        await using var s = await Start(upload: false);
        await s.Add(Encoding.UTF8.GetBytes(P("Fees letter for families: fees are payable by the fifth.")), "parents.txt", "parent");
        // The caller is school staff; the document is for parents.
        Assert.Equal(0, (await s.Find("fees")).GetProperty("results").GetArrayLength());
        Assert.Equal(1, (await s.Find("fees", audience: "parent")).GetProperty("results").GetArrayLength());
        Assert.Equal(0, (await s.Find("fees", audience: "student")).GetProperty("results").GetArrayLength());
        foreach (var audience in new[] { "everyone", "platform", "*", "parent,student" })
            Assert.Equal(HttpStatusCode.BadRequest, (await s.Host.Post(Search, s.Token, Query("fees", audience: audience))).StatusCode);
        // The retriever itself refuses a reader it does not know, and the platform, before doing anything.
        var retriever = s.Host.Services.GetRequiredService<KnowledgeRetriever>(); var calls = s.Embedding.Calls.Count; var searches = s.Store.Searches;
        Assert.Equal("not-permitted", (await retriever.Retrieve(new TenantContext(s.Host.School, Guid.NewGuid(), "Teacher"), "everyone", "fees", null, default)).Unavailable);
        Assert.Equal("not-permitted", (await retriever.Retrieve(new TenantContext(EduOSTenants.Platform, Guid.NewGuid(), "SuperAdmin") { PlatformAuthority = true }, "school", "fees", null, default)).Unavailable);
        Assert.Equal((calls, searches), (s.Embedding.Calls.Count, s.Store.Searches));
        Assert.Single((await retriever.Retrieve(new TenantContext(s.Host.School, Guid.NewGuid(), "Parent"), "parent", "fees", null, default)).Chunks);
    }

    [Fact]
    public async Task TheDiagnosticSearchNeedsThePermissionAndASchool()
    {
        await using var s = await Start();
        var calls = s.Embedding.Calls.Count;
        Assert.Equal(HttpStatusCode.Unauthorized, (await s.Host.Post(Search, null, Query("fees"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Host.Post(Search, s.Host.Token("Teacher", "teacher", permissions: ["ai.assistant.use", "ai.usage.view"]), Query("fees"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Host.Post(Search, s.Host.Token("SuperAdmin", "platform", EduOSTenants.Platform, null, "platform.manage", "ai.platform.manage", Manage), Query("fees"))).StatusCode);
        foreach (var body in new[] { "{}", "{\"query\":\"  \"}", "{\"query\":null}", Query(new string('q', 1001)), "not json" })
            Assert.Equal(HttpStatusCode.BadRequest, (await s.Host.Post(Search, s.Token, body)).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await s.Host.Post(Search, s.Token, Query(new string('q', AiService.MaxBodyBytes)))).StatusCode);
        Assert.Equal((calls, 0), (s.Embedding.Calls.Count, s.Store.Searches));
    }

    [Fact]
    public async Task RetrievalFollowsTheSwitchesAndTheRateLimit()
    {
        var usage = new InMemoryUsageStore { Default = new() { Enabled = false } }; var store = new InMemoryKnowledgeStore(); var embedding = new KeywordEmbedding();
        await using (var off = await AiHost.Start(false, new StubBootstrap(true), knowledge: store, embedding: embedding))
            Assert.Equal("not-configured", (await AiGatewayTests.Data(await off.Post(Search, off.Token(permissions: Manage), Query("fees")))).GetProperty("reason").GetString());
        await using (var disabled = await AiGatewayTests.On(usage: usage, knowledge: store, embedding: embedding))
            Assert.Equal("school-disabled", (await AiGatewayTests.Data(await disabled.Post(Search, disabled.Token(permissions: Manage), Query("fees")))).GetProperty("reason").GetString());
        Assert.Empty(embedding.Calls); Assert.Equal(0, store.Searches);
        await using var s = await Start(Settings(("Ai:Limits:UserRequestsPerMinute", "3")));
        await s.Find("fees"); await s.Find("fees");
        var limited = await s.Find("fees");
        Assert.Equal("rate-limited", limited.GetProperty("reason").GetString());
        Assert.Equal(2, s.Store.Searches);
    }
}

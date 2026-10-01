using System.Reflection;
using EduOS.Ai.Providers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

public class AiProviderTests
{
    static readonly TimeSpan Generous = TimeSpan.FromSeconds(30);
    static ModelRequest Ask(string text, int maxOutput = 32) => new([new ChatMessage(ChatRole.System, "Answer briefly."), new ChatMessage(ChatRole.User, text)], maxOutput);

    sealed class StubModel(Func<ModelRequest, CancellationToken, Task<ModelResponse>> behaviour, bool reportsUsage = true) : IModelProvider
    {
        public int Calls;
        public ModelDescriptor Descriptor { get; } = new("stub", "stub-1", DataBoundary.External, new ModelCapabilities(100, 50, reportsUsage));
        public Task<ModelResponse> Complete(ModelRequest request, CancellationToken cancellation) { Calls++; return behaviour(request, cancellation); }
    }
    sealed class StubEmbedding(Func<IReadOnlyList<string>, EmbeddingResponse> behaviour, int dimension = 3) : IEmbeddingProvider
    {
        public int Calls;
        public EmbeddingDescriptor Descriptor { get; } = new("stub", "stub-embed", DataBoundary.Local, dimension, 20, 2);
        public Task<EmbeddingResponse> Embed(IReadOnlyList<string> texts, CancellationToken cancellation) { Calls++; return Task.FromResult(behaviour(texts)); }
    }
    static ModelResponse Reply(string text = "ok", TokenUsage? usage = null, string provider = "stub", string model = "stub-1") => new(provider, model, text, FinishReason.Completed, usage);

    [Fact]
    public async Task FakeChatIsDeterministicLocalAndReportsUsage()
    {
        var provider = new GuardedModelProvider(new FakeModelProvider(), Generous);
        var first = await provider.Complete(Ask("What is the fee due date?"), default);
        var second = await provider.Complete(Ask("What is the fee due date?"), default);
        Assert.Equal(first with { Latency = default }, second with { Latency = default });
        Assert.Equal("[fake] What is the fee due date?", first.Text);
        Assert.Equal(("fake", "fake-chat-1", FinishReason.Completed), (first.Provider, first.Model, first.Finish));
        Assert.Equal(new TokenUsage(AiTokens.Estimate("Answer briefly.") + AiTokens.Estimate("What is the fee due date?"), AiTokens.Estimate(first.Text), false), first.Usage);
        Assert.Equal(DataBoundary.Local, provider.Descriptor.Boundary);
    }

    [Fact]
    public async Task OutputLimitIsHonoured()
    {
        var response = await new GuardedModelProvider(new FakeModelProvider(), Generous).Complete(Ask(new string('x', 400), 5), default);
        Assert.Equal(FinishReason.Length, response.Finish);
        Assert.True(response.Usage!.OutputTokens <= 5);
    }

    [Theory]
    [InlineData("empty")] [InlineData("blank")] [InlineData("no-limit")] [InlineData("limit-above-model")] [InlineData("context-too-large")] [InlineData("temperature")]
    public async Task InvalidRequestsNeverReachTheProvider(string problem)
    {
        var stub = new StubModel((_, _) => Task.FromResult(Reply()));
        var request = problem switch
        {
            "empty" => new ModelRequest([], 10),
            "blank" => new ModelRequest([new ChatMessage(ChatRole.User, "  ")], 10),
            "no-limit" => Ask("hello", 0),
            "limit-above-model" => Ask("hello", 51),
            "context-too-large" => Ask(new string('x', 401), 10),
            _ => Ask("hello", 10) with { Temperature = double.NaN },
        };
        await Assert.ThrowsAsync<ArgumentException>(() => new GuardedModelProvider(stub, Generous).Complete(request, default));
        Assert.Equal(0, stub.Calls);
    }

    [Fact]
    public async Task AProviderThatNeverAnswersTimesOutEvenIfItIgnoresCancellation()
    {
        var stub = new StubModel((_, _) => new TaskCompletionSource<ModelResponse>().Task);
        var error = await Assert.ThrowsAsync<AiProviderException>(() => new GuardedModelProvider(stub, TimeSpan.FromMilliseconds(50)).Complete(Ask("hello"), default));
        Assert.Equal((AiProviderError.Timeout, "stub"), (error.Error, error.Provider));
    }

    [Fact]
    public async Task CallerCancellationIsNotReportedAsAProviderFailure()
    {
        using var caller = new CancellationTokenSource();
        var stub = new StubModel(async (_, token) => { await Task.Delay(Timeout.Infinite, token); return Reply(); });
        var call = new GuardedModelProvider(stub, Generous).Complete(Ask("hello"), caller.Token);
        caller.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
    }

    [Fact]
    public async Task ProviderErrorsAreMappedWithoutLeakingTheirDetails()
    {
        var stub = new StubModel((_, _) => throw new HttpRequestException("POST https://models.internal.example/v1?key=sk-secret failed"));
        var error = await Assert.ThrowsAsync<AiProviderException>(() => new GuardedModelProvider(stub, Generous).Complete(Ask("hello"), default));
        Assert.Equal(AiProviderError.Unavailable, error.Error);
        Assert.Equal("AI provider 'stub' failed: Unavailable.", error.Message);
        Assert.IsType<HttpRequestException>(error.InnerException);
    }

    [Fact]
    public async Task UsageIsEstimatedOnlyWhenTheProviderReportsNone()
    {
        var silent = await new GuardedModelProvider(new StubModel((_, _) => Task.FromResult(Reply("four")), false), Generous).Complete(Ask("hello there"), default);
        Assert.Equal(new TokenUsage(AiTokens.Estimate("Answer briefly.") + AiTokens.Estimate("hello there"), 1, true), silent.Usage);
        var reported = await new GuardedModelProvider(new StubModel((_, _) => Task.FromResult(Reply("four", new TokenUsage(7, 3, false)))), Generous).Complete(Ask("hello there"), default);
        Assert.Equal(new TokenUsage(7, 3, false), reported.Usage);
    }

    [Theory]
    [InlineData("other-provider")] [InlineData("no-model")] [InlineData("negative-usage")] [InlineData("null-text")]
    public async Task MalformedResponsesAreRejected(string problem)
    {
        var reply = problem switch
        {
            "other-provider" => Reply(provider: "someone-else"),
            "no-model" => Reply(model: " "),
            "negative-usage" => Reply(usage: new TokenUsage(-1, 0, false)),
            _ => Reply() with { Text = null! },
        };
        var error = await Assert.ThrowsAsync<AiProviderException>(() => new GuardedModelProvider(new StubModel((_, _) => Task.FromResult(reply)), Generous).Complete(Ask("hello"), default));
        Assert.Equal(AiProviderError.InvalidResponse, error.Error);
    }

    [Theory]
    [InlineData(8)] [InlineData(16)] [InlineData(384)]
    public async Task FakeEmbeddingsAreDeterministicUnitVectorsOfTheConfiguredDimension(int dimension)
    {
        var provider = new GuardedEmbeddingProvider(new FakeEmbeddingProvider(dimension), Generous);
        var first = await provider.Embed(["school fees", "exam timetable"], default);
        var second = await provider.Embed(["school fees", "exam timetable"], default);
        Assert.Equal(dimension, provider.Descriptor.Dimension);
        Assert.All(first.Vectors, vector => { Assert.Equal(dimension, vector.Length); Assert.InRange(MathF.Sqrt(vector.Sum(v => v * v)), 0.999f, 1.001f); });
        Assert.Equal(first.Vectors[0], second.Vectors[0]);
        Assert.NotEqual(first.Vectors[0], first.Vectors[1]);
        Assert.Equal(new TokenUsage(AiTokens.Estimate("school fees") + AiTokens.Estimate("exam timetable"), 0, false), first.Usage);
    }

    [Theory]
    [InlineData("none")] [InlineData("too-many")] [InlineData("blank")] [InlineData("too-long")]
    public async Task InvalidEmbeddingBatchesNeverReachTheProvider(string problem)
    {
        var stub = new StubEmbedding(texts => new EmbeddingResponse("stub", "stub-embed", texts.Select(_ => new float[3]).ToList(), null));
        IReadOnlyList<string> texts = problem switch { "none" => [], "too-many" => ["a", "b", "c"], "blank" => ["a", " "], _ => [new string('x', 81)] };
        await Assert.ThrowsAsync<ArgumentException>(() => new GuardedEmbeddingProvider(stub, Generous).Embed(texts, default));
        Assert.Equal(0, stub.Calls);
    }

    [Theory]
    [InlineData("wrong-dimension")] [InlineData("wrong-count")] [InlineData("not-finite")] [InlineData("other-provider")]
    public async Task VectorsThatDoNotMatchTheDescriptorAreRejected(string problem)
    {
        var stub = new StubEmbedding(texts => problem switch
        {
            "wrong-dimension" => new EmbeddingResponse("stub", "stub-embed", texts.Select(_ => new float[4]).ToList(), null),
            "wrong-count" => new EmbeddingResponse("stub", "stub-embed", [new float[3]], null),
            "not-finite" => new EmbeddingResponse("stub", "stub-embed", texts.Select(_ => new[] { 0f, float.NaN, 0f }).ToList(), null),
            _ => new EmbeddingResponse("else", "stub-embed", texts.Select(_ => new float[3]).ToList(), null),
        });
        var error = await Assert.ThrowsAsync<AiProviderException>(() => new GuardedEmbeddingProvider(stub, Generous).Embed(["a", "b"], default));
        Assert.Equal(AiProviderError.InvalidResponse, error.Error);
    }

    [Fact]
    public async Task EmbeddingUsageIsEstimatedWhenNotReported()
    {
        var stub = new StubEmbedding(texts => new EmbeddingResponse("stub", "stub-embed", texts.Select(_ => new float[3]).ToList(), null));
        Assert.Equal(new TokenUsage(AiTokens.Estimate("school fees"), 0, true), (await new GuardedEmbeddingProvider(stub, Generous).Embed(["school fees"], default)).Usage);
    }

    [Fact]
    public async Task TheServiceResolvesGuardedFakeProvidersByDefault()
    {
        await using var host = await AiHost.Start();
        Assert.IsType<GuardedModelProvider>(host.Services.GetRequiredService<IModelProvider>());
        Assert.IsType<GuardedEmbeddingProvider>(host.Services.GetRequiredService<IEmbeddingProvider>());
        Assert.Equal(("fake", DataBoundary.Local), (host.Services.GetRequiredService<IModelProvider>().Descriptor.Provider, host.Services.GetRequiredService<IModelProvider>().Descriptor.Boundary));
        Assert.Equal("fake", host.Services.GetRequiredService<IEmbeddingProvider>().Descriptor.Provider);
    }

    [Theory]
    [InlineData("Ai:Providers:Chat", "huggingface", "Ai:Providers:Chat 'huggingface' is not a known chat provider")]
    [InlineData("Ai:Providers:Embedding", "", "Ai:Providers:Embedding '' is not a known embedding provider")]
    [InlineData("Ai:Providers:Chat", "FAKE", "is not a known chat provider")]
    [InlineData("Ai:Providers:TimeoutSeconds", "0", "TimeoutSeconds must be between 1 and 120")]
    [InlineData("Ai:Providers:TimeoutSeconds", "600", "TimeoutSeconds must be between 1 and 120")]
    public async Task AMisconfiguredProviderStopsTheServiceAtStart(string key, string value, string expected)
    {
        var error = await Assert.ThrowsAsync<OptionsValidationException>(() => AiHost.Start(settings: new() { [key] = value }));
        Assert.Contains(expected, error.Message);
    }

    // Rules S2 and S9: nothing in a provider contract can carry a school, a user or a credential.
    [Fact]
    public void ContractsCarryNoIdentityOrCredentials()
    {
        var members = typeof(IModelProvider).Assembly.GetTypes().Where(t => t.Namespace == "EduOS.Ai.Providers" && t.IsPublic)
            .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static).Select(p => t.Name + "." + p.Name)).ToList();
        Assert.Contains("ModelRequest.Messages", members);
        Assert.DoesNotContain(members, m => System.Text.RegularExpressions.Regex.IsMatch(m, "(?i)school|tenant|user(id|name)|apikey|secret|password|authorization|credential"));
    }
}

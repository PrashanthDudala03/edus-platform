using System.Net;
using System.Text.Json;
using EduOS.Ai.Gateway;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

/// <summary>A clock that moves only when a test says so. It starts at the beginning of the current minute.</summary>
public sealed class ManualClock : TimeProvider
{
    DateTimeOffset now = new(DateTimeOffset.UtcNow.Ticks / TimeSpan.TicksPerMinute * TimeSpan.TicksPerMinute, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => now;
    public void Advance(int seconds) => now = now.AddSeconds(seconds);
}

public class AiProtectionTests
{
    const string Ask = "/api/ai/assistant/ask", Use = "ai.assistant.use";
    static readonly string Valid = JsonSerializer.Serialize(new { question = "When does the term start?" });
    static TenantContext Caller(Guid school, Guid? user = null) => new(school, user ?? Guid.NewGuid(), "Teacher");
    static IOptions<AiLimitsOptions> Limits(int user = 10, int school = 300, int threshold = 5, int recovery = 30) =>
        Options.Create(new AiLimitsOptions { UserRequestsPerMinute = user, SchoolRequestsPerMinute = school, ProviderFailureThreshold = threshold, ProviderRecoverySeconds = recovery });
    static Dictionary<string, string?> Settings(int user = 10, int school = 300, int threshold = 5, int recovery = 30) => new()
    {
        ["Ai:Limits:UserRequestsPerMinute"] = user.ToString(), ["Ai:Limits:SchoolRequestsPerMinute"] = school.ToString(),
        ["Ai:Limits:ProviderFailureThreshold"] = threshold.ToString(), ["Ai:Limits:ProviderRecoverySeconds"] = recovery.ToString(),
    };
    static AiCircuitBreaker Breaker(ManualClock clock, int threshold = 3, int recovery = 30) => new(clock, Limits(threshold: threshold, recovery: recovery), NullLogger<AiCircuitBreaker>.Instance);

    [Fact]
    public void RequestsWithinTheLimitAreAdmittedAndTheNextWaitsForTheWindow()
    {
        var clock = new ManualClock(); var limiter = new AiRateLimiter(clock, Limits(user: 3)); var caller = Caller(Guid.NewGuid());
        Assert.Equal(new[] { 0, 0, 0, 60 }, Enumerable.Range(0, 4).Select(_ => limiter.Admit(caller)));
        clock.Advance(20); Assert.Equal(40, limiter.Admit(caller));
        clock.Advance(40); Assert.Equal(0, limiter.Admit(caller));
    }

    [Fact]
    public void UsersAndSchoolsAreLimitedSeparatelyAndARefusalCountsAgainstNeither()
    {
        var limiter = new AiRateLimiter(new ManualClock(), Limits(user: 2, school: 3));
        Guid schoolX = Guid.NewGuid(), schoolY = Guid.NewGuid(); var a = Caller(schoolX);
        Assert.Equal(0, limiter.Admit(a)); Assert.Equal(0, limiter.Admit(a));
        // The user limit stops A. Had the refusals been counted, the school would now be full as well.
        Assert.NotEqual(0, limiter.Admit(a)); Assert.NotEqual(0, limiter.Admit(a));
        Assert.Equal(0, limiter.Admit(Caller(schoolX)));
        // The school limit stops a third user of X, while another school is unaffected.
        Assert.NotEqual(0, limiter.Admit(Caller(schoolX)));
        Assert.Equal(0, limiter.Admit(Caller(schoolY)));
        // The same user id in another school is a different identity only through the school limit.
        Assert.NotEqual(0, limiter.Admit(a with { SchoolId = schoolY }));
    }

    [Fact]
    public void TrackedStateIsLimitedToTheCurrentWindow()
    {
        var clock = new ManualClock(); var limiter = new AiRateLimiter(clock, Limits()); var school = Guid.NewGuid();
        for (var i = 0; i < 50; i++) limiter.Admit(Caller(school));
        Assert.Equal(51, limiter.Tracked);
        clock.Advance(60); limiter.Admit(Caller(school));
        Assert.Equal(2, limiter.Tracked);
    }

    [Fact]
    public void TheCircuitStaysClosedWhileCallsSucceedAndASuccessResetsTheCount()
    {
        var breaker = Breaker(new ManualClock());
        breaker.Succeeded("p"); breaker.Failed("p"); breaker.Failed("p"); breaker.Succeeded("p"); breaker.Failed("p"); breaker.Failed("p");
        Assert.False(breaker.IsOpen("p")); Assert.True(breaker.Allow("p"));
    }

    [Fact]
    public void TheCircuitOpensAtTheThresholdAndAllowsOneTrialAfterTheInterval()
    {
        var clock = new ManualClock(); var breaker = Breaker(clock);
        breaker.Failed("p"); breaker.Failed("p"); Assert.True(breaker.Allow("p"));
        breaker.Failed("p");
        Assert.True(breaker.IsOpen("p")); Assert.False(breaker.Allow("p"));
        Assert.True(breaker.Allow("other")); Assert.False(breaker.IsOpen("other"));
        clock.Advance(29); Assert.False(breaker.Allow("p"));
        clock.Advance(1); Assert.False(breaker.IsOpen("p"));
        // One caller gets the trial; the next still fails fast until the trial reports back.
        Assert.True(breaker.Allow("p")); Assert.False(breaker.Allow("p"));
        breaker.Succeeded("p");
        Assert.True(breaker.Allow("p")); Assert.True(breaker.Allow("p")); Assert.False(breaker.IsOpen("p"));
    }

    [Fact]
    public void AFailedTrialReopensTheCircuitForAFullInterval()
    {
        var clock = new ManualClock(); var breaker = Breaker(clock, threshold: 1);
        breaker.Failed("p"); clock.Advance(30);
        Assert.True(breaker.Allow("p")); breaker.Failed("p");
        Assert.True(breaker.IsOpen("p"));
        clock.Advance(29); Assert.False(breaker.Allow("p"));
        clock.Advance(1); Assert.True(breaker.Allow("p"));
    }

    [Fact]
    public async Task ARateLimitedCallerIsToldToWaitAndTheProviderIsNotCalled()
    {
        var model = new RecordingModel(); var clock = new ManualClock();
        await using var host = await AiGatewayTests.On(model, Settings(user: 2), clock: clock);
        var caller = host.Token(permissions: Use);
        await AiGatewayTests.Data(await host.Post(Ask, caller, Valid)); await AiGatewayTests.Data(await host.Post(Ask, caller, Valid));
        clock.Advance(15);
        var limited = await AiGatewayTests.Data(await host.Post(Ask, caller, Valid));
        Assert.Equal((false, "rate-limited", 45), (limited.GetProperty("available").GetBoolean(), limited.GetProperty("reason").GetString(), limited.GetProperty("retryAfterSeconds").GetInt32()));
        Assert.Equal(new[] { "available", "reason", "retryAfterSeconds" }, limited.EnumerateObject().Select(p => p.Name).Order());
        Assert.Equal(2, model.Requests.Count);
        // Another user of the same school, and a user of another school, are not affected.
        Assert.True((await AiGatewayTests.Data(await host.Post(Ask, host.Token(permissions: Use), Valid))).GetProperty("available").GetBoolean());
        Assert.True((await AiGatewayTests.Data(await host.Post(Ask, host.Token(school: Guid.NewGuid(), permissions: Use), Valid))).GetProperty("available").GetBoolean());
        clock.Advance(45);
        Assert.True((await AiGatewayTests.Data(await host.Post(Ask, caller, Valid))).GetProperty("available").GetBoolean());
        Assert.Equal(5, model.Requests.Count);
    }

    [Fact]
    public async Task TheSchoolLimitAppliesAcrossItsUsers()
    {
        var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, Settings(school: 2), clock: new ManualClock());
        for (var i = 0; i < 2; i++) Assert.True((await AiGatewayTests.Data(await host.Post(Ask, host.Token(permissions: Use), Valid))).GetProperty("available").GetBoolean());
        Assert.Equal("rate-limited", (await AiGatewayTests.Data(await host.Post(Ask, host.Token(permissions: Use), Valid))).GetProperty("reason").GetString());
        Assert.Equal(2, model.Requests.Count);
    }

    [Fact]
    public async Task InvalidRequestsCountTowardsTheLimitSoTheyCannotBeUsedToFloodTheService()
    {
        var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, Settings(user: 2), clock: new ManualClock());
        var caller = host.Token(permissions: Use);
        for (var i = 0; i < 2; i++) Assert.Equal(HttpStatusCode.BadRequest, (await host.Post(Ask, caller, "{\"question\":\" \"}")).StatusCode);
        Assert.Equal("rate-limited", (await AiGatewayTests.Data(await host.Post(Ask, caller, Valid))).GetProperty("reason").GetString());
        Assert.Empty(model.Requests);
    }

    [Fact]
    public async Task TheCircuitOpensAfterRepeatedProviderFailuresFailsFastAndRecovers()
    {
        var healthy = false; var clock = new ManualClock();
        var model = new RecordingModel((_, _) => healthy ? Task.FromResult(new ModelResponse("recording", "recording-1", "Back.", FinishReason.Completed, new TokenUsage(5, 1, false))) : throw new HttpRequestException("https://models.internal.example refused"));
        await using var host = await AiGatewayTests.On(model, Settings(threshold: 2, recovery: 30), clock: clock);
        async Task<JsonElement> Call() => await AiGatewayTests.Data(await host.Post(Ask, host.Token(permissions: Use), Valid));
        async Task<JsonElement> Status() => await AiGatewayTests.Data(await host.Get("/api/ai/status", host.Token(permissions: Use)));

        Assert.Equal("provider-unavailable", (await Call()).GetProperty("reason").GetString());
        Assert.True((await Status()).GetProperty("enabled").GetBoolean());
        Assert.Equal("provider-unavailable", (await Call()).GetProperty("reason").GetString());
        Assert.Equal(2, model.Requests.Count);

        // Open: callers get the same safe answer, the provider is left alone, and status says so.
        var open = await host.Post(Ask, host.Token(permissions: Use), Valid);
        Assert.DoesNotMatch("circuit|internal\\.example|recording|HttpRequestException", await open.Content.ReadAsStringAsync());
        Assert.Equal("provider-unavailable", (await AiGatewayTests.Data(open)).GetProperty("reason").GetString());
        clock.Advance(29);
        Assert.Equal("provider-unavailable", (await Call()).GetProperty("reason").GetString());
        Assert.Equal((false, "provider-unavailable"), ((await Status()).GetProperty("enabled").GetBoolean(), (await Status()).GetProperty("reason").GetString()));
        Assert.Equal(2, model.Requests.Count);
        Assert.Contains(host.Logs, line => line.Contains("AI provider recording circuit is open for 30s"));

        // After the interval one call goes through; its success closes the circuit.
        clock.Advance(1); healthy = true;
        Assert.Equal("Back.", (await Call()).GetProperty("answer").GetString());
        Assert.True((await Call()).GetProperty("available").GetBoolean());
        Assert.Equal(4, model.Requests.Count);
        Assert.True((await Status()).GetProperty("enabled").GetBoolean());
    }

    [Fact]
    public async Task TimeoutsCountAsProviderFailures()
    {
        var model = new RecordingModel((_, _) => new TaskCompletionSource<ModelResponse>().Task);
        await using var host = await AiGatewayTests.On(model, Settings(threshold: 1), TimeSpan.FromMilliseconds(50), new ManualClock());
        Assert.Equal("provider-timeout", (await AiGatewayTests.Data(await host.Post(Ask, host.Token(permissions: Use), Valid))).GetProperty("reason").GetString());
        Assert.Equal("provider-unavailable", (await AiGatewayTests.Data(await host.Post(Ask, host.Token(permissions: Use), Valid))).GetProperty("reason").GetString());
        Assert.Single(model.Requests);
    }

    [Fact]
    public async Task RejectedRequestsNeverTripTheCircuit()
    {
        // With a threshold of one, a single counted failure would open the circuit.
        var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, Settings(user: 2, threshold: 1), clock: new ManualClock());
        var caller = host.Token(permissions: Use);
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Post(Ask, null, Valid)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post(Ask, host.Token(), Valid)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Post(Ask, host.Token("SuperAdmin", "platform", EduOSTenants.Platform, null, "platform.manage", Use), Valid)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await host.Post(Ask, caller, "{}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await host.Post(Ask, caller, JsonSerializer.Serialize(new { question = "ok", maxOutputTokens = 9999 }))).StatusCode);
        Assert.Equal("rate-limited", (await AiGatewayTests.Data(await host.Post(Ask, caller, Valid))).GetProperty("reason").GetString());
        Assert.Empty(model.Requests);
        Assert.True((await AiGatewayTests.Data(await host.Get("/api/ai/status", caller))).GetProperty("enabled").GetBoolean());
        Assert.True((await AiGatewayTests.Data(await host.Post(Ask, host.Token(permissions: Use), Valid))).GetProperty("available").GetBoolean());
        Assert.Single(model.Requests);
    }

    [Theory]
    [InlineData("Ai:Limits:UserRequestsPerMinute", "0")] [InlineData("Ai:Limits:SchoolRequestsPerMinute", "-1")]
    [InlineData("Ai:Limits:ProviderFailureThreshold", "0")] [InlineData("Ai:Limits:ProviderRecoverySeconds", "99999")]
    public async Task InvalidLimitsStopTheServiceAtStart(string key, string value) =>
        await Assert.ThrowsAsync<OptionsValidationException>(() => AiGatewayTests.On(settings: new() { [key] = value }));
}

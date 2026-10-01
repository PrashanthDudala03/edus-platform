using System.Net;
using System.Text.Json;
using EduOS.Ai.Gateway;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

/// <summary>The store's rules without a database. Schools not listed use <see cref="Default"/>; set it to null for "no settings row".</summary>
public sealed class InMemoryUsageStore : IAiUsageStore
{
    public sealed class School { public bool Enabled = true; public long Budget = 10_000_000; }
    readonly object gate = new();
    public Dictionary<Guid, School> Schools { get; } = [];
    public School? Default { get; set; } = new();
    public List<(Guid School, Guid User, AiUsageRecord Record)> Records { get; } = [];
    public Dictionary<Guid, (Guid School, int Tokens)> Reservations { get; } = [];
    public bool FailReads, FailWrites;

    School? For(Guid school) => Schools.TryGetValue(school, out var known) ? known : Default;
    long Used(Guid school) => Records.Where(r => r.School == school && r.Record.Success).Sum(r => (long)r.Record.InputTokens + r.Record.OutputTokens);
    long Reserved(Guid school) => Reservations.Values.Where(r => r.School == school).Sum(r => (long)r.Tokens);

    public Task<AiReservation> Reserve(TenantContext tenant, int tokens, TimeSpan hold, CancellationToken cancellation)
    {
        if (FailReads) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate)
        {
            if (For(tenant.SchoolId) is not { Enabled: true } school) return Task.FromResult(new AiReservation(AiAdmission.SchoolDisabled));
            if (Used(tenant.SchoolId) + Reserved(tenant.SchoolId) + tokens > school.Budget) return Task.FromResult(new AiReservation(AiAdmission.QuotaExceeded));
            var id = Guid.NewGuid(); Reservations[id] = (tenant.SchoolId, tokens);
            return Task.FromResult(new AiReservation(AiAdmission.Granted, id));
        }
    }

    public Task Settle(TenantContext tenant, Guid reservation, AiUsageRecord? record, CancellationToken cancellation)
    {
        if (FailWrites) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate) { Reservations.Remove(reservation); if (record is not null) Records.Add((tenant.SchoolId, tenant.UserId, record)); }
        return Task.CompletedTask;
    }

    public Task<AiUsageSummary> Summary(TenantContext tenant, CancellationToken cancellation)
    {
        if (FailReads) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate)
        {
            var school = For(tenant.SchoolId); var mine = Records.Where(r => r.School == tenant.SchoolId).ToList();
            return Task.FromResult(new AiUsageSummary(school?.Enabled ?? false, school?.Budget ?? 0, Used(tenant.SchoolId), Reserved(tenant.SchoolId), mine.Count(r => r.Record.Success), mine.Count(r => !r.Record.Success), default));
        }
    }
}

public class AiUsageTests
{
    const string Ask = "/api/ai/assistant/ask", Use = "ai.assistant.use", Question = "When does the term start, zebra-quartz?";
    static readonly string Valid = JsonSerializer.Serialize(new { question = Question });
    static readonly int Input = AiGatewayTests.Sent(Question).InputTokens;
    static readonly int WorstCase = Input + 256;
    static async Task<JsonElement> Call(AiHost host, string? token = null) => await AiGatewayTests.Data(await host.Post(Ask, token ?? host.Token(permissions: Use), Valid));
    static async Task<JsonElement> Status(AiHost host) => await AiGatewayTests.Data(await host.Get("/api/ai/status", host.Token(permissions: Use)));

    [Fact]
    public async Task AnEnabledSchoolWithAllowanceIsAnsweredAndTheCallIsRecorded()
    {
        var store = new InMemoryUsageStore(); var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, usage: store);
        Assert.True((await Call(host)).GetProperty("available").GetBoolean());
        var (school, _, record) = Assert.Single(store.Records);
        Assert.Equal(host.School, school);
        Assert.Equal(new AiUsageRecord("assistant.ask", "recording", "recording-1", 11, 3, false, record.LatencyMs, true, RetrievedChunks: 1), record);
        Assert.Empty(store.Reservations);
        Assert.True((await Status(host)).GetProperty("enabled").GetBoolean());
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task ASchoolThatIsSwitchedOffOrHasNoSettingsGetsNoModelCall(bool noSettingsRow)
    {
        var store = new InMemoryUsageStore { Default = noSettingsRow ? null : new() { Enabled = false } }; var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, usage: store);
        var data = await Call(host);
        Assert.Equal((false, "school-disabled"), (data.GetProperty("available").GetBoolean(), data.GetProperty("reason").GetString()));
        Assert.Equal("school-disabled", (await Status(host)).GetProperty("reason").GetString());
        Assert.Empty(model.Requests); Assert.Empty(store.Records); Assert.Empty(store.Reservations);
    }

    [Fact]
    public async Task AnExhaustedAllowanceGetsNoModelCallAndTheLastRequestMustFitInFull()
    {
        var store = new InMemoryUsageStore { Default = new() { Budget = WorstCase - 1 } }; var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, usage: store);
        Assert.Equal("quota-exceeded", (await Call(host)).GetProperty("reason").GetString());
        Assert.Empty(model.Requests); Assert.Empty(store.Records); Assert.Empty(store.Reservations);
        // With exactly enough for the worst case the call goes through, and only what was really used is charged.
        store.Default!.Budget = WorstCase;
        Assert.True((await Call(host)).GetProperty("available").GetBoolean());
        var usage = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token(permissions: "ai.usage.view")));
        Assert.Equal((14, WorstCase - 14, 0), (usage.GetProperty("tokensUsed").GetInt64(), usage.GetProperty("tokensRemaining").GetInt64(), usage.GetProperty("tokensReserved").GetInt64()));
        // A spent allowance is reported by status as well.
        store.Default.Budget = 14;
        Assert.Equal("quota-exceeded", (await Status(host)).GetProperty("reason").GetString());
        Assert.Equal("quota-exceeded", (await Call(host)).GetProperty("reason").GetString());
        Assert.Single(model.Requests);
    }

    [Theory]
    [InlineData(false, "provider-unavailable", "Unavailable")] [InlineData(true, "provider-timeout", "Timeout")]
    public async Task AFailedProviderAttemptIsRecordedButNotCharged(bool timeout, string reason, string code)
    {
        var store = new InMemoryUsageStore();
        var model = new RecordingModel((_, _) => timeout ? new TaskCompletionSource<ModelResponse>().Task : throw new HttpRequestException("refused"));
        await using var host = await AiGatewayTests.On(model, usage: store, timeout: TimeSpan.FromMilliseconds(50));
        Assert.Equal(reason, (await Call(host)).GetProperty("reason").GetString());
        var record = Assert.Single(store.Records).Record;
        Assert.Equal(new AiUsageRecord("assistant.ask", "recording", "recording-1", Input, 0, true, record.LatencyMs, false, code, RetrievedChunks: 1), record);
        Assert.Empty(store.Reservations);
        var usage = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token(permissions: "ai.usage.view")));
        Assert.Equal((0, 0, 1), (usage.GetProperty("tokensUsed").GetInt64(), usage.GetProperty("calls").GetInt64(), usage.GetProperty("failedCalls").GetInt64()));
    }

    [Fact]
    public async Task ReportedAndEstimatedUsageAreToldApart()
    {
        var store = new InMemoryUsageStore();
        await using var reporting = await AiGatewayTests.On(usage: store);
        await Call(reporting);
        var silent = new RecordingModel((_, _) => Task.FromResult(new ModelResponse("recording", "recording-1", "Four words in reply.", FinishReason.Completed, null)));
        await using var estimating = await AiGatewayTests.On(silent, usage: store);
        await Call(estimating);
        Assert.Equal(new[] { false, true }, store.Records.Select(r => r.Record.Estimated));
        Assert.Equal((Input, AiTokens.Estimate("Four words in reply.")), (store.Records[1].Record.InputTokens, store.Records[1].Record.OutputTokens));
        Assert.Equal("fake", store.Records[0].Record.Provider);
    }

    [Fact]
    public async Task SchoolsAreSwitchedMeteredAndReportedSeparately()
    {
        var store = new InMemoryUsageStore(); var model = new RecordingModel(); var other = Guid.NewGuid();
        await using var host = await AiGatewayTests.On(model, usage: store);
        store.Schools[host.School] = new() { Enabled = false };
        Assert.Equal("school-disabled", (await Call(host)).GetProperty("reason").GetString());
        Assert.True((await Call(host, host.Token(school: other, permissions: Use))).GetProperty("available").GetBoolean());
        Assert.Equal(other, Assert.Single(store.Records).School);
        // Each school sees only its own figures, whatever it sends.
        var mine = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token(permissions: "ai.usage.view")));
        var theirs = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token(school: other, permissions: "ai.usage.view")));
        Assert.Equal((false, 0, 0), (mine.GetProperty("enabled").GetBoolean(), mine.GetProperty("tokensUsed").GetInt64(), mine.GetProperty("calls").GetInt64()));
        Assert.Equal((true, 14, 1), (theirs.GetProperty("enabled").GetBoolean(), theirs.GetProperty("tokensUsed").GetInt64(), theirs.GetProperty("calls").GetInt64()));
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Get("/api/ai/usage?schoolId=" + other, host.Token(permissions: "ai.usage.view"))).StatusCode);
    }

    [Fact]
    public async Task SimultaneousRequestsCannotSpendTheSameAllowance()
    {
        var release = new TaskCompletionSource();
        var model = new RecordingModel(async (_, _) => { await release.Task; return new ModelResponse("recording", "recording-1", "Done.", FinishReason.Completed, new TokenUsage(11, 3, false)); });
        // Room for two calls in progress, not three.
        var store = new InMemoryUsageStore { Default = new() { Budget = WorstCase * 2 + WorstCase / 2 } };
        await using var host = await AiGatewayTests.On(model, usage: store);
        var calls = Enumerable.Range(0, 8).Select(_ => Call(host)).ToList();
        var refused = new List<JsonElement>();
        while (refused.Count < 6) { var done = await Task.WhenAny(calls); calls.Remove(done); refused.Add(await done); }
        Assert.All(refused, data => Assert.Equal("quota-exceeded", data.GetProperty("reason").GetString()));
        Assert.Equal(2, model.Requests.Count); Assert.Equal(2, store.Reservations.Count);
        release.SetResult();
        Assert.All(await Task.WhenAll(calls), data => Assert.True(data.GetProperty("available").GetBoolean()));
        Assert.Equal(2, store.Records.Count); Assert.Empty(store.Reservations);
    }

    [Fact]
    public async Task WhenTheUsageStateCannotBeReadTheRequestIsRefusedWithoutAModelCall()
    {
        var store = new InMemoryUsageStore { FailReads = true }; var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, usage: store);
        var response = await host.Post(Ask, host.Token(permissions: Use), Valid);
        Assert.DoesNotContain("internal.example", await response.Content.ReadAsStringAsync());
        Assert.Equal("database-unavailable", (await AiGatewayTests.Data(response)).GetProperty("reason").GetString());
        Assert.Equal("database-unavailable", (await Status(host)).GetProperty("reason").GetString());
        var usage = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token(permissions: "ai.usage.view")));
        Assert.Equal((false, "database-unavailable"), (usage.GetProperty("available").GetBoolean(), usage.GetProperty("reason").GetString()));
        Assert.Empty(model.Requests);
        Assert.Equal(HttpStatusCode.OK, (await host.Get("/api/ai/health", null)).StatusCode);
    }

    [Fact]
    public async Task AnAnswerWhoseUsageCannotBeRecordedIsNotReturned()
    {
        var store = new InMemoryUsageStore { FailWrites = true }; var model = new RecordingModel();
        await using var host = await AiGatewayTests.On(model, usage: store);
        var response = await host.Post(Ask, host.Token(permissions: Use), Valid);
        Assert.DoesNotContain("The answer.", await response.Content.ReadAsStringAsync());
        Assert.Equal("database-unavailable", (await AiGatewayTests.Data(response)).GetProperty("reason").GetString());
        Assert.Single(model.Requests);
        // The tokens are in the log for reconciliation; the question and the answer are not.
        Assert.Contains(host.Logs, line => line.Contains("AI usage was not recorded") && line.Contains("11 input and 3 output tokens"));
        Assert.DoesNotContain(host.Logs, line => line.Contains("zebra-quartz") || line.Contains("The answer."));
    }

    [Fact]
    public async Task ACancelledCallReleasesItsReservationAndRecordsNothing()
    {
        var store = new InMemoryUsageStore();
        var model = new RecordingModel(async (_, token) => { await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException(); });
        await using var host = await AiGatewayTests.On(model, usage: store);
        using var caller = new CancellationTokenSource();
        var call = host.Services.GetRequiredService<AiGateway>().Ask(new TenantContext(host.School, Guid.NewGuid(), "Teacher"), "teacher", new AssistantAsk(Question), caller.Token);
        while (store.Reservations.Count == 0) await Task.Delay(5);
        caller.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
        Assert.Empty(store.Reservations); Assert.Empty(store.Records);
    }

    [Fact]
    public async Task UsageNeedsItsOwnPermissionAndNeverServesThePlatform()
    {
        await using var host = await AiGatewayTests.On();
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Get("/api/ai/usage", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Get("/api/ai/usage", host.Token(permissions: Use))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Get("/api/ai/usage", host.Token("SuperAdmin", "platform", EduOSTenants.Platform, null, "platform.manage", "ai.usage.view"))).StatusCode);
        var data = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token("Administrator", "school", permissions: "ai.usage.view")));
        Assert.Equal(new[] { "available", "calls", "enabled", "failedCalls", "monthStart", "monthlyTokenBudget", "tokensRemaining", "tokensReserved", "tokensUsed" }, data.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task NothingStoredAboutACallContainsTheQuestionOrTheAnswer()
    {
        var store = new InMemoryUsageStore();
        await using var host = await AiGatewayTests.On(usage: store);
        await Call(host);
        var stored = JsonSerializer.Serialize(store.Records.Select(r => r.Record));
        Assert.DoesNotContain("zebra-quartz", stored); Assert.DoesNotContain("[fake]", stored);
        Assert.Equal(new[] { "ErrorCode", "Estimated", "Feature", "InputTokens", "LatencyMs", "Model", "OutputTokens", "Provider", "RetrievedChunks", "Success", "Tier" }, typeof(AiUsageRecord).GetProperties().Select(p => p.Name).Order());
    }
}

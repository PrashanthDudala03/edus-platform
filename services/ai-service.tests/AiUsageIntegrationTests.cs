using EduOS.Ai.Gateway;
using EduOS.ServiceAuth;
using Xunit;

/// <summary>The PostgreSQL usage store against a real AI database, as ai_app. Skipped without AI_TEST_DB_*.</summary>
public class AiUsageStoreIntegrationTests(AiDatabaseFixture fixture) : IClassFixture<AiDatabaseFixture>
{
    static readonly TimeSpan Hold = TimeSpan.FromSeconds(60);
    static AiUsageRecord Used(int input, int output, bool success = true, bool estimated = false, string? error = null) => new("assistant.ask", "fake", "fake-chat-1", input, output, estimated, 12, success, error);
    static Task<int> Settings(Guid school, long budget, bool enabled = true) => AiDatabaseFixture.AsOwner<int>(
        "WITH x AS (INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES (@s, @e, @b) RETURNING 1) SELECT count(*)::int FROM x", ("s", school), ("e", enabled), ("b", budget));
    static Task<long> Count(string table, Guid school) => AiDatabaseFixture.AsOwner<long>($"SELECT count(*) FROM ai.{table} WHERE school_id = @s", ("s", school));
    (PostgresAiUsageStore Store, ManualClock Clock) New() { var clock = new ManualClock(); return (new PostgresAiUsageStore(fixture.Database, clock), clock); }

    [DatabaseFact]
    public async Task ASchoolWithoutSettingsOrSwitchedOffIsRefusedAndNothingIsHeld()
    {
        var (store, _) = New(); Guid none = Guid.NewGuid(), off = Guid.NewGuid();
        await Settings(off, 1_000_000, false);
        Assert.Equal(AiAdmission.SchoolDisabled, (await store.Reserve(AiDatabaseFixture.Tenant(none), 100, Hold, default)).Admission);
        Assert.Equal(AiAdmission.SchoolDisabled, (await store.Reserve(AiDatabaseFixture.Tenant(off), 100, Hold, default)).Admission);
        Assert.Equal(0, await Count("usage_reservations", none) + await Count("usage_reservations", off));
        Assert.False((await store.Summary(AiDatabaseFixture.Tenant(none), default)).Enabled);
    }

    [DatabaseFact]
    public async Task ReservingSettlingAndSummarisingFollowTheAllowance()
    {
        var (store, _) = New(); var school = Guid.NewGuid(); var caller = AiDatabaseFixture.Tenant(school);
        await Settings(school, 1000);
        var held = await store.Reserve(caller, 300, Hold, default);
        Assert.Equal(AiAdmission.Granted, held.Admission);
        var during = await store.Summary(caller, default);
        Assert.Equal((true, 1000L, 0L, 300L, 700L), (during.Enabled, during.MonthlyTokenBudget, during.TokensUsed, during.TokensReserved, during.TokensRemaining));

        await store.Settle(caller, held.Id, Used(40, 10), default);
        var after = await store.Summary(caller, default);
        Assert.Equal((50L, 0L, 950L, 1L, 0L), (after.TokensUsed, after.TokensReserved, after.TokensRemaining, after.Calls, after.FailedCalls));
        Assert.Equal("assistant.ask|fake|fake-chat-1|1|40|10|f|12|t||" + caller.UserId, await AiDatabaseFixture.AsOwner<string>(
            "SELECT concat_ws('|', feature, provider, model, tier, input_tokens, output_tokens, usage_estimated, latency_ms, success, COALESCE(error_code, ''), user_id) FROM ai.usage_events WHERE school_id = @s", ("s", school)));

        // The whole worst case of the next request must fit in what is left.
        Assert.Equal(AiAdmission.QuotaExceeded, (await store.Reserve(caller, 951, Hold, default)).Admission);
        var last = await store.Reserve(caller, 950, Hold, default);
        Assert.Equal(AiAdmission.Granted, last.Admission);
        // A failed attempt is kept, marked as estimated, and not charged.
        await store.Settle(caller, last.Id, Used(20, 0, false, true, "Timeout"), default);
        var end = await store.Summary(caller, default);
        Assert.Equal((50L, 0L, 1L, 1L), (end.TokensUsed, end.TokensReserved, end.Calls, end.FailedCalls));
        Assert.Equal("Timeout|t|f", await AiDatabaseFixture.AsOwner<string>("SELECT concat_ws('|', error_code, usage_estimated, success) FROM ai.usage_events WHERE school_id = @s AND NOT success", ("s", school)));
        // Releasing without a record leaves no trace.
        var released = await store.Reserve(caller, 100, Hold, default);
        await store.Settle(caller, released.Id, null, default);
        Assert.Equal((2L, 0L), (await Count("usage_events", school), await Count("usage_reservations", school)));
    }

    [DatabaseFact]
    public async Task ExpiredReservationsStopCountingAndANewMonthStartsFresh()
    {
        var (store, clock) = New(); var school = Guid.NewGuid(); var caller = AiDatabaseFixture.Tenant(school);
        await Settings(school, 500);
        Assert.Equal(AiAdmission.Granted, (await store.Reserve(caller, 400, Hold, default)).Admission);
        Assert.Equal(AiAdmission.QuotaExceeded, (await store.Reserve(caller, 200, Hold, default)).Admission);
        // A call that never reported back (a crash, say) frees its hold once it has expired.
        clock.Advance(61);
        Assert.Equal(0, (await store.Summary(caller, default)).TokensReserved);
        var next = await store.Reserve(caller, 200, Hold, default);
        Assert.Equal(AiAdmission.Granted, next.Admission);
        Assert.Equal(1, await Count("usage_reservations", school));
        await store.Settle(caller, next.Id, Used(450, 50), default);
        Assert.Equal(AiAdmission.QuotaExceeded, (await store.Reserve(caller, 1, Hold, default)).Admission);
        clock.Advance(32 * 24 * 3600);
        var fresh = await store.Summary(caller, default);
        Assert.Equal((0L, 0L, 500L), (fresh.TokensUsed, fresh.Calls, fresh.TokensRemaining));
        Assert.Equal(AiAdmission.Granted, (await store.Reserve(caller, 500, Hold, default)).Admission);
    }

    [DatabaseFact]
    public async Task SchoolsShareNeitherAllowanceNorUsage()
    {
        var (store, _) = New(); Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        await Settings(a, 100); await Settings(b, 1000);
        var heldA = await store.Reserve(AiDatabaseFixture.Tenant(a), 100, Hold, default);
        var heldB = await store.Reserve(AiDatabaseFixture.Tenant(b), 1000, Hold, default);
        Assert.Equal((AiAdmission.Granted, AiAdmission.Granted), (heldA.Admission, heldB.Admission));
        // A reservation of one school cannot be settled or released from another.
        await store.Settle(AiDatabaseFixture.Tenant(b), heldA.Id, null, default);
        Assert.Equal(1, await Count("usage_reservations", a));
        await store.Settle(AiDatabaseFixture.Tenant(a), heldA.Id, Used(60, 20), default);
        var summaryA = await store.Summary(AiDatabaseFixture.Tenant(a), default); var summaryB = await store.Summary(AiDatabaseFixture.Tenant(b), default);
        Assert.Equal((80L, 1L, 0L), (summaryA.TokensUsed, summaryA.Calls, summaryA.TokensReserved));
        Assert.Equal((0L, 0L, 1000L), (summaryB.TokensUsed, summaryB.Calls, summaryB.TokensReserved));
    }

    [DatabaseFact]
    public async Task SimultaneousRequestsCannotOverspendTheAllowance()
    {
        var (store, _) = New(); var school = Guid.NewGuid();
        await Settings(school, 300);
        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => Task.Run(() => store.Reserve(AiDatabaseFixture.Tenant(school), 100, Hold, default))));
        Assert.Equal(3, results.Count(r => r.Admission == AiAdmission.Granted));
        Assert.Equal(9, results.Count(r => r.Admission == AiAdmission.QuotaExceeded));
        Assert.Equal(300, await AiDatabaseFixture.AsOwner<long>("SELECT sum(tokens)::bigint FROM ai.usage_reservations WHERE school_id = @s", ("s", school)));
    }

    [DatabaseFact]
    public async Task TheAssistantEndpointMetersThroughTheRealDatabase()
    {
        Guid on = Guid.NewGuid(), off = Guid.NewGuid(); const string question = "When does the term start, zebra-quartz?";
        await Settings(on, 100_000); await Settings(off, 100_000, false);
        await using var host = await AiHost.Start(true, new StubBootstrap(true), usage: new PostgresAiUsageStore(fixture.Database, TimeProvider.System), knowledge: InMemoryKnowledgeStore.WithEvidence());
        var body = System.Text.Json.JsonSerializer.Serialize(new { question });
        var answered = await AiGatewayTests.Data(await host.Post("/api/ai/assistant/ask", host.Token(school: on, permissions: "ai.assistant.use"), body));
        var refused = await AiGatewayTests.Data(await host.Post("/api/ai/assistant/ask", host.Token(school: off, permissions: "ai.assistant.use"), body));
        var unknown = await AiGatewayTests.Data(await host.Post("/api/ai/assistant/ask", host.Token(school: Guid.NewGuid(), permissions: "ai.assistant.use"), body));
        Assert.True(answered.GetProperty("available").GetBoolean());
        Assert.Equal(("school-disabled", "school-disabled"), (refused.GetProperty("reason").GetString(), unknown.GetProperty("reason").GetString()));
        var tokens = answered.GetProperty("usage").GetProperty("inputTokens").GetInt32() + answered.GetProperty("usage").GetProperty("outputTokens").GetInt32();
        Assert.Equal($"assistant.ask|fake|fake-chat-1|{tokens}|f|t|1", await AiDatabaseFixture.AsOwner<string>(
            "SELECT concat_ws('|', feature, provider, model, input_tokens + output_tokens, usage_estimated, success, retrieved_chunks) FROM ai.usage_events WHERE school_id = @s", ("s", on)));
        Assert.Equal((0L, 0L, 0L), (await Count("usage_events", off), await Count("usage_reservations", on), await Count("usage_reservations", off)));
        var usage = await AiGatewayTests.Data(await host.Get("/api/ai/usage", host.Token(school: on, permissions: "ai.usage.view")));
        Assert.Equal((tokens, 100_000 - tokens, 1), (usage.GetProperty("tokensUsed").GetInt64(), usage.GetProperty("tokensRemaining").GetInt64(), usage.GetProperty("calls").GetInt64()));
        // Whatever was stored for this call, the question and the answer are not in it.
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.usage_events e WHERE school_id = @s AND (to_jsonb(e)::text ILIKE '%zebra%' OR to_jsonb(e)::text ILIKE '%term start%')", ("s", on)));
    }

    [DatabaseFact]
    public async Task NoColumnCanHoldAQuestionOrAnAnswerAndTheOnlyDocumentTextIsInChunks()
    {
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ai' AND column_name ~* '(prompt|question|answer|response|content|message|body)'"));
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ai' AND data_type = 'bytea'"));
        Assert.Equal("knowledge_embeddings.embedding", await AiDatabaseFixture.AsOwner<string>("SELECT string_agg(table_name || '.' || column_name, ',') FROM information_schema.columns WHERE table_schema = 'ai' AND udt_name = 'vector'"));
        Assert.Equal("action,error_code,failure,feature,file_name,id,media_type,model,provider,section,status,text,text_sha256,title", await AiDatabaseFixture.AsOwner<string>(
            "SELECT string_agg(DISTINCT column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'ai' AND data_type IN ('text', 'character varying') AND column_name <> 'currency'"));
    }
}

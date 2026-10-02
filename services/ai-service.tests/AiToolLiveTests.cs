using System.Net.Http.Json;
using System.Text.Json;
using EduOS.Ai.Tools;
using EduOS.ServiceAuth;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Xunit.Abstractions;

/// <summary>
/// Runs only against a running local EduOS stack with the demo accounts: set AI_TEST_STACK_URL (for example
/// http://localhost:8080) and AI_TEST_STACK_PASSWORD (the demo password). It only reads. Without them it is skipped.
/// </summary>
public sealed class LiveStackFactAttribute : FactAttribute
{
    public static string Url => Environment.GetEnvironmentVariable("AI_TEST_STACK_URL") ?? "";
    public static string Password => Environment.GetEnvironmentVariable("AI_TEST_STACK_PASSWORD") ?? "";
    public LiveStackFactAttribute() { if (Url.Length == 0 || Password.Length == 0) Skip = "Set AI_TEST_STACK_URL and AI_TEST_STACK_PASSWORD to run the tools against a local EduOS stack."; }
}

/// <summary>The tools against the real EduOS endpoints, through the real gateway, with real tokens of the demo accounts.</summary>
public class AiToolLiveTests(ITestOutputHelper output)
{
    static async Task<(ToolCaller Caller, Guid School, string[] Permissions, string Token)> SignIn(HttpClient http, string username)
    {
        var response = await http.PostAsJsonAsync("/api/v1/auth/login", new { username, password = LiveStackFactAttribute.Password });
        Assert.True(response.IsSuccessStatusCode, $"Sign-in of {username} failed: {(int)response.StatusCode}");
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); var user = data.GetProperty("user");
        var school = user.GetProperty("schoolId").GetGuid(); var permissions = user.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()!).ToArray(); var token = data.GetProperty("accessToken").GetString()!;
        return (new ToolCaller(new TenantContext(school, user.GetProperty("id").GetGuid(), user.GetProperty("roles")[0].GetString()!), token, permissions), school, permissions, token);
    }

    [LiveStackFact]
    public async Task TheToolsReadTheRealEndpointsAsEachUserAndEduOSDecidesWhatEachMaySee()
    {
        using var http = new HttpClient { BaseAddress = new Uri(LiveStackFactAttribute.Url) };
        var audit = new InMemoryToolAudit();
        await using var host = await AiHost.Start(true, new StubBootstrap(true), new() { ["Ai:Tools:GatewayUrl"] = LiveStackFactAttribute.Url }, toolAudit: audit);
        var registry = host.Services.GetRequiredService<AiToolRegistry>();
        async Task<ToolResult> Run(ToolCaller caller, string who, string tool, object? arguments = null)
        {
            var result = await registry.Execute(caller, tool, arguments is null ? null : JsonSerializer.SerializeToElement(arguments), default);
            output.WriteLine($"{who,-28} {tool,-20} {result.Status,-18} {result.Data?.ToJsonString()}");
            return result;
        }

        var admin = await SignIn(http, "admin@demo.eduos.local"); var teacher = await SignIn(http, "teacher@demo.eduos.local"); var parent = await SignIn(http, "parent@demo.eduos.local");
        output.WriteLine($"offered: admin [{string.Join(", ", registry.Offered(admin.Caller).Select(d => d.Name))}] | teacher [{string.Join(", ", registry.Offered(teacher.Caller).Select(d => d.Name))}] | parent [{string.Join(", ", registry.Offered(parent.Caller).Select(d => d.Name))}]");

        // The school administrator may use all four.
        var count = await Run(admin.Caller, "admin", "student_count"); var attendance = await Run(admin.Caller, "admin", "attendance_summary");
        var fees = await Run(admin.Caller, "admin", "fee_summary"); var exams = await Run(admin.Caller, "admin", "exam_schedule", new { period = "recent", limit = 5 });
        Assert.All(new[] { count, attendance, fees, exams }, r => Assert.Equal(ToolResult.Ok, r.Status));
        Assert.Equal((int)count.Data!["students"]!, (int)attendance.Data!["students"]!);
        await Run(admin.Caller, "admin", "exam_schedule");
        // No person's name and no identifier in anything a tool returned.
        Assert.DoesNotMatch(@"[0-9a-f]{8}-[0-9a-f]{4}-|studentId|Sharma|Aarav|Diya", string.Concat(new[] { count, attendance, fees, exams }.Select(r => r.Data!.ToJsonString())));

        // A teacher holds only exams.view of the four: the other tools are refused here, before any request.
        Assert.Equal(new[] { "exam_schedule" }, registry.Offered(teacher.Caller).Select(d => d.Name).Where(n => n != "current_user_profile"));
        var me = await Run(teacher.Caller, "teacher", "current_user_profile");
        Assert.Equal((ToolResult.Ok, "Teacher"), (me.Status, (string?)me.Data!["role"]));
        Assert.Equal(ToolResult.Ok, (await Run(teacher.Caller, "teacher", "exam_schedule")).Status);
        Assert.Equal(ToolResult.NotPermitted, (await Run(teacher.Caller, "teacher", "student_count")).Status);
        // Even if this service were wrong about a caller's permissions, EduOS refuses the request itself.
        var overstated = new ToolCaller(teacher.Caller.Tenant, teacher.Token, ["students.view", "overview.view", "fees.view", "exams.view"]);
        foreach (var tool in new[] { "student_count", "attendance_summary", "fee_summary" }) Assert.Equal(ToolResult.Denied, (await Run(overstated, "teacher, overstated", tool)).Status);
        // And a caller placed in another school is refused by EduOS, whose token says otherwise.
        var misplaced = new ToolCaller(new TenantContext(Guid.NewGuid(), admin.Caller.Tenant.UserId, "Administrator"), admin.Token, admin.Permissions);
        foreach (var tool in new[] { "student_count", "attendance_summary" }) Assert.Equal(ToolResult.Denied, (await Run(misplaced, "admin, other school", tool)).Status);
        Assert.Equal(ToolResult.Denied, (await Run(new ToolCaller(admin.Caller.Tenant, "not-a-token", admin.Permissions), "invalid token", "student_count")).Status);

        // A parent sees the totals of the linked children only; EduOS does that scoping.
        Assert.Equal(new[] { "exam_schedule", "fee_summary" }, registry.Offered(parent.Caller).Select(d => d.Name).Where(n => n != "current_user_profile"));
        Assert.Equal(ToolResult.Ok, (await Run(parent.Caller, "parent", "fee_summary")).Status);
        Assert.Equal(ToolResult.NotPermitted, (await Run(parent.Caller, "parent", "attendance_summary")).Status);
        output.WriteLine("audit: " + string.Join(" | ", audit.Rows.GroupBy(r => r.Tool + " " + r.Status).Select(g => g.Key + " x" + g.Count())));
    }
}

/// <summary>The audit row of a tool call in the real AI database, as ai_app under row-level security. Skipped without AI_TEST_DB_*.</summary>
public class AiToolAuditIntegrationTests(AiDatabaseFixture fixture) : IClassFixture<AiDatabaseFixture>
{
    [DatabaseFact]
    public async Task AToolCallIsRecordedForItsSchoolWithItsNameOutcomeAndTimeOnly()
    {
        var audit = new PostgresAiToolAudit(fixture.Database); Guid a = Guid.NewGuid(), b = Guid.NewGuid(); var caller = AiDatabaseFixture.Tenant(a);
        await audit.Record(caller, "fee_summary", ToolResult.Ok, 42, default);
        await audit.Record(caller, "student_count", ToolResult.Denied, 7, default);
        Assert.Equal($"tool.call|{caller.UserId}|{{\"ms\": 42, \"tool\": \"fee_summary\", \"status\": \"ok\"}} ; tool.call|{caller.UserId}|{{\"ms\": 7, \"tool\": \"student_count\", \"status\": \"denied\"}}",
            await AiDatabaseFixture.AsOwner<string>("SELECT string_agg(concat_ws('|', action, user_id, detail::text), ' ; ' ORDER BY created_at) FROM ai.audit WHERE school_id = @s", ("s", a)));
        // Another school sees none of it, and there is nowhere to record a call without a school.
        Assert.Equal(0L, await fixture.Database.InSchool(AiDatabaseFixture.Tenant(b), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, "SELECT count(*) FROM ai.audit", t)));
        Assert.Equal(2L, await fixture.Database.InSchool(caller, (c, t, _) => AiDatabaseFixture.Scalar<long>(c, "SELECT count(*) FROM ai.audit", t)));
        await Assert.ThrowsAsync<InvalidOperationException>(() => audit.Record(new TenantContext(EduOSTenants.Platform, Guid.NewGuid(), "SuperAdmin") { PlatformAuthority = true }, "fee_summary", ToolResult.Ok, 1, default));
    }
}

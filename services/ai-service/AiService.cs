using EduOS.Ai.Gateway;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

/// <summary>Deployment-level AI settings, bound from the "Ai" section (environment: Ai__Enabled).</summary>
public sealed class AiOptions
{
    public const string Section = "Ai";
    /// <summary>Off unless the deployment turns it on. Per-school and per-role switches are IAM permissions.</summary>
    public bool Enabled { get; set; }
}

public static class AiPermissions
{
    public const string AssistantUse = "ai.assistant.use";
    public const string UsageView = "ai.usage.view";
}

/// <summary>
/// Composition of the AI service. It holds no school data and no database connection: the school and
/// permissions of a caller come only from the verified token, exactly as in every other EduOS service.
/// </summary>
public static class AiService
{
    /// <param name="configureEvents">Lets in-process tests replace the auth-service session check.</param>
    public static void Configure(WebApplicationBuilder builder, Action<JwtBearerEvents>? configureEvents = null)
    {
        builder.Services.AddOptions<AiOptions>().Bind(builder.Configuration.GetSection(AiOptions.Section)).ValidateOnStart();
        builder.Services.AddEduOSAuthentication(builder.Configuration, configureEvents);

        // Two accounts on the separate AI database: the restricted one serves requests, the owner only prepares the schema.
        var runtime = builder.Configuration.GetConnectionString("AiDb");
        var owner = builder.Configuration.GetConnectionString("AiDbMigrations");
        builder.Services.AddSingleton(new AiDatabaseState(!string.IsNullOrWhiteSpace(runtime) && !string.IsNullOrWhiteSpace(owner)));
        builder.Services.AddSingleton(_ => new AiDatabase(runtime));
        builder.Services.AddSingleton<IAiDatabaseBootstrap>(_ => new NpgsqlAiDatabaseBootstrap(owner!, runtime!, Path.Combine(AppContext.BaseDirectory, "Migrations")));
        builder.Services.AddHostedService<AiDatabaseInitializer>();

        AiProviders.Register(builder.Services, builder.Configuration);

        builder.Services.AddOptions<AiAssistantOptions>().Bind(builder.Configuration.GetSection(AiAssistantOptions.Section))
            .Validate(o => o.MaxQuestionChars is >= 1 and <= 8000 && o.MaxOutputTokens is >= 1 and <= 4096,
                "Ai:Assistant:MaxQuestionChars must be 1 to 8000 and Ai:Assistant:MaxOutputTokens 1 to 4096.")
            .ValidateOnStart();
        builder.Services.AddOptions<AiLimitsOptions>().Bind(builder.Configuration.GetSection(AiLimitsOptions.Section))
            .Validate(o => AiLimitsOptions.Problem(o) is null, "Ai:Limits is out of range: requests per minute (user 1 to 600, school 1 to 60000), failure threshold 1 to 100, recovery 1 to 3600 seconds.")
            .ValidateOnStart();
        builder.Services.TryAddSingleton(TimeProvider.System);
        builder.Services.AddSingleton<AiRateLimiter>();
        builder.Services.AddSingleton<AiCircuitBreaker>();
        builder.Services.AddSingleton<IAiUsageStore, PostgresAiUsageStore>();
        builder.Services.AddSingleton<AiGateway>();
    }

    /// <summary>Largest request body any AI endpoint accepts.</summary>
    public const int MaxBodyBytes = 16 * 1024;

    // Only a school user holding the permission; the platform administrator has no school to ask about.
    static bool Denied(TenantContext tenant, HttpContext http) =>
        tenant.IsPlatform || !http.User.HasClaim("permission", AiPermissions.AssistantUse);
    static IResult Forbidden() => Results.Json(new { message = "Permission denied." }, statusCode: StatusCodes.Status403Forbidden);

    public static void Map(WebApplication app)
    {
        app.UseRouting();
        // Refused before anything reads the body.
        app.Use(async (context, next) =>
        {
            if (context.Request.ContentLength > MaxBodyBytes)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(new { message = "The request is too large." });
                return;
            }
            await next();
        });
        // Everything under /api except the container health check needs a valid token, a school scope and
        // the permission PermissionAccess maps to the route; AI routes it does not know are refused.
        app.UseEduOSAuthorization("/api", "/api/ai/health");

        app.MapGet("/api/ai/health", () => Results.Ok(new { status = "ready" })).AllowAnonymous();

        // Reports availability only, from the same check the assistant itself uses.
        app.MapGet("/api/ai/status", async (TenantContext tenant, HttpContext http, AiGateway gateway, CancellationToken cancellation) =>
        {
            if (Denied(tenant, http)) return Forbidden();
            var reason = await gateway.UnavailableFor(tenant, cancellation);
            return Results.Ok(new { data = new { enabled = reason is null, reason } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        // The caller's own school only: its switch, monthly allowance and what it has used. Counts, never content.
        app.MapGet("/api/ai/usage", async (TenantContext tenant, HttpContext http, AiGateway gateway, CancellationToken cancellation) =>
        {
            if (tenant.IsPlatform || !http.User.HasClaim("permission", AiPermissions.UsageView)) return Forbidden();
            var (summary, reason) = await gateway.Usage(tenant, cancellation);
            if (summary is null) return Results.Ok(new { data = new { available = false, reason } });
            return Results.Ok(new { data = new
            {
                available = true, enabled = summary.Enabled, monthStart = summary.MonthStart, monthlyTokenBudget = summary.MonthlyTokenBudget, tokensUsed = summary.TokensUsed,
                tokensReserved = summary.TokensReserved, tokensRemaining = summary.TokensRemaining, calls = summary.Calls, failedCalls = summary.FailedCalls,
            } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        // A valid request always gets 200: either an answer or the reason the assistant is unavailable.
        // Provider failures are never turned into a server error, and no internal detail is returned.
        app.MapPost("/api/ai/assistant/ask", async (AssistantAsk ask, TenantContext tenant, HttpContext http, AiGateway gateway, CancellationToken cancellation) =>
        {
            if (Denied(tenant, http)) return Forbidden();
            var outcome = await gateway.Ask(tenant, ask, cancellation);
            if (outcome.Invalid is string message) return Results.BadRequest(new { message });
            if (outcome.RetryAfterSeconds is int wait) return Results.Ok(new { data = new { available = false, reason = outcome.Unavailable, retryAfterSeconds = wait } });
            if (outcome.Response is not ModelResponse answer) return Results.Ok(new { data = new { available = false, reason = outcome.Unavailable } });
            return Results.Ok(new { data = new
            {
                available = true, answer = answer.Text, model = answer.Model, finish = answer.Finish == FinishReason.Length ? "length" : "completed",
                usage = new { inputTokens = answer.Usage!.InputTokens, outputTokens = answer.Usage.OutputTokens, estimated = answer.Usage.Estimated },
            } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);
    }
}

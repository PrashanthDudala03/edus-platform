using EduOS.ServiceAuth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
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
    }

    public static string Unavailable(AiOptions options, AiDatabaseState database) =>
        !options.Enabled || !database.Configured ? "not-configured" : !database.Ready ? "database-unavailable" : "no-capabilities";

    public static void Map(WebApplication app)
    {
        app.UseRouting();
        // Everything under /api except the container health check needs a valid token, a school scope and
        // the permission PermissionAccess maps to the route; AI routes it does not know are refused.
        app.UseEduOSAuthorization("/api", "/api/ai/health");

        app.MapGet("/api/ai/health", () => Results.Ok(new { status = "ready" })).AllowAnonymous();

        // Reports availability only. No AI capability exists yet, so this is never "enabled".
        app.MapGet("/api/ai/status", (TenantContext tenant, HttpContext http, IOptions<AiOptions> options, AiDatabaseState database) =>
            tenant.IsPlatform || !http.User.HasClaim("permission", AiPermissions.AssistantUse)
                ? Results.Json(new { message = "Permission denied." }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Ok(new { data = new { enabled = false, reason = Unavailable(options.Value, database) } }))
            .RequireAuthorization(EduOSPolicies.AnyRole);
    }
}

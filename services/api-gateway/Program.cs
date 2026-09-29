using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Http.Extensions;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Serilog;
using Yarp.ReverseProxy.Configuration;

var builder = WebApplication.CreateBuilder(args);

// Serilog configuration
builder.Host.UseSerilog((context, config) =>
    config
        .MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/gateway-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "API-Gateway"));

// The gateway verifies access tokens and must never receive the signing key.
var jwtPublicKeyB64 = builder.Configuration["JWT_PUBLIC_KEY"];

if (string.IsNullOrWhiteSpace(jwtPublicKeyB64))
{
    Log.Fatal("JWT_PUBLIC_KEY not found in configuration.");
    throw new InvalidOperationException("JWT public key is required");
}

var jwtPublicKeyPem = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(jwtPublicKeyB64));

// Parse RSA keys from PEM format
var rsa = RSA.Create();
rsa.ImportFromPem(jwtPublicKeyPem.AsSpan());

var validationParameters = new TokenValidationParameters
{
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = new RsaSecurityKey(rsa),
    ValidateIssuer = true,
    ValidIssuer = builder.Configuration["JWT_ISSUER"] ?? "edus-auth-service",
    ValidateAudience = true,
    ValidAudience = builder.Configuration["JWT_AUDIENCE"] ?? "edus-api",
    ValidateLifetime = true,
    ClockSkew = TimeSpan.Zero
};

builder.Services.AddHttpClient("auth-session", c=>{c.BaseAddress=new Uri("http://auth-service:6001");c.Timeout=TimeSpan.FromSeconds(5);});

builder.Services
    .AddAuthentication("Bearer")
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = validationParameters;
        options.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var id=context.Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                var school=context.Principal?.FindFirst("school_id")?.Value;
                try {
                    var client=context.HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("auth-session");
                    var state=await client.GetFromJsonAsync<SessionState>("/api/internal/session/"+id+"?schoolId="+school);
                    if(state is null || !context.Principal!.IsInRole(state.Role)) context.Fail("Account access changed.");
                } catch {context.Fail("Account is unavailable.");}
            },
            OnAuthenticationFailed = context =>
            {
                Log.Warning("JWT validation failed: {Message}", context.Exception.Message);
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    // Every proxied endpoint is protected unless its YARP route explicitly
    // marks it anonymous (only login and refresh are anonymous).
    options.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
    options.AddPolicy("EduOSAdministrators", policy => policy.RequireRole("SuperAdmin", "Principal"));
});
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

builder.Services.AddHealthChecks();
builder.WebHost.ConfigureKestrel(o=>o.Limits.MaxRequestBodySize=1024*1024);

var app = builder.Build();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

// Scope every tenant data request to the school claim in the verified access
// token. A client cannot switch schools by editing query strings or JSON bodies.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    if (!path.StartsWithSegments("/api/v1") ||
        string.Equals(path.Value, "/api/v1/health", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(path.Value, "/api/v1/auth/login", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(path.Value, "/api/v1/auth/refresh", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    var schoolClaim = context.User.FindFirst("school_id")?.Value;
    if (!Guid.TryParse(schoolClaim, out var schoolId))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { statusCode = 403, message = "A valid school scope is required." });
        return;
    }

    var requestedSchoolIds = context.Request.Query
        .Where(pair => string.Equals(pair.Key, "schoolId", StringComparison.OrdinalIgnoreCase))
        .SelectMany(pair => pair.Value)
        .Where(value => !string.IsNullOrWhiteSpace(value));
    if (requestedSchoolIds.Any(value => !Guid.TryParse(value, out var requested) || requested != schoolId))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { statusCode = 403, message = "The requested school is outside your account scope." });
        return;
    }

    if (path.StartsWithSegments("/api/v1/schools", out var schoolPath) && schoolPath.HasValue)
    {
        var pathSchoolId = schoolPath.Value!.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (pathSchoolId is not null && Guid.TryParse(pathSchoolId, out var requestedPathSchoolId) && requestedPathSchoolId != schoolId)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { statusCode = 403, message = "The requested school is outside your account scope." });
            return;
        }
    }

    var query = new QueryBuilder();
    foreach (var pair in context.Request.Query)
    {
        if (string.Equals(pair.Key, "schoolId", StringComparison.OrdinalIgnoreCase)) continue;
        foreach (var value in pair.Value)
        {
            query.Add(pair.Key, value ?? string.Empty);
        }
    }
    query.Add("schoolId", schoolId.ToString());
    context.Request.QueryString = query.ToQueryString();

    if (context.Request.HasJsonContentType() && (context.Request.ContentLength.GetValueOrDefault() > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding")))
    {
        context.Request.EnableBuffering();
        using var reader = new StreamReader(context.Request.Body, leaveOpen: true);
        var body = await reader.ReadToEndAsync();
        context.Request.Body.Position = 0;
        JsonNode? payload; try {payload=JsonNode.Parse(body);} catch(JsonException){context.Response.StatusCode=400;await context.Response.WriteAsJsonAsync(new{message="Invalid JSON body."});return;}
        if (payload is JsonObject jsonObject)
        {
            if(jsonObject.Count(item=>string.Equals(item.Key,"schoolId",StringComparison.OrdinalIgnoreCase))>1){context.Response.StatusCode=400;await context.Response.WriteAsJsonAsync(new{message="Duplicate school scope."});return;}
            var schoolField = jsonObject.Select(item => item.Key)
                .FirstOrDefault(key => string.Equals(key, "schoolId", StringComparison.OrdinalIgnoreCase)) ?? "schoolId";
            var bodySchool = jsonObject[schoolField]?.ToString();
            if (!string.IsNullOrWhiteSpace(bodySchool) &&
                (!Guid.TryParse(bodySchool, out var requestedBodySchoolId) || requestedBodySchoolId != schoolId))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { statusCode = 403, message = "The requested school is outside your account scope." });
                return;
            }

            jsonObject[schoolField] = schoolId.ToString();
            var rewrittenBody = JsonSerializer.SerializeToUtf8Bytes(payload);
            context.Request.Body = new MemoryStream(rewrittenBody);
            context.Request.ContentLength = rewrittenBody.Length;
        }
    }

    await next();
});

// Health check endpoint
// Health endpoint - return Prometheus metrics format
app.MapGet("/api/v1/health", () =>
{
    return Results.Text("# HELP service_health Service health status\n# TYPE service_health gauge\nservice_health 1\n", "text/plain; version=0.0.4");
}).AllowAnonymous();

// Gateway routes (handled by YARP)
app.MapReverseProxy();

app.Run();
public record SessionState(string Role);

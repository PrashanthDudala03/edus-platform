using System.Net.Http.Headers;
using System.Security.Claims;
using EduOS.ServiceAuth;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Serilog configuration
builder.Host.UseSerilog((context, config) =>
    config
        .MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/gateway-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "API-Gateway"));

builder.Services.AddHttpClient("auth-session", c=>{c.BaseAddress=new Uri("http://auth-service:6001");c.Timeout=TimeSpan.FromSeconds(5);});

// The gateway verifies access tokens with the rules shared by every service and
// never receives the signing key. Services repeat the same verification, so the
// gateway is the first check rather than the only one. On top of the shared
// rules it confirms the session is still current with auth-service.
builder.Services.AddEduOSAuthentication(builder.Configuration, events =>
{
    events.OnTokenValidated = async context =>
    {
        var id=context.Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var school=context.Principal?.FindFirst(EduOSClaims.SchoolId)?.Value;
        try {
            var client=context.HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("auth-session");
            // auth-service requires the caller's own token and answers only for that user.
            using var request=new HttpRequestMessage(HttpMethod.Get,"/api/internal/session/"+id+"?schoolId="+school);
            request.Headers.Authorization=AuthenticationHeaderValue.Parse(context.Request.Headers.Authorization.ToString());
            using var response=await client.SendAsync(request);
            var state=response.IsSuccessStatusCode?await response.Content.ReadFromJsonAsync<SessionState>():null;
            if(state is null || !context.Principal!.IsInRole(state.Role) || (context.Principal.FindFirst(EduOSClaims.TokenVersion)?.Value ?? "0") != state.Version.ToString()) context.Fail("Account access changed.");
        } catch (Exception ex) {
            // A slow or unreachable auth-service fails closed; log why so a timeout is not mistaken for a revoked session.
            Log.Warning(ex, "Session check failed for user {UserId}", id);
            context.Fail("Account is unavailable.");
        }
    };
    events.OnAuthenticationFailed = context =>
    {
        Log.Warning("JWT validation failed: {Message}", context.Exception.Message);
        return Task.CompletedTask;
    };
});
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

builder.Services.AddHealthChecks();
builder.WebHost.ConfigureKestrel(o=>o.Limits.MaxRequestBodySize=10*1024*1024);

var app = builder.Build();

app.UseRouting();

// Every proxied endpoint is protected unless its YARP route explicitly marks it
// anonymous. Tenant scoping then pins schoolId in the query, path and JSON body
// to the school claim in the verified token.
app.UseEduOSAuthorization("/api/v1", "/api/v1/health", "/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/reset-password", "/api/v1/auth/signup", "/api/v1/promotions", "/api/v1/billing/webhooks/razorpay");

// Health endpoint - return Prometheus metrics format
app.MapGet("/api/v1/health", () =>
{
    return Results.Text("# HELP service_health Service health status\n# TYPE service_health gauge\nservice_health 1\n", "text/plain; version=0.0.4");
}).AllowAnonymous();

// Gateway routes (handled by YARP)
app.MapReverseProxy();

app.Run();
public record SessionState(string Role,int Version);

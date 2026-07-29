using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;
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

// JWT configuration - load RSA keys from environment (base64-encoded)
var jwtPrivateKeyB64 = builder.Configuration["JWT_PRIVATE_KEY"];
var jwtPublicKeyB64 = builder.Configuration["JWT_PUBLIC_KEY"];

if (string.IsNullOrWhiteSpace(jwtPrivateKeyB64) || string.IsNullOrWhiteSpace(jwtPublicKeyB64))
{
    Log.Fatal("JWT RSA keys not found in configuration. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY in .env");
    throw new InvalidOperationException("JWT RSA keys are required");
}

var jwtPrivateKeyPem = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(jwtPrivateKeyB64));
var jwtPublicKeyPem = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(jwtPublicKeyB64));

// Parse RSA keys from PEM format
var rsa = RSA.Create();
rsa.ImportFromPem(jwtPublicKeyPem.AsSpan());

var validationParameters = new TokenValidationParameters
{
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = new RsaSecurityKey(rsa),
    ValidateIssuer = false,
    ValidateAudience = false,
    ValidateLifetime = true,
    ClockSkew = TimeSpan.Zero
};

builder.Services
    .AddAuthentication("Bearer")
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = validationParameters;
        options.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
        {
            OnAuthenticationFailed = context =>
            {
                Log.Warning("JWT validation failed: {Message}", context.Exception.Message);
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

// Health check endpoint
// Health endpoint - return Prometheus metrics format
app.MapGet("/api/v1/health", () =>
{
    return Results.Text("# HELP service_health Service health status\n# TYPE service_health gauge\nservice_health 1\n", "text/plain; version=0.0.4");
});

// Gateway routes (handled by YARP)
app.MapReverseProxy();

app.Run();



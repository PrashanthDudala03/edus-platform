using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace EduOS.ServiceAuth;

public static class EduOSAuthenticationExtensions
{
    /// <summary>
    /// Validation rules shared by the gateway and every service: RSA-SHA256
    /// signature against the auth-service public key, exact issuer and
    /// audience, bounded not-before tolerance and strict expiration.
    /// </summary>
    public static TokenValidationParameters BuildTokenValidationParameters(string publicKeyPem, string issuer, string audience)
    {
        var rsa = RSA.Create();
        rsa.ImportFromPem(publicKeyPem.AsSpan());
        return new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new RsaSecurityKey(rsa),
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            ValidateIssuer = true,
            ValidIssuer = issuer,
            ValidateAudience = true,
            ValidAudience = audience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,
            LifetimeValidator = (notBefore, expires, _, _) => JwtLifetime.IsValid(notBefore, expires, DateTime.UtcNow),
            RoleClaimType = ClaimTypes.Role,
            NameClaimType = ClaimTypes.NameIdentifier,
        };
    }

    /// <summary>Reads JWT_PUBLIC_KEY (base64 PEM), JWT_ISSUER and JWT_AUDIENCE. The signing key is never needed here.</summary>
    public static TokenValidationParameters TokenValidationParametersFrom(IConfiguration configuration)
    {
        var publicKeyB64 = configuration["JWT_PUBLIC_KEY"];
        if (string.IsNullOrWhiteSpace(publicKeyB64))
            throw new InvalidOperationException("JWT_PUBLIC_KEY is required so this service can verify access tokens itself.");
        var publicKeyPem = Encoding.UTF8.GetString(Convert.FromBase64String(publicKeyB64));
        return BuildTokenValidationParameters(
            publicKeyPem,
            configuration["JWT_ISSUER"] ?? "edus-auth-service",
            configuration["JWT_AUDIENCE"] ?? "edus-api");
    }

    /// <summary>
    /// Registers bearer authentication, the named EduOS policies, a fallback
    /// policy that requires authentication for anything not marked anonymous,
    /// and <see cref="TenantContext"/> for injection into handlers.
    /// </summary>
    public static IServiceCollection AddEduOSAuthentication(this IServiceCollection services, IConfiguration configuration, Action<JwtBearerEvents>? configureEvents = null)
    {
        var parameters = TokenValidationParametersFrom(configuration);
        services.AddHttpClient("eduos-session", c => { c.BaseAddress=new Uri(configuration["AuthSessionUrl"] ?? "http://auth-service:6001"); c.Timeout=TimeSpan.FromSeconds(5); });
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = parameters;
                options.Events ??= new JwtBearerEvents();
                options.Events.OnTokenValidated = async context => {
                    try {
                        var principal=context.Principal!;
                        var client=context.HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("eduos-session");
                        using var request=new HttpRequestMessage(HttpMethod.Get,"/api/internal/session/"+principal.FindFirst(ClaimTypes.NameIdentifier)?.Value);
                        request.Headers.Authorization=AuthenticationHeaderValue.Parse(context.Request.Headers.Authorization.ToString());
                        using var response=await client.SendAsync(request);
                        var state=response.IsSuccessStatusCode?await response.Content.ReadFromJsonAsync<AuthorizationSession>():null;
                        if(state==null || !principal.IsInRole(state.Role) || principal.FindFirst("token_version")?.Value!=state.Version.ToString())context.Fail("Account access changed.");
                    } catch { context.Fail("Authorization service unavailable."); }
                };
                configureEvents?.Invoke(options.Events);
            });

        services.AddAuthorization(options =>
        {
            options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
            // Platform access needs both the role and the reserved platform tenant, so a school role that
            // happened to be named SuperAdmin could never reach cross-school operations.
            options.AddPolicy(EduOSPolicies.Platform, policy => policy.RequireClaim("data_scope","platform").RequireClaim("permission","platform.manage")
                .RequireClaim(EduOSClaims.SchoolId, EduOSTenants.Platform.ToString()));
            foreach(var name in new[]{EduOSPolicies.Administrators,EduOSPolicies.Leadership,EduOSPolicies.Staff,EduOSPolicies.Suite})
                options.AddPolicy(name, policy => policy.RequireAuthenticatedUser().RequireClaim("data_scope","school","teacher","parent","student"));
            options.AddPolicy(EduOSPolicies.AnyRole, policy => policy.RequireAuthenticatedUser().RequireClaim(ClaimTypes.Role));
        });

        services.AddHttpContextAccessor();
        services.AddScoped(provider =>
            provider.GetRequiredService<IHttpContextAccessor>().HttpContext?.TryGetTenant()
            ?? throw new InvalidOperationException("TenantContext is only available inside an authenticated request."));
        return services;
    }

    /// <summary>
    /// Authentication, authorization and tenant scoping in the required order.
    /// Call after UseRouting and before mapping endpoints.
    /// </summary>
    public static IApplicationBuilder UseEduOSAuthorization(this IApplicationBuilder app, string pathPrefix, params string[] anonymousPaths)
    {
        var options = new TenantScopeOptions { PathPrefix = pathPrefix };
        foreach (var path in anonymousPaths) options.AnonymousPaths.Add(path);
        return app.UseAuthentication().UseAuthorization().UseMiddleware<TenantScopeMiddleware>(options);
    }
}
public record AuthorizationSession(string Role,int Version);

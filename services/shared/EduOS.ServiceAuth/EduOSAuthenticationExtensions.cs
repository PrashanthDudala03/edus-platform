using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
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
    /// audience, lifetime with no clock skew.
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
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = parameters;
                options.Events ??= new JwtBearerEvents();
                configureEvents?.Invoke(options.Events);
            });

        services.AddAuthorization(options =>
        {
            options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
            options.AddPolicy(EduOSPolicies.Administrators, policy => policy.RequireRole(EduOSRoles.SuperAdmin, EduOSRoles.Principal));
            options.AddPolicy(EduOSPolicies.Staff, policy => policy.RequireRole(EduOSRoles.SuperAdmin, EduOSRoles.Principal, EduOSRoles.Teacher));
            options.AddPolicy(EduOSPolicies.Suite, policy => policy.RequireRole(EduOSRoles.All));
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

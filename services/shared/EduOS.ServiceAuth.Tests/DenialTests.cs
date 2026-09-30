using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace EduOS.ServiceAuth.Tests;

/// <summary>
/// An in-process service wired exactly like the real ones: shared JWT
/// validation, fallback authentication, named policies and tenant scoping.
/// No database is involved, so these tests only prove who is turned away.
/// </summary>
public sealed class ServiceHost : IAsyncLifetime
{
    public RSA SigningKey { get; } = RSA.Create(2048);
    public Guid School { get; } = Guid.NewGuid();
    public HttpClient Client { get; private set; } = null!;
    private WebApplication? app;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["JWT_PUBLIC_KEY"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(SigningKey.ExportSubjectPublicKeyInfoPem())),
            ["JWT_ISSUER"] = "edus-auth-service",
            ["JWT_AUDIENCE"] = "edus-api",
        });
        builder.Services.AddEduOSAuthentication(builder.Configuration);

        app = builder.Build();
        app.UseRouting();
        app.UseEduOSAuthorization("/api", "/api/health");
        app.MapGet("/api/health", () => Results.Ok(new { status = "ready" })).AllowAnonymous();
        app.MapGet("/api/admin", (TenantContext tenant) => Results.Ok(tenant)).RequireAuthorization(EduOSPolicies.Administrators);
        app.MapGet("/api/leadership", (TenantContext tenant) => Results.Ok(tenant)).RequireAuthorization(EduOSPolicies.Leadership);
        app.MapGet("/api/platform", (TenantContext tenant) => Results.Ok(tenant)).RequireAuthorization(EduOSPolicies.Platform);
        app.MapGet("/api/own-session", (TenantContext tenant) => Results.Ok(tenant)).RequireAuthorization(EduOSPolicies.AnyRole);
        app.MapGet("/api/staff", (TenantContext tenant) => Results.Ok(tenant)).RequireAuthorization(EduOSPolicies.Staff);
        app.MapGet("/api/suite", (TenantContext tenant) => Results.Ok(tenant)).RequireAuthorization(EduOSPolicies.Suite);
        app.MapGet("/api/schools/{id}", (string id) => Results.Ok(new { id })).RequireAuthorization(EduOSPolicies.Administrators);
        app.MapGet("/api/unlabelled", () => Results.Ok("fallback policy only"));
        app.MapPost("/api/suite/echo", async (HttpContext http, TenantContext tenant) =>
        {
            using var reader = new StreamReader(http.Request.Body);
            return Results.Ok(new
            {
                tenant,
                body = await reader.ReadToEndAsync(),
                user = http.Request.Headers[TenantScopeMiddleware.UserHeader].ToString(),
                role = http.Request.Headers[TenantScopeMiddleware.RoleHeader].ToString(),
                query = http.Request.Query["schoolId"].ToString(),
            });
        }).RequireAuthorization(EduOSPolicies.Suite);

        await app.StartAsync();
        Client = app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (app is not null) await app.DisposeAsync();
        SigningKey.Dispose();
    }

    /// <summary>Mirrors auth-service JwtService: same claim types, algorithm, issuer and audience.</summary>
    public string Token(string role, Guid? school = null, Guid? user = null, RSA? signer = null,
        string issuer = "edus-auth-service", string audience = "edus-api", bool expired = false, bool includeSchool = true)
    {
        var now = DateTime.UtcNow;
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, (user ?? Guid.NewGuid()).ToString()),
            new(ClaimTypes.Role, role),
            new(EduOSClaims.TokenVersion, "0"),
        };
        if (includeSchool) claims.Add(new Claim(EduOSClaims.SchoolId, (school ?? School).ToString()));
        var token = new JwtSecurityToken(issuer, audience, claims,
            notBefore: expired ? now.AddHours(-2) : now.AddMinutes(-1),
            expires: expired ? now.AddHours(-1) : now.AddMinutes(30),
            signingCredentials: new SigningCredentials(new RsaSecurityKey(signer ?? SigningKey), SecurityAlgorithms.RsaSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public static HttpRequestMessage Request(HttpMethod method, string url, string? token, string? json = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (json is not null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        return request;
    }
}

public class DenialTests(ServiceHost host) : IClassFixture<ServiceHost>
{
    private Task<HttpResponseMessage> Get(string path, string? token) => host.Client.SendAsync(ServiceHost.Request(HttpMethod.Get, path, token));

    [Fact]
    public async Task HealthStaysAnonymous()
    {
        var response = await Get("/api/health", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/admin")]
    [InlineData("/api/suite")]
    [InlineData("/api/unlabelled")]
    public async Task MissingTokenIsUnauthorized(string path)
    {
        var response = await Get(path, null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TokenSignedWithAnotherKeyIsUnauthorized()
    {
        using var foreign = RSA.Create(2048);
        var response = await Get("/api/suite", host.Token(EduOSRoles.Principal, signer: foreign));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ExpiredTokenIsUnauthorized()
    {
        var response = await Get("/api/suite", host.Token(EduOSRoles.Principal, expired: true));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task WrongAudienceIsUnauthorized()
    {
        var response = await Get("/api/suite", host.Token(EduOSRoles.Principal, audience: "another-api"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task WrongIssuerIsUnauthorized()
    {
        var response = await Get("/api/suite", host.Token(EduOSRoles.Principal, issuer: "someone-else"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TokenWithoutSchoolClaimIsForbidden()
    {
        var response = await Get("/api/suite", host.Token(EduOSRoles.Principal, includeSchool: false));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task UnknownRoleIsForbiddenEvenWhereOnlyAuthenticationIsRequired()
    {
        var response = await Get("/api/unlabelled", host.Token("Auditor"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(EduOSRoles.Student, "/api/admin", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Parent, "/api/admin", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Teacher, "/api/admin", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Student, "/api/staff", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Parent, "/api/staff", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Teacher, "/api/staff", HttpStatusCode.OK)]
    [InlineData(EduOSRoles.Administrator, "/api/admin", HttpStatusCode.OK)]
    [InlineData(EduOSRoles.Principal, "/api/admin", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Principal, "/api/leadership", HttpStatusCode.OK)]
    [InlineData(EduOSRoles.Administrator, "/api/leadership", HttpStatusCode.OK)]
    [InlineData(EduOSRoles.Teacher, "/api/leadership", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Student, "/api/suite", HttpStatusCode.OK)]
    [InlineData(EduOSRoles.Parent, "/api/suite", HttpStatusCode.OK)]
    [InlineData(EduOSRoles.Administrator, "/api/platform", HttpStatusCode.Forbidden)]
    [InlineData(EduOSRoles.Principal, "/api/platform", HttpStatusCode.Forbidden)]
    public async Task EndpointPoliciesDecideByRole(string role, string path, HttpStatusCode expected)
    {
        var response = await Get(path, host.Token(role));
        Assert.Equal(expected, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/platform", HttpStatusCode.OK)]
    [InlineData("/api/admin", HttpStatusCode.Forbidden)]
    [InlineData("/api/leadership", HttpStatusCode.Forbidden)]
    [InlineData("/api/staff", HttpStatusCode.Forbidden)]
    [InlineData("/api/suite", HttpStatusCode.Forbidden)]
    public async Task PlatformSuperAdminIsNotASchoolUser(string path, HttpStatusCode expected)
    {
        var response = await Get(path, host.Token(EduOSRoles.SuperAdmin, school: EduOSTenants.Platform));
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task EveryRoleIncludingPlatformCanReachItsOwnSessionEndpoints()
    {
        // The gateway's per-request session check runs for platform tokens too; refusing them logs SuperAdmin out.
        Assert.Equal(HttpStatusCode.OK, (await Get("/api/own-session", host.Token(EduOSRoles.SuperAdmin, school: EduOSTenants.Platform))).StatusCode);
        foreach (var role in EduOSRoles.School)
            Assert.Equal(HttpStatusCode.OK, (await Get("/api/own-session", host.Token(role))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Get("/api/own-session", host.Token("Auditor"))).StatusCode);
    }

    [Fact]
    public async Task SuperAdminRoleInsideASchoolTenantCannotReachThePlatform()
    {
        // Legacy data or a hand-edited role named SuperAdmin inside a school must not grant cross-school access.
        var response = await Get("/api/platform", host.Token(EduOSRoles.SuperAdmin));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Get("/api/admin", host.Token(EduOSRoles.SuperAdmin))).StatusCode);
    }

    [Fact]
    public async Task TenantContextComesFromTheTokenClaims()
    {
        var user = Guid.NewGuid();
        var response = await Get("/api/suite", host.Token(EduOSRoles.Student, user: user));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(host.School.ToString(), json.RootElement.GetProperty("schoolId").GetString());
        Assert.Equal(user.ToString(), json.RootElement.GetProperty("userId").GetString());
        Assert.Equal(EduOSRoles.Student, json.RootElement.GetProperty("role").GetString());
        Assert.False(json.RootElement.GetProperty("isAdministrator").GetBoolean());
    }

    [Fact]
    public async Task QueryForAnotherSchoolIsForbidden()
    {
        var response = await Get("/api/suite?schoolId=" + Guid.NewGuid(), host.Token(EduOSRoles.Principal));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task PathForAnotherSchoolIsForbiddenAndOwnSchoolIsAllowed()
    {
        var token = host.Token(EduOSRoles.Administrator);
        var other = await Get("/api/schools/" + Guid.NewGuid(), token);
        var own = await Get("/api/schools/" + host.School, token);
        Assert.Equal(HttpStatusCode.Forbidden, other.StatusCode);
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
    }

    [Fact]
    public async Task BodyForAnotherSchoolIsForbidden()
    {
        var request = ServiceHost.Request(HttpMethod.Post, "/api/suite/echo", host.Token(EduOSRoles.Student),
            JsonSerializer.Serialize(new { schoolId = Guid.NewGuid(), response = "late" }));
        var response = await host.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task MalformedJsonBodyIsRejected()
    {
        var request = ServiceHost.Request(HttpMethod.Post, "/api/suite/echo", host.Token(EduOSRoles.Student), "{not json");
        var response = await host.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SpoofedHeadersQueryAndBodyAreReplacedByClaimValues()
    {
        var user = Guid.NewGuid();
        var request = ServiceHost.Request(HttpMethod.Post, "/api/suite/echo", host.Token(EduOSRoles.Student, user: user),
            JsonSerializer.Serialize(new { response = "my homework", schoolId = "" }));
        request.Headers.Add(TenantScopeMiddleware.UserHeader, Guid.NewGuid().ToString());
        request.Headers.Add(TenantScopeMiddleware.RoleHeader, EduOSRoles.SuperAdmin);
        var response = await host.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        Assert.Equal(user.ToString(), root.GetProperty("user").GetString());
        Assert.Equal(EduOSRoles.Student, root.GetProperty("role").GetString());
        Assert.Equal(host.School.ToString(), root.GetProperty("query").GetString());
        using var body = JsonDocument.Parse(root.GetProperty("body").GetString()!);
        Assert.Equal(host.School.ToString(), body.RootElement.GetProperty("schoolId").GetString());
        Assert.Equal("my homework", body.RootElement.GetProperty("response").GetString());
        Assert.Equal(EduOSRoles.Student, root.GetProperty("tenant").GetProperty("role").GetString());
    }
}

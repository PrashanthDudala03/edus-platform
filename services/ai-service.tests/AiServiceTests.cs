using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;
using EduOS.Ai.Gateway;
using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Xunit;

/// <summary>The real service composition (AiService.Configure and Map) hosted in process. Nothing listens on a port.</summary>
public sealed class AiHost : IAsyncDisposable
{
    public RSA SigningKey { get; } = RSA.Create(2048);
    public Guid School { get; } = Guid.NewGuid();
    public HttpClient Client { get; private set; } = null!;
    public IServiceProvider Services => app!.Services;
    /// <summary>Every log line the service wrote, at any level.</summary>
    public ConcurrentQueue<string> Logs { get; } = new();
    public AiDatabaseState Database => Services.GetRequiredService<AiDatabaseState>();
    WebApplication? app;

    /// <param name="database">A stand-in for database preparation. When given, the service is configured as if it had an AI database.</param>
    /// <param name="settings">Extra configuration, as the environment would supply it.</param>
    /// <param name="model">Replaces the configured chat provider.</param>
    public static async Task<AiHost> Start(bool enabled = false, IAiDatabaseBootstrap? database = null, Dictionary<string, string?>? settings = null, IModelProvider? model = null, TimeProvider? clock = null, IAiUsageStore? usage = null, IKnowledgeStore? knowledge = null, IEmbeddingProvider? embedding = null, EduOS.Ai.Tools.IAiToolAudit? toolAudit = null, HttpMessageHandler? eduos = null)
    {
        var host = new AiHost();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Logging.SetMinimumLevel(LogLevel.Trace);
        builder.Logging.AddProvider(new CapturingLogs(host.Logs));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["JWT_PUBLIC_KEY"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(host.SigningKey.ExportSubjectPublicKeyInfoPem())),
            ["JWT_ISSUER"] = "edus-auth-service",
            ["JWT_AUDIENCE"] = "edus-api",
            ["Ai:Enabled"] = enabled.ToString(),
            // Never opened: the stand-in replaces everything that would connect.
            ["ConnectionStrings:AiDb"] = database is null ? null : "Host=unused.invalid;Username=ai_app;Password=unused",
            ["ConnectionStrings:AiDbMigrations"] = database is null ? null : "Host=unused.invalid;Username=owner;Password=unused",
        });
        if (settings is not null) builder.Configuration.AddInMemoryCollection(settings);
        // The live session check needs auth-service; revocation is covered by the IAM integration tests.
        AiService.Configure(builder, events => events.OnTokenValidated = _ => Task.CompletedTask);
        if (database is not null) builder.Services.AddSingleton(database);
        if (model is not null) builder.Services.AddSingleton(model);
        if (clock is not null) builder.Services.AddSingleton(clock);
        // No test in this project reaches a real database unless it asks for one: schools are switched on with a large allowance.
        builder.Services.AddSingleton(usage ?? new InMemoryUsageStore());
        builder.Services.AddSingleton(knowledge ?? new InMemoryKnowledgeStore());
        if (embedding is not null) builder.Services.AddSingleton(embedding);
        builder.Services.AddSingleton(toolAudit ?? new InMemoryToolAudit());
        // Stands where the EduOS gateway would be. Without it the tools have nothing to call, and no test calls them.
        if (eduos is not null) builder.Services.AddSingleton<EduOS.Ai.Tools.IEduOsApi>(s => new EduOS.Ai.Tools.EduOsApi(
            EduOS.Ai.Tools.EduOsApi.Client(s.GetRequiredService<Microsoft.Extensions.Options.IOptions<EduOS.Ai.Tools.AiToolsOptions>>().Value, eduos), s.GetServices<EduOS.Ai.Tools.IAiTool>()));
        host.app = builder.Build();
        AiService.Map(host.app);
        await host.app.StartAsync();
        host.Client = host.app.GetTestClient();
        await host.Database.FirstAttempt.Task.WaitAsync(TimeSpan.FromSeconds(10));
        return host;
    }

    public string Token(string role = "Administrator", string scope = "school", Guid? school = null, RSA? signer = null, params string[] permissions)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new(ClaimTypes.Role, role), new(EduOSClaims.TokenVersion, "0"),
            new("data_scope", scope), new(EduOSClaims.SchoolId, (school ?? School).ToString()),
        };
        claims.AddRange(permissions.Select(p => new Claim("permission", p)));
        var now = DateTime.UtcNow;
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken("edus-auth-service", "edus-api", claims, now.AddMinutes(-1), now.AddMinutes(30),
            new SigningCredentials(new RsaSecurityKey(signer ?? SigningKey), SecurityAlgorithms.RsaSha256)));
    }

    public Task<HttpResponseMessage> Post(string url, string? token, string json)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return Client.SendAsync(request);
    }

    public const string Knowledge = "/api/ai/knowledge/documents";

    /// <summary>A multipart upload as a browser would send it. Null arguments leave the part out.</summary>
    public Task<HttpResponseMessage> Upload(string? token, string fileName, byte[] bytes, string? mediaType = "text/plain", string? audience = "school,teacher", string? title = null, string url = Knowledge, (string Name, string Value)[]? extra = null)
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        if (mediaType is not null) file.Headers.ContentType = MediaTypeHeaderValue.Parse(mediaType);
        form.Add(file, "file", fileName);
        if (audience is not null) form.Add(new StringContent(audience), "audience");
        if (title is not null) form.Add(new StringContent(title), "title");
        foreach (var (name, value) in extra ?? []) form.Add(new StringContent(value), name);
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = form };
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return Client.SendAsync(request);
    }

    public Task<HttpResponseMessage> Delete(string url, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Delete, url);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return Client.SendAsync(request);
    }

    public Task<HttpResponseMessage> Get(string url, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return Client.SendAsync(request);
    }

    public async ValueTask DisposeAsync()
    {
        if (app is not null) await app.DisposeAsync();
        SigningKey.Dispose();
    }
}

public sealed class CapturingLogs(ConcurrentQueue<string> lines) : ILoggerProvider
{
    public ILogger CreateLogger(string category) => new Writer(lines);
    public void Dispose() { }
    sealed class Writer(ConcurrentQueue<string> lines) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => lines.Enqueue(formatter(state, exception) + " " + exception);
    }
}

/// <param name="embedding">What the prepared database reports as its embedding space. By default the space of the fake provider.</param>
public sealed class StubBootstrap(bool works, EmbeddingSpaceStatus? embedding = null) : IAiDatabaseBootstrap
{
    public static readonly EmbeddingSpace FakeSpace = new(Guid.Parse("5b6a1c1e-0000-4000-8000-00000000fa4e"), "fake", "fake-embed-1", 16);
    public int Runs;
    public Task<EmbeddingSpaceStatus> Run(CancellationToken cancellation)
    {
        Runs++;
        return works ? Task.FromResult(embedding ?? new EmbeddingSpaceStatus(FakeSpace, null)) : Task.FromException<EmbeddingSpaceStatus>(new InvalidOperationException("no database"));
    }
}

public class AiServiceTests
{
    const string Use = "ai.assistant.use";

    [Fact]
    public async Task HealthIsAnonymousAndRevealsNothing()
    {
        await using var host = await AiHost.Start();
        var response = await host.Get("/api/ai/health", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"status\":\"ready\"}", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/api/ai/status")] [InlineData("/api/ai/assistant")] [InlineData("/api/ai/anything-else")]
    public async Task MissingTokenIsUnauthorized(string path)
    {
        await using var host = await AiHost.Start();
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Get(path, null)).StatusCode);
    }

    [Fact]
    public async Task TokenSignedWithAnotherKeyIsUnauthorized()
    {
        await using var host = await AiHost.Start();
        using var other = RSA.Create(2048);
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Get("/api/ai/status", host.Token(signer: other, permissions: Use))).StatusCode);
    }

    [Theory]
    [InlineData("Administrator", "school")] [InlineData("Teacher", "teacher")] [InlineData("Parent", "parent")] [InlineData("Student", "student")]
    public async Task StatusIsForbiddenWithoutTheAssistantPermission(string role, string scope)
    {
        await using var host = await AiHost.Start();
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Get("/api/ai/status", host.Token(role, scope, permissions: ["students.view", "ai.usage.view"]))).StatusCode);
    }

    [Fact]
    public async Task PlatformAdministratorHasNoSchoolAssistant()
    {
        await using var host = await AiHost.Start();
        var token = host.Token("SuperAdmin", "platform", EduOSTenants.Platform, null, "platform.manage", "ai.platform.manage", Use);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Get("/api/ai/status", token)).StatusCode);
    }

    [Theory]
    [InlineData(false, null, "not-configured")] [InlineData(true, null, "not-configured")] [InlineData(false, true, "not-configured")]
    [InlineData(true, false, "database-unavailable")] [InlineData(true, true, null)]
    public async Task StatusReportsAvailabilityAndNoSchoolData(bool configured, bool? databaseWorks, string? reason)
    {
        await using var host = await AiHost.Start(configured, databaseWorks is bool works ? new StubBootstrap(works) : null);
        Assert.Equal(databaseWorks == true, host.Database.Ready);
        var response = await host.Get("/api/ai/status", host.Token("Teacher", "teacher", permissions: Use));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(body).GetProperty("data");
        Assert.Equal(reason is null, data.GetProperty("enabled").GetBoolean());
        Assert.Equal(reason, data.GetProperty("reason").GetString());
        Assert.DoesNotContain(host.School.ToString(), body);
    }

    [Fact]
    public async Task CallerSuppliedSchoolIsRejected()
    {
        await using var host = await AiHost.Start();
        var token = host.Token(permissions: Use);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Get("/api/ai/status?schoolId=" + Guid.NewGuid(), token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.Get("/api/ai/status?schoolId=" + host.School, token)).StatusCode);
    }

    [Theory]
    [InlineData("/api/ai/sql")] [InlineData("/api/ai/models")] [InlineData("/api/ai")] [InlineData("/api/ai/admin/schools")] [InlineData("/api/ai/knowledge")] [InlineData("/api/ai/usage")]
    public async Task UnknownOrUnpermittedAiRoutesFailClosed(string path)
    {
        await using var host = await AiHost.Start(true);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Get(path, host.Token(permissions: Use))).StatusCode);
    }

    [Fact]
    public async Task NonAiRoutesAreNotServedHere()
    {
        await using var host = await AiHost.Start();
        Assert.Equal(HttpStatusCode.NotFound, (await host.Get("/api/students", host.Token(permissions: ["students.view", Use]))).StatusCode);
    }
}

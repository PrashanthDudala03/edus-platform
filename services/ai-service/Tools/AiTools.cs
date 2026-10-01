using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EduOS.Ai.Gateway;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;

namespace EduOS.Ai.Tools;

// Read-only tools over existing EduOS endpoints. A tool is code in this service: a fixed path, a fixed
// permission, a bounded input and a bounded output. Nothing here lets a model or a caller choose a URL, a
// school, a user or a query. Every call goes through the EduOS gateway with the caller's own token, so the
// gateway and the owning service authorize it exactly as they would for the user.

/// <summary>Bound from "Ai:Tools".</summary>
public sealed class AiToolsOptions
{
    public const string Section = "Ai:Tools";
    /// <summary>The EduOS gateway as this service reaches it inside the deployment.</summary>
    public string GatewayUrl { get; set; } = "http://api-gateway:5000";
    /// <summary>Upper bound for one tool, including every request it makes.</summary>
    public int TimeoutSeconds { get; set; } = 10;
    /// <summary>The largest response a tool reads. A larger one is refused, never truncated.</summary>
    public int MaxResponseBytes { get; set; } = 2 * 1024 * 1024;

    public static string? Problem(AiToolsOptions o) =>
        LocalEndpoint.Problem("Ai:Tools:GatewayUrl", o.GatewayUrl, true) is not null ? "Ai:Tools:GatewayUrl must be the EduOS gateway's address inside the deployment (loopback or private network), with no credentials and no query."
        : o.TimeoutSeconds is < 1 or > 60 ? "Ai:Tools:TimeoutSeconds must be between 1 and 60."
        : o.MaxResponseBytes is < 1024 or > 16 * 1024 * 1024 ? "Ai:Tools:MaxResponseBytes must be between 1 KB and 16 MB." : null;
}

public enum ToolParameterKind { Date, Integer, Choice }

/// <summary>One argument a tool accepts. There is no free text: a date, a bounded number or one of a few words.</summary>
public sealed record ToolParameter(string Name, ToolParameterKind Kind, string Description, int Minimum = 0, int Maximum = 0, IReadOnlyList<string>? Choices = null);

/// <param name="Name">Stable: what a caller, a log line and an audit row call the tool.</param>
/// <param name="Permission">The existing EduOS permission the endpoint behind the tool requires.</param>
/// <param name="Output">The fields the tool returns. It returns nothing else, whatever the endpoint sends.</param>
public sealed record ToolDefinition(string Name, string Purpose, string Permission, IReadOnlyList<ToolParameter> Parameters, IReadOnlyList<string> Output);

/// <summary>
/// Who a tool runs for: the verified tenant, the permissions in the verified token, and the token itself, which
/// is forwarded to EduOS and goes nowhere else. Not a record, so it is never printed.
/// </summary>
public sealed class ToolCaller(TenantContext tenant, string token, IEnumerable<string> permissions)
{
    public TenantContext Tenant => tenant;
    public IReadOnlySet<string> Permissions { get; } = new HashSet<string>(permissions, StringComparer.Ordinal);
    internal string Token => token;

    /// <summary>From an authenticated request. Null when it carries no bearer token to forward.</summary>
    public static ToolCaller? From(HttpContext http, TenantContext tenant)
    {
        var header = http.Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) || header.Length <= 7) return null;
        return new ToolCaller(tenant, header[7..].Trim(), http.User.FindAll("permission").Select(c => c.Value));
    }
}

/// <summary>Arguments after validation: only declared names, only declared kinds, only values inside their bounds.</summary>
public sealed class ToolArguments(IReadOnlyDictionary<string, object> values)
{
    public DateOnly? Date(string name) => values.TryGetValue(name, out var value) ? (DateOnly)value : null;
    public int? Integer(string name) => values.TryGetValue(name, out var value) ? (int)value : null;
    public string? Choice(string name) => values.TryGetValue(name, out var value) ? (string)value : null;

    /// <summary>Null when the arguments are not exactly what the tool declares.</summary>
    public static ToolArguments? Validate(ToolDefinition tool, JsonElement? arguments, DateOnly today)
    {
        var values = new Dictionary<string, object>();
        if (arguments is not { } given || given.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return new(values);
        if (given.ValueKind != JsonValueKind.Object) return null;
        foreach (var property in given.EnumerateObject())
        {
            // An argument the tool does not declare is refused, not ignored: there is no way to pass a school, a URL or a filter.
            if (tool.Parameters.FirstOrDefault(p => p.Name == property.Name) is not { } parameter || values.ContainsKey(property.Name)) return null;
            if (property.Value.ValueKind == JsonValueKind.Null) continue;
            switch (parameter.Kind)
            {
                case ToolParameterKind.Date:
                    // A day from the last year up to today, written yyyy-MM-dd.
                    if (property.Value.ValueKind != JsonValueKind.String || !DateOnly.TryParseExact(property.Value.GetString(), "yyyy-MM-dd", out var day) || day > today || day < today.AddDays(-366)) return null;
                    values[parameter.Name] = day; break;
                case ToolParameterKind.Integer:
                    if (property.Value.ValueKind != JsonValueKind.Number || !property.Value.TryGetInt32(out var number) || number < parameter.Minimum || number > parameter.Maximum) return null;
                    values[parameter.Name] = number; break;
                default:
                    if (property.Value.ValueKind != JsonValueKind.String || property.Value.GetString() is not { } word || !parameter.Choices!.Contains(word)) return null;
                    values[parameter.Name] = word; break;
            }
        }
        return new(values);
    }
}

/// <summary>How a tool ends when it has no data to return. The status is safe to show; nothing else is kept.</summary>
public sealed class ToolFailure(string status) : Exception(status) { public string Status => Message; }

/// <summary>Exactly one status. Data is present only for "ok", and holds only the fields the tool declares.</summary>
public sealed record ToolResult(string Tool, string Status, JsonObject? Data = null)
{
    public const string Ok = "ok", UnknownTool = "unknown-tool", NotPermitted = "not-permitted", InvalidArguments = "invalid-arguments", Denied = "denied",
        Unavailable = "unavailable", TooLarge = "too-large", NotConfigured = "not-configured", SchoolDisabled = "school-disabled", DatabaseUnavailable = "database-unavailable";
}

public interface IAiTool
{
    ToolDefinition Definition { get; }
    /// <summary>The EduOS paths this tool reads. The API client refuses any other.</summary>
    IReadOnlyList<string> Paths { get; }
    Task<JsonObject> Run(ToolCaller caller, ToolArguments arguments, IEduOsApi api, DateOnly today, CancellationToken cancellation);
}

/// <summary>The only way a tool reaches EduOS: a GET of a registered path, as the caller.</summary>
public interface IEduOsApi
{
    Task<JsonElement> Get(string path, IReadOnlyDictionary<string, string>? query, ToolCaller caller, CancellationToken cancellation);
}

public sealed class EduOsApi(HttpClient http, IEnumerable<IAiTool> tools) : IEduOsApi
{
    readonly HashSet<string> allowed = tools.SelectMany(t => t.Paths).ToHashSet(StringComparer.Ordinal);

    /// <param name="network">Replaces the network in tests.</param>
    public static HttpClient Client(AiToolsOptions options, HttpMessageHandler? network = null) =>
        new(network ?? new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false, UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(5), PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
        {
            BaseAddress = new Uri(options.GatewayUrl.TrimEnd('/') + "/"), Timeout = Timeout.InfiniteTimeSpan, MaxResponseContentBufferSize = options.MaxResponseBytes,
        };

    public async Task<JsonElement> Get(string path, IReadOnlyDictionary<string, string>? query, ToolCaller caller, CancellationToken cancellation)
    {
        // A path is one of the constants the tools declare. Nothing computed, relative or absolute gets through.
        if (!allowed.Contains(path)) throw new InvalidOperationException("This path is not registered for any tool.");
        var address = path.TrimStart('/') + (query is { Count: > 0 } ? "?" + string.Join("&", query.Select(q => Uri.EscapeDataString(q.Key) + "=" + Uri.EscapeDataString(q.Value))) : "");
        using var request = new HttpRequestMessage(HttpMethod.Get, address);
        // The caller's own token: EduOS decides what this user may read. This service has no credential of its own.
        request.Headers.Authorization = new("Bearer", caller.Token);
        HttpResponseMessage response;
        try { response = await http.SendAsync(request, cancellation); }
        catch (HttpRequestException) { throw new ToolFailure(ToolResult.Unavailable); }
        using (response)
        {
            // The body of an error is never read or passed on.
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) throw new ToolFailure(ToolResult.Denied);
            if (!response.IsSuccessStatusCode) throw new ToolFailure(ToolResult.Unavailable);
            try { return JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsByteArrayAsync(cancellation)); }
            catch (JsonException) { throw new ToolFailure(ToolResult.Unavailable); }
        }
    }
}

/// <summary>What is kept about a tool call: which tool, how it ended and how long it took. Never arguments or returned data.</summary>
public interface IAiToolAudit
{
    Task Record(TenantContext tenant, string tool, string status, int milliseconds, CancellationToken cancellation);
}

public sealed class PostgresAiToolAudit(AiDatabase database) : IAiToolAudit
{
    public Task Record(TenantContext tenant, string tool, string status, int milliseconds, CancellationToken cancellation) =>
        database.InSchool(tenant, async (connection, transaction, token) =>
        {
            await using var insert = new Npgsql.NpgsqlCommand("INSERT INTO ai.audit (school_id, user_id, action, detail) VALUES (@school, @user, 'tool.call', @detail::jsonb)", connection, transaction);
            insert.Parameters.AddWithValue("school", tenant.SchoolId); insert.Parameters.AddWithValue("user", tenant.UserId);
            insert.Parameters.AddWithValue("detail", new JsonObject { ["tool"] = tool, ["status"] = status, ["ms"] = milliseconds }.ToJsonString());
            return await insert.ExecuteNonQueryAsync(token);
        }, cancellation);
}

/// <summary>
/// The tools that exist, and the one way to run one. A tool runs only if it is registered, the caller's verified
/// token holds its permission, the arguments are exactly what it declares, and the school has AI switched on.
/// EduOS then authorizes the request again on its own. The result is the tool's declared fields or a status.
/// </summary>
public sealed class AiToolRegistry(IOptions<AiOptions> ai, IOptions<AiToolsOptions> options, AiDatabaseState database, IAiUsageStore schools, IEnumerable<IAiTool> tools,
    IEduOsApi api, IAiToolAudit audit, TimeProvider clock, ILogger<AiToolRegistry> logger)
{
    readonly IReadOnlyDictionary<string, IAiTool> byName = tools.ToDictionary(t => t.Definition.Name, StringComparer.Ordinal);

    public IReadOnlyList<ToolDefinition> All => byName.Values.Select(t => t.Definition).OrderBy(d => d.Name, StringComparer.Ordinal).ToList();

    /// <summary>The tools this caller's token permits. A platform administrator has no school and is offered none.</summary>
    public IReadOnlyList<ToolDefinition> Offered(ToolCaller caller) =>
        caller.Tenant.IsPlatform ? [] : All.Where(d => caller.Permissions.Contains(d.Permission)).ToList();

    /// <param name="name">Compared exactly with the registered names. Anything else is an unknown tool.</param>
    /// <param name="arguments">A JSON object of the tool's declared arguments, or nothing.</param>
    public async Task<ToolResult> Execute(ToolCaller caller, string? name, JsonElement? arguments, CancellationToken cancellation)
    {
        var known = name is not null && byName.ContainsKey(name);
        // The name of an unknown tool came from outside and is not repeated in a result, a log or an audit row.
        var label = known ? name! : "unknown";
        if (!ai.Value.Enabled || !database.Configured) return new(label, ToolResult.NotConfigured);
        if (!database.Ready) return new(label, ToolResult.DatabaseUnavailable);
        var clockwatch = Stopwatch.StartNew();
        if (caller.Tenant.IsPlatform) return new(label, ToolResult.NotPermitted);
        if (!known) return await Finish(caller, label, ToolResult.UnknownTool, null, clockwatch, cancellation);
        var tool = byName[name!];
        if (!caller.Permissions.Contains(tool.Definition.Permission)) return await Finish(caller, label, ToolResult.NotPermitted, null, clockwatch, cancellation);
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (ToolArguments.Validate(tool.Definition, arguments, today) is not { } valid) return await Finish(caller, label, ToolResult.InvalidArguments, null, clockwatch, cancellation);

        try { if (!(await schools.Summary(caller.Tenant, cancellation)).Enabled) return await Finish(caller, label, ToolResult.SchoolDisabled, null, clockwatch, cancellation); }
        catch (Exception ex) when (ex is not OperationCanceledException) { return new(label, ToolResult.DatabaseUnavailable); }

        string status; JsonObject? data = null;
        using (var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
        {
            limit.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
            try { data = await tool.Run(caller, valid, api, today, limit.Token).WaitAsync(limit.Token); status = ToolResult.Ok; }
            catch (ToolFailure failure) { status = failure.Status; }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
            // A timeout, or anything unexpected in the response: the caller learns only that the tool is unavailable.
            catch (Exception) { status = ToolResult.Unavailable; }
        }
        return await Finish(caller, label, status, data, clockwatch, cancellation);
    }

    // The call is recorded before its result is returned. If it cannot be recorded, the data is withheld.
    async Task<ToolResult> Finish(ToolCaller caller, string tool, string status, JsonObject? data, Stopwatch clockwatch, CancellationToken cancellation)
    {
        var milliseconds = (int)clockwatch.ElapsedMilliseconds;
        try { await audit.Record(caller.Tenant, tool, status, milliseconds, status == ToolResult.Ok ? CancellationToken.None : cancellation); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("AI tool call could not be recorded ({Error})", ex.GetType().Name);
            return new(tool, ToolResult.DatabaseUnavailable);
        }
        logger.LogInformation("AI tool {Tool}: {Status}, {Milliseconds} ms", tool, status, milliseconds);
        return new(tool, status, status == ToolResult.Ok ? data : null);
    }
}

/// <summary>Helpers for reading an EduOS response without trusting its shape or its text.</summary>
static partial class ToolJson
{
    public static JsonElement Property(JsonElement element, string name, JsonValueKind kind) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == kind ? value : throw new ToolFailure(ToolResult.Unavailable);
    public static int Count(JsonElement element, string name) =>
        Property(element, name, JsonValueKind.Number).TryGetInt32(out var number) && number >= 0 ? number : throw new ToolFailure(ToolResult.Unavailable);
    public static decimal Money(JsonElement element, string name) =>
        Property(element, name, JsonValueKind.Number).TryGetDecimal(out var amount) ? amount : throw new ToolFailure(ToolResult.Unavailable);
    public static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    /// <summary>Text someone typed into EduOS, kept on one line and short. It is data for a reader, never an instruction.</summary>
    public static string Label(string? value, int max = 120)
    {
        var line = Whitespace().Replace(value ?? "", " ").Trim();
        return line.Length > max ? line[..max] : line;
    }
    [GeneratedRegex(@"\s+")] private static partial Regex Whitespace();
}

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Extensions;

namespace EduOS.ServiceAuth;

public sealed class TenantScopeOptions
{
    /// <summary>Requests under this prefix are tenant data requests ("/api/v1" at the gateway, "/api" in services).</summary>
    public string PathPrefix { get; init; } = "/api";
    /// <summary>Exact paths that carry no tenant scope (health, login, refresh, reset-password).</summary>
    public HashSet<string> AnonymousPaths { get; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Scopes every tenant data request to the school claim in the verified access
/// token. A caller cannot switch schools by editing query strings, JSON bodies,
/// path segments or X-EduOS-* headers: mismatches are rejected and the values
/// forwarded to handlers are rewritten from the claims. The gateway and every
/// service run this, so a request that bypasses the gateway is held to the
/// same rules.
/// </summary>
public sealed class TenantScopeMiddleware(RequestDelegate next, TenantScopeOptions options)
{
    public const string UserHeader = "X-EduOS-User";
    public const string RoleHeader = "X-EduOS-Role";
    public const string SchoolHeader = "X-EduOS-School";

    public async Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        if (!request.Path.StartsWithSegments(options.PathPrefix) || options.AnonymousPaths.Contains(request.Path.Value ?? string.Empty))
        {
            await next(context);
            return;
        }

        if (context.User.Identity?.IsAuthenticated != true)
        {
            await Reject(context, StatusCodes.Status401Unauthorized, "Authentication is required.");
            return;
        }
        if (!TenantContext.TryFrom(context.User, out var tenant))
        {
            await Reject(context, StatusCodes.Status403Forbidden, "A valid school scope is required.");
            return;
        }
        context.SetTenant(tenant);

        // Headers are derived from the verified token only; anything the caller sent is discarded.
        request.Headers[UserHeader] = tenant.UserId.ToString();
        request.Headers[RoleHeader] = tenant.Role;
        request.Headers[SchoolHeader] = tenant.SchoolId.ToString();

        var requestedSchoolIds = request.Query
            .Where(pair => string.Equals(pair.Key, "schoolId", StringComparison.OrdinalIgnoreCase))
            .SelectMany(pair => pair.Value)
            .Where(value => !string.IsNullOrWhiteSpace(value));
        if (requestedSchoolIds.Any(value => !Guid.TryParse(value, out var requested) || requested != tenant.SchoolId))
        {
            await Reject(context, StatusCodes.Status403Forbidden, "The requested school is outside your account scope.");
            return;
        }

        var schoolsPath = new PathString(options.PathPrefix).Add("/schools");
        if (request.Path.StartsWithSegments(schoolsPath, out var schoolPath) && schoolPath.HasValue)
        {
            var pathSchoolId = schoolPath.Value!.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (pathSchoolId is not null && Guid.TryParse(pathSchoolId, out var requestedPathSchoolId) && requestedPathSchoolId != tenant.SchoolId)
            {
                await Reject(context, StatusCodes.Status403Forbidden, "The requested school is outside your account scope.");
                return;
            }
        }

        var query = new QueryBuilder();
        foreach (var pair in request.Query)
        {
            if (string.Equals(pair.Key, "schoolId", StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var value in pair.Value) query.Add(pair.Key, value ?? string.Empty);
        }
        query.Add("schoolId", tenant.SchoolId.ToString());
        request.QueryString = query.ToQueryString();

        if (request.HasJsonContentType() && (request.ContentLength.GetValueOrDefault() > 0 || request.Headers.ContainsKey("Transfer-Encoding")))
        {
            request.EnableBuffering();
            string body;
            using (var reader = new StreamReader(request.Body, leaveOpen: true)) body = await reader.ReadToEndAsync();
            request.Body.Position = 0;

            JsonNode? payload;
            try { payload = JsonNode.Parse(body); }
            catch (JsonException)
            {
                await Reject(context, StatusCodes.Status400BadRequest, "Invalid JSON body.");
                return;
            }
            if (payload is JsonObject jsonObject)
            {
                if (jsonObject.Count(item => string.Equals(item.Key, "schoolId", StringComparison.OrdinalIgnoreCase)) > 1)
                {
                    await Reject(context, StatusCodes.Status400BadRequest, "Duplicate school scope.");
                    return;
                }
                var schoolField = jsonObject.Select(item => item.Key)
                    .FirstOrDefault(key => string.Equals(key, "schoolId", StringComparison.OrdinalIgnoreCase)) ?? "schoolId";
                var bodySchool = jsonObject[schoolField]?.ToString();
                if (!string.IsNullOrWhiteSpace(bodySchool) &&
                    (!Guid.TryParse(bodySchool, out var requestedBodySchoolId) || requestedBodySchoolId != tenant.SchoolId))
                {
                    await Reject(context, StatusCodes.Status403Forbidden, "The requested school is outside your account scope.");
                    return;
                }
                jsonObject[schoolField] = tenant.SchoolId.ToString();
                var rewrittenBody = JsonSerializer.SerializeToUtf8Bytes(payload);
                request.Body = new MemoryStream(rewrittenBody);
                request.ContentLength = rewrittenBody.Length;
            }
        }

        await next(context);
    }

    private static Task Reject(HttpContext context, int statusCode, string message)
    {
        context.Response.StatusCode = statusCode;
        return context.Response.WriteAsJsonAsync(new { statusCode, message });
    }
}

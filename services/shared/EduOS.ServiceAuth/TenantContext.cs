using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace EduOS.ServiceAuth;

/// <summary>
/// The tenant scope of the current request, derived only from claims in the
/// verified access token. Handlers take this instead of trusting a schoolId
/// query parameter, a JSON field or an X-EduOS-* header.
/// </summary>
public sealed record TenantContext(Guid SchoolId, Guid UserId, string Role)
{
    public bool IsAdministrator => Role == EduOSRoles.Administrator;
    public bool IsLeadership => Role is EduOSRoles.Administrator or EduOSRoles.Principal;
    /// <summary>True only for a SuperAdmin token issued in the platform tenant.</summary>
    public bool IsPlatform => Role == EduOSRoles.SuperAdmin && SchoolId == EduOSTenants.Platform;

    public static bool TryFrom(ClaimsPrincipal user, out TenantContext tenant)
    {
        tenant = null!;
        if (user.Identity?.IsAuthenticated != true) return false;
        var role = user.FindFirst(ClaimTypes.Role)?.Value;
        if (!Guid.TryParse(user.FindFirst(EduOSClaims.SchoolId)?.Value, out var schoolId) ||
            !Guid.TryParse(user.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId) ||
            role is null || !EduOSRoles.All.Contains(role))
        {
            return false;
        }
        tenant = new TenantContext(schoolId, userId, role);
        return true;
    }
}

public static class TenantContextExtensions
{
    private const string ItemKey = "EduOS.TenantContext";

    internal static void SetTenant(this HttpContext http, TenantContext tenant) => http.Items[ItemKey] = tenant;

    public static TenantContext? TryGetTenant(this HttpContext http)
    {
        if (http.Items.TryGetValue(ItemKey, out var stored) && stored is TenantContext tenant) return tenant;
        return TenantContext.TryFrom(http.User, out var derived) ? derived : null;
    }

    /// <summary>Returns the verified tenant scope or throws when the request carries none.</summary>
    public static TenantContext GetTenant(this HttpContext http) =>
        http.TryGetTenant() ?? throw new UnauthorizedAccessException("A valid school scope is required.");
}

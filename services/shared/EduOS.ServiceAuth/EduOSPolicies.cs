namespace EduOS.ServiceAuth;

/// <summary>The fixed role names issued by auth-service in the access token.</summary>
public static class EduOSRoles
{
    /// <summary>Platform operator. Exists only in the platform tenant and never inside a school.</summary>
    public const string SuperAdmin = "SuperAdmin";
    /// <summary>Operational administrator of one school.</summary>
    public const string Administrator = "Administrator";
    /// <summary>Academic head of one school: reads the whole school, writes academic oversight records.</summary>
    public const string Principal = "Principal";
    public const string Teacher = "Teacher";
    public const string Parent = "Parent";
    public const string Student = "Student";
    /// <summary>Roles that belong to a school tenant.</summary>
    public static readonly string[] School = [Administrator, Principal, Teacher, Parent, Student];
    public static readonly string[] All = [SuperAdmin, .. School];
}

/// <summary>Reserved tenants that are not schools.</summary>
public static class EduOSTenants
{
    /// <summary>Tenant id carried in the school_id claim of platform SuperAdmin tokens. No school uses it.</summary>
    public static readonly Guid Platform = Guid.Parse("00000000-0000-0000-0000-00000000e005");
}

/// <summary>
/// Authorization policy names. Every endpoint in every service names one of
/// these explicitly; the fallback policy only guarantees authentication.
/// </summary>
public static class EduOSPolicies
{
    /// <summary>Platform administration across schools: SuperAdmin in the platform tenant only.</summary>
    public const string Platform = "EduOSPlatform";
    /// <summary>School administration: Administrator only.</summary>
    public const string Administrators = "EduOSAdministrators";
    /// <summary>School leadership that may read the whole school: Administrator and Principal.</summary>
    public const string Leadership = "EduOSLeadership";
    /// <summary>Leadership plus Teacher.</summary>
    public const string Staff = "EduOSStaff";
    /// <summary>Every school role, including Parent and Student. Platform SuperAdmin is not a school user.</summary>
    public const string Suite = "EduOSSuite";
    /// <summary>Any signed-in EduOS role, platform included. Only for the caller's own account (session check, sign-out).</summary>
    public const string AnyRole = "EduOSAnyRole";
}

/// <summary>Custom claim names written by auth-service.</summary>
public static class EduOSClaims
{
    public const string SchoolId = "school_id";
    public const string TokenVersion = "token_version";
}

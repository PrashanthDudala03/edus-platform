namespace EduOS.ServiceAuth;

/// <summary>The fixed role names issued by auth-service in the access token.</summary>
public static class EduOSRoles
{
    public const string SuperAdmin = "SuperAdmin";
    public const string Principal = "Principal";
    public const string Teacher = "Teacher";
    public const string Parent = "Parent";
    public const string Student = "Student";
    public static readonly string[] All = [SuperAdmin, Principal, Teacher, Parent, Student];
}

/// <summary>
/// Authorization policy names. Every endpoint in every service names one of
/// these explicitly; the fallback policy only guarantees authentication.
/// </summary>
public static class EduOSPolicies
{
    /// <summary>School administration: SuperAdmin and Principal.</summary>
    public const string Administrators = "EduOSAdministrators";
    /// <summary>Administrators plus Teacher.</summary>
    public const string Staff = "EduOSStaff";
    /// <summary>Every signed-in school role, including Parent and Student.</summary>
    public const string Suite = "EduOSSuite";
}

/// <summary>Custom claim names written by auth-service.</summary>
public static class EduOSClaims
{
    public const string SchoolId = "school_id";
    public const string TokenVersion = "token_version";
}

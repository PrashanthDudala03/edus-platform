namespace Services.Auth.Models;

public class PermissionDefinition
{
    public string Key { get; set; } = "";
    public string Module { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public bool Delegatable { get; set; } = true;
}
public class RoleTemplate
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string DataScope { get; set; } = "school";
    public bool Enabled { get; set; } = true;
    public bool Assignable { get; set; } = true;
    public string[] Maximum { get; set; } = [];
    public string[] Defaults { get; set; } = [];
}
public class SchoolAccessBoundary
{
    public Guid SchoolId { get; set; }
    public string[] Allowed { get; set; } = [];
    public string SignupCode { get; set; } = "";
}
public class SignupRequest
{
    public Guid Id { get; set; }
    public Guid SchoolId { get; set; }
    public string Email { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string RequestedRole { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public Guid? ApprovedRole { get; set; }
    public Guid? UserId { get; set; }
    public Guid? ReviewedBy { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

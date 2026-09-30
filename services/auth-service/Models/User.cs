namespace Services.Auth.Models;

public class User
{
    public Guid Id { get; set; }
    public Guid SchoolId { get; set; }
    public required string Username { get; set; }
    public required string Email { get; set; }
    public required string PasswordHash { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? PhoneNumber { get; set; }
    public int TokenVersion { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? RoleId { get; set; }
    public Role? Role { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string[] EffectivePermissions { get; set; } = [];
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string DataScope { get; set; } = "none";
    /// <summary>Set by Iam.Hydrate when the role or its template is disabled. Never persisted, so re-enabling the role restores access.</summary>
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public bool AccessSuspended { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public bool CanSignIn => IsActive && !AccessSuspended;

    public UserDto ToDto() => new()
    {
        Id = Id.ToString(),
        Username = Username,
        Email = Email,
        FirstName = FirstName,
        LastName = LastName,
        SchoolId = SchoolId.ToString(),
        Roles = Role is null ? Array.Empty<string>() : new[] { Role.Name },
        Permissions = EffectivePermissions,
        DataScope = DataScope
    };
}

public class Role
{
    public Guid? TemplateId { get; set; }
    public bool Enabled { get; set; } = true;
    public bool Assignable { get; set; } = true;
    public string Description { get; set; } = "";
    public Guid Id { get; set; }
    public Guid SchoolId { get; set; }
    public required string Name { get; set; }
    public List<RolePermission> Permissions { get; set; } = [];
}

public class RolePermission
{
    public Guid Id { get; set; }
    public Guid RoleId { get; set; }
    public required string PermissionKey { get; set; }
}

public class UserDto
{
    public string DataScope { get; set; } = "none";
    public required string Id { get; set; }
    public required string Username { get; set; }
    public required string Email { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public required string SchoolId { get; set; }
    public required string[] Roles { get; set; }
    public required string[] Permissions { get; set; }
}

public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid SchoolId { get; set; }
    public Guid UserId { get; set; }
    public required string Token { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

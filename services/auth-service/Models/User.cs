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
    public bool IsActive { get; set; } = true;
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? RoleId { get; set; }
    public Role? Role { get; set; }

    public UserDto ToDto() => new()
    {
        Id = Id.ToString(),
        Username = Username,
        Email = Email,
        FirstName = FirstName,
        LastName = LastName,
        SchoolId = SchoolId.ToString(),
        Roles = Role is null ? Array.Empty<string>() : new[] { Role.Name },
        Permissions = Role?.Permissions.Select(permission => permission.PermissionKey).Distinct().ToArray() ?? Array.Empty<string>()
    };
}

public class Role
{
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

using EduOS.ServiceAuth;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Services.Auth.Data;
using Services.Auth.Models;

/// <summary>
/// Applies the role-model migration and provisions the optional platform SuperAdmin.
/// See Migrations/20260930_01_role_model.sql and docs/MIGRATIONS.md.
/// </summary>
public static class RoleModel
{
    public const string MigrationFile = "Migrations/20260930_01_role_model.sql";

    public static async Task Apply(AuthDbContext db)
    {
        var sql = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, MigrationFile));
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync(sql);
        await transaction.CommitAsync();
    }

    /// <summary>
    /// Creates the platform SuperAdmin from EDUOS_PLATFORM_ADMIN_USERNAME / _EMAIL / _PASSWORD when all
    /// three are set. An existing account with that username is never changed, so a restart cannot reset
    /// a password. Nothing happens when the variables are absent.
    /// </summary>
    public static async Task ProvisionPlatformAdmin(AuthDbContext db, IConfiguration configuration)
    {
        var username = configuration["EDUOS_PLATFORM_ADMIN_USERNAME"]?.Trim();
        var email = configuration["EDUOS_PLATFORM_ADMIN_EMAIL"]?.Trim();
        var password = configuration["EDUOS_PLATFORM_ADMIN_PASSWORD"];
        if (string.IsNullOrWhiteSpace(username) && string.IsNullOrWhiteSpace(email) && string.IsNullOrEmpty(password)) return;
        if (string.IsNullOrWhiteSpace(username) || username.Length > 100 || !System.Net.Mail.MailAddress.TryCreate(email, out _) ||
            string.IsNullOrEmpty(password) || password.Length < 16 || System.Text.Encoding.UTF8.GetByteCount(password) > 72)
            throw new InvalidOperationException("EDUOS_PLATFORM_ADMIN_* must set a username, a valid email and a password of 16-72 characters.");

        var platform = EduOSTenants.Platform;
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO auth_db.roles (id, school_id, name, description, is_system_role, created_at, updated_at)
            VALUES ({Guid.NewGuid()}, {platform}, {EduOSRoles.SuperAdmin}, 'EduOS platform administrator', TRUE, NOW(), NOW())
            ON CONFLICT (school_id, name) DO NOTHING
            """);
        if (await db.Users.AnyAsync(u => u.SchoolId == platform && u.Username == username)) return;
        var roleId = await db.Roles.Where(r => r.SchoolId == platform && r.Name == EduOSRoles.SuperAdmin).Select(r => r.Id).SingleAsync();
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(), SchoolId = platform, Username = username, Email = email!,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password, workFactor: 12),
            FirstName = "Platform", LastName = "Administrator", RoleId = roleId, IsActive = true,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        Log.Information("Provisioned platform SuperAdmin {Username}", username);
    }

    /// <summary>Whether users of this tenant may sign in. The platform tenant is not a school and is always active.</summary>
    public static async Task<bool> SchoolIsActive(AuthDbContext db, Guid schoolId)
    {
        if (schoolId == EduOSTenants.Platform) return true;
        var rows = await db.Database.SqlQuery<bool>($"""
            SELECT COALESCE(is_active, TRUE) AS "Value" FROM school_db.schools WHERE id = {schoolId} AND deleted_at IS NULL
            """).ToListAsync();
        return rows.Count == 1 && rows[0];
    }
}

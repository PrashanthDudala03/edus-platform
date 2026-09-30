using EduOS.ServiceAuth;
using Microsoft.EntityFrameworkCore;
using Services.Auth.Data;
using Services.Auth.Models;

/// <summary>
/// Platform administration across schools. Every endpoint requires the EduOSPlatform policy: the SuperAdmin
/// role in the reserved platform tenant. Target schools are named in the path, never taken from the caller's
/// tenant, and the platform tenant itself can never be a target.
/// </summary>
public static class PlatformAdmin
{
    static readonly string[] Tiers = ["trial", "standard", "premium"];
    static readonly (string Name, string Description)[] SchoolRoles =
    [
        (EduOSRoles.Administrator, "School administrator"),
        (EduOSRoles.Principal, "School principal"),
        (EduOSRoles.Teacher, "Assigned classes and teaching"),
        (EduOSRoles.Parent, "Linked student family portal"),
        (EduOSRoles.Student, "Personal learning portal"),
    ];

    public static void Map(WebApplication app)
    {
        var platform = app.MapGroup("/api/platform").RequireAuthorization(EduOSPolicies.Platform);
        var p = EduOSTenants.Platform;

        platform.MapGet("/overview", async (AuthDbContext db) =>
        {
            var schools = (await db.Database.SqlQuery<SchoolTotals>($"""
                SELECT count(*)::int AS "Total", count(*) FILTER (WHERE COALESCE(is_active, TRUE))::int AS "Active"
                FROM school_db.schools WHERE deleted_at IS NULL AND id <> {p}
                """).ToListAsync())[0];
            var roles = await db.Database.SqlQuery<RoleCount>($"""
                SELECT r.name AS "Role", count(u.id)::int AS "Count", count(u.id) FILTER (WHERE u.is_active)::int AS "Active"
                FROM auth_db.users u JOIN auth_db.roles r ON r.id = u.role_id
                WHERE u.deleted_at IS NULL AND u.school_id <> {p} GROUP BY r.name ORDER BY r.name
                """).ToListAsync();
            var students = (await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM student_db.students WHERE deleted_at IS NULL").ToListAsync())[0];
            var recent = await ListSchools(db, "", "all", 5, "s.created_at DESC");
            return Results.Ok(new { data = new
            {
                schools = new { total = schools.Total, active = schools.Active, inactive = schools.Total - schools.Active },
                users = new { total = roles.Sum(r => r.Count), active = roles.Sum(r => r.Active), byRole = roles },
                students, recentSchools = recent
            } });
        });

        platform.MapGet("/schools", async (AuthDbContext db, string? search, string? status) =>
        {
            var filter = status is "active" or "inactive" ? status : "all";
            if ((search?.Length ?? 0) > 100) return Results.BadRequest(new { message = "Search must be at most 100 characters." });
            return Results.Ok(new { data = await ListSchools(db, search?.Trim() ?? "", filter, 200, "s.name") });
        });

        platform.MapGet("/schools/{id:guid}", async (Guid id, AuthDbContext db) =>
        {
            if (id == p) return Results.NotFound(new { message = "School not found." });
            var school = (await db.Database.SqlQueryRaw<SchoolRow>(SchoolSelect + " WHERE s.deleted_at IS NULL AND s.id = {0}", id).ToListAsync()).FirstOrDefault();
            if (school is null) return Results.NotFound(new { message = "School not found." });
            var roles = await db.Database.SqlQuery<RoleCount>($"""
                SELECT r.name AS "Role", count(u.id)::int AS "Count", count(u.id) FILTER (WHERE u.is_active)::int AS "Active"
                FROM auth_db.roles r LEFT JOIN auth_db.users u ON u.role_id = r.id AND u.deleted_at IS NULL
                WHERE r.school_id = {id} GROUP BY r.name ORDER BY r.name
                """).ToListAsync();
            var administrators = await db.Users.Where(u => u.SchoolId == id && u.Role != null && u.Role.Name == EduOSRoles.Administrator)
                .OrderBy(u => u.CreatedAt)
                .Select(u => new { u.Id, u.Username, u.Email, u.FirstName, u.LastName, u.IsActive, u.LastLoginAt }).ToListAsync();
            return Results.Ok(new { data = new { school, roles, administrators } });
        });

        platform.MapPost("/schools", async (PlatformSchoolRequest request, AuthDbContext db) =>
        {
            var name = request.Name?.Trim() ?? "";
            var tier = string.IsNullOrWhiteSpace(request.SubscriptionTier) ? "trial" : request.SubscriptionTier.Trim();
            if (name.Length is < 1 or > 255 || (request.PrincipalName?.Length ?? 0) > 255 || !Tiers.Contains(tier))
                return Results.BadRequest(new { message = "Enter a school name (up to 255 characters) and a plan of trial, standard or premium." });
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended('eduos-platform-schools', 0))");
            if ((await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM school_db.schools WHERE deleted_at IS NULL AND lower(name) = lower({name})").ToListAsync())[0] > 0)
                return Results.Conflict(new { message = "A school with this name already exists." });
            var id = Guid.NewGuid();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO school_db.schools (id, name, principal_name, is_active, subscription_tier, created_at, updated_at)
                VALUES ({id}, {name}, {request.PrincipalName?.Trim()}, TRUE, {tier}, NOW(), NOW())
                """);
            await EnsureSchoolRoles(db, id);
            await tx.CommitAsync();
            return Results.Json(new { data = new { id } }, statusCode: 201);
        });

        platform.MapPut("/schools/{id:guid}", async (Guid id, PlatformSchoolRequest request, AuthDbContext db) =>
        {
            if (id == p) return Results.NotFound(new { message = "School not found." });
            var name = request.Name?.Trim();
            var tier = request.SubscriptionTier?.Trim();
            if ((name is not null && name.Length is < 1 or > 255) || (request.PrincipalName?.Length ?? 0) > 255 || (tier is not null && !Tiers.Contains(tier)))
                return Results.BadRequest(new { message = "Enter a school name (up to 255 characters) and a plan of trial, standard or premium." });
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended('eduos-platform-schools', 0))");
            var current = (await db.Database.SqlQueryRaw<SchoolRow>(SchoolSelect + " WHERE s.deleted_at IS NULL AND s.id = {0}", id).ToListAsync()).FirstOrDefault();
            if (current is null) return Results.NotFound(new { message = "School not found." });
            if (name is not null && !string.Equals(name, current.Name, StringComparison.OrdinalIgnoreCase) &&
                (await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM school_db.schools WHERE deleted_at IS NULL AND id <> {id} AND lower(name) = lower({name})").ToListAsync())[0] > 0)
                return Results.Conflict(new { message = "A school with this name already exists." });
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE school_db.schools SET name = COALESCE({name}, name), principal_name = COALESCE({request.PrincipalName?.Trim()}, principal_name),
                subscription_tier = COALESCE({tier}, subscription_tier), is_active = COALESCE({request.IsActive}, is_active), updated_at = NOW()
                WHERE id = {id}
                """);
            if (request.IsActive == false && current.IsActive)
            {
                // Deactivation ends every session in the school now, and re-activation later cannot revive them.
                await db.Users.Where(u => u.SchoolId == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.TokenVersion, u => u.TokenVersion + 1));
                await db.RefreshTokens.IgnoreQueryFilters().Where(t => t.SchoolId == id && t.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
            }
            await tx.CommitAsync();
            return Results.Ok(new { message = request.IsActive == false ? "School deactivated. Its users have been signed out." : "School saved." });
        });

        platform.MapPost("/schools/{id:guid}/administrators", async (Guid id, PlatformAdministratorRequest request, AuthDbContext db) =>
        {
            if (id == p) return Results.NotFound(new { message = "School not found." });
            if ((await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM school_db.schools WHERE deleted_at IS NULL AND id = {id}").ToListAsync())[0] != 1)
                return Results.NotFound(new { message = "School not found." });
            var username = request.Username?.Trim() ?? "";
            var email = request.Email?.Trim() ?? "";
            if (username.Length is < 3 or > 100 || string.IsNullOrWhiteSpace(request.FirstName) || request.FirstName.Length > 100 ||
                string.IsNullOrWhiteSpace(request.LastName) || request.LastName.Length > 100 || !System.Net.Mail.MailAddress.TryCreate(email, out _) ||
                (request.Password?.Length ?? 0) < 16 || System.Text.Encoding.UTF8.GetByteCount(request.Password!) > 72)
                return Results.BadRequest(new { message = "Enter valid account details and a password between 16 and 72 characters." });
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({id.ToString()}, 0))");
            if (await db.Users.AnyAsync(u => u.SchoolId == id && (u.Username == username || u.Email == email)))
                return Results.Conflict(new { message = "That username or email already exists in this school." });
            await EnsureSchoolRoles(db, id);
            var roleId = await db.Roles.Where(r => r.SchoolId == id && r.Name == EduOSRoles.Administrator).Select(r => r.Id).SingleAsync();
            var user = new User
            {
                Id = Guid.NewGuid(), SchoolId = id, Username = username, Email = email, FirstName = request.FirstName.Trim(), LastName = request.LastName.Trim(),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password, workFactor: 12), RoleId = roleId, IsActive = true,
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.Json(new { data = new { user.Id, user.Username, user.Email } }, statusCode: 201);
        });
    }

    const string SchoolSelect = """
        SELECT s.id AS "Id", s.name AS "Name", s.principal_name AS "PrincipalName", COALESCE(s.is_active, TRUE) AS "IsActive",
        COALESCE(s.subscription_tier, 'trial') AS "SubscriptionTier", s.created_at AS "CreatedAt",
        (SELECT count(*)::int FROM auth_db.users u WHERE u.school_id = s.id AND u.deleted_at IS NULL) AS "Users",
        (SELECT count(*)::int FROM auth_db.users u JOIN auth_db.roles r ON r.id = u.role_id WHERE u.school_id = s.id AND u.deleted_at IS NULL AND r.name = 'Administrator') AS "Administrators",
        (SELECT count(*)::int FROM student_db.students st WHERE st.school_id = s.id AND st.deleted_at IS NULL) AS "Students"
        FROM school_db.schools s
        """;

    static async Task<List<SchoolRow>> ListSchools(AuthDbContext db, string search, string status, int limit, string order)
    {
        // order is chosen from two constants above, never from input.
        var sql = SchoolSelect + """
             WHERE s.deleted_at IS NULL AND s.id <> {0}
             AND ({1} = '' OR s.name ILIKE '%' || {1} || '%' OR COALESCE(s.principal_name, '') ILIKE '%' || {1} || '%')
             AND ({2} = 'all' OR ({2} = 'active' AND COALESCE(s.is_active, TRUE)) OR ({2} = 'inactive' AND NOT COALESCE(s.is_active, TRUE)))
            """ + " ORDER BY " + (order == "s.name" ? "s.name" : "s.created_at DESC") + " LIMIT " + limit;
        return await db.Database.SqlQueryRaw<SchoolRow>(sql, EduOSTenants.Platform, search, status).ToListAsync();
    }

    static async Task EnsureSchoolRoles(AuthDbContext db, Guid schoolId)
    {
        foreach (var role in SchoolRoles)
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO auth_db.roles (id, school_id, name, description, is_system_role, created_at, updated_at)
                VALUES ({Guid.NewGuid()}, {schoolId}, {role.Name}, {role.Description}, TRUE, NOW(), NOW())
                ON CONFLICT (school_id, name) DO NOTHING
                """);
    }
}

public record PlatformSchoolRequest(string? Name, string? PrincipalName, string? SubscriptionTier, bool? IsActive);
public record PlatformAdministratorRequest(string? Username, string? Email, string? FirstName, string? LastName, string? Password);
public class SchoolTotals { public int Total { get; set; } public int Active { get; set; } }
public class RoleCount { public string Role { get; set; } = ""; public int Count { get; set; } public int Active { get; set; } }
public class SchoolRow
{
    public Guid Id { get; set; } public string Name { get; set; } = ""; public string? PrincipalName { get; set; } public bool IsActive { get; set; }
    public string SubscriptionTier { get; set; } = "trial"; public DateTime? CreatedAt { get; set; }
    public int Users { get; set; } public int Administrators { get; set; } public int Students { get; set; }
}

using EduOS.ServiceAuth;
using Microsoft.EntityFrameworkCore;
using Services.Auth.Data;

/// <summary>Directory hints only. Verified account-links remain the portal authorization source.</summary>
public static class GuardianReview
{
    public static void Map(RouteGroupBuilder group)
    {
        group.MapGet("/guardian-review", async (Guid? userId, Guid? signupRequestId, Guid? targetSchool, HttpContext http, AuthDbContext db) =>
        {
            Iam.Permit(http, "account-links.manage");
            Iam.Permit(http, signupRequestId.HasValue ? "signup.review" : "users.view");
            var school = Iam.Scope(http, targetSchool);
            Iam.Check(userId.HasValue != signupRequestId.HasValue, "Select one account or signup request.");
            var email = signupRequestId.HasValue
                ? await db.Signups.Where(s => s.Id == signupRequestId && s.SchoolId == school).Select(s => s.Email).SingleOrDefaultAsync()
                : await db.Users.Where(u => u.Id == userId && u.SchoolId == school).Select(u => u.Email).SingleOrDefaultAsync();
            Iam.Check(email != null, "Account or request not found.", 404);
            var students = await db.Database.SqlQuery<GuardianStudent>($"""
                SELECT s.id AS "Id", s.first_name || ' ' || s.last_name AS "Label",
                       p.id AS "GuardianId", p.first_name || ' ' || p.last_name AS "GuardianName", p.email AS "GuardianEmail"
                FROM student_db.students s
                LEFT JOIN parent_db.parents p ON p.id=s.parent_guardian_id AND p.school_id=s.school_id AND p.deleted_at IS NULL
                WHERE s.school_id={school} AND s.deleted_at IS NULL ORDER BY s.first_name,s.last_name,s.id
                """).ToListAsync();
            return Results.Ok(new { data = students.Select(s => new {
                s.Id, s.Label, s.GuardianName, s.GuardianEmail,
                status = Status(true, true, s.GuardianId.HasValue, s.GuardianEmail, email)
            }).OrderByDescending(s => s.status == "Match").ThenBy(s => s.Label) });
        });

        group.MapGet("/guardian-mismatches", async (Guid? targetSchool, HttpContext http, AuthDbContext db, int page = 1) =>
        {
            Iam.Permit(http, "account-links.view");
            Iam.Permit(http, "users.view");
            var school = Iam.Scope(http, targetSchool);
            Iam.Check(page is > 0 and < 100000, "Invalid page.");
            // Text joins deliberately tolerate an old malformed link without casting untrusted JSON to UUID.
            var rows = await db.Database.SqlQuery<GuardianMismatch>($"""
                SELECT l.id AS "LinkId", COALESCE(u.first_name || ' ' || u.last_name,'Unavailable account') AS "AccountName",
                       u.email AS "AccountEmail", COALESCE(s.first_name || ' ' || s.last_name,'Unavailable student') AS "StudentName",
                       p.first_name || ' ' || p.last_name AS "GuardianName", p.email AS "GuardianEmail",
                       u.id IS NOT NULL AS "AccountAvailable", s.id IS NOT NULL AS "StudentAvailable",
                       p.id IS NOT NULL AS "GuardianAvailable"
                FROM suite.records l
                LEFT JOIN auth_db.users u ON u.id::text=l.data->>'userId' AND u.school_id=l.school_id AND u.deleted_at IS NULL
                LEFT JOIN student_db.students s ON s.id::text=l.data->>'studentId' AND s.school_id=l.school_id AND s.deleted_at IS NULL
                LEFT JOIN parent_db.parents p ON p.id=s.parent_guardian_id AND p.school_id=l.school_id AND p.deleted_at IS NULL
                WHERE l.school_id={school} AND l.kind='account-links' AND l.archived_at IS NULL AND l.data->>'relationship'='parent'
                  AND (u.id IS NULL OR s.id IS NULL OR p.id IS NULL OR NULLIF(btrim(p.email),'') IS NULL
                       OR lower(btrim(p.email)) IS DISTINCT FROM lower(btrim(u.email)))
                ORDER BY l.created_at DESC,l.id LIMIT 21 OFFSET {(page-1)*20}
                """).ToListAsync();
            return Results.Ok(new { data = new {
                hasMore = rows.Count > 20,
                rows = rows.Take(20).Select(r => new { r.LinkId, r.AccountName, r.AccountEmail, r.StudentName, r.GuardianName, r.GuardianEmail,
                    status = Status(r.AccountAvailable,r.StudentAvailable,r.GuardianAvailable,r.GuardianEmail,r.AccountEmail) })
            } });
        });
    }

    public static string Status(bool accountAvailable, bool studentAvailable, bool guardianAvailable, string? guardianEmail, string? accountEmail)
    {
        if (!accountAvailable) return "Account unavailable";
        if (!studentAvailable) return "Student unavailable";
        if (!guardianAvailable) return "No active guardian";
        if (string.IsNullOrWhiteSpace(guardianEmail)) return "Guardian email missing";
        return string.Equals(guardianEmail.Trim(), accountEmail?.Trim(), StringComparison.OrdinalIgnoreCase) ? "Match" : "Mismatch";
    }
}

public class GuardianStudent
{
    public Guid Id { get; set; }
    public string Label { get; set; } = "";
    public Guid? GuardianId { get; set; }
    public string? GuardianName { get; set; }
    public string? GuardianEmail { get; set; }
}
public class GuardianMismatch
{
    public Guid LinkId { get; set; }
    public string AccountName { get; set; } = "";
    public string? AccountEmail { get; set; }
    public string StudentName { get; set; } = "";
    public string? GuardianName { get; set; }
    public string? GuardianEmail { get; set; }
    public bool AccountAvailable { get; set; }
    public bool StudentAvailable { get; set; }
    public bool GuardianAvailable { get; set; }
}

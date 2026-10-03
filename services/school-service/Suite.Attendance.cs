using System.Text.Json.Nodes;
using Npgsql;
using Serilog;

/// <summary>
/// The rules of the daily register, kept pure so they are tested without a database: the statuses and the reasons a
/// school can record, when a reason is needed, what state a class register is in, who may correct a submitted
/// register, and what counts as low attendance.
/// </summary>
public static class AttendanceRules
{
    public static readonly string[] Statuses = ["Present", "Absent", "Late", "Excused"];
    /// <summary>Structured reasons. "Other" is the only one that needs a remark to say what happened.</summary>
    public static readonly string[] Reasons = ["Sick", "Approved leave", "Transport delay", "Medical", "School activity", "Family", "Other"];
    public const int RemarkMax = 200, LowAttendanceDefault = 75;

    /// <summary>A reason can accompany any status except Present; it is required only for a correction.</summary>
    public static bool MayHaveReason(string status) => status is "Absent" or "Late" or "Excused";
    public static string? ReasonProblem(string status, string? reason, string? remark, bool required)
    {
        reason = (reason ?? "").Trim(); remark = (remark ?? "").Trim();
        if (reason == "" && remark == "") return required ? "Give a reason for the change." : null;
        if (!MayHaveReason(status) && reason != "") return "A reason goes with Absent, Late or Excused.";
        if (reason != "" && !Reasons.Contains(reason)) return "Choose a reason from the list.";
        if (reason == "Other" && remark == "") return "Say what the reason is.";
        if (remark.Length > RemarkMax) return $"Keep the remark within {RemarkMax} characters.";
        return null;
    }
    /// <summary>What a class register is in: nothing marked, partly marked, submitted, or submitted then corrected.</summary>
    public static string RegisterState(int expected, int marked, string? submitted) =>
        submitted is "Corrected" ? "Corrected" : submitted is "Submitted" ? "Submitted" : marked == 0 ? "Not started" : marked < expected ? "In progress" : "Marked";
    /// <summary>
    /// A submitted register is corrected, not re-marked. Leadership may correct any day; a teacher may correct their own
    /// classes on the same day only (after that the office does it), so a late change always has a reason and an owner.
    /// </summary>
    public static bool MayCorrect(bool leadership, DateOnly day, DateOnly today) => leadership || day == today;
    public static int Percent(long attended, long marked) => marked == 0 ? 0 : (int)Math.Round(attended * 100.0 / marked);
    public static bool Low(long present, long late, long marked, int threshold) => marked > 0 && Percent(present + late, marked) < threshold;
    public static int Threshold(string? value) => int.TryParse(value, out var t) && t is >= 1 and <= 100 ? t : LowAttendanceDefault;
}

// The daily register as one workflow: a teacher marks and submits, leadership sees which classes are done, families
// see each day, and every change after submission is a correction with a reason and a history row.
public static partial class Suite
{
    public static async Task InitializeAttendance()
    {
        await using var c = await Open();
        await E(c, File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "AttendanceSchema.sql")));
    }

    /// <summary>Students this caller may mark: everyone active in the school for leadership, the linked classes for a teacher.</summary>
    static async Task<Dictionary<string, JsonObject>> Markable(NpgsqlConnection c, SchoolAccess a) =>
        (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name,current_class AS class FROM student_db.students WHERE school_id=@s AND status='Active' AND deleted_at IS NULL", ("s", a.School)))
        .Where(r => a.SchoolWide || a.Students.Contains(Text(r, "id"))).ToDictionary(r => Text(r, "id"));

    /// <summary>Marks or corrects the register. Replaces the original POST /student-attendance body; same route, same permission.</summary>
    static async Task<IResult> SaveRegister(JsonObject d, HttpContext http)
    {
        await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Register access denied.", 403); var day = Day(d, "day");
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        Require(day <= today.AddDays(1), "Attendance cannot be in the future.");
        Require(d["entries"] is JsonArray, "Entries must be an array."); var entries = d["entries"]!.AsArray(); Require(entries.Count is >= 0 and <= 500, "Save up to 500 attendance entries.");
        var submit = d["submit"] is JsonValue flag && flag.TryGetValue<bool>(out var s) && s; var sharedReason = Text(d, "reason"); var sharedRemark = Text(d, "remark");
        Require(entries.Count > 0 || submit, "Nothing to save.");
        var markable = await Markable(c, a);
        var existing = (await Q(c, "SELECT student_id::text AS id,status,reason,remark FROM school_db.attendance WHERE school_id=@s AND day=@d", ("s", a.School), ("d", day))).ToDictionary(r => Text(r, "id"));
        var submitted = (await Q(c, "SELECT class_name AS class,status FROM school_db.attendance_registers WHERE school_id=@s AND day=@d", ("s", a.School), ("d", day))).ToDictionary(r => Text(r, "class"), r => Text(r, "status"));
        var unique = new HashSet<string>(); var changes = new List<(Guid Student, string Class, string? Old, string New, string Reason, string Remark, bool Correction)>(); var unchanged = 0;
        foreach (var item in entries)
        {
            Require(item is JsonObject, "Each attendance entry must be an object."); var entry = item!.AsObject(); var student = Id(entry, "studentId"); var key = student.ToString();
            Require(unique.Add(key), "Duplicate student.");
            Require(markable.TryGetValue(key, out var profile), "A student is outside your assigned classes.", 403);
            var status = Text(entry, "status"); Require(AttendanceRules.Statuses.Contains(status), "Invalid attendance status.");
            var reason = entry.ContainsKey("reason") ? Text(entry, "reason") : sharedReason; var remark = entry.ContainsKey("remark") ? Text(entry, "remark") : sharedRemark;
            var cls = Text(profile!, "class"); existing.TryGetValue(key, out var before); var old = before is null ? null : Text(before, "status");
            var correction = before is not null && submitted.ContainsKey(cls);
            if (old == status && (before is null || (Text(before, "reason") == reason && Text(before, "remark") == remark))) { unchanged++; continue; }
            if (correction)
            {
                Require(AttendanceRules.MayCorrect(a.SchoolWide, day, today), "This register was submitted on an earlier day. Ask the school office to correct it.", 403);
                var problem = AttendanceRules.ReasonProblem(status, reason, remark, true); Require(problem is null, problem ?? "");
            }
            else { var problem = AttendanceRules.ReasonProblem(status, reason, remark, false); Require(problem is null, problem ?? ""); }
            changes.Add((student, cls, old, status, reason, remark, correction));
        }
        // The classes whose registers this save completes: those of the students sent, plus every class the caller
        // may mark that is now fully marked, when the caller asks to submit.
        var classes = changes.Select(ch => ch.Class).ToHashSet();
        await using var tx = await c.BeginTransactionAsync();
        foreach (var ch in changes)
        {
            var changed = await E(c, """
                INSERT INTO school_db.attendance(school_id,student_id,day,status,reason,remark,marked_by,marked_at) SELECT @s,id,@day,@status,@reason,@remark,@u,now() FROM student_db.students WHERE id=@id AND school_id=@s AND status='Active' AND deleted_at IS NULL
                ON CONFLICT(school_id,student_id,day) DO UPDATE SET status=excluded.status,reason=excluded.reason,remark=excluded.remark,marked_by=excluded.marked_by,marked_at=now(),updated_at=now()
                """, ("s", a.School), ("id", ch.Student), ("day", day), ("status", ch.New), ("reason", ch.Reason == "" ? null : ch.Reason), ("remark", ch.Remark == "" ? null : ch.Remark), ("u", a.User));
            Require(changed == 1, "Student is not active.");
            await E(c, "INSERT INTO school_db.attendance_history(school_id,student_id,day,kind,old_status,new_status,reason,remark,changed_by) VALUES(@s,@id,@day,@kind,@old,@new,@reason,@remark,@u)",
                ("s", a.School), ("id", ch.Student), ("day", day), ("kind", ch.Correction ? "correction" : "submission"), ("old", ch.Old), ("new", ch.New), ("reason", ch.Reason == "" ? null : ch.Reason), ("remark", ch.Remark == "" ? null : ch.Remark), ("u", a.User));
        }
        var corrected = changes.Where(ch => ch.Correction).Select(ch => ch.Class).Distinct().ToArray();
        foreach (var cls in corrected)
            await E(c, "UPDATE school_db.attendance_registers SET status='Corrected',corrected_by=@u,corrected_at=now() WHERE school_id=@s AND day=@d AND class_name=@c", ("u", a.User), ("s", a.School), ("d", day), ("c", cls));
        var completed = new List<string>();
        if (submit)
        {
            if (changes.Count == 0 && classes.Count == 0) classes = markable.Values.Select(p => Text(p, "class")).Where(cls => cls != "").ToHashSet();
            var marked = (await Q(c, "SELECT student_id::text AS id FROM school_db.attendance WHERE school_id=@s AND day=@d", ("s", a.School), ("d", day))).Select(r => Text(r, "id")).ToHashSet();
            foreach (var cls in classes.Where(cls => cls != "" && !submitted.ContainsKey(cls)))
            {
                var pupils = markable.Values.Where(p => Text(p, "class") == cls).Select(p => Text(p, "id")).ToList();
                if (pupils.Count == 0 || pupils.Any(id => !marked.Contains(id))) continue;   // a register is complete only when every student has a status
                await E(c, "INSERT INTO school_db.attendance_registers(school_id,day,class_name,status,submitted_by) VALUES(@s,@d,@c,'Submitted',@u) ON CONFLICT DO NOTHING", ("s", a.School), ("d", day), ("c", cls), ("u", a.User));
                completed.Add(cls);
            }
        }
        await tx.CommitAsync();
        // Only after the register is stored, and only for what changed: families are told once per student and day.
        var fresh = changes.Where(ch => !ch.Correction).ToList();
        await AnnounceAttendance(a, day, fresh.Where(ch => ch.New == "Absent").Select(ch => ch.Student).ToList(), fresh.Where(ch => ch.New == "Late").Select(ch => ch.Student).ToList(),
            changes.Where(ch => ch.Correction && ch.Old != ch.New).Select(ch => (ch.Student, ch.New, ch.Reason)).ToList());
        var message = changes.Count == 0 && completed.Count == 0 ? "Nothing changed." : completed.Count > 0 ? "Register submitted for " + string.Join(", ", completed) + "." : corrected.Length > 0 ? "Correction recorded." : "Attendance saved.";
        return Results.Ok(new { message, data = new { changed = changes.Count, unchanged, corrected = corrected.Length, submitted = completed } });
    }

    /// <summary>Per class for one day: how many students, how many marked and in which status, and the register's state.</summary>
    static async Task<List<JsonObject>> RegisterStates(NpgsqlConnection c, SchoolAccess a, DateOnly day)
    {
        var markable = await Markable(c, a);
        var marks = (await Q(c, "SELECT student_id::text AS id,status FROM school_db.attendance WHERE school_id=@s AND day=@d", ("s", a.School), ("d", day))).ToDictionary(r => Text(r, "id"), r => Text(r, "status"));
        var registers = (await Q(c, "SELECT class_name AS class,status,submitted_at AS \"submittedAt\",corrected_at AS \"correctedAt\",submitted_by AS \"submittedBy\",corrected_by AS \"correctedBy\" FROM school_db.attendance_registers WHERE school_id=@s AND day=@d", ("s", a.School), ("d", day))).ToDictionary(r => Text(r, "class"));
        var teachers = (await Records(c, a.School, "classes")).Where(cl => Text(cl, "teacherId") != "").ToDictionary(cl => Label("classes", cl), cl => Text(cl, "teacherId"));
        var names = (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name FROM teacher_db.teachers WHERE school_id=@s AND deleted_at IS NULL", ("s", a.School))).ToDictionary(r => Text(r, "id"), r => Text(r, "name"));
        var users = (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name FROM auth_db.users WHERE school_id=@s", ("s", a.School))).ToDictionary(r => Text(r, "id"), r => Text(r, "name"));
        var list = new List<JsonObject>();
        foreach (var group in markable.Values.GroupBy(p => Text(p, "class")).OrderBy(g => g.Key))
        {
            var ids = group.Select(p => Text(p, "id")).ToList(); var statuses = ids.Where(marks.ContainsKey).Select(id => marks[id]).ToList();
            registers.TryGetValue(group.Key, out var register); var submitted = register is null ? null : Text(register, "status");
            var row = new JsonObject
            {
                ["className"] = group.Key == "" ? "Unallocated" : group.Key, ["expected"] = ids.Count, ["marked"] = statuses.Count,
                ["present"] = statuses.Count(x => x == "Present"), ["absent"] = statuses.Count(x => x == "Absent"), ["late"] = statuses.Count(x => x == "Late"), ["excused"] = statuses.Count(x => x == "Excused"),
                ["state"] = AttendanceRules.RegisterState(ids.Count, statuses.Count, submitted),
                ["teacher"] = teachers.TryGetValue(group.Key, out var teacherId) && names.TryGetValue(teacherId, out var teacher) ? teacher : null,
                ["submittedAt"] = register?["submittedAt"]?.DeepClone(), ["correctedAt"] = register?["correctedAt"]?.DeepClone(),
                ["submittedBy"] = register is null ? null : users.GetValueOrDefault(Text(register, "submittedBy")),
            };
            list.Add(row);
        }
        return list;
    }

    static void MapAttendance(RouteGroupBuilder group)
    {
        // Which classes have completed today's register. Leadership sees the school; a teacher their own classes.
        group.MapGet("/student-attendance/registers", async (DateOnly day, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Register access denied.", 403);
            var rows = await RegisterStates(c, a, day);
            var totals = new JsonObject
            {
                ["expected"] = rows.Sum(r => (int)Number(r, "expected")), ["marked"] = rows.Sum(r => (int)Number(r, "marked")), ["present"] = rows.Sum(r => (int)Number(r, "present")),
                ["absent"] = rows.Sum(r => (int)Number(r, "absent")), ["late"] = rows.Sum(r => (int)Number(r, "late")), ["excused"] = rows.Sum(r => (int)Number(r, "excused")),
                ["completed"] = rows.Count(r => Text(r, "state") is "Submitted" or "Corrected"), ["pending"] = rows.Count(r => Text(r, "state") is not ("Submitted" or "Corrected")),
            };
            totals["percent"] = AttendanceRules.Percent((long)Number(totals, "present") + (long)Number(totals, "late"), (long)Number(totals, "marked"));
            return Results.Ok(new { data = new { day = day.ToString("yyyy-MM-dd"), totals, classes = rows, reasons = AttendanceRules.Reasons } });
        });
        // Who changed what, and why, for one day (optionally one student). Staff only; families see reasons through their own day view.
        group.MapGet("/student-attendance/history", async (DateOnly day, Guid? studentId, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Register access denied.", 403);
            var rows = await Q(c, """
                SELECT h.student_id AS "studentId",s.first_name || ' ' || s.last_name AS student,h.kind,h.old_status AS "oldStatus",h.new_status AS "newStatus",h.reason,h.remark,h.changed_at AS "changedAt",
                COALESCE(u.first_name || ' ' || u.last_name,u.username) AS "changedBy"
                FROM school_db.attendance_history h JOIN student_db.students s ON s.id=h.student_id AND s.school_id=h.school_id LEFT JOIN auth_db.users u ON u.id=h.changed_by AND u.school_id=h.school_id
                WHERE h.school_id=@s AND h.day=@d AND (@student::uuid IS NULL OR h.student_id=@student) ORDER BY h.changed_at DESC LIMIT 500
                """, ("s", a.School), ("d", day), ("student", studentId));
            return Results.Ok(new { data = rows.Where(r => a.SchoolWide || a.Students.Contains(Text(r, "studentId"))) });
        });
        // One student's days in a month, with the reason when one was recorded. A family sees only its own students;
        // the permission is reports.view, which every school role holds for its own scope.
        group.MapGet("/reports/attendance/days", async (Guid studentId, string month, HttpContext http) =>
        {
            Require(DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", out var start), "Choose a valid month.");
            await using var c = await Open(); var a = await Access(http, c);
            Require(a.SchoolWide || a.Students.Contains(studentId.ToString()), "This student is outside your scope.", 403);
            var rows = await Q(c, "SELECT day,status,reason,remark,marked_at AS \"markedAt\" FROM school_db.attendance WHERE school_id=@s AND student_id=@id AND day>=@start AND day<@end ORDER BY day DESC",
                ("s", a.School), ("id", studentId), ("start", start), ("end", start.AddMonths(1)));
            var present = rows.Count(r => Text(r, "status") == "Present"); var late = rows.Count(r => Text(r, "status") == "Late");
            return Results.Ok(new { data = new { month, days = rows, present, late, absent = rows.Count(r => Text(r, "status") == "Absent"), excused = rows.Count(r => Text(r, "status") == "Excused"), markedDays = rows.Count, percent = AttendanceRules.Percent(present + late, rows.Count) } });
        });
        // A month by class: totals, percentage and how many students fall under the low-attendance threshold.
        group.MapGet("/reports/attendance/classes", async (string month, HttpContext http, string? threshold = null) =>
        {
            Require(DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", out var start), "Choose a valid month.");
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Report access denied.", 403);
            var limit = AttendanceRules.Threshold(threshold);
            var rows = await Q(c, """
                SELECT s.id::text AS id,s.current_class AS class,count(*) FILTER(WHERE t.status='Present') AS present,count(*) FILTER(WHERE t.status='Late') AS late,
                count(*) FILTER(WHERE t.status='Absent') AS absent,count(*) FILTER(WHERE t.status='Excused') AS excused,count(t.id) AS marked
                FROM student_db.students s LEFT JOIN school_db.attendance t ON t.student_id=s.id AND t.school_id=s.school_id AND t.day>=@start AND t.day<@end
                WHERE s.school_id=@s AND s.deleted_at IS NULL AND s.status='Active' GROUP BY s.id
                """, ("start", start), ("end", start.AddMonths(1)), ("s", a.School));
            var mine = rows.Where(r => a.SchoolWide || a.Students.Contains(Text(r, "id"))).ToList();
            var classes = mine.GroupBy(r => Text(r, "class")).OrderBy(g => g.Key).Select(g => new
            {
                className = g.Key == "" ? "Unallocated" : g.Key, students = g.Count(), present = g.Sum(r => (long)Number(r, "present")), late = g.Sum(r => (long)Number(r, "late")), absent = g.Sum(r => (long)Number(r, "absent")), excused = g.Sum(r => (long)Number(r, "excused")),
                marked = g.Sum(r => (long)Number(r, "marked")), percent = AttendanceRules.Percent(g.Sum(r => (long)Number(r, "present") + (long)Number(r, "late")), g.Sum(r => (long)Number(r, "marked"))),
                low = g.Count(r => AttendanceRules.Low((long)Number(r, "present"), (long)Number(r, "late"), (long)Number(r, "marked"), limit)),
            });
            return Results.Ok(new { data = new { month, threshold = limit, classes } });
        });
    }

    /// <summary>
    /// Tells guardians about an absence, a late arrival, or a corrected status, through the notification platform.
    /// Runs after the register is committed, on its own connection. One notification per student and day for absent
    /// and late; a correction is announced once per history change. Saving the same register again sends nothing.
    /// </summary>
    static async Task AnnounceAttendance(SchoolAccess a, DateOnly day, IReadOnlyCollection<Guid> absent, IReadOnlyCollection<Guid> late, IReadOnlyCollection<(Guid Student, string Status, string Reason)> corrected)
    {
        try
        {
            if (!NotificationRules.Timely(day, DateOnly.FromDateTime(DateTime.UtcNow)) || absent.Count + late.Count + corrected.Count == 0) return;
            await using var c = await Open(); var when = day.ToString("yyyy-MM-dd");
            var planned = new List<(string Key, string Type, Guid Student, Dictionary<string, string?> Extra)>();
            foreach (var student in absent.Distinct()) planned.Add((NotificationRules.EventKey("attendance.absent", student, when), "attendance.absent", student, new()));
            foreach (var student in late.Distinct()) planned.Add((NotificationRules.EventKey("attendance.late", student, when), "attendance.late", student, new()));
            foreach (var (student, status, reason) in corrected) planned.Add((NotificationRules.EventKey("attendance.corrected", student, when + "-" + DateTime.UtcNow.Ticks.ToString()[^8..]), "attendance.corrected", student, new() { ["status"] = status, ["reason"] = reason }));
            var done = (await Q(c, "SELECT event_key AS key FROM notify.notifications WHERE school_id=@s AND event_key=ANY(@keys)", ("s", a.School), ("keys", planned.Select(p => p.Key).ToArray()))).Select(row => Text(row, "key")).ToHashSet();
            var fresh = planned.Where(p => !done.Contains(p.Key)).ToList(); if (fresh.Count == 0) return;
            var students = fresh.Select(p => p.Student).Distinct().ToArray(); var guardians = await GuardiansOf(c, a.School, students, "reports.view");
            if (guardians.Count == 0) return;
            var profiles = (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name,current_class AS class FROM student_db.students WHERE school_id=@s AND id=ANY(@ids)", ("s", a.School), ("ids", students))).ToDictionary(row => Text(row, "id"));
            var school = await SchoolName(c, a.School);
            foreach (var (key, type, student, extra) in fresh)
                if (guardians.TryGetValue(student, out var parents) && profiles.TryGetValue(student.ToString(), out var profile))
                {
                    var values = new Dictionary<string, string?>(extra) { ["studentName"] = Text(profile, "name"), ["className"] = Text(profile, "class"), ["date"] = NotificationTemplates.Day(when), ["schoolName"] = school };
                    await Send(c, a.School, type, key, values, student, parents, a.User, "suite.student-attendance");
                }
        }
        catch (Exception ex) { Log.Warning(ex, "Attendance notifications for {Day} were not created", day); }
    }
}

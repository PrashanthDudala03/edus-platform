using System.Globalization;
using System.Text.Json.Nodes;
using Npgsql;

/// <summary>
/// The rules of homework and assignments, kept pure so they are tested without a database: the lifecycle, what a
/// student may do and when, whether a submission is late, and the state a family sees for each assignment.
/// </summary>
public static class HomeworkRules
{
    public static readonly string[] Statuses = ["Draft", "Published", "Closed"];
    public static readonly string[] Groups = ["due-today", "upcoming", "submitted", "reviewed", "late", "missing", "excused", "closed"];
    /// <summary>How work comes back: not at all (information only), a tap to confirm it is done, a written answer, files, or shown in class.</summary>
    public static readonly string[] Modes = ["None", "Done", "Text", "File", "Physical"];
    /// <summary>What a teacher records against a student without any upload: done, done late, missing, or excused.</summary>
    public static readonly string[] Outcomes = ["Completed", "Late", "Missing", "Excused"];
    public const int MaxHistory = 10;

    /// <summary>Assignments created before the lifecycle existed have no status; they were live from the day they were made.</summary>
    public static string Status(string? status) => string.IsNullOrWhiteSpace(status) ? "Published" : status;
    /// <summary>Assignments made before modes existed took written answers; a new one defaults to a tap-to-confirm.</summary>
    public static string Mode(string? mode) => Modes.Contains(mode) ? mode! : "Text";
    /// <summary>The student acts online: confirms, writes, or uploads. Files are asked for only in File mode.</summary>
    public static bool StudentSubmits(string mode) => mode is "Done" or "Text" or "File";
    /// <summary>The teacher checks completion for every mode except information-only work.</summary>
    public static bool Tracked(string mode) => mode != "None";
    /// <summary>Draft -> Published -> Closed, Closed -> Published to reopen. Published goes back to Draft only while nobody has submitted.</summary>
    public static string? TransitionProblem(string? from, string to, int submissions)
    {
        var current = Status(from);
        if (!Statuses.Contains(to)) return "Choose a valid assignment status.";
        if (current == to) return null;
        return (current, to) switch
        {
            ("Draft", "Published") or ("Published", "Closed") or ("Closed", "Published") => null,
            ("Published", "Draft") => submissions == 0 ? null : "Work has already been handed in; close the assignment instead of unpublishing it.",
            ("Draft", "Closed") => "Publish the assignment before closing it.",
            ("Closed", "Draft") => "A closed assignment cannot go back to a draft.",
            _ => "That status change is not allowed.",
        };
    }
    /// <summary>The moment an assignment is due, in UTC: the due date at the due time, or the end of that day when no time is set.</summary>
    public static DateTime DueAt(string? dueDate, string? dueTime)
    {
        var day = DateOnly.TryParseExact(dueDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : DateOnly.MaxValue;
        var time = TimeOnly.TryParseExact(dueTime, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : new TimeOnly(23, 59, 59);
        return day == DateOnly.MaxValue ? DateTime.MaxValue : DateTime.SpecifyKind(day.ToDateTime(time), DateTimeKind.Utc);
    }
    /// <summary>Lateness is decided by the server clock against the due moment, never by anything the client sends.</summary>
    public static bool IsLate(DateTime submittedAtUtc, string? dueDate, string? dueTime) => submittedAtUtc > DueAt(dueDate, dueTime);
    /// <summary>A student may hand in (or hand in again) while the assignment is published and the work is not yet reviewed.</summary>
    public static string? SubmitProblem(string? homeworkStatus, string? submissionStatus, string? outcome, string mode, string? response)
    {
        if (!StudentSubmits(mode)) return mode == "Physical" ? "This work is shown to the teacher in class, not handed in online." : "This assignment does not take submissions.";
        if (mode == "Text" && string.IsNullOrWhiteSpace(response)) return "Write your response before handing in.";
        return Status(homeworkStatus) switch
        {
            "Draft" => "This assignment is not published yet.",
            "Closed" => "This assignment is closed and no longer takes submissions.",
            _ => submissionStatus == "Reviewed" ? "This work has been reviewed and cannot be changed." : outcome == "Excused" ? "You have been excused from this assignment." : null,
        };
    }
    /// <summary>
    /// Where an assignment sits for one student. A review wins; then the teacher's check (done, late, missing, excused);
    /// then what the student did (late means after the due moment); then the calendar: overdue tracked work is missing.
    /// </summary>
    public static string Group(string? homeworkStatus, string? dueDate, string? dueTime, string mode, string? submissionStatus, string? outcome, bool late, DateTime nowUtc)
    {
        var status = Status(homeworkStatus);
        if (submissionStatus == "Reviewed") return "reviewed";
        switch (outcome) { case "Excused": return "excused"; case "Missing": return "missing"; case "Late": return "late"; case "Completed": return "submitted"; }
        if (submissionStatus == "Submitted") return late ? "late" : "submitted";
        if (status == "Closed") return "closed";
        var due = DueAt(dueDate, dueTime);
        if (nowUtc > due) return Tracked(mode) ? "missing" : "closed";
        return due.Date == nowUtc.Date ? "due-today" : "upcoming";
    }
    /// <summary>Counted as done for the class figures: handed in, reviewed, or checked off by the teacher.</summary>
    public static bool Done(string? submissionStatus, string? outcome) => outcome is "Completed" or "Late" || (outcome is null or "" && submissionStatus is "Submitted" or "Reviewed");
    /// <summary>Written and uploaded work waits for the teacher; a tap-to-confirm or an in-class check does not.</summary>
    public static bool Pending(string mode, string? submissionStatus, string? outcome) => mode is "Text" or "File" && submissionStatus == "Submitted" && string.IsNullOrEmpty(outcome);
    public static string? MarksProblem(string? maxMarks, string? grade)
    {
        if (string.IsNullOrWhiteSpace(grade) || string.IsNullOrWhiteSpace(maxMarks)) return null;
        if (!decimal.TryParse(maxMarks, NumberStyles.Number, CultureInfo.InvariantCulture, out var max) || max <= 0) return null;
        return decimal.TryParse(grade, NumberStyles.Number, CultureInfo.InvariantCulture, out var score) && (score < 0 || score > max) ? $"Marks must be between 0 and {max:0.##}." : null;
    }
}

// Homework & Assignments as one workflow on the existing homework and submission records: a teacher drafts and
// publishes, students hand in (late is decided here), teachers review with marks and feedback, families see the state
// of every assignment, and leadership sees where work is outstanding. Every statement names the school of the token.
public static partial class Suite
{
    /// <summary>What an assignment looks like to the people who read it, with its live fields in one shape (Student 360 reads the same shape).</summary>
    static JsonObject HomeworkView(JsonObject h, JsonObject? cls, JsonObject? subject, string? teacher, int attachments) => new()
    {
        ["id"] = Text(h, "id"), ["version"] = h["version"]?.DeepClone(), ["title"] = Text(h, "title"), ["classId"] = Text(h, "classId"), ["className"] = cls is null ? "" : Label("classes", cls), ["subjectId"] = Text(h, "subjectId"), ["subjectName"] = subject is null ? "" : Text(subject, "name"),
        ["teacher"] = teacher ?? "", ["instructions"] = Text(h, "instructions"), ["dueDate"] = Text(h, "dueDate"), ["dueTime"] = Text(h, "dueTime"), ["maxMarks"] = Text(h, "maxMarks"), ["submissionMode"] = HomeworkRules.Mode(Text(h, "submissionMode")),
        ["status"] = HomeworkRules.Status(Text(h, "status")), ["publishedOn"] = Text(h, "publishedOn"), ["createdAt"] = h["createdAt"]?.DeepClone(), ["attachments"] = attachments,
    };
    static JsonObject? SubmissionView(JsonObject? s) => s is null ? null : new()
    {
        ["id"] = Text(s, "id"), ["version"] = s["version"]?.DeepClone(), ["status"] = Text(s, "status") == "" && Text(s, "outcome") == "" ? "Submitted" : Text(s, "status"), ["submittedAt"] = Text(s, "submittedAt"), ["late"] = Text(s, "late") == "Yes" || Text(s, "outcome") == "Late",
        ["outcome"] = Text(s, "outcome"), ["verifiedAt"] = Text(s, "verifiedAt"), ["response"] = Text(s, "response"), ["grade"] = Text(s, "grade"), ["feedback"] = Text(s, "feedback"), ["reviewedAt"] = Text(s, "reviewedAt"), ["resubmissions"] = s["history"] is JsonArray history ? history.Count : 0,
    };
    static async Task<Dictionary<string, int>> AttachmentCounts(NpgsqlConnection c, Guid school, IEnumerable<string> recordIds) =>
        (await Q(c, "SELECT record_id::text AS id,count(*) AS n FROM suite.documents WHERE school_id=@s AND record_id=ANY(@ids::uuid[]) GROUP BY record_id", ("s", school), ("ids", recordIds.ToArray()))).ToDictionary(r => Text(r, "id"), r => (int)Number(r, "n"));
    static async Task<Dictionary<string, string>> TeacherNames(NpgsqlConnection c, Guid school) =>
        (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name FROM teacher_db.teachers WHERE school_id=@s AND deleted_at IS NULL", ("s", school))).ToDictionary(r => Text(r, "id"), r => Text(r, "name"));
    /// <summary>The teacher who set an assignment: the one assigned to teach that subject in that class, else the class teacher.</summary>
    static string? TeacherOf(JsonObject h, List<JsonObject> assignments, JsonObject? cls, Dictionary<string, string> names)
    {
        var id = assignments.FirstOrDefault(t => Text(t, "classId") == Text(h, "classId") && Text(t, "subjectId") == Text(h, "subjectId")) is { } t ? Text(t, "teacherId") : cls is null ? "" : Text(cls, "teacherId");
        return names.GetValueOrDefault(id);
    }
    static Task<List<JsonObject>> StudentsOfClass(NpgsqlConnection c, Guid school, Guid classId) => Q(c, """
        SELECT s.id::text AS id,s.first_name || ' ' || s.last_name AS name,s.roll_number AS code FROM suite.student_classes sc JOIN student_db.students s ON s.id=sc.student_id AND s.school_id=sc.school_id
        WHERE sc.school_id=@s AND sc.class_id=@c AND s.deleted_at IS NULL AND s.status='Active' ORDER BY s.first_name,s.last_name
        """, ("s", school), ("c", classId));

    static void MapHomework(RouteGroupBuilder group)
    {
        // One student's assignments with their state, for the student, their family, their teachers and leadership.
        group.MapGet("/homework/board", async (Guid studentId, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c);
            Require(a.SchoolWide || a.Students.Contains(studentId.ToString()), "This student is outside your scope.", 403);
            var classes = (await Q(c, "SELECT class_id::text AS id FROM suite.student_classes WHERE school_id=@s AND student_id=@id", ("s", a.School), ("id", studentId))).Select(r => Text(r, "id")).ToHashSet();
            var all = await Records(c, a.School, "homework"); var items = all.Where(h => classes.Contains(Text(h, "classId")) && HomeworkRules.Status(Text(h, "status")) != "Draft").ToList();
            var submissions = (await Records(c, a.School, "submissions")).Where(s => Text(s, "studentId") == studentId.ToString()).ToDictionary(s => Text(s, "homeworkId"));
            var classRecords = (await Records(c, a.School, "classes")).ToDictionary(x => Text(x, "id")); var subjects = (await Records(c, a.School, "subjects")).ToDictionary(x => Text(x, "id"));
            var assignments = await Records(c, a.School, "teaching-assignments"); var names = await TeacherNames(c, a.School); var attachments = await AttachmentCounts(c, a.School, items.Select(h => Text(h, "id")));
            var now = DateTime.UtcNow; var list = new JsonArray();
            foreach (var h in items.OrderBy(h => Text(h, "dueDate")).ThenBy(h => Text(h, "dueTime")))
            {
                submissions.TryGetValue(Text(h, "id"), out var sub); var cls = classRecords.GetValueOrDefault(Text(h, "classId"));
                var view = HomeworkView(h, cls, subjects.GetValueOrDefault(Text(h, "subjectId")), TeacherOf(h, assignments, cls, names), attachments.GetValueOrDefault(Text(h, "id")));
                view["submission"] = SubmissionView(sub);
                view["group"] = GroupOf(h, sub, now);
                list.Add(view);
            }
            var counts = new JsonObject(); foreach (var g in HomeworkRules.Groups) counts[g] = list.Count(v => Text(v!.AsObject(), "group") == g);
            return Results.Ok(new { data = new { studentId, items = list, counts } });
        });
        // Every assignment the caller may manage with how the class is doing: assigned, submitted, late, reviewed, missing.
        group.MapGet("/homework/overview", async (HttpContext http, string? status = null, Guid? classId = null, Guid? subjectId = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Assignment overview is for staff.", 403);
            var items = (await Records(c, a.School, "homework")).Where(h => Readable("homework", h, a) && (status is null || HomeworkRules.Status(Text(h, "status")) == status) && (classId is null || Text(h, "classId") == classId.ToString()) && (subjectId is null || Text(h, "subjectId") == subjectId.ToString())).ToList();
            var submissions = (await Records(c, a.School, "submissions")).GroupBy(s => Text(s, "homeworkId")).ToDictionary(g => g.Key, g => g.ToList());
            var sizes = (await Q(c, "SELECT sc.class_id::text AS id,count(*) AS n FROM suite.student_classes sc JOIN student_db.students s ON s.id=sc.student_id AND s.school_id=sc.school_id WHERE sc.school_id=@s AND s.deleted_at IS NULL AND s.status='Active' GROUP BY sc.class_id", ("s", a.School))).ToDictionary(r => Text(r, "id"), r => (int)Number(r, "n"));
            var classRecords = (await Records(c, a.School, "classes")).ToDictionary(x => Text(x, "id")); var subjects = (await Records(c, a.School, "subjects")).ToDictionary(x => Text(x, "id"));
            var assignments = await Records(c, a.School, "teaching-assignments"); var names = await TeacherNames(c, a.School); var attachments = await AttachmentCounts(c, a.School, items.Select(h => Text(h, "id")));
            var now = DateTime.UtcNow; var list = new JsonArray();
            foreach (var h in items.OrderByDescending(h => Text(h, "dueDate")))
            {
                var subs = submissions.GetValueOrDefault(Text(h, "id")) ?? []; var assigned = sizes.GetValueOrDefault(Text(h, "classId")); var cls = classRecords.GetValueOrDefault(Text(h, "classId"));
                var view = HomeworkView(h, cls, subjects.GetValueOrDefault(Text(h, "subjectId")), TeacherOf(h, assignments, cls, names), attachments.GetValueOrDefault(Text(h, "id")));
                var mode = HomeworkRules.Mode(Text(h, "submissionMode")); var overdue = now > HomeworkRules.DueAt(Text(h, "dueDate"), Text(h, "dueTime"));
                var done = subs.Count(s => HomeworkRules.Done(Text(s, "status"), Text(s, "outcome"))); var excused = subs.Count(s => Text(s, "outcome") == "Excused"); var marked = subs.Count(s => Text(s, "outcome") == "Missing");
                view["assigned"] = assigned; view["submitted"] = done; view["late"] = subs.Count(s => Text(s, "late") == "Yes" || Text(s, "outcome") == "Late"); view["reviewed"] = subs.Count(s => Text(s, "status") == "Reviewed"); view["excused"] = excused;
                view["pending"] = subs.Count(s => HomeworkRules.Pending(mode, Text(s, "status"), Text(s, "outcome")));
                view["missing"] = !HomeworkRules.Tracked(mode) || HomeworkRules.Status(Text(h, "status")) == "Draft" ? 0 : overdue ? Math.Max(marked, assigned - done - excused) : marked; view["overdue"] = overdue;
                list.Add(view);
            }
            var totals = new JsonObject { ["assignments"] = list.Count, ["published"] = list.Count(v => Text(v!.AsObject(), "status") == "Published"), ["toReview"] = list.Sum(v => (int)Number(v!.AsObject(), "pending")), ["missing"] = list.Sum(v => (int)Number(v!.AsObject(), "missing")), ["late"] = list.Sum(v => (int)Number(v!.AsObject(), "late")) };
            return Results.Ok(new { data = new { items = list, totals } });
        });
        // The review workspace for one assignment: every student of the class and what they handed in.
        group.MapGet("/homework/{id:guid}/submissions", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Review is for staff.", 403);
            var h = await Get(c, a.School, "homework", id); Require(Readable("homework", h, a), "This assignment is outside your classes.", 403);
            var students = await StudentsOfClass(c, a.School, Id(h, "classId"));
            var subs = (await Records(c, a.School, "submissions")).Where(s => Text(s, "homeworkId") == id.ToString()).ToDictionary(s => Text(s, "studentId"));
            var attachments = await AttachmentCounts(c, a.School, subs.Values.Select(s => Text(s, "id")));
            var rows = new JsonArray(); var now = DateTime.UtcNow;
            foreach (var st in students)
            {
                subs.TryGetValue(Text(st, "id"), out var s); var sub = SubmissionView(s); if (sub is not null) sub["attachments"] = attachments.GetValueOrDefault(Text(s!, "id"));
                rows.Add(new JsonObject { ["studentId"] = Text(st, "id"), ["name"] = Text(st, "name"), ["code"] = Text(st, "code"), ["submission"] = sub, ["group"] = GroupOf(h, s, now) });
            }
            var classRecords = (await Records(c, a.School, "classes")).ToDictionary(x => Text(x, "id")); var subjects = (await Records(c, a.School, "subjects")).ToDictionary(x => Text(x, "id"));
            return Results.Ok(new { data = new { assignment = HomeworkView(h, classRecords.GetValueOrDefault(Text(h, "classId")), subjects.GetValueOrDefault(Text(h, "subjectId")), null, (await AttachmentCounts(c, a.School, [id.ToString()])).GetValueOrDefault(id.ToString())), students = rows } });
        });
        // Marks and feedback for one student's work. Goes through the ordinary record save, so the same rules, audit and notifications apply.
        // Work shown in class has no record until the teacher marks it, so the review may create one.
        group.MapPut("/homework/{id:guid}/review/{studentId:guid}", async (Guid id, Guid studentId, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Review is for staff.", 403);
            var sub = await SubmissionOf(c, a.School, id, studentId);
            var edit = StaffEdit(id, studentId, sub, input); edit["feedback"] = Text(input, "feedback"); edit["grade"] = Text(input, "grade");
            return await Save("submissions", sub is null ? null : Guid.Parse(Text(sub, "id")), edit, http);
        });
        // The quick check for notebook and in-class work: Completed, Late, Missing or Excused per student, no upload involved.
        group.MapPut("/homework/{id:guid}/verify/{studentId:guid}", async (Guid id, Guid studentId, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Checking work is for staff.", 403);
            var outcome = Text(input, "outcome"); Require(outcome == "" || HomeworkRules.Outcomes.Contains(outcome), "Choose Completed, Late, Missing or Excused.");
            var sub = await SubmissionOf(c, a.School, id, studentId); Require(sub is not null || outcome != "", "There is nothing to clear for this student.", 404);
            var edit = StaffEdit(id, studentId, sub, input); edit["outcome"] = outcome;
            return await Save("submissions", sub is null ? null : Guid.Parse(Text(sub, "id")), edit, http);
        });
    }
    static string GroupOf(JsonObject h, JsonObject? sub, DateTime now) => HomeworkRules.Group(Text(h, "status"), Text(h, "dueDate"), Text(h, "dueTime"), HomeworkRules.Mode(Text(h, "submissionMode")),
        sub is null ? null : (Text(sub, "status") == "" && Text(sub, "outcome") == "" ? "Submitted" : Text(sub, "status")), sub is null ? null : Text(sub, "outcome"), sub is not null && Text(sub, "late") == "Yes", now);
    static async Task<JsonObject?> SubmissionOf(NpgsqlConnection c, Guid school, Guid homeworkId, Guid studentId) =>
        (await Records(c, school, "submissions")).FirstOrDefault(s => Text(s, "homeworkId") == homeworkId.ToString() && Text(s, "studentId") == studentId.ToString());
    /// <summary>A staff edit of one student's record: existing fields carried over, the version taken from the caller (or the record when none is sent).</summary>
    static JsonObject StaffEdit(Guid homeworkId, Guid studentId, JsonObject? sub, JsonObject input) => new()
    {
        ["homeworkId"] = homeworkId.ToString(), ["studentId"] = studentId.ToString(), ["response"] = sub is null ? "" : Text(sub, "response"), ["feedback"] = sub is null ? "" : Text(sub, "feedback"), ["grade"] = sub is null ? "" : Text(sub, "grade"),
        ["outcome"] = sub is null ? "" : Text(sub, "outcome"), ["version"] = sub is null ? null : input["version"]?.DeepClone() ?? sub["version"]?.DeepClone(),
    };
}

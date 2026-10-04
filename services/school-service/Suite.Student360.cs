using System.Globalization;
using System.Text.Json.Nodes;
using Npgsql;

/// <summary>One thing that happened to a student, from whichever module owns it. The timeline is composed, never stored.</summary>
public sealed record StudentEvent(DateTime At, string Kind, string Title, string Detail, string Source, string EntityId);

/// <summary>
/// The rules of Student 360, kept pure so they are tested without a database: what each role may see of a student,
/// how a timeline is merged and paged, and how homework and attendance are summarised.
/// </summary>
public static class Student360Rules
{
    public const int MaxTimelinePage = 100, DefaultTimelinePage = 20, PerSourceCap = 200;
    /// <summary>What a role sees beyond the academic picture. Contact details and fees stay with the school office and the family.</summary>
    public static (bool contact, bool fees, bool guardians, bool history) Visibility(string role) => role switch
    {
        "Administrator" or "Principal" => (true, true, true, true),
        "Parent" or "Student" => (true, true, true, true),
        "Teacher" => (false, false, true, true),
        _ => (false, false, false, false),
    };
    public static int PageSize(int? requested) => requested is null or <= 0 ? DefaultTimelinePage : Math.Min(requested.Value, MaxTimelinePage);
    /// <summary>Newest first, then a stable order for events that share a moment; one page at a time.</summary>
    public static (List<StudentEvent> items, int total, bool more) Page(IEnumerable<StudentEvent> events, int page, int pageSize)
    {
        var all = events.OrderByDescending(e => e.At).ThenBy(e => e.Kind, StringComparer.Ordinal).ThenBy(e => e.Title, StringComparer.Ordinal).ToList();
        var p = Math.Max(1, page); var items = all.Skip((p - 1) * pageSize).Take(pageSize).ToList();
        return (items, all.Count, p * pageSize < all.Count);
    }
    /// <summary>Completion as the family would read it: work done (handed in, reviewed, checked) over work that was tracked.</summary>
    public static int? HomeworkCompletion(IReadOnlyDictionary<string, int> groups)
    {
        int Of(string g) => groups.TryGetValue(g, out var n) ? n : 0;
        var done = Of("submitted") + Of("reviewed") + Of("late"); var tracked = done + Of("missing") + Of("due-today") + Of("upcoming");
        return tracked == 0 ? null : (int)Math.Round(done * 100.0 / tracked);
    }
    public static bool Parse(string? text, out DateTime at) => DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out at);
}

// Student 360: one read model for "what is happening with this student", composed from the modules that own the data
// (register, homework, exams, fees, documents, notices) with the same scope rules each of them applies. Nothing is
// copied into new storage; every statement names the school of the token and the student is checked before any lookup.
public static partial class Suite
{
    static async Task<JsonObject> StudentOf(NpgsqlConnection c, SchoolAccess a, Guid id)
    {
        Require(a.SchoolWide || a.Students.Contains(id.ToString()), "This student is outside your scope.", 403);
        var row = (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name,first_name AS \"firstName\",last_name AS \"lastName\",roll_number AS \"admissionNumber\",current_class AS class,status,email,phone_number AS phone,date_of_birth AS \"dateOfBirth\",admission_date AS \"admissionDate\" FROM student_db.students WHERE id=@id AND school_id=@s AND deleted_at IS NULL", ("id", id), ("s", a.School))).FirstOrDefault();
        Require(row is not null, "Student not found.", 404); return row!;
    }
    static void MapStudent360(RouteGroupBuilder group)
    {
        group.MapGet("/students/{id:guid}/360", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); var pupil = await StudentOf(c, a, id); var see = Student360Rules.Visibility(a.Role);
            var today = DateOnly.FromDateTime(DateTime.UtcNow); var now = DateTime.UtcNow;
            // Academics: the class the student is allocated to, its year, class teacher and subject teachers.
            var allocation = (await Q(c, "SELECT class_id::text AS id FROM suite.student_classes WHERE school_id=@s AND student_id=@id", ("s", a.School), ("id", id))).FirstOrDefault();
            var classId = allocation is null ? "" : Text(allocation, "id");
            var (classes, subjects, schemes, years) = await ExamLookups(c, a.School); var cls = classes.GetValueOrDefault(classId); var year = cls is null ? null : years.GetValueOrDefault(Text(cls, "yearId"));
            var names = await TeacherNames(c, a.School); var assignments = (await Records(c, a.School, "teaching-assignments")).Where(t => Text(t, "classId") == classId).ToList();
            var academics = new JsonObject
            {
                ["year"] = year is null ? "" : Text(year, "name"), ["yearStatus"] = year is null ? "" : Text(year, "status"), ["classId"] = classId, ["className"] = cls is null ? Text(pupil, "class") : Label("classes", cls),
                ["section"] = cls is null ? "" : Text(cls, "section"), ["classTeacher"] = cls is null ? "" : names.GetValueOrDefault(Text(cls, "teacherId")) ?? "", ["allocated"] = cls is not null,
                ["subjects"] = new JsonArray(assignments.Select(t => (JsonNode)new JsonObject { ["subject"] = Text(subjects.GetValueOrDefault(Text(t, "subjectId")) ?? new(), "name"), ["teacher"] = names.GetValueOrDefault(Text(t, "teacherId")) ?? "" }).OrderBy(x => Text(x!.AsObject(), "subject")).ToArray()),
            };
            // Guardians: the accounts linked to this student as parents (and the student's own account).
            var links = (await Records(c, a.School, "account-links")).Where(l => Text(l, "studentId") == id.ToString()).ToList();
            var users = links.Count == 0 ? new Dictionary<string, JsonObject>() : (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name,email,username FROM auth_db.users WHERE school_id=@s AND id=ANY(@ids::uuid[]) AND deleted_at IS NULL", ("s", a.School), ("ids", links.Select(l => Text(l, "userId")).ToArray()))).ToDictionary(u => Text(u, "id"));
            var guardians = new JsonArray(links.Where(l => users.ContainsKey(Text(l, "userId"))).Select(l => (JsonNode)new JsonObject { ["name"] = Text(users[Text(l, "userId")], "name"), ["relationship"] = Text(l, "relationship"), ["email"] = see.contact ? Text(users[Text(l, "userId")], "email") : "" }).ToArray());
            // Attendance: this month and the academic year, with the latest marked days and their reasons.
            var monthStart = new DateOnly(today.Year, today.Month, 1);
            var yearStart = year is not null && DateOnly.TryParse(Text(year, "startsOn"), out var ys) ? ys : monthStart.AddMonths(-11); var yearEnd = year is not null && DateOnly.TryParse(Text(year, "endsOn"), out var ye) ? ye : today;
            var days = await Q(c, "SELECT day,status,reason,remark FROM school_db.attendance WHERE school_id=@s AND student_id=@id AND day>=@from AND day<=@to ORDER BY day DESC", ("s", a.School), ("id", id), ("from", yearStart < monthStart ? yearStart : monthStart), ("to", yearEnd > today ? today : yearEnd));
            JsonObject Summary(IEnumerable<JsonObject> rows) { var list = rows.ToList(); int present = list.Count(r => Text(r, "status") == "Present"), late = list.Count(r => Text(r, "status") == "Late"); return new JsonObject { ["present"] = present, ["late"] = late, ["absent"] = list.Count(r => Text(r, "status") == "Absent"), ["excused"] = list.Count(r => Text(r, "status") == "Excused"), ["markedDays"] = list.Count, ["percent"] = list.Count == 0 ? null : AttendanceRules.Percent(present + late, list.Count) }; }
            var attendance = new JsonObject { ["month"] = monthStart.ToString("yyyy-MM"), ["thisMonth"] = Summary(days.Where(r => DateOnly.FromDateTime(((DateTime?)r["day"]?.GetValue<DateTime>()) ?? DateTime.MinValue) >= monthStart)), ["year"] = Summary(days), ["from"] = yearStart.ToString("yyyy-MM-dd"), ["to"] = (yearEnd > today ? today : yearEnd).ToString("yyyy-MM-dd"),
                ["recent"] = new JsonArray(days.Take(10).Select(r => (JsonNode)new JsonObject { ["day"] = r["day"]?.DeepClone(), ["status"] = Text(r, "status"), ["reason"] = Text(r, "reason"), ["remark"] = Text(r, "remark") }).ToArray()) };
            // Homework: the same board the family sees, summarised.
            var homework = (await Records(c, a.School, "homework")).Where(h => Text(h, "classId") == classId && HomeworkRules.Status(Text(h, "status")) != "Draft").ToList();
            var submissions = (await Records(c, a.School, "submissions")).Where(s => Text(s, "studentId") == id.ToString()).ToDictionary(s => Text(s, "homeworkId"));
            var groups = new Dictionary<string, int>(); var board = new List<(JsonObject h, string group, JsonObject? sub)>();
            foreach (var h in homework) { submissions.TryGetValue(Text(h, "id"), out var sub); var g = GroupOf(h, sub, now); groups[g] = groups.GetValueOrDefault(g) + 1; board.Add((h, g, sub)); }
            var counts = new JsonObject(); foreach (var g in HomeworkRules.Groups) counts[g] = groups.GetValueOrDefault(g);
            var homeworkView = new JsonObject
            {
                ["assigned"] = homework.Count, ["counts"] = counts, ["completion"] = Student360Rules.HomeworkCompletion(groups),
                ["due"] = new JsonArray(board.Where(b => b.group is "due-today" or "upcoming" or "missing").OrderBy(b => Text(b.h, "dueDate")).ThenBy(b => Text(b.h, "dueTime")).Take(5).Select(b => (JsonNode)new JsonObject { ["id"] = Text(b.h, "id"), ["title"] = Text(b.h, "title"), ["subject"] = Text(subjects.GetValueOrDefault(Text(b.h, "subjectId")) ?? new(), "name"), ["dueDate"] = Text(b.h, "dueDate"), ["dueTime"] = Text(b.h, "dueTime"), ["group"] = b.group }).ToArray()),
                ["feedback"] = new JsonArray(board.Where(b => b.sub is not null && (Text(b.sub, "feedback") != "" || Text(b.sub, "grade") != "")).OrderByDescending(b => Text(b.sub!, "reviewedAt")).Take(5).Select(b => (JsonNode)new JsonObject { ["title"] = Text(b.h, "title"), ["subject"] = Text(subjects.GetValueOrDefault(Text(b.h, "subjectId")) ?? new(), "name"), ["grade"] = Text(b.sub!, "grade"), ["feedback"] = Text(b.sub!, "feedback"), ["reviewedAt"] = Text(b.sub!, "reviewedAt") }).ToArray()),
            };
            // Exams: what is coming for the class, and published results only (the report card reads the same rule).
            var exams = (await Records(c, a.School, "exams")).Where(e => Text(e, "classId") == classId && ExamRules.FamilyVisible(Text(e, "status"))).ToList();
            var upcoming = new JsonArray(exams.Where(e => string.CompareOrdinal(Text(e, "date"), today.ToString("yyyy-MM-dd")) >= 0).OrderBy(e => Text(e, "date")).ThenBy(e => Text(e, "startsAt")).Take(5).Select(e => { var v = ExamView(e, classes, subjects, schemes, years, false); return (JsonNode)new JsonObject { ["id"] = v["id"]?.DeepClone(), ["name"] = v["name"]?.DeepClone(), ["subjectName"] = v["subjectName"]?.DeepClone(), ["date"] = v["date"]?.DeepClone(), ["startsAt"] = v["startsAt"]?.DeepClone(), ["endsAt"] = v["endsAt"]?.DeepClone(), ["room"] = v["room"]?.DeepClone(), ["status"] = v["status"]?.DeepClone() }; }).ToArray());
            var card = (JsonObject)JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(await ReportCard(c, a, id, null, null, null), JsonOptions))!;
            var results = card["results"] as JsonArray ?? [];
            var examsView = new JsonObject { ["upcoming"] = upcoming, ["published"] = results.Count, ["obtained"] = card["obtained"]?.DeepClone(), ["maximum"] = card["maximum"]?.DeepClone(), ["percent"] = card["percent"]?.DeepClone(), ["grade"] = card["grade"]?.DeepClone(), ["passed"] = card["passed"]?.DeepClone(), ["failed"] = card["failed"]?.DeepClone(),
                ["latest"] = new JsonArray(results.Reverse().Take(5).Select(r => r!.DeepClone()).ToArray()) };
            // Fees: authoritative figures from charges and payments, for the office and the family only.
            // Fees: the authoritative ledger summary (Fees 2.0), for the office and the family only.
            JsonObject fees;
            if (see.fees) { fees = await LedgerSummary(c, a.School, id, today); fees["overdue"] = fees["overdueCount"]?.DeepClone(); }
            else fees = new JsonObject { ["available"] = false, ["reason"] = "Fee details are shown to the school office and the family." };
            // Documents: certificates issued to the student and the files attached to them.
            var certificates = (await Records(c, a.School, "certificates")).Where(x => Text(x, "studentId") == id.ToString()).OrderByDescending(x => Text(x, "issuedOn")).ToList();
            var attachments = certificates.Count == 0 ? new() : await AttachmentCounts(c, a.School, certificates.Select(x => Text(x, "id")));
            var documents = new JsonArray(certificates.Select(x => (JsonNode)new JsonObject { ["id"] = Text(x, "id"), ["type"] = Text(x, "type"), ["number"] = Text(x, "certificateNumber"), ["issuedOn"] = Text(x, "issuedOn"), ["files"] = attachments.GetValueOrDefault(Text(x, "id")) }).ToArray());
            // Notices: what this student's family would read, newest first.
            var notices = new JsonArray((await Records(c, a.School, "circulars")).Where(n => Text(n, "audience") is "All" or "Student" or "Parent" && (Text(n, "classId") == "" || Text(n, "classId") == classId)).OrderByDescending(n => Text(n, "createdAt")).Take(5).Select(n => (JsonNode)new JsonObject { ["id"] = Text(n, "id"), ["title"] = Text(n, "title"), ["audience"] = Text(n, "audience"), ["createdAt"] = Text(n, "createdAt"), ["dueDate"] = Text(n, "dueDate") }).ToArray());
            // Timetable: the class's day as the family reads it, with the teacher actually taking each period. Nothing about why a teacher is away.
            var timetable = classId == "" ? new JsonObject { ["date"] = today.ToString("yyyy-MM-dd"), ["day"] = TimetableRules.DayOf(today), ["classId"] = "", ["className"] = "", ["slots"] = new JsonArray(), ["periods"] = new JsonArray() } : FamilyDay(await LoadTimetable(c, a.School), classId, today);
            var timeline = await StudentTimeline(c, a, id, classId, see.fees);
            var (events, total, more) = Student360Rules.Page(timeline, 1, Student360Rules.DefaultTimelinePage);
            var header = new JsonObject { ["id"] = Text(pupil, "id"), ["name"] = Text(pupil, "name"), ["firstName"] = Text(pupil, "firstName"), ["lastName"] = Text(pupil, "lastName"), ["admissionNumber"] = Text(pupil, "admissionNumber"), ["className"] = Text(academics, "className"), ["year"] = Text(academics, "year"), ["status"] = Text(pupil, "status"), ["admissionDate"] = pupil["admissionDate"]?.DeepClone(),
                ["email"] = see.contact ? Text(pupil, "email") : "", ["phone"] = see.contact ? Text(pupil, "phone") : "", ["dateOfBirth"] = see.contact ? pupil["dateOfBirth"]?.DeepClone() : null, ["guardians"] = see.guardians ? guardians : new JsonArray() };
            return Results.Ok(new { data = new { student = header, visibility = new { see.contact, see.fees, see.guardians, see.history }, academics, attendance, homework = homeworkView, exams = examsView, fees, documents, notices, timetable, timeline = new { items = new JsonArray(events.Select(EventView).ToArray()), total, more, page = 1, pageSize = Student360Rules.DefaultTimelinePage }, generatedAt = now.ToString("o") } });
        });
        // More of the timeline, a page at a time, in the same order.
        group.MapGet("/students/{id:guid}/360/timeline", async (Guid id, HttpContext http, int page = 1, int? pageSize = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); await StudentOf(c, a, id); var see = Student360Rules.Visibility(a.Role);
            var allocation = (await Q(c, "SELECT class_id::text AS id FROM suite.student_classes WHERE school_id=@s AND student_id=@id", ("s", a.School), ("id", id))).FirstOrDefault();
            var size = Student360Rules.PageSize(pageSize); var (events, total, more) = Student360Rules.Page(await StudentTimeline(c, a, id, allocation is null ? "" : Text(allocation, "id"), see.fees), page, size);
            return Results.Ok(new { data = new { items = new JsonArray(events.Select(EventView).ToArray()), total, more, page = Math.Max(1, page), pageSize = size } });
        });
    }
    static JsonNode EventView(StudentEvent e) => new JsonObject { ["at"] = e.At.ToString("o"), ["kind"] = e.Kind, ["title"] = e.Title, ["detail"] = e.Detail, ["source"] = e.Source, ["entityId"] = e.EntityId };
    /// <summary>
    /// The timeline composed from the records each module already keeps: register history, homework and submissions,
    /// exam schedule and published results, fees, and certificates. Each source is capped, so a long history never
    /// loads whole; a unified event store is a later addition and this reads the same way once it exists.
    /// </summary>
    static async Task<List<StudentEvent>> StudentTimeline(NpgsqlConnection c, SchoolAccess a, Guid id, string classId, bool fees)
    {
        var cap = Student360Rules.PerSourceCap; var events = new List<StudentEvent>();
        foreach (var r in await Q(c, "SELECT day,kind,old_status AS old,new_status AS status,reason,remark,changed_at AS at FROM school_db.attendance_history WHERE school_id=@s AND student_id=@id ORDER BY changed_at DESC LIMIT " + cap, ("s", a.School), ("id", id)))
            if (Student360Rules.Parse(Text(r, "at"), out var at)) events.Add(new(at, "attendance", Text(r, "kind") == "correction" ? $"Attendance corrected to {Text(r, "status")}" : $"Marked {Text(r, "status")}", string.Join(" · ", new[] { Text(r, "day")[..Math.Min(10, Text(r, "day").Length)], Text(r, "reason"), Text(r, "remark") }.Where(x => x != "")), "attendance", ""));
        var subjects = (await Records(c, a.School, "subjects")).ToDictionary(x => Text(x, "id")); string Subject(JsonObject d) => Text(subjects.GetValueOrDefault(Text(d, "subjectId")) ?? new(), "name");
        var homework = (await Records(c, a.School, "homework")).Where(h => Text(h, "classId") == classId && HomeworkRules.Status(Text(h, "status")) != "Draft").Take(cap).ToDictionary(h => Text(h, "id"));
        foreach (var h in homework.Values) if (Student360Rules.Parse(Text(h, "publishedOn"), out var at)) events.Add(new(at, "homework", "Homework set: " + Text(h, "title"), Subject(h) + (Text(h, "dueDate") != "" ? " · due " + Text(h, "dueDate") : ""), "homework", Text(h, "id")));
        foreach (var s in (await Records(c, a.School, "submissions")).Where(s => Text(s, "studentId") == id.ToString()).Take(cap))
        {
            var title = homework.TryGetValue(Text(s, "homeworkId"), out var h) ? Text(h, "title") : "homework";
            if (Student360Rules.Parse(Text(s, "submittedAt"), out var at)) events.Add(new(at, "homework", "Handed in: " + title, Text(s, "late") == "Yes" ? "After the due time" : "", "homework", Text(s, "homeworkId")));
            if (Student360Rules.Parse(Text(s, "reviewedAt"), out var rv)) events.Add(new(rv, "homework", "Reviewed: " + title, string.Join(" · ", new[] { Text(s, "grade"), Text(s, "feedback") }.Where(x => x != "")), "homework", Text(s, "homeworkId")));
            if (Student360Rules.Parse(Text(s, "verifiedAt"), out var vf) && Text(s, "outcome") != "") events.Add(new(vf, "homework", $"Checked as {Text(s, "outcome").ToLowerInvariant()}: " + title, "", "homework", Text(s, "homeworkId")));
        }
        var marks = (await Records(c, a.School, "marks")).Where(m => Text(m, "studentId") == id.ToString()).Select(m => Text(m, "examId")).ToHashSet();
        foreach (var e in (await Records(c, a.School, "exams")).Where(e => Text(e, "classId") == classId && ExamRules.FamilyVisible(Text(e, "status"))).Take(cap))
        {
            if (Student360Rules.Parse(Text(e, "scheduledAt"), out var at)) events.Add(new(at, "exam", "Exam scheduled: " + Text(e, "name"), Subject(e) + " · " + Text(e, "date"), "exams", Text(e, "id")));
            if (ExamRules.ResultsVisible(Text(e, "status")) && marks.Contains(Text(e, "id")) && Student360Rules.Parse(Text(e, "publishedAt"), out var pb)) events.Add(new(pb, "result", "Result published: " + Text(e, "name"), Subject(e), "exams", Text(e, "id")));
        }
        if (fees)
        {
            foreach (var r in await Q(c, "SELECT description,(gross-concession)/100.0 AS net,currency,due_date AS due,created_at AS at FROM suite.charges WHERE school_id=@s AND student_id=@id ORDER BY created_at DESC LIMIT " + cap, ("s", a.School), ("id", id)))
                if (Student360Rules.Parse(Text(r, "at"), out var at)) events.Add(new(at, "fee", "Fee charged: " + Text(r, "description"), Text(r, "currency") + " " + Number(r, "net").ToString("0.##", CultureInfo.InvariantCulture) + " · due " + Text(r, "due")[..Math.Min(10, Text(r, "due").Length)], "fees", ""));
            foreach (var r in await Q(c, "SELECT p.receipt,p.amount/100.0 AS amount,p.method,p.created_at AS at,ch.description,ch.currency FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id AND ch.school_id=p.school_id WHERE p.school_id=@s AND ch.student_id=@id ORDER BY p.created_at DESC LIMIT " + cap, ("s", a.School), ("id", id)))
                if (Student360Rules.Parse(Text(r, "at"), out var at)) events.Add(new(at, "payment", "Payment received: " + Text(r, "currency") + " " + Number(r, "amount").ToString("0.##", CultureInfo.InvariantCulture), Text(r, "description") + " · " + Text(r, "method") + " · receipt " + Text(r, "receipt"), "fees", ""));
        }
        foreach (var x in (await Records(c, a.School, "certificates")).Where(x => Text(x, "studentId") == id.ToString()).Take(cap))
            if (Student360Rules.Parse(Text(x, "issuedOn"), out var at)) events.Add(new(at, "document", "Certificate issued: " + Text(x, "type"), Text(x, "certificateNumber"), "documents", Text(x, "id")));
        return events;
    }
}

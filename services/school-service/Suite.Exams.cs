using System.Globalization;
using System.Text.Json.Nodes;
using Npgsql;

/// <summary>One part of an assessment: its name, its maximum and, when the scheme sets one, the marks needed to pass it.</summary>
public sealed record SchemeComponent(string Name, decimal Max, decimal? Pass);
/// <summary>A grade band: the label a result earns at or above this percentage.</summary>
public sealed record GradeBand(string Label, decimal MinPercent);
/// <summary>
/// How an exam is assessed: plain marks, a grade only, or several components (Theory + Practical, Internal + External).
/// Built from an assessment-scheme record, or from an exam's own maximum and pass marks when it has no scheme.
/// </summary>
public sealed class Scheme
{
    public string Type { get; init; } = "Marks";
    public List<SchemeComponent> Components { get; init; } = [];
    public decimal Max => Components.Sum(x => x.Max);
    public decimal? PassMarks { get; init; }
    public List<GradeBand> Grades { get; init; } = [];
    public bool GradeOnly => Type == "Grade";
}

/// <summary>
/// The rules of exams, marks and results, kept pure so they are tested without a database: the lifecycle and who may
/// move it, how a scheme is read and applied, how a mark is validated and graded, and what families may see.
/// </summary>
public static class ExamRules
{
    public static readonly string[] Statuses = ["Draft", "Scheduled", "MarksEntry", "Submitted", "Approved", "Published", "Closed"];
    public static readonly string[] Types = ["Marks", "Grade", "Components"];
    public static readonly string[] MarkStatuses = ["Present", "Absent", "Exempt"];
    public const int MaxHistory = 10;

    public static string Status(string? status) => string.IsNullOrWhiteSpace(status) ? "Draft" : status;
    public static int Rank(string? status) => Array.IndexOf(Statuses, Status(status));
    /// <summary>Families see an exam on the timetable once it is scheduled; a draft is the school's own business.</summary>
    public static bool FamilyVisible(string? status) => Rank(status) >= 1;
    /// <summary>Only published (or later closed) results reach students and parents.</summary>
    public static bool ResultsVisible(string? status) => Status(status) is "Published" or "Closed";
    /// <summary>Teachers enter marks until the exam is submitted; leadership may still correct until it is published.</summary>
    public static bool MarksEditable(string? status, bool leadership) => leadership ? Rank(status) <= 4 : Rank(status) <= 2;

    /// <summary>
    /// Leadership moves an exam forward through any number of stages, and back only to return marks for correction,
    /// to unpublish for a correction, or to reopen a closed exam. A teacher may only submit marks for approval.
    /// </summary>
    public static string? TransitionProblem(string? from, string to, bool leadership, bool teacher, int marksEntered)
    {
        var current = Status(from);
        if (!Statuses.Contains(to)) return "Choose a valid exam status.";
        if (current == to) return null;
        if (teacher && !leadership)
        {
            if (to != "Submitted") return "Teachers submit marks for approval; the school approves and publishes.";
            if (Rank(current) > 2) return "These marks have already been submitted.";
            return marksEntered == 0 ? "Enter marks before submitting them for approval." : null;
        }
        if (!leadership) return "Only school leadership can change an exam.";
        if (Rank(to) > Rank(current)) return null;
        return (current, to) switch
        {
            ("Submitted", "MarksEntry") or ("Approved", "MarksEntry") => null,
            ("Published", "Approved") => null,
            ("Closed", "Published") => null,
            _ => "That status change is not allowed. Return marks for correction, unpublish, or reopen instead.",
        };
    }

    /// <summary>"Theory:70:28, Practical:30" -> components with a maximum and an optional pass mark each.</summary>
    public static string? ComponentsProblem(string? spec, out List<SchemeComponent> components)
    {
        components = [];
        if (string.IsNullOrWhiteSpace(spec)) return null;
        foreach (var part in spec.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var bits = part.Split(':', StringSplitOptions.TrimEntries);
            if (bits.Length is < 2 or > 3 || bits[0].Length is 0 or > 40) return "Write each component as Name:Maximum or Name:Maximum:Pass, separated by commas.";
            if (!Parse(bits[1], out var max) || max <= 0 || max > 1000) return $"The maximum for {bits[0]} must be between 1 and 1000.";
            decimal? pass = null;
            if (bits.Length == 3) { if (!Parse(bits[2], out var p) || p < 0 || p > max) return $"The pass mark for {bits[0]} must be between 0 and its maximum."; pass = p; }
            if (components.Any(x => string.Equals(x.Name, bits[0], StringComparison.OrdinalIgnoreCase))) return "Component names must be different.";
            components.Add(new(bits[0], max, pass));
        }
        return components.Count > 8 ? "Use at most 8 components." : null;
    }
    /// <summary>"A+:90, A:80, B:60, C:40, D:0" -> bands from the highest down; the last band should start at 0.</summary>
    public static string? GradesProblem(string? spec, out List<GradeBand> grades)
    {
        grades = [];
        if (string.IsNullOrWhiteSpace(spec)) return null;
        foreach (var part in spec.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var bits = part.Split(':', StringSplitOptions.TrimEntries);
            if (bits.Length != 2 || bits[0].Length is 0 or > 10) return "Write each grade as Label:MinimumPercent, separated by commas.";
            if (!Parse(bits[1], out var min) || min < 0 || min > 100) return $"The minimum for grade {bits[0]} must be between 0 and 100.";
            if (grades.Any(x => string.Equals(x.Label, bits[0], StringComparison.OrdinalIgnoreCase))) return "Grade labels must be different.";
            grades.Add(new(bits[0], min));
        }
        grades.Sort((x, y) => y.MinPercent.CompareTo(x.MinPercent));
        if (grades.Count > 12) return "Use at most 12 grades.";
        return grades.Count < 2 ? "A grade scale needs at least two grades." : null;
    }
    /// <summary>The school's A to D thresholds, used when an exam has no scheme or the scheme sets no grades.</summary>
    public static List<GradeBand> LegacyGrades(decimal a, decimal b, decimal c, decimal d) => [new("A", a), new("B", b), new("C", c), new("D", d), new("E", 0)];

    /// <summary>
    /// The scheme an exam is marked by. With a scheme record, its type, components, pass percentage and grades apply;
    /// otherwise the exam's own maximum and pass marks make a single-component marks scheme.
    /// </summary>
    public static string? Build(string? type, string? componentSpec, string? gradeSpec, decimal? passPercent, decimal legacyMax, decimal legacyPass, List<GradeBand> fallbackGrades, out Scheme scheme)
    {
        scheme = new();
        var kind = string.IsNullOrWhiteSpace(type) ? "Marks" : type;
        if (!Types.Contains(kind)) return "Choose a valid assessment type.";
        var problem = ComponentsProblem(componentSpec, out var components) ?? GradesProblem(gradeSpec, out var grades);
        if (problem is not null) return problem;
        GradesProblem(gradeSpec, out grades);
        if (passPercent is < 0 or > 100) return "The pass percentage must be between 0 and 100.";
        if (kind == "Components" && components.Count < 2) return "A component scheme needs at least two components.";
        if (kind == "Grade" && grades.Count == 0) return "A grade-only scheme needs its grade scale.";
        if (kind == "Marks") components = [new("Marks", components.Count == 1 ? components[0].Max : legacyMax, components.Count == 1 ? components[0].Pass : null)];
        if (kind == "Grade") components = [];
        var max = components.Sum(x => x.Max);
        decimal? pass = kind == "Grade" ? null : passPercent is { } pp ? decimal.Round(max * pp / 100, 2) : components.All(x => x.Pass.HasValue) && components.Count > 0 ? components.Sum(x => x.Pass!.Value) : legacyPass;
        scheme = new Scheme { Type = kind, Components = components, PassMarks = pass, Grades = grades.Count > 0 ? grades : fallbackGrades };
        return null;
    }
    public static string Grade(Scheme scheme, decimal percent) => scheme.Grades.FirstOrDefault(g => percent >= g.MinPercent)?.Label ?? scheme.Grades.LastOrDefault()?.Label ?? "";

    /// <summary>"Theory=56; Practical=25" as stored on a mark -> the entered figure per component.</summary>
    public static Dictionary<string, decimal> ParseEntered(string? text)
    {
        var entered = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in (text ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var bits = part.Split('=', 2, StringSplitOptions.TrimEntries);
            if (bits.Length == 2 && Parse(bits[1], out var value)) entered[bits[0]] = value;
        }
        return entered;
    }
    public static string FormatEntered(IEnumerable<KeyValuePair<string, decimal>> entered) => string.Join("; ", entered.Select(x => x.Key + "=" + x.Value.ToString("0.##", CultureInfo.InvariantCulture)));

    /// <summary>
    /// Checks one student's mark against the scheme and works out the total, grade and pass. Absent scores nothing;
    /// exempt is left out of totals; a grade-only mark must use one of the scheme's grades.
    /// </summary>
    public static string? MarkProblem(Scheme scheme, string? status, IReadOnlyDictionary<string, decimal> entered, decimal? score, string? grade, out decimal? total, out string gradeOut, out bool pass)
    {
        total = null; gradeOut = ""; pass = false;
        var state = string.IsNullOrWhiteSpace(status) ? "Present" : status;
        if (!MarkStatuses.Contains(state)) return "Choose Present, Absent or Exempt.";
        if (state == "Absent") { total = scheme.GradeOnly ? null : 0; gradeOut = "AB"; return null; }
        if (state == "Exempt") { gradeOut = "EX"; pass = true; return null; }
        if (scheme.GradeOnly)
        {
            var band = scheme.Grades.FirstOrDefault(g => string.Equals(g.Label, grade?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (band is null) return "Choose one of the scheme's grades: " + string.Join(", ", scheme.Grades.Select(g => g.Label)) + ".";
            gradeOut = band.Label; pass = scheme.PassMarks is null || band.MinPercent >= (scheme.Grades.LastOrDefault()?.MinPercent ?? 0); return null;
        }
        decimal sum = 0; var allPass = true;
        foreach (var component in scheme.Components)
        {
            decimal value;
            if (scheme.Type == "Marks") { if (score is null && !entered.TryGetValue(component.Name, out value)) return "Enter the marks obtained."; value = score ?? entered[component.Name]; }
            else if (!entered.TryGetValue(component.Name, out value)) return $"Enter the marks for {component.Name}.";
            if (value < 0 || value > component.Max) return scheme.Type == "Marks" ? $"Marks must be between 0 and {component.Max:0.##}." : $"Marks for {component.Name} must be between 0 and {component.Max:0.##}.";
            if (component.Pass is { } p && value < p) allPass = false;
            sum += value;
        }
        total = sum;
        var percent = scheme.Max > 0 ? sum / scheme.Max * 100 : 0;
        gradeOut = Grade(scheme, percent);
        pass = allPass && (scheme.PassMarks is null || sum >= scheme.PassMarks);
        return null;
    }
    /// <summary>Two sittings of the same class on one day must not overlap in time; without times, one per subject per day.</summary>
    public static bool Clash(string? dateA, string? startA, string? endA, string? dateB, string? startB, string? endB)
    {
        if (string.IsNullOrWhiteSpace(dateA) || dateA != dateB) return false;
        if (!Time(startA, out var sa) || !Time(endA, out var ea) || !Time(startB, out var sb) || !Time(endB, out var eb)) return false;
        return sa < eb && sb < ea;
    }
    static bool Time(string? text, out TimeOnly time) => TimeOnly.TryParseExact(text, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out time);
    static bool Parse(string text, out decimal value) => decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out value);
}

// Exams & report cards as one workflow on the existing exams and marks records: leadership schedules, teachers enter
// marks for their own classes and submit, leadership reviews, approves and publishes, families see the timetable
// and published results, and the report card reads the same shapes. Every statement names the school of the token.
public static partial class Suite
{
    static readonly string[] ExamStamps = ["scheduledAt", "scheduledBy", "submittedAt", "submittedBy", "approvedAt", "approvedBy", "publishedAt", "publishedBy", "closedAt", "closedBy", "returnedAt", "returnedBy", "returnReason"];
    /// <summary>Records who moved the exam to each stage; moving several stages at once stamps every stage passed.</summary>
    static void StampExam(JsonObject d, JsonObject? old, string to, Guid user, DateTime now, string? reason)
    {
        foreach (var key in ExamStamps) if (old?[key] is not null) d[key] = old[key]!.DeepClone();
        var from = ExamRules.Rank(old is null ? "Draft" : Text(old, "status")); var target = ExamRules.Rank(to); var when = now.ToString("o"); var who = user.ToString();
        if (target > from)
            for (var r = from + 1; r <= target; r++)
            {
                var key = ExamRules.Statuses[r] switch { "Scheduled" => "scheduled", "Submitted" => "submitted", "Approved" => "approved", "Published" => "published", "Closed" => "closed", _ => "" };
                if (key != "") { d[key + "At"] = when; d[key + "By"] = who; }
            }
        else if (to == "MarksEntry") { d["returnedAt"] = when; d["returnedBy"] = who; d["returnReason"] = reason ?? ""; d.Remove("submittedAt"); d.Remove("submittedBy"); d.Remove("approvedAt"); d.Remove("approvedBy"); }
        else if (to == "Approved") { d.Remove("publishedAt"); d.Remove("publishedBy"); }
        else if (to == "Published") { d.Remove("closedAt"); d.Remove("closedBy"); }
    }
    /// <summary>The scheme an exam is marked by, from its assessment-scheme record or its own maximum and pass marks.</summary>
    static async Task<Scheme> SchemeOf(NpgsqlConnection c, Guid school, JsonObject exam, JsonObject? schemeRecord = null, JsonObject? config = null)
    {
        config ??= (await Records(c, school, "school-config")).FirstOrDefault();
        decimal T(string key, decimal fallback) => config is not null && decimal.TryParse(Text(config, key), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : fallback;
        var fallback = ExamRules.LegacyGrades(T("gradeA", 90), T("gradeB", 75), T("gradeC", 60), T("gradeD", 40));
        if (schemeRecord is null && Guid.TryParse(Text(exam, "schemeId"), out var schemeId)) schemeRecord = await Get(c, school, "assessment-schemes", schemeId);
        decimal max = decimal.TryParse(Text(exam, "maxMarks"), NumberStyles.Number, CultureInfo.InvariantCulture, out var m) ? m : 100, pass = decimal.TryParse(Text(exam, "passMarks"), NumberStyles.Number, CultureInfo.InvariantCulture, out var p) ? p : 0;
        decimal? passPercent = schemeRecord is not null && decimal.TryParse(Text(schemeRecord, "passPercent"), NumberStyles.Number, CultureInfo.InvariantCulture, out var pp) ? pp : null;
        var problem = ExamRules.Build(schemeRecord is null ? "Marks" : Text(schemeRecord, "type"), schemeRecord is null ? "" : Text(schemeRecord, "components"), schemeRecord is null ? "" : Text(schemeRecord, "grades"), passPercent, max, pass, fallback, out var scheme);
        Require(problem is null, problem ?? "");
        return scheme;
    }
    static JsonObject SchemeView(Scheme s) => new()
    {
        ["type"] = s.Type, ["max"] = s.Max, ["passMarks"] = s.PassMarks, ["gradeOnly"] = s.GradeOnly,
        ["components"] = new JsonArray(s.Components.Select(x => (JsonNode)new JsonObject { ["name"] = x.Name, ["max"] = x.Max, ["pass"] = x.Pass }).ToArray()),
        ["grades"] = new JsonArray(s.Grades.Select(g => (JsonNode)new JsonObject { ["label"] = g.Label, ["minPercent"] = g.MinPercent }).ToArray()),
    };
    /// <summary>An exam as the people who read it see it. Stamps (who scheduled, submitted, approved, published) are for staff.</summary>
    static JsonObject ExamView(JsonObject e, Dictionary<string, JsonObject> classes, Dictionary<string, JsonObject> subjects, Dictionary<string, JsonObject> schemes, Dictionary<string, JsonObject> years, bool staff)
    {
        var cls = classes.GetValueOrDefault(Text(e, "classId")); var subject = subjects.GetValueOrDefault(Text(e, "subjectId")); var scheme = schemes.GetValueOrDefault(Text(e, "schemeId")); var year = years.GetValueOrDefault(Text(e, "yearId"));
        var view = new JsonObject
        {
            ["id"] = Text(e, "id"), ["version"] = e["version"]?.DeepClone(), ["name"] = Text(e, "name"), ["term"] = Text(e, "term"), ["yearId"] = Text(e, "yearId"), ["yearName"] = year is null ? "" : Text(year, "name"),
            ["classId"] = Text(e, "classId"), ["className"] = cls is null ? "" : Label("classes", cls), ["subjectId"] = Text(e, "subjectId"), ["subjectName"] = subject is null ? "" : Text(subject, "name"),
            ["date"] = Text(e, "date"), ["startsAt"] = Text(e, "startsAt"), ["endsAt"] = Text(e, "endsAt"), ["room"] = Text(e, "room"), ["instructions"] = Text(e, "instructions"),
            ["schemeId"] = Text(e, "schemeId"), ["schemeName"] = scheme is null ? "" : Text(scheme, "name"), ["schemeType"] = scheme is null ? "Marks" : Text(scheme, "type"),
            ["maxMarks"] = Text(e, "maxMarks"), ["passMarks"] = Text(e, "passMarks"), ["status"] = ExamRules.Status(Text(e, "status")), ["resultsVisible"] = ExamRules.ResultsVisible(Text(e, "status")),
        };
        if (staff) foreach (var key in ExamStamps) view[key] = e[key]?.DeepClone();
        return view;
    }
    static JsonObject? MarkView(JsonObject? m, Scheme scheme)
    {
        if (m is null) return null;
        var entered = ExamRules.ParseEntered(Text(m, "components")); var components = new JsonArray();
        foreach (var component in scheme.Components) components.Add(new JsonObject { ["name"] = component.Name, ["max"] = component.Max, ["score"] = entered.TryGetValue(component.Name, out var v) ? v : scheme.Type == "Marks" && decimal.TryParse(Text(m, "score"), NumberStyles.Number, CultureInfo.InvariantCulture, out var s) ? s : null });
        return new JsonObject
        {
            ["id"] = Text(m, "id"), ["version"] = m["version"]?.DeepClone(), ["status"] = Text(m, "status") == "" ? "Present" : Text(m, "status"), ["score"] = m["score"]?.DeepClone(), ["grade"] = Text(m, "grade"), ["pass"] = Text(m, "pass") == "Yes",
            ["components"] = components, ["remarks"] = Text(m, "remarks"), ["enteredAt"] = Text(m, "enteredAt"), ["changes"] = m["history"] is JsonArray h ? h.Count : 0,
        };
    }
    /// <summary>Teachers may enter marks for a subject they are assigned in the class (the class teacher may enter any).</summary>
    static async Task<bool> TeachesExam(NpgsqlConnection c, SchoolAccess a, JsonObject exam)
    {
        if (a.SchoolWide) return true;
        if (a.Role != "Teacher" || !a.Exams.Contains(Text(exam, "id"))) return false;
        var mine = (await Records(c, a.School, "teaching-assignments")).Where(t => a.Teachers.Contains(Text(t, "teacherId")) && Text(t, "classId") == Text(exam, "classId")).Select(t => Text(t, "subjectId")).ToList();
        var classTeacher = (await Records(c, a.School, "classes")).Any(cl => Text(cl, "id") == Text(exam, "classId") && a.Teachers.Contains(Text(cl, "teacherId")));
        return classTeacher || mine.Count == 0 || mine.Contains(Text(exam, "subjectId"));
    }
    /// <summary>Moves an exam to a new stage: the rules decide who may, the record is written once, then announced.</summary>
    static async Task<JsonObject> Transition(NpgsqlConnection c, SchoolAccess a, Guid id, string to, string? reason, int? version)
    {
        var old = await Get(c, a.School, "exams", id); Require(Readable("exams", old, a), "This exam is outside your classes.", 403);
        var leadership = a.SchoolWide && a.Can("exams.manage"); var teacher = !a.SchoolWide && a.Can("marks.manage") && await TeachesExam(c, a, old);
        Require(leadership || teacher, "You cannot change this exam.", 403);
        var entered = (await Records(c, a.School, "marks")).Count(m => Text(m, "examId") == id.ToString());
        var problem = ExamRules.TransitionProblem(Text(old, "status"), to, leadership, teacher, entered); Require(problem is null, problem ?? "", 409);
        var d = (JsonObject)old.DeepClone(); foreach (var key in new[] { "id", "version", "createdAt" }) d.Remove(key);
        d["status"] = to; StampExam(d, old, to, a.User, DateTime.UtcNow, reason);
        var expected = version ?? (int)Number(old, "version");
        await using var tx = await c.BeginTransactionAsync();
        var changed = await E(c, "UPDATE suite.records SET data=@d::jsonb,version=version+1,updated_at=now(),updated_by=@u WHERE school_id=@s AND id=@id AND kind='exams' AND version=@v", ("d", d.ToJsonString()), ("u", a.User), ("s", a.School), ("id", id), ("v", expected));
        Require(changed == 1, "This exam changed since you opened it. Refresh before saving.", 409);
        await tx.CommitAsync();
        await Announce("exams", id, d, old, a);
        d["id"] = id.ToString(); d["version"] = expected + 1; return d;
    }
    static async Task<(Dictionary<string, JsonObject> classes, Dictionary<string, JsonObject> subjects, Dictionary<string, JsonObject> schemes, Dictionary<string, JsonObject> years)> ExamLookups(NpgsqlConnection c, Guid school) =>
        ((await Records(c, school, "classes")).ToDictionary(x => Text(x, "id")), (await Records(c, school, "subjects")).ToDictionary(x => Text(x, "id")), (await Records(c, school, "assessment-schemes")).ToDictionary(x => Text(x, "id")), (await Records(c, school, "academic-years")).ToDictionary(x => Text(x, "id")));
    static bool Matches(JsonObject e, Guid? classId, Guid? yearId, string? term, string? status) =>
        (classId is null || Text(e, "classId") == classId.ToString()) && (yearId is null || Text(e, "yearId") == yearId.ToString()) && (string.IsNullOrWhiteSpace(term) || string.Equals(Text(e, "term"), term, StringComparison.OrdinalIgnoreCase)) && (string.IsNullOrWhiteSpace(status) || ExamRules.Status(Text(e, "status")) == status);

    static void MapExams(RouteGroupBuilder group)
    {
        // The exam timetable: everything scheduled that the caller may see, soonest first. Families never see drafts.
        group.MapGet("/exams/timetable", async (HttpContext http, Guid? classId = null, Guid? yearId = null, string? term = null, string? from = null, string? to = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); var staff = a.SchoolWide || a.Role == "Teacher";
            var (classes, subjects, schemes, years) = await ExamLookups(c, a.School);
            var items = (await Records(c, a.School, "exams")).Where(e => Readable("exams", e, a) && Matches(e, classId, yearId, term, null) && (staff || ExamRules.FamilyVisible(Text(e, "status"))))
                .Where(e => (string.IsNullOrWhiteSpace(from) || string.CompareOrdinal(Text(e, "date"), from) >= 0) && (string.IsNullOrWhiteSpace(to) || string.CompareOrdinal(Text(e, "date"), to) <= 0))
                .OrderBy(e => Text(e, "date")).ThenBy(e => Text(e, "startsAt")).ThenBy(e => Text(e, "name")).Select(e => (JsonNode)ExamView(e, classes, subjects, schemes, years, staff)).ToArray();
            return Results.Ok(new { data = new { items = new JsonArray(items), today = DateTime.UtcNow.ToString("yyyy-MM-dd") } });
        });
        // Every exam the caller manages with how marks entry is going; leadership also gets the school's figures and who needs attention.
        group.MapGet("/exams/overview", async (HttpContext http, Guid? classId = null, Guid? yearId = null, string? term = null, string? status = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "The exam overview is for staff.", 403);
            var (classes, subjects, schemes, years) = await ExamLookups(c, a.School); var config = (await Records(c, a.School, "school-config")).FirstOrDefault();
            var exams = (await Records(c, a.School, "exams")).Where(e => Readable("exams", e, a) && Matches(e, classId, yearId, term, status)).ToList();
            var marks = (await Records(c, a.School, "marks")).GroupBy(m => Text(m, "examId")).ToDictionary(g => g.Key, g => g.ToList());
            var sizes = (await Q(c, "SELECT sc.class_id::text AS id,count(*) AS n FROM suite.student_classes sc JOIN student_db.students s ON s.id=sc.student_id AND s.school_id=sc.school_id WHERE sc.school_id=@s AND s.deleted_at IS NULL AND s.status='Active' GROUP BY sc.class_id", ("s", a.School))).ToDictionary(r => Text(r, "id"), r => (int)Number(r, "n"));
            var list = new JsonArray(); var failing = new Dictionary<string, (int failed, List<string> subjects)>();
            foreach (var e in exams.OrderByDescending(e => Text(e, "date")).ThenBy(e => Text(e, "name")))
            {
                var scheme = await SchemeOf(c, a.School, e, schemes.GetValueOrDefault(Text(e, "schemeId")), config); var rows = marks.GetValueOrDefault(Text(e, "id")) ?? [];
                var present = rows.Where(m => Text(m, "status") is "" or "Present").ToList(); var scored = present.Where(m => decimal.TryParse(Text(m, "score"), NumberStyles.Number, CultureInfo.InvariantCulture, out _)).Select(m => Number(m, "score")).ToList();
                var view = ExamView(e, classes, subjects, schemes, years, true); var assigned = sizes.GetValueOrDefault(Text(e, "classId"));
                view["assigned"] = assigned; view["entered"] = rows.Count; view["missing"] = Math.Max(0, assigned - rows.Count); view["absent"] = rows.Count(m => Text(m, "status") == "Absent"); view["exempt"] = rows.Count(m => Text(m, "status") == "Exempt");
                view["average"] = scored.Count > 0 && scheme.Max > 0 ? decimal.Round(scored.Average() / scheme.Max * 100, 1) : null;
                view["passed"] = present.Count(m => Text(m, "pass") == "Yes"); view["failed"] = present.Count(m => Text(m, "pass") == "No");
                var distribution = new JsonObject(); foreach (var g in present.GroupBy(m => Text(m, "grade")).Where(g => g.Key != "").OrderBy(g => scheme.Grades.FindIndex(b => b.Label == g.Key))) distribution[g.Key] = g.Count();
                view["distribution"] = distribution; view["scheme"] = SchemeView(scheme);
                list.Add(view);
                if (a.SchoolWide && ExamRules.ResultsVisible(Text(e, "status"))) foreach (var m in present.Where(m => Text(m, "pass") == "No"))
                { var key = Text(m, "studentId"); var entry = failing.GetValueOrDefault(key, (0, [])); entry.failed++; entry.subjects.Add(Text(subjects.GetValueOrDefault(Text(e, "subjectId")) ?? new(), "name")); failing[key] = entry; }
            }
            var totals = new JsonObject { ["exams"] = list.Count };
            foreach (var s in ExamRules.Statuses) totals[s] = list.Count(v => Text(v!.AsObject(), "status") == s);
            totals["pendingApproval"] = list.Count(v => Text(v!.AsObject(), "status") == "Submitted"); totals["entryIncomplete"] = list.Count(v => ExamRules.Rank(Text(v!.AsObject(), "status")) <= 2 && (int)Number(v!.AsObject(), "missing") > 0);
            totals["entered"] = list.Sum(v => (int)Number(v!.AsObject(), "entered")); totals["expected"] = list.Sum(v => (int)Number(v!.AsObject(), "assigned"));
            var attention = new JsonArray();
            if (a.SchoolWide && failing.Count > 0)
            {
                var names = (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name,current_class AS class FROM student_db.students WHERE school_id=@s AND id=ANY(@ids::uuid[])", ("s", a.School), ("ids", failing.Keys.ToArray()))).ToDictionary(r => Text(r, "id"));
                foreach (var (student, entry) in failing.OrderByDescending(x => x.Value.failed).Take(25)) attention.Add(new JsonObject { ["studentId"] = student, ["name"] = Text(names.GetValueOrDefault(student) ?? new(), "name"), ["className"] = Text(names.GetValueOrDefault(student) ?? new(), "class"), ["failed"] = entry.failed, ["subjects"] = string.Join(", ", entry.subjects.Distinct()) });
            }
            return Results.Ok(new { data = new { items = list, totals, attention } });
        });
        // The marksheet for one exam: every student of the class with what is entered, the scheme, and what the caller may do.
        group.MapGet("/exams/{id:guid}/marksheet", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Marks entry is for staff.", 403);
            var e = await Get(c, a.School, "exams", id); Require(Readable("exams", e, a), "This exam is outside your classes.", 403);
            var (classes, subjects, schemes, years) = await ExamLookups(c, a.School); var scheme = await SchemeOf(c, a.School, e, schemes.GetValueOrDefault(Text(e, "schemeId")));
            var students = await StudentsOfClass(c, a.School, Id(e, "classId")); var marks = (await Records(c, a.School, "marks")).Where(m => Text(m, "examId") == id.ToString()).ToDictionary(m => Text(m, "studentId"));
            var teaches = await TeachesExam(c, a, e); var status = Text(e, "status");
            var rows = new JsonArray(); foreach (var st in students) rows.Add(new JsonObject { ["studentId"] = Text(st, "id"), ["name"] = Text(st, "name"), ["code"] = Text(st, "code"), ["mark"] = MarkView(marks.GetValueOrDefault(Text(st, "id")), scheme) });
            var canEdit = a.Can("marks.manage") && teaches && ExamRules.MarksEditable(status, a.SchoolWide);
            return Results.Ok(new { data = new { exam = ExamView(e, classes, subjects, schemes, years, true), scheme = SchemeView(scheme), students = rows, entered = marks.Count, canEdit, canSubmit = canEdit && !a.SchoolWide && ExamRules.Rank(status) <= 2 && marks.Count > 0, canReview = a.SchoolWide && a.Can("exams.manage") } });
        });
        // Fast class-wise entry: every row goes through the ordinary marks save (same rules, scope, audit and history); then, if asked, the sheet is submitted.
        group.MapPost("/exams/{id:guid}/marksheet", async (Guid id, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role == "Teacher", "Marks entry is for staff.", 403);
            var e = await Get(c, a.School, "exams", id); Require(Readable("exams", e, a), "This exam is outside your classes.", 403);
            Require(input["entries"] is JsonArray entries && entries.Count <= 500, "Send the marks as a list of entries.");
            var existing = (await Records(c, a.School, "marks")).Where(m => Text(m, "examId") == id.ToString()).ToDictionary(m => Text(m, "studentId"));
            var errors = new JsonArray(); var saved = 0;
            foreach (var node in input["entries"]!.AsArray())
            {
                if (node is not JsonObject entry) continue; var studentId = Text(entry, "studentId");
                var components = entry["components"] is JsonObject comps ? ExamRules.FormatEntered(comps.Where(x => x.Value is JsonValue v && v.TryGetValue<decimal>(out _)).Select(x => new KeyValuePair<string, decimal>(x.Key, x.Value!.GetValue<decimal>()))) : Text(entry, "components");
                var record = new JsonObject { ["examId"] = id.ToString(), ["studentId"] = studentId, ["score"] = entry["score"]?.DeepClone(), ["components"] = components, ["grade"] = Text(entry, "grade"), ["status"] = Text(entry, "status") == "" ? "Present" : Text(entry, "status"), ["remarks"] = Text(entry, "remarks") };
                var old = existing.GetValueOrDefault(studentId); if (old is not null) record["version"] = entry["version"]?.DeepClone() ?? old["version"]?.DeepClone();
                try { await Save("marks", old is null ? null : Guid.Parse(Text(old, "id")), record, http); saved++; }
                catch (SuiteError ex) { errors.Add(new JsonObject { ["studentId"] = studentId, ["message"] = ex.Message }); }
            }
            JsonObject? exam = null;
            if (errors.Count == 0 && input["submit"] is JsonValue flag && flag.TryGetValue<bool>(out var submit) && submit) exam = await Transition(c, a, id, "Submitted", null, null);
            return Results.Ok(new { data = new { saved, errors, status = exam is null ? ExamRules.Status(Text(e, "status")) : Text(exam, "status") } });
        });
        // Schedule, submit, return for correction, approve, publish, close or reopen: one call, the rules decide who may.
        group.MapPost("/exams/{id:guid}/transition", async (Guid id, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c);
            var exam = await Transition(c, a, id, Text(input, "to"), Text(input, "reason"), input["version"] is JsonValue v && v.TryGetValue<int>(out var version) ? version : null);
            return Results.Ok(new { data = new { id, status = Text(exam, "status"), version = exam["version"]?.DeepClone() } });
        });
    }

    /// <summary>
    /// The report card for one student: published results only, grouped by exam with the scheme's components, totals
    /// where the scheme makes them meaningful, the term's attendance when the year is known, and the school's identity.
    /// Student 360 reads the same shape for exam history and subject performance.
    /// </summary>
    static async Task<object> ReportCard(NpgsqlConnection c, SchoolAccess a, Guid student, string? examName, string? term, Guid? yearId)
    {
        var pupil = (await Q(c, "SELECT id,first_name || ' ' || last_name AS name,roll_number AS \"admissionNumber\",current_class AS class FROM student_db.students WHERE id=@id AND school_id=@s AND deleted_at IS NULL", ("id", student), ("s", a.School))).FirstOrDefault(); Require(pupil is not null, "Student not found.", 404);
        var (classes, subjects, schemes, years) = await ExamLookups(c, a.School); var config = (await Records(c, a.School, "school-config")).FirstOrDefault();
        var exams = (await Records(c, a.School, "exams")).Where(e => ExamRules.ResultsVisible(Text(e, "status")) && Matches(e, null, yearId, term, null) && (string.IsNullOrWhiteSpace(examName) || Text(e, "name") == examName)).ToDictionary(e => Text(e, "id"));
        var marks = (await Records(c, a.School, "marks")).Where(m => Text(m, "studentId") == student.ToString() && exams.ContainsKey(Text(m, "examId"))).ToList();
        var results = new List<JsonObject>(); decimal obtained = 0, maximum = 0; var passed = 0; var failed = 0; var gradeOnly = false;
        foreach (var mark in marks.OrderBy(m => Text(exams[Text(m, "examId")], "date")).ThenBy(m => Text(exams[Text(m, "examId")], "name")))
        {
            var exam = exams[Text(mark, "examId")]; var scheme = await SchemeOf(c, a.School, exam, schemes.GetValueOrDefault(Text(exam, "schemeId")), config); var view = MarkView(mark, scheme)!;
            var status = Text(view, "status"); var counted = status == "Present" && !scheme.GradeOnly; var score = counted && decimal.TryParse(Text(mark, "score"), NumberStyles.Number, CultureInfo.InvariantCulture, out var sc) ? sc : status == "Absent" && !scheme.GradeOnly ? 0 : (decimal?)null;
            if (status != "Exempt" && !scheme.GradeOnly) { obtained += score ?? 0; maximum += scheme.Max; } if (scheme.GradeOnly) gradeOnly = true;
            var pass = Text(mark, "pass") == "Yes"; if (status != "Exempt") { if (pass) passed++; else failed++; }
            results.Add(new JsonObject
            {
                ["examId"] = Text(exam, "id"), ["exam"] = Text(exam, "name"), ["term"] = Text(exam, "term"), ["date"] = Text(exam, "date"), ["subject"] = Text(subjects.GetValueOrDefault(Text(exam, "subjectId")) ?? new(), "name"),
                ["status"] = status, ["components"] = view["components"]?.DeepClone(), ["score"] = score, ["maximum"] = scheme.GradeOnly ? null : scheme.Max, ["percent"] = score is { } s2 && scheme.Max > 0 ? decimal.Round(s2 / scheme.Max * 100, 1) : null,
                ["grade"] = Text(view, "grade"), ["pass"] = pass, ["remarks"] = Text(mark, "remarks"), ["schemeType"] = scheme.Type,
            });
        }
        var percent = maximum > 0 ? decimal.Round(obtained / maximum * 100, 2) : 0;
        decimal T(string key, decimal fallback) => config is not null && decimal.TryParse(Text(config, key), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : fallback;
        var overall = maximum == 0 ? (gradeOnly && results.Count > 0 ? "See subjects" : "Not available") : ExamRules.Grade(new Scheme { Grades = ExamRules.LegacyGrades(T("gradeA", 90), T("gradeB", 75), T("gradeC", 60), T("gradeD", 40)) }, percent);
        // Attendance for the period: the chosen year, else the year the exams belong to, else the current year.
        var year = yearId is { } y ? years.GetValueOrDefault(y.ToString()) : exams.Values.Select(e => years.GetValueOrDefault(Text(e, "yearId"))).FirstOrDefault(x => x is not null) ?? years.Values.FirstOrDefault(x => Text(x, "status") == "Current");
        JsonObject? attendance = null;
        if (year is not null && DateOnly.TryParse(Text(year, "startsOn"), out var starts) && DateOnly.TryParse(Text(year, "endsOn"), out var ends))
        {
            var row = (await Q(c, "SELECT count(*) FILTER(WHERE status='Present') AS present,count(*) FILTER(WHERE status='Absent') AS absent,count(*) FILTER(WHERE status='Late') AS late,count(*) FILTER(WHERE status='Excused') AS excused,count(*) AS marked FROM school_db.attendance WHERE school_id=@s AND student_id=@id AND day>=@from AND day<=@to", ("s", a.School), ("id", student), ("from", starts), ("to", ends))).First();
            var marked = (int)Number(row, "marked"); var present = (int)Number(row, "present") + (int)Number(row, "late");
            attendance = new JsonObject { ["present"] = Number(row, "present"), ["absent"] = Number(row, "absent"), ["late"] = Number(row, "late"), ["excused"] = Number(row, "excused"), ["markedDays"] = marked, ["percent"] = marked > 0 ? decimal.Round(present * 100m / marked, 1) : null, ["from"] = Text(year, "startsOn"), ["to"] = Text(year, "endsOn") };
        }
        var allocation = (await Q(c, "SELECT class_id::text AS id FROM suite.student_classes WHERE school_id=@s AND student_id=@id", ("s", a.School), ("id", student))).FirstOrDefault();
        var cls = allocation is null ? null : classes.GetValueOrDefault(Text(allocation, "id")); var teacherNames = await TeacherNames(c, a.School); var school = await SchoolPrint(c, a.School);
        return new
        {
            school, student = pupil, year = year is null ? "" : Text(year, "name"), term = term ?? "", results, obtained, maximum, percent, grade = overall, passed, failed, attendance,
            signatures = new { classTeacher = cls is null ? "" : teacherNames.GetValueOrDefault(Text(cls, "teacherId")) ?? "", principal = Text(school, "principal") },
            generatedAt = DateTime.UtcNow.ToString("o"), note = "Only published exams with entered marks are included. This report is not a board-issued certificate.",
        };
    }
}

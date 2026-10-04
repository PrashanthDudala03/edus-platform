using System.Text.Json.Nodes;
using Npgsql;

/// <summary>
/// The rules of the timetable, kept pure so they are tested without a database: when two periods clash, whether a
/// teacher can cover a period on a date, and which periods a span of dates touches. Times are "HH:mm" strings.
/// </summary>
public static class TimetableRules
{
    public static readonly string[] Days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    public static readonly string[] SlotTypes = ["Teaching", "Break", "Lunch", "Assembly", "Activity", "Free"];
    public const int MaxSlots = 24;
    /// <summary>One timetable period: what the office entered, with the ids the rules compare.</summary>
    public sealed record Period(string Id, string Day, string StartsAt, string EndsAt, string ClassId, string TeacherId, string Room, string YearId, string SubjectId, string SlotId, string ClassName = "");
    public static int Minutes(string hhmm) => TimeOnly.TryParseExact(hhmm, "HH:mm", out var t) ? t.Hour * 60 + t.Minute : -1;
    public static bool ValidSpan(string startsAt, string endsAt) => Minutes(startsAt) >= 0 && Minutes(endsAt) >= 0 && Minutes(startsAt) < Minutes(endsAt);
    /// <summary>Half-open: a period ending at 10:00 does not clash with one starting at 10:00.</summary>
    public static bool Overlaps(string startA, string endA, string startB, string endB) => Minutes(startA) < Minutes(endB) && Minutes(endA) > Minutes(startB);
    public static string DayOf(DateOnly date) => Days[((int)date.DayOfWeek + 6) % 7];
    /// <summary>Periods of different academic years never clash; a period without a year is checked against every year.</summary>
    public static bool SameYear(string a, string b) => a == "" || b == "" || a == b;
    public static string RoomKey(string room) => room.Trim().ToLowerInvariant();
    /// <summary>The first clash of a period with its peers on the same day, named so the office knows what to move.</summary>
    public static string? Conflict(Period d, IEnumerable<Period> peers)
    {
        foreach (var p in peers)
        {
            if (p.Day != d.Day || !SameYear(d.YearId, p.YearId) || !Overlaps(d.StartsAt, d.EndsAt, p.StartsAt, p.EndsAt)) continue;
            var when = p.StartsAt + "–" + p.EndsAt + " on " + d.Day;
            if (p.TeacherId == d.TeacherId) return "This teacher is already with " + p.ClassName + " at " + when + ".";
            if (p.ClassId == d.ClassId) return p.ClassName + " already has a period at " + when + ".";
            if (RoomKey(d.Room) != "" && RoomKey(d.Room) == RoomKey(p.Room)) return d.Room.Trim() + " is taken by " + p.ClassName + " at " + when + ".";
        }
        return null;
    }
    /// <summary>Why a teacher cannot cover a period on a date: it is their own period, they are away, teaching, or already covering.</summary>
    public static string? SubstituteProblem(Period period, string substitute, DateOnly date, IEnumerable<Period> substitutePeriods, IEnumerable<(string startsAt, string endsAt)> covering, bool away)
    {
        if (substitute == period.TeacherId) return "Choose a teacher other than the one being covered.";
        if (away) return "This teacher is away that day.";
        var day = DayOf(date);
        if (substitutePeriods.Any(p => p.Day == day && SameYear(p.YearId, period.YearId) && Overlaps(p.StartsAt, p.EndsAt, period.StartsAt, period.EndsAt))) return "This teacher is teaching at that time.";
        if (covering.Any(s => Overlaps(s.startsAt, s.endsAt, period.StartsAt, period.EndsAt))) return "This teacher already covers another period at that time.";
        return null;
    }
    public static IEnumerable<DateOnly> Dates(DateOnly from, DateOnly to) { for (var d = from; d <= to; d = d.AddDays(1)) yield return d; }
    /// <summary>The periods a teacher's leave touches: every lesson on the days the leave covers, in order.</summary>
    public static List<(DateOnly date, Period period)> Affected(IEnumerable<Period> periods, DateOnly from, DateOnly to) =>
        Dates(from, to).SelectMany(d => periods.Where(p => p.Day == DayOf(d)).OrderBy(p => Minutes(p.StartsAt)).ThenBy(p => p.ClassName, StringComparer.Ordinal).Select(p => (d, p))).ToList();
    /// <summary>Monday to Sunday of the week that holds a date.</summary>
    public static (DateOnly from, DateOnly to) Week(DateOnly date) { var from = date.AddDays(-(((int)date.DayOfWeek + 6) % 7)); return (from, from.AddDays(6)); }
    /// <summary>Where a day stands at a moment: the index of the period in progress (or -1) and of the next one (or -1).</summary>
    public static (int current, int next) Position(IReadOnlyList<(string startsAt, string endsAt)> ordered, int nowMinutes)
    {
        for (var i = 0; i < ordered.Count; i++)
        {
            if (Minutes(ordered[i].startsAt) <= nowMinutes && nowMinutes < Minutes(ordered[i].endsAt)) return (i, i + 1 < ordered.Count ? i + 1 : -1);
            if (Minutes(ordered[i].startsAt) > nowMinutes) return (-1, i);
        }
        return (-1, -1);
    }
}

// Timetable 2.0: the school's period structure, lessons with teacher, class and room clash detection, and the effective
// timetable on a date once substitutions cover a teacher who is away. Every statement names the school of the token;
// families read the effective schedule and nothing about why a teacher is away.
public static partial class Suite
{
    static TimetableRules.Period PeriodOf(JsonObject t, Dictionary<string, JsonObject>? classes = null) =>
        new(Text(t, "id"), Text(t, "day"), Text(t, "startsAt"), Text(t, "endsAt"), Text(t, "classId"), Text(t, "teacherId"), Text(t, "room"), Text(t, "yearId"), Text(t, "subjectId"), Text(t, "slotId"),
            classes is not null && classes.TryGetValue(Text(t, "classId"), out var cls) ? Label("classes", cls) : "another class");

    static async Task ValidateTimetable(NpgsqlConnection c, SchoolAccess a, string kind, JsonObject d, JsonObject? old, Guid? id, List<JsonObject> peers)
    {
        if (kind == "period-slots")
        {
            Require(TimetableRules.ValidSpan(Text(d, "startsAt"), Text(d, "endsAt")), "The period must end after it starts.");
            var order = Number(d, "order"); Require(order >= 1 && order <= TimetableRules.MaxSlots && decimal.Truncate(order) == order, "Order must be a whole number from 1 to " + TimetableRules.MaxSlots + ".");
            Require(TimetableRules.SlotTypes.Contains(Text(d, "type")), "Choose a period type.");
            Require(!peers.Any(p => string.Equals(Text(p, "name"), Text(d, "name"), StringComparison.OrdinalIgnoreCase)), "A period with this name already exists.", 409);
            var clash = peers.FirstOrDefault(p => TimetableRules.Overlaps(Text(p, "startsAt"), Text(p, "endsAt"), Text(d, "startsAt"), Text(d, "endsAt")));
            Require(clash is null, "This period overlaps " + Text(clash ?? new(), "name") + " (" + Text(clash ?? new(), "startsAt") + "–" + Text(clash ?? new(), "endsAt") + ").", 409);
            Require(peers.Count < TimetableRules.MaxSlots, "A day holds at most " + TimetableRules.MaxSlots + " periods.", 409);
        }
        if (kind == "timetable")
        {
            // Times come from the chosen period of the school's structure, or are entered when the school has none.
            if (Text(d, "slotId") != "")
            {
                var slot = await Get(c, a.School, "period-slots", Id(d, "slotId"));
                Require(Text(slot, "type") == "Teaching", Text(slot, "name") + " is a " + Text(slot, "type").ToLowerInvariant() + " period, not a teaching period.");
                d["startsAt"] = Text(slot, "startsAt"); d["endsAt"] = Text(slot, "endsAt");
            }
            Require(Text(d, "startsAt") != "" && Text(d, "endsAt") != "", "Choose a period or enter start and end times.");
            Require(TimetableRules.ValidSpan(Text(d, "startsAt"), Text(d, "endsAt")), "Period must end after it starts.");
            var classes = (await Records(c, a.School, "classes")).ToDictionary(x => Text(x, "id"));
            Require(classes.ContainsKey(Text(d, "classId")), "Select a valid class.");
            if (Text(d, "yearId") == "") d["yearId"] = Text(classes[Text(d, "classId")], "yearId");
            var conflict = TimetableRules.Conflict(PeriodOf(d, classes), peers.Select(p => PeriodOf(p, classes)));
            Require(conflict is null, conflict ?? "", 409);
            var assignments = await Records(c, a.School, "teaching-assignments");
            Require(assignments.Any(x => Text(x, "classId") == Text(d, "classId") && Text(x, "subjectId") == Text(d, "subjectId") && Text(x, "teacherId") == Text(d, "teacherId")), "Create the matching teacher / class / subject assignment first.");
        }
        if (kind == "substitutions")
        {
            var period = await Get(c, a.School, "timetable", Id(d, "timetableId")); var date = Day(d, "date"); var original = Text(period, "teacherId");
            Require(TimetableRules.DayOf(date) == Text(period, "day"), "That period is on " + Text(period, "day") + ", not on the chosen date.");
            Require(!peers.Any(p => Text(p, "timetableId") == Text(d, "timetableId") && Text(p, "date") == Text(d, "date")), "This period already has a substitute for that date. Change that substitution instead.", 409);
            // The period's own teacher must be away that day: approved leave, or marked absent in the staff register.
            var away = (await Records(c, a.School, "leave-requests")).Where(l => Text(l, "status") == "Approved" && LeaveRules.Covers(Day(l, "fromDate"), Day(l, "toDate"), date)).ToList();
            var absent = (await Records(c, a.School, "staff-attendance")).Where(s => Text(s, "day") == date.ToString("yyyy-MM-dd") && Text(s, "status") is "Absent" or "Excused").Select(s => Text(s, "teacherId")).ToHashSet();
            var leave = away.FirstOrDefault(l => Text(l, "teacherId") == original);
            Require(leave is not null || absent.Contains(original), "The period's teacher is not on approved leave or marked absent that day.", 409);
            if (Text(d, "leaveId") != "") Require(leave is not null && Text(leave, "id") == Text(d, "leaveId"), "That leave does not cover this teacher on the chosen date.");
            else if (leave is not null) d["leaveId"] = Text(leave, "id");
            d["originalTeacherId"] = original;
            var substitute = Text(d, "teacherId"); var classes = (await Records(c, a.School, "classes")).ToDictionary(x => Text(x, "id"));
            var timetable = (await Records(c, a.School, "timetable")).Select(t => PeriodOf(t, classes)).ToList();
            var covering = peers.Where(p => Text(p, "teacherId") == substitute && Text(p, "date") == Text(d, "date")).Select(p => timetable.FirstOrDefault(t => t.Id == Text(p, "timetableId"))).Where(t => t is not null).Select(t => (t!.StartsAt, t.EndsAt)).ToList();
            var substituteAway = away.Any(l => Text(l, "teacherId") == substitute) || absent.Contains(substitute);
            var problem = TimetableRules.SubstituteProblem(PeriodOf(period, classes), substitute, date, timetable.Where(t => t.TeacherId == substitute), covering, substituteAway);
            Require(problem is null, problem ?? "", 409);
        }
    }

    /// <summary>Everything the effective timetable is made of, loaded once per request.</summary>
    sealed record TimetableContext(List<JsonObject> Periods, List<JsonObject> Slots, List<JsonObject> Substitutions, Dictionary<string, JsonObject> Classes, Dictionary<string, JsonObject> Subjects, Dictionary<string, string> Teachers, List<JsonObject> Leaves, List<JsonObject> Absences, Dictionary<string, JsonObject> LeaveTypes)
    {
        public bool Away(string teacherId, DateOnly date) => Leaves.Any(l => Text(l, "teacherId") == teacherId && LeaveRules.Covers(Day(l, "fromDate"), Day(l, "toDate"), date)) || Absences.Any(s => Text(s, "teacherId") == teacherId && Text(s, "day") == date.ToString("yyyy-MM-dd"));
        public JsonObject? Cover(string timetableId, DateOnly date) => Substitutions.FirstOrDefault(s => Text(s, "timetableId") == timetableId && Text(s, "date") == date.ToString("yyyy-MM-dd"));
        public string Name(string teacherId) => Teachers.GetValueOrDefault(teacherId) ?? "";
    }
    static async Task<TimetableContext> LoadTimetable(NpgsqlConnection c, Guid school)
    {
        var (classes, subjects, _, _) = await ExamLookups(c, school);
        var leaves = (await Records(c, school, "leave-requests")).Where(l => Text(l, "status") == "Approved").ToList();
        var absences = (await Records(c, school, "staff-attendance")).Where(s => Text(s, "status") is "Absent" or "Excused").ToList();
        return new(await Records(c, school, "timetable"), (await Records(c, school, "period-slots")).OrderBy(s => Number(s, "order")).ThenBy(s => TimetableRules.Minutes(Text(s, "startsAt"))).ToList(), await Records(c, school, "substitutions"),
            classes, subjects, await TeacherNames(c, school), leaves, absences, (await Records(c, school, "leave-types")).ToDictionary(t => Text(t, "id")));
    }
    static JsonObject SlotView(JsonObject s) => new() { ["id"] = Text(s, "id"), ["name"] = Text(s, "name"), ["order"] = s["order"]?.DeepClone(), ["startsAt"] = Text(s, "startsAt"), ["endsAt"] = Text(s, "endsAt"), ["type"] = Text(s, "type") };
    /// <summary>
    /// One period as a reader sees it. With a date, the substitute (if any) becomes the effective teacher. The office
    /// also learns whether the teacher is away and whether the period is covered; a family sees the effective teacher only.
    /// </summary>
    static JsonObject PeriodView(TimetableContext x, JsonObject t, DateOnly? date, bool office)
    {
        var teacherId = Text(t, "teacherId"); var cls = x.Classes.GetValueOrDefault(Text(t, "classId")); var subject = x.Subjects.GetValueOrDefault(Text(t, "subjectId"));
        var v = new JsonObject
        {
            ["id"] = Text(t, "id"), ["day"] = Text(t, "day"), ["startsAt"] = Text(t, "startsAt"), ["endsAt"] = Text(t, "endsAt"), ["slotId"] = Text(t, "slotId"), ["room"] = Text(t, "room"), ["yearId"] = Text(t, "yearId"),
            ["classId"] = Text(t, "classId"), ["className"] = cls is null ? "" : Label("classes", cls), ["subjectId"] = Text(t, "subjectId"), ["subjectName"] = subject is null ? "" : Text(subject, "name"),
            ["teacherId"] = teacherId, ["teacherName"] = x.Name(teacherId), ["version"] = t["version"]?.DeepClone(),
        };
        if (date is null) return v;
        var cover = x.Cover(Text(t, "id"), date.Value); var away = x.Away(teacherId, date.Value);
        v["date"] = date.Value.ToString("yyyy-MM-dd"); v["substituted"] = cover is not null;
        v["effectiveTeacherId"] = cover is null ? teacherId : Text(cover, "teacherId"); v["effectiveTeacherName"] = cover is null ? x.Name(teacherId) : x.Name(Text(cover, "teacherId"));
        if (!office) return v;
        v["away"] = away; v["status"] = cover is not null ? "covered" : away ? "uncovered" : "scheduled";
        if (cover is not null) v["substitution"] = new JsonObject { ["id"] = Text(cover, "id"), ["teacherId"] = Text(cover, "teacherId"), ["teacherName"] = x.Name(Text(cover, "teacherId")), ["note"] = Text(cover, "note"), ["version"] = cover["version"]?.DeepClone() };
        return v;
    }
    static IEnumerable<JsonObject> OnDay(TimetableContext x, string day, Func<JsonObject, bool> where) => x.Periods.Where(t => Text(t, "day") == day && where(t)).OrderBy(t => TimetableRules.Minutes(Text(t, "startsAt"))).ThenBy(t => Text(t, "classId"), StringComparer.Ordinal);
    /// <summary>The class a student is allocated to, checked against the caller's scope before any lookup.</summary>
    static async Task<string> ClassOfStudent(NpgsqlConnection c, SchoolAccess a, Guid student)
    {
        Require(a.SchoolWide || a.Students.Contains(student.ToString()), "This student is outside your scope.", 403);
        var row = (await Q(c, "SELECT class_id::text AS id FROM suite.student_classes WHERE school_id=@s AND student_id=@id", ("s", a.School), ("id", student))).FirstOrDefault();
        return row is null ? "" : Text(row, "id");
    }
    /// <summary>A class's day as a family reads it: effective teachers, nothing about leave.</summary>
    static JsonObject FamilyDay(TimetableContext x, string classId, DateOnly date) => new()
    {
        ["date"] = date.ToString("yyyy-MM-dd"), ["day"] = TimetableRules.DayOf(date), ["classId"] = classId, ["className"] = x.Classes.TryGetValue(classId, out var cls) ? Label("classes", cls) : "",
        ["slots"] = new JsonArray(x.Slots.Select(s => (JsonNode)SlotView(s)).ToArray()),
        ["periods"] = new JsonArray(OnDay(x, TimetableRules.DayOf(date), t => Text(t, "classId") == classId).Select(t => (JsonNode)PeriodView(x, t, date, false)).ToArray()),
    };

    static void MapTimetable(RouteGroupBuilder group)
    {
        // The week of a class, a teacher or a room: the office reads any; a teacher their own and their classes; a family its class.
        group.MapGet("/timetable/week", async (HttpContext http, string? classId = null, string? teacherId = null, string? room = null, DateOnly? date = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Can("timetable.view"), "Access denied.", 403);
            var anchor = date ?? DateOnly.FromDateTime(DateTime.UtcNow); var (from, to) = TimetableRules.Week(anchor); var office = a.SchoolWide;
            if (!office)
            {
                Require(string.IsNullOrEmpty(room), "Room timetables are read by the school office.", 403);
                if (a.Role == "Teacher") { if (string.IsNullOrEmpty(classId) && string.IsNullOrEmpty(teacherId)) teacherId = a.Teachers.FirstOrDefault() ?? ""; Require((string.IsNullOrEmpty(teacherId) || a.Teachers.Contains(teacherId)) && (string.IsNullOrEmpty(classId) || a.Classes.Contains(classId)), "This timetable is outside your classes.", 403); }
                else { Require(string.IsNullOrEmpty(teacherId), "Teacher timetables are read by the school office.", 403); if (string.IsNullOrEmpty(classId)) classId = a.Classes.FirstOrDefault() ?? ""; Require(a.Classes.Contains(classId), "This timetable is outside your family's classes.", 403); }
            }
            var x = await LoadTimetable(c, a.School);
            var rows = x.Periods.Where(t => (string.IsNullOrEmpty(classId) || Text(t, "classId") == classId) && (string.IsNullOrEmpty(teacherId) || Text(t, "teacherId") == teacherId) && (string.IsNullOrEmpty(room) || TimetableRules.RoomKey(Text(t, "room")) == TimetableRules.RoomKey(room)))
                .OrderBy(t => Array.IndexOf(TimetableRules.Days, Text(t, "day"))).ThenBy(t => TimetableRules.Minutes(Text(t, "startsAt"))).ThenBy(t => Text(t, "classId"), StringComparer.Ordinal)
                .Select(t => (JsonNode)PeriodView(x, t, from.AddDays(Math.Max(0, Array.IndexOf(TimetableRules.Days, Text(t, "day")))), office)).ToArray();
            var week = new JsonArray(TimetableRules.Days.Select((day, i) => (JsonNode)new JsonObject { ["day"] = day, ["date"] = from.AddDays(i).ToString("yyyy-MM-dd") }).ToArray());
            return Results.Ok(new { data = new { from = from.ToString("yyyy-MM-dd"), to = to.ToString("yyyy-MM-dd"), days = week, slots = new JsonArray(x.Slots.Select(s => (JsonNode)SlotView(s)).ToArray()), periods = new JsonArray(rows), office,
                filter = new { classId = classId ?? "", teacherId = teacherId ?? "", room = room ?? "" }, classes = new JsonArray(x.Classes.Values.Select(k => (JsonNode)new JsonObject { ["id"] = Text(k, "id"), ["name"] = Label("classes", k) }).ToArray()) } });
        });
        // One day as the caller lives it: a teacher's own lessons plus the periods they cover; a family's class with effective teachers.
        group.MapGet("/timetable/today", async (HttpContext http, DateOnly? date = null, Guid? studentId = null, string? classId = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Can("timetable.view"), "Access denied.", 403);
            var day = date ?? DateOnly.FromDateTime(DateTime.UtcNow); var x = await LoadTimetable(c, a.School); var name = TimetableRules.DayOf(day);
            if (a.Role == "Teacher" && studentId is null && string.IsNullOrEmpty(classId))
            {
                var mine = OnDay(x, name, t => a.Teachers.Contains(Text(t, "teacherId"))).Select(t => PeriodView(x, t, day, true)).ToList();
                var covering = x.Substitutions.Where(s => a.Teachers.Contains(Text(s, "teacherId")) && Text(s, "date") == day.ToString("yyyy-MM-dd")).Select(s => x.Periods.FirstOrDefault(t => Text(t, "id") == Text(s, "timetableId"))).Where(t => t is not null)
                    .Select(t => { var v = PeriodView(x, t!, day, true); v["covering"] = true; v["originalTeacherName"] = x.Name(Text(t!, "teacherId")); return v; });
                var all = mine.Concat(covering).OrderBy(v => TimetableRules.Minutes(Text(v, "startsAt"))).Select(v => (JsonNode)v).ToArray();
                return Results.Ok(new { data = new { date = day.ToString("yyyy-MM-dd"), day = name, away = a.Teachers.Any(t => x.Away(t, day)), slots = new JsonArray(x.Slots.Select(s => (JsonNode)SlotView(s)).ToArray()), periods = new JsonArray(all) } });
            }
            if (studentId is not null) classId = await ClassOfStudent(c, a, studentId.Value);
            else if (string.IsNullOrEmpty(classId)) classId = a.SchoolWide ? "" : a.Classes.FirstOrDefault() ?? "";
            Require(a.SchoolWide || a.Classes.Contains(classId ?? ""), "This class is outside your scope.", 403);
            return Results.Ok(new { data = FamilyDay(x, classId ?? "", day) });
        });
        // The office's day: who is away, which periods that touches, which are covered and which still need someone.
        group.MapGet("/timetable/operations", async (HttpContext http, DateOnly? date = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide && a.Can("substitutions.view"), "The daily operations view is for the school office.", 403);
            var day = date ?? DateOnly.FromDateTime(DateTime.UtcNow); var x = await LoadTimetable(c, a.School); var name = TimetableRules.DayOf(day);
            var onLeave = x.Leaves.Where(l => LeaveRules.Covers(Day(l, "fromDate"), Day(l, "toDate"), day)).Select(l => new JsonObject { ["teacherId"] = Text(l, "teacherId"), ["teacherName"] = x.Name(Text(l, "teacherId")), ["leaveId"] = Text(l, "id"), ["type"] = x.LeaveTypes.TryGetValue(Text(l, "typeId"), out var lt) ? Text(lt, "name") : "", ["halfDay"] = Text(l, "halfDay"), ["fromDate"] = Text(l, "fromDate"), ["toDate"] = Text(l, "toDate"), ["source"] = "leave" }).ToList();
            var marked = x.Absences.Where(s => Text(s, "day") == day.ToString("yyyy-MM-dd") && onLeave.All(l => Text(l, "teacherId") != Text(s, "teacherId"))).Select(s => new JsonObject { ["teacherId"] = Text(s, "teacherId"), ["teacherName"] = x.Name(Text(s, "teacherId")), ["leaveId"] = "", ["type"] = Text(s, "status"), ["halfDay"] = "", ["fromDate"] = Text(s, "day"), ["toDate"] = Text(s, "day"), ["source"] = "register" });
            var away = onLeave.Concat(marked).OrderBy(t => Text(t, "teacherName")).ToList(); var awayIds = away.Select(t => Text(t, "teacherId")).ToHashSet();
            var periods = OnDay(x, name, t => awayIds.Contains(Text(t, "teacherId"))).Select(t => PeriodView(x, t, day, true)).ToList();
            var covered = periods.Count(p => Text(p, "status") == "covered");
            return Results.Ok(new { data = new { date = day.ToString("yyyy-MM-dd"), day = name, away = new JsonArray(away.Select(t => (JsonNode)t).ToArray()), periods = new JsonArray(periods.Select(p => (JsonNode)p).ToArray()),
                summary = new { away = away.Count, affected = periods.Count, covered, uncovered = periods.Count - covered } } });
        });
        // Who could cover a period on a date, with why not; teachers of that subject or class come first.
        group.MapGet("/timetable/candidates", async (HttpContext http, Guid timetableId, DateOnly date) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide && a.Can("substitutions.manage"), "Assigning substitutes is for the school office.", 403);
            var x = await LoadTimetable(c, a.School); var t = await Get(c, a.School, "timetable", timetableId); var period = PeriodOf(t, x.Classes);
            var assignments = await Records(c, a.School, "teaching-assignments"); var dateText = date.ToString("yyyy-MM-dd");
            var rows = x.Teachers.Where(k => k.Key != period.TeacherId).Select(k =>
            {
                var covering = x.Substitutions.Where(s => Text(s, "teacherId") == k.Key && Text(s, "date") == dateText).Select(s => x.Periods.FirstOrDefault(p => Text(p, "id") == Text(s, "timetableId"))).Where(p => p is not null).Select(p => (Text(p!, "startsAt"), Text(p!, "endsAt")));
                var problem = TimetableRules.SubstituteProblem(period, k.Key, date, x.Periods.Select(p => PeriodOf(p)).Where(p => p.TeacherId == k.Key), covering, x.Away(k.Key, date));
                return new JsonObject { ["teacherId"] = k.Key, ["name"] = k.Value, ["free"] = problem is null, ["reason"] = problem ?? "", ["teachesSubject"] = assignments.Any(s => Text(s, "teacherId") == k.Key && Text(s, "subjectId") == period.SubjectId), ["teachesClass"] = assignments.Any(s => Text(s, "teacherId") == k.Key && Text(s, "classId") == period.ClassId),
                    ["load"] = x.Periods.Count(p => Text(p, "teacherId") == k.Key && Text(p, "day") == TimetableRules.DayOf(date)) + covering.Count() };
            }).OrderByDescending(r => (bool)r["free"]!).ThenByDescending(r => (bool)r["teachesSubject"]!).ThenByDescending(r => (bool)r["teachesClass"]!).ThenBy(r => (int)r["load"]!).ThenBy(r => Text(r, "name")).Take(60);
            return Results.Ok(new { data = new { period = PeriodView(x, t, date, true), candidates = new JsonArray(rows.Select(r => (JsonNode)r).ToArray()) } });
        });
        // Copy a class's day onto another weekday, all or nothing: every copied period passes the same clash rules.
        group.MapPost("/timetable/copy", async (JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide && a.Can("timetable.manage"), "Only the school office edits the timetable.", 403);
            var classId = Id(d, "classId").ToString(); var fromDay = Text(d, "fromDay"); var toDay = Text(d, "toDay");
            Require(TimetableRules.Days.Contains(fromDay) && TimetableRules.Days.Contains(toDay) && fromDay != toDay, "Choose two different weekdays.");
            await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
            var peers = await Records(c, a.School, "timetable"); var source = peers.Where(t => Text(t, "classId") == classId && Text(t, "day") == fromDay).ToList();
            Require(source.Count > 0, "There is nothing on " + fromDay + " for this class.");
            Require(!peers.Any(t => Text(t, "classId") == classId && Text(t, "day") == toDay), toDay + " already has periods for this class. Remove them first.", 409);
            var copied = 0;
            foreach (var t in source)
            {
                var n = new JsonObject(); foreach (var f in Schemas["timetable"].Fields) n[f.Key] = Text(t, f.Key); n["day"] = toDay;
                await ValidateTimetable(c, a, "timetable", n, null, null, peers);
                var id = Guid.NewGuid(); await E(c, "INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES(@id,@s,'timetable',@d::jsonb,@u,@u)", ("id", id), ("s", a.School), ("d", n.ToJsonString()), ("u", a.User));
                n["id"] = id.ToString(); peers.Add(n); copied++;
            }
            await tx.CommitAsync(); return Results.Json(new { data = new { copied } }, statusCode: 201);
        });
    }
}

using System.Text.Json.Nodes;
using Npgsql;

/// <summary>
/// The rules of staff leave, kept pure so they are tested without a database: how many days a request takes, which
/// status changes are allowed and by whom, and what a balance comes to.
/// </summary>
public static class LeaveRules
{
    public static readonly string[] Statuses = ["Pending", "Approved", "Rejected", "Cancelled"];
    public static readonly string[] HalfDays = ["No", "First half", "Second half"];
    public const decimal MaxDaysPerYear = 366;
    public static bool IsHalf(string halfDay) => halfDay is "First half" or "Second half";
    /// <summary>Calendar days from the first to the last, inclusive; a half day is half of one day.</summary>
    public static decimal Days(DateOnly from, DateOnly to, string halfDay) => IsHalf(halfDay) ? 0.5m : to.DayNumber - from.DayNumber + 1;
    public static string? SpanProblem(DateOnly from, DateOnly to, string halfDay) =>
        from > to ? "Leave end date must be on or after the start." : IsHalf(halfDay) && from != to ? "A half day is a single date." : to.DayNumber - from.DayNumber + 1 > MaxDaysPerYear ? "Leave cannot run for more than a year." : null;
    public static bool Covers(DateOnly from, DateOnly to, DateOnly date) => from <= date && date <= to;
    /// <summary>Approved, rejected and cancelled leave is history: its dates, type and reason never change again.</summary>
    public static bool Locked(string status) => status is "Approved" or "Rejected" or "Cancelled";
    /// <summary>Counts against a balance: what was taken, and what is still asked for.</summary>
    public static bool Counts(string status) => status is "Approved" or "Pending";
    /// <summary>
    /// Whether a status change is allowed, and the HTTP status when it is not: 403 when the right person could do it,
    /// 409 when nobody can. New leave starts Pending. An approver decides pending leave and may cancel approved leave;
    /// the staff member may cancel their own pending request.
    /// </summary>
    public static (string message, int status)? TransitionProblem(string from, string to, bool approver, bool owner)
    {
        if (from == "") return to == "Pending" ? null : ("New leave starts as Pending.", 409);
        if (from == to) return null;
        return (from, to) switch
        {
            ("Pending", "Approved") or ("Pending", "Rejected") => approver ? null : ("Only school leadership can approve leave.", 403),
            ("Pending", "Cancelled") => approver || owner ? null : ("Only the staff member or school leadership can cancel this request.", 403),
            ("Approved", "Cancelled") => approver ? null : ("Only school leadership can cancel approved leave.", 403),
            _ => ("Leave that is " + from.ToLowerInvariant() + " cannot become " + to.ToLowerInvariant() + ".", 409),
        };
    }
    public static decimal Remaining(decimal allowance, decimal added, decimal deducted, decimal used) => allowance + added - deducted - used;
    public static string? BalanceProblem(bool tracked, decimal remaining, decimal requested, string typeName) =>
        tracked && requested > remaining ? "Only " + remaining.ToString("0.#") + " day(s) of " + typeName + " remain." : null;
}

// Leave & Approvals 2.0: configurable leave types, server-side balances with an auditable adjustment history,
// requests with half days, a decision workflow for approvers only, and the timetable impact of each request.
// Every statement names the school of the token; a teacher reads their own leave and balances only.
public static partial class Suite
{
    static async Task ValidateLeave(NpgsqlConnection c, SchoolAccess a, string kind, JsonObject d, JsonObject? old, Guid? id, List<JsonObject> peers)
    {
        void Unique(params string[] keys) => Require(!peers.Any(p => keys.All(k => string.Equals(Text(p, k), Text(d, k), StringComparison.OrdinalIgnoreCase))), "A record with these details already exists.", 409);
        if (kind == "leave-types")
        {
            Unique("code"); Unique("name");
            var allowance = Text(d, "yearlyAllowance") == "" ? 0 : Number(d, "yearlyAllowance"); Require(allowance <= LeaveRules.MaxDaysPerYear, "Days per year cannot exceed " + LeaveRules.MaxDaysPerYear + ".");
            if (Text(d, "yearlyAllowance") == "") d["yearlyAllowance"] = 0;
        }
        if (kind == "leave-adjustments")
        {
            Require(old is null, "Adjustments are a permanent history. Add a correcting adjustment instead.", 409);
            var days = Number(d, "days"); Require(days > 0 && days <= LeaveRules.MaxDaysPerYear, "Days must be between 0 and " + LeaveRules.MaxDaysPerYear + ".");
            var type = await Get(c, a.School, "leave-types", Id(d, "typeId")); Require(Text(type, "tracksBalance") == "Yes", Text(type, "name") + " does not track a balance.");
            if (Text(d, "direction") == "Deduct")
            {
                var balance = await LeaveBalance(c, a.School, Text(d, "teacherId"), Text(d, "typeId"), Day(d, "effectiveOn"), null);
                Require(days <= (decimal)balance["remaining"]!, "Only " + ((decimal)balance["remaining"]!).ToString("0.#") + " day(s) remain to deduct.", 409);
            }
        }
        if (kind == "leave-requests")
        {
            var from = Day(d, "fromDate"); var to = Day(d, "toDate"); if (Text(d, "halfDay") == "") d["halfDay"] = "No";
            var span = LeaveRules.SpanProblem(from, to, Text(d, "halfDay")); Require(span is null, span ?? "");
            var oldStatus = old is null ? "" : Text(old, "status"); var status = Text(d, "status");
            var approver = a.SchoolWide && a.Can("leave-requests.approve"); var owner = a.Teachers.Contains(Text(d, "teacherId"));
            var move = LeaveRules.TransitionProblem(oldStatus, status, approver, owner); Require(move is null, move?.message ?? "", move?.status ?? 409);
            if (old is not null && LeaveRules.Locked(oldStatus))
                Require(new[] { "teacherId", "typeId", "fromDate", "toDate", "halfDay", "reason" }.All(k => Text(old, k) == Text(d, k)) && (status == oldStatus ? Text(old, "approvalRemark") == Text(d, "approvalRemark") : true), "Decided leave cannot be edited. Cancel it and submit a new request.", 409);
            Require(status != "Rejected" || Text(d, "approvalRemark") != "", "Give a reason when rejecting leave.");
            Require(!peers.Any(p => Text(p, "teacherId") == Text(d, "teacherId") && LeaveRules.Counts(Text(p, "status")) && LeaveRules.Counts(status) && Day(p, "fromDate") <= to && Day(p, "toDate") >= from), "This staff member already has an overlapping leave request.", 409);
            var days = LeaveRules.Days(from, to, Text(d, "halfDay")); d["days"] = days;
            var types = (await Records(c, a.School, "leave-types")).Where(t => Text(t, "active") == "Yes").ToList();
            if (Text(d, "typeId") == "") Require(old is not null || types.Count == 0, "Choose a leave type.");
            else
            {
                var type = await Get(c, a.School, "leave-types", Id(d, "typeId")); Require(Text(type, "active") == "Yes" || old is not null, "This leave type is not active.");
                // The balance is checked whenever a request starts counting or changes: nobody can be approved into a negative balance.
                if (Text(type, "tracksBalance") == "Yes" && LeaveRules.Counts(status) && (old is null || !LeaveRules.Counts(oldStatus) || Text(old, "days") != Text(d, "days") || Text(old, "typeId") != Text(d, "typeId")))
                {
                    var balance = await LeaveBalance(c, a.School, Text(d, "teacherId"), Text(d, "typeId"), from, id);
                    var problem = LeaveRules.BalanceProblem(true, (decimal)balance["remaining"]!, days, Text(type, "name")); Require(problem is null, problem ?? "", 409);
                }
            }
            // Stamps: when it was submitted, and who decided it and when. The record save is audited as well.
            d["submittedAt"] = old?["submittedAt"]?.DeepClone() ?? DateTime.UtcNow.ToString("o");
            if (status != oldStatus && LeaveRules.Locked(status)) { d["decidedBy"] = a.User.ToString(); d["decidedAt"] = DateTime.UtcNow.ToString("o"); }
            else { if (old?["decidedBy"] is not null) d["decidedBy"] = old["decidedBy"]!.DeepClone(); if (old?["decidedAt"] is not null) d["decidedAt"] = old["decidedAt"]!.DeepClone(); }
        }
    }
    /// <summary>The year a balance is counted in: the current academic year, else the calendar year of the date.</summary>
    static async Task<(DateOnly from, DateOnly to, string name)> LeaveYear(NpgsqlConnection c, Guid school, DateOnly date)
    {
        var current = (await Records(c, school, "academic-years")).FirstOrDefault(y => Text(y, "status") == "Current" && DateOnly.TryParse(Text(y, "startsOn"), out var s) && DateOnly.TryParse(Text(y, "endsOn"), out var e) && s <= date && date <= e)
            ?? (await Records(c, school, "academic-years")).FirstOrDefault(y => Text(y, "status") == "Current");
        return current is null ? (new DateOnly(date.Year, 1, 1), new DateOnly(date.Year, 12, 31), date.Year.ToString()) : (Day(current, "startsOn"), Day(current, "endsOn"), Text(current, "name"));
    }
    /// <summary>One teacher's balance for one leave type in the year of a date; a request being edited is left out of the figures.</summary>
    static async Task<JsonObject> LeaveBalance(NpgsqlConnection c, Guid school, string teacherId, string typeId, DateOnly date, Guid? excluding)
    {
        var type = await Get(c, school, "leave-types", Guid.Parse(typeId)); var (from, to, name) = await LeaveYear(c, school, date);
        return BalanceOf(type, teacherId, from, to, name, await Records(c, school, "leave-requests"), await Records(c, school, "leave-adjustments"), excluding);
    }
    static JsonObject BalanceOf(JsonObject type, string teacherId, DateOnly from, DateOnly to, string yearName, List<JsonObject> requests, List<JsonObject> adjustments, Guid? excluding)
    {
        var typeId = Text(type, "id"); bool In(JsonObject r, string key) => DateOnly.TryParse(Text(r, key), out var day) && LeaveRules.Covers(from, to, day);
        var mine = requests.Where(r => Text(r, "teacherId") == teacherId && Text(r, "typeId") == typeId && Text(r, "id") != excluding?.ToString() && In(r, "fromDate")).ToList();
        decimal DaysOf(JsonObject r) => r["days"] is JsonValue v && v.TryGetValue<decimal>(out var n) ? n : LeaveRules.Days(Day(r, "fromDate"), Day(r, "toDate"), Text(r, "halfDay"));
        var used = mine.Where(r => Text(r, "status") == "Approved").Sum(DaysOf); var pending = mine.Where(r => Text(r, "status") == "Pending").Sum(DaysOf);
        var adjusted = adjustments.Where(x => Text(x, "teacherId") == teacherId && Text(x, "typeId") == typeId && In(x, "effectiveOn")).ToList();
        decimal added = adjusted.Where(x => Text(x, "direction") == "Add").Sum(x => Number(x, "days")), deducted = adjusted.Where(x => Text(x, "direction") == "Deduct").Sum(x => Number(x, "days"));
        var tracked = Text(type, "tracksBalance") == "Yes"; var allowance = Text(type, "yearlyAllowance") == "" ? 0 : Number(type, "yearlyAllowance");
        return new JsonObject { ["typeId"] = typeId, ["name"] = Text(type, "name"), ["code"] = Text(type, "code"), ["paid"] = Text(type, "paid"), ["tracksBalance"] = tracked, ["active"] = Text(type, "active") == "Yes", ["year"] = yearName,
            ["allowance"] = allowance, ["added"] = added, ["deducted"] = deducted, ["used"] = used, ["pending"] = pending, ["remaining"] = tracked ? LeaveRules.Remaining(allowance, added, deducted, used) : (decimal?)null, ["afterPending"] = tracked ? LeaveRules.Remaining(allowance, added, deducted, used) - pending : (decimal?)null };
    }
    /// <summary>The periods a leave touches on the timetable, with who covers each; the office view of an impact.</summary>
    static JsonObject LeaveImpact(TimetableContext x, JsonObject leave)
    {
        var from = Day(leave, "fromDate"); var to = Day(leave, "toDate"); var teacherId = Text(leave, "teacherId");
        var mine = x.Periods.Where(t => Text(t, "teacherId") == teacherId).ToList();
        var affected = TimetableRules.Affected(mine.Select(t => PeriodOf(t, x.Classes)), from, to);
        var periods = affected.Select(e => { var t = mine.First(p => Text(p, "id") == e.period.Id); var v = PeriodView(x, t, e.date, true); v["status"] = Text(v, "substituted") == "true" ? "covered" : "uncovered"; return (JsonNode)v; }).ToArray();
        var covered = periods.Count(p => Text(p!.AsObject(), "status") == "covered");
        return new JsonObject { ["leaveId"] = Text(leave, "id"), ["teacherId"] = teacherId, ["teacherName"] = x.Name(teacherId), ["fromDate"] = Text(leave, "fromDate"), ["toDate"] = Text(leave, "toDate"), ["halfDay"] = Text(leave, "halfDay"), ["days"] = leave["days"]?.DeepClone(),
            ["dates"] = new JsonArray(TimetableRules.Dates(from, to).Select(d => (JsonNode)d.ToString("yyyy-MM-dd")).ToArray()), ["periods"] = new JsonArray(periods), ["summary"] = new JsonObject { ["affected"] = periods.Length, ["covered"] = covered, ["uncovered"] = periods.Length - covered } };
    }
    static async Task<JsonObject> LeaveTeacherOf(NpgsqlConnection c, SchoolAccess a, string? teacherId)
    {
        var mine = a.Teachers.FirstOrDefault() ?? "";
        if (a.SchoolWide) Require(!string.IsNullOrEmpty(teacherId), "Choose a staff member.");
        else { Require(a.Role == "Teacher" && mine != "", "Leave balances belong to staff profiles.", 403); if (string.IsNullOrEmpty(teacherId)) teacherId = mine; Require(a.Teachers.Contains(teacherId), "You may read your own balance only.", 403); }
        var row = (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name FROM teacher_db.teachers WHERE id=@id AND school_id=@s AND deleted_at IS NULL", ("id", Guid.Parse(teacherId!)), ("s", a.School))).FirstOrDefault();
        Require(row is not null, "Staff member not found.", 404); return row!;
    }

    static void MapLeave(RouteGroupBuilder group)
    {
        // A staff member's balances for every leave type this year: what they have, took, asked for and still hold.
        group.MapGet("/leave/balances", async (HttpContext http, string? teacherId = null, DateOnly? date = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Can("leave-requests.view"), "Access denied.", 403);
            var teacher = await LeaveTeacherOf(c, a, teacherId); var today = date ?? DateOnly.FromDateTime(DateTime.UtcNow); var (from, to, name) = await LeaveYear(c, a.School, today);
            var requests = await Records(c, a.School, "leave-requests"); var adjustments = await Records(c, a.School, "leave-adjustments");
            var types = (await Records(c, a.School, "leave-types")).OrderBy(t => Text(t, "name")).Where(t => Text(t, "active") == "Yes" || requests.Any(r => Text(r, "typeId") == Text(t, "id") && Text(r, "teacherId") == Text(teacher, "id")));
            var balances = types.Select(t => (JsonNode)BalanceOf(t, Text(teacher, "id"), from, to, name, requests, adjustments, null)).ToArray();
            var history = a.SchoolWide ? adjustments.Where(x => Text(x, "teacherId") == Text(teacher, "id")).OrderByDescending(x => Text(x, "effectiveOn")).Take(20).Select(x => (JsonNode)new JsonObject { ["id"] = Text(x, "id"), ["typeId"] = Text(x, "typeId"), ["direction"] = Text(x, "direction"), ["days"] = x["days"]?.DeepClone(), ["effectiveOn"] = Text(x, "effectiveOn"), ["reason"] = Text(x, "reason"), ["createdAt"] = Text(x, "createdAt") }).ToArray() : [];
            return Results.Ok(new { data = new { teacherId = Text(teacher, "id"), teacherName = Text(teacher, "name"), year = new { name, from = from.ToString("yyyy-MM-dd"), to = to.ToString("yyyy-MM-dd") }, balances = new JsonArray(balances), adjustments = new JsonArray(history) } });
        });
        // What approvers see first: pending requests with the balance and the lessons each would leave uncovered.
        group.MapGet("/leave/queue", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide && a.Can("leave-requests.view"), "The approval queue is for school leadership.", 403);
            var x = await LoadTimetable(c, a.School); var requests = await Records(c, a.School, "leave-requests"); var adjustments = await Records(c, a.School, "leave-adjustments");
            var pending = requests.Where(r => Text(r, "status") == "Pending").OrderBy(r => Text(r, "fromDate")).ToList(); var rows = new List<JsonNode>();
            foreach (var r in pending)
            {
                var impact = LeaveImpact(x, r); JsonObject? balance = null;
                if (x.LeaveTypes.TryGetValue(Text(r, "typeId"), out var type)) { var (from, to, name) = await LeaveYear(c, a.School, Day(r, "fromDate")); balance = BalanceOf(type, Text(r, "teacherId"), from, to, name, requests, adjustments, Guid.Parse(Text(r, "id"))); }
                rows.Add(new JsonObject { ["id"] = Text(r, "id"), ["version"] = r["version"]?.DeepClone(), ["teacherId"] = Text(r, "teacherId"), ["teacherName"] = x.Name(Text(r, "teacherId")), ["typeId"] = Text(r, "typeId"), ["typeName"] = type is null ? "" : Text(type, "name"),
                    ["fromDate"] = Text(r, "fromDate"), ["toDate"] = Text(r, "toDate"), ["halfDay"] = Text(r, "halfDay"), ["days"] = r["days"]?.DeepClone(), ["reason"] = Text(r, "reason"), ["submittedAt"] = Text(r, "submittedAt"), ["createdAt"] = Text(r, "createdAt"),
                    ["remaining"] = balance?["remaining"]?.DeepClone(), ["tracksBalance"] = balance?["tracksBalance"]?.DeepClone() ?? false, ["impact"] = impact["summary"]!.DeepClone() });
            }
            return Results.Ok(new { data = new { items = new JsonArray(rows.ToArray()), total = rows.Count, canApprove = a.Can("leave-requests.approve") } });
        });
        // The timetable impact of one request: its dates and every lesson they touch, covered or not.
        group.MapGet("/leave/{id:guid}/impact", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); var leave = await Get(c, a.School, "leave-requests", id); Require(Readable("leave-requests", leave, a), "This leave is outside your scope.", 403);
            return Results.Ok(new { data = LeaveImpact(await LoadTimetable(c, a.School), leave) });
        });
        // Decide or cancel: the record is saved through the same rules, audit and notifications as any edit.
        group.MapPost("/leave/{id:guid}/decision", async (Guid id, JsonObject d, HttpContext http) => await LeaveStatus(id, d, http, Text(d, "decision") is "Approved" or "Rejected" ? Text(d, "decision") : throw new SuiteError(400, "Decision must be Approved or Rejected.")));
        group.MapPost("/leave/{id:guid}/cancel", async (Guid id, JsonObject d, HttpContext http) => await LeaveStatus(id, d, http, "Cancelled"));
    }
    static async Task<IResult> LeaveStatus(Guid id, JsonObject d, HttpContext http, string status)
    {
        JsonObject input; await using (var c = await Open()) { var a = await Access(http, c); var leave = await Get(c, a.School, "leave-requests", id); Require(Readable("leave-requests", leave, a), "This leave is outside your scope.", 403); input = new JsonObject(); foreach (var f in Schemas["leave-requests"].Fields) input[f.Key] = Text(leave, f.Key); input["version"] = leave["version"]?.DeepClone(); }
        input["status"] = status; if (Text(d, "remark") != "") input["approvalRemark"] = Text(d, "remark");
        if (d["version"] is not null) input["version"] = d["version"]!.DeepClone();
        return await Save("leave-requests", id, input, http);
    }
}

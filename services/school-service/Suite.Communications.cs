using System.Globalization;
using System.Text.Json.Nodes;
using Npgsql;
using Serilog;

/// <summary>
/// The rules of Communication 2.0, kept pure so they are tested without a database: the lifecycle of a school
/// communication (a circular record), who it reaches, who may read it, what may change after publication, and what
/// the audit log records. The server resolves every audience; nothing here trusts a client.
/// </summary>
public static class CommunicationRules
{
    public static readonly string[] Statuses = ["Draft", "Scheduled", "Published", "Archived", "Cancelled"];
    public static readonly string[] Types = ["Circular", "Notice", "Announcement", "Alert", "Event"];
    public static readonly string[] Priorities = ["Normal", "Important", "Urgent"];
    public static readonly string[] Audiences = ["All", "Staff", "Teacher", "Parent", "Student", "Family"];
    /// <summary>What a teacher may address: the families of one of their classes, never staff or the whole school.</summary>
    public static readonly string[] TeacherAudiences = ["Parent", "Student", "Family"];
    /// <summary>Server-kept fields a generic record save carries over unchanged.</summary>
    public static readonly string[] Kept = ["authorId", "history", "publishedAt", "publishedBy", "scheduledBy", "snapshot", "archivedAt", "cancelledAt", "cancelReason"];
    public const int MaxHistory = 50, MaxScheduleDays = 365;

    /// <summary>Circulars from before Communication 2.0 have no status: they were live from the moment they were saved.</summary>
    public static string Status(string status) => status == "" ? "Published" : status;
    public static string Priority(string priority) => priority == "" ? "Normal" : priority;
    public static string Type(string type) => type == "" ? "Circular" : type;
    public static bool Live(string status) => Status(status) == "Published";
    public static bool Closed(string status) => Status(status) is "Archived" or "Cancelled";
    /// <summary>An acknowledgement is required when asked for, or (pre-2.0) when an acknowledge-by date was given.</summary>
    public static bool Acknowledgement(string flag, string acknowledgeBy) => flag == "Yes" || flag == "" && acknowledgeBy != "";
    /// <summary>The data scopes an audience reaches. Leadership is included only in All and Staff.</summary>
    public static string[] Scopes(string audience) => audience switch
    {
        "All" => ["school", "teacher", "parent", "student"], "Staff" => ["school", "teacher"], "Teacher" => ["teacher"],
        "Parent" => ["parent"], "Student" => ["student"], "Family" => ["parent", "student"], _ => [],
    };
    public static string Scope(string role) => role switch { "Administrator" or "Principal" => "school", "Teacher" => "teacher", "Parent" => "parent", "Student" => "student", _ => "" };
    public static bool Addressed(string audience, string role) => Scope(role) != "" && Scopes(audience).Contains(Scope(role));
    /// <summary>
    /// Who may read a communication that is not leadership's: a draft, a scheduled or a cancelled one only its author;
    /// a published or archived one the people it addresses, within the class when one is set.
    /// </summary>
    public static bool Visible(string status, string audience, string classId, string role, IReadOnlySet<string> classes, bool author) =>
        Status(status) is "Draft" or "Scheduled" or "Cancelled" ? author : Addressed(audience, role) && (classId == "" || classes.Contains(classId));
    /// <summary>Urgent communications and those needing acknowledgement are school-required: a personal mute of the notices category does not hide them.</summary>
    public static bool Required(string priority, string acknowledge, string acknowledgeBy) => Priority(priority) == "Urgent" || Acknowledgement(acknowledge, acknowledgeBy);
    public static bool Expired(string expiresOn, DateOnly today) => DateOnly.TryParseExact(expiresOn, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day) && day < today;
    /// <summary>A publish time as typed (ISO 8601, taken as UTC when no offset is given).</summary>
    public static DateTimeOffset? PublishAt(string text) =>
        DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var at) ? at : null;
    /// <summary>A scheduled communication whose time has come. The scheduler publishes it; publishing by hand first is equally fine.</summary>
    public static bool Due(string status, string publishAt, DateTimeOffset now) => Status(status) == "Scheduled" && PublishAt(publishAt) is { } at && at <= now;
    /// <summary>The title a notification carries: an urgent communication says so first.</summary>
    public static string Headline(string priority, string title) => Priority(priority) == "Urgent" ? "Urgent: " + title : title;

    /// <summary>Whether a status change is allowed and the HTTP status when it is not. Staying where it is changes nothing.</summary>
    public static (string Message, int Status)? TransitionProblem(string from, string to, bool manage)
    {
        from = Status(from);
        if (!Statuses.Contains(to)) return ("Choose a valid status.", 400);
        if (from == to) return null;
        var allowed = (from, to) switch
        {
            ("Draft", "Scheduled") or ("Draft", "Published") or ("Draft", "Cancelled") => true,
            ("Scheduled", "Draft") or ("Scheduled", "Published") or ("Scheduled", "Cancelled") => true,
            ("Published", "Archived") => true,
            _ => false,
        };
        if (!allowed) return ("A communication that is " + from.ToLowerInvariant() + " cannot become " + to.ToLowerInvariant() + ".", 409);
        return manage ? null : ("Your role cannot change this communication.", 403);
    }

    /// <summary>Everything a communication is made of, normalised.</summary>
    public sealed record Composition(string Title, string Message, string Type, string Priority, string Audience, string ClassId, string Status, string PublishAt, string ExpiresOn, string AcknowledgeBy, string Acknowledge);

    /// <summary>
    /// Why a composition cannot be saved, or null. Teacher classes are given for a teacher (and are the classes assigned
    /// to them); leadership passes null. `now` is the moment of publication for the expiry check.
    /// </summary>
    public static (string Message, int Status)? ComposeProblem(Composition c, bool schoolWide, IReadOnlySet<string>? teacherClasses, DateTimeOffset now)
    {
        if (!Types.Contains(c.Type)) return ("Choose a valid type.", 400);
        if (!Priorities.Contains(c.Priority)) return ("Choose a valid priority.", 400);
        if (!Audiences.Contains(c.Audience)) return ("Choose a valid audience.", 400);
        if (c.Priority == "Urgent" && !schoolWide) return ("Only school leadership can send urgent communications.", 403);
        if (teacherClasses is not null)
        {
            if (c.ClassId == "" || !teacherClasses.Contains(c.ClassId)) return ("Teachers address one of the classes assigned to them.", 403);
            if (!TeacherAudiences.Contains(c.Audience)) return ("Teachers may address the families of their classes only.", 403);
        }
        var at = PublishAt(c.PublishAt);
        if (c.Status == "Scheduled")
        {
            if (at is null) return ("Give the date and time to publish at.", 400);
            if (at <= now) return ("The publish time must be in the future.", 400);
            if (at > now.AddDays(MaxScheduleDays)) return ("Schedule within the next year.", 400);
        }
        else if (c.PublishAt != "" && at is null) return ("The publish time is not a valid date and time.", 400);
        if (c.ExpiresOn != "" && DateOnly.TryParseExact(c.ExpiresOn, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var expiry))
        {
            var published = c.Status == "Scheduled" && at is { } when ? DateOnly.FromDateTime(when.UtcDateTime) : DateOnly.FromDateTime(now.UtcDateTime);
            if (c.Status is "Scheduled" or "Published" && expiry < published) return ("The expiry cannot be before publication.", 400);
        }
        return null;
    }

    /// <summary>What may not change: a closed communication at all; a published one keeps whom it reached and how it was marked.</summary>
    public static string? EditProblem(string oldStatus, Composition before, Composition after)
    {
        if (Closed(oldStatus)) return "Archived and cancelled communications are preserved. Create a new one instead.";
        if (Live(oldStatus) && (before.Audience != after.Audience || before.ClassId != after.ClassId || before.Type != after.Type || before.Priority != after.Priority || before.Acknowledge != after.Acknowledge))
            return "A published communication keeps its audience, type, priority and acknowledgement rule. Archive it and send a new one.";
        return null;
    }

    /// <summary>The audit entries one save produces: each status move, an audience change before publication, a material edit after it.</summary>
    public static List<string> AuditActions(Composition? before, Composition after)
    {
        var actions = new List<string>();
        var from = before?.Status ?? "Draft";
        if (from != after.Status) actions.Add(after.Status switch { "Scheduled" => "communication.scheduled", "Published" => "communication.published", "Archived" => "communication.archived", "Cancelled" => "communication.cancelled", _ => "communication.unscheduled" });
        else if (before is not null && after.Status == "Scheduled" && before.PublishAt != after.PublishAt) actions.Add("communication.scheduled");   // rescheduled
        if (before is not null && !Live(from) && !Closed(from) && (before.Audience != after.Audience || before.ClassId != after.ClassId)) actions.Add("communication.audience");
        if (before is not null && Live(from) && from == after.Status && (before.Title != after.Title || before.Message != after.Message || before.ExpiresOn != after.ExpiresOn || before.AcknowledgeBy != after.AcknowledgeBy)) actions.Add("communication.edited");
        return actions;
    }

    /// <summary>The figures leadership reads. Outstanding exists only where acknowledgement is required; it never goes below zero.</summary>
    public static JsonObject Counts(int intended, int notified, int read, int acknowledged, int failed, bool acknowledgement) => new()
    {
        ["intended"] = intended, ["notified"] = notified, ["read"] = read, ["acknowledged"] = acknowledged, ["failed"] = failed,
        ["outstanding"] = acknowledgement ? Math.Max(0, intended - acknowledged) : null,
    };
    /// <summary>The audience in words, for the record and for history.</summary>
    public static string AudienceLabel(string audience, string className) => (audience, className == "") switch
    {
        ("All", true) => "Everyone at the school", ("All", false) => "Everyone connected to " + className,
        ("Staff", true) => "All staff", ("Staff", false) => "Staff teaching " + className,
        ("Teacher", true) => "All teachers", ("Teacher", false) => "Teachers of " + className,
        ("Parent", true) => "All parents", ("Parent", false) => "Parents of " + className,
        ("Student", true) => "All students", ("Student", false) => "Students of " + className,
        ("Family", true) => "All parents and students", ("Family", false) => "Families of " + className,
        _ => audience,
    };
}

// Communication 2.0: the lifecycle, audience, publication, scheduling, read and acknowledgement tracking of school
// communications. A communication is a circular record; publishing it raises the existing circular.published event
// once, and that notification's recipient rows are the record of who it was for at the time.
public static partial class Suite
{
    const int CommunicationPage = 25;
    const string CircularEvent = "circular.published";
    static readonly TimeSpan BackgroundTick = TimeSpan.FromSeconds(30);

    static CommunicationRules.Composition Composed(JsonObject d) => new(Text(d, "title"), Text(d, "message"), CommunicationRules.Type(Text(d, "type")), CommunicationRules.Priority(Text(d, "priority")),
        Text(d, "audience"), Text(d, "classId"), CommunicationRules.Status(Text(d, "status")), Text(d, "publishAt"), Text(d, "expiresOn"), Text(d, "dueDate"),
        CommunicationRules.Acknowledgement(Text(d, "requiresAcknowledgement"), Text(d, "dueDate")) ? "Yes" : "No");

    /// <summary>
    /// The people a communication reaches, resolved on the server from role data scope (holding circulars.view) and the
    /// reviewed account links of the class when one is set. Every query names the school; another school's class answers 404.
    /// </summary>
    static async Task<List<Guid>> CommunicationAudience(NpgsqlConnection c, Guid school, JsonObject d)
    {
        var scopes = CommunicationRules.Scopes(Text(d, "audience")); if (scopes.Length == 0) return [];
        var audience = await UsersWith(c, school, "circulars.view", scopes);
        if (!Guid.TryParse(Text(d, "classId"), out var classId)) return audience.Distinct().ToList();
        var cls = await Get(c, school, "classes", classId);
        var teaching = (await Records(c, school, "teaching-assignments")).Where(t => Text(t, "classId") == classId.ToString()).Select(t => Text(t, "teacherId")).Append(Text(cls, "teacherId")).Where(t => t != "").Distinct().ToArray();
        var inClass = (await FamiliesOfClass(c, school, classId)).Concat(await UsersForTeachers(c, school, teaching)).ToHashSet();
        var leadership = scopes.Contains("school") ? (await UsersWith(c, school, "circulars.view", ["school"])).ToHashSet() : [];
        return audience.Where(user => inClass.Contains(user) || leadership.Contains(user)).Distinct().ToList();
    }

    /// <summary>
    /// The business rules of a circular save, whichever path writes it: normalised fields, the transition, the
    /// composition, what is frozen after publication, the history, and the audience snapshot taken at publication.
    /// `at` is the publication moment the scheduler uses; a request uses now.
    /// </summary>
    static async Task ValidateCommunication(NpgsqlConnection c, SchoolAccess a, JsonObject d, JsonObject? old, Guid? id, DateTimeOffset? at = null)
    {
        foreach (var key in CommunicationRules.Kept) if (old?[key] is not null && d[key] is null) d[key] = old[key]!.DeepClone();
        var now = at ?? DateTimeOffset.UtcNow; var from = old is null ? "Draft" : CommunicationRules.Status(Text(old, "status"));
        var me = Composed(d); d["status"] = me.Status; d["priority"] = me.Priority; d["type"] = me.Type; d["requiresAcknowledgement"] = me.Acknowledge;
        if (Text(d, "dueDate") != "" && (old is null || Text(old, "dueDate") != Text(d, "dueDate"))) Require(Day(d, "dueDate") >= DateOnly.FromDateTime(DateTime.UtcNow), "Acknowledgement deadline cannot be in the past.");
        if (old is not null) { var frozen = CommunicationRules.EditProblem(Text(old, "status"), Composed(old), me); Require(frozen is null, frozen ?? "", 409); }
        if (CommunicationRules.TransitionProblem(from, me.Status, a.Can("circulars.manage")) is { } move) throw new SuiteError(move.Status, move.Message);
        if (CommunicationRules.ComposeProblem(me, a.SchoolWide, a.Role == "Teacher" && !a.SchoolWide ? a.Classes : null, now) is { } problem) throw new SuiteError(problem.Status, problem.Message);
        if (old is null) { d["authorId"] = a.User.ToString(); d["history"] = new JsonArray(); }
        if (old is null || from != me.Status) Remember(d, a, old is null ? "" : from, me.Status, "");
        if (me.Status == "Scheduled") d["scheduledBy"] = a.User.ToString();
        if (me.Status == "Published" && from != "Published")
        {
            // Who this was for, at this moment: the count stays on the record; the people are the notification's recipient rows.
            var audience = await CommunicationAudience(c, a.School, d);
            var className = Guid.TryParse(Text(d, "classId"), out var classId) ? Label("classes", await Get(c, a.School, "classes", classId)) : "";
            d["publishedAt"] = now.ToString("o"); d["publishedBy"] = a.User.ToString();
            d["snapshot"] = new JsonObject { ["count"] = audience.Count, ["at"] = now.ToString("o"), ["audience"] = CommunicationRules.AudienceLabel(me.Audience, className) };
        }
        if (me.Status == "Archived" && from != "Archived") d["archivedAt"] = now.ToString("o");
        if (me.Status == "Cancelled" && from != "Cancelled") d["cancelledAt"] = now.ToString("o");
    }

    /// <summary>Administrative audit of a communication, in the same transaction as the write. Reads and acknowledgements are not audited here.</summary>
    static async Task AuditCommunication(NpgsqlConnection c, SchoolAccess a, Guid id, JsonObject d, JsonObject? old)
    {
        foreach (var action in CommunicationRules.AuditActions(old is null ? null : Composed(old), Composed(d)))
            await E(c, "INSERT INTO suite.audit(school_id,user_id,action,entity_type,entity_id) VALUES(@s,@u,@a,'circulars',@id)", ("s", a.School), ("u", a.User == Guid.Empty ? null : a.User), ("a", action), ("id", id));
    }

    sealed record Tally(int Notified, int Read, int Acknowledged, int Failed);
    /// <summary>What happened to every communication of the school, in three set-based queries (never one per recipient).</summary>
    static async Task<Dictionary<string, Tally>> CommunicationTallies(NpgsqlConnection c, Guid school)
    {
        var notified = await Q(c, """
            SELECT split_part(n.event_key,':',2) AS id,count(r.user_id) AS notified,count(r.read_at) AS read
            FROM notify.notifications n LEFT JOIN notify.recipients r ON r.notification_id=n.id AND r.school_id=@s
            WHERE n.school_id=@s AND n.type=@type GROUP BY n.event_key
            """, ("s", school), ("type", CircularEvent));
        var acknowledged = await Q(c, "SELECT record_id::text AS id,count(*) AS n FROM suite.acknowledgements WHERE school_id=@s GROUP BY record_id", ("s", school));
        var failed = await Q(c, """
            SELECT split_part(n.event_key,':',2) AS id,count(*) AS n FROM notify.deliveries d JOIN notify.notifications n ON n.id=d.notification_id AND n.school_id=@s
            WHERE d.school_id=@s AND d.status='failed' AND n.type=@type GROUP BY n.event_key
            """, ("s", school), ("type", CircularEvent));
        var acks = acknowledged.ToDictionary(r => Text(r, "id"), r => (int)Number(r, "n")); var fails = failed.ToDictionary(r => Text(r, "id"), r => (int)Number(r, "n"));
        var tallies = notified.ToDictionary(r => Text(r, "id"), r => new Tally((int)Number(r, "notified"), (int)Number(r, "read"), acks.GetValueOrDefault(Text(r, "id")), fails.GetValueOrDefault(Text(r, "id"))));
        foreach (var (id, n) in acks) if (!tallies.ContainsKey(id)) tallies[id] = new Tally(0, 0, n, 0);
        return tallies;
    }

    static JsonObject CommunicationView(JsonObject d, Dictionary<string, Tally> tallies, Dictionary<string, string> classes, DateOnly today, bool full)
    {
        var me = Composed(d); var id = Text(d, "id"); var tally = tallies.GetValueOrDefault(id) ?? new Tally(0, 0, 0, 0);
        var intended = d["snapshot"] is JsonObject snapshot && snapshot["count"] is JsonValue count && count.TryGetValue<int>(out var n) ? n : tally.Notified;
        var view = new JsonObject
        {
            ["id"] = id, ["version"] = d["version"]?.DeepClone(), ["title"] = me.Title, ["type"] = me.Type, ["priority"] = me.Priority, ["status"] = me.Status,
            ["audience"] = me.Audience, ["classId"] = me.ClassId, ["className"] = classes.GetValueOrDefault(me.ClassId) ?? "", ["audienceLabel"] = CommunicationRules.AudienceLabel(me.Audience, classes.GetValueOrDefault(me.ClassId) ?? ""),
            ["publishAt"] = me.PublishAt, ["publishedAt"] = Text(d, "publishedAt"), ["expiresOn"] = me.ExpiresOn, ["expired"] = CommunicationRules.Expired(me.ExpiresOn, today),
            ["requiresAcknowledgement"] = me.Acknowledge == "Yes", ["acknowledgeBy"] = me.AcknowledgeBy, ["authorId"] = Text(d, "authorId"), ["createdAt"] = Text(d, "createdAt"),
            ["counts"] = CommunicationRules.Counts(intended, tally.Notified, tally.Read, tally.Acknowledged, tally.Failed, me.Acknowledge == "Yes"),
        };
        if (full) { view["message"] = me.Message; view["history"] = d["history"]?.DeepClone() ?? new JsonArray(); view["snapshot"] = d["snapshot"]?.DeepClone(); view["cancelReason"] = Text(d, "cancelReason"); }
        return view;
    }
    static async Task<Dictionary<string, string>> ClassNames(NpgsqlConnection c, Guid school) => (await Records(c, school, "classes")).ToDictionary(cl => Text(cl, "id"), cl => Label("classes", cl));
    /// <summary>A manager sees the whole school's communications when school-wide; a teacher who may manage sees their own.</summary>
    static bool Mine(JsonObject d, SchoolAccess a) => a.SchoolWide || Text(d, "authorId") == a.User.ToString();
    static SchoolAccess Manager(SchoolAccess a) { Require(a.Can("circulars.manage"), "Your role cannot manage communications.", 403); return a; }
    static string PublishedOrder(JsonObject d) => Text(d, "publishedAt") != "" ? Text(d, "publishedAt") : Text(d, "createdAt");

    static async Task<JsonObject> CommunicationDetail(NpgsqlConnection c, SchoolAccess a, Guid id)
    {
        var d = await Get(c, a.School, "circulars", id);
        Require(Mine(d, a), Readable("circulars", d, a) ? "Your role cannot manage this communication." : "Record not found in this school.", Readable("circulars", d, a) ? 403 : 404);
        var view = CommunicationView(d, await CommunicationTallies(c, a.School), await ClassNames(c, a.School), DateOnly.FromDateTime(DateTime.UtcNow), true);
        view["canUrgent"] = a.SchoolWide;
        return view;
    }

    /// <summary>
    /// One status move on its own transaction under the school lock: the same rules as a record save, a version check
    /// so a double click or two people cannot cross, the audit entry, then the notification after commit. Publishing
    /// something already published changes nothing and answers with its state.
    /// </summary>
    static async Task<IResult> MoveCommunication(Guid id, string action, JsonObject input, HttpContext http)
    {
        var to = action switch { "publish" => "Published", "schedule" => "Scheduled", "unschedule" => "Draft", "cancel" => "Cancelled", "archive" => "Archived", _ => throw new SuiteError(404, "Unknown action.") };
        await using var c = await Open(); var a = Manager(await Access(http, c));
        JsonObject old, d;
        await using (var tx = await c.BeginTransactionAsync())
        {
            await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
            old = await Get(c, a.School, "circulars", id);
            Require(Mine(old, a), Readable("circulars", old, a) ? "Your role cannot manage this communication." : "Record not found in this school.", Readable("circulars", old, a) ? 403 : 404);
            var from = CommunicationRules.Status(Text(old, "status")); var publishAt = action == "schedule" ? Text(input, "publishAt") : Text(old, "publishAt");
            if (from == to && (action != "schedule" || publishAt == Text(old, "publishAt"))) { await tx.RollbackAsync(); return Results.Ok(new { data = await CommunicationDetail(c, a, id), message = "Already " + to.ToLowerInvariant() + "." }); }
            var rawVersion = Number(input, "version"); Require(rawVersion >= 1 && rawVersion <= int.MaxValue && decimal.Truncate(rawVersion) == rawVersion, "Invalid record version.");
            d = (JsonObject)old.DeepClone(); d.Remove("id"); d.Remove("version"); d.Remove("createdAt"); d["status"] = to; d["publishAt"] = publishAt;
            var reason = Text(input, "reason"); if (action == "cancel") { Require(reason != "", "Give a reason for cancelling."); Require(reason.Length <= 500, "Keep the reason within 500 characters."); }
            Writable("circulars", d, a, old);
            await ValidateCommunication(c, a, d, old, id);
            if (action == "cancel") { d["cancelReason"] = reason; if (d["history"] is JsonArray history && history.Count > 0) history[^1]!["reason"] = reason; }
            var changed = await E(c, "UPDATE suite.records SET data=@d::jsonb,version=version+1,updated_at=now(),updated_by=@u WHERE school_id=@s AND id=@id AND version=@v", ("d", d.ToJsonString()), ("u", a.User), ("s", a.School), ("id", id), ("v", (int)rawVersion));
            Require(changed == 1, "This record changed since you opened it. Refresh before saving.", 409);
            await AuditCommunication(c, a, id, d, old);
            await tx.CommitAsync();
        }
        await Announce("circulars", id, d, old, a);
        return Results.Ok(new { data = await CommunicationDetail(c, a, id), message = to == "Published" ? "Published." : to == "Scheduled" ? "Scheduled." : to + "." });
    }

    static void MapCommunications(RouteGroupBuilder group)
    {
        // The workspace: every communication a manager may see, newest first, by status, with what happened to each.
        group.MapGet("/communications", async (HttpContext http, string? status = null, int page = 1) =>
        {
            Require(page is > 0 and < 100000, "Invalid page."); Require(status is null || CommunicationRules.Statuses.Contains(status), "Unknown status.");
            await using var c = await Open(); var a = Manager(await Access(http, c));
            var all = (await Records(c, a.School, "circulars")).Where(d => Mine(d, a)).ToList();
            var counts = CommunicationRules.Statuses.ToDictionary(s => s, s => all.Count(d => CommunicationRules.Status(Text(d, "status")) == s));
            var rows = all.Where(d => status is null || CommunicationRules.Status(Text(d, "status")) == status).OrderByDescending(PublishedOrder).ToList();
            var tallies = await CommunicationTallies(c, a.School); var classes = await ClassNames(c, a.School); var today = DateOnly.FromDateTime(DateTime.UtcNow);
            return Results.Ok(new { data = new { items = rows.Skip((page - 1) * CommunicationPage).Take(CommunicationPage).Select(d => CommunicationView(d, tallies, classes, today, false)), counts, total = rows.Count, page, pageSize = CommunicationPage, canUrgent = a.SchoolWide, schoolWide = a.SchoolWide } });
        });
        // What needs attention: scheduled, recently published, urgent and live, acknowledgements outstanding, delivery failures.
        group.MapGet("/communications/attention", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = Manager(await Access(http, c)); Require(a.SchoolWide, "Only school leadership sees the communication summary.", 403);
            var all = await Records(c, a.School, "circulars"); var tallies = await CommunicationTallies(c, a.School); var classes = await ClassNames(c, a.School);
            var now = DateTimeOffset.UtcNow; var today = DateOnly.FromDateTime(now.UtcDateTime); var week = now.AddDays(-7).ToString("o");
            JsonObject View(JsonObject d) => CommunicationView(d, tallies, classes, today, false);
            var live = all.Where(d => CommunicationRules.Live(Text(d, "status"))).ToList();
            var scheduled = all.Where(d => CommunicationRules.Status(Text(d, "status")) == "Scheduled").OrderBy(d => Text(d, "publishAt")).Take(10).Select(View);
            var recent = live.Where(d => string.CompareOrdinal(Text(d, "publishedAt"), week) >= 0).OrderByDescending(PublishedOrder).Take(10).Select(View);
            var urgent = live.Where(d => CommunicationRules.Priority(Text(d, "priority")) == "Urgent" && !CommunicationRules.Expired(Text(d, "expiresOn"), today)).OrderByDescending(PublishedOrder).Take(10).Select(View);
            var outstanding = live.Select(View).Where(v => v["counts"]!["outstanding"] is JsonValue o && o.TryGetValue<int>(out var left) && left > 0).OrderByDescending(v => v["counts"]!["outstanding"]!.GetValue<int>()).Take(10);
            var failed = Number((await Q(c, "SELECT count(*) AS n FROM notify.deliveries d WHERE d.school_id=@s AND d.status='failed' AND d.updated_at>=now()-interval '7 days'", ("s", a.School)))[0], "n");
            var waiting = Number((await Q(c, "SELECT count(*) AS n FROM notify.deliveries d WHERE d.school_id=@s AND d.status IN('pending','processing')", ("s", a.School)))[0], "n");
            return Results.Ok(new { data = new { scheduled, recent, urgent, outstanding, deliveries = new { failed, waiting, channels = NotificationRules.Available } } });
        });
        // How many people a composition would reach, resolved the same way publication resolves it. Nothing is stored.
        group.MapPost("/communications/audience", async (JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = Manager(await Access(http, c));
            var d = new JsonObject { ["audience"] = Text(input, "audience"), ["classId"] = Text(input, "classId") };
            Require(CommunicationRules.Audiences.Contains(Text(d, "audience")), "Choose a valid audience.");
            if (a.Role == "Teacher" && !a.SchoolWide) Require(Text(d, "classId") != "" && a.Classes.Contains(Text(d, "classId")) && CommunicationRules.TeacherAudiences.Contains(Text(d, "audience")), "Teachers address the families of one of their classes.", 403);
            var className = Guid.TryParse(Text(d, "classId"), out var classId) ? Label("classes", await Get(c, a.School, "classes", classId)) : "";
            var people = await CommunicationAudience(c, a.School, d);
            return Results.Ok(new { data = new { count = people.Count, label = CommunicationRules.AudienceLabel(Text(d, "audience"), className) } });
        });
        // A recipient's own communications: published ones addressed to them, with their read and acknowledgement state.
        group.MapGet("/communications/feed", async (HttpContext http, int page = 1) =>
        {
            Require(page is > 0 and < 100000, "Invalid page.");
            await using var c = await Open(); var a = await Access(http, c); Require(a.Can("circulars.view"), "Access denied.", 403);
            var rows = (await Records(c, a.School, "circulars")).Where(d => CommunicationRules.Live(Text(d, "status")) && Readable("circulars", d, a)).OrderByDescending(PublishedOrder).ToList();
            var read = (await Q(c, """
                SELECT split_part(n.event_key,':',2) AS id,r.read_at AS readat FROM notify.recipients r JOIN notify.notifications n ON n.id=r.notification_id AND n.school_id=@s
                WHERE r.school_id=@s AND r.user_id=@u AND n.type=@type
                """, ("s", a.School), ("u", a.User), ("type", CircularEvent))).ToDictionary(r => Text(r, "id"), r => Text(r, "readat"));
            var acknowledged = (await Q(c, "SELECT record_id::text AS id,created_at AS at FROM suite.acknowledgements WHERE school_id=@s AND user_id=@u", ("s", a.School), ("u", a.User))).ToDictionary(r => Text(r, "id"), r => Text(r, "at"));
            var classes = await ClassNames(c, a.School); var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var items = rows.Skip((page - 1) * CommunicationPage).Take(CommunicationPage).Select(d =>
            {
                var me = Composed(d); var id = Text(d, "id");
                return new JsonObject
                {
                    ["id"] = id, ["title"] = me.Title, ["message"] = me.Message, ["type"] = me.Type, ["priority"] = me.Priority, ["audience"] = me.Audience,
                    ["className"] = classes.GetValueOrDefault(me.ClassId) ?? "", ["publishedAt"] = PublishedOrder(d), ["expiresOn"] = me.ExpiresOn, ["expired"] = CommunicationRules.Expired(me.ExpiresOn, today),
                    ["requiresAcknowledgement"] = me.Acknowledge == "Yes", ["acknowledgeBy"] = me.AcknowledgeBy, ["readAt"] = read.GetValueOrDefault(id) is { Length: > 0 } at ? at : null,
                    ["acknowledgedAt"] = acknowledged.GetValueOrDefault(id) is { Length: > 0 } ack ? ack : null, ["canAcknowledge"] = a.Can("circulars.acknowledge"),
                };
            }).ToList();
            var due = rows.Count(d => CommunicationRules.Acknowledgement(Text(d, "requiresAcknowledgement"), Text(d, "dueDate")) && !acknowledged.ContainsKey(Text(d, "id")));
            return Results.Ok(new { data = new { items, total = rows.Count, page, pageSize = CommunicationPage, acknowledgementsDue = due } });
        });
        group.MapGet("/communications/{id:guid}", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = Manager(await Access(http, c));
            return Results.Ok(new { data = await CommunicationDetail(c, a, id) });
        });
        // Who acknowledged and who has not: names and kind of account only, never contact details.
        group.MapGet("/communications/{id:guid}/acknowledgements", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = Manager(await Access(http, c));
            var d = await Get(c, a.School, "circulars", id); Require(Mine(d, a), "Record not found in this school.", 404);
            var people = await Q(c, """
                SELECT u.first_name || ' ' || u.last_name AS name,t.data_scope AS scope,r.read_at IS NOT NULL AS read,ack.created_at AS acknowledgedat
                FROM notify.recipients r JOIN notify.notifications n ON n.id=r.notification_id AND n.school_id=@s AND n.event_key=@key
                JOIN auth_db.users u ON u.id=r.user_id AND u.school_id=r.school_id JOIN auth_db.roles ro ON ro.id=u.role_id JOIN auth_db.role_templates t ON t.id=ro.template_id
                LEFT JOIN suite.acknowledgements ack ON ack.school_id=r.school_id AND ack.record_id=@id AND ack.user_id=r.user_id
                WHERE r.school_id=@s ORDER BY name LIMIT 2000
                """, ("s", a.School), ("key", NotificationRules.EventKey(CircularEvent, id)), ("id", id));
            var others = await Q(c, """
                SELECT u.first_name || ' ' || u.last_name AS name,t.data_scope AS scope,ack.created_at AS acknowledgedat FROM suite.acknowledgements ack
                JOIN auth_db.users u ON u.id=ack.user_id AND u.school_id=ack.school_id JOIN auth_db.roles ro ON ro.id=u.role_id JOIN auth_db.role_templates t ON t.id=ro.template_id
                WHERE ack.school_id=@s AND ack.record_id=@id ORDER BY ack.created_at LIMIT 2000
                """, ("s", a.School), ("id", id));
            var acknowledged = others.Select(r => new JsonObject { ["name"] = Text(r, "name"), ["scope"] = Text(r, "scope"), ["at"] = Text(r, "acknowledgedat") }).ToList();
            var outstanding = people.Where(r => Text(r, "acknowledgedat") == "").Select(r => new JsonObject { ["name"] = Text(r, "name"), ["scope"] = Text(r, "scope"), ["read"] = Flag(r["read"]) }).ToList();
            return Results.Ok(new { data = new { acknowledged, outstanding, intended = people.Count, requiresAcknowledgement = CommunicationRules.Acknowledgement(Text(d, "requiresAcknowledgement"), Text(d, "dueDate")) } });
        });
        // Opening a communication marks the caller's own copy read; nothing else changes and nobody else's state is touched.
        group.MapPost("/communications/{id:guid}/read", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c);
            var d = await Get(c, a.School, "circulars", id); Require(Readable("circulars", d, a) && CommunicationRules.Live(Text(d, "status")), "Record not found in this school.", 404);
            await E(c, """
                UPDATE notify.recipients r SET read_at=now() FROM notify.notifications n WHERE n.id=r.notification_id AND n.school_id=@s AND n.event_key=@key
                AND r.school_id=@s AND r.user_id=@u AND r.read_at IS NULL
                """, ("s", a.School), ("key", NotificationRules.EventKey(CircularEvent, id)), ("u", a.User));
            var at = await Q(c, """
                SELECT r.read_at AS readat FROM notify.recipients r JOIN notify.notifications n ON n.id=r.notification_id AND n.school_id=@s AND n.event_key=@key
                WHERE r.school_id=@s AND r.user_id=@u
                """, ("s", a.School), ("key", NotificationRules.EventKey(CircularEvent, id)), ("u", a.User));
            return Results.Ok(new { data = new { readAt = at.Count == 1 ? Text(at[0], "readat") : null } });
        });
        group.MapPost("/communications/{id:guid}/{action}", async (Guid id, string action, JsonObject input, HttpContext http) => await MoveCommunication(id, action, input, http));
    }

    /// <summary>
    /// Durable background work inside school-service: the state is in the database, this only polls it. Scheduled
    /// communications whose time has come are published; due outbox rows are handed to their channel. Several instances
    /// may run: the school lock and row claims keep each item to one of them.
    /// </summary>
    public static void StartBackgroundWork(CancellationToken stopping) => _ = Task.Run(() => BackgroundLoop(stopping), stopping);
    static async Task BackgroundLoop(CancellationToken stopping)
    {
        using var timer = new PeriodicTimer(BackgroundTick);
        try
        {
            while (await timer.WaitForNextTickAsync(stopping))
            {
                try { await PublishDueCommunications(); } catch (Exception ex) { Log.Warning(ex, "Scheduled communications were not checked this tick"); }
                try { await DeliverDue(stopping); } catch (Exception ex) { Log.Warning(ex, "The delivery outbox was not checked this tick"); }
            }
        }
        catch (OperationCanceledException) { }
    }
    static async Task PublishDueCommunications()
    {
        await using var c = await Open();
        // The CASE keeps the cast to scheduled rows only, whose publish time is always a valid instant (ComposeProblem).
        var due = await Q(c, "SELECT id,school_id AS school FROM suite.records WHERE kind='circulars' AND archived_at IS NULL AND (CASE WHEN data->>'status'='Scheduled' THEN NULLIF(data->>'publishAt','')::timestamptz END)<=now() ORDER BY data->>'publishAt' LIMIT 100");
        foreach (var row in due)
        {
            var id = Guid.Parse(Text(row, "id"));
            try { await PublishScheduled(c, Guid.Parse(Text(row, "school")), id); }
            catch (Exception ex) { Log.Warning(ex, "Scheduled communication {Id} was not published", id); }
        }
    }
    /// <summary>Publishes one scheduled communication as the person who scheduled it, if it is still due once the school lock is held.</summary>
    static async Task PublishScheduled(NpgsqlConnection c, Guid school, Guid id)
    {
        JsonObject old, d; SchoolAccess a;
        await using (var tx = await c.BeginTransactionAsync())
        {
            await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", school.ToString()));
            old = await Get(c, school, "circulars", id);
            if (!CommunicationRules.Due(Text(old, "status"), Text(old, "publishAt"), DateTimeOffset.UtcNow)) { await tx.RollbackAsync(); return; }
            var actor = Guid.TryParse(Text(old, "scheduledBy"), out var by) ? by : Guid.TryParse(Text(old, "authorId"), out var author) ? author : Guid.Empty;
            a = new SchoolAccess { School = school, User = actor, Role = "Principal", Permissions = ["circulars.manage"] };
            d = (JsonObject)old.DeepClone(); d.Remove("id"); d.Remove("version"); d.Remove("createdAt"); d["status"] = "Published";
            await ValidateCommunication(c, a, d, old, id, CommunicationRules.PublishAt(Text(old, "publishAt")));
            var changed = await E(c, "UPDATE suite.records SET data=@d::jsonb,version=version+1,updated_at=now(),updated_by=@u WHERE school_id=@s AND id=@id AND version=@v", ("d", d.ToJsonString()), ("u", actor), ("s", school), ("id", id), ("v", (int)Number(old, "version")));
            if (changed != 1) { await tx.RollbackAsync(); return; }
            await AuditCommunication(c, a, id, d, old);
            await tx.CommitAsync();
        }
        await Announce("circulars", id, d, old, a);
    }
}

using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EduOS.ServiceAuth;
using Npgsql;
using Serilog;

/// <summary>
/// The fixed vocabulary of the notification engine: which types exist, the category a person can mute, where a
/// notification may lead, and which channels deliver today. Pure, so the rules are tested without a database.
/// </summary>
public static class NotificationRules
{
    public static readonly string[] Channels = ["in-app", "push", "email", "whatsapp", "sms"];
    /// <summary>Channels that deliver today. The others are reserved for later adapters and cannot be switched on yet.</summary>
    public static readonly string[] Available = ["in-app"];
    /// <summary>The longest title and message each channel carries. Wording is refused beyond these and results are clipped to them.</summary>
    public static readonly IReadOnlyDictionary<string, (int Title, int Body)> Limits = new Dictionary<string, (int, int)>
    {
        ["in-app"] = (200, 1000), ["push"] = (65, 240), ["email"] = (150, 1000), ["whatsapp"] = (60, 1000), ["sms"] = (60, 160),
    };
    public static readonly string[] Categories = ["attendance", "homework", "results", "fees", "notices", "leave", "timetable", "school"];
    /// <summary>Destinations an app may open. A notification carries one of these keys, never a URL or a screen path.</summary>
    public static readonly string[] Routes = ["home", "attendance", "homework", "results", "fees", "notices", "leave", "timetable", "school-home"];
    static readonly Dictionary<string, string> TypeCategory = new()
    {
        ["attendance.absent"] = "attendance", ["attendance.late"] = "attendance", ["attendance.corrected"] = "attendance", ["homework.assigned"] = "homework", ["homework.due"] = "homework", ["result.published"] = "results",
        ["homework.reviewed"] = "homework", ["fee.due"] = "fees", ["fee.overdue"] = "fees", ["circular.published"] = "notices", ["message.received"] = "notices",
        ["leave.requested"] = "leave", ["leave.approved"] = "leave", ["leave.rejected"] = "leave", ["timetable.changed"] = "timetable", ["school-home.published"] = "school",
        ["exam.scheduled"] = "timetable", ["exam.rescheduled"] = "timetable",
    };
    public static IReadOnlyCollection<string> Types => TypeCategory.Keys;
    public static bool KnownType(string? type) => type is not null && TypeCategory.ContainsKey(type);
    public static string Category(string type) => TypeCategory.TryGetValue(type, out var category) ? category : throw new ArgumentException("Unknown notification type.", nameof(type));

    /// <summary>
    /// Text that is safe to store and show anywhere: line endings become one kind, control and direction-override
    /// characters are removed, and half of a broken character pair is dropped.
    /// </summary>
    static string Safe(string? text)
    {
        text ??= ""; var clean = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (char.IsHighSurrogate(ch)) { if (i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) clean.Append(ch).Append(text[++i]); continue; }
            if (char.IsLowSurrogate(ch)) continue;
            if (ch == '\r') { if (i + 1 >= text.Length || text[i + 1] != '\n') clean.Append('\n'); continue; }
            if (ch is (char)0x2028 or (char)0x2029 or (char)0x85) { clean.Append('\n'); continue; }
            if (ch is '\n' or '\t') { clean.Append(ch); continue; }
            if (char.IsControl(ch) || ch is >= (char)0x202A and <= (char)0x202E || ch is >= (char)0x2066 and <= (char)0x2069) continue;
            clean.Append(ch);
        }
        return clean.ToString();
    }
    static string Cut(string clean, int max)
    {
        if (clean.Length <= max) return clean;
        var end = max - 1; if (end > 0 && char.IsHighSurrogate(clean[end - 1])) end--;
        return clean[..end].TrimEnd() + "…";
    }
    /// <summary>One line of plain text of bounded length: whitespace is collapsed and long text ends with an ellipsis.</summary>
    public static string Clip(string? text, int max) => Cut(Regex.Replace(Safe(text), @"\s+", " ").Trim(), max);
    /// <summary>A message of bounded length that keeps its line breaks: at most one blank line in a row, no trailing spaces.</summary>
    public static string ClipLines(string? text, int max)
    {
        var lines = Safe(text).Split('\n').Select(line => Regex.Replace(line, @"[^\S\n]+", " ").Trim());
        return Cut(Regex.Replace(string.Join('\n', lines), @"\n{3,}", "\n\n").Trim(), max);
    }
    /// <summary>The destination stored with a notification. An unknown route becomes "home"; nothing else is carried.</summary>
    public static JsonObject Destination(string? route, Guid? entity)
    {
        var destination = new JsonObject { ["route"] = Routes.Contains(route) ? route : "home" };
        if (entity is Guid id) destination["entityId"] = id.ToString();
        return destination;
    }
    /// <summary>Who receives a notification: distinct people, never the person who caused it, never anyone who muted the category.</summary>
    public static Guid[] Targets(IEnumerable<Guid> candidates, Guid? actor, IEnumerable<Guid> muted)
    {
        var silent = muted.ToHashSet();
        return candidates.Distinct().Where(user => user != actor && !silent.Contains(user)).ToArray();
    }
    /// <summary>The data scopes a circular's audience reaches. Leadership is included only when the circular is for everyone.</summary>
    public static string[] AudienceScopes(string? audience) => audience switch
    {
        "Teacher" => ["teacher"], "Parent" => ["parent"], "Student" => ["student"], "All" => ["school", "teacher", "parent", "student"], _ => [],
    };
    /// <summary>
    /// The identity of a business event: its type, the record it is about and, when the same record can raise the
    /// type more than once, which occurrence (a record version or a day). The same event always gives the same key,
    /// and a key is stored once per school, so nothing a client, a retry or a restart does can notify twice.
    /// </summary>
    public static string EventKey(string type, Guid entity, string? occurrence = null)
    {
        if (!KnownType(type)) throw new ArgumentException("Unknown notification type.", nameof(type));
        if (entity == Guid.Empty) throw new ArgumentException("An event needs its source record.", nameof(entity));
        if (occurrence is not null && !Regex.IsMatch(occurrence, @"^[A-Za-z0-9._-]{1,60}$")) throw new ArgumentException("Invalid event occurrence.", nameof(occurrence));
        return type + ":" + entity.ToString("D") + (occurrence is null ? "" : ":" + occurrence);
    }
    /// <summary>An absence is announced only while it is news: for today or yesterday. Older registers are corrections or back-filling.</summary>
    public static bool Timely(DateOnly day, DateOnly today) => day >= today.AddDays(-1) && day <= today.AddDays(1);
}

/// <summary>One row of the delivery outbox, as a delivery worker sees it.</summary>
public sealed record Delivery(string Status, int Attempts, string? LastError, DateTimeOffset? NextAttemptAt, DateTimeOffset? DeliveredAt);

/// <summary>
/// How a delivery moves: pending -> processing -> delivered, or failed and retried later with growing gaps until the
/// attempts run out. No worker runs yet; these are the rules it must follow, tested without one.
/// </summary>
public static class DeliveryRules
{
    public const int MaxAttempts = 5;
    /// <summary>A row left in 'processing' this long was abandoned by a worker that stopped, and may be taken again.</summary>
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(10);
    static readonly TimeSpan[] Backoff = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(30), TimeSpan.FromHours(2)];

    /// <summary>In-app is delivered by being stored. Every other channel waits for the worker.</summary>
    public static Delivery New(string channel, DateTimeOffset now) => channel == "in-app" ? new("delivered", 0, null, null, now) : new("pending", 0, null, now, null);
    public static bool Due(Delivery delivery, DateTimeOffset updatedAt, DateTimeOffset now) =>
        delivery.Status is "pending" or "failed" ? delivery.NextAttemptAt <= now : delivery.Status == "processing" && updatedAt + Lease <= now;
    public static Delivery Claim(Delivery delivery) => delivery with { Status = "processing", NextAttemptAt = null };
    public static Delivery Succeeded(Delivery delivery, DateTimeOffset now) => new("delivered", delivery.Attempts + 1, null, null, now);
    /// <summary>A permanent failure (for example a token the provider no longer knows) is never retried.</summary>
    public static Delivery Failed(Delivery delivery, string? error, bool permanent, DateTimeOffset now)
    {
        var attempts = delivery.Attempts + 1; var again = !permanent && attempts < MaxAttempts;
        return new("failed", attempts, NotificationRules.Clip(error, 300), again ? now + Backoff[Math.Min(attempts, Backoff.Length) - 1] : null, null);
    }
}

/// <summary>What a device may send when it registers for push. Pure, so it is tested without a database.</summary>
public static class DeviceRules
{
    public static readonly string[] Platforms = ["android", "ios"];
    public const int PerAccount = 10;
    public static List<string> Problems(string? installationId, string? platform, string? pushToken, string? appVersion)
    {
        var problems = new List<string>();
        if (!Regex.IsMatch(installationId ?? "", @"^[A-Za-z0-9._:-]{8,100}$")) problems.Add("Invalid installation id.");
        if (!Platforms.Contains(platform)) problems.Add("Platform must be android or ios.");
        if (!Regex.IsMatch(pushToken ?? "", @"^[\x21-\x7E]{20,512}$")) problems.Add("Invalid push token.");
        if (!Regex.IsMatch(appVersion ?? "", @"^[A-Za-z0-9 ._+()-]{0,40}$")) problems.Add("Invalid app version.");
        return problems;
    }
}

// The EduOS notification engine: an inbox per person, read state, preferences, the delivery outbox and devices.
// Notifications are created only by EduOS after an event (see Announce); there is no endpoint that creates one or
// lets a caller choose a recipient. Every query is bound to the school and user in the verified access token.
public static partial class Suite
{
    const int NotificationPage = 30;

    public static async Task InitializeNotifications()
    {
        await using var c = await Open();
        await E(c, File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "NotificationSchema.sql")));
    }

    /// <summary>
    /// Whether the Super Admin's boundary gives this school the feature at all: one of the feature's permission keys
    /// is in the school's boundary. This is the school-level switch; what a person may manage is still their role's.
    /// </summary>
    static async Task<bool> FeatureEnabled(NpgsqlConnection c, Guid school, string feature) =>
        (await Q(c, "SELECT 1 AS one FROM auth_db.school_access WHERE school_id=@s AND allowed && @keys", ("s", school), ("keys", FeatureCatalogue.Keys(feature)))).Count == 1;

    // A link holding something that is not an account id is skipped; it never stops the other recipients.
    static async Task<List<Guid>> Ids(NpgsqlConnection c, string sql, params (string, object?)[] args) => (await Q(c, sql, args)).Select(row => Guid.TryParse(Text(row, "id"), out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).ToList();
    /// <summary>Active accounts of this school in the given data scopes that hold a permission. Targeting follows RBAC, not role names.</summary>
    static Task<List<Guid>> UsersWith(NpgsqlConnection c, Guid school, string permission, string[] scopes) => Ids(c, """
        SELECT u.id::text AS id FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id JOIN auth_db.role_templates t ON t.id=r.template_id
        WHERE u.school_id=@s AND u.is_active AND u.deleted_at IS NULL AND t.data_scope=ANY(@scopes)
        AND EXISTS(SELECT 1 FROM auth_db.effective_permissions e WHERE e.role_id=r.id AND e.permission_key=@p)
        """, ("s", school), ("scopes", scopes), ("p", permission));
    /// <summary>Accounts linked to a staff profile.</summary>
    static Task<List<Guid>> UsersForTeachers(NpgsqlConnection c, Guid school, string[] teachers) => Ids(c, """
        SELECT DISTINCT data->>'userId' AS id FROM suite.records WHERE school_id=@s AND kind='account-links' AND archived_at IS NULL
        AND data->>'relationship'='teacher' AND data->>'teacherId'=ANY(@t)
        """, ("s", school), ("t", teachers));
    /// <summary>Family accounts linked to the students allocated to a class.</summary>
    static Task<List<Guid>> FamiliesOfClass(NpgsqlConnection c, Guid school, Guid classId) => Ids(c, """
        SELECT DISTINCT l.data->>'userId' AS id FROM suite.records l JOIN suite.student_classes sc ON sc.school_id=l.school_id AND sc.student_id::text=l.data->>'studentId'
        WHERE l.school_id=@s AND l.kind='account-links' AND l.archived_at IS NULL AND l.data->>'relationship' IN('parent','student') AND sc.class_id=@c
        """, ("s", school), ("c", classId));
    /// <summary>
    /// The accounts linked to each student: the existing reviewed account links, kept only where the account's role
    /// may see that kind of information. By default parents and guardians only; a student's own account is included
    /// only where the caller asks for it. A link's relationship and the role's data scope use the same words.
    /// </summary>
    static async Task<Dictionary<Guid, List<Guid>>> GuardiansOf(NpgsqlConnection c, Guid school, IEnumerable<Guid> students, string permission, params string[] alsoRelationships)
    {
        string[] relationships = ["parent", .. alsoRelationships];
        var links = await Q(c, """
            SELECT data->>'studentId' AS student,data->>'userId' AS id FROM suite.records WHERE school_id=@s AND kind='account-links' AND archived_at IS NULL
            AND data->>'relationship'=ANY(@relationships) AND data->>'studentId'=ANY(@ids)
            """, ("s", school), ("relationships", relationships), ("ids", students.Select(student => student.ToString()).ToArray()));
        var allowed = (await UsersWith(c, school, permission, relationships)).ToHashSet(); var guardians = new Dictionary<Guid, List<Guid>>();
        foreach (var link in links)
            if (Guid.TryParse(Text(link, "student"), out var student) && Guid.TryParse(Text(link, "id"), out var user) && allowed.Contains(user))
                (guardians.TryGetValue(student, out var list) ? list : guardians[student] = []).Add(user);
        return guardians;
    }

    /// <summary>
    /// The only way a notification comes to exist. Recipients outside the school, inactive accounts, the person who
    /// caused the event and anyone who muted the category are dropped here, whatever the caller passed in. The event
    /// key is stored once per school: the same event a second time creates nothing and returns 0.
    /// The notification, its recipients and its delivery rows are one transaction, so a channel can never be owed a
    /// delivery for a notification that does not exist. Nothing is sent to an outside provider from here.
    /// </summary>
    static async Task<int> Notify(NpgsqlConnection c, Guid school, string type, string eventKey, Composed text, string route, Guid? entity, IEnumerable<Guid> candidates, Guid? actor, string source)
    {
        Require(NotificationRules.KnownType(type) && eventKey.StartsWith(type + ":"), "Unknown notification type.");
        var category = NotificationRules.Category(type); var wanted = candidates.Distinct().ToArray();
        if (wanted.Length == 0 || !await FeatureEnabled(c, school, "notifications")) return 0;
        var members = await Ids(c, "SELECT id::text AS id FROM auth_db.users WHERE school_id=@s AND id=ANY(@ids) AND is_active AND deleted_at IS NULL", ("s", school), ("ids", wanted));
        var muted = await Ids(c, "SELECT user_id::text AS id FROM notify.preferences WHERE school_id=@s AND category=@c AND channel='in-app' AND NOT enabled AND user_id=ANY(@ids)", ("s", school), ("c", category), ("ids", wanted));
        var targets = NotificationRules.Targets(members, actor, muted);
        if (targets.Length == 0) return 0;
        var id = Guid.NewGuid();
        await using var tx = await c.BeginTransactionAsync();
        var created = await E(c, """
            INSERT INTO notify.notifications(id,school_id,type,category,title,body,destination,source,event_key,wording,wording_version,created_by)
            VALUES(@id,@s,@type,@cat,@title,@body,@dest::jsonb,@source,@key,@wording,@version,@actor) ON CONFLICT(school_id,event_key) DO NOTHING
            """, ("id", id), ("s", school), ("type", type), ("cat", category), ("title", text.Text.Title), ("body", text.Text.Body),
            ("dest", NotificationRules.Destination(route, entity).ToJsonString()), ("source", source), ("key", eventKey), ("wording", text.School ? "school" : "default"), ("version", text.Version), ("actor", actor));
        if (created == 0) { await tx.RollbackAsync(); return 0; }
        await E(c, "INSERT INTO notify.recipients(notification_id,school_id,user_id) SELECT @id,@s,unnest(@users)", ("id", id), ("s", school), ("users", targets));
        await E(c, "INSERT INTO notify.deliveries(notification_id,school_id,user_id,channel,status,delivered_at) SELECT @id,@s,unnest(@users),'in-app','delivered',now()", ("id", id), ("s", school), ("users", targets));
        // The outbox for push: one pending row per registered device, picked up later by the delivery worker.
        // Written only once push is a delivering channel, so nothing queues up while there is no worker.
        if (NotificationRules.Available.Contains("push"))
            await E(c, """
                INSERT INTO notify.deliveries(notification_id,school_id,user_id,channel,target,status,next_attempt_at)
                SELECT @id,@s,d.user_id,'push',d.id::text,'pending',now() FROM notify.devices d WHERE d.school_id=@s AND d.user_id=ANY(@users) AND d.enabled AND d.revoked_at IS NULL
                """, ("id", id), ("s", school), ("users", targets));
        await tx.CommitAsync();
        return targets.Length;
    }

    /// <summary>
    /// Turns a saved record into notifications. It runs after the record is committed, on its own connection, and a
    /// failure here is logged and never undoes or delays the save. Running it again for the same event is harmless.
    /// </summary>
    static async Task Announce(string kind, Guid id, JsonObject d, JsonObject? old, SchoolAccess a)
    {
        try
        {
            if (kind is not ("circulars" or "leave-requests" or "homework" or "submissions" or "exams")) return;
            await using var c = await Open();
            if (kind == "circulars" && old is null)
            {
                // The same people who may read the circular: its audience, narrowed to the class when one is set.
                var scopes = NotificationRules.AudienceScopes(Text(d, "audience")); var audience = await UsersWith(c, a.School, "circulars.view", scopes);
                JsonObject? cls = null;
                if (Guid.TryParse(Text(d, "classId"), out var classId))
                {
                    cls = await Get(c, a.School, "classes", classId);
                    var teaching = (await Records(c, a.School, "teaching-assignments")).Where(t => Text(t, "classId") == classId.ToString()).Select(t => Text(t, "teacherId")).Append(Text(cls, "teacherId")).Where(t => t != "").Distinct().ToArray();
                    var inClass = (await FamiliesOfClass(c, a.School, classId)).Concat(await UsersForTeachers(c, a.School, teaching)).ToHashSet();
                    var leadership = scopes.Contains("school") ? (await UsersWith(c, a.School, "circulars.view", ["school"])).ToHashSet() : [];
                    audience = audience.Where(user => inClass.Contains(user) || leadership.Contains(user)).ToList();
                }
                await Send(c, a.School, "circular.published", NotificationRules.EventKey("circular.published", id), new() { ["circularTitle"] = Text(d, "title"), ["circularMessage"] = Text(d, "message"),
                    ["className"] = cls is null ? "" : Label("classes", cls), ["schoolName"] = await SchoolName(c, a.School), ["date"] = NotificationTemplates.Day(DateTime.UtcNow.ToString("yyyy-MM-dd")) }, id, audience, a.User, "suite.circulars");
            }
            if (kind == "homework" && HomeworkRules.Status(Text(d, "status")) == "Published" && (old is null || HomeworkRules.Status(Text(old, "status")) != "Published"))
            {
                // Publishing is the moment a class is given the work (a draft tells nobody). It reaches the students
                // allocated to that class and their linked parents, once per assignment however often it is reopened.
                var classId = Id(d, "classId"); var cls = await Get(c, a.School, "classes", classId); var subject = await Get(c, a.School, "subjects", Id(d, "subjectId"));
                var family = (await FamiliesOfClass(c, a.School, classId)).ToHashSet();
                var readers = (await UsersWith(c, a.School, "homework.view", ["parent", "student"])).Where(family.Contains);
                await Send(c, a.School, "homework.assigned", NotificationRules.EventKey("homework.assigned", id), new() { ["homeworkTitle"] = Text(d, "title"), ["subjectName"] = Text(subject, "name"),
                    ["className"] = Label("classes", cls), ["dueDate"] = NotificationTemplates.Day(Text(d, "dueDate")), ["teacherName"] = await AccountName(c, a), ["schoolName"] = await SchoolName(c, a.School) }, id, readers, a.User, "suite.homework");
            }
            if (kind == "submissions" && old is not null && Text(d, "status") == "Reviewed" && Text(d, "reviewedAt") != Text(old, "reviewedAt"))
            {
                // Marks or feedback were given (or changed): the student and their family hear once per review.
                var homework = await Get(c, a.School, "homework", Id(d, "homeworkId")); var student = Id(d, "studentId");
                var family = (await GuardiansOf(c, a.School, [student], "submissions.view", "student")).GetValueOrDefault(student) ?? [];
                var subject = await Get(c, a.School, "subjects", Id(homework, "subjectId"));
                await Send(c, a.School, "homework.reviewed", NotificationRules.EventKey("homework.reviewed", id, "v" + ((int)Number(old, "version") + 1)), new() { ["homeworkTitle"] = Text(homework, "title"), ["subjectName"] = Text(subject, "name"),
                    ["remark"] = Text(d, "feedback"), ["amount"] = Text(d, "grade") == "" ? "" : Text(d, "grade") + (Text(homework, "maxMarks") == "" ? "" : " of " + Text(homework, "maxMarks")), ["teacherName"] = await AccountName(c, a), ["schoolName"] = await SchoolName(c, a.School) }, Id(d, "homeworkId"), family, a.User, "suite.submissions");
            }
            if (kind == "exams" && ExamRules.FamilyVisible(Text(d, "status")))
            {
                // Putting an exam on the timetable tells the class and their families once; a later change of date,
                // time or room is announced as a change, once per new sitting. Drafts tell nobody.
                var wasVisible = old is not null && ExamRules.FamilyVisible(Text(old, "status"));
                var moved = wasVisible && (Text(old!, "date") != Text(d, "date") || Text(old, "startsAt") != Text(d, "startsAt") || Text(old, "endsAt") != Text(d, "endsAt") || Text(old, "room") != Text(d, "room"));
                if (!wasVisible || moved)
                {
                    var classId = Id(d, "classId"); var cls = await Get(c, a.School, "classes", classId); var subject = await Get(c, a.School, "subjects", Id(d, "subjectId"));
                    var family = (await FamiliesOfClass(c, a.School, classId)).ToHashSet(); var readers = (await UsersWith(c, a.School, "exams.view", ["parent", "student"])).Where(family.Contains).ToList();
                    var when = Text(d, "startsAt") == "" ? "" : Text(d, "startsAt") + (Text(d, "endsAt") == "" ? "" : "-" + Text(d, "endsAt"));
                    var values = new Dictionary<string, string?> { ["examName"] = Text(d, "name"), ["subjectName"] = Text(subject, "name"), ["className"] = Label("classes", cls), ["date"] = NotificationTemplates.Day(Text(d, "date")), ["time"] = when, ["room"] = Text(d, "room"), ["schoolName"] = await SchoolName(c, a.School) };
                    if (!wasVisible) await Send(c, a.School, "exam.scheduled", NotificationRules.EventKey("exam.scheduled", id), values, id, readers, a.User, "suite.exams");
                    else await Send(c, a.School, "exam.rescheduled", NotificationRules.EventKey("exam.rescheduled", id, Text(d, "date") + "T" + Text(d, "startsAt") + "-" + Text(d, "endsAt") + "@" + Text(d, "room")), values, id, readers, a.User, "suite.exams");
                }
            }
            if (kind == "exams" && ExamRules.ResultsVisible(Text(d, "status")) && (old is null || !ExamRules.ResultsVisible(Text(old, "status"))))
            {
                // Marks can only be entered while an exam is a draft, so publishing an exam that has marks is the
                // moment those results are final and families can read them. An exam published without marks only
                // announces the exam and notifies nobody here. It is announced once per exam: unpublishing to correct
                // a mark and publishing again does not repeat it.
                var marked = (await Records(c, a.School, "marks")).Where(mark => Text(mark, "examId") == id.ToString()).Select(mark => Guid.TryParse(Text(mark, "studentId"), out var student) ? student : Guid.Empty).Where(student => student != Guid.Empty).Distinct().ToArray();
                if (marked.Length == 0) return;
                var families = (await GuardiansOf(c, a.School, marked, "marks.view", "student")).Values.SelectMany(users => users);
                var cls = await Get(c, a.School, "classes", Id(d, "classId")); var subject = await Get(c, a.School, "subjects", Id(d, "subjectId"));
                await Send(c, a.School, "result.published", NotificationRules.EventKey("result.published", id), new() { ["examName"] = Text(d, "name"), ["subjectName"] = Text(subject, "name"),
                    ["className"] = Label("classes", cls), ["schoolName"] = await SchoolName(c, a.School) }, id, families, a.User, "suite.exams");
            }
            if (kind == "leave-requests")
            {
                // A decision is its own notification: approved and rejected have separate wording. The record version
                // is part of the event, so a later, different decision is announced and the same one never twice.
                var decided = old is not null && Text(old, "status") != Text(d, "status") ? Text(d, "status") : "";
                var key = old is null ? "leave.requested" : decided == "Approved" ? "leave.approved" : decided == "Rejected" ? "leave.rejected" : null;
                if (key is null) return;
                var teacher = (await Q(c, "SELECT first_name || ' ' || last_name AS name FROM teacher_db.teachers WHERE school_id=@s AND id::text=@t AND deleted_at IS NULL", ("s", a.School), ("t", Text(d, "teacherId")))).Select(row => Text(row, "name")).FirstOrDefault();
                var values = new Dictionary<string, string?>
                {
                    ["teacherName"] = string.IsNullOrWhiteSpace(teacher) ? "a staff member" : teacher, ["startDate"] = NotificationTemplates.Day(Text(d, "fromDate")), ["endDate"] = NotificationTemplates.Day(Text(d, "toDate")),
                    ["dateRange"] = NotificationTemplates.Range(Text(d, "fromDate"), Text(d, "toDate")), ["reason"] = Text(d, "reason"), ["remark"] = Text(d, "approvalRemark"), ["schoolName"] = await SchoolName(c, a.School),
                };
                var recipients = key == "leave.requested" ? await UsersWith(c, a.School, "leave-requests.manage", ["school"]) : await UsersForTeachers(c, a.School, [Text(d, "teacherId")]);
                var eventKey = NotificationRules.EventKey(key, id, old is null ? null : "v" + ((int)Number(old, "version") + 1));
                await Send(c, a.School, key, eventKey, values, id, recipients, a.User, "suite.leave-requests");
            }
        }
        catch (Exception ex) { Log.Warning(ex, "Notification for {Kind} {Id} was not created", kind, id); }
    }

    /// <summary>Tells guardians that a fee was charged to their child. Called after the charge is committed; one notification per charge.</summary>
    static async Task AnnounceCharge(SchoolAccess a, Guid charge, Guid student, long amount, string currency, DateOnly due)
    {
        try
        {
            if (amount <= 0) return;
            await using var c = await Open();
            if (!(await GuardiansOf(c, a.School, [student], "fees.view")).TryGetValue(student, out var parents)) return;
            var name = (await Q(c, "SELECT first_name || ' ' || last_name AS name FROM student_db.students WHERE school_id=@s AND id=@id", ("s", a.School), ("id", student))).Select(row => Text(row, "name")).FirstOrDefault();
            await Send(c, a.School, "fee.due", NotificationRules.EventKey("fee.due", charge), new() { ["studentName"] = name, ["amount"] = NotificationTemplates.Money(currency, amount),
                ["dueDate"] = NotificationTemplates.Day(due.ToString("yyyy-MM-dd")), ["schoolName"] = await SchoolName(c, a.School) }, charge, parents, a.User, "suite.fees");
        }
        catch (Exception ex) { Log.Warning(ex, "Fee notification for charge {Charge} was not created", charge); }
    }

    static async Task<string> AccountName(NpgsqlConnection c, SchoolAccess a) =>
        (await Q(c, "SELECT first_name || ' ' || last_name AS name FROM auth_db.users WHERE school_id=@s AND id=@u", ("s", a.School), ("u", a.User))).Select(row => Text(row, "name")).FirstOrDefault() ?? "";

    static async Task<decimal> Unread(NpgsqlConnection c, SchoolAccess a) =>
        Number((await Q(c, "SELECT count(*) AS n FROM notify.recipients WHERE school_id=@s AND user_id=@u AND read_at IS NULL", ("s", a.School), ("u", a.User)))[0], "n");

    /// <summary>
    /// The caller of their own inbox, preferences and devices: any school account, when the school has notifications.
    /// No permission is needed to read what was sent to you; managing wording and history needs notifications.manage.
    /// </summary>
    static async Task<SchoolAccess> Inbox(HttpContext http, NpgsqlConnection c)
    {
        var a = HomeCaller(http);
        Require(await FeatureEnabled(c, a.School, "notifications"), "Notifications are not switched on for your school.", 403);
        return a;
    }

    public static void MapNotifications(WebApplication app)
    {
        // Every school role has an inbox. The caller is always the person in the token; no route takes a user or school id.
        var group = app.MapGroup("/api/notifications").RequireAuthorization(EduOSPolicies.Suite);
        group.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (System.Text.Json.JsonException) { return Results.BadRequest(new { message = "Invalid JSON field value." }); }
            catch (SuiteError ex) { return Results.Json(new { message = ex.Message }, statusCode: ex.Status); }
        });
        MapTemplates(group);
        MapHistory(group);
        group.MapGet("", async (HttpContext http, int page = 1, bool unread = false) =>
        {
            Require(page is > 0 and < 100000, "Invalid page.");
            await using var c = await Open(); var a = await Inbox(http, c);
            var rows = await Q(c, """
                SELECT n.id,n.type,n.category,n.title,n.body,n.destination::text AS destination,n.created_at AS "createdAt",r.read_at AS "readAt"
                FROM notify.recipients r JOIN notify.notifications n ON n.id=r.notification_id
                WHERE r.school_id=@s AND r.user_id=@u AND n.school_id=@s AND (NOT @unread OR r.read_at IS NULL)
                ORDER BY n.created_at DESC,n.id LIMIT @limit OFFSET @offset
                """, ("s", a.School), ("u", a.User), ("unread", unread), ("limit", NotificationPage), ("offset", (page - 1) * NotificationPage));
            foreach (var row in rows) row["destination"] = JsonNode.Parse(Text(row, "destination"));
            var total = Number((await Q(c, "SELECT count(*) AS n FROM notify.recipients WHERE school_id=@s AND user_id=@u AND (NOT @unread OR read_at IS NULL)", ("s", a.School), ("u", a.User), ("unread", unread)))[0], "n");
            return Results.Ok(new { data = new { items = rows, unread = await Unread(c, a), totalCount = total, page, pageSize = NotificationPage } });
        });
        group.MapGet("/unread-count", async (HttpContext http) => { await using var c = await Open(); var a = await Inbox(http, c); return Results.Ok(new { data = new { unread = await Unread(c, a) } }); });
        group.MapPost("/{id:guid}/read", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Inbox(http, c);
            // Someone else's notification is indistinguishable from one that does not exist.
            var mine = await Q(c, "SELECT 1 AS one FROM notify.recipients WHERE notification_id=@id AND school_id=@s AND user_id=@u", ("id", id), ("s", a.School), ("u", a.User));
            Require(mine.Count == 1, "Notification not found.", 404);
            await E(c, "UPDATE notify.recipients SET read_at=now() WHERE notification_id=@id AND school_id=@s AND user_id=@u AND read_at IS NULL", ("id", id), ("s", a.School), ("u", a.User));
            return Results.Ok(new { data = new { unread = await Unread(c, a) } });
        });
        group.MapPost("/read-all", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Inbox(http, c);
            await E(c, "UPDATE notify.recipients SET read_at=now() WHERE school_id=@s AND user_id=@u AND read_at IS NULL", ("s", a.School), ("u", a.User));
            return Results.Ok(new { data = new { unread = 0 } });
        });
        group.MapGet("/preferences", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Inbox(http, c);
            var disabled = await Q(c, "SELECT category,channel FROM notify.preferences WHERE school_id=@s AND user_id=@u AND NOT enabled", ("s", a.School), ("u", a.User));
            return Results.Ok(new { data = new { categories = NotificationRules.Categories, channels = NotificationRules.Channels.Select(channel => new { key = channel, available = NotificationRules.Available.Contains(channel) }), disabled } });
        });
        group.MapPut("/preferences", async (JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Inbox(http, c);
            var category = Text(input, "category"); var channel = Text(input, "channel");
            Require(NotificationRules.Categories.Contains(category) && NotificationRules.Channels.Contains(channel), "Unknown notification category or channel.");
            Require(input["enabled"] is JsonValue flag && flag.TryGetValue<bool>(out _), "Enabled must be true or false.");
            Require(NotificationRules.Available.Contains(channel), "This channel is not available yet.", 409);
            await E(c, "INSERT INTO notify.preferences(school_id,user_id,category,channel,enabled) VALUES(@s,@u,@c,@ch,@e) ON CONFLICT(school_id,user_id,category,channel) DO UPDATE SET enabled=excluded.enabled,updated_at=now()",
                ("s", a.School), ("u", a.User), ("c", category), ("ch", channel), ("e", input["enabled"]!.GetValue<bool>()));
            return Results.Ok(new { message = "Preference saved." });
        });

        // Devices that may receive push for the caller. The account and school are always those of the token: a device
        // can only ever be registered for, listed by or removed by the person signed in on it. The push token is
        // write-only; it is never returned. Nothing is sent to a device yet (push is not a delivering channel).
        group.MapGet("/devices", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Inbox(http, c);
            var rows = await Q(c, "SELECT id,installation_id AS \"installationId\",platform,app_version AS \"appVersion\",enabled,last_seen_at AS \"lastSeenAt\" FROM notify.devices WHERE school_id=@s AND user_id=@u AND revoked_at IS NULL ORDER BY last_seen_at DESC", ("s", a.School), ("u", a.User));
            return Results.Ok(new { data = new { items = rows, pushAvailable = NotificationRules.Available.Contains("push") } });
        });
        group.MapPut("/devices", async (JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Inbox(http, c);
            var installation = Text(input, "installationId"); var platform = Text(input, "platform"); var token = Text(input, "pushToken"); var version = Text(input, "appVersion");
            var problems = DeviceRules.Problems(installation, platform, token, version); Require(problems.Count == 0, string.Join(" ", problems));
            await using var tx = await c.BeginTransactionAsync();
            // A phone belongs to whoever is signed in on it now. Its earlier registrations, for any account, stop
            // receiving; this is the one statement that reaches beyond the caller, and it can only switch delivery off.
            await E(c, "UPDATE notify.devices SET revoked_at=now(),enabled=false WHERE revoked_at IS NULL AND (installation_id=@i OR push_token=@t) AND NOT (school_id=@s AND user_id=@u AND installation_id=@i)", ("i", installation), ("t", token), ("s", a.School), ("u", a.User));
            var others = Number((await Q(c, "SELECT count(*) AS n FROM notify.devices WHERE school_id=@s AND user_id=@u AND revoked_at IS NULL AND installation_id<>@i", ("s", a.School), ("u", a.User), ("i", installation)))[0], "n");
            Require(others < DeviceRules.PerAccount, "Too many devices are registered. Remove one first.", 409);
            var saved = await Q(c, """
                INSERT INTO notify.devices(id,school_id,user_id,installation_id,platform,push_token,app_version) VALUES(@id,@s,@u,@i,@p,@t,@v)
                ON CONFLICT(school_id,user_id,installation_id) DO UPDATE SET platform=excluded.platform,push_token=excluded.push_token,app_version=excluded.app_version,enabled=true,revoked_at=NULL,last_seen_at=now()
                RETURNING id
                """, ("id", Guid.NewGuid()), ("s", a.School), ("u", a.User), ("i", installation), ("p", platform), ("t", token), ("v", version));
            await tx.CommitAsync();
            return Results.Ok(new { data = new { id = Text(saved[0], "id"), pushAvailable = NotificationRules.Available.Contains("push") } });
        });
        // Removing the current device (at sign-out) or another of the caller's devices. Removing one that is not there is not an error.
        group.MapDelete("/devices/{installationId}", async (string installationId, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Inbox(http, c);
            await E(c, "UPDATE notify.devices SET revoked_at=now(),enabled=false WHERE school_id=@s AND user_id=@u AND installation_id=@i AND revoked_at IS NULL", ("s", a.School), ("u", a.User), ("i", installationId));
            return Results.Ok(new { message = "Device removed." });
        });
    }
}

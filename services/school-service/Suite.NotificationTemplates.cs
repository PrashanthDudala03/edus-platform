using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Npgsql;

/// <summary>The wording of a notification on one channel.</summary>
public sealed record TemplateText(string Title, string Body);
/// <summary>A school's own wording. Disabled means the school keeps its text but EduOS sends the default.</summary>
public sealed record TemplateOverride(string Title, string Body, bool Enabled, int Version = 1);
/// <summary>The final text of a notification and which wording produced it (the school's own, with its version, or the EduOS default).</summary>
public sealed record Composed(TemplateText Text, bool School, int? Version);
/// <summary>A value a template may show: what it means and a made-up sample used only for previews.</summary>
public sealed record TemplateVariable(string Name, string Description, string Sample);
/// <summary>
/// One kind of notification EduOS can send. The key is also the notification type. Defaults are the EduOS wording
/// per channel; a channel without a default cannot be sent or customised yet.
/// </summary>
public sealed record NotificationTemplate(string Key, string Event, string Name, string Description, string Route, string Status, string[] Variables, IReadOnlyDictionary<string, TemplateText> Defaults);

/// <summary>
/// Notification wording: EduOS defaults, the values a template may show, and the rules for a school's own wording.
/// Templates are plain text with {{name}} placeholders. Nothing is evaluated: a placeholder is replaced by a value
/// EduOS resolved on the server, and only names on the template's allow-list are ever replaced. Pure, so every rule
/// is tested without a database.
/// </summary>
public static class NotificationTemplates
{
    /// <summary>The permission that lets a school-scope role change its school's wording.</summary>
    public const string Permission = "notifications.manage";
    public const string Implemented = "IMPLEMENTED", Ready = "READY FOR PRODUCER", Blocked = "BLOCKED BY DOMAIN EVENT";

    /// <summary>Every value a template can show. A template lists the subset that exists for its event.</summary>
    public static readonly TemplateVariable[] Variables =
    [
        new("studentName", "The student's name", "Asha Verma"), new("teacherName", "The staff member's name", "Ravi Kumar"),
        new("schoolName", "Your school's name", "Your school"), new("className", "Class and section", "Grade 6 A"),
        new("date", "The day it happened", "5 Oct 2026"), new("startDate", "First day", "5 Oct 2026"), new("endDate", "Last day", "7 Oct 2026"),
        new("dateRange", "One day, or first to last day", "5 Oct 2026 to 7 Oct 2026"), new("reason", "The reason given", "Family function"),
        new("remark", "The remark added with the decision", "Please hand over your classes"), new("amount", "The amount with currency", "₹ 12,500"),
        new("dueDate", "The date it is due", "15 Oct 2026"), new("subjectName", "The subject", "Mathematics"),
        new("homeworkTitle", "The homework's title", "Fractions worksheet"), new("examName", "The exam or term", "Half-yearly examination"),
        new("status", "The attendance status", "Present"), new("circularTitle", "The circular's title", "Parent-teacher meeting"), new("circularMessage", "The circular's text", "The parent-teacher meeting is on Saturday at 9 am."),
        new("time", "The start and end time, when set", "09:00-11:00"), new("room", "The room or location, when set", "Hall B"), new("reference", "A receipt or reference number", "RCPT-2026-000012"),
    ];

    static IReadOnlyDictionary<string, TemplateText> InApp(string title, string body) => new Dictionary<string, TemplateText> { ["in-app"] = new(title, body) };
    public static readonly NotificationTemplate[] All =
    [
        new("circular.published", "A circular is published", "Circular published", "Sent to the circular's audience when a circular is created.", "notices", Implemented,
            ["circularTitle", "circularMessage", "className", "schoolName", "date"], InApp("{{circularTitle}}", "{{circularMessage}}")),
        new("leave.requested", "A staff member requests leave", "Leave requested", "Sent to the people who approve leave when a staff member asks for it.", "leave", Implemented,
            ["teacherName", "dateRange", "startDate", "endDate", "reason", "schoolName"], InApp("Leave request from {{teacherName}}", "{{dateRange}}. {{reason}}")),
        new("leave.approved", "A leave request is approved", "Leave approved", "Sent to the staff member whose leave was approved.", "leave", Implemented,
            ["teacherName", "dateRange", "startDate", "endDate", "remark", "schoolName"], InApp("Your leave was approved", "{{dateRange}}. {{remark}}")),
        new("leave.rejected", "A leave request is rejected", "Leave rejected", "Sent to the staff member whose leave was rejected.", "leave", Implemented,
            ["teacherName", "dateRange", "startDate", "endDate", "remark", "schoolName"], InApp("Your leave was rejected", "{{dateRange}}. {{remark}}")),
        new("attendance.absent", "A student is marked absent", "Student absent", "For a student's family when the student is marked absent.", "attendance", Implemented,
            ["studentName", "className", "date", "schoolName"], InApp("{{studentName}} was marked absent", "{{studentName}} was marked absent on {{date}}. Please contact the school if this needs correction.")),
        new("attendance.late", "A student is marked late", "Student late", "For a student's family when the student is marked late.", "attendance", Implemented,
            ["studentName", "className", "date", "schoolName"], InApp("{{studentName}} arrived late", "{{studentName}} was marked late on {{date}}.")),
        new("attendance.corrected", "An attendance status is corrected", "Attendance corrected", "For a student's family when a submitted register is corrected for the student.", "attendance", Implemented,
            ["studentName", "className", "date", "status", "reason", "schoolName"], InApp("Attendance updated for {{studentName}}", "The record for {{date}} is now {{status}}. {{reason}}")),
        new("homework.assigned", "Homework is set for a class", "Homework assigned", "For the students of a class and their families when homework is set.", "homework", Implemented,
            ["homeworkTitle", "subjectName", "className", "dueDate", "teacherName", "schoolName"], InApp("New homework: {{homeworkTitle}}", "{{subjectName}}, due {{dueDate}}.")),
        new("homework.reviewed", "Handed-in work is reviewed", "Homework reviewed", "For a student and their family when a teacher gives marks or feedback.", "homework", Implemented,
            ["homeworkTitle", "subjectName", "amount", "remark", "teacherName", "schoolName"], InApp("{{homeworkTitle}} was reviewed", "{{subjectName}}: {{amount}} {{remark}}")),
        new("homework.due", "Homework is due soon", "Homework due", "A reminder before homework is due.", "homework", Blocked,
            ["homeworkTitle", "subjectName", "className", "dueDate", "schoolName"], InApp("Homework due soon: {{homeworkTitle}}", "{{subjectName}} is due on {{dueDate}}.")),
        new("result.published", "An exam that has marks is published", "Results published", "For the students who have marks in an exam, and their families, when the exam is published.", "results", Implemented,
            ["examName", "subjectName", "className", "schoolName"], InApp("Results published: {{examName}}", "{{subjectName}} results for {{className}} are available.")),
        new("exam.scheduled", "An exam is put on the timetable", "Exam scheduled", "For the students of a class and their families when an exam is scheduled.", "timetable", Implemented,
            ["examName", "subjectName", "className", "date", "time", "room", "schoolName"], InApp("Exam scheduled: {{examName}}", "{{subjectName}} for {{className}} on {{date}} {{time}} {{room}}")),
        new("exam.rescheduled", "An exam's date, time or room changes", "Exam timetable changed", "For the students of a class and their families when a scheduled exam moves.", "timetable", Implemented,
            ["examName", "subjectName", "className", "date", "time", "room", "schoolName"], InApp("Exam timetable changed: {{examName}}", "{{subjectName}} for {{className}} is now on {{date}} {{time}} {{room}}")),
        new("substitution.assigned", "A teacher is asked to cover a period", "Substitution assigned", "For the teacher who covers a colleague's period on a date.", "timetable", Implemented,
            ["teacherName", "className", "subjectName", "date", "time", "room", "schoolName"], InApp("Please cover {{className}} on {{date}}", "{{subjectName}} for {{teacherName}}, {{time}} {{room}}")),
        new("substitution.changed", "A substitution is given to someone else", "Substitution changed", "For a teacher who no longer covers a period they were asked to cover.", "timetable", Implemented,
            ["teacherName", "className", "subjectName", "date", "time", "room", "schoolName"], InApp("You no longer cover {{className}} on {{date}}", "{{subjectName}} for {{teacherName}}, {{time}}, was given to someone else.")),
        new("admission.submitted", "An application is submitted", "Application submitted", "For the people who approve admissions when an application is submitted.", "home", Implemented,
            ["studentName", "className", "reference", "date", "schoolName"], InApp("New application: {{studentName}}", "{{reference}} for {{className}} is waiting for review.")),
        new("admission.approved", "An application is approved", "Application approved", "For the office staff who onboard students when an application is approved.", "home", Implemented,
            ["studentName", "className", "reference", "date", "schoolName"], InApp("Approved: {{studentName}}", "{{reference}} for {{className}} is ready to start onboarding.")),
        new("onboarding.ready", "Onboarding is complete", "Ready to activate", "For the office staff who onboard students when everything needed for activation is in place.", "home", Implemented,
            ["studentName", "className", "reference", "date", "schoolName"], InApp("Ready to activate: {{studentName}}", "{{reference}} for {{className}} has everything it needs.")),
        new("student.activated", "A student is activated", "Student activated", "For the family's linked accounts when the student becomes an active student.", "home", Implemented,
            ["studentName", "className", "date", "schoolName"], InApp("Welcome to {{schoolName}}", "{{studentName}} is now enrolled in {{className}}.")),
        new("fee.due", "A fee is charged", "Fee due", "For a student's family when a fee is charged.", "fees", Implemented,
            ["studentName", "amount", "dueDate", "schoolName"], InApp("Fee due: {{amount}}", "{{amount}} for {{studentName}} is due on {{dueDate}}.")),
        new("fee.payment_received", "A fee payment is received", "Payment received", "For a student's family when a payment is recorded or verified; the receipt number is in it.", "fees", Implemented,
            ["studentName", "amount", "remark", "reference", "schoolName"], InApp("Payment received: {{amount}}", "{{amount}} received for {{studentName}} ({{remark}}). Receipt {{reference}}.")),
        new("fee.due_soon", "A fee instalment is due soon", "Fee due soon", "A reminder before an instalment falls due.", "fees", Blocked,
            ["studentName", "amount", "dueDate", "schoolName"], InApp("Fee due soon: {{amount}}", "{{amount}} for {{studentName}} is due on {{dueDate}}.")),
        new("fee.overdue", "A fee is past its due date", "Fee overdue", "For a student's family when a fee is not paid by its due date.", "fees", Blocked,
            ["studentName", "amount", "dueDate", "schoolName"], InApp("Fee overdue: {{amount}}", "{{amount}} for {{studentName}} was due on {{dueDate}}.")),
    ];
    public static NotificationTemplate? Find(string? key) => All.FirstOrDefault(template => template.Key == key);

    static readonly Regex Placeholder = new(@"\{\{\s*([A-Za-z][A-Za-z0-9]{0,39})\s*\}\}", RegexOptions.Compiled);
    static readonly Regex Markup = new(@"<[A-Za-z/!?]", RegexOptions.Compiled);

    public static List<string> Problems(NotificationTemplate template, string? title, string? body) => Problems(template, "in-app", title, body);
    /// <summary>Why a school's wording cannot be saved; empty when it can. Unknown placeholders are refused, not ignored.</summary>
    public static List<string> Problems(NotificationTemplate template, string channel, string? title, string? body)
    {
        var problems = new List<string>(); title ??= ""; body ??= "";
        if (!NotificationRules.Limits.TryGetValue(channel, out var limit)) return ["Unknown notification channel."];
        if (title.Trim().Length == 0) problems.Add("Enter a title.");
        if (title.Contains('\n') || title.Contains('\r')) problems.Add("Keep the title on one line.");
        if (title.Length > limit.Title) problems.Add($"Keep the title within {limit.Title} characters.");
        if (body.Length > limit.Body) problems.Add($"Keep the message within {limit.Body} characters.");
        foreach (var text in new[] { title, body })
        {
            foreach (var name in Placeholder.Matches(text).Select(match => match.Groups[1].Value).Where(name => !template.Variables.Contains(name)))
                problems.Add("{{" + name + "}} is not available for this notification.");
            var rest = Placeholder.Replace(text, "");
            if (rest.Contains("{{") || rest.Contains("}}") || text.Contains("{{{") || text.Contains("}}}")) problems.Add("Write placeholders exactly like {{" + template.Variables[0] + "}}.");
            if (Markup.IsMatch(text)) problems.Add("Use plain text only; formatting tags are not supported.");
        }
        return problems.Distinct().ToList();
    }

    /// <summary>
    /// Fills a template. Only the template's own variables are replaced, once, with the given value (nothing when the
    /// event has none); a value is never read as a template again. Any other placeholder stays as written.
    /// </summary>
    public static string Render(NotificationTemplate template, string? text, IReadOnlyDictionary<string, string?> values) =>
        Placeholder.Replace(text ?? "", match => template.Variables.Contains(match.Groups[1].Value) ? values.GetValueOrDefault(match.Groups[1].Value) ?? "" : match.Value);

    /// <summary>The wording in force: the school's own when it exists, is enabled and is still valid; otherwise the EduOS default.</summary>
    public static TemplateText? Effective(NotificationTemplate template, string channel, TemplateOverride? own) =>
        !template.Defaults.TryGetValue(channel, out var standard) ? null
        : own is { Enabled: true } && Problems(template, channel, own.Title, own.Body).Count == 0 ? new(own.Title, own.Body) : standard;

    /// <summary>
    /// The final text of a notification: one-line title, message with its line breaks, both within the channel's
    /// limits. A school wording that comes out without a title falls back to the EduOS default.
    /// </summary>
    public static Composed? Compose(NotificationTemplate template, string channel, TemplateOverride? own, IReadOnlyDictionary<string, string?> values)
    {
        if (Effective(template, channel, own) is not { } wording) return null;
        var limit = NotificationRules.Limits[channel]; var standard = template.Defaults[channel];
        TemplateText Fill(TemplateText text) => new(NotificationRules.Clip(Render(template, text.Title, values), limit.Title), NotificationRules.ClipLines(Render(template, text.Body, values), limit.Body));
        var filled = Fill(wording);
        return wording != standard && filled.Title.Length > 0 ? new(filled, true, own!.Version) : new(Fill(standard), false, null);
    }
    /// <summary>An amount as a notification shows it: currency code and grouped digits, with decimals only when there are any.</summary>
    public static string Money(string? currency, long cents) =>
        ((currency ?? "").Trim() + " " + (cents / 100m).ToString(cents % 100 == 0 ? "N0" : "N2", CultureInfo.InvariantCulture)).Trim();

    /// <summary>Made-up values for a preview. Nothing here comes from a real person or record.</summary>
    public static Dictionary<string, string?> Samples(string? schoolName = null)
    {
        var samples = Variables.ToDictionary(variable => variable.Name, variable => (string?)variable.Sample);
        if (!string.IsNullOrWhiteSpace(schoolName)) samples["schoolName"] = schoolName;
        return samples;
    }

    /// <summary>Only a school-scope role holding the permission may change wording; families, students and teachers never can.</summary>
    public static bool MayManage(string? dataScope, IEnumerable<string> permissions) => dataScope == "school" && permissions.Contains(Permission);

    /// <summary>A stored day (2026-10-05) as people read it (5 Oct 2026). Anything else is shown as it is.</summary>
    public static string Day(string? day) => DateOnly.TryParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var value) ? value.ToString("d MMM yyyy", CultureInfo.InvariantCulture) : day?.Trim() ?? "";
    public static string Range(string? from, string? to) => string.IsNullOrWhiteSpace(to) || from == to ? Day(from) : Day(from) + " to " + Day(to);
}

public static partial class Suite
{
    const string TemplateColumns = "template_key AS key,channel,title,body,enabled,version,updated_at AS \"updatedAt\"";
    static TemplateOverride Own(JsonObject row) => new(Text(row, "title"), Text(row, "body"), Flag(row["enabled"]), (int)Number(row, "version"));

    /// <summary>Creates a notification from a template: the school's wording when it has one, otherwise the EduOS default.</summary>
    static async Task<int> Send(NpgsqlConnection c, Guid school, string key, string eventKey, Dictionary<string, string?> values, Guid? entity, IEnumerable<Guid> candidates, Guid? actor, string source)
    {
        var template = NotificationTemplates.Find(key); Require(template is not null, "Unknown notification template.");
        var own = (await Q(c, "SELECT title,body,enabled,version FROM notify.template_overrides WHERE school_id=@s AND template_key=@k AND channel='in-app'", ("s", school), ("k", key))).FirstOrDefault();
        var text = NotificationTemplates.Compose(template!, "in-app", own is null ? null : Own(own), values)!;
        return await Notify(c, school, key, eventKey, text, template!.Route, entity, candidates, actor, source);
    }

    static async Task<string> SchoolName(NpgsqlConnection c, Guid school) => (await Q(c, "SELECT name FROM school_db.schools WHERE id=@s", ("s", school))).Select(row => Text(row, "name")).FirstOrDefault() ?? "";

    static SchoolAccess TemplateManager(HttpContext http)
    {
        var a = HomeCaller(http);
        Require(NotificationTemplates.MayManage(http.User.FindFirst("data_scope")?.Value, a.Permissions), "Your role cannot manage notification wording.", 403);
        return a;
    }
    static NotificationTemplate Template(string key) { var template = NotificationTemplates.Find(key); Require(template is not null, "Notification template not found.", 404); return template!; }
    /// <summary>A channel a school may write for today. The others are reserved and refused, so nothing looks switched on.</summary>
    static string TemplateChannel(NotificationTemplate template, string channel)
    {
        Require(NotificationRules.Channels.Contains(channel), "Unknown notification channel.");
        Require(NotificationRules.Available.Contains(channel) && template.Defaults.ContainsKey(channel), "This channel is not available yet.", 409);
        return channel;
    }
    static void RequireWording(NotificationTemplate template, string channel, string title, string body)
    {
        var problems = NotificationTemplates.Problems(template, channel, title, body);
        Require(problems.Count == 0, string.Join(" ", problems));
    }
    static JsonObject TemplateView(NotificationTemplate template, IEnumerable<JsonObject> overrides)
    {
        var own = overrides.Where(row => Text(row, "key") == template.Key).ToDictionary(row => Text(row, "channel"));
        var channels = new JsonArray();
        foreach (var channel in NotificationRules.Channels)
        {
            template.Defaults.TryGetValue(channel, out var standard); own.TryGetValue(channel, out var mine);
            var entry = new JsonObject { ["channel"] = channel, ["available"] = NotificationRules.Available.Contains(channel) && standard is not null,
                ["titleMax"] = NotificationRules.Limits[channel].Title, ["bodyMax"] = NotificationRules.Limits[channel].Body };
            entry["default"] = standard is null ? null : new JsonObject { ["title"] = standard.Title, ["body"] = standard.Body };
            entry["override"] = mine is null ? null : new JsonObject { ["title"] = Text(mine, "title"), ["body"] = Text(mine, "body"), ["enabled"] = Flag(mine["enabled"]), ["version"] = mine["version"]?.DeepClone(), ["updatedAt"] = mine["updatedAt"]?.DeepClone() };
            entry["source"] = mine is not null && NotificationTemplates.Effective(template, channel, Own(mine)) != standard ? "school" : "default";
            channels.Add(entry);
        }
        var variables = new JsonArray();
        foreach (var variable in NotificationTemplates.Variables.Where(variable => template.Variables.Contains(variable.Name)))
            variables.Add(new JsonObject { ["name"] = variable.Name, ["description"] = variable.Description, ["sample"] = variable.Sample });
        return new JsonObject
        {
            ["key"] = template.Key, ["event"] = template.Event, ["name"] = template.Name, ["description"] = template.Description, ["category"] = NotificationRules.Category(template.Key),
            ["status"] = template.Status, ["sending"] = template.Status == NotificationTemplates.Implemented, ["variables"] = variables, ["channels"] = channels,
        };
    }
    static Task<List<JsonObject>> TemplateOverrides(NpgsqlConnection c, Guid school, string? key = null) =>
        Q(c, $"SELECT {TemplateColumns} FROM notify.template_overrides WHERE school_id=@s AND (@k::text IS NULL OR template_key=@k)", ("s", school), ("k", key));

    // A school's own notification wording. Every statement names the school of the verified token; EduOS defaults are
    // code and cannot be changed from here. Only a school-scope role holding notifications.manage reaches these.
    static void MapTemplates(RouteGroupBuilder group)
    {
        group.MapGet("/templates", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = TemplateManager(http); var overrides = await TemplateOverrides(c, a.School);
            return Results.Ok(new { data = NotificationTemplates.All.Select(template => TemplateView(template, overrides)) });
        });
        group.MapGet("/templates/{key}", async (string key, HttpContext http) =>
        {
            await using var c = await Open(); var a = TemplateManager(http); var template = Template(key);
            return Results.Ok(new { data = TemplateView(template, await TemplateOverrides(c, a.School, key)) });
        });
        // Shows wording with made-up values. Nothing is stored or sent, and no real person's data is used.
        group.MapPost("/templates/{key}/preview", async (string key, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = TemplateManager(http); var template = Template(key);
            var channel = TemplateChannel(template, Text(input, "channel")); var title = input["title"]?.ToString() ?? ""; var body = input["body"]?.ToString() ?? "";
            RequireWording(template, channel, title, body);
            var text = NotificationTemplates.Compose(template, channel, new(title, body, true), NotificationTemplates.Samples(await SchoolName(c, a.School)))!.Text;
            return Results.Ok(new { data = new { title = text.Title, body = text.Body } });
        });
        group.MapPut("/templates/{key}", async (string key, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = TemplateManager(http); var template = Template(key);
            var channel = TemplateChannel(template, Text(input, "channel")); var title = Text(input, "title"); var body = Text(input, "body");
            RequireWording(template, channel, title, body);
            // When the editor says which version it changed, a save over someone else's newer wording is refused.
            var known = input["version"] is JsonValue value && value.TryGetValue<int>(out var version) ? version : (int?)null;
            var saved = await Q(c, $"""
                INSERT INTO notify.template_overrides AS o(school_id,template_key,channel,title,body,enabled,updated_by) VALUES(@s,@k,@ch,@title,@body,true,@u)
                ON CONFLICT(school_id,template_key,channel) DO UPDATE SET title=excluded.title,body=excluded.body,enabled=true,version=o.version+1,updated_by=excluded.updated_by,updated_at=now()
                WHERE @v::int IS NULL OR o.version=@v RETURNING {TemplateColumns}
                """, ("s", a.School), ("k", key), ("ch", channel), ("title", title), ("body", body), ("u", a.User), ("v", known));
            Require(saved.Count == 1, "This wording was changed by someone else. Reload and try again.", 409);
            return Results.Ok(new { data = TemplateView(template, saved), message = "Your school's wording is saved." });
        });
        group.MapPut("/templates/{key}/enabled", async (string key, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = TemplateManager(http); var template = Template(key); var channel = TemplateChannel(template, Text(input, "channel"));
            Require(input["enabled"] is JsonValue flag && flag.TryGetValue<bool>(out _), "Enabled must be true or false.");
            var saved = await Q(c, $"UPDATE notify.template_overrides SET enabled=@e,version=version+1,updated_by=@u,updated_at=now() WHERE school_id=@s AND template_key=@k AND channel=@ch RETURNING {TemplateColumns}",
                ("e", input["enabled"]!.GetValue<bool>()), ("u", a.User), ("s", a.School), ("k", key), ("ch", channel));
            Require(saved.Count == 1, "Your school has no wording of its own for this notification.", 404);
            return Results.Ok(new { data = TemplateView(template, saved), message = Flag(saved[0]["enabled"]) ? "Your school's wording is in use." : "The EduOS default is in use." });
        });
        group.MapDelete("/templates/{key}", async (string key, string channel, HttpContext http) =>
        {
            await using var c = await Open(); var a = TemplateManager(http); var template = Template(key); TemplateChannel(template, channel);
            await E(c, "DELETE FROM notify.template_overrides WHERE school_id=@s AND template_key=@k AND channel=@ch", ("s", a.School), ("k", key), ("ch", channel));
            return Results.Ok(new { data = TemplateView(template, []), message = "Reset to the EduOS default." });
        });
    }
}

using System.Text.RegularExpressions;
using Xunit;

// A guard on the notification SQL itself. These statements have not yet run against a database here, so this reads
// the source and fails when a statement on a per-school table does not name the school (and, for a person's inbox,
// preferences or devices, the person), or when the one-notification-per-event rule loses its database backing.
// It does not replace database tests; it stops these bindings being dropped by accident.
public class NotificationTenancyTests
{
    static readonly string Folder = Path.Combine(AppContext.BaseDirectory, "Sources");
    static readonly string[] Sources = [.. Directory.GetFiles(Folder, "Suite.Notification*.cs"), Path.Combine(Folder, "Suite.Attendance.cs"), Path.Combine(Folder, "Suite.Homework.cs"), Path.Combine(Folder, "Suite.Exams.cs")];
    static readonly string Engine = File.ReadAllText(Path.Combine(Folder, "Suite.Notifications.cs")), Schema = File.ReadAllText(Path.Combine(Folder, "NotificationSchema.sql"));
    static readonly string[] PerSchool = ["notifications", "recipients", "deliveries", "preferences", "template_overrides", "devices"];

    /// <summary>Each use of a notify table with the rest of its SQL string (SQL strings here hold no quote after the table name).</summary>
    static IEnumerable<(string Verb, string Table, string Sql)> Statements(params string[] texts) =>
        from text in texts.Length > 0 ? texts : Sources.Select(File.ReadAllText).ToArray()
        from Match use in Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+notify\.(\w+)")
        let end = text.IndexOf('"', use.Index)
        select (use.Groups[1].Value, use.Groups[2].Value, text[use.Index..(end < 0 ? text.Length : end)]);

    [Fact]
    public void TheSourcesAreRead()
    {
        Assert.Equal(6, Sources.Length);
        Assert.True(Statements().Count() >= 25);
        Assert.All(PerSchool, table => Assert.Contains(Statements(), statement => statement.Table == table));
        Assert.All(PerSchool, table => Assert.Contains($"CREATE TABLE IF NOT EXISTS notify.{table}(", Schema));
    }

    [Fact]
    public void EveryStatementOnAPerSchoolTableNamesTheSchool()
    {
        foreach (var (verb, table, sql) in Statements().Where(statement => PerSchool.Contains(statement.Table)))
            Assert.True(verb == "INTO" ? sql.Contains("@s") : sql.Contains("school_id=@s"), $"{verb} notify.{table} is not bound to the school: {sql}");
        Assert.All(PerSchool, table => Assert.Matches(@"notify\." + table + @"\([^;]*school_id uuid NOT NULL", Schema));
    }

    [Fact]
    public void InboxPreferenceAndDeviceStatementsNameThePerson()
    {
        // History (a separate file) is the one place that reads other people's rows, for a manager of the same school.
        foreach (var (verb, table, sql) in Statements(Engine).Where(statement => statement.Table is "recipients" or "preferences" or "devices" && statement.Verb != "INTO"))
            Assert.True(sql.Contains("user_id=@u") || sql.Contains("user_id=ANY(@ids)") || sql.Contains("user_id=ANY(@users)"), $"{verb} notify.{table} is not bound to a person: {sql}");
    }

    [Fact]
    public void OneEventCanOnlyEverBeStoredOnce()
    {
        // Idempotency does not depend on what a client or a producer does: the database refuses a second row for the
        // same school and event, and the single writer treats that refusal as "already announced".
        Assert.Contains("CREATE UNIQUE INDEX IF NOT EXISTS notifications_event ON notify.notifications(school_id,event_key);", Schema);
        Assert.Contains("event_key varchar(200) NOT NULL", Schema);
        var writes = Statements().Where(statement => statement is { Verb: "INTO", Table: "notifications" }).ToList();
        Assert.Single(writes);
        Assert.Contains("ON CONFLICT(school_id,event_key) DO NOTHING", writes[0].Sql);
        // One recipient per notification, and one delivery per recipient, channel and target.
        Assert.Contains("PRIMARY KEY(notification_id,user_id));", Schema);
        Assert.Contains("PRIMARY KEY(notification_id,user_id,channel,target));", Schema);
    }

    [Fact]
    public void NothingIsHandedToAnOutsideProviderFromARequest()
    {
        // The request path only writes rows. No HTTP client, push SDK or mail client exists in the notification code.
        foreach (var file in Sources)
            Assert.DoesNotMatch(@"HttpClient|Firebase|SmtpClient|Twilio|SendGrid", File.ReadAllText(file));
        Assert.Contains("status varchar(20) NOT NULL CHECK(status IN('pending','processing','delivered','failed','skipped'))", Schema);
        foreach (var column in new[] { "attempts integer NOT NULL DEFAULT 0", "last_error varchar(300)", "next_attempt_at timestamptz", "delivered_at timestamptz" }) Assert.Contains(column, Schema);
    }

    [Fact]
    public void ADeviceIsNeverReturnedWithItsTokenAndNeverRegisteredForSomeoneElse()
    {
        var devices = Statements(Engine).Where(statement => statement.Table == "devices").ToList();
        // The only statements that read devices never select the token; the only one that writes takes school and user from the token.
        Assert.DoesNotMatch(@"SELECT[^""]*push_token[^""]*FROM notify\.devices", Engine);
        var insert = Assert.Single(devices, statement => statement.Verb == "INTO");
        Assert.Contains("VALUES(@id,@s,@u,@i,@p,@t,@v)", insert.Sql);
        Assert.DoesNotMatch(@"Text\(input, ""(userId|schoolId|user_id|school_id)""\)", Engine);
    }

    [Fact]
    public void NoStatementBuildsSqlFromRequestText()
    {
        // The only interpolation allowed in notification SQL is the fixed column list.
        foreach (var file in Sources)
            Assert.All(Regex.Matches(File.ReadAllText(file), @"\$""[^""]*notify\.|\$""""""[\s\S]*?""""""").Select(match => match.Value),
                sql => Assert.All(Regex.Matches(sql, @"\{[^}]*\}").Select(hole => hole.Value), hole => Assert.Equal("{TemplateColumns}", hole)));
    }
}

using Xunit;

// Notification wording: EduOS defaults, a school's own wording, and the placeholder rules. The database side (a
// school's rows) is one table whose every statement names the school of the verified token; see MapTemplates.
public class NotificationTemplateTests
{
    static readonly NotificationTemplate Approved = NotificationTemplates.Find("leave.approved")!;
    static readonly NotificationTemplate Circular = NotificationTemplates.Find("circular.published")!;
    static readonly Dictionary<string, string?> Leave = new() { ["teacherName"] = "Meera Nair", ["dateRange"] = "5 Oct 2026 to 7 Oct 2026", ["startDate"] = "5 Oct 2026", ["endDate"] = "7 Oct 2026", ["remark"] = "Enjoy the break", ["schoolName"] = "Riverside School" };
    static TemplateText Text(NotificationTemplate template, TemplateOverride? own, IReadOnlyDictionary<string, string?> values, string channel = "in-app") => NotificationTemplates.Compose(template, channel, own, values)!.Text;

    [Fact]
    public void EveryTemplateIsAKnownTypeWithValidDefaultWording()
    {
        Assert.Equal(new[] { "circular.published", "leave.requested", "leave.approved", "leave.rejected", "attendance.absent", "attendance.late", "attendance.corrected", "homework.assigned", "homework.reviewed", "homework.due", "result.published", "exam.scheduled", "exam.rescheduled", "substitution.assigned", "substitution.changed", "fee.due", "fee.payment_received", "fee.due_soon", "fee.overdue" }, NotificationTemplates.All.Select(t => t.Key));
        var known = NotificationTemplates.Variables.Select(v => v.Name).ToHashSet();
        foreach (var template in NotificationTemplates.All)
        {
            Assert.True(NotificationRules.KnownType(template.Key), template.Key);
            Assert.Contains(template.Route, NotificationRules.Routes);
            Assert.All(template.Variables, name => Assert.Contains(name, known));
            Assert.Contains(template.Status, new[] { NotificationTemplates.Implemented, NotificationTemplates.Ready, NotificationTemplates.Blocked });
            // In-app is the only channel with wording today; the reserved channels have none, so they cannot be sent or customised.
            Assert.Equal(new[] { "in-app" }, template.Defaults.Keys);
            var standard = template.Defaults["in-app"];
            Assert.Empty(NotificationTemplates.Problems(template, standard.Title, standard.Body));
            var preview = Text(template, null, NotificationTemplates.Samples());
            Assert.NotEqual("", preview.Title);
            Assert.DoesNotContain("{{", preview.Title + preview.Body);
        }
    }

    [Fact]
    public void OnlyEventsEduOSRaisesAreMarkedAsSending()
    {
        Assert.Equal(new[] { "circular.published", "leave.requested", "leave.approved", "leave.rejected", "attendance.absent", "attendance.late", "attendance.corrected", "homework.assigned", "homework.reviewed", "result.published", "exam.scheduled", "exam.rescheduled", "substitution.assigned", "substitution.changed", "fee.due", "fee.payment_received" }, NotificationTemplates.All.Where(t => t.Status == NotificationTemplates.Implemented).Select(t => t.Key));
        // Nothing in EduOS raises these yet: both need something that runs on a schedule.
        Assert.Equal(new[] { "homework.due", "fee.due_soon", "fee.overdue" }, NotificationTemplates.All.Where(t => t.Status == NotificationTemplates.Blocked).Select(t => t.Key));
        Assert.False(NotificationRules.KnownType("leave.decided"));
    }

    [Fact]
    public void TheEduOSDefaultIsUsedWhenASchoolHasNoWordingOfItsOwn()
    {
        var sent = NotificationTemplates.Compose(Approved, "in-app", null, Leave)!;
        Assert.Equal(new TemplateText("Your leave was approved", "5 Oct 2026 to 7 Oct 2026. Enjoy the break"), sent.Text);
        Assert.False(sent.School); Assert.Null(sent.Version);
        Assert.Equal(Approved.Defaults["in-app"], NotificationTemplates.Effective(Approved, "in-app", null));
    }

    [Fact]
    public void ASchoolsOwnWordingReplacesTheDefaultForThatSchoolOnlyAndItsVersionIsRecorded()
    {
        var own = new TemplateOverride("{{schoolName}}: leave approved", "Dear {{ teacherName }}, your leave ({{dateRange}}) is approved.", true, 4);
        var sent = NotificationTemplates.Compose(Approved, "in-app", own, Leave)!;
        Assert.Equal(new TemplateText("Riverside School: leave approved", "Dear Meera Nair, your leave (5 Oct 2026 to 7 Oct 2026) is approved."), sent.Text);
        Assert.True(sent.School); Assert.Equal(4, sent.Version);
        // Another school has no row, so it passes null and still gets the default; the default itself never changes.
        Assert.Equal("Your leave was approved", Text(Approved, null, Leave).Title);
        Assert.Equal(new TemplateText("Your leave was approved", "{{dateRange}}. {{remark}}"), NotificationTemplates.Find("leave.approved")!.Defaults["in-app"]);
    }

    [Fact]
    public void ADisabledOrBrokenSchoolWordingFallsBackToTheDefaultAndIsRecordedAsTheDefault()
    {
        // Disabled; no longer valid (for example saved before a variable was withdrawn); a title made only of values that turned out empty.
        var blank = new Dictionary<string, string?>(Leave) { ["remark"] = " " };
        foreach (var (own, values) in new[] { (new TemplateOverride("Ours", "Ours", false, 3), Leave), (new TemplateOverride("Hello {{studentName}}", "", true, 3), Leave), (new TemplateOverride("{{remark}}", "x", true, 3), blank) })
        {
            var sent = NotificationTemplates.Compose(Approved, "in-app", own, values)!;
            Assert.Equal("Your leave was approved", sent.Text.Title);
            Assert.False(sent.School); Assert.Null(sent.Version);
        }
    }

    [Fact]
    public void AChannelWithoutEduOSWordingProducesNothing()
    {
        foreach (var channel in new[] { "push", "email", "whatsapp", "sms", "fax" })
        {
            Assert.Null(NotificationTemplates.Effective(Approved, channel, new("Ours", "Ours", true)));
            Assert.Null(NotificationTemplates.Compose(Approved, channel, new("Ours", "Ours", true), Leave));
        }
    }

    [Theory]
    [InlineData("Hello {{studentName}}", "{{studentName}} is not available")]   // real variable, wrong event
    [InlineData("Hello {{password}}", "{{password}} is not available")]
    [InlineData("Hello {{constructor}}", "{{constructor}} is not available")]
    [InlineData("Hello {{ teacherName", "Write placeholders exactly")]
    [InlineData("Hello {{teacherName.length}}", "Write placeholders exactly")]
    [InlineData("Hello {{1+1}}", "Write placeholders exactly")]
    [InlineData("Hello {{#each users}}", "Write placeholders exactly")]
    [InlineData("Hello {{{teacherName}}}", "Write placeholders exactly")]
    [InlineData("Hello }} there", "Write placeholders exactly")]
    [InlineData("<b>Approved</b>", "plain text only")]
    [InlineData("<script>alert(1)</script>", "plain text only")]
    [InlineData("See <!-- note -->", "plain text only")]
    [InlineData("   ", "Enter a title")]
    public void WordingThatIsNotPlainTextWithAllowedPlaceholdersIsRefused(string title, string problem)
    {
        var problems = NotificationTemplates.Problems(Approved, title, "Body");
        Assert.Contains(problems, text => text.Contains(problem));
        if (title.Trim() != "") Assert.Contains(NotificationTemplates.Problems(Approved, "Title", title), text => text.Contains(problem));
    }

    [Fact]
    public void PlainWordingIsAccepted()
    {
        Assert.Empty(NotificationTemplates.Problems(Approved, "Leave approved for {{teacherName}}", "Dates: {{ dateRange }}. Fewer than 3 days < a week; {single} braces & symbols are fine."));
        Assert.Empty(NotificationTemplates.Problems(Approved, "Title", ""));
        Assert.Empty(NotificationTemplates.Problems(Approved, "Title", "First line\nSecond line\n\nNew paragraph"));
        Assert.Empty(NotificationTemplates.Problems(Approved, "छुट्टी स्वीकृत {{teacherName}}", "आपकी छुट्टी स्वीकृत हो गई है। " + char.ConvertFromUtf32(0x1F389)));
    }

    [Fact]
    public void LengthLimitsFollowTheChannel()
    {
        Assert.Equal(new[] { "in-app", "push", "email", "whatsapp", "sms" }, NotificationRules.Limits.Keys);
        foreach (var (channel, limit) in NotificationRules.Limits)
        {
            Assert.InRange(limit.Title, 1, 200); Assert.InRange(limit.Body, 1, 1000);   // what the stored columns hold
            Assert.Empty(NotificationTemplates.Problems(Approved, channel, new string('a', limit.Title), new string('b', limit.Body)));
            var problems = NotificationTemplates.Problems(Approved, channel, new string('a', limit.Title + 1), new string('b', limit.Body + 1));
            Assert.Contains(problems, text => text.Contains($"title within {limit.Title}"));
            Assert.Contains(problems, text => text.Contains($"message within {limit.Body}"));
        }
        Assert.Equal(new[] { "Unknown notification channel." }, NotificationTemplates.Problems(Approved, "fax", "Title", "Body"));
        Assert.Contains(NotificationTemplates.Problems(Approved, "Two\nlines", "Body"), text => text.Contains("one line"));
    }

    [Fact]
    public void ValuesAreInsertedAsTextAndNeverReadAsTemplates()
    {
        var hostile = new Dictionary<string, string?>(Leave) { ["teacherName"] = "{{remark}} {{schoolName}} <script>x</script>", ["remark"] = "{{teacherName}}" };
        // A value that looks like a placeholder is shown as written: one pass, no second look.
        Assert.Equal("Hi {{remark}} {{schoolName}} <script>x</script> / {{teacherName}}", NotificationTemplates.Render(Approved, "Hi {{teacherName}} / {{remark}}", hostile));
    }

    [Fact]
    public void WhatAPersonTypedInACircularIsShownExactlyAsTyped()
    {
        // The circular's own title and message are values. Braces, tags and other people's placeholders in them are just text.
        var values = new Dictionary<string, string?> { ["circularTitle"] = "Fees {{amount}} & <b>bold</b> }} {{", ["circularMessage"] = "Dear {{studentName}},\r\n\r\n<img src=x onerror=alert(1)>\r\nRegards {{schoolName}}", ["schoolName"] = "Riverside School" };
        var sent = Text(Circular, null, values);
        Assert.Equal("Fees {{amount}} & <b>bold</b> }} {{", sent.Title);
        Assert.Equal("Dear {{studentName}},\n\n<img src=x onerror=alert(1)>\nRegards {{schoolName}}", sent.Body);
    }

    [Fact]
    public void OnlyTheTemplatesOwnVariablesAreReplaced()
    {
        // studentName is a real variable but not part of a leave decision; it is left as written even when a value is offered.
        var values = new Dictionary<string, string?>(Leave) { ["studentName"] = "Asha Verma", ["secret"] = "s3cret" };
        Assert.Equal("{{studentName}} {{secret}} Meera Nair", NotificationTemplates.Render(Approved, "{{studentName}} {{secret}} {{teacherName}}", values));
        // A variable the event has no value for becomes nothing, not the placeholder.
        Assert.Equal("Remark: ", NotificationTemplates.Render(Approved, "Remark: {{remark}}", new Dictionary<string, string?>()));
        Assert.Equal("", NotificationTemplates.Render(Approved, null, Leave));
        // With every value missing the default still has a title, and an empty message is allowed.
        Assert.Equal(new TemplateText("Your leave was approved", "."), Text(Approved, null, new Dictionary<string, string?>()));
    }

    [Fact]
    public void PreviewsUseMadeUpValuesAndTheSchoolsOwnName()
    {
        var samples = NotificationTemplates.Samples("Riverside School");
        Assert.Equal("Riverside School", samples["schoolName"]);
        Assert.Equal(NotificationTemplates.Variables.Length, samples.Count);
        Assert.Equal("Your school", NotificationTemplates.Samples(" ")["schoolName"]);
        Assert.Equal("Leave request from Ravi Kumar", Text(NotificationTemplates.Find("leave.requested")!, null, samples).Title);
    }

    [Fact]
    public void LongResultsAreClippedToWhatTheInboxStores()
    {
        var text = Text(Approved, new("{{remark}}", "{{remark}}", true), new Dictionary<string, string?> { ["remark"] = new string('x', 3000) });
        Assert.Equal(200, text.Title.Length);
        Assert.Equal(1000, text.Body.Length);
    }

    [Theory]
    [InlineData("school", true)][InlineData("teacher", false)][InlineData("parent", false)][InlineData("student", false)][InlineData("platform", false)][InlineData(null, false)]
    public void OnlyASchoolScopeRoleWithThePermissionManagesWording(string? scope, bool allowed)
    {
        Assert.Equal(allowed, NotificationTemplates.MayManage(scope, ["notifications.manage", "circulars.view"]));
        Assert.False(NotificationTemplates.MayManage(scope, ["school.settings.manage", "school-home.manage", "circulars.manage"]));
    }

    [Fact]
    public void DatesAndAmountsReadNaturally()
    {
        Assert.Equal("5 Oct 2026", NotificationTemplates.Day("2026-10-05"));
        Assert.Equal("next week", NotificationTemplates.Day(" next week "));
        Assert.Equal("", NotificationTemplates.Day(null));
        Assert.Equal("5 Oct 2026", NotificationTemplates.Range("2026-10-05", "2026-10-05"));
        Assert.Equal("5 Oct 2026", NotificationTemplates.Range("2026-10-05", ""));
        Assert.Equal("5 Oct 2026 to 7 Oct 2026", NotificationTemplates.Range("2026-10-05", "2026-10-07"));
        Assert.Equal("INR 12,500", NotificationTemplates.Money("INR", 1250000));
        Assert.Equal("INR 12,500.50", NotificationTemplates.Money(" INR ", 1250050));
        Assert.Equal("0.05", NotificationTemplates.Money(null, 5));
    }
}

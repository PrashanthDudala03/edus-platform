using System.Text.Json.Nodes;
using Xunit;

// Communication 2.0 rules: lifecycle, who reads what, what a teacher may address, what is frozen after publication,
// scheduling, the audit entries and the figures leadership reads. All pure; no database is needed.
public class CommunicationRulesTests
{
    static readonly DateTimeOffset Now = new(2026, 10, 6, 9, 0, 0, TimeSpan.Zero);
    static CommunicationRules.Composition Compose(string status = "Published", string audience = "All", string classId = "", string priority = "Normal", string publishAt = "", string expiresOn = "", string acknowledge = "No", string acknowledgeBy = "", string title = "Sports day", string message = "Bring water.", string type = "Circular") =>
        new(title, message, type, priority, audience, classId, status, publishAt, expiresOn, acknowledgeBy, acknowledge);

    [Fact]
    public void CircularsFromBeforeTwoPointZeroAreLiveNormalCircularsAndAnAcknowledgeByDateMeansAcknowledgementIsRequired()
    {
        Assert.Equal("Published", CommunicationRules.Status("")); Assert.Equal("Normal", CommunicationRules.Priority("")); Assert.Equal("Circular", CommunicationRules.Type(""));
        Assert.True(CommunicationRules.Live("")); Assert.False(CommunicationRules.Closed(""));
        Assert.True(CommunicationRules.Acknowledgement("", "2026-10-10")); Assert.False(CommunicationRules.Acknowledgement("", "")); Assert.True(CommunicationRules.Acknowledgement("Yes", "")); Assert.False(CommunicationRules.Acknowledgement("No", "2026-10-10"));
    }

    [Theory]
    [InlineData("Draft", "Scheduled", true, null)][InlineData("Draft", "Published", true, null)][InlineData("Draft", "Cancelled", true, null)]
    [InlineData("Scheduled", "Draft", true, null)][InlineData("Scheduled", "Published", true, null)][InlineData("Scheduled", "Cancelled", true, null)]
    [InlineData("Published", "Archived", true, null)][InlineData("Published", "Published", true, null)][InlineData("", "Published", true, null)]
    [InlineData("Published", "Draft", true, 409)][InlineData("Published", "Scheduled", true, 409)][InlineData("Published", "Cancelled", true, 409)]
    [InlineData("Archived", "Published", true, 409)][InlineData("Cancelled", "Draft", true, 409)][InlineData("Draft", "Archived", true, 409)]
    [InlineData("Draft", "Published", false, 403)][InlineData("Draft", "Sent", true, 400)]
    public void TheLifecycleIsDraftToScheduledOrPublishedThenArchivedOrCancelled(string from, string to, bool manage, int? status)
    {
        var problem = CommunicationRules.TransitionProblem(from, to, manage);
        Assert.Equal(status, problem?.Status);
    }

    [Fact]
    public void AudiencesMapToDataScopesAndLeadershipIsIncludedOnlyInAllAndStaff()
    {
        Assert.Equal(new[] { "school", "teacher", "parent", "student" }, CommunicationRules.Scopes("All"));
        Assert.Equal(new[] { "school", "teacher" }, CommunicationRules.Scopes("Staff"));
        Assert.Equal(new[] { "parent", "student" }, CommunicationRules.Scopes("Family"));
        Assert.Empty(CommunicationRules.Scopes("Everyone"));
        Assert.True(CommunicationRules.Addressed("Staff", "Principal")); Assert.True(CommunicationRules.Addressed("Staff", "Teacher")); Assert.False(CommunicationRules.Addressed("Staff", "Parent"));
        Assert.True(CommunicationRules.Addressed("Family", "Student")); Assert.False(CommunicationRules.Addressed("Parent", "Student")); Assert.False(CommunicationRules.Addressed("All", "SuperAdmin"));
    }

    [Fact]
    public void OnlyThePeopleAddressedReadAPublishedCommunicationAndOnlyTheAuthorReadsOneThatIsNotLive()
    {
        var classes = new HashSet<string> { "c1" };
        Assert.True(CommunicationRules.Visible("Published", "Parent", "", "Parent", classes, false));
        Assert.True(CommunicationRules.Visible("", "All", "c1", "Student", classes, false));
        Assert.False(CommunicationRules.Visible("Published", "Parent", "c2", "Parent", classes, false), "another class");
        Assert.False(CommunicationRules.Visible("Published", "Teacher", "", "Parent", classes, false), "not addressed");
        Assert.True(CommunicationRules.Visible("Archived", "Family", "", "Student", classes, false), "archived stays readable as history");
        foreach (var status in new[] { "Draft", "Scheduled", "Cancelled" })
        {
            Assert.False(CommunicationRules.Visible(status, "All", "", "Parent", classes, false), status + " is not shown to its audience");
            Assert.True(CommunicationRules.Visible(status, "All", "", "Teacher", classes, true), status + " is shown to its author");
        }
    }

    [Fact]
    public void UrgentAndAcknowledgementCommunicationsBypassAPersonalMuteAndAreMarkedInTheTitle()
    {
        Assert.True(CommunicationRules.Required("Urgent", "No", "")); Assert.True(CommunicationRules.Required("Normal", "Yes", "")); Assert.True(CommunicationRules.Required("", "", "2026-10-10"));
        Assert.False(CommunicationRules.Required("Important", "No", "")); Assert.False(CommunicationRules.Required("", "", ""));
        Assert.Equal("Urgent: School closed", CommunicationRules.Headline("Urgent", "School closed")); Assert.Equal("Sports day", CommunicationRules.Headline("Important", "Sports day"));
    }

    [Fact]
    public void LeadershipMayComposeAnythingValidAndATeacherOnlyForTheFamiliesOfTheirOwnClass()
    {
        var mine = new HashSet<string> { "c1" };
        Assert.Null(CommunicationRules.ComposeProblem(Compose(), true, null, Now));
        Assert.Null(CommunicationRules.ComposeProblem(Compose(priority: "Urgent", audience: "Staff"), true, null, Now));
        Assert.Equal(403, CommunicationRules.ComposeProblem(Compose(priority: "Urgent", audience: "Parent", classId: "c1"), false, mine, Now)?.Status);
        Assert.Null(CommunicationRules.ComposeProblem(Compose(audience: "Parent", classId: "c1"), false, mine, Now));
        Assert.Null(CommunicationRules.ComposeProblem(Compose(audience: "Family", classId: "c1", priority: "Important"), false, mine, Now));
        Assert.Equal(403, CommunicationRules.ComposeProblem(Compose(audience: "Parent", classId: "c2"), false, mine, Now)?.Status);
        Assert.Equal(403, CommunicationRules.ComposeProblem(Compose(audience: "Parent", classId: ""), false, mine, Now)?.Status);
        Assert.Equal(403, CommunicationRules.ComposeProblem(Compose(audience: "All", classId: "c1"), false, mine, Now)?.Status);
        Assert.Equal(403, CommunicationRules.ComposeProblem(Compose(audience: "Staff", classId: "c1"), false, mine, Now)?.Status);
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(audience: "Everyone"), true, null, Now)?.Status);
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(type: "Memo"), true, null, Now)?.Status);
    }

    [Fact]
    public void SchedulingNeedsAFuturePublishTimeWithinAYearAndExpiryCannotPrecedePublication()
    {
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(status: "Scheduled"), true, null, Now)?.Status);
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(status: "Scheduled", publishAt: "tomorrow"), true, null, Now)?.Status);
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(status: "Scheduled", publishAt: "2026-10-06T09:00:00Z"), true, null, Now)?.Status);
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(status: "Scheduled", publishAt: "2027-10-07T09:00:00Z"), true, null, Now)?.Status);
        Assert.Null(CommunicationRules.ComposeProblem(Compose(status: "Scheduled", publishAt: "2026-10-07T09:00"), true, null, Now));
        Assert.True(CommunicationRules.ComposeProblem(Compose(status: "Draft", publishAt: "2026-10-07T09:00"), true, null, Now) is null, "a draft may hold a planned time");
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(status: "Draft", publishAt: "soon"), true, null, Now)?.Status);
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(status: "Published", expiresOn: "2026-10-05"), true, null, Now)?.Status);
        Assert.Null(CommunicationRules.ComposeProblem(Compose(status: "Published", expiresOn: "2026-10-06"), true, null, Now));
        Assert.Equal(400, CommunicationRules.ComposeProblem(Compose(status: "Scheduled", publishAt: "2026-10-20T09:00:00Z", expiresOn: "2026-10-19"), true, null, Now)?.Status);
        Assert.Null(CommunicationRules.ComposeProblem(Compose(status: "Scheduled", publishAt: "2026-10-20T09:00:00Z", expiresOn: "2026-10-20"), true, null, Now));
        Assert.True(CommunicationRules.ComposeProblem(Compose(status: "Draft", expiresOn: "2020-01-01"), true, null, Now) is null, "a draft is not yet published");
    }

    [Fact]
    public void ATimeWithoutAnOffsetIsUtcAndACommunicationIsDueOnlyWhenScheduledAndItsTimeHasCome()
    {
        Assert.Equal(new DateTimeOffset(2026, 10, 7, 9, 0, 0, TimeSpan.Zero), CommunicationRules.PublishAt("2026-10-07T09:00"));
        Assert.Equal(new DateTimeOffset(2026, 10, 7, 3, 30, 0, TimeSpan.Zero), CommunicationRules.PublishAt("2026-10-07T09:00+05:30"));
        Assert.Null(CommunicationRules.PublishAt("")); Assert.Null(CommunicationRules.PublishAt("next week"));
        Assert.True(CommunicationRules.Due("Scheduled", "2026-10-06T09:00:00Z", Now)); Assert.True(CommunicationRules.Due("Scheduled", "2026-10-06T08:59:00Z", Now));
        Assert.False(CommunicationRules.Due("Scheduled", "2026-10-06T09:01:00Z", Now)); Assert.False(CommunicationRules.Due("Draft", "2026-10-06T08:00:00Z", Now)); Assert.False(CommunicationRules.Due("Published", "2026-10-06T08:00:00Z", Now));
        Assert.False(CommunicationRules.Due("Scheduled", "", Now));
        Assert.True(CommunicationRules.Expired("2026-10-05", new DateOnly(2026, 10, 6))); Assert.False(CommunicationRules.Expired("2026-10-06", new DateOnly(2026, 10, 6))); Assert.False(CommunicationRules.Expired("", new DateOnly(2026, 10, 6)));
    }

    [Fact]
    public void APublishedCommunicationKeepsItsAudienceAndMarksAndAClosedOneNeverChanges()
    {
        var before = Compose(audience: "Parent", classId: "c1", priority: "Important", acknowledge: "Yes");
        Assert.Null(CommunicationRules.EditProblem("Published", before, before with { Title = "Sports day moved", Message = "Now on Friday.", ExpiresOn = "2026-10-30", AcknowledgeBy = "2026-10-20" }));
        Assert.Null(CommunicationRules.EditProblem("Published", before, before with { Status = "Archived" }));
        foreach (var changed in new[] { before with { Audience = "All" }, before with { ClassId = "" }, before with { Priority = "Urgent" }, before with { Acknowledge = "No" }, before with { Type = "Alert" } })
            Assert.NotNull(CommunicationRules.EditProblem("Published", before, changed));
        Assert.True(CommunicationRules.EditProblem("Draft", before, before with { Audience = "All", Priority = "Urgent" }) is null, "anything may change before publication");
        Assert.Null(CommunicationRules.EditProblem("Scheduled", before, before with { ClassId = "c2" }));
        Assert.NotNull(CommunicationRules.EditProblem("Archived", before, before)); Assert.NotNull(CommunicationRules.EditProblem("Cancelled", before, before with { Title = "x" }));
    }

    [Fact]
    public void TheAuditLogRecordsEveryStatusMoveAnAudienceChangeBeforePublicationAndAMaterialEditAfterIt()
    {
        var draft = Compose(status: "Draft", audience: "Parent", classId: "c1");
        Assert.Empty(CommunicationRules.AuditActions(null, draft));
        Assert.Equal(["communication.published"], CommunicationRules.AuditActions(null, draft with { Status = "Published" }));
        Assert.Equal(["communication.scheduled"], CommunicationRules.AuditActions(draft, draft with { Status = "Scheduled", PublishAt = "2026-10-07T09:00" }));
        Assert.Equal(["communication.unscheduled"], CommunicationRules.AuditActions(draft with { Status = "Scheduled" }, draft));
        Assert.Equal(["communication.scheduled"], CommunicationRules.AuditActions(draft with { Status = "Scheduled", PublishAt = "2026-10-07T09:00" }, draft with { Status = "Scheduled", PublishAt = "2026-10-08T09:00" }));
        Assert.Equal(["communication.published", "communication.audience"], CommunicationRules.AuditActions(draft, draft with { Status = "Published", Audience = "All", ClassId = "" }));
        Assert.Equal(["communication.audience"], CommunicationRules.AuditActions(draft, draft with { ClassId = "c2" }));
        Assert.Equal(["communication.cancelled"], CommunicationRules.AuditActions(draft with { Status = "Scheduled" }, draft with { Status = "Cancelled" }));
        var live = draft with { Status = "Published" };
        Assert.Equal(["communication.archived"], CommunicationRules.AuditActions(live, live with { Status = "Archived" }));
        Assert.Equal(["communication.edited"], CommunicationRules.AuditActions(live, live with { Message = "Corrected." }));
        Assert.Equal(["communication.edited"], CommunicationRules.AuditActions(live, live with { ExpiresOn = "2026-12-01" }));
        Assert.Empty(CommunicationRules.AuditActions(live, live));
        Assert.All(CommunicationRules.AuditActions(draft, draft with { Status = "Published", Audience = "All" }), action => Assert.InRange(action.Length, 1, 30));   // the stored column
    }

    [Fact]
    public void TheFiguresAreIntendedNotifiedReadAcknowledgedAndOutstandingOnlyWhereAcknowledgementIsRequired()
    {
        var counts = CommunicationRules.Counts(40, 38, 20, 15, 2, true);
        Assert.Equal((40, 38, 20, 15, 2, 25), (counts["intended"]!.GetValue<int>(), counts["notified"]!.GetValue<int>(), counts["read"]!.GetValue<int>(), counts["acknowledged"]!.GetValue<int>(), counts["failed"]!.GetValue<int>(), counts["outstanding"]!.GetValue<int>()));
        Assert.Null(CommunicationRules.Counts(40, 38, 20, 0, 0, false)["outstanding"]);
        Assert.Equal(0, CommunicationRules.Counts(3, 3, 3, 5, 0, true)["outstanding"]!.GetValue<int>());   // never negative
        Assert.Equal("Parents of Grade 8 - A", CommunicationRules.AudienceLabel("Parent", "Grade 8 - A")); Assert.Equal("Everyone at the school", CommunicationRules.AudienceLabel("All", ""));
        Assert.Equal("Families of Grade 8 - A", CommunicationRules.AudienceLabel("Family", "Grade 8 - A")); Assert.Equal("All staff", CommunicationRules.AudienceLabel("Staff", ""));
    }

    [Fact]
    public void TheVocabularyIsSmallAndTheKeptFieldsAreServerOwned()
    {
        Assert.Equal(5, CommunicationRules.Statuses.Length); Assert.Equal(3, CommunicationRules.Priorities.Length); Assert.Equal(6, CommunicationRules.Audiences.Length);
        Assert.All(CommunicationRules.TeacherAudiences, audience => Assert.Contains(audience, CommunicationRules.Audiences));
        Assert.DoesNotContain("All", CommunicationRules.TeacherAudiences); Assert.DoesNotContain("Staff", CommunicationRules.TeacherAudiences);
        Assert.Contains("authorId", CommunicationRules.Kept); Assert.Contains("snapshot", CommunicationRules.Kept); Assert.Contains("publishedAt", CommunicationRules.Kept);
        // The audit column is varchar(30): every action fits.
        foreach (var to in CommunicationRules.Statuses) Assert.All(CommunicationRules.AuditActions(Compose(status: to == "Draft" ? "Scheduled" : "Draft"), Compose(status: to)), action => Assert.True(action.Length <= 30));
    }
}

// The delivery worker's pure half: what a channel's answer does to a claimed row, and that no channel is a permanent,
// counted failure rather than a silent loss or an endless retry.
public class NotificationWorkerTests
{
    static readonly DateTimeOffset Now = new(2026, 10, 6, 9, 0, 0, TimeSpan.Zero);
    static readonly Delivery Claimed = new("processing", 0, null, null, null);

    [Fact]
    public void ARowWithoutAProviderFailsForGoodAndIsNeverRetried()
    {
        var outcome = DeliveryChannels.Outcome(Claimed, null, Now);
        Assert.Equal(("failed", 1, DeliveryChannels.NoProvider), (outcome.Status, outcome.Attempts, outcome.LastError));
        Assert.Null(outcome.NextAttemptAt); Assert.Null(outcome.DeliveredAt);
    }

    [Fact]
    public void AChannelThatDeliversMarksTheRowDeliveredOnceAndARetryableFailureWaitsForTheNextAttempt()
    {
        var done = DeliveryChannels.Outcome(Claimed, DeliveryResult.Success, Now);
        Assert.Equal(new Delivery("delivered", 1, null, null, Now), done);
        var retry = DeliveryChannels.Outcome(Claimed, DeliveryResult.Retry("Provider unavailable"), Now);
        Assert.Equal(("failed", 1, "Provider unavailable", Now.AddMinutes(1)), (retry.Status, retry.Attempts, retry.LastError, retry.NextAttemptAt));
        var rejected = DeliveryChannels.Outcome(Claimed, DeliveryResult.Reject("Unknown device token"), Now);
        Assert.Equal("failed", rejected.Status); Assert.Null(rejected.NextAttemptAt);
    }

    [Fact]
    public void NoChannelIsRegisteredInThisReleaseAndInAppCanNeverBeOne()
    {
        Assert.Empty(DeliveryChannels.Registered);
        Assert.Null(DeliveryChannels.For("push")); Assert.Null(DeliveryChannels.For("email"));
        Assert.Throws<ArgumentException>(() => DeliveryChannels.Register(new Fake("in-app")));
        Assert.Throws<ArgumentException>(() => DeliveryChannels.Register(new Fake("fax")));
        Assert.Equal("in-app", Assert.Single(NotificationRules.Available));
    }

    [Fact]
    public void AProviderErrorIsShownToManagersOnlyAndTheRowIsClaimedInBatches()
    {
        Assert.Equal("Token expired", DeliveryChannels.Shown("Token expired", true));
        Assert.Equal("Delivery failed.", DeliveryChannels.Shown("Token expired", false));
        Assert.Equal("", DeliveryChannels.Shown(null, false));
        Assert.InRange(DeliveryChannels.Batch, 1, 500);
    }

    sealed class Fake(string channel) : IDeliveryChannel
    {
        public string Channel => channel;
        public Task<DeliveryResult> SendAsync(DeliveryJob job, CancellationToken cancellation) => Task.FromResult(DeliveryResult.Success);
    }
}

using Xunit;

// Event identity, safe text, the delivery outbox and device registration: the rules that keep one business event to
// one notification and keep outside delivery out of the request that caused it. All pure; no database is needed.
public class NotificationFoundationTests
{
    static readonly Guid Record = Guid.Parse("7c1d0000-0000-4000-8000-0000000000d1"), Other = Guid.Parse("7c1d0000-0000-4000-8000-0000000000d2");
    static readonly DateTimeOffset Now = new(2026, 10, 2, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TheSameEventAlwaysHasTheSameKey()
    {
        // A retry, a repeated save, a restart or a producer run twice all describe the same event, so they collide.
        Assert.Equal("circular.published:7c1d0000-0000-4000-8000-0000000000d1", NotificationRules.EventKey("circular.published", Record));
        Assert.Equal(NotificationRules.EventKey("fee.due", Record), NotificationRules.EventKey("fee.due", Guid.Parse(Record.ToString().ToUpperInvariant())));
        Assert.Equal(NotificationRules.EventKey("attendance.absent", Record, "2026-10-02"), NotificationRules.EventKey("attendance.absent", Record, "2026-10-02"));
    }

    [Fact]
    public void DifferentEventsHaveDifferentKeys()
    {
        var keys = new[]
        {
            NotificationRules.EventKey("leave.approved", Record, "v2"), NotificationRules.EventKey("leave.rejected", Record, "v3"), NotificationRules.EventKey("leave.approved", Record, "v4"),
            NotificationRules.EventKey("leave.approved", Other, "v2"), NotificationRules.EventKey("leave.requested", Record),
            NotificationRules.EventKey("attendance.absent", Record, "2026-10-01"), NotificationRules.EventKey("attendance.absent", Record, "2026-10-02"), NotificationRules.EventKey("attendance.absent", Other, "2026-10-02"),
        };
        Assert.Equal(keys.Length, keys.Distinct().Count());
        Assert.All(keys, key => Assert.InRange(key.Length, 1, 200));   // the stored column
    }

    [Fact]
    public void AKeyCannotBeBuiltFromAnythingElse()
    {
        Assert.Throws<ArgumentException>(() => NotificationRules.EventKey("x.y", Record));
        Assert.Throws<ArgumentException>(() => NotificationRules.EventKey("fee.due", Guid.Empty));
        foreach (var occurrence in new[] { "", " ", "a:b", "v1 OR 1=1", "../x", new string('a', 61) }) Assert.Throws<ArgumentException>(() => NotificationRules.EventKey("fee.due", Record, occurrence));
    }

    [Theory]
    [InlineData(0, true)][InlineData(-1, true)][InlineData(1, true)][InlineData(-2, false)][InlineData(-30, false)][InlineData(2, false)]
    public void AnAbsenceIsAnnouncedOnlyWhileItIsNews(int daysFromToday, bool announced) =>
        Assert.Equal(announced, NotificationRules.Timely(new DateOnly(2026, 10, 2).AddDays(daysFromToday), new DateOnly(2026, 10, 2)));

    [Fact]
    public void StoredTextIsAlwaysSafeToStoreAndShow()
    {
        var nul = ((char)0).ToString(); var bell = ((char)7).ToString(); var rightToLeft = ((char)0x202E).ToString(); var lineSeparator = ((char)0x2028).ToString();
        var party = char.ConvertFromUtf32(0x1F389); var half = party[..1];
        Assert.Equal("Fee due", NotificationRules.Clip("Fee" + nul + bell + " due" + rightToLeft, 200));
        Assert.Equal("a b", NotificationRules.Clip("a" + lineSeparator + "b", 200));
        // Half of a character pair cannot be stored; it is dropped, and a whole one is never cut in two.
        Assert.Equal("ab", NotificationRules.Clip("a" + half + "b", 200));
        Assert.Equal("ab", NotificationRules.Clip("a" + party[1..] + "b", 200));
        var clipped = NotificationRules.Clip("abc" + party + party + party, 6);
        Assert.Equal("abc" + party + "…", clipped);
        Assert.Equal("abc…", NotificationRules.Clip("abc" + party + party + party, 5));
        Assert.Equal("", NotificationRules.Clip(null, 10));
        Assert.Equal("", NotificationRules.ClipLines(" \r\n \n ", 10));
    }

    [Fact]
    public void ATitleIsOneLineAndAMessageKeepsItsLineBreaks()
    {
        const string typed = "  Dear parents,\r\n\r\n\r\n\r\nSchool   reopens\ton Monday.  \rBring books.\n";
        Assert.Equal("Dear parents, School reopens on Monday. Bring books.", NotificationRules.Clip(typed, 200));
        Assert.Equal("Dear parents,\n\nSchool reopens on Monday.\nBring books.", NotificationRules.ClipLines(typed, 1000));
        Assert.Equal("Dear parents,\n\nSchool…", NotificationRules.ClipLines(typed, 23));
        Assert.Equal(1000, NotificationRules.ClipLines(new string('x', 5000), 1000).Length);
    }

    [Fact]
    public void InAppIsDeliveredByBeingStoredAndEveryOtherChannelWaitsForAWorker()
    {
        Assert.Equal(new Delivery("delivered", 0, null, null, Now), DeliveryRules.New("in-app", Now));
        foreach (var channel in new[] { "push", "email", "whatsapp", "sms" })
        {
            var queued = DeliveryRules.New(channel, Now);
            Assert.Equal(new Delivery("pending", 0, null, Now, null), queued);
            Assert.True(DeliveryRules.Due(queued, Now, Now));
        }
    }

    [Fact]
    public void ADeliveryIsClaimedThenDeliveredOnce()
    {
        var claimed = DeliveryRules.Claim(DeliveryRules.New("push", Now));
        Assert.Equal("processing", claimed.Status);
        // While a worker holds it, no other worker takes it.
        Assert.False(DeliveryRules.Due(claimed, Now, Now.AddMinutes(1)));
        var done = DeliveryRules.Succeeded(claimed, Now.AddSeconds(2));
        Assert.Equal(new Delivery("delivered", 1, null, null, Now.AddSeconds(2)), done);
        Assert.False(DeliveryRules.Due(done, Now, Now.AddDays(30)));
    }

    [Fact]
    public void AFailedDeliveryIsRetriedLaterWithGrowingGapsAndThenGivenUp()
    {
        var delivery = DeliveryRules.New("push", Now); var waits = new List<double>();
        for (var attempt = 1; attempt <= DeliveryRules.MaxAttempts; attempt++)
        {
            delivery = DeliveryRules.Failed(DeliveryRules.Claim(delivery), "Provider   unavailable\n(503)", false, Now);
            Assert.Equal(("failed", attempt, "Provider unavailable (503)"), (delivery.Status, delivery.Attempts, delivery.LastError));
            if (delivery.NextAttemptAt is { } next) { waits.Add((next - Now).TotalMinutes); Assert.False(DeliveryRules.Due(delivery, Now, next.AddSeconds(-1))); Assert.True(DeliveryRules.Due(delivery, Now, next)); }
        }
        Assert.Equal(new double[] { 1, 5, 30, 120 }, waits);
        Assert.Null(delivery.NextAttemptAt);                        // out of attempts: never due again
        Assert.False(DeliveryRules.Due(delivery, Now, Now.AddYears(1)));
        Assert.Null(delivery.DeliveredAt);
    }

    [Fact]
    public void APermanentFailureIsNeverRetriedAndALongErrorIsShortened()
    {
        var failed = DeliveryRules.Failed(DeliveryRules.Claim(DeliveryRules.New("push", Now)), new string('e', 900), true, Now);
        Assert.Equal(("failed", 1), (failed.Status, failed.Attempts));
        Assert.Null(failed.NextAttemptAt);
        Assert.Equal(300, failed.LastError!.Length);
    }

    [Fact]
    public void AClaimAbandonedByAStoppedWorkerBecomesDueAgain()
    {
        var claimed = DeliveryRules.Claim(DeliveryRules.New("push", Now));
        Assert.False(DeliveryRules.Due(claimed, Now, Now + DeliveryRules.Lease - TimeSpan.FromSeconds(1)));
        Assert.True(DeliveryRules.Due(claimed, Now, Now + DeliveryRules.Lease));
    }

    [Fact]
    public void AWellFormedDeviceIsAccepted()
    {
        Assert.Empty(DeviceRules.Problems("3f2b8c1e-9d4a-4f6b-8a2e-1c5d7e9f0a1b", "android", new string('t', 163), "1.0.0 (12)"));
        Assert.Empty(DeviceRules.Problems("installation_1:abc", "ios", "dGhpcy1pcy1hLXRva2Vu:APA91b-" + new string('x', 120), ""));
        Assert.Equal(new[] { "android", "ios" }, DeviceRules.Platforms);
    }

    [Theory]
    [InlineData("short", "android", "aaaaaaaaaaaaaaaaaaaaaaaa", "1.0", "installation")]
    [InlineData("id with spaces 123", "android", "aaaaaaaaaaaaaaaaaaaaaaaa", "1.0", "installation")]
    [InlineData("'; DROP TABLE x; --", "android", "aaaaaaaaaaaaaaaaaaaaaaaa", "1.0", "installation")]
    [InlineData("3f2b8c1e-9d4a-4f6b", "windows", "aaaaaaaaaaaaaaaaaaaaaaaa", "1.0", "Platform")]
    [InlineData("3f2b8c1e-9d4a-4f6b", "", "aaaaaaaaaaaaaaaaaaaaaaaa", "1.0", "Platform")]
    [InlineData("3f2b8c1e-9d4a-4f6b", "android", "too-short", "1.0", "push token")]
    [InlineData("3f2b8c1e-9d4a-4f6b", "android", "token with a space inside it", "1.0", "push token")]
    [InlineData("3f2b8c1e-9d4a-4f6b", "android", "aaaaaaaaaaaaaaaaaaaaaaaa", "<script>1</script>", "app version")]
    public void AMalformedDeviceIsRefused(string installation, string platform, string token, string version, string problem) =>
        Assert.Contains(DeviceRules.Problems(installation, platform, token, version), text => text.Contains(problem));

    [Fact]
    public void MissingOrOversizedDeviceFieldsAreRefused()
    {
        Assert.Equal(3, DeviceRules.Problems(null, null, null, null).Count);
        Assert.Contains(DeviceRules.Problems(new string('a', 101), "android", new string('t', 513), new string('1', 41)), text => text.Contains("push token"));
        Assert.Equal(3, DeviceRules.Problems(new string('a', 101), "android", new string('t', 513), new string('1', 41)).Count);
    }
}

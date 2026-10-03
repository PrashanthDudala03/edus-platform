using Xunit;

// The rules every notification passes through. Database behaviour (tenant-bound queries) is covered by the SQL in
// Suite.Notifications.cs, which names the school and user of the verified token in every statement.
public class NotificationRulesTests
{
    static readonly Guid Asha = Guid.NewGuid(), Ravi = Guid.NewGuid(), Meera = Guid.NewGuid();

    [Fact]
    public void EveryTypeHasACategoryAPersonCanMute()
    {
        Assert.NotEmpty(NotificationRules.Types);
        foreach (var type in NotificationRules.Types) Assert.Contains(NotificationRules.Category(type), NotificationRules.Categories);
        Assert.True(NotificationRules.KnownType("circular.published"));
        foreach (var unknown in new[] { null, "", "circular", "CIRCULAR.PUBLISHED", "x.y", "__proto__" }) Assert.False(NotificationRules.KnownType(unknown));
        Assert.Throws<ArgumentException>(() => NotificationRules.Category("x.y"));
    }

    [Fact]
    public void OnlyInAppDeliversToday()
    {
        Assert.Equal(new[] { "in-app" }, NotificationRules.Available);
        Assert.All(NotificationRules.Available, channel => Assert.Contains(channel, NotificationRules.Channels));
        Assert.Equal(new[] { "in-app", "push", "email", "whatsapp", "sms" }, NotificationRules.Channels);
    }

    [Theory]
    [InlineData("notices")][InlineData("leave")][InlineData("attendance")][InlineData("school-home")]
    public void AKnownDestinationIsKeptWithItsEntity(string route)
    {
        var entity = Guid.NewGuid(); var destination = NotificationRules.Destination(route, entity);
        Assert.Equal(route, destination["route"]!.GetValue<string>());
        Assert.Equal(entity.ToString(), destination["entityId"]!.GetValue<string>());
        Assert.Equal(2, destination.Count);
    }

    [Theory]
    [InlineData(null)][InlineData("")][InlineData("/suite/fees")][InlineData("https://evil.example/")][InlineData("eduos://admin")][InlineData("javascript:alert(1)")][InlineData("NOTICES")]
    public void AnythingElseLeadsHomeAndCarriesNothing(string? route)
    {
        var destination = NotificationRules.Destination(route, null);
        Assert.Equal("home", destination["route"]!.GetValue<string>());
        Assert.Single(destination);
    }

    [Fact]
    public void RecipientsExcludeTheActorTheMutedAndDuplicates()
    {
        Assert.Equal(new[] { Ravi }, NotificationRules.Targets(new[] { Asha, Ravi, Ravi, Meera }, actor: Asha, muted: new[] { Meera }));
        Assert.Empty(NotificationRules.Targets(new[] { Asha }, actor: Asha, muted: Array.Empty<Guid>()));
        Assert.Equal(new[] { Asha, Ravi }, NotificationRules.Targets(new[] { Asha, Ravi }, actor: null, muted: Array.Empty<Guid>()));
        Assert.Empty(NotificationRules.Targets(Array.Empty<Guid>(), actor: null, muted: new[] { Asha }));
    }

    [Fact]
    public void ACircularReachesOnlyItsAudience()
    {
        Assert.Equal(new[] { "teacher" }, NotificationRules.AudienceScopes("Teacher"));
        Assert.Equal(new[] { "parent" }, NotificationRules.AudienceScopes("Parent"));
        Assert.Equal(new[] { "student" }, NotificationRules.AudienceScopes("Student"));
        Assert.Equal(new[] { "school", "teacher", "parent", "student" }, NotificationRules.AudienceScopes("All"));
        foreach (var unknown in new[] { null, "", "Everyone", "platform", "all" }) Assert.Empty(NotificationRules.AudienceScopes(unknown));
        Assert.DoesNotContain("platform", NotificationRules.AudienceScopes("All"));
    }

    [Fact]
    public void TextIsPlainAndBounded()
    {
        Assert.Equal("Sports day on Friday", NotificationRules.Clip("  Sports   day\n on\tFriday ", 200));
        Assert.Equal("", NotificationRules.Clip(null, 200));
        var clipped = NotificationRules.Clip(new string('a', 500), 200);
        Assert.Equal(200, clipped.Length);
        Assert.EndsWith("…", clipped);
    }
}

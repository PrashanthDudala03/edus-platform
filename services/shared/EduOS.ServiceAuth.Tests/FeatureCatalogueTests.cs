using System.Text.Json;
using EduOS.ServiceAuth;
using Xunit;

// Module availability is a view over the existing authority: the school's boundary and the account's effective
// permissions. These tests pin that it adds no decision of its own.
public class FeatureCatalogueTests
{
    static readonly string[] Catalogue = JsonSerializer.Deserialize<JsonElement[]>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "PermissionCatalogue.json")))!.Select(p => p.GetProperty("key").GetString()!).ToArray();
    static readonly string[] Everything = FeatureCatalogue.All.SelectMany(f => f.Permissions).ToArray();
    static FeatureState State(FeatureState[] states, string key) => states.Single(s => s.Key == key);

    [Fact]
    public void EveryFeatureIsMadeOfRealPermissionKeys()
    {
        Assert.Equal(new[] { "school-home", "notifications", "attendance", "homework", "results", "fees", "exams", "leave", "ai", "transport", "lms" }, FeatureCatalogue.All.Select(f => f.Key));
        foreach (var feature in FeatureCatalogue.All)
        {
            Assert.All(feature.Permissions, key => Assert.Contains(key, Catalogue));
            Assert.Equal(feature.Future, feature.Permissions.Length == 0);
            Assert.DoesNotContain(feature.Permissions, key => key.StartsWith("platform.") || key.StartsWith("billing.") || key == "ai.platform.manage");
        }
        Assert.Equal(Everything.Length, Everything.Distinct().Count());
        Assert.Throws<ArgumentException>(() => FeatureCatalogue.Keys("payroll"));
        Assert.Equal(new[] { "notifications.manage" }, FeatureCatalogue.Keys("notifications"));
    }

    [Fact]
    public void ASchoolHasAModuleOnlyWhenItsBoundaryHoldsOneOfItsKeys()
    {
        var states = FeatureCatalogue.Evaluate(["fees.view", "school-home.manage", "roles.view"], []);
        Assert.Equal(new[] { "school-home", "fees" }, states.Where(s => s.Enabled).Select(s => s.Key));
        Assert.All(FeatureCatalogue.Evaluate([], Everything), state => Assert.False(state.Enabled || state.Allowed));
    }

    [Fact]
    public void AnAccountUsesAModuleOnlyThroughItsOwnPermissions()
    {
        // A parent of a school that has everything: sees fees and homework, cannot touch exams or leave.
        var parent = FeatureCatalogue.Evaluate(Everything, ["fees.view", "homework.view", "reports.view"]);
        Assert.Equal((true, true), (State(parent, "fees").Enabled, State(parent, "fees").Allowed));
        Assert.Equal(new[] { "fees.view" }, State(parent, "fees").Permissions);
        Assert.Equal(new[] { "homework.view" }, State(parent, "homework").Permissions);
        foreach (var key in new[] { "exams", "leave", "attendance", "results", "ai" }) Assert.Equal((true, false), (State(parent, key).Enabled, State(parent, key).Allowed));
    }

    [Fact]
    public void ReadingSchoolHomeAndYourOwnNotificationsNeedsTheSchoolToHaveThemNotAPermission()
    {
        // The school has both; a parent holds neither manage permission: may view, may not manage.
        var parent = FeatureCatalogue.Evaluate(Everything, ["fees.view"]);
        foreach (var key in new[] { "school-home", "notifications" })
        {
            Assert.Equal((true, true), (State(parent, key).Enabled, State(parent, key).Allowed));
            Assert.Empty(State(parent, key).Permissions);
        }
        var administrator = FeatureCatalogue.Evaluate(Everything, ["notifications.manage", "school-home.manage"]);
        Assert.Equal(new[] { "notifications.manage" }, State(administrator, "notifications").Permissions);
        // The Super Admin took notifications out of this school's boundary: nobody has them, whatever a role lists.
        var without = FeatureCatalogue.Evaluate(Everything.Except(["notifications.manage"]), ["notifications.manage", "fees.view"]);
        Assert.Equal((false, false), (State(without, "notifications").Enabled, State(without, "notifications").Allowed));
        Assert.Empty(State(without, "notifications").Permissions);
        Assert.True(State(without, "school-home").Allowed);
    }

    [Fact]
    public void FutureModulesAreNeverAvailable()
    {
        foreach (var key in new[] { "transport", "lms" })
        {
            var state = State(FeatureCatalogue.Evaluate(Catalogue, Catalogue), key);
            Assert.Equal(("future", false, false), (state.Status, state.Enabled, state.Allowed));
        }
        Assert.All(FeatureCatalogue.Evaluate(Catalogue, Catalogue).Where(s => s.Status == "available"), state => Assert.True(state.Enabled && state.Allowed));
    }

    [Fact]
    public void TheAnswerCarriesOnlyWhatAClientNeeds()
    {
        var json = JsonSerializer.SerializeToNode(FeatureCatalogue.Evaluate(Everything, ["fees.view"]), new JsonSerializerOptions(JsonSerializerDefaults.Web))!.AsArray();
        Assert.All(json, item => Assert.Equal(new[] { "key", "name", "status", "enabled", "allowed", "permissions" }, item!.AsObject().Select(p => p.Key)));
    }
}

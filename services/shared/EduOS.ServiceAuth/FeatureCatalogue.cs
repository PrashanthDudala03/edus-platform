namespace EduOS.ServiceAuth;

/// <summary>
/// A product module as people know it, described by the permission keys that already gate it. Open means everyday use
/// needs no permission of its own (reading the published School Home, reading your own notifications): the school
/// having the module is enough. Future modules have no keys yet and are never enabled.
/// </summary>
public sealed record Feature(string Key, string Name, string[] Permissions, bool Open = false, bool Future = false);

/// <summary>What one account may do with a module. Derived on the server; a client only displays it.</summary>
public sealed record FeatureState(string Key, string Name, string Status, bool Enabled, bool Allowed, string[] Permissions);

/// <summary>
/// Module availability, read from the existing authority and nothing else: the school's boundary (set by the Super
/// Admin) says whether the school has a module; the account's effective permissions say what the person may do in it.
/// This is a view over the permission system, not a second one: it stores nothing and decides nothing new.
/// </summary>
public static class FeatureCatalogue
{
    public static readonly Feature[] All =
    [
        new("school-home", "School Home", ["school-home.manage"], Open: true),
        new("notifications", "Notifications", ["notifications.manage"], Open: true),
        new("attendance", "Attendance", ["attendance.view", "attendance.mark"]),
        new("homework", "Homework", ["homework.view", "homework.manage", "submissions.view", "submissions.manage"]),
        new("results", "Results", ["marks.view", "marks.manage"]),
        new("fees", "Fees", ["fees.view", "fees.manage", "fees.collect"]),
        new("exams", "Exams", ["exams.view", "exams.manage"]),
        new("leave", "Leave", ["leave-requests.view", "leave-requests.manage"]),
        new("ai", "AI assistant", ["ai.assistant.use", "ai.knowledge.manage", "ai.usage.view"]),
        new("transport", "Transport", [], Future: true),
        new("lms", "Learning management", [], Future: true),
    ];

    /// <summary>The permission keys whose presence in a school's boundary means the school has the module.</summary>
    public static string[] Keys(string feature) => All.FirstOrDefault(f => f.Key == feature)?.Permissions ?? throw new ArgumentException("Unknown feature.", nameof(feature));

    /// <summary>
    /// Enabled: the school's boundary holds one of the module's keys. Allowed: the school has it and either the module
    /// is open to every school account or the account holds one of its permissions. Permissions lists the ones held,
    /// so a client can tell reading from managing without re-deriving anything.
    /// </summary>
    public static FeatureState[] Evaluate(IEnumerable<string> boundary, IEnumerable<string> effective)
    {
        var school = boundary.ToHashSet(); var account = effective.ToHashSet();
        return All.Select(feature =>
        {
            var enabled = !feature.Future && feature.Permissions.Any(school.Contains);
            var held = enabled ? feature.Permissions.Where(account.Contains).ToArray() : [];
            return new FeatureState(feature.Key, feature.Name, feature.Future ? "future" : "available", enabled, enabled && (feature.Open || held.Length > 0), held);
        }).ToArray();
    }
}

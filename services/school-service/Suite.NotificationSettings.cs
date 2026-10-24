using System.Text.Json.Nodes;
using Npgsql;

public static partial class Suite
{
    static SchoolAccess NotificationSettingsManager(HttpContext http)
    {
        var a = HomeCaller(http);
        Require(http.User.FindFirst("data_scope")?.Value == "school" && a.Permissions.Contains("notifications.settings.manage"), "Your role cannot manage notification delivery.", 403);
        return a;
    }
    static bool DeliveryRisk(string key) => key is "circular.published" or "message.received";
    static void MapNotificationSettings(RouteGroupBuilder group)
    {
        group.MapGet("/settings", async (HttpContext http) =>
        {
            var a = NotificationSettingsManager(http); await using var c = await Open();
            var saved = await Q(c, "SELECT type,enabled,version FROM notify.school_settings WHERE school_id=@s", ("s", a.School));
            return Results.Ok(new { data = NotificationTemplates.All.Select(t => {
                var own = saved.FirstOrDefault(row => Text(row, "type") == t.Key);
                return new { key = t.Key, name = t.Name, description = t.Description, category = NotificationRules.Category(t.Key), implemented = t.Status == NotificationTemplates.Implemented,
                    enabled = own is null || Flag(own["enabled"]), version = own is null ? 0 : (int)Number(own, "version"), warning = DeliveryRisk(t.Key) };
            }) });
        });
        group.MapGet("/settings/history", async (HttpContext http) =>
        {
            var a = NotificationSettingsManager(http); await using var c = await Open();
            return Results.Ok(new { data = await Q(c, "SELECT type,enabled,actor_name AS actor,changed_at AS \"changedAt\" FROM notify.settings_history WHERE school_id=@s ORDER BY changed_at DESC,id DESC LIMIT 100", ("s", a.School)) });
        });
        group.MapPut("/settings/{key}", async (string key, JsonObject input, HttpContext http) =>
        {
            var a = NotificationSettingsManager(http); var template = Template(key);
            Require(template.Status == NotificationTemplates.Implemented, "This event is not available for delivery yet.", 409);
            Require(input["enabled"] is JsonValue flag && flag.TryGetValue<bool>(out _), "Enabled must be true or false.");
            Require(input["version"] is JsonValue v && v.TryGetValue<int>(out var value) && value >= 0, "A valid settings version is required.");
            var enabled = input["enabled"]!.GetValue<bool>(); var version = input["version"]!.GetValue<int>();
            Require(enabled || !DeliveryRisk(key) || input["confirmRisk"] is JsonValue risk && risk.TryGetValue<bool>(out var confirmed) && confirmed,
                "Confirm that urgent and acknowledgement-required alerts will also stop.", 409);
            await using var c = await Open(); await using var tx = await c.BeginTransactionAsync();
            var saved = await Q(c, """
                INSERT INTO notify.school_settings AS existing(school_id,type,enabled,version,updated_by)
                SELECT @s,@k,@e,1,@u WHERE @v=0 OR EXISTS(SELECT 1 FROM notify.school_settings WHERE school_id=@s AND type=@k)
                ON CONFLICT(school_id,type) DO UPDATE SET enabled=excluded.enabled,version=existing.version+1,updated_by=excluded.updated_by,updated_at=now()
                WHERE existing.version=@v RETURNING version
                """, ("s", a.School), ("k", key), ("e", enabled), ("u", a.User), ("v", version));
            Require(saved.Count == 1, "Settings changed by someone else. Reload and try again.", 409);
            await E(c, "INSERT INTO notify.settings_history(school_id,type,enabled,actor_id,actor_name) VALUES(@s,@k,@e,@u,@name)",
                ("s", a.School), ("k", key), ("e", enabled), ("u", a.User), ("name", await AccountName(c, a)));
            await tx.CommitAsync();
            return Results.Ok(new { message = enabled ? "School delivery enabled." : "School delivery disabled. Existing inbox items are kept." });
        });
    }
}

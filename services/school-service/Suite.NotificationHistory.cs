using EduOS.ServiceAuth;
using Npgsql;

// What EduOS sent in this school, for the people who manage notifications: which event, which wording, how many
// people, how many read it, and what each channel did with it. Read-only, bound to the school of the verified token,
// and limited to a school-scope role holding notifications.manage. It shows a recipient's name and kind of account
// and nothing else about them: no contact details, no account or device identifiers, and not the message text.
public static partial class Suite
{
    const int HistoryPage = 30;

    static void MapHistory(RouteGroupBuilder group)
    {
        group.MapGet("/history", async (HttpContext http, int page = 1, string? type = null) =>
        {
            Require(page is > 0 and < 100000, "Invalid page."); Require(type is null || NotificationRules.KnownType(type), "Unknown notification type.");
            await using var c = await Open(); var a = TemplateManager(http);
            var rows = await Q(c, """
                SELECT n.id,n.type,n.category,n.title,n.source,n.wording,n.wording_version AS "wordingVersion",n.created_at AS "createdAt",
                (SELECT count(*) FROM notify.recipients r WHERE r.notification_id=n.id AND r.school_id=@s) AS recipients,
                (SELECT count(*) FROM notify.recipients r WHERE r.notification_id=n.id AND r.school_id=@s AND r.read_at IS NOT NULL) AS read,
                (SELECT count(*) FROM notify.deliveries d WHERE d.notification_id=n.id AND d.school_id=@s AND d.status='failed') AS failed,
                (SELECT count(*) FROM notify.deliveries d WHERE d.notification_id=n.id AND d.school_id=@s AND d.status IN('pending','processing')) AS waiting
                FROM notify.notifications n WHERE n.school_id=@s AND (@type::text IS NULL OR n.type=@type)
                ORDER BY n.created_at DESC,n.id LIMIT @limit OFFSET @offset
                """, ("s", a.School), ("type", type), ("limit", HistoryPage), ("offset", (page - 1) * HistoryPage));
            foreach (var row in rows) row["template"] = NotificationTemplates.Find(Text(row, "type"))?.Name;
            var total = Number((await Q(c, "SELECT count(*) AS n FROM notify.notifications WHERE school_id=@s AND (@type::text IS NULL OR type=@type)", ("s", a.School), ("type", type)))[0], "n");
            return Results.Ok(new { data = new { items = rows, totalCount = total, page, pageSize = HistoryPage } });
        });
        // One notification: each recipient with their read state and what every channel did. Another school's
        // notification answers 404, the same as one that does not exist.
        group.MapGet("/history/{id:guid}", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = TemplateManager(http);
            var found = await Q(c, "SELECT id,type,category,title,source,wording,wording_version AS \"wordingVersion\",created_at AS \"createdAt\" FROM notify.notifications WHERE school_id=@s AND id=@id", ("s", a.School), ("id", id));
            Require(found.Count == 1, "Notification not found.", 404);
            var recipients = await Q(c, """
                SELECT u.first_name || ' ' || u.last_name AS name,t.data_scope AS scope,r.read_at IS NOT NULL AS read,d.channel,d.status,d.attempts,d.last_error AS "lastError",d.delivered_at AS "deliveredAt"
                FROM notify.recipients r JOIN auth_db.users u ON u.id=r.user_id AND u.school_id=r.school_id
                JOIN auth_db.roles ro ON ro.id=u.role_id JOIN auth_db.role_templates t ON t.id=ro.template_id
                LEFT JOIN notify.deliveries d ON d.notification_id=r.notification_id AND d.user_id=r.user_id AND d.school_id=r.school_id
                WHERE r.notification_id=@id AND r.school_id=@s ORDER BY name,d.channel LIMIT 500
                """, ("id", id), ("s", a.School));
            found[0]["template"] = NotificationTemplates.Find(Text(found[0], "type"))?.Name;
            return Results.Ok(new { data = new { notification = found[0], recipients } });
        });
    }
}

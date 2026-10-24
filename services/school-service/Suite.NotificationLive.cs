using EduOS.ServiceAuth;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Serilog;

// No client-callable send/join methods: membership comes exclusively from the verified session.
public sealed class SchoolNotificationHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        var identity = await Suite.NotificationLiveIdentity(Context.GetHttpContext()!);
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(identity.School, identity.User));
        await base.OnConnectedAsync();
    }
    public static string Group(Guid school, Guid user) => $"school:{school:N}:user:{user:N}";
}

public static partial class Suite
{
    static IHubContext<SchoolNotificationHub>? NotificationHub;
    public static async Task<(Guid School, Guid User)> NotificationLiveIdentity(HttpContext http)
    {
        await using var c = await Open(); var a = await Inbox(http, c); return (a.School, a.User);
    }
    static void MapNotificationLive(WebApplication app)
    {
        NotificationHub = app.Services.GetRequiredService<IHubContext<SchoolNotificationHub>>();
        // Header-authenticated long polling avoids credentials in URLs and fits the existing reverse proxies.
        app.MapHub<SchoolNotificationHub>("/api/notifications/live", options => {
            options.Transports = HttpTransportType.LongPolling;
            options.LongPolling.PollTimeout = TimeSpan.FromSeconds(20);
            options.CloseOnAuthenticationExpiration = true;
        }).RequireAuthorization(EduOSPolicies.Suite);
    }
    static async Task NotificationChanged(Guid school, IEnumerable<Guid> users, Guid? id = null)
    {
        if (NotificationHub is null) return;
        try {
            // Only an invalidation hint crosses the live connection. Content is fetched through the scoped inbox.
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await NotificationHub.Clients.Groups(users.Distinct().Select(user => SchoolNotificationHub.Group(school, user)).ToArray())
                .SendAsync("NotificationsChanged", new { id }, deadline.Token);
        } catch (Exception ex) { Log.Warning(ex, "Notification live hint failed; inbox polling will recover"); }
    }
}

using System.Text.Json.Nodes;
using Npgsql;
using Serilog;

/// <summary>One outbox row handed to a channel: who, where, and the final text. No contact detail beyond the channel's own target.</summary>
public sealed record DeliveryJob(Guid NotificationId, Guid School, Guid User, string Channel, string Target, string Title, string Body);
/// <summary>What a channel answers: delivered, failed but worth retrying, or failed for good (for example a target the provider no longer knows).</summary>
public sealed record DeliveryResult(bool Delivered, string? Error = null, bool Permanent = false)
{
    public static readonly DeliveryResult Success = new(true);
    public static DeliveryResult Retry(string error) => new(false, error, false);
    public static DeliveryResult Reject(string error) => new(false, error, true);
}
/// <summary>
/// The contract a delivery channel (push, email, SMS, WhatsApp) implements. None is registered in this release: the
/// worker exists, the outbox exists, and a channel can be added without changing the communication domain.
/// </summary>
public interface IDeliveryChannel
{
    string Channel { get; }
    Task<DeliveryResult> SendAsync(DeliveryJob job, CancellationToken cancellation);
}
/// <summary>The channels the worker can hand rows to, and the pure rule for what a channel's answer does to a row.</summary>
public static class DeliveryChannels
{
    static readonly Dictionary<string, IDeliveryChannel> registered = new();
    public const int Batch = 50;
    public const string NoProvider = "No provider is configured for this channel.";
    /// <summary>Only a reserved outside channel can be registered; in-app is delivered by being stored and never leaves the database.</summary>
    public static void Register(IDeliveryChannel channel)
    {
        if (channel.Channel == "in-app" || !NotificationRules.Channels.Contains(channel.Channel)) throw new ArgumentException("Unknown delivery channel.", nameof(channel));
        registered[channel.Channel] = channel;
    }
    public static IDeliveryChannel? For(string channel) => registered.GetValueOrDefault(channel);
    public static IReadOnlyCollection<string> Registered => registered.Keys;
    /// <summary>The row after the channel answered. No channel at all is a permanent failure: the row stops, is counted, and is never retried.</summary>
    public static Delivery Outcome(Delivery claimed, DeliveryResult? result, DateTimeOffset now) =>
        result is null ? DeliveryRules.Failed(claimed, NoProvider, true, now)
        : result.Delivered ? DeliveryRules.Succeeded(claimed, now)
        : DeliveryRules.Failed(claimed, result.Error, result.Permanent, now);
    /// <summary>What a reader who does not manage notifications may see of a failure: that it failed, never the provider's words.</summary>
    public static string Shown(string? lastError, bool manager) => lastError is null ? "" : manager ? lastError : "Delivery failed.";
}

// The delivery worker: claims due outbox rows school by school, hands each to its channel and stores the result by
// DeliveryRules. Claims use FOR UPDATE SKIP LOCKED, so several instances never send the same row twice; a claim left
// behind by a stopped instance becomes due again after the lease. In-app rows are written delivered and never come here.
public static partial class Suite
{
    static async Task DeliverDue(CancellationToken stopping)
    {
        await using var c = await Open();
        foreach (var row in await Q(c, "SELECT id FROM school_db.schools"))
        {
            if (stopping.IsCancellationRequested) return;
            await DeliverDueFor(c, Guid.Parse(Text(row, "id")), stopping);
        }
    }
    static async Task DeliverDueFor(NpgsqlConnection c, Guid school, CancellationToken stopping)
    {
        List<JsonObject> claimed;
        await using (var tx = await c.BeginTransactionAsync())
        {
            claimed = await Q(c, """
                UPDATE notify.deliveries d SET status='processing',next_attempt_at=NULL,updated_at=now()
                FROM (SELECT notification_id,user_id,channel,target FROM notify.deliveries WHERE school_id=@s
                      AND (status IN('pending','failed') AND next_attempt_at<=now() OR status='processing' AND updated_at<=now()-@lease)
                      ORDER BY next_attempt_at NULLS FIRST LIMIT @n FOR UPDATE SKIP LOCKED) due
                WHERE d.school_id=@s AND d.notification_id=due.notification_id AND d.user_id=due.user_id AND d.channel=due.channel AND d.target=due.target
                RETURNING d.notification_id AS notification,d.user_id AS person,d.channel,d.target,d.attempts,d.last_error AS error
                """, ("s", school), ("lease", DeliveryRules.Lease), ("n", DeliveryChannels.Batch));
            await tx.CommitAsync();
        }
        foreach (var row in claimed)
        {
            var notification = Guid.Parse(Text(row, "notification")); var channel = Text(row, "channel"); var provider = DeliveryChannels.For(channel);
            var text = (await Q(c, "SELECT title,body FROM notify.notifications WHERE school_id=@s AND id=@id", ("s", school), ("id", notification))).FirstOrDefault();
            DeliveryResult? result = null;
            if (provider is not null && text is not null)
            {
                try { result = await provider.SendAsync(new DeliveryJob(notification, school, Guid.Parse(Text(row, "person")), channel, Text(row, "target"), Text(text, "title"), Text(text, "body")), stopping); }
                catch (Exception ex) { Log.Warning(ex, "Channel {Channel} failed for notification {Id}", channel, notification); result = DeliveryResult.Retry(ex.GetType().Name); }
            }
            var after = DeliveryChannels.Outcome(new Delivery("processing", (int)Number(row, "attempts"), Text(row, "error"), null, null), result, DateTimeOffset.UtcNow);
            await E(c, "UPDATE notify.deliveries SET status=@st,attempts=@at,last_error=@err,next_attempt_at=@next,delivered_at=@done,updated_at=now() WHERE school_id=@s AND notification_id=@id AND user_id=@u AND channel=@ch AND target=@t",
                ("st", after.Status), ("at", after.Attempts), ("err", after.LastError), ("next", after.NextAttemptAt), ("done", after.DeliveredAt), ("s", school), ("id", notification), ("u", Guid.Parse(Text(row, "person"))), ("ch", channel), ("t", Text(row, "target")));
        }
    }
}

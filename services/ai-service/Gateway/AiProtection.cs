using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;

namespace EduOS.Ai.Gateway;

/// <summary>Service protection, bound from "Ai:Limits". This is not a school's AI allowance; that is the quota.</summary>
public sealed class AiLimitsOptions
{
    public const string Section = "Ai:Limits";
    public int UserRequestsPerMinute { get; set; } = 10;
    public int SchoolRequestsPerMinute { get; set; } = 300;
    /// <summary>Consecutive provider failures that open the circuit.</summary>
    public int ProviderFailureThreshold { get; set; } = 5;
    /// <summary>How long the circuit stays open before one trial call is allowed.</summary>
    public int ProviderRecoverySeconds { get; set; } = 30;

    public static string? Problem(AiLimitsOptions o) =>
        o.UserRequestsPerMinute is < 1 or > 600 ? "Ai:Limits:UserRequestsPerMinute must be between 1 and 600." :
        o.SchoolRequestsPerMinute is < 1 or > 60000 ? "Ai:Limits:SchoolRequestsPerMinute must be between 1 and 60000." :
        o.ProviderFailureThreshold is < 1 or > 100 ? "Ai:Limits:ProviderFailureThreshold must be between 1 and 100." :
        o.ProviderRecoverySeconds is < 1 or > 3600 ? "Ai:Limits:ProviderRecoverySeconds must be between 1 and 3600." : null;
}

/// <summary>
/// Requests per user and per school in fixed one-minute windows, counted from the verified token.
/// The counters live in this process only: with more than one ai-service instance each instance enforces its
/// own limit, so a multi-instance deployment needs a shared store or an equivalent limit at the gateway.
/// </summary>
public sealed class AiRateLimiter(TimeProvider clock, IOptions<AiLimitsOptions> options)
{
    /// <summary>Upper bound on identities tracked within one window. Beyond it, new identities are refused.</summary>
    public const int MaxTracked = 50_000;
    readonly Dictionary<string, int> counts = [];
    readonly object gate = new();
    long window = long.MinValue;

    public int Tracked { get { lock (gate) return counts.Count; } }

    /// <returns>0 when the request is admitted; otherwise the seconds until the current window ends.</returns>
    public int Admit(TenantContext tenant)
    {
        var seconds = clock.GetUtcNow().ToUnixTimeSeconds();
        var current = seconds / 60;
        lock (gate)
        {
            // Only identities seen in the current minute are kept, so the state cannot grow over time.
            if (current != window) { counts.Clear(); window = current; }
            var user = "u:" + tenant.UserId; var school = "s:" + tenant.SchoolId;
            var known = (counts.TryGetValue(user, out var byUser) ? 1 : 0) + (counts.TryGetValue(school, out var bySchool) ? 1 : 0);
            if (byUser >= options.Value.UserRequestsPerMinute || bySchool >= options.Value.SchoolRequestsPerMinute || counts.Count + 2 - known > MaxTracked)
                return (int)(60 - seconds % 60);
            // A refused request counts against neither limit.
            counts[user] = byUser + 1; counts[school] = bySchool + 1;
            return 0;
        }
    }
}

/// <summary>
/// Stops calls to a provider that keeps failing. A failure is any <see cref="Providers.AiProviderException"/>
/// (timeout, unavailable or invalid response); a success resets the count. Rejected, unauthorized, rate-limited
/// and caller-cancelled requests never reach a provider and are never counted. After the threshold the circuit
/// is open for the recovery interval; then one trial call is let through, which closes the circuit on success
/// and reopens it for a full interval on failure. State is per provider name and per process.
/// </summary>
public sealed class AiCircuitBreaker(TimeProvider clock, IOptions<AiLimitsOptions> options, ILogger<AiCircuitBreaker> logger)
{
    sealed class State { public int Failures; public DateTimeOffset OpenUntil; }
    readonly Dictionary<string, State> providers = [];
    readonly object gate = new();

    public bool IsOpen(string provider)
    {
        lock (gate) return providers.TryGetValue(provider, out var state) && state.Failures >= options.Value.ProviderFailureThreshold && clock.GetUtcNow() < state.OpenUntil;
    }

    /// <summary>False while open. When the interval has passed, the first caller gets the trial and the circuit is re-armed, so concurrent callers still fail fast.</summary>
    public bool Allow(string provider)
    {
        lock (gate)
        {
            if (!providers.TryGetValue(provider, out var state) || state.Failures < options.Value.ProviderFailureThreshold) return true;
            var now = clock.GetUtcNow();
            if (now < state.OpenUntil) return false;
            state.OpenUntil = now.AddSeconds(options.Value.ProviderRecoverySeconds);
            return true;
        }
    }

    public void Succeeded(string provider) { lock (gate) providers.Remove(provider); }

    public void Failed(string provider)
    {
        lock (gate)
        {
            if (!providers.TryGetValue(provider, out var state)) providers[provider] = state = new State();
            state.Failures = Math.Min(state.Failures + 1, options.Value.ProviderFailureThreshold);
            if (state.Failures < options.Value.ProviderFailureThreshold) return;
            state.OpenUntil = clock.GetUtcNow().AddSeconds(options.Value.ProviderRecoverySeconds);
        }
        logger.LogWarning("AI provider {Provider} circuit is open for {Seconds}s after repeated failures", provider, options.Value.ProviderRecoverySeconds);
    }
}

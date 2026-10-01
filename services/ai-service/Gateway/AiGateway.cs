using System.Diagnostics;
using EduOS.Ai.Providers;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;

namespace EduOS.Ai.Gateway;

/// <summary>Limits for the assistant, bound from "Ai:Assistant".</summary>
public sealed class AiAssistantOptions
{
    public const string Section = "Ai:Assistant";
    public int MaxQuestionChars { get; set; } = 2000;
    /// <summary>The most the assistant may generate per answer. A model with a lower limit lowers it further.</summary>
    public int MaxOutputTokens { get; set; } = 256;
}

/// <summary>Everything a caller may send. There is no school, history or model choice to supply.</summary>
public sealed record AssistantAsk(string? Question, int? MaxOutputTokens = null);

/// <summary>Exactly one of Invalid, Unavailable and Response is set.</summary>
public sealed record AssistantOutcome(string? Invalid, string? Unavailable, ModelResponse? Response, int? RetryAfterSeconds = null)
{
    public static AssistantOutcome Rejected(string message) => new(message, null, null);
    public static AssistantOutcome Off(string reason) => new(null, reason, null);
    public static AssistantOutcome Limited(int retryAfterSeconds) => new(null, "rate-limited", null, retryAfterSeconds);
    public static AssistantOutcome Answered(ModelResponse response) => new(null, null, response);
}

/// <summary>
/// The path every AI request takes after EduOS has authenticated the caller and checked the permission:
/// feature state, rate limit, bounded request, school switch and quota, circuit breaker, provider, usage record,
/// safe result. It reads no school business data, and it neither logs nor stores the question or the answer.
/// </summary>
public sealed class AiGateway(IOptions<AiOptions> ai, IOptions<AiAssistantOptions> assistant, IOptions<AiProviderOptions> providers, AiDatabaseState database,
    IModelProvider model, AiRateLimiter limiter, AiCircuitBreaker breaker, IAiUsageStore usage, ILogger<AiGateway> logger)
{
    public const string SystemPrompt = "You are the EduOS school assistant. Answer briefly. If you do not know, say so.";
    const string Feature = "assistant.ask";

    /// <summary>Null when the deployment can serve the assistant; otherwise why it cannot.</summary>
    public string? Unavailable() =>
        !ai.Value.Enabled || !database.Configured ? "not-configured" : !database.Ready ? "database-unavailable"
        : breaker.IsOpen(model.Descriptor.Provider) ? "provider-unavailable" : null;

    /// <summary>The caller's school: its switch, allowance and usage this month. Null with a reason when it cannot be determined.</summary>
    public async Task<(AiUsageSummary? Summary, string? Reason)> Usage(TenantContext tenant, CancellationToken cancellation)
    {
        if (!ai.Value.Enabled || !database.Configured) return (null, "not-configured");
        if (!database.Ready) return (null, "database-unavailable");
        try { return (await usage.Summary(tenant, cancellation), null); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("AI usage state could not be read ({Error})", ex.GetType().Name);
            return (null, "database-unavailable");
        }
    }

    /// <summary>Why the assistant is unavailable to this caller, including the school's own switch and allowance; null when it is available.</summary>
    public async Task<string?> UnavailableFor(TenantContext tenant, CancellationToken cancellation)
    {
        if (Unavailable() is string reason) return reason;
        var (summary, problem) = await Usage(tenant, cancellation);
        return problem ?? (!summary!.Enabled ? "school-disabled" : summary.TokensRemaining <= 0 ? "quota-exceeded" : null);
    }

    /// <param name="tenant">From the verified token. The user and school it names are the only identities used for limits, quota and usage.</param>
    public async Task<AssistantOutcome> Ask(TenantContext tenant, AssistantAsk ask, CancellationToken cancellation)
    {
        if (Unavailable() is string reason) return AssistantOutcome.Off(reason);
        if (limiter.Admit(tenant) is > 0 and var wait) return AssistantOutcome.Limited(wait);

        var limits = model.Descriptor.Capabilities;
        var question = ask.Question?.Trim() ?? "";
        if (question.Length == 0 || question.Length > assistant.Value.MaxQuestionChars)
            return AssistantOutcome.Rejected($"Enter a question of at most {assistant.Value.MaxQuestionChars} characters.");
        var cap = Math.Min(assistant.Value.MaxOutputTokens, limits.MaxOutputTokens);
        var output = ask.MaxOutputTokens ?? cap;
        if (output < 1 || output > cap)
            return AssistantOutcome.Rejected($"maxOutputTokens must be between 1 and {cap}.");
        var input = AiTokens.Estimate(SystemPrompt) + AiTokens.Estimate(question);
        if (input > limits.MaxInputTokens)
            return AssistantOutcome.Rejected("The question is too long for the assistant.");

        // One instruction and one question: no history is accepted or kept, so a conversation cannot grow the context.
        // Later tasks choose the model here (routing) and add retrieved text or tool results within the same budget.
        var request = new ModelRequest([new ChatMessage(ChatRole.System, SystemPrompt), new ChatMessage(ChatRole.User, question)], output);

        // School switch and allowance, decided before any model work. The worst case of this call (the input plus the
        // whole output limit) is held, so simultaneous requests cannot spend the same allowance twice. If the state
        // cannot be read, the request is refused.
        AiReservation reservation;
        try { reservation = await usage.Reserve(tenant, input + output, TimeSpan.FromSeconds(providers.Value.TimeoutSeconds + 30), cancellation); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("AI usage state could not be read ({Error}); the request was refused", ex.GetType().Name);
            return AssistantOutcome.Off("database-unavailable");
        }
        if (reservation.Admission == AiAdmission.SchoolDisabled) return AssistantOutcome.Off("school-disabled");
        if (reservation.Admission == AiAdmission.QuotaExceeded) return AssistantOutcome.Off("quota-exceeded");

        var provider = model.Descriptor.Provider;
        // Only a request that is about to call the provider can take the trial slot of an open circuit.
        if (!breaker.Allow(provider))
        {
            await Settle(tenant, reservation.Id, null);
            return AssistantOutcome.Off("provider-unavailable");
        }
        var clock = Stopwatch.StartNew();
        try
        {
            var response = await model.Complete(request, cancellation);
            breaker.Succeeded(provider);
            var used = response.Usage!;
            // The call has happened, so it is recorded even if the caller has gone away. An answer whose usage
            // cannot be recorded is not returned: the school is never served outside its accounted allowance.
            if (!await Settle(tenant, reservation.Id, new AiUsageRecord(Feature, response.Provider, response.Model, used.InputTokens, used.OutputTokens, used.Estimated, (int)response.Latency.TotalMilliseconds, true)))
            {
                logger.LogError("AI usage was not recorded for school {School}: {Provider} {Model}, {Input} input and {Output} output tokens", tenant.SchoolId, response.Provider, response.Model, used.InputTokens, used.OutputTokens);
                return AssistantOutcome.Off("database-unavailable");
            }
            return AssistantOutcome.Answered(response);
        }
        catch (AiProviderException ex)
        {
            breaker.Failed(provider);
            // A failed attempt is recorded with what was sent, but it is not charged against the allowance.
            await Settle(tenant, reservation.Id, new AiUsageRecord(Feature, provider, model.Descriptor.Model, input, 0, true, (int)clock.ElapsedMilliseconds, false, ex.Error.ToString()));
            logger.LogWarning("AI provider {Provider} failed for {Feature}: {Error}", ex.Provider, Feature, ex.Error);
            return AssistantOutcome.Off(ex.Error == AiProviderError.Timeout ? "provider-timeout" : "provider-unavailable");
        }
        catch (OperationCanceledException)
        {
            await Settle(tenant, reservation.Id, null);
            throw;
        }
    }

    // Never cancelled with the request, and never throws: a reservation that cannot be removed simply expires.
    async Task<bool> Settle(TenantContext tenant, Guid reservation, AiUsageRecord? record)
    {
        try { await usage.Settle(tenant, reservation, record, CancellationToken.None); return true; }
        catch (Exception ex)
        {
            logger.LogWarning("AI usage could not be written ({Error})", ex.GetType().Name);
            return false;
        }
    }
}

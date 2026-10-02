using System.Diagnostics;
using EduOS.Ai.Knowledge;
using System.Text.Json;
using EduOS.Ai.Providers;
using EduOS.Ai.Tools;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;

namespace EduOS.Ai.Gateway;

/// <summary>Limits for the assistant, bound from "Ai:Assistant".</summary>
public sealed class AiAssistantOptions
{
    public const string Section = "Ai:Assistant";
    /// <summary>The retrieval limit on a query (Ai:Retrieval:MaxQueryChars) applies as well; the lower one wins.</summary>
    public int MaxQuestionChars { get; set; } = 1000;
    /// <summary>The most the assistant may generate per answer. A model with a lower limit lowers it further.</summary>
    public int MaxOutputTokens { get; set; } = 256;
    /// <summary>The most one request may cost: its input and the output it asks for together. It bounds the reference material and the allowance one request can hold.</summary>
    public int MaxRequestTokens { get; set; } = 4096;

    public static string? Problem(AiAssistantOptions o) =>
        o.MaxQuestionChars is < 1 or > 8000 || o.MaxOutputTokens is < 1 or > 4096 ? "Ai:Assistant:MaxQuestionChars must be 1 to 8000 and Ai:Assistant:MaxOutputTokens 1 to 4096."
        : o.MaxRequestTokens <= o.MaxOutputTokens || o.MaxRequestTokens > 200000 ? "Ai:Assistant:MaxRequestTokens must be more than Ai:Assistant:MaxOutputTokens and at most 200000." : null;
}

/// <summary>Everything a caller may send. There is no school, audience, document, history or model choice to supply.</summary>
public sealed record AssistantAsk(string? Question, int? MaxOutputTokens = null);

/// <summary>Exactly one of Invalid, Unavailable and Response is set. Sources accompany a response and are the service's own record of the evidence.</summary>
/// <param name="Kind">What a response is based on: the school's documents, live EduOS data, general knowledge, or the assistant's own fixed words.</param>
public sealed record AssistantOutcome(string? Invalid, string? Unavailable, ModelResponse? Response, int? RetryAfterSeconds = null, IReadOnlyList<AssistantSource>? Sources = null, string Kind = AssistantRouter.School)
{
    public static AssistantOutcome Rejected(string message) => new(message, null, null);
    public static AssistantOutcome Off(string reason) => new(null, reason, null);
    public static AssistantOutcome Limited(int retryAfterSeconds) => new(null, "rate-limited", null, retryAfterSeconds);
    public static AssistantOutcome Answered(ModelResponse response, IReadOnlyList<AssistantSource> sources, string kind = AssistantRouter.School) => new(null, null, response, null, sources, kind);
    /// <summary>Words of the service itself: no model was called and nothing is metered.</summary>
    public static AssistantOutcome Said(string text, string kind = AssistantRouter.Assistant, params AssistantSource[] sources) =>
        new(null, null, new ModelResponse("eduos", "", text, FinishReason.Completed, new TokenUsage(0, 0, false)), null, sources, kind);
}

/// <summary>
/// The path every AI request takes after EduOS has authenticated the caller and checked the permission:
/// feature state, rate limit, bounded request, retrieval of the school's knowledge for this reader, bounded
/// context, school switch and quota, circuit breaker, provider, usage record, safe result. The only school data it
/// handles is the knowledge retrieval returns, and it neither logs nor stores the question, the context or the answer.
/// </summary>
public sealed class AiGateway(IOptions<AiOptions> ai, IOptions<AiAssistantOptions> assistant, IOptions<AiRetrievalOptions> retrieval, IOptions<AiProviderOptions> providers, AiDatabaseState database,
    IModelProvider model, KnowledgeRetriever retriever, AiToolRegistry tools, AiRateLimiter limiter, AiCircuitBreaker breaker, IAiUsageStore usage, TimeProvider clock, ILogger<AiGateway> logger)
{
    public const string SystemPrompt = RagContextBuilder.Instruction;
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

    /// <param name="tenant">From the verified token. The user and school it names are the only identities used for limits, retrieval, quota and usage.</param>
    /// <param name="audience">The caller's data scope from the verified token. It decides which of the school's documents may be used.</param>
    /// <param name="caller">The caller with the token to forward, for live EduOS data. Without it no tool is run.</param>
    public async Task<AssistantOutcome> Ask(TenantContext tenant, string audience, AssistantAsk ask, CancellationToken cancellation, ToolCaller? caller = null)
    {
        if (!ai.Value.Enabled || !database.Configured) return AssistantOutcome.Off("not-configured");
        if (!database.Ready) return AssistantOutcome.Off("database-unavailable");
        // Every kind of question counts towards the same limit, whatever answers it.
        if (limiter.Admit(tenant) is > 0 and var wait) return AssistantOutcome.Limited(wait);

        var limits = model.Descriptor.Capabilities;
        var question = ask.Question?.Trim() ?? "";
        var longest = Math.Min(assistant.Value.MaxQuestionChars, retrieval.Value.MaxQueryChars);
        if (question.Length == 0 || question.Length > longest)
            return AssistantOutcome.Rejected($"Enter a question of at most {longest} characters.");
        var cap = Math.Min(assistant.Value.MaxOutputTokens, limits.MaxOutputTokens);
        var output = ask.MaxOutputTokens ?? cap;
        if (output < 1 || output > cap)
            return AssistantOutcome.Rejected($"maxOutputTokens must be between 1 and {cap}.");
        var budget = RagContextBuilder.InputBudget(limits.MaxInputTokens, assistant.Value.MaxRequestTokens, output);
        if (AiTokens.Estimate(SystemPrompt) + AiTokens.Estimate(question) > budget)
            return AssistantOutcome.Rejected("The question is too long for the assistant.");

        // What kind of question this is, by fixed rules. Greetings, questions about the assistant and live figures
        // need no model; everything else goes to the school's documents first.
        var route = AssistantRouter.Route(question, DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime));
        if (route.Kind != AssistantRouteKind.Knowledge) return await Direct(tenant, audience, route, caller, cancellation);
        if (breaker.IsOpen(model.Descriptor.Provider)) return AssistantOutcome.Off("provider-unavailable");

        // The school's knowledge for this reader, found before any allowance is held. Nothing in the request can
        // change the school or the audience. Finding nothing is an answer in itself; a failure is reported as one.
        // In neither case is the model asked: it is never left to answer about the school without evidence.
        var retrieved = await retriever.Retrieve(tenant, audience, question, null, cancellation);
        if (retrieved.Invalid is string problem) return AssistantOutcome.Rejected(problem);
        if (retrieved.Unavailable is string off)
            // The embedding provider is not the model: its failures are reported as retrieval, and they leave the model's circuit alone.
            return AssistantOutcome.Off(off is "provider-timeout" or "provider-unavailable" or "embedding-unavailable" ? "retrieval-unavailable" : off);
        ModelRequest request; int input, chunks = 0; IReadOnlyList<AssistantSource> sources = []; var kind = AssistantRouter.School;
        if (retrieved.Chunks.Count == 0)
        {
            // Nothing in the school's documents. Only a request to explain or produce study material that names
            // nothing of a school is answered from general knowledge, and it is labelled as such. Anything else
            // about the school is never left to a model without evidence.
            if (!AssistantRouter.LooksGeneral(question))
            {
                logger.LogInformation("AI {Feature}: no relevant knowledge, so no model call", Feature);
                return AssistantOutcome.Off("insufficient-knowledge");
            }
            input = AiTokens.Estimate(AssistantReplies.GeneralInstruction) + AiTokens.Estimate(question);
            if (input > budget) return AssistantOutcome.Rejected("The question is too long for the assistant.");
            request = new ModelRequest([new ChatMessage(ChatRole.System, AssistantReplies.GeneralInstruction), new ChatMessage(ChatRole.User, question)], output);
            kind = AssistantRouter.General;
        }
        else
        {
            // One instruction, the evidence and one question: no history is accepted or kept, so a conversation cannot
            // grow the context. Chunks that do not fit the budget are left out whole.
            if (RagContextBuilder.Build(question, retrieved.Chunks, budget) is not { } context)
                return AssistantOutcome.Rejected("The question is too long for the assistant.");
            (request, input, chunks, sources) = (new ModelRequest(context.Messages, output), context.InputTokens, context.Chunks, context.Sources);
        }

        // School switch and allowance, decided before any model work. The worst case of this call (the final input
        // plus the whole output limit) is held, so simultaneous requests cannot spend the same allowance twice. If
        // the state cannot be read, the request is refused.
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
        var timer = Stopwatch.StartNew();
        try
        {
            var response = await model.Complete(request, cancellation);
            breaker.Succeeded(provider);
            var used = response.Usage!;
            // The call has happened, so it is recorded even if the caller has gone away. An answer whose usage
            // cannot be recorded is not returned: the school is never served outside its accounted allowance.
            if (!await Settle(tenant, reservation.Id, new AiUsageRecord(Feature, response.Provider, response.Model, used.InputTokens, used.OutputTokens, used.Estimated, (int)response.Latency.TotalMilliseconds, true, RetrievedChunks: chunks)))
            {
                logger.LogError("AI usage was not recorded for school {School}: {Provider} {Model}, {Input} input and {Output} output tokens", tenant.SchoolId, response.Provider, response.Model, used.InputTokens, used.OutputTokens);
                return AssistantOutcome.Off("database-unavailable");
            }
            logger.LogInformation("AI {Feature}: answered from {Chunks} chunks of {Sources} sources, {Input} input and {Output} output tokens, {Milliseconds} ms, {Provider} {Model}",
                Feature, chunks, sources.Count, used.InputTokens, used.OutputTokens, (int)response.Latency.TotalMilliseconds, response.Provider, response.Model);
            // The sources are the ones the reference material held, whatever the model wrote.
            return AssistantOutcome.Answered(response, sources, kind);
        }
        catch (AiProviderException ex)
        {
            breaker.Failed(provider);
            // A failed attempt is recorded with what was sent, but it is not charged against the allowance.
            await Settle(tenant, reservation.Id, new AiUsageRecord(Feature, provider, model.Descriptor.Model, input, 0, true, (int)timer.ElapsedMilliseconds, false, ex.Error.ToString(), RetrievedChunks: chunks));
            logger.LogWarning("AI provider {Provider} failed for {Feature}: {Error}", ex.Provider, Feature, ex.Error);
            return AssistantOutcome.Off(ex.Error == AiProviderError.Timeout ? "provider-timeout" : "provider-unavailable");
        }
        catch (OperationCanceledException)
        {
            await Settle(tenant, reservation.Id, null);
            throw;
        }
    }

    // Answers that need no model. Live figures come from one registered tool, run once through the registry, which
    // checks the caller's permission, the arguments and the school itself and forwards the caller's own token.
    // The figures are put into fixed words here; they are never given to a model.
    async Task<AssistantOutcome> Direct(TenantContext tenant, string audience, AssistantRoute route, ToolCaller? caller, CancellationToken cancellation)
    {
        if (route.Kind == AssistantRouteKind.Tool && caller is not null)
        {
            var result = await tools.Execute(caller, route.Tool, route.Arguments is null ? null : JsonSerializer.SerializeToElement(route.Arguments), cancellation);
            if (result.Status is ToolResult.NotConfigured or ToolResult.DatabaseUnavailable or ToolResult.SchoolDisabled) return AssistantOutcome.Off(result.Status);
            return result.Status == ToolResult.Ok
                ? AssistantOutcome.Said(AssistantReplies.ForTool(result.Tool, result.Data!, audience is "parent" or "student", route), AssistantRouter.Live, AssistantReplies.Source(result.Tool))
                : AssistantOutcome.Said(AssistantReplies.ForFailure(result.Status));
        }
        // Fixed words still follow the school's own switch.
        try { if (!(await usage.Summary(tenant, cancellation)).Enabled) return AssistantOutcome.Off("school-disabled"); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("AI usage state could not be read ({Error}); the request was refused", ex.GetType().Name);
            return AssistantOutcome.Off("database-unavailable");
        }
        var offered = caller is null ? [] : tools.Offered(caller);
        return AssistantOutcome.Said(route.Kind switch
        {
            AssistantRouteKind.Greeting => AssistantReplies.Greeting(offered), AssistantRouteKind.Thanks => AssistantReplies.Thanks, AssistantRouteKind.Farewell => AssistantReplies.Farewell,
            AssistantRouteKind.Identity => AssistantReplies.Identity(offered), AssistantRouteKind.Personal => AssistantReplies.Personal, _ => AssistantReplies.NoAccess,
        });
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

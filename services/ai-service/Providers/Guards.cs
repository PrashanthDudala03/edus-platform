using System.Diagnostics;

namespace EduOS.Ai.Providers;

// Every provider the platform uses is wrapped in these, so limits, timeouts, usage and failure handling
// behave the same whichever vendor is behind the interface.

static class ProviderCall
{
    public static async Task<(T Result, TimeSpan Latency)> Run<T>(string provider, TimeSpan timeout, CancellationToken cancellation, Func<CancellationToken, Task<T>> call)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        limit.CancelAfter(timeout);
        var clock = Stopwatch.StartNew();
        try
        {
            // WaitAsync ends the wait even if the provider ignores the token.
            var result = await call(limit.Token).WaitAsync(limit.Token);
            return (result, clock.Elapsed);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (OperationCanceledException ex) { throw new AiProviderException(provider, AiProviderError.Timeout, ex); }
        catch (AiProviderException) { throw; }
        catch (Exception ex) { throw new AiProviderException(provider, AiProviderError.Unavailable, ex); }
    }
}

public sealed class GuardedModelProvider(IModelProvider inner, TimeSpan timeout) : IModelProvider
{
    public ModelDescriptor Descriptor => inner.Descriptor;

    public async Task<ModelResponse> Complete(ModelRequest request, CancellationToken cancellation)
    {
        var limits = Descriptor.Capabilities;
        if (request.Messages is not { Count: > 0 } || request.Messages.Any(m => m is null || string.IsNullOrWhiteSpace(m.Content)))
            throw new ArgumentException("A model request needs at least one message, and no message may be empty.", nameof(request));
        if (request.MaxOutputTokens < 1 || request.MaxOutputTokens > limits.MaxOutputTokens)
            throw new ArgumentException($"The output limit must be between 1 and {limits.MaxOutputTokens} tokens for this model.", nameof(request));
        if (!(request.Temperature >= 0 && request.Temperature <= 2))
            throw new ArgumentException("Temperature must be between 0 and 2.", nameof(request));
        var input = request.Messages.Sum(m => AiTokens.Estimate(m.Content));
        if (input > limits.MaxInputTokens)
            throw new ArgumentException($"The context is about {input} tokens; this model accepts {limits.MaxInputTokens}.", nameof(request));

        var (response, latency) = await ProviderCall.Run(Descriptor.Provider, timeout, cancellation, token => inner.Complete(request, token));
        if (response?.Text is null || response.Provider != Descriptor.Provider || string.IsNullOrWhiteSpace(response.Model)
            || response.Usage is { InputTokens: < 0 } or { OutputTokens: < 0 })
            throw new AiProviderException(Descriptor.Provider, AiProviderError.InvalidResponse);
        return response with { Latency = latency, Usage = response.Usage ?? new TokenUsage(input, AiTokens.Estimate(response.Text), true) };
    }
}

public sealed class GuardedEmbeddingProvider(IEmbeddingProvider inner, TimeSpan timeout) : IEmbeddingProvider
{
    public EmbeddingDescriptor Descriptor => inner.Descriptor;

    public async Task<EmbeddingResponse> Embed(IReadOnlyList<string> texts, CancellationToken cancellation)
    {
        var limits = Descriptor;
        if (texts is not { Count: > 0 } || texts.Count > limits.MaxBatchSize)
            throw new ArgumentException($"Embed between 1 and {limits.MaxBatchSize} texts at a time.", nameof(texts));
        if (texts.Any(string.IsNullOrWhiteSpace) || texts.Any(t => AiTokens.Estimate(t) > limits.MaxInputTokens))
            throw new ArgumentException($"Each text must be non-empty and at most about {limits.MaxInputTokens} tokens.", nameof(texts));

        var (response, latency) = await ProviderCall.Run(limits.Provider, timeout, cancellation, token => inner.Embed(texts, token));
        // A vector of the wrong size or count would corrupt whatever stores it, so it is refused here.
        if (response?.Vectors is null || response.Provider != limits.Provider || string.IsNullOrWhiteSpace(response.Model)
            || response.Vectors.Count != texts.Count || response.Vectors.Any(v => v is null || v.Length != limits.Dimension || !v.All(float.IsFinite))
            || response.Usage is { InputTokens: < 0 })
            throw new AiProviderException(limits.Provider, AiProviderError.InvalidResponse);
        return response with { Latency = latency, Usage = response.Usage ?? new TokenUsage(texts.Sum(AiTokens.Estimate), 0, true) };
    }
}

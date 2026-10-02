namespace EduOS.Ai.Providers;

// Vendor-neutral contracts between EduOS and any model. They carry only text that trusted code has already
// prepared for the model: no school, user or credential travels here, and authorization is never decided here.

/// <summary>Where a provider processes the text it is given. Routing policy for External is decided elsewhere.</summary>
public enum DataBoundary
{
    /// <summary>Runs inside the EduOS deployment; text does not leave it.</summary>
    Local,
    /// <summary>May transmit text outside the EduOS deployment.</summary>
    External,
}

public sealed record ModelCapabilities(int MaxInputTokens, int MaxOutputTokens, bool ReportsTokenUsage);

public sealed record ModelDescriptor(string Provider, string Model, DataBoundary Boundary, ModelCapabilities Capabilities);

public enum ChatRole { System, User, Assistant }

public sealed record ChatMessage(ChatRole Role, string Content);

/// <param name="MaxOutputTokens">Required on every request, so no call is made without an output limit.</param>
public sealed record ModelRequest(IReadOnlyList<ChatMessage> Messages, int MaxOutputTokens, double Temperature = 0);

/// <param name="Estimated">True when the provider did not report usage and the platform estimated it.</param>
public sealed record TokenUsage(int InputTokens, int OutputTokens, bool Estimated);

public enum FinishReason { Completed, Length }

/// <param name="Usage">Null only when the provider does not report usage; callers that resolve providers from the container always receive a value.</param>
/// <param name="Latency">Measured by the platform around the call, not by the provider.</param>
public sealed record ModelResponse(string Provider, string Model, string Text, FinishReason Finish, TokenUsage? Usage, TimeSpan Latency = default);

public interface IModelProvider
{
    ModelDescriptor Descriptor { get; }
    Task<ModelResponse> Complete(ModelRequest request, CancellationToken cancellation);
}

/// <param name="Dimension">Reported by the provider for its configured model; nothing in the platform assumes a value.</param>
public sealed record EmbeddingDescriptor(string Provider, string Model, DataBoundary Boundary, int Dimension, int MaxInputTokens, int MaxBatchSize);

public sealed record EmbeddingResponse(string Provider, string Model, IReadOnlyList<float[]> Vectors, TokenUsage? Usage, TimeSpan Latency = default);

public interface IEmbeddingProvider
{
    EmbeddingDescriptor Descriptor { get; }
    /// <summary>One vector per text, in the same order.</summary>
    Task<EmbeddingResponse> Embed(IReadOnlyList<string> texts, CancellationToken cancellation);
}

public enum AiProviderError { Timeout, Unavailable, InvalidResponse }

/// <summary>The one failure callers handle. Its message names only the provider and the kind, never an address or a key.</summary>
public sealed class AiProviderException(string provider, AiProviderError error, Exception? inner = null)
    : Exception($"AI provider '{provider}' failed: {error}.", inner)
{
    public string Provider => provider;
    public AiProviderError Error => error;
}

public static class AiTokens
{
    /// <summary>A rough count (four characters per token) for budgets and for providers that report no usage.</summary>
    public static int Estimate(string? text) => string.IsNullOrEmpty(text) ? 0 : (text.Length + 3) / 4;
}

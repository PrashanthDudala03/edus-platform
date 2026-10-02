using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace EduOS.Ai.Providers;

// Adapters for a model runtime that runs inside the deployment and speaks the OpenAI-compatible HTTP protocol
// (llama.cpp's server, Ollama and others). Nothing here knows which runtime or model is behind the address. The
// runtime is not trusted: every call goes through the guards, an error body is never read, the model name and
// the limits are the configured ones, and no credential, school or user is ever sent, because none is held.

/// <summary>Bound from "Ai:Providers:LocalChat". Used only when Ai:Providers:Chat is "local".</summary>
public sealed class LocalChatOptions
{
    public string Endpoint { get; set; } = "http://127.0.0.1:8091/v1";
    /// <summary>The name the runtime knows the model by. It is also the name recorded with usage.</summary>
    public string Model { get; set; } = "";
    /// <summary>In the platform's estimate (four characters per token). Keep it, plus the output limit, below the context the runtime was started with.</summary>
    public int MaxInputTokens { get; set; } = 3072;
    public int MaxOutputTokens { get; set; } = 512;
    /// <summary>"separate" sends each message as it is. "merged" joins consecutive user messages, for chat templates that need user and assistant turns to alternate.</summary>
    public string Messages { get; set; } = LocalModelProvider.Separate;
    /// <summary>Allows a runtime on the deployment's own private network instead of this machine. Never a public address.</summary>
    public bool AllowPrivateNetwork { get; set; }

    public static IEnumerable<string> Problems(LocalChatOptions o)
    {
        const string key = "Ai:Providers:LocalChat";
        if (LocalEndpoint.Problem(key + ":Endpoint", o.Endpoint, o.AllowPrivateNetwork) is string endpoint) yield return endpoint;
        if (!LocalEndpoint.IsName(o.Model)) yield return $"{key}:Model must name the model the local runtime serves.";
        if (o.MaxInputTokens is < 256 or > 200000) yield return $"{key}:MaxInputTokens must be between 256 and 200000.";
        if (o.MaxOutputTokens is < 1 or > 4096) yield return $"{key}:MaxOutputTokens must be between 1 and 4096.";
        if (o.Messages is not (LocalModelProvider.Separate or LocalModelProvider.Merged)) yield return $"{key}:Messages must be 'separate' or 'merged'.";
    }
}

/// <summary>Bound from "Ai:Providers:LocalEmbedding". Used only when Ai:Providers:Embedding is "local".</summary>
public sealed class LocalEmbeddingOptions
{
    public string Endpoint { get; set; } = "http://127.0.0.1:8092/v1";
    public string Model { get; set; } = "";
    /// <summary>The size of the model's vectors. It has no default: it must be stated, and every response is checked against it.</summary>
    public int Dimension { get; set; }
    /// <summary>In the platform's estimate. Keep it below what the model accepts, so a chunk is never cut by the runtime.</summary>
    public int MaxInputTokens { get; set; } = 400;
    public int MaxBatchSize { get; set; } = 16;
    public bool AllowPrivateNetwork { get; set; }

    public static IEnumerable<string> Problems(LocalEmbeddingOptions o)
    {
        const string key = "Ai:Providers:LocalEmbedding";
        if (LocalEndpoint.Problem(key + ":Endpoint", o.Endpoint, o.AllowPrivateNetwork) is string endpoint) yield return endpoint;
        if (!LocalEndpoint.IsName(o.Model)) yield return $"{key}:Model must name the model the local runtime serves.";
        if (o.Dimension is < 1 or > 8192) yield return $"{key}:Dimension must be the vector size of the model, between 1 and 8192.";
        if (o.MaxInputTokens is < 16 or > 32768) yield return $"{key}:MaxInputTokens must be between 16 and 32768.";
        if (o.MaxBatchSize is < 1 or > 256) yield return $"{key}:MaxBatchSize must be between 1 and 256.";
    }
}

/// <summary>Where a local runtime may be, and how it is reached: directly, with no proxy, redirect, cookie or credential.</summary>
public static class LocalEndpoint
{
    public static bool IsName(string? value) => value is { Length: > 0 and <= 200 } && !value.Any(char.IsControl) && value.Trim() == value;

    public static string? Problem(string key, string? endpoint, bool allowPrivateNetwork)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
            return $"{key} must be an http address with no credentials and no query.";
        if (uri.IsLoopback) return null;
        if (!allowPrivateNetwork) return $"{key} must be a loopback address (127.0.0.1, ::1 or localhost); a runtime elsewhere on the deployment's private network needs AllowPrivateNetwork.";
        return IsPrivate(uri) ? null : $"{key} must be a loopback or private-network address: a local provider never sends text outside the deployment.";
    }

    // A private address, or a single-label name as a container network gives its services. Never a public name.
    static bool IsPrivate(Uri uri)
    {
        if (!IPAddress.TryParse(uri.DnsSafeHost, out var address)) return uri.HostNameType == UriHostNameType.Dns && !uri.DnsSafeHost.Contains('.');
        if (address.AddressFamily == AddressFamily.InterNetworkV6) return address.IsIPv6UniqueLocal;
        var b = address.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168);
    }

    /// <param name="handler">Replaces the network in tests.</param>
    public static HttpClient Client(string endpoint, long maxResponseBytes, HttpMessageHandler? handler = null) =>
        new(handler ?? new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false, UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(5), PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
        {
            BaseAddress = new Uri(endpoint.TrimEnd('/') + "/"),
            // The provider guard owns the time limit, so one setting covers every provider.
            Timeout = Timeout.InfiniteTimeSpan,
            MaxResponseContentBufferSize = maxResponseBytes,
        };
}

static class LocalCall
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    public static async Task<TReply> Post<TReply>(HttpClient http, string path, object body, string provider, CancellationToken cancellation)
    {
        var content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(body, body.GetType(), Json));
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        using var response = await http.PostAsync(path, content, cancellation);
        // The body of an error is not read: a runtime may repeat the prompt in it.
        if (!response.IsSuccessStatusCode) throw new AiProviderException(provider, AiProviderError.Unavailable);
        try { return JsonSerializer.Deserialize<TReply>(await response.Content.ReadAsByteArrayAsync(cancellation), Json) ?? throw new AiProviderException(provider, AiProviderError.InvalidResponse); }
        catch (JsonException) { throw new AiProviderException(provider, AiProviderError.InvalidResponse); }
    }
}

public sealed partial class LocalModelProvider(HttpClient http, LocalChatOptions options) : IModelProvider
{
    public const string Name = "local", Separate = "separate", Merged = "merged";
    /// <summary>Introduces a user message that was joined to the one before it. The same words inside the earlier text are made inert.</summary>
    public const string UserLabel = "[user message]";
    /// <summary>An answer this many times its output limit means the runtime ignored the limit.</summary>
    const int Overrun = 4;
    public const long MaxResponseBytes = 1024 * 1024;

    public ModelDescriptor Descriptor { get; } = new(Name, options.Model, DataBoundary.Local, new ModelCapabilities(options.MaxInputTokens, options.MaxOutputTokens, true));

    public async Task<ModelResponse> Complete(ModelRequest request, CancellationToken cancellation)
    {
        var messages = options.Messages == Merged ? Merge(request.Messages) : request.Messages;
        var reply = await LocalCall.Post<ChatReply>(http, "chat/completions",
            new ChatBody(options.Model, messages.Select(m => new ChatLine(Role(m.Role), m.Content)).ToList(), request.MaxOutputTokens, request.Temperature, false), Name, cancellation);
        if (reply.Choices is not [{ Message.Content: { } text } choice, ..] || string.IsNullOrWhiteSpace(text) || AiTokens.Estimate(text) > (long)request.MaxOutputTokens * Overrun)
            throw new AiProviderException(Name, AiProviderError.InvalidResponse);
        // Usage is taken from the runtime only when it reports both counts; otherwise the guard estimates it and says so.
        var usage = reply.Usage is { PromptTokens: > 0 and var input, CompletionTokens: > 0 and var output } ? new TokenUsage(input, output, false) : null;
        // The model is the configured name. What a runtime calls it can be a file path.
        return new ModelResponse(Name, options.Model, text, choice.FinishReason == "length" ? FinishReason.Length : FinishReason.Completed, usage);
    }

    static string Role(ChatRole role) => role switch { ChatRole.System => "system", ChatRole.Assistant => "assistant", _ => "user" };

    // Only user messages are joined, and only to a user message: nothing is ever added to the system message.
    // The later message goes under a fixed label, so the two stay distinguishable inside one turn.
    static IReadOnlyList<ChatMessage> Merge(IReadOnlyList<ChatMessage> messages)
    {
        var merged = new List<ChatMessage>();
        foreach (var message in messages)
            if (message.Role == ChatRole.User && merged is [.., { Role: ChatRole.User } earlier])
                merged[^1] = new(ChatRole.User, Label().Replace(earlier.Content, "(user message)") + "\n\n" + UserLabel + "\n" + message.Content);
            else merged.Add(message);
        return merged;
    }

    [GeneratedRegex(@"\[user message\]", RegexOptions.IgnoreCase)] private static partial Regex Label();

    sealed record ChatLine(string Role, string Content);
    sealed record ChatBody(string Model, IReadOnlyList<ChatLine> Messages, int MaxTokens, double Temperature, bool Stream);
    sealed record ChatReply(IReadOnlyList<ChatChoice>? Choices, ChatUsage? Usage);
    sealed record ChatChoice(ChatAnswer? Message, string? FinishReason);
    sealed record ChatAnswer(string? Content);
    sealed record ChatUsage(int? PromptTokens, int? CompletionTokens);
}

public sealed class LocalEmbeddingProvider(HttpClient http, LocalEmbeddingOptions options) : IEmbeddingProvider
{
    public const string Name = "local";
    public const long MaxResponseBytes = 32 * 1024 * 1024;

    public EmbeddingDescriptor Descriptor { get; } = new(Name, options.Model, DataBoundary.Local, options.Dimension, options.MaxInputTokens, options.MaxBatchSize);

    /// <summary>One request for the whole batch. The texts are sent as they are, and nothing else is.</summary>
    public async Task<EmbeddingResponse> Embed(IReadOnlyList<string> texts, CancellationToken cancellation)
    {
        var reply = await LocalCall.Post<EmbeddingReply>(http, "embeddings", new EmbeddingBody(options.Model, texts, "float"), Name, cancellation);
        if (reply.Data is not { } rows || rows.Count != texts.Count) throw new AiProviderException(Name, AiProviderError.InvalidResponse);
        // Each vector goes where the runtime says it belongs; a missing, repeated or unknown position is refused.
        var vectors = new float[texts.Count][];
        for (var i = 0; i < rows.Count; i++)
        {
            var position = rows[i].Index ?? i;
            if (position < 0 || position >= vectors.Length || vectors[position] is not null || rows[i].Embedding is not { } vector) throw new AiProviderException(Name, AiProviderError.InvalidResponse);
            vectors[position] = vector;
        }
        var usage = reply.Usage is { PromptTokens: > 0 and var input } ? new TokenUsage(input, 0, false) : null;
        return new EmbeddingResponse(Name, options.Model, vectors, usage);
    }

    sealed record EmbeddingBody(string Model, IReadOnlyList<string> Input, string EncodingFormat);
    sealed record EmbeddingReply(IReadOnlyList<EmbeddingRow>? Data, EmbeddingUsage? Usage);
    sealed record EmbeddingRow(int? Index, float[]? Embedding);
    sealed record EmbeddingUsage(int? PromptTokens);
}

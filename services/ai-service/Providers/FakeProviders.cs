using System.Security.Cryptography;
using System.Text;

namespace EduOS.Ai.Providers;

// Deterministic stand-ins for development and CI. They compute nothing meaningful and contact nothing.

public sealed class FakeModelProvider : IModelProvider
{
    public const string Name = "fake";
    public ModelDescriptor Descriptor { get; } = new(Name, "fake-chat-1", DataBoundary.Local, new ModelCapabilities(4096, 512, true));

    public Task<ModelResponse> Complete(ModelRequest request, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var full = "[fake] " + (request.Messages.LastOrDefault(m => m.Role == ChatRole.User) ?? request.Messages[^1]).Content.Trim();
        var limit = request.MaxOutputTokens * 4;
        var text = full.Length > limit ? full[..limit] : full;
        var usage = new TokenUsage(request.Messages.Sum(m => AiTokens.Estimate(m.Content)), AiTokens.Estimate(text), false);
        return Task.FromResult(new ModelResponse(Name, Descriptor.Model, text, text.Length < full.Length ? FinishReason.Length : FinishReason.Completed, usage));
    }
}

/// <param name="dimension">Chosen by whoever creates the provider, like a real embedding model's size.</param>
public sealed class FakeEmbeddingProvider(int dimension = 16) : IEmbeddingProvider
{
    public const string Name = "fake";
    public EmbeddingDescriptor Descriptor { get; } = new(Name, "fake-embed-1", DataBoundary.Local, dimension > 0 ? dimension : throw new ArgumentOutOfRangeException(nameof(dimension)), 512, 64);

    public Task<EmbeddingResponse> Embed(IReadOnlyList<string> texts, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var vectors = texts.Select(Vector).ToList();
        return Task.FromResult(new EmbeddingResponse(Name, Descriptor.Model, vectors, new TokenUsage(texts.Sum(AiTokens.Estimate), 0, false)));
    }

    // A unit vector derived from a hash of the text: stable across runs, with no notion of meaning.
    float[] Vector(string text)
    {
        var values = new float[Descriptor.Dimension];
        var block = Array.Empty<byte>();
        for (var i = 0; i < values.Length; i++)
        {
            if (i % 32 == 0) block = SHA256.HashData(Encoding.UTF8.GetBytes(i / 32 + ":" + text));
            values[i] = (block[i % 32] - 127.5f) / 127.5f;
        }
        var length = MathF.Sqrt(values.Sum(v => v * v));
        return length == 0 ? values : values.Select(v => v / length).ToArray();
    }
}

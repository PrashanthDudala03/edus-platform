using Microsoft.Extensions.Options;

namespace EduOS.Ai.Providers;

/// <summary>Which provider serves chat and embeddings, bound from "Ai:Providers". Credentials never live here.</summary>
public sealed class AiProviderOptions
{
    public const string Section = "Ai:Providers";
    public string Chat { get; set; } = FakeModelProvider.Name;
    public string Embedding { get; set; } = FakeEmbeddingProvider.Name;
    /// <summary>Upper bound for a single provider call.</summary>
    public int TimeoutSeconds { get; set; } = 30;
}

/// <summary>The only place provider names are turned into implementations. A new vendor is one more case here.</summary>
public static class AiProviders
{
    public static readonly IReadOnlyList<string> Chat = [FakeModelProvider.Name];
    public static readonly IReadOnlyList<string> Embedding = [FakeEmbeddingProvider.Name];

    public static IReadOnlyList<string> Problems(AiProviderOptions options)
    {
        var problems = new List<string>();
        if (!Chat.Contains(options.Chat)) problems.Add($"Ai:Providers:Chat '{options.Chat}' is not a known chat provider ({string.Join(", ", Chat)}).");
        if (!Embedding.Contains(options.Embedding)) problems.Add($"Ai:Providers:Embedding '{options.Embedding}' is not a known embedding provider ({string.Join(", ", Embedding)}).");
        if (options.TimeoutSeconds is < 1 or > 120) problems.Add("Ai:Providers:TimeoutSeconds must be between 1 and 120.");
        return problems;
    }

    public static IModelProvider CreateChat(AiProviderOptions options) => new GuardedModelProvider(options.Chat switch
    {
        FakeModelProvider.Name => new FakeModelProvider(),
        _ => throw new InvalidOperationException($"Unknown chat provider '{options.Chat}'."),
    }, TimeSpan.FromSeconds(options.TimeoutSeconds));

    public static IEmbeddingProvider CreateEmbedding(AiProviderOptions options) => new GuardedEmbeddingProvider(options.Embedding switch
    {
        FakeEmbeddingProvider.Name => new FakeEmbeddingProvider(),
        _ => throw new InvalidOperationException($"Unknown embedding provider '{options.Embedding}'."),
    }, TimeSpan.FromSeconds(options.TimeoutSeconds));

    /// <summary>A misconfigured provider stops the service at start instead of failing on the first request.</summary>
    public static void Register(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IValidateOptions<AiProviderOptions>, Validator>();
        services.AddOptions<AiProviderOptions>().Bind(configuration.GetSection(AiProviderOptions.Section)).ValidateOnStart();
        services.AddSingleton(s => CreateChat(s.GetRequiredService<IOptions<AiProviderOptions>>().Value));
        services.AddSingleton(s => CreateEmbedding(s.GetRequiredService<IOptions<AiProviderOptions>>().Value));
    }

    sealed class Validator : IValidateOptions<AiProviderOptions>
    {
        public ValidateOptionsResult Validate(string? name, AiProviderOptions options) =>
            Problems(options) is { Count: > 0 } problems ? ValidateOptionsResult.Fail(problems) : ValidateOptionsResult.Success;
    }
}

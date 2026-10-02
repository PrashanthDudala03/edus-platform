using EduOS.Ai.Gateway;
using EduOS.Ai.Knowledge;
using EduOS.Ai.Providers;
using EduOS.Ai.Tools;
using EduOS.ServiceAuth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

/// <summary>Deployment-level AI settings, bound from the "Ai" section (environment: Ai__Enabled).</summary>
public sealed class AiOptions
{
    public const string Section = "Ai";
    /// <summary>Off unless the deployment turns it on. Per-school and per-role switches are IAM permissions.</summary>
    public bool Enabled { get; set; }
}

/// <summary>A diagnostic search. There is no school to send: it is the caller's.</summary>
public sealed record KnowledgeSearch(string? Query, int? TopK = null, string? Audience = null);

public static class AiPermissions
{
    public const string AssistantUse = "ai.assistant.use";
    public const string UsageView = "ai.usage.view";
    public const string KnowledgeManage = "ai.knowledge.manage";
}

/// <summary>
/// Composition of the AI service. It holds no school data and no database connection: the school and
/// permissions of a caller come only from the verified token, exactly as in every other EduOS service.
/// </summary>
public static class AiService
{
    /// <param name="configureEvents">Lets in-process tests replace the auth-service session check.</param>
    public static void Configure(WebApplicationBuilder builder, Action<JwtBearerEvents>? configureEvents = null)
    {
        builder.Services.AddOptions<AiOptions>().Bind(builder.Configuration.GetSection(AiOptions.Section)).ValidateOnStart();
        builder.Services.AddEduOSAuthentication(builder.Configuration, configureEvents);

        // Two accounts on the separate AI database: the restricted one serves requests, the owner only prepares the schema.
        var runtime = builder.Configuration.GetConnectionString("AiDb");
        var owner = builder.Configuration.GetConnectionString("AiDbMigrations");
        builder.Services.AddSingleton(new AiDatabaseState(!string.IsNullOrWhiteSpace(runtime) && !string.IsNullOrWhiteSpace(owner)));
        builder.Services.AddSingleton(_ => new AiDatabase(runtime));
        builder.Services.AddSingleton<IAiDatabaseBootstrap>(s => new NpgsqlAiDatabaseBootstrap(owner!, runtime!, Path.Combine(AppContext.BaseDirectory, "Migrations"),
            s.GetRequiredService<IEmbeddingProvider>().Descriptor, s.GetRequiredService<IOptions<AiKnowledgeOptions>>().Value.AdoptEmbeddingModel));
        builder.Services.AddHostedService<AiDatabaseInitializer>();

        AiProviders.Register(builder.Services, builder.Configuration);

        builder.Services.AddOptions<AiAssistantOptions>().Bind(builder.Configuration.GetSection(AiAssistantOptions.Section))
            .Validate(o => AiAssistantOptions.Problem(o) is null, "Ai:Assistant is out of range: question 1 to 8000 characters, output 1 to 4096 tokens, and a request budget above the output limit and at most 200000 tokens.")
            .ValidateOnStart();
        builder.Services.AddOptions<AiLimitsOptions>().Bind(builder.Configuration.GetSection(AiLimitsOptions.Section))
            .Validate(o => AiLimitsOptions.Problem(o) is null, "Ai:Limits is out of range: requests per minute (user 1 to 600, school 1 to 60000), failure threshold 1 to 100, recovery 1 to 3600 seconds.")
            .ValidateOnStart();
        builder.Services.TryAddSingleton(TimeProvider.System);
        builder.Services.AddSingleton<AiRateLimiter>();
        builder.Services.AddSingleton<AiCircuitBreaker>();
        builder.Services.AddSingleton<IAiUsageStore, PostgresAiUsageStore>();
        builder.Services.AddSingleton<AiGateway>();

        builder.Services.AddOptions<AiKnowledgeOptions>().Bind(builder.Configuration.GetSection(AiKnowledgeOptions.Section))
            .Validate(o => AiKnowledgeOptions.Problem(o) is null, "Ai:Knowledge is out of range: upload 1 KB to 5 MB, text 1000 to 2000000 characters, chunk size 200 to 8000 with an overlap of at most half the size, embedding batch 1 to 256.")
            .ValidateOnStart();
        builder.Services.AddSingleton<IKnowledgeStore, PostgresKnowledgeStore>();
        builder.Services.AddSingleton<IValidateOptions<AiRetrievalOptions>>(s => new RetrievalLimits(s.GetRequiredService<IOptions<AiKnowledgeOptions>>()));
        builder.Services.AddOptions<AiRetrievalOptions>().Bind(builder.Configuration.GetSection(AiRetrievalOptions.Section)).ValidateOnStart();
        builder.Services.AddSingleton<KnowledgeRetriever>();
        builder.Services.AddSingleton<KnowledgeEmbedder>();
        builder.Services.AddSingleton<KnowledgeService>();

        // Read-only tools over existing EduOS endpoints. Nothing calls them from a request yet: there is no tool endpoint,
        // and the assistant does not use them until tool routing exists.
        builder.Services.AddOptions<AiToolsOptions>().Bind(builder.Configuration.GetSection(AiToolsOptions.Section))
            .Validate(o => AiToolsOptions.Problem(o) is null, "Ai:Tools is out of range: GatewayUrl must be the EduOS gateway's address inside the deployment (loopback or private network, no credentials, no query), TimeoutSeconds 1 to 60, MaxResponseBytes 1 KB to 16 MB.")
            .ValidateOnStart();
        builder.Services.AddSingleton<IAiTool, StudentCountTool>();
        builder.Services.AddSingleton<IAiTool, AttendanceSummaryTool>();
        builder.Services.AddSingleton<IAiTool, FeeSummaryTool>();
        builder.Services.AddSingleton<IAiTool, ExamScheduleTool>();
        builder.Services.AddSingleton<IAiTool, CurrentUserProfileTool>();
        builder.Services.AddSingleton<IEduOsApi>(s => new EduOsApi(EduOsApi.Client(s.GetRequiredService<IOptions<AiToolsOptions>>().Value), s.GetServices<IAiTool>()));
        builder.Services.AddSingleton<IAiToolAudit, PostgresAiToolAudit>();
        builder.Services.AddSingleton<AiToolRegistry>();
    }

    // Checked against the chunk size, so the best chunk always fits in the context budget.
    sealed class RetrievalLimits(IOptions<AiKnowledgeOptions> knowledge) : IValidateOptions<AiRetrievalOptions>
    {
        public ValidateOptionsResult Validate(string? name, AiRetrievalOptions options) =>
            AiRetrievalOptions.Problem(options, knowledge.Value.ChunkMaxChars) is string problem ? ValidateOptionsResult.Fail(problem) : ValidateOptionsResult.Success;
    }

    /// <summary>Largest request body an AI endpoint accepts, other than a knowledge upload.</summary>
    public const int MaxBodyBytes = 16 * 1024;
    /// <summary>Room for the multipart boundaries and the form fields around an uploaded file.</summary>
    public const int UploadOverheadBytes = 16 * 1024;

    static bool CannotManageKnowledge(TenantContext tenant, HttpContext http) =>
        tenant.IsPlatform || !http.User.HasClaim("permission", AiPermissions.KnowledgeManage);
    static IResult Unavailable(string? reason, int? retryAfterSeconds = null) => retryAfterSeconds is int wait
        ? Results.Ok(new { data = new { available = false, reason, retryAfterSeconds = wait } })
        : Results.Ok(new { data = new { available = false, reason } });

    // Only a school user holding the permission; the platform administrator has no school to ask about.
    static bool Denied(TenantContext tenant, HttpContext http) =>
        tenant.IsPlatform || !http.User.HasClaim("permission", AiPermissions.AssistantUse);
    static IResult Forbidden() => Results.Json(new { message = "Permission denied." }, statusCode: StatusCodes.Status403Forbidden);

    public static void Map(WebApplication app)
    {
        app.UseRouting();
        // Refused before anything reads the body. A body must state its length, so the limit cannot be sidestepped.
        var uploadLimit = app.Services.GetRequiredService<IOptions<AiKnowledgeOptions>>().Value.MaxUploadBytes + UploadOverheadBytes;
        app.Use(async (context, next) =>
        {
            var request = context.Request;
            if (HttpMethods.IsPost(request.Method) || HttpMethods.IsPut(request.Method) || HttpMethods.IsPatch(request.Method))
            {
                var limit = request.Path.Equals("/api/ai/knowledge/documents") ? uploadLimit : MaxBodyBytes;
                if (request.ContentLength is not long length || length > limit)
                {
                    context.Response.StatusCode = request.ContentLength is null ? StatusCodes.Status411LengthRequired : StatusCodes.Status413PayloadTooLarge;
                    await context.Response.WriteAsJsonAsync(new { message = request.ContentLength is null ? "The request must state its length." : "The request is too large." });
                    return;
                }
            }
            await next();
        });
        // Everything under /api except the container health check needs a valid token, a school scope and
        // the permission PermissionAccess maps to the route; AI routes it does not know are refused.
        app.UseEduOSAuthorization("/api", "/api/ai/health");

        app.MapGet("/api/ai/health", () => Results.Ok(new { status = "ready" })).AllowAnonymous();

        // Reports availability only, from the same check the assistant itself uses.
        app.MapGet("/api/ai/status", async (TenantContext tenant, HttpContext http, AiGateway gateway, CancellationToken cancellation) =>
        {
            if (Denied(tenant, http)) return Forbidden();
            var reason = await gateway.UnavailableFor(tenant, cancellation);
            return Results.Ok(new { data = new { enabled = reason is null, reason } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        // The caller's own school only: its switch, monthly allowance and what it has used. Counts, never content.
        app.MapGet("/api/ai/usage", async (TenantContext tenant, HttpContext http, AiGateway gateway, CancellationToken cancellation) =>
        {
            if (tenant.IsPlatform || !http.User.HasClaim("permission", AiPermissions.UsageView)) return Forbidden();
            var (summary, reason) = await gateway.Usage(tenant, cancellation);
            if (summary is null) return Results.Ok(new { data = new { available = false, reason } });
            return Results.Ok(new { data = new
            {
                available = true, enabled = summary.Enabled, monthStart = summary.MonthStart, monthlyTokenBudget = summary.MonthlyTokenBudget, tokensUsed = summary.TokensUsed,
                tokensReserved = summary.TokensReserved, tokensRemaining = summary.TokensRemaining, calls = summary.Calls, failedCalls = summary.FailedCalls,
            } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        // Knowledge documents of the caller's own school. The upload is held in memory, turned into text chunks and
        // discarded: no file is written, and the file name is kept only as a label.
        app.MapPost("/api/ai/knowledge/documents", async (TenantContext tenant, HttpContext http, KnowledgeService knowledge, CancellationToken cancellation) =>
        {
            if (CannotManageKnowledge(tenant, http)) return Forbidden();
            if (!http.Request.HasFormContentType) return Results.Json(new { message = "Send the file as multipart/form-data." }, statusCode: StatusCodes.Status415UnsupportedMediaType);
            IFormCollection form;
            try
            {
                form = await http.Request.ReadFormAsync(new FormOptions
                {
                    MultipartBodyLengthLimit = uploadLimit, MemoryBufferThreshold = uploadLimit, ValueCountLimit = 16, ValueLengthLimit = 2048, MultipartHeadersLengthLimit = 4096,
                }, cancellation);
            }
            catch (Exception ex) when (ex is InvalidDataException or IOException) { return Results.BadRequest(new { message = "The upload could not be read." }); }
            if (form.Files.Count != 1 || form.Files[0].Name != "file") return Results.BadRequest(new { message = "Send exactly one file, in the field named file." });
            var file = form.Files[0];
            using var content = new MemoryStream();
            await file.CopyToAsync(content, cancellation);
            var audience = form["audience"].SelectMany(value => (value ?? "").Split(',')).ToArray();
            var outcome = await knowledge.Ingest(tenant, new KnowledgeUpload(file.FileName, file.ContentType, content.ToArray(), form["title"].FirstOrDefault(), audience), cancellation);
            if (outcome.Rejected is KnowledgeRejection rejection) return Results.Json(new { message = rejection.Message }, statusCode: rejection.Status);
            if (outcome.Saved is not KnowledgeSaved saved) return Unavailable(outcome.Unavailable, outcome.RetryAfterSeconds);
            // The state says whether embedding completed. Vectors themselves are never returned.
            return Results.Json(new { data = new { available = true, id = saved.Id, title = saved.Title, status = saved.Status, reason = saved.Reason, chunks = saved.Chunks, characters = saved.Characters, duplicate = saved.Duplicate } },
                statusCode: saved.Duplicate ? StatusCodes.Status200OK : StatusCodes.Status201Created);
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        app.MapGet("/api/ai/knowledge/documents", async (TenantContext tenant, HttpContext http, KnowledgeService knowledge, CancellationToken cancellation) =>
        {
            if (CannotManageKnowledge(tenant, http)) return Forbidden();
            var (documents, reason) = await knowledge.List(tenant, cancellation);
            return documents is null ? Unavailable(reason) : Results.Ok(new { data = new { available = true, documents } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        // For the people who manage a school's knowledge: what would be retrieved for a question. It returns chunks of
        // their own school only and never a vector. They may look as another audience of their school, to check a document's reach.
        app.MapPost("/api/ai/knowledge/search", async (KnowledgeSearch search, TenantContext tenant, HttpContext http, KnowledgeRetriever retriever, AiRateLimiter limiter, CancellationToken cancellation) =>
        {
            if (CannotManageKnowledge(tenant, http)) return Forbidden();
            if (limiter.Admit(tenant) is > 0 and var wait) return Unavailable("rate-limited", wait);
            var result = await retriever.Retrieve(tenant, search.Audience?.Trim().ToLowerInvariant() ?? http.User.FindFirst("data_scope")?.Value ?? "", search.Query, new RetrievalRequest(search.TopK), cancellation);
            if (result.Invalid is string message) return Results.BadRequest(new { message });
            if (result.Unavailable is string reason) return reason == "not-permitted" ? Results.BadRequest(new { message = "Choose an audience of school, teacher, parent or student." }) : Unavailable(reason);
            return Results.Ok(new { data = new
            {
                available = true, characters = result.Characters, tokens = result.Tokens,
                results = result.Chunks.Select(c => new { documentId = c.DocumentId, title = c.Title, source = c.Source, chunkId = c.ChunkId, ordinal = c.Ordinal, section = c.Section, page = c.Page, similarity = Math.Round(c.Similarity, 4), text = c.Text }),
            } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        // Embeds a stored document again, after a failure or a change of embedding model.
        app.MapPost("/api/ai/knowledge/documents/{id:guid}/embedding", async (Guid id, TenantContext tenant, HttpContext http, KnowledgeService knowledge, CancellationToken cancellation) =>
        {
            if (CannotManageKnowledge(tenant, http)) return Forbidden();
            var (status, reason, unavailable, wait) = await knowledge.Embed(tenant, id, cancellation);
            if (unavailable is not null) return Unavailable(unavailable, wait);
            return status is null ? Results.NotFound(new { message = "Document not found." }) : Results.Ok(new { data = new { available = true, id, status, reason } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        app.MapDelete("/api/ai/knowledge/documents/{id:guid}", async (Guid id, TenantContext tenant, HttpContext http, KnowledgeService knowledge, CancellationToken cancellation) =>
        {
            if (CannotManageKnowledge(tenant, http)) return Forbidden();
            var (deleted, reason) = await knowledge.Delete(tenant, id, cancellation);
            return deleted is null ? Unavailable(reason) : deleted.Value ? Results.NoContent() : Results.NotFound(new { message = "Document not found." });
        }).RequireAuthorization(EduOSPolicies.AnyRole);

        // A valid request always gets 200: either an answer with its sources or the reason there is none.
        // Provider failures are never turned into a server error, and no internal detail is returned.
        // The knowledge used is the caller's school and data scope from the token; the body can name neither.
        app.MapPost("/api/ai/assistant/ask", async (AssistantAsk ask, TenantContext tenant, HttpContext http, AiGateway gateway, CancellationToken cancellation) =>
        {
            if (Denied(tenant, http)) return Forbidden();
            // The caller's token is forwarded only to EduOS itself, for live figures the caller is permitted to read.
            var outcome = await gateway.Ask(tenant, http.User.FindFirst("data_scope")?.Value ?? "", ask, cancellation, ToolCaller.From(http, tenant));
            if (outcome.Invalid is string message) return Results.BadRequest(new { message });
            if (outcome.RetryAfterSeconds is int wait) return Results.Ok(new { data = new { available = false, reason = outcome.Unavailable, retryAfterSeconds = wait } });
            if (outcome.Response is not ModelResponse answer) return Results.Ok(new { data = new { available = false, reason = outcome.Unavailable } });
            return Results.Ok(new { data = new
            {
                available = true, kind = outcome.Kind, answer = answer.Text,
                sources = outcome.Sources!.Select(s => new { number = s.Number, documentId = s.DocumentId, title = s.Title, source = s.Source, section = s.Section, page = s.Page }),
                model = answer.Model.Length == 0 ? null : answer.Model, finish = answer.Finish == FinishReason.Length ? "length" : "completed",
                usage = new { inputTokens = answer.Usage!.InputTokens, outputTokens = answer.Usage.OutputTokens, estimated = answer.Usage.Estimated },
            } });
        }).RequireAuthorization(EduOSPolicies.AnyRole);
    }
}

using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, config) =>
    config.MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/ai-service-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "AI-Service"));

AiService.Configure(builder);

var app = builder.Build();
AiService.Map(app);
app.Run();

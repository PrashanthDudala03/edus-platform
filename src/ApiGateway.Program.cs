using Yarp.ReverseProxy.Configuration;
using EduOS.Shared;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Add YARP for reverse proxy
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

// Add CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", builder =>
    {
        builder.AllowAnyOrigin()
               .AllowAnyMethod()
               .AllowAnyHeader();
    });
});

builder.Services.AddHealthChecks();
builder.Services.AddLogging();

var app = builder.Build();

app.UseCors("AllowAll");
app.UseRouting();

// Health check endpoint
app.MapGet("/health", () =>
{
    return Results.Ok(new HealthCheckResponse
    {
        Status = "Healthy",
        Details = new Dictionary<string, object>
        {
            { "service", "API Gateway" },
            { "version", "1.0.0" },
            { "uptime", DateTime.UtcNow }
        }
    });
}).WithName("GatewayHealth").WithOpenApi();

// Gateway health status
app.MapGet("/gateway/status", () =>
{
    return Results.Ok(new ApiResponse<object>
    {
        Success = true,
        Data = new
        {
            gateway = "YARP Reverse Proxy",
            status = "Running",
            timestamp = DateTime.UtcNow,
            routes = new[]
            {
                "/api/auth -> Auth Service",
                "/api/students -> Student Service",
                "/api/teachers -> Teacher Service",
                "/api/parents -> Parent Service"
            }
        },
        Message = "Gateway is operational"
    });
}).WithName("GatewayStatus").WithOpenApi();

// Route all API requests to appropriate services
app.MapReverseProxy()
    .RequireHost("*");

app.Run();

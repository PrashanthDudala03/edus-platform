using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Serilog;
using StudentService.Data;
using StudentService.Handlers;
using StudentService.Validation;

var builder = WebApplication.CreateBuilder(args);

// Serilog
builder.Host.UseSerilog((context, config) =>
    config
        .MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/student-service-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "Student-Service"));

// Configuration from .env
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("DefaultConnection not found");

// Register DbContext
builder.Services.AddDbContext<StudentDbContext>(options =>
    options.UseNpgsql(connectionString, opt =>
        opt.MigrationsHistoryTable("__EFMigrationsHistory", "student_db")));

// Register MediatR
builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblyContaining<GetStudentListHandler>());

// Register Validation
builder.Services.AddScoped<IValidator<CreateStudentCommand>, CreateStudentValidator>();
builder.Services.AddScoped<IValidator<UpdateStudentCommand>, UpdateStudentValidator>();

// Register Repository
builder.Services.AddScoped<IStudentRepository, StudentRepository>();

// Health checks
builder.Services.AddHealthChecks();

var app = builder.Build();

// Apply migrations on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<StudentDbContext>();
    try
    {
        db.Database.Migrate();
        Log.Information("Database migrated successfully");
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Database migration failed");
    }
}

app.UseRouting();

// Health endpoint - return Prometheus metrics format
app.MapGet("/api/health", () =>
{
    return Results.Text("# HELP service_health Service health status\n# TYPE service_health gauge\nservice_health 1\n", "text/plain; version=0.0.4");
});

// Student endpoints
app.MapGet("/api/students", async (IMediator mediator, int page = 1, int pageSize = 20, string? schoolId = null) =>
{
    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
    {
        return Results.BadRequest(new { statusCode = 400, message = "schoolId query parameter is required and must be a valid GUID" });
    }

    try
    {
        var result = await mediator.Send(new GetStudentListQuery
        {
            SchoolId = schoolIdGuid,
            Page = page,
            PageSize = pageSize,
        });
        return Results.Ok(new { statusCode = 200, data = result });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error fetching students");
        return Results.Json(
            new { statusCode = 500, message = "Error fetching students" },
            statusCode: 500);
    }
});

app.MapGet("/api/students/count", async (IMediator mediator, string? schoolId = null) =>
{
    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
    {
        return Results.BadRequest(new { statusCode = 400, message = "schoolId query parameter is required and must be a valid GUID" });
    }

    try
    {
        var count = await mediator.Send(new GetStudentCountQuery { SchoolId = schoolIdGuid });
        return Results.Ok(new { statusCode = 200, data = new { count } });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error fetching student count");
        return Results.Json(
            new { statusCode = 500, message = "Error fetching student count" },
            statusCode: 500);
    }
});

app.MapPost("/api/students", async (CreateStudentCommand request, IMediator mediator, IValidator<CreateStudentCommand> validator) =>
{
    try
    {
        var validationResult = await validator.ValidateAsync(request);
        if (!validationResult.IsValid)
        {
            return Results.BadRequest(new
            {
                statusCode = 400,
                message = "Validation failed",
                errors = validationResult.Errors.Select(e => new { field = e.PropertyName, message = e.ErrorMessage })
            });
        }

        var result = await mediator.Send(request);
        return Results.Created($"/api/students/{result.Id}", new { statusCode = 201, data = result });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error creating student");
        return Results.Json(
            new { statusCode = 500, message = "Error creating student" },
            statusCode: 500);
    }
});

app.MapPut("/api/students/{id}", async (string id, UpdateStudentCommand request, IMediator mediator, IValidator<UpdateStudentCommand> validator) =>
{
    if (!Guid.TryParse(id, out var studentId))
    {
        return Results.BadRequest(new { statusCode = 400, message = "Invalid student ID format" });
    }

    request.Id = studentId;

    try
    {
        var validationResult = await validator.ValidateAsync(request);
        if (!validationResult.IsValid)
        {
            return Results.BadRequest(new
            {
                statusCode = 400,
                message = "Validation failed",
                errors = validationResult.Errors.Select(e => new { field = e.PropertyName, message = e.ErrorMessage })
            });
        }

        var result = await mediator.Send(request);
        return Results.Ok(new { statusCode = 200, data = result });
    }
    catch (InvalidOperationException ex)
    {
        return Results.NotFound(new { statusCode = 404, message = ex.Message });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error updating student");
        return Results.Json(
            new { statusCode = 500, message = "Error updating student" },
            statusCode: 500);
    }
});

app.MapDelete("/api/students/{id}", async (string id, IMediator mediator, string? schoolId = null) =>
{
    if (!Guid.TryParse(id, out var studentId))
    {
        return Results.BadRequest(new { statusCode = 400, message = "Invalid student ID format" });
    }

    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
    {
        return Results.BadRequest(new { statusCode = 400, message = "schoolId query parameter is required and must be a valid GUID" });
    }

    var request = new DeleteStudentCommand { Id = studentId, SchoolId = schoolIdGuid };

    try
    {
        await mediator.Send(request);
        return Results.Ok(new { statusCode = 200, message = "Student deleted successfully" });
    }
    catch (InvalidOperationException ex)
    {
        return Results.NotFound(new { statusCode = 404, message = ex.Message });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error deleting student");
        return Results.Json(
            new { statusCode = 500, message = "Error deleting student" },
            statusCode: 500);
    }
});

app.Run();


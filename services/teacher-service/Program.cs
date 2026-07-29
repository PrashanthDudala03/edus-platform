using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Serilog;
using TeacherService.Data;
using TeacherService.Handlers;
using TeacherService.Validation;

var builder = WebApplication.CreateBuilder(args);

// Serilog
builder.Host.UseSerilog((context, config) =>
    config
        .MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/teacher-service-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "Teacher-Service"));

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("DefaultConnection not found");

builder.Services.AddDbContext<TeacherDbContext>(options =>
    options.UseNpgsql(connectionString, opt =>
        opt.MigrationsHistoryTable("__EFMigrationsHistory", "teacher_db")));

builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblyContaining<GetTeacherListHandler>());

builder.Services.AddScoped<IValidator<CreateTeacherCommand>, CreateTeacherValidator>();
builder.Services.AddScoped<IValidator<UpdateTeacherCommand>, UpdateTeacherValidator>();

builder.Services.AddScoped<ITeacherRepository, TeacherRepository>();

builder.Services.AddHealthChecks();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<TeacherDbContext>();
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

app.MapGet("/api/teachers", async (IMediator mediator, int page = 1, int pageSize = 20, string? schoolId = null) =>
{
    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
    {
        return Results.BadRequest(new { statusCode = 400, message = "schoolId query parameter is required and must be a valid GUID" });
    }

    try
    {
        var result = await mediator.Send(new GetTeacherListQuery
        {
            SchoolId = schoolIdGuid,
            Page = page,
            PageSize = pageSize,
        });
        return Results.Ok(new { statusCode = 200, data = result });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error fetching teachers");
        return Results.Json(new { statusCode = 500, message = "Error fetching teachers" }, statusCode: 500);
    }
});

app.MapGet("/api/teachers/count", async (IMediator mediator, string? schoolId = null) =>
{
    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
    {
        return Results.BadRequest(new { statusCode = 400, message = "schoolId query parameter is required and must be a valid GUID" });
    }

    try
    {
        var count = await mediator.Send(new GetTeacherCountQuery { SchoolId = schoolIdGuid });
        return Results.Ok(new { statusCode = 200, data = new { count } });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error fetching teacher count");
        return Results.Json(new { statusCode = 500, message = "Error fetching teacher count" }, statusCode: 500);
    }
});

app.MapPost("/api/teachers", async (CreateTeacherCommand request, IMediator mediator, IValidator<CreateTeacherCommand> validator) =>
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
        return Results.Created($"/api/teachers/{result.Id}", new { statusCode = 201, data = result });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error creating teacher");
        return Results.Json(new { statusCode = 500, message = "Error creating teacher" }, statusCode: 500);
    }
});

app.MapPut("/api/teachers/{id}", async (string id, UpdateTeacherCommand request, IMediator mediator, IValidator<UpdateTeacherCommand> validator) =>
{
    if (!Guid.TryParse(id, out var teacherId))
    {
        return Results.BadRequest(new { statusCode = 400, message = "Invalid teacher ID format" });
    }

    request.Id = teacherId;

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
        Log.Error(ex, "Error updating teacher");
        return Results.Json(new { statusCode = 500, message = "Error updating teacher" }, statusCode: 500);
    }
});

app.MapDelete("/api/teachers/{id}", async (string id, IMediator mediator, string? schoolId = null) =>
{
    if (!Guid.TryParse(id, out var teacherId))
    {
        return Results.BadRequest(new { statusCode = 400, message = "Invalid teacher ID format" });
    }

    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
    {
        return Results.BadRequest(new { statusCode = 400, message = "schoolId query parameter is required and must be a valid GUID" });
    }

    var request = new DeleteTeacherCommand { Id = teacherId, SchoolId = schoolIdGuid };

    try
    {
        await mediator.Send(request);
        return Results.Ok(new { statusCode = 200, message = "Teacher deleted successfully" });
    }
    catch (InvalidOperationException ex)
    {
        return Results.NotFound(new { statusCode = 404, message = ex.Message });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Error deleting teacher");
        return Results.Json(new { statusCode = 500, message = "Error deleting teacher" }, statusCode: 500);
    }
});

app.Run();


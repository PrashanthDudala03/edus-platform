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
app.Use(async (ctx, next) => {
    if ((ctx.Request.Query.TryGetValue("page", out var p) && (!int.TryParse(p, out var page) || page < 1 || page > 100000)) ||
        (ctx.Request.Query.TryGetValue("pageSize", out var z) && (!int.TryParse(z, out var size) || size < 1 || size > 100))) {
        ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { message = "Page must be positive and page size between 1 and 100." }); return;
    }
    try { await next(); }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsJsonAsync(new { message = "A record with those details already exists." }); }
});

// Apply migrations on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<StudentDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1 FROM student_db.students LIMIT 1");
        Log.Information("Database schema verified");
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Database schema validation failed");
        throw;
    }
}

app.UseRouting();

// Health endpoint - return Prometheus metrics format
app.MapGet("/api/health", async (StudentDbContext db) => {try { return await db.Database.CanConnectAsync() ? Results.Ok(new {status="ready"}) : Results.StatusCode(503); } catch { return Results.StatusCode(503); }});

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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex)
    {
        if(ex is InvalidOperationException) return Results.Conflict(new {message=ex.Message});
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex)
    {
        Log.Error(ex, "Error deleting student");
        return Results.Json(
            new { statusCode = 500, message = "Error deleting student" },
            statusCode: 500);
    }
});

app.Run();


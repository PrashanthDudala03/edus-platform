using EduOS.ServiceAuth;
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

// This service verifies access tokens itself; it does not trust gateway headers.
builder.Services.AddEduOSAuthentication(builder.Configuration);

var app = builder.Build();
app.Use(async (ctx, next) => {
    if ((ctx.Request.Query.TryGetValue("page", out var p) && (!int.TryParse(p, out var page) || page < 1 || page > 100000)) ||
        (ctx.Request.Query.TryGetValue("pageSize", out var z) && (!int.TryParse(z, out var size) || size < 1 || size > 100))) {
        ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { message = "Page must be positive and page size between 1 and 100." }); return;
    }
    try { await next(); }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsJsonAsync(new { message = "A record with those details already exists." }); }
});

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<TeacherDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1 FROM teacher_db.teachers LIMIT 1");
        Log.Information("Database schema verified");
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Database schema validation failed");
        throw;
    }
}

app.UseRouting();
app.UseEduOSAuthorization("/api", "/api/health");

// Health endpoint - return Prometheus metrics format
app.MapGet("/api/health", async (TeacherDbContext db) => {try { return await db.Database.CanConnectAsync() ? Results.Ok(new {status="ready"}) : Results.StatusCode(503); } catch { return Results.StatusCode(503); }}).AllowAnonymous();

// Directory endpoints: leadership reads, administrators change. schoolId is rewritten from the verified token before handlers run.
var teachers = app.MapGroup("/api/teachers").RequireAuthorization(EduOSPolicies.Leadership);
// Changes need the Administrator role on top of the group's leadership policy; Principal is read-only.
var teachersWrites = teachers.MapGroup("").RequireAuthorization(EduOSPolicies.Administrators);
teachers.MapGet("", async (IMediator mediator, int page = 1, int pageSize = 20, string? schoolId = null) =>
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex)
    {
        Log.Error(ex, "Error fetching teachers");
        return Results.Json(new { statusCode = 500, message = "Error fetching teachers" }, statusCode: 500);
    }
});

teachers.MapGet("/count", async (IMediator mediator, string? schoolId = null) =>
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex)
    {
        Log.Error(ex, "Error fetching teacher count");
        return Results.Json(new { statusCode = 500, message = "Error fetching teacher count" }, statusCode: 500);
    }
});

teachersWrites.MapPost("", async (CreateTeacherCommand request, IMediator mediator, IValidator<CreateTeacherCommand> validator) =>
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex)
    {
        if(ex is InvalidOperationException) return Results.Conflict(new {message=ex.Message});
        Log.Error(ex, "Error creating teacher");
        return Results.Json(new { statusCode = 500, message = "Error creating teacher" }, statusCode: 500);
    }
});

teachersWrites.MapPut("/{id}", async (string id, UpdateTeacherCommand request, IMediator mediator, IValidator<UpdateTeacherCommand> validator) =>
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex)
    {
        Log.Error(ex, "Error updating teacher");
        return Results.Json(new { statusCode = 500, message = "Error updating teacher" }, statusCode: 500);
    }
});

teachersWrites.MapDelete("/{id}", async (string id, IMediator mediator, string? schoolId = null) =>
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
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex)
    {
        Log.Error(ex, "Error deleting teacher");
        return Results.Json(new { statusCode = 500, message = "Error deleting teacher" }, statusCode: 500);
    }
});

app.Run();


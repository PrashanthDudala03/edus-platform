using System.Reflection;
using System.Security.Cryptography;
using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Services.Auth.Data;
using Services.Auth.Handlers;
using Services.Auth.Models;
using Services.Auth.Services;
using Services.Auth.Validation;

var builder = WebApplication.CreateBuilder(args);

// Serilog
builder.Host.UseSerilog((context, config) =>
    config
        .MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/auth-service-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "Auth-Service"));

// Configuration from .env
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("DefaultConnection not found");

// Decode RSA keys from base64 (stored this way in .env for docker-compose compatibility)
var jwtPrivateKeyB64 = builder.Configuration["JWT_PRIVATE_KEY"]
    ?? throw new InvalidOperationException("JWT_PRIVATE_KEY not found");
var jwtPublicKeyB64 = builder.Configuration["JWT_PUBLIC_KEY"]
    ?? throw new InvalidOperationException("JWT_PUBLIC_KEY not found");

var jwtPrivateKeyPem = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(jwtPrivateKeyB64));
var jwtPublicKeyPem = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(jwtPublicKeyB64));

// Register DbContext
builder.Services.AddDbContext<AuthDbContext>(options =>
    options.UseNpgsql(connectionString, opt =>
        opt.MigrationsHistoryTable("__EFMigrationsHistory", "auth_db")));

// Register MediatR
builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblyContaining<LoginCommandHandler>());

// Register Validation
builder.Services.AddValidatorsFromAssemblyContaining<LoginCommandValidator>();

// Register JWT service
builder.Services.AddSingleton(new JwtSettings
{
    PrivateKeyPem = jwtPrivateKeyPem,
    PublicKeyPem = jwtPublicKeyPem,
    Issuer = "edus-auth-service",
    ExpirationMinutes = 60,
    RefreshTokenExpirationDays = 7
});

builder.Services.AddScoped<IJwtService, JwtService>();
builder.Services.AddScoped<IPasswordService, PasswordService>();

// Generate correct password hash for initialization
var correctHashForAdmin123 = BCrypt.Net.BCrypt.HashPassword("admin123", workFactor: 12);
Log.Information("CORRECT BCrypt hash for 'admin123' with cost 12: {Hash}", correctHashForAdmin123);

// Register repositories
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();

// CORS - Allow frontend to call this service directly
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(builder =>
    {
        builder.AllowAnyOrigin()
               .AllowAnyMethod()
               .AllowAnyHeader();
    });
});

// Health checks
builder.Services.AddHealthChecks();

var app = builder.Build();

// Use CORS middleware
app.UseCors();

// Apply migrations on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
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

// Auth endpoints
app.MapPost("/api/auth/login", async (LoginRequest request, IMediator mediator) =>
{
    try
    {
        var command = new LoginCommand(
            request.Username,
            request.Password,
            request.SchoolId ?? "550e8400-e29b-41d4-a716-446655440000");
        var result = await mediator.Send(command);
        return Results.Ok(new { statusCode = 200, data = result });
    }
    catch (FluentValidation.ValidationException ex)
    {
        return Results.BadRequest(new
        {
            statusCode = 400,
            message = "Validation failed",
            errors = ex.Errors.Select(e => new { field = e.PropertyName, message = e.ErrorMessage })
        });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Login failed");
        return Results.Json(
            new { statusCode = 401, message = "Invalid credentials" },
            statusCode: 401);
    }
});

app.MapPost("/api/auth/refresh", async (RefreshRequest request, IMediator mediator) =>
{
    try
    {
        var command = new RefreshTokenCommand(request.RefreshToken);
        var result = await mediator.Send(command);
        return Results.Ok(new { statusCode = 200, data = result });
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Token refresh failed");
        return Results.Json(
            new { statusCode = 401, message = "Invalid or expired refresh token" },
            statusCode: 401);
    }
});

// User endpoints
app.MapGet("/api/users", async (int page = 1, int pageSize = 20, string? schoolId = null, AuthDbContext db = null) =>
{
    if (string.IsNullOrEmpty(schoolId)) return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    if (!Guid.TryParse(schoolId, out var schoolIdGuid)) return Results.BadRequest(new { statusCode = 400, message = "Invalid schoolId" });

    var skip = (page - 1) * pageSize;
    var users = await db.Users
        .Where(u => u.SchoolId == schoolIdGuid && u.DeletedAt == null)
        .OrderBy(u => u.CreatedAt)
        .Skip(skip)
        .Take(pageSize)
        .Select(u => new { u.Id, u.Username, u.Email, u.FirstName, u.LastName, u.IsActive, u.CreatedAt })
        .ToListAsync();

    var totalCount = await db.Users.CountAsync(u => u.SchoolId == schoolIdGuid && u.DeletedAt == null);
    return Results.Ok(new { statusCode = 200, data = new { page, pageSize, totalCount, data = users } });
});

app.MapPost("/api/users", async (CreateUserRequest request, AuthDbContext db) =>
{
    if (!Guid.TryParse(request.SchoolId, out var schoolId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid schoolId" });
    if (!Guid.TryParse(request.RoleId, out var roleId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid roleId" });

    // Check username unique per school
    var existing = await db.Users.FirstOrDefaultAsync(u => u.SchoolId == schoolId && u.Username == request.Username && u.DeletedAt == null);
    if (existing != null) return Results.Json(new { statusCode = 409, message = "Username already exists for this school" }, statusCode: 409);

    // Check email unique per school
    var emailExists = await db.Users.FirstOrDefaultAsync(u => u.SchoolId == schoolId && u.Email == request.Email && u.DeletedAt == null);
    if (emailExists != null) return Results.Json(new { statusCode = 409, message = "Email already exists for this school" }, statusCode: 409);

    var user = new User
    {
        Id = Guid.NewGuid(),
        SchoolId = schoolId,
        Username = request.Username,
        Email = request.Email,
        FirstName = request.FirstName,
        LastName = request.LastName,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password, workFactor: 12),
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };

    db.Users.Add(user);
    await db.SaveChangesAsync();

    return Results.Json(new { statusCode = 201, data = new { user.Id, user.Username, user.Email, user.FirstName, user.LastName, user.IsActive } }, statusCode: 201);
});

app.MapPut("/api/users/{id}", async (string id, UpdateUserRequest request, AuthDbContext db) =>
{
    if (!Guid.TryParse(id, out var userId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid user ID" });

    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.DeletedAt == null);
    if (user == null) return Results.NotFound(new { statusCode = 404, message = "User not found" });

    if (!string.IsNullOrEmpty(request.Email) && request.Email != user.Email)
    {
        var emailExists = await db.Users.FirstOrDefaultAsync(u => u.SchoolId == user.SchoolId && u.Email == request.Email && u.DeletedAt == null && u.Id != userId);
        if (emailExists != null) return Results.Json(new { statusCode = 409, message = "Email already exists" }, statusCode: 409);
        user.Email = request.Email;
    }

    if (!string.IsNullOrEmpty(request.FirstName)) user.FirstName = request.FirstName;
    if (!string.IsNullOrEmpty(request.LastName)) user.LastName = request.LastName;
    if (request.IsActive.HasValue) user.IsActive = request.IsActive.Value;

    user.UpdatedAt = DateTime.UtcNow;
    db.Users.Update(user);
    await db.SaveChangesAsync();

    return Results.Ok(new { statusCode = 200, data = new { user.Id, user.Username, user.Email, user.FirstName, user.LastName, user.IsActive } });
});

app.MapDelete("/api/users/{id}", async (string id, string? schoolId, AuthDbContext db) =>
{
    if (!Guid.TryParse(id, out var userId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid user ID" });
    if (string.IsNullOrEmpty(schoolId)) return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    if (!Guid.TryParse(schoolId, out var schoolIdGuid)) return Results.BadRequest(new { statusCode = 400, message = "Invalid schoolId" });

    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.SchoolId == schoolIdGuid && u.DeletedAt == null);
    if (user == null) return Results.NotFound(new { statusCode = 404, message = "User not found" });

    // Guard: Prevent deletion of last Super Admin
    var superAdminCount = await db.Users.CountAsync(u =>
        u.SchoolId == schoolIdGuid &&
        u.DeletedAt == null &&
        u.IsActive &&
        u.RoleId != null);
    if (superAdminCount == 1 && user.IsActive) return Results.Json(new { statusCode = 409, message = "Cannot delete the last Super Admin for this school" }, statusCode: 409);

    user.DeletedAt = DateTime.UtcNow;
    user.IsActive = false;
    db.Users.Update(user);
    await db.SaveChangesAsync();

    return Results.Ok(new { statusCode = 200, message = "User deleted" });
});

app.Run();

// Request/Response models
public class LoginRequest
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string? SchoolId { get; set; }
}

public class RefreshRequest
{
    public string RefreshToken { get; set; } = string.Empty;
}

public class CreateUserRequest
{
    public string SchoolId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string RoleId { get; set; } = string.Empty;
}

public class UpdateUserRequest
{
    public string? Email { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public bool? IsActive { get; set; }
}


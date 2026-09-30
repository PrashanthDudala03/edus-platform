using System.Reflection;
using System.Security.Cryptography;
using EduOS.ServiceAuth;
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
    Issuer = builder.Configuration["JWT_ISSUER"] ?? "edus-auth-service",
    Audience = builder.Configuration["JWT_AUDIENCE"] ?? "edus-api",
    ExpirationMinutes = 60,
    RefreshTokenExpirationDays = 7
});

builder.Services.AddScoped<IJwtService, JwtService>();
builder.Services.AddScoped<IPasswordService, PasswordService>();

// Register repositories
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();

// Health checks
builder.Services.AddHealthChecks();

// Account and session endpoints verify the caller's access token with the shared rules.
builder.Services.AddEduOSAuthentication(builder.Configuration);

var app = builder.Build();

var bootstrapSchoolId = Guid.Parse(builder.Configuration["EDUOS_BOOTSTRAP_SCHOOL_ID"]
    ?? "550e8400-e29b-41d4-a716-446655440000");
var bootstrapSchoolName = builder.Configuration["EDUOS_BOOTSTRAP_SCHOOL_NAME"];
var bootstrapAdminUsername = builder.Configuration["EDUOS_BOOTSTRAP_ADMIN_USERNAME"];
var bootstrapAdminEmail = builder.Configuration["EDUOS_BOOTSTRAP_ADMIN_EMAIL"];
var bootstrapAdminPassword = builder.Configuration["EDUOS_BOOTSTRAP_ADMIN_PASSWORD"];

if (string.IsNullOrWhiteSpace(bootstrapSchoolName) || bootstrapSchoolName.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase) ||
    string.IsNullOrWhiteSpace(bootstrapAdminUsername) || bootstrapAdminUsername.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase) ||
    string.IsNullOrWhiteSpace(bootstrapAdminEmail) || bootstrapAdminEmail.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase) ||
    string.IsNullOrWhiteSpace(bootstrapAdminPassword) || bootstrapAdminPassword.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase) ||
    bootstrapAdminPassword.Length < 16 ||
    bootstrapAdminPassword.Contains("replace", StringComparison.OrdinalIgnoreCase))
{
    throw new InvalidOperationException("Set a school name and a unique bootstrap admin username, email, and password (at least 16 characters) before starting EduOS.");
}

// Apply migrations on startup and provision the first tenant/admin using only
// deployment-time secrets. No shared demo password is committed to the repo.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
    try
    {
        await AuthRecovery.Initialize(db);
        // Role model: school top role is Administrator; SuperAdmin exists only in the platform tenant.
        await RoleModel.Apply(db);
        await db.Database.ExecuteSqlRawAsync("SELECT 1 FROM auth_db.users LIMIT 1");
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO school_db.schools (id, name, is_active, subscription_tier, created_at, updated_at)
            VALUES ({bootstrapSchoolId}, {bootstrapSchoolName}, TRUE, 'trial', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
            """);

        var bootstrapRoles = new[]
        {
            (Name: "Administrator", Description: "School administrator", IsSystem: true),
            (Name: "Principal", Description: "School principal", IsSystem: true),
            (Name: "Teacher", Description: "Assigned classes and teaching", IsSystem: true),
            (Name: "Parent", Description: "Linked student family portal", IsSystem: true),
            (Name: "Student", Description: "Personal learning portal", IsSystem: true),
        };
        foreach (var role in bootstrapRoles)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO auth_db.roles (id, school_id, name, description, is_system_role, created_at, updated_at)
                VALUES ({Guid.NewGuid()}, {bootstrapSchoolId}, {role.Name}, {role.Description}, {role.IsSystem}, NOW(), NOW())
                ON CONFLICT (school_id, name) DO NOTHING
                """);
        }

        var bootstrapRoleId = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM auth_db.roles
            WHERE school_id = {bootstrapSchoolId} AND name = 'Administrator'
            """).SingleAsync();

        if (!await db.Users.AnyAsync(user => user.SchoolId == bootstrapSchoolId && user.Username == bootstrapAdminUsername))
        {
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                SchoolId = bootstrapSchoolId,
                Username = bootstrapAdminUsername,
                Email = bootstrapAdminEmail,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(bootstrapAdminPassword, workFactor: 12),
                FirstName = "School",
                LastName = "Administrator",
                RoleId = bootstrapRoleId,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
        await RoleModel.ProvisionPlatformAdmin(db, builder.Configuration);
        Log.Information("Database schema verified");
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Database initialization failed");
        throw;
    }
}

app.Use(async (context,next)=>{try{await next();}catch(DbUpdateException){context.Response.StatusCode=409;await context.Response.WriteAsJsonAsync(new{message="A record with these details already exists or the update conflicts with another change."});}});
app.UseRouting();
app.UseEduOSAuthorization("/api", "/api/health", "/api/auth/login", "/api/auth/refresh", "/api/auth/reset-password");

// Health endpoint - return Prometheus metrics format
app.MapGet("/api/health", async (AuthDbContext db) => {try { return await db.Database.CanConnectAsync() ? Results.Ok(new {status="ready"}) : Results.StatusCode(503); } catch { return Results.StatusCode(503); }}).AllowAnonymous();

app.MapGet("/api/roles", async (string? schoolId, AuthDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
    {
        return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    }

    var roles = await db.Roles
        .Where(role => role.SchoolId == schoolIdGuid && role.Name != EduOSRoles.SuperAdmin)
        .OrderBy(role => role.Name)
        .Select(role => new { id = role.Id, name = role.Name })
        .ToListAsync();
    return Results.Ok(new { statusCode = 200, data = roles });
}).RequireAuthorization(EduOSPolicies.Administrators);

// Auth endpoints: login and refresh are the only anonymous account operations besides password recovery.
var publicAuth = app.MapGroup("/api/auth").AllowAnonymous();
publicAuth.MapPost("/login", async (LoginRequest request, IMediator mediator) =>
{
    try
    {
        var command = new LoginCommand(
            request.Username,
            request.Password,
            request.SchoolId ?? string.Empty);
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
    catch (LoginRejectedException ex)
    {
        return Results.Json(new { statusCode = ex.Status, message = ex.Message }, statusCode: ex.Status);
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Login failed");
        return Results.Json(
            new { statusCode = 401, message = "Invalid credentials" },
            statusCode: 401);
    }
});

publicAuth.MapPost("/refresh", async (RefreshRequest request, IMediator mediator, AuthDbContext db) =>
{
    try
    {
        await using var tx=await db.Database.BeginTransactionAsync();
        var command = new RefreshTokenCommand(request.RefreshToken);
        var result = await mediator.Send(command);
        await tx.CommitAsync();
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

app.MapPost("/api/auth/logout", async (RefreshRequest request, IRefreshTokenRepository repository) =>
{
    if (string.IsNullOrWhiteSpace(request.RefreshToken))
    {
        return Results.Ok(new { statusCode = 200, message = "Signed out" });
    }

    var storedToken = await repository.GetByTokenAsync(request.RefreshToken);
    if (storedToken is not null)
    {
        await repository.RevokeAsync(storedToken.Id);
    }

    return Results.Ok(new { statusCode = 200, message = "Signed out" });
}).RequireAuthorization(EduOSPolicies.AnyRole);

// Called by the gateway with the caller's own bearer token; a token may only inspect its own session.
app.MapGet("/api/internal/session/{id:guid}", async (Guid id, TenantContext tenant, AuthDbContext db) => {
    if (id != tenant.UserId) return Results.Forbid();
    if (!await RoleModel.SchoolIsActive(db, tenant.SchoolId)) return Results.Unauthorized();
    var user=await db.Users.Include(u=>u.Role).FirstOrDefaultAsync(u=>u.Id==id && u.SchoolId==tenant.SchoolId && u.IsActive);
    return user?.Role is null ? Results.Unauthorized() : Results.Ok(new{role=user.Role.Name,version=user.TokenVersion});
}).RequireAuthorization(EduOSPolicies.AnyRole);

// User endpoints: school administration only.
var userAccounts = app.MapGroup("/api/users").RequireAuthorization(EduOSPolicies.Administrators);
userAccounts.MapGet("", async (AuthDbContext db, int page = 1, int pageSize = 20, string? schoolId = null) =>
{
    if (string.IsNullOrEmpty(schoolId)) return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    if (!Guid.TryParse(schoolId, out var schoolIdGuid)) return Results.BadRequest(new { statusCode = 400, message = "Invalid schoolId" });

    if(page<1 || pageSize<1 || pageSize>100) return Results.BadRequest(new {message="Invalid pagination."});
    var skip = (page - 1) * pageSize;
    var users = await db.Users
        .Where(u => u.SchoolId == schoolIdGuid && u.DeletedAt == null)
        .OrderBy(u => u.CreatedAt)
        .Skip(skip)
        .Take(pageSize)
        .Select(u => new { u.Id, u.Username, u.Email, u.FirstName, u.LastName, u.IsActive, u.CreatedAt, Role = u.Role != null ? u.Role.Name : "" })
        .ToListAsync();

    var totalCount = await db.Users.CountAsync(u => u.SchoolId == schoolIdGuid && u.DeletedAt == null);
    return Results.Ok(new { statusCode = 200, data = new { page, pageSize, totalCount, data = users } });
});

userAccounts.MapPost("", async (CreateUserRequest request, AuthDbContext db) =>
{
    if (!Guid.TryParse(request.SchoolId, out var schoolId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid schoolId" });
    if (!Guid.TryParse(request.RoleId, out var roleId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid roleId" });
    var role = await db.Roles.FirstOrDefaultAsync(item => item.Id == roleId && item.SchoolId == schoolId);
    if (role == null || role.Name == EduOSRoles.SuperAdmin) return Results.BadRequest(new { statusCode = 400, message = "Role does not belong to this school" });

    if(string.IsNullOrWhiteSpace(request.Username) || request.Username.Length>100 || string.IsNullOrWhiteSpace(request.FirstName) || request.FirstName.Length>100 || string.IsNullOrWhiteSpace(request.LastName) || request.LastName.Length>100 || request.Password.Length<16 || request.Password.Length>72 || !System.Net.Mail.MailAddress.TryCreate(request.Email,out _)) return Results.BadRequest(new {message="Enter valid account details and a password between 16 and 72 characters."});
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
        RoleId = roleId,
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };

    db.Users.Add(user);
    await db.SaveChangesAsync();

    return Results.Json(new { statusCode = 201, data = new { user.Id, user.Username, user.Email, user.FirstName, user.LastName, user.IsActive } }, statusCode: 201);
});

userAccounts.MapPut("/{id}", async (string id, UpdateUserRequest request, string? schoolId, TenantContext tenant, AuthDbContext db) =>
{
    if (!Guid.TryParse(id, out var userId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid user ID" });
    if (string.IsNullOrWhiteSpace(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid)) return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });

    await using var changeTransaction=await db.Database.BeginTransactionAsync();
    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({schoolIdGuid.ToString()},0))");
    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.SchoolId == schoolIdGuid && u.DeletedAt == null);
    if (user == null) return Results.NotFound(new { statusCode = 404, message = "User not found" });

    if (!string.IsNullOrEmpty(request.Email) && request.Email != user.Email)
    {
        var emailExists = await db.Users.FirstOrDefaultAsync(u => u.SchoolId == user.SchoolId && u.Email == request.Email && u.DeletedAt == null && u.Id != userId);
        if (emailExists != null) return Results.Json(new { statusCode = 409, message = "Email already exists" }, statusCode: 409);
        user.Email = request.Email;
    }

    if (!string.IsNullOrEmpty(request.FirstName)) user.FirstName = request.FirstName;
    if (!string.IsNullOrEmpty(request.LastName)) user.LastName = request.LastName;
    var isAdministrator = await db.Roles.AnyAsync(r=>r.Id==user.RoleId && r.Name==EduOSRoles.Administrator);
    var lastAdministrator = isAdministrator && user.IsActive && await db.Users.CountAsync(u=>u.SchoolId==schoolIdGuid && u.IsActive && u.DeletedAt==null && u.Role!=null && u.Role.Name==EduOSRoles.Administrator)<=1;
    if(request.IsActive==false && lastAdministrator) return Results.Conflict(new {message="The last active school administrator cannot be disabled."});
    var endSessions = request.IsActive == false && user.IsActive;
    if (!string.IsNullOrWhiteSpace(request.RoleId))
    {
        // Role assignment stays inside this school and can never grant the platform role.
        if (!Guid.TryParse(request.RoleId, out var newRoleId)) return Results.BadRequest(new { message = "Invalid roleId" });
        var newRole = await db.Roles.FirstOrDefaultAsync(r => r.Id == newRoleId && r.SchoolId == schoolIdGuid && r.Name != EduOSRoles.SuperAdmin);
        if (newRole == null) return Results.BadRequest(new { message = "Role does not belong to this school" });
        if (newRole.Id != user.RoleId)
        {
            if (user.Id == tenant.UserId) return Results.Conflict(new { message = "You cannot change your own role." });
            if (lastAdministrator) return Results.Conflict(new { message = "The last active school administrator must keep the Administrator role." });
            user.RoleId = newRole.Id; user.TokenVersion++; endSessions = true;
        }
    }
    if (request.IsActive.HasValue && user.IsActive!=request.IsActive.Value) {user.TokenVersion++; user.IsActive = request.IsActive.Value;}

    user.UpdatedAt = DateTime.UtcNow;
    db.Users.Update(user);
    await db.SaveChangesAsync();
    // Disabling or a role change ends every session: a refresh token issued earlier must not resume it later.
    if (endSessions) await db.RefreshTokens.IgnoreQueryFilters().Where(t => t.UserId == user.Id && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
    await changeTransaction.CommitAsync();

    return Results.Ok(new { statusCode = 200, data = new { user.Id, user.Username, user.Email, user.FirstName, user.LastName, user.IsActive } });
});

userAccounts.MapDelete("/{id}", async (string id, string? schoolId, AuthDbContext db) =>
{
    if (!Guid.TryParse(id, out var userId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid user ID" });
    if (string.IsNullOrEmpty(schoolId)) return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    if (!Guid.TryParse(schoolId, out var schoolIdGuid)) return Results.BadRequest(new { statusCode = 400, message = "Invalid schoolId" });

    await using var changeTransaction=await db.Database.BeginTransactionAsync();
    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({schoolIdGuid.ToString()},0))");
    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.SchoolId == schoolIdGuid && u.DeletedAt == null);
    if (user == null) return Results.NotFound(new { statusCode = 404, message = "User not found" });

    // Guard: Prevent deletion of last Super Admin
    var superAdminCount = await db.Users.CountAsync(u =>
        u.SchoolId == schoolIdGuid &&
        u.DeletedAt == null &&
        u.IsActive &&
        u.Role != null && u.Role.Name == EduOSRoles.Administrator);
    if (superAdminCount == 1 && user.IsActive && await db.Roles.AnyAsync(r=>r.Id==user.RoleId && r.Name==EduOSRoles.Administrator)) return Results.Json(new { statusCode = 409, message = "Cannot delete the last administrator for this school" }, statusCode: 409);

    user.DeletedAt = DateTime.UtcNow;
    user.IsActive = false;
    db.Users.Update(user);
    await db.SaveChangesAsync();
    await changeTransaction.CommitAsync();

    return Results.Ok(new { statusCode = 200, message = "User deleted" });
});

AuthRecovery.Map(app);
PlatformAdmin.Map(app);
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
    public string? RoleId { get; set; }
}

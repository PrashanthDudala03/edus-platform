using EduOS.ServiceAuth;
using Microsoft.EntityFrameworkCore;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, config) =>
    config.MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/school-service-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "School-Service"));

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("DefaultConnection not found");

builder.Services.AddDbContext<SchoolDbContext>(options =>
    options.UseNpgsql(connectionString, opt => opt.MigrationsHistoryTable("__EFMigrationsHistory", "school_db"))
        .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));

builder.Services.AddHealthChecks();

// This service verifies access tokens itself; it does not trust gateway headers.
builder.Services.AddEduOSAuthentication(builder.Configuration);

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SchoolDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1 FROM school_db.schools LIMIT 1");
        Log.Information("Database schema verified");
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Database schema validation failed");
        throw;
    }
}

app.UseRouting();
// Provider webhooks carry no EduOS session: each provider path is listed exactly (the list is exact-match), and the
// provider signature inside the handler is the only credential.
app.UseEduOSAuthorization("/api", "/api/health", "/api/fees/webhooks/fake", "/api/fees/webhooks/razorpay");
// Health endpoint - return Prometheus metrics format
app.MapGet("/api/health", async (SchoolDbContext db) => {try { return await db.Database.CanConnectAsync() ? Results.Ok(new {status="ready"}) : Results.StatusCode(503); } catch { return Results.StatusCode(503); }}).AllowAnonymous();

// School profile: leadership reads, administrators change. The path schoolId must match the verified token.
var schools = app.MapGroup("/api/schools").RequireAuthorization(EduOSPolicies.Leadership);
schools.MapGet("/{schoolId}", async (string schoolId, SchoolDbContext db) =>
{
    if (!Guid.TryParse(schoolId, out var id)) return Results.BadRequest(new { statusCode = 400, message = "Invalid ID" });
    try
    {
        var school = await db.Schools.FirstOrDefaultAsync(s => s.Id == id);
        if (school == null) return Results.NotFound(new { statusCode = 404, message = "School not found" });
        return Results.Ok(new { statusCode = 200, data = new { id = school.Id.ToString(), name = school.Name, principalName = school.PrincipalName } });
    }
    catch (Exception ex) { Log.Error(ex, "Error fetching school"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
});

schools.MapPut("/{schoolId}", async (string schoolId, SchoolUpdateRequest request, SchoolDbContext db) =>
{
    if (!Guid.TryParse(schoolId, out var id)) return Results.BadRequest(new {message="Invalid school ID"});
    if(string.IsNullOrWhiteSpace(request.Name)||request.Name.Length>255||request.PrincipalName?.Length>255) return Results.BadRequest(new {message="School name is required and profile fields must be at most 255 characters."});
    try
    {
        var school=await db.Schools.FirstOrDefaultAsync(s=>s.Id==id);
        if(school==null) return Results.NotFound(new{message="School not found"});
        if (!string.IsNullOrEmpty(request.Name)) school.Name = request.Name;
        if (!string.IsNullOrEmpty(request.PrincipalName)) school.PrincipalName = request.PrincipalName;
        school.UpdatedAt = DateTime.UtcNow;

        db.Schools.Update(school);
        await db.SaveChangesAsync();

        return Results.Ok(new { statusCode = 200, data = new { id = school.Id.ToString(), name = school.Name, principalName = school.PrincipalName } });
    }
    catch (Exception ex) { Log.Error(ex, "Error updating school"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
}).RequireAuthorization(EduOSPolicies.Administrators);

await Operations.Initialize(connectionString);
Operations.Map(app, connectionString);
await Suite.Initialize(connectionString);
Suite.Map(app);
await Suite.InitializeNotifications();
await Suite.InitializeAttendance();
await Suite.InitializeFees();
Suite.MapNotifications(app);
Suite.MapFeeWebhooks(app);
app.Run();

#region Models

public class School
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public string? PrincipalName { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class SchoolUpdateRequest
{
    public string? Name { get; set; }
    public string? PrincipalName { get; set; }
}

public class SchoolDbContext : DbContext
{
    public SchoolDbContext(DbContextOptions<SchoolDbContext> options) : base(options) { }
    public DbSet<School> Schools { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.HasDefaultSchema("school_db");
        modelBuilder.Entity<School>(e =>
        {
            e.ToTable("schools");
            e.HasKey(s => s.Id);
            e.Property(s => s.Id).HasColumnName("id");
            e.Property(s => s.Name).HasColumnName("name").HasMaxLength(255);
            e.Property(s => s.PrincipalName).HasColumnName("principal_name").HasMaxLength(255);
            e.Property(s => s.UpdatedAt).HasColumnName("updated_at");
        });
    }
}

#endregion


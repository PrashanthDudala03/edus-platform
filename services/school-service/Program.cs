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

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SchoolDbContext>();
    try
    {
        db.Database.Migrate();
        Log.Information("Database migrated successfully");
    }
    catch (Exception ex)
    {
        Log.Warning(ex, "Database migration skipped (schema may already exist)");
    }
}

app.UseRouting();
// Health endpoint - return Prometheus metrics format
app.MapGet("/api/health", () =>
{
    return Results.Text("# HELP service_health Service health status\n# TYPE service_health gauge\nservice_health 1\n", "text/plain; version=0.0.4");
});

app.MapGet("/api/schools/{schoolId}", async (string schoolId, SchoolDbContext db) =>
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

app.MapPut("/api/schools/{schoolId}", async (string schoolId, SchoolUpdateRequest request, SchoolDbContext db) =>
{
    if (!Guid.TryParse(schoolId, out var id)) return Results.BadRequest(new { statusCode = 400, message = "Invalid ID" });
    try
    {
        var school = await db.Schools.FirstOrDefaultAsync(s => s.Id == id);
        if (school == null) return Results.NotFound(new { statusCode = 404, message = "School not found" });

        if (!string.IsNullOrEmpty(request.Name)) school.Name = request.Name;
        if (!string.IsNullOrEmpty(request.PrincipalName)) school.PrincipalName = request.PrincipalName;
        school.UpdatedAt = DateTime.UtcNow;

        db.Schools.Update(school);
        await db.SaveChangesAsync();

        return Results.Ok(new { statusCode = 200, data = new { id = school.Id.ToString(), name = school.Name, principalName = school.PrincipalName } });
    }
    catch (Exception ex) { Log.Error(ex, "Error updating school"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
});

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


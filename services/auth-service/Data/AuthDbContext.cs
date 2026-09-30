using Microsoft.EntityFrameworkCore;
using Services.Auth.Models;

namespace Services.Auth.Data;

public class AuthDbContext : DbContext
{
    public AuthDbContext(DbContextOptions<AuthDbContext> options) : base(options) { }

    public DbSet<User> Users { get; set; } = null!;
    public DbSet<RefreshToken> RefreshTokens { get; set; } = null!;
    public DbSet<Role> Roles { get; set; } = null!;
    public DbSet<RolePermission> RolePermissions { get; set; } = null!;
    public DbSet<PermissionDefinition> Permissions => Set<PermissionDefinition>();
    public DbSet<RoleTemplate> Templates => Set<RoleTemplate>();
    public DbSet<SchoolAccessBoundary> Boundaries => Set<SchoolAccessBoundary>();
    public DbSet<SignupRequest> Signups => Set<SignupRequest>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.HasDefaultSchema("auth_db");
        modelBuilder.Entity<PermissionDefinition>().ToTable("permissions").HasKey(x => x.Key);
        modelBuilder.Entity<RoleTemplate>().ToTable("role_templates").HasKey(x => x.Id);
        modelBuilder.Entity<SchoolAccessBoundary>().ToTable("school_access").HasKey(x => x.SchoolId);
        modelBuilder.Entity<SignupRequest>().ToTable("signup_requests").HasKey(x => x.Id);
        foreach (var type in new[] { typeof(PermissionDefinition), typeof(RoleTemplate), typeof(SchoolAccessBoundary), typeof(SignupRequest) })
            foreach (var property in modelBuilder.Entity(type).Metadata.GetProperties())
                property.SetColumnName(System.Text.RegularExpressions.Regex.Replace(property.Name, "(?<!^)([A-Z])", "_$1").ToLowerInvariant());

        // Users table (map to lowercase 'users' created by init-db.sql)
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Username).HasColumnName("username").IsRequired().HasMaxLength(255);
            entity.Property(e => e.Email).HasColumnName("email").IsRequired().HasMaxLength(255);
            entity.Property(e => e.PasswordHash).HasColumnName("password_hash").IsRequired();
            entity.Property(e => e.FirstName).HasColumnName("first_name").HasMaxLength(255);
            entity.Property(e => e.LastName).HasColumnName("last_name").HasMaxLength(255);
            entity.Property(e => e.PhoneNumber).HasColumnName("phone_number").HasMaxLength(20);
            entity.Property(e => e.SchoolId).HasColumnName("school_id").IsRequired();
            entity.Property(e => e.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at");
            entity.Property(e => e.LastLoginAt).HasColumnName("last_login_at");
            entity.Property(e => e.CreatedByUserId).HasColumnName("created_by_user_id");
            entity.Property(e => e.RoleId).HasColumnName("role_id");
            entity.Property(e => e.TokenVersion).HasColumnName("token_version");
            entity.HasOne(e => e.Role).WithMany().HasForeignKey(e => e.RoleId);

            entity.HasIndex(e => new { e.SchoolId, e.Username }).IsUnique();
            entity.HasIndex(e => new { e.SchoolId, e.Email }).IsUnique();
            entity.HasIndex(e => e.SchoolId);

            // Soft delete
            entity.HasQueryFilter(e => e.DeletedAt == null);
        });

        modelBuilder.Entity<Role>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(role => role.Id);
            entity.Property(role => role.Id).HasColumnName("id");
            entity.Property(role => role.SchoolId).HasColumnName("school_id");
            entity.Property(role => role.Name).HasColumnName("name").HasMaxLength(100);
            entity.Property(role => role.TemplateId).HasColumnName("template_id");
            entity.Property(role => role.Enabled).HasColumnName("enabled");
            entity.Property(role => role.Assignable).HasColumnName("assignable");
            entity.Property(role => role.Description).HasColumnName("description");
            entity.HasMany(role => role.Permissions).WithOne().HasForeignKey(permission => permission.RoleId);
        });

        modelBuilder.Entity<RolePermission>(entity =>
        {
            entity.ToTable("role_permissions");
            entity.HasKey(permission => permission.Id);
            entity.Property(permission => permission.Id).HasColumnName("id");
            entity.Property(permission => permission.RoleId).HasColumnName("role_id");
            entity.Property(permission => permission.PermissionKey).HasColumnName("permission_key").HasMaxLength(100);
        });

        // RefreshTokens table (map to lowercase 'refresh_tokens' created by init-db.sql)
        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.ToTable("refresh_tokens");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(e => e.SchoolId).HasColumnName("school_id").IsRequired();
            entity.Property(e => e.Token).HasColumnName("token").IsRequired();
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at").IsRequired();
            entity.Property(e => e.RevokedAt).HasColumnName("revoked_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasIndex(e => new { e.SchoolId, e.Token });
            entity.HasIndex(e => e.SchoolId);

            // Soft delete
            entity.HasQueryFilter(e => e.RevokedAt == null && e.ExpiresAt > DateTime.UtcNow);
        });
    }
}

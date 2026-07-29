using Microsoft.EntityFrameworkCore;
using TeacherService.Models;

namespace TeacherService.Data;

public class TeacherDbContext : DbContext
{
    public TeacherDbContext(DbContextOptions<TeacherDbContext> options) : base(options) { }

    public DbSet<Teacher> Teachers { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.HasDefaultSchema("teacher_db");

        modelBuilder.Entity<Teacher>(entity =>
        {
            entity.ToTable("teachers");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SchoolId).HasColumnName("school_id").IsRequired();
            entity.Property(e => e.EmployeeCode).HasColumnName("employee_code").IsRequired().HasMaxLength(50);
            entity.Property(e => e.FirstName).HasColumnName("first_name").IsRequired().HasMaxLength(100);
            entity.Property(e => e.LastName).HasColumnName("last_name").IsRequired().HasMaxLength(100);
            entity.Property(e => e.Email).HasColumnName("email").IsRequired().HasMaxLength(255);
            entity.Property(e => e.PhoneNumber).HasColumnName("phone_number").HasMaxLength(20);
            entity.Property(e => e.DateOfBirth).HasColumnName("date_of_birth");
            entity.Property(e => e.Qualification).HasColumnName("qualification").HasMaxLength(255);
            entity.Property(e => e.DateOfJoining).HasColumnName("date_of_joining");
            entity.Property(e => e.Department).HasColumnName("department").HasMaxLength(100);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(50).HasDefaultValue("Active");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at")
                .HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at")
                .HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at")
                .HasConversion(v => v, v => v.HasValue ? (v.Value.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v.Value) : null);

            entity.HasIndex(e => new { e.SchoolId, e.EmployeeCode }).IsUnique();
            entity.HasIndex(e => e.SchoolId);

            entity.HasQueryFilter(e => e.DeletedAt == null);
        });
    }
}

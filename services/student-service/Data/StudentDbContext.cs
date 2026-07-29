using Microsoft.EntityFrameworkCore;
using StudentService.Models;

namespace StudentService.Data;

public class StudentDbContext : DbContext
{
    public StudentDbContext(DbContextOptions<StudentDbContext> options) : base(options) { }

    public DbSet<Student> Students { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.HasDefaultSchema("student_db");

        modelBuilder.Entity<Student>(entity =>
        {
            entity.ToTable("students");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SchoolId).HasColumnName("school_id").IsRequired();
            entity.Property(e => e.RollNumber).HasColumnName("roll_number").IsRequired().HasMaxLength(50);
            entity.Property(e => e.FirstName).HasColumnName("first_name").IsRequired().HasMaxLength(255);
            entity.Property(e => e.LastName).HasColumnName("last_name").IsRequired().HasMaxLength(255);
            entity.Property(e => e.Email).HasColumnName("email").IsRequired().HasMaxLength(255);
            entity.Property(e => e.PhoneNumber).HasColumnName("phone_number").HasMaxLength(20);
            entity.Property(e => e.CurrentClass).HasColumnName("current_class").IsRequired().HasMaxLength(50);
            entity.Property(e => e.DateOfBirth).HasColumnName("date_of_birth").IsRequired()
                .HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            entity.Property(e => e.AdmissionDate).HasColumnName("admission_date").IsRequired()
                .HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(50).HasDefaultValue("Active");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at")
                .HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at")
                .HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at")
                .HasConversion(v => v, v => v.HasValue ? (v.Value.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v.Value) : null);

            entity.HasIndex(e => new { e.SchoolId, e.RollNumber }).IsUnique();
            entity.HasIndex(e => new { e.SchoolId, e.Email }).IsUnique();
            entity.HasIndex(e => e.SchoolId);

            entity.HasQueryFilter(e => e.DeletedAt == null);
        });
    }
}

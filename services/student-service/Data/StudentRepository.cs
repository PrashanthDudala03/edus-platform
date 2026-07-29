using Microsoft.EntityFrameworkCore;
using StudentService.Models;

namespace StudentService.Data;

public interface IStudentRepository
{
    Task<Student?> GetByIdAsync(Guid id, Guid schoolId);
    Task<(List<Student> students, int totalCount)> GetBySchoolAsync(Guid schoolId, int page, int pageSize);
    Task<Student?> GetByRollNumberAsync(Guid schoolId, string rollNumber);
    Task<int> GetCountAsync(Guid schoolId);
    Task CreateAsync(Student student);
    Task UpdateAsync(Student student);
    Task DeleteAsync(Guid id);
    Task SaveChangesAsync();
}

public class StudentRepository : IStudentRepository
{
    private readonly StudentDbContext _context;

    public StudentRepository(StudentDbContext context)
    {
        _context = context;
    }

    public async Task<Student?> GetByIdAsync(Guid id, Guid schoolId)
    {
        return await _context.Students
            .FirstOrDefaultAsync(s => s.Id == id && s.SchoolId == schoolId);
    }

    public async Task<(List<Student> students, int totalCount)> GetBySchoolAsync(Guid schoolId, int page, int pageSize)
    {
        var query = _context.Students.Where(s => s.SchoolId == schoolId);
        var totalCount = await query.CountAsync();
        var students = await query
            .OrderBy(s => s.RollNumber)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
        return (students, totalCount);
    }

    public async Task<Student?> GetByRollNumberAsync(Guid schoolId, string rollNumber)
    {
        return await _context.Students
            .FirstOrDefaultAsync(s => s.SchoolId == schoolId && s.RollNumber == rollNumber);
    }

    public async Task<int> GetCountAsync(Guid schoolId)
    {
        return await _context.Students.CountAsync(s => s.SchoolId == schoolId);
    }

    public async Task CreateAsync(Student student)
    {
        await _context.Students.AddAsync(student);
        await _context.SaveChangesAsync();
    }

    public async Task UpdateAsync(Student student)
    {
        student.UpdatedAt = DateTime.UtcNow;
        _context.Students.Update(student);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(Guid id)
    {
        var student = await _context.Students.FindAsync(id);
        if (student != null)
        {
            student.DeletedAt = DateTime.UtcNow;
            _context.Students.Update(student);
            await _context.SaveChangesAsync();
        }
    }

    public async Task SaveChangesAsync()
    {
        await _context.SaveChangesAsync();
    }
}

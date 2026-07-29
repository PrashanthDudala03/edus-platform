using Microsoft.EntityFrameworkCore;
using TeacherService.Models;

namespace TeacherService.Data;

public interface ITeacherRepository
{
    Task<Teacher?> GetByIdAsync(Guid id, Guid schoolId);
    Task<(List<Teacher> teachers, int totalCount)> GetBySchoolAsync(Guid schoolId, int page, int pageSize);
    Task<Teacher?> GetByEmployeeCodeAsync(Guid schoolId, string employeeCode);
    Task<int> GetCountAsync(Guid schoolId);
    Task CreateAsync(Teacher teacher);
    Task UpdateAsync(Teacher teacher);
    Task DeleteAsync(Guid id);
    Task SaveChangesAsync();
}

public class TeacherRepository : ITeacherRepository
{
    private readonly TeacherDbContext _context;

    public TeacherRepository(TeacherDbContext context)
    {
        _context = context;
    }

    public async Task<Teacher?> GetByIdAsync(Guid id, Guid schoolId)
    {
        return await _context.Teachers
            .FirstOrDefaultAsync(t => t.Id == id && t.SchoolId == schoolId);
    }

    public async Task<(List<Teacher> teachers, int totalCount)> GetBySchoolAsync(Guid schoolId, int page, int pageSize)
    {
        var query = _context.Teachers.Where(t => t.SchoolId == schoolId);
        var totalCount = await query.CountAsync();
        var teachers = await query
            .OrderBy(t => t.EmployeeCode)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
        return (teachers, totalCount);
    }

    public async Task<Teacher?> GetByEmployeeCodeAsync(Guid schoolId, string employeeCode)
    {
        return await _context.Teachers
            .FirstOrDefaultAsync(t => t.SchoolId == schoolId && t.EmployeeCode == employeeCode);
    }

    public async Task<int> GetCountAsync(Guid schoolId)
    {
        return await _context.Teachers.CountAsync(t => t.SchoolId == schoolId);
    }

    public async Task CreateAsync(Teacher teacher)
    {
        await _context.Teachers.AddAsync(teacher);
        await _context.SaveChangesAsync();
    }

    public async Task UpdateAsync(Teacher teacher)
    {
        teacher.UpdatedAt = DateTime.UtcNow;
        _context.Teachers.Update(teacher);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(Guid id)
    {
        var teacher = await _context.Teachers.FindAsync(id);
        if (teacher != null)
        {
            teacher.DeletedAt = DateTime.UtcNow;
            _context.Teachers.Update(teacher);
            await _context.SaveChangesAsync();
        }
    }

    public async Task SaveChangesAsync()
    {
        await _context.SaveChangesAsync();
    }
}

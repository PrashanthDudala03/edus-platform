using MediatR;
using Serilog;
using TeacherService.Data;
using TeacherService.Models;

namespace TeacherService.Handlers;

public class CreateTeacherCommand : IRequest<TeacherDto>
{
    public required Guid SchoolId { get; set; }
    public required string EmployeeCode { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public required string Department { get; set; }
}

public class CreateTeacherHandler : IRequestHandler<CreateTeacherCommand, TeacherDto>
{
    private readonly ITeacherRepository _teacherRepository;

    public CreateTeacherHandler(ITeacherRepository teacherRepository)
    {
        _teacherRepository = teacherRepository;
    }

    public async Task<TeacherDto> Handle(CreateTeacherCommand request, CancellationToken cancellationToken)
    {
        var existingByEmployeeCode = await _teacherRepository.GetByEmployeeCodeAsync(request.SchoolId, request.EmployeeCode);
        if (existingByEmployeeCode != null)
        {
            throw new InvalidOperationException($"Employee code {request.EmployeeCode} already exists in this school");
        }

        var teacher = new Teacher
        {
            Id = Guid.NewGuid(),
            SchoolId = request.SchoolId,
            EmployeeCode = request.EmployeeCode,
            FirstName = request.FirstName,
            LastName = request.LastName,
            Email = request.Email,
            PhoneNumber = request.PhoneNumber,
            Department = request.Department,
            Status = "Active",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        await _teacherRepository.CreateAsync(teacher);
        Log.Information("Teacher created: {TeacherId} {EmployeeCode} {FirstName} {LastName}",
            teacher.Id, teacher.EmployeeCode, teacher.FirstName, teacher.LastName);
        return teacher.ToDto();
    }
}

public class UpdateTeacherCommand : IRequest<TeacherDto>
{
    public required Guid Id { get; set; }
    public required Guid SchoolId { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public required string Department { get; set; }
    public required string Status { get; set; }
}

public class UpdateTeacherHandler : IRequestHandler<UpdateTeacherCommand, TeacherDto>
{
    private readonly ITeacherRepository _teacherRepository;

    public UpdateTeacherHandler(ITeacherRepository teacherRepository)
    {
        _teacherRepository = teacherRepository;
    }

    public async Task<TeacherDto> Handle(UpdateTeacherCommand request, CancellationToken cancellationToken)
    {
        var teacher = await _teacherRepository.GetByIdAsync(request.Id, request.SchoolId);
        if (teacher == null)
        {
            throw new InvalidOperationException("Teacher not found");
        }

        teacher.FirstName = request.FirstName;
        teacher.LastName = request.LastName;
        teacher.Email = request.Email;
        teacher.PhoneNumber = request.PhoneNumber;
        teacher.Department = request.Department;
        teacher.Status = request.Status;
        teacher.UpdatedAt = DateTime.UtcNow;

        await _teacherRepository.UpdateAsync(teacher);
        Log.Information("Teacher updated: {TeacherId}", teacher.Id);
        return teacher.ToDto();
    }
}

public class DeleteTeacherCommand : IRequest
{
    public required Guid Id { get; set; }
    public required Guid SchoolId { get; set; }
}

public class DeleteTeacherHandler : IRequestHandler<DeleteTeacherCommand>
{
    private readonly ITeacherRepository _teacherRepository;

    public DeleteTeacherHandler(ITeacherRepository teacherRepository)
    {
        _teacherRepository = teacherRepository;
    }

    public async Task Handle(DeleteTeacherCommand request, CancellationToken cancellationToken)
    {
        var teacher = await _teacherRepository.GetByIdAsync(request.Id, request.SchoolId);
        if (teacher == null)
        {
            throw new InvalidOperationException("Teacher not found");
        }

        await _teacherRepository.DeleteAsync(request.Id);
        Log.Information("Teacher deleted: {TeacherId}", request.Id);
    }
}

using MediatR;
using Serilog;
using StudentService.Data;
using StudentService.Models;

namespace StudentService.Handlers;

public class CreateStudentCommand : IRequest<StudentDto>
{
    public required Guid SchoolId { get; set; }
    public required string RollNumber { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public required string CurrentClass { get; set; }
    public required DateTime DateOfBirth { get; set; }
}

public class CreateStudentHandler : IRequestHandler<CreateStudentCommand, StudentDto>
{
    private readonly IStudentRepository _studentRepository;

    public CreateStudentHandler(IStudentRepository studentRepository)
    {
        _studentRepository = studentRepository;
    }

    public async Task<StudentDto> Handle(CreateStudentCommand request, CancellationToken cancellationToken)
    {
        var existingByRollNumber = await _studentRepository.GetByRollNumberAsync(request.SchoolId, request.RollNumber);
        if (existingByRollNumber != null)
        {
            throw new InvalidOperationException($"Roll number {request.RollNumber} already exists in this school");
        }

        var dateOfBirth = request.DateOfBirth.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(request.DateOfBirth, DateTimeKind.Utc)
            : request.DateOfBirth.ToUniversalTime();

        var student = new Student
        {
            Id = Guid.NewGuid(),
            SchoolId = request.SchoolId,
            RollNumber = request.RollNumber,
            FirstName = request.FirstName,
            LastName = request.LastName,
            Email = request.Email,
            PhoneNumber = request.PhoneNumber,
            CurrentClass = request.CurrentClass,
            DateOfBirth = dateOfBirth,
            Status = "Active",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        await _studentRepository.CreateAsync(student);
        Log.Information("Student created: {StudentId} {RollNumber} {FirstName} {LastName}",
            student.Id, student.RollNumber, student.FirstName, student.LastName);
        return student.ToDto();
    }
}

public class UpdateStudentCommand : IRequest<StudentDto>
{
    public required Guid Id { get; set; }
    public required Guid SchoolId { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public required string CurrentClass { get; set; }
    public required DateTime DateOfBirth { get; set; }
    public required string Status { get; set; }
}

public class UpdateStudentHandler : IRequestHandler<UpdateStudentCommand, StudentDto>
{
    private readonly IStudentRepository _studentRepository;

    public UpdateStudentHandler(IStudentRepository studentRepository)
    {
        _studentRepository = studentRepository;
    }

    public async Task<StudentDto> Handle(UpdateStudentCommand request, CancellationToken cancellationToken)
    {
        var student = await _studentRepository.GetByIdAsync(request.Id, request.SchoolId);
        if (student == null)
        {
            throw new InvalidOperationException("Student not found");
        }

        student.FirstName = request.FirstName;
        student.LastName = request.LastName;
        student.Email = request.Email;
        student.PhoneNumber = request.PhoneNumber;
        student.CurrentClass = request.CurrentClass;
        student.DateOfBirth = request.DateOfBirth.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(request.DateOfBirth, DateTimeKind.Utc)
            : request.DateOfBirth.ToUniversalTime();
        student.Status = request.Status;
        student.UpdatedAt = DateTime.UtcNow;

        await _studentRepository.UpdateAsync(student);
        Log.Information("Student updated: {StudentId}", student.Id);
        return student.ToDto();
    }
}

public class DeleteStudentCommand : IRequest
{
    public required Guid Id { get; set; }
    public required Guid SchoolId { get; set; }
}

public class DeleteStudentHandler : IRequestHandler<DeleteStudentCommand>
{
    private readonly IStudentRepository _studentRepository;

    public DeleteStudentHandler(IStudentRepository studentRepository)
    {
        _studentRepository = studentRepository;
    }

    public async Task Handle(DeleteStudentCommand request, CancellationToken cancellationToken)
    {
        var student = await _studentRepository.GetByIdAsync(request.Id, request.SchoolId);
        if (student == null)
        {
            throw new InvalidOperationException("Student not found");
        }

        await _studentRepository.DeleteAsync(request.Id);
        Log.Information("Student deleted: {StudentId}", request.Id);
    }
}

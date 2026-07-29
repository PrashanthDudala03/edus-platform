namespace TeacherService.Models;

public class Teacher
{
    public Guid Id { get; set; }
    public Guid SchoolId { get; set; }
    public required string EmployeeCode { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? Qualification { get; set; }
    public DateTime? DateOfJoining { get; set; }
    public string? Department { get; set; }
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }

    public TeacherDto ToDto() => new()
    {
        Id = Id.ToString(),
        EmployeeCode = EmployeeCode,
        FirstName = FirstName,
        LastName = LastName,
        Email = Email,
        PhoneNumber = PhoneNumber,
        Department = Department ?? "",
        Status = Status,
        SchoolId = SchoolId.ToString(),
    };
}

public class TeacherDto
{
    public required string Id { get; set; }
    public required string EmployeeCode { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public required string Department { get; set; }
    public required string Status { get; set; }
    public required string SchoolId { get; set; }
}

public class TeacherListResponse
{
    public required int Page { get; set; }
    public required int PageSize { get; set; }
    public required int TotalCount { get; set; }
    public required List<TeacherDto> Data { get; set; }
}

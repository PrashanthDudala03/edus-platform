namespace StudentService.Models;

public class Student
{
    public Guid Id { get; set; }
    public Guid SchoolId { get; set; }
    public required string RollNumber { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public required string CurrentClass { get; set; }
    public required DateTime DateOfBirth { get; set; }
    public DateTime AdmissionDate { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }

    public StudentDto ToDto() => new()
    {
        Id = Id.ToString(),
        RollNumber = RollNumber,
        FirstName = FirstName,
        LastName = LastName,
        Email = Email,
        PhoneNumber = PhoneNumber,
        CurrentClass = CurrentClass,
        Status = Status,
        SchoolId = SchoolId.ToString(),
    };
}

public class StudentDto
{
    public required string Id { get; set; }
    public required string RollNumber { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }
    public required string CurrentClass { get; set; }
    public required string Status { get; set; }
    public required string SchoolId { get; set; }
}

public class StudentListResponse
{
    public required int Page { get; set; }
    public required int PageSize { get; set; }
    public required int TotalCount { get; set; }
    public required List<StudentDto> Data { get; set; }
}

using System.Collections.Concurrent;
using EduOS.Shared;

var builder = WebApplicationBuilder.CreateBuilder(args);

builder.Services.AddSingleton<IStudentRepository, InMemoryStudentRepository>();
builder.Services.AddHealthChecks();
builder.Services.AddLogging();

var app = builder.Build();

// Health check endpoint
app.MapGet("/health", () =>
{
    return Results.Ok(new HealthCheckResponse
    {
        Status = "Healthy",
        Details = new Dictionary<string, object>
        {
            { "service", "Student Service" },
            { "version", "1.0.0" },
            { "database", "In-Memory" },
            { "uptime", DateTime.UtcNow }
        }
    });
}).WithName("StudentHealth").WithOpenApi();

// GET /students - Get all students
app.MapGet("/students", (IStudentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Retrieving all students");
    var students = repository.GetAll();
    return Results.Ok(ApiResponse<List<StudentDto>>.Ok(
        students.Select(s => s.ToDto()).ToList(),
        "Students retrieved successfully"
    ));
})
.WithName("GetAllStudents")
.WithOpenApi();

// GET /students/{id} - Get student by ID
app.MapGet("/students/{id}", (string id, IStudentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Retrieving student with ID: {StudentId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse<StudentDto>.Error("Student ID is required"));
    }

    var student = repository.GetById(id);
    if (student == null)
    {
        logger.LogWarning("Student not found with ID: {StudentId}", id);
        return Results.NotFound(ApiResponse<StudentDto>.Error("Student not found"));
    }

    return Results.Ok(ApiResponse<StudentDto>.Ok(student.ToDto(), "Student retrieved successfully"));
})
.WithName("GetStudentById")
.WithOpenApi();

// POST /students - Create student
app.MapPost("/students", (CreateStudentRequest request, IStudentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Creating new student: {FirstName} {LastName}", request.FirstName, request.LastName);

    var errors = ValidateCreateStudentRequest(request);
    if (errors.Count > 0)
    {
        logger.LogWarning("Student creation validation failed");
        return Results.BadRequest(ApiResponse<StudentDto>.Error("Validation failed", errors));
    }

    var student = new Student
    {
        Id = Guid.NewGuid().ToString(),
        FirstName = request.FirstName.Trim(),
        LastName = request.LastName.Trim(),
        Email = request.Email.Trim().ToLower(),
        RollNumber = request.RollNumber.Trim(),
        Grade = request.Grade.Trim(),
        EnrollmentDate = DateTime.UtcNow
    };

    repository.Add(student);

    logger.LogInformation("Student created successfully with ID: {StudentId}", student.Id);
    return Results.Created($"/students/{student.Id}",
        ApiResponse<StudentDto>.Ok(student.ToDto(), "Student created successfully"));
})
.WithName("CreateStudent")
.WithOpenApi();

// PUT /students/{id} - Update student
app.MapPut("/students/{id}", (string id, UpdateStudentRequest request, IStudentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Updating student with ID: {StudentId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse<StudentDto>.Error("Student ID is required"));
    }

    var errors = ValidateUpdateStudentRequest(request);
    if (errors.Count > 0)
    {
        logger.LogWarning("Student update validation failed for ID: {StudentId}", id);
        return Results.BadRequest(ApiResponse<StudentDto>.Error("Validation failed", errors));
    }

    var student = repository.GetById(id);
    if (student == null)
    {
        logger.LogWarning("Student not found for update with ID: {StudentId}", id);
        return Results.NotFound(ApiResponse<StudentDto>.Error("Student not found"));
    }

    student.FirstName = request.FirstName.Trim();
    student.LastName = request.LastName.Trim();
    student.Email = request.Email.Trim().ToLower();
    student.Grade = request.Grade.Trim();

    repository.Update(student);

    logger.LogInformation("Student updated successfully with ID: {StudentId}", student.Id);
    return Results.Ok(ApiResponse<StudentDto>.Ok(student.ToDto(), "Student updated successfully"));
})
.WithName("UpdateStudent")
.WithOpenApi();

// DELETE /students/{id} - Delete student
app.MapDelete("/students/{id}", (string id, IStudentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Deleting student with ID: {StudentId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse.Error("Student ID is required"));
    }

    var student = repository.GetById(id);
    if (student == null)
    {
        logger.LogWarning("Student not found for deletion with ID: {StudentId}", id);
        return Results.NotFound(ApiResponse.Error("Student not found"));
    }

    repository.Delete(id);

    logger.LogInformation("Student deleted successfully with ID: {StudentId}", id);
    return Results.Ok(ApiResponse.Ok("Student deleted successfully"));
})
.WithName("DeleteStudent")
.WithOpenApi();

app.Run();

// ============== Validation Helpers ==============

static Dictionary<string, string[]> ValidateCreateStudentRequest(CreateStudentRequest request)
{
    var errors = new Dictionary<string, string[]>();

    if (string.IsNullOrWhiteSpace(request.FirstName))
    {
        errors["FirstName"] = new[] { "First name is required" };
    }
    else if (request.FirstName.Length > 100)
    {
        errors["FirstName"] = new[] { "First name must not exceed 100 characters" };
    }

    if (string.IsNullOrWhiteSpace(request.LastName))
    {
        errors["LastName"] = new[] { "Last name is required" };
    }
    else if (request.LastName.Length > 100)
    {
        errors["LastName"] = new[] { "Last name must not exceed 100 characters" };
    }

    if (string.IsNullOrWhiteSpace(request.Email))
    {
        errors["Email"] = new[] { "Email is required" };
    }
    else if (!IsValidEmail(request.Email))
    {
        errors["Email"] = new[] { "Email format is invalid" };
    }

    if (string.IsNullOrWhiteSpace(request.RollNumber))
    {
        errors["RollNumber"] = new[] { "Roll number is required" };
    }

    if (string.IsNullOrWhiteSpace(request.Grade))
    {
        errors["Grade"] = new[] { "Grade is required" };
    }

    return errors;
}

static Dictionary<string, string[]> ValidateUpdateStudentRequest(UpdateStudentRequest request)
{
    var errors = new Dictionary<string, string[]>();

    if (string.IsNullOrWhiteSpace(request.FirstName))
    {
        errors["FirstName"] = new[] { "First name is required" };
    }
    else if (request.FirstName.Length > 100)
    {
        errors["FirstName"] = new[] { "First name must not exceed 100 characters" };
    }

    if (string.IsNullOrWhiteSpace(request.LastName))
    {
        errors["LastName"] = new[] { "Last name is required" };
    }
    else if (request.LastName.Length > 100)
    {
        errors["LastName"] = new[] { "Last name must not exceed 100 characters" };
    }

    if (string.IsNullOrWhiteSpace(request.Email))
    {
        errors["Email"] = new[] { "Email is required" };
    }
    else if (!IsValidEmail(request.Email))
    {
        errors["Email"] = new[] { "Email format is invalid" };
    }

    if (string.IsNullOrWhiteSpace(request.Grade))
    {
        errors["Grade"] = new[] { "Grade is required" };
    }

    return errors;
}

static bool IsValidEmail(string email)
{
    try
    {
        var addr = new System.Net.Mail.MailAddress(email);
        return addr.Address == email;
    }
    catch
    {
        return false;
    }
}

// ============== Repository ==============

public interface IStudentRepository
{
    List<Student> GetAll();
    Student? GetById(string id);
    void Add(Student student);
    void Update(Student student);
    void Delete(string id);
}

public class InMemoryStudentRepository : IStudentRepository
{
    private readonly ConcurrentDictionary<string, Student> _students;
    private readonly ILogger<InMemoryStudentRepository> _logger;

    public InMemoryStudentRepository(ILogger<InMemoryStudentRepository> logger)
    {
        _logger = logger;
        _students = new ConcurrentDictionary<string, Student>();

        // Seed with sample data
        var student1 = new Student
        {
            Id = Guid.NewGuid().ToString(),
            FirstName = "John",
            LastName = "Doe",
            Email = "john.doe@school.com",
            RollNumber = "STU001",
            Grade = "10A",
            EnrollmentDate = DateTime.UtcNow.AddMonths(-6)
        };

        var student2 = new Student
        {
            Id = Guid.NewGuid().ToString(),
            FirstName = "Jane",
            LastName = "Smith",
            Email = "jane.smith@school.com",
            RollNumber = "STU002",
            Grade = "10B",
            EnrollmentDate = DateTime.UtcNow.AddMonths(-5)
        };

        _students.TryAdd(student1.Id, student1);
        _students.TryAdd(student2.Id, student2);

        _logger.LogInformation("InMemoryStudentRepository initialized with {StudentCount} students", _students.Count);
    }

    public List<Student> GetAll()
    {
        return _students.Values.ToList();
    }

    public Student? GetById(string id)
    {
        _students.TryGetValue(id, out var student);
        return student;
    }

    public void Add(Student student)
    {
        _students.TryAdd(student.Id, student);
        _logger.LogInformation("Student added: {StudentId}", student.Id);
    }

    public void Update(Student student)
    {
        _students.AddOrUpdate(student.Id, student, (_, _) => student);
        _logger.LogInformation("Student updated: {StudentId}", student.Id);
    }

    public void Delete(string id)
    {
        _students.TryRemove(id, out _);
        _logger.LogInformation("Student deleted: {StudentId}", id);
    }
}

// ============== Extension Methods ==============

public static class StudentExtensions
{
    public static StudentDto ToDto(this Student student)
    {
        return new StudentDto
        {
            Id = student.Id,
            FirstName = student.FirstName,
            LastName = student.LastName,
            Email = student.Email,
            RollNumber = student.RollNumber,
            Grade = student.Grade,
            EnrollmentDate = student.EnrollmentDate
        };
    }
}

using System.Collections.Concurrent;
using EduOS.Shared;

var builder = WebApplicationBuilder.CreateBuilder(args);

builder.Services.AddSingleton<ITeacherRepository, InMemoryTeacherRepository>();
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
            { "service", "Teacher Service" },
            { "version", "1.0.0" },
            { "database", "In-Memory" },
            { "uptime", DateTime.UtcNow }
        }
    });
})
.WithName("TeacherHealth")
.WithOpenApi();

// GET /teachers - Get all teachers
app.MapGet("/teachers", (ITeacherRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Retrieving all teachers");
    var teachers = repository.GetAll();
    return Results.Ok(ApiResponse<List<TeacherDto>>.Ok(
        teachers.Select(t => t.ToDto()).ToList(),
        "Teachers retrieved successfully"
    ));
})
.WithName("GetAllTeachers")
.WithOpenApi();

// GET /teachers/{id} - Get teacher by ID
app.MapGet("/teachers/{id}", (string id, ITeacherRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Retrieving teacher with ID: {TeacherId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse<TeacherDto>.Error("Teacher ID is required"));
    }

    var teacher = repository.GetById(id);
    if (teacher == null)
    {
        logger.LogWarning("Teacher not found with ID: {TeacherId}", id);
        return Results.NotFound(ApiResponse<TeacherDto>.Error("Teacher not found"));
    }

    return Results.Ok(ApiResponse<TeacherDto>.Ok(teacher.ToDto(), "Teacher retrieved successfully"));
})
.WithName("GetTeacherById")
.WithOpenApi();

// POST /teachers - Create teacher
app.MapPost("/teachers", (CreateTeacherRequest request, ITeacherRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Creating new teacher: {FirstName} {LastName}", request.FirstName, request.LastName);

    var errors = ValidateCreateTeacherRequest(request);
    if (errors.Count > 0)
    {
        logger.LogWarning("Teacher creation validation failed");
        return Results.BadRequest(ApiResponse<TeacherDto>.Error("Validation failed", errors));
    }

    var teacher = new Teacher
    {
        Id = Guid.NewGuid().ToString(),
        FirstName = request.FirstName.Trim(),
        LastName = request.LastName.Trim(),
        Email = request.Email.Trim().ToLower(),
        Department = request.Department.Trim(),
        Specialization = request.Specialization.Trim(),
        JoiningDate = DateTime.UtcNow
    };

    repository.Add(teacher);

    logger.LogInformation("Teacher created successfully with ID: {TeacherId}", teacher.Id);
    return Results.Created($"/teachers/{teacher.Id}",
        ApiResponse<TeacherDto>.Ok(teacher.ToDto(), "Teacher created successfully"));
})
.WithName("CreateTeacher")
.WithOpenApi();

// PUT /teachers/{id} - Update teacher
app.MapPut("/teachers/{id}", (string id, UpdateTeacherRequest request, ITeacherRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Updating teacher with ID: {TeacherId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse<TeacherDto>.Error("Teacher ID is required"));
    }

    var errors = ValidateUpdateTeacherRequest(request);
    if (errors.Count > 0)
    {
        logger.LogWarning("Teacher update validation failed for ID: {TeacherId}", id);
        return Results.BadRequest(ApiResponse<TeacherDto>.Error("Validation failed", errors));
    }

    var teacher = repository.GetById(id);
    if (teacher == null)
    {
        logger.LogWarning("Teacher not found for update with ID: {TeacherId}", id);
        return Results.NotFound(ApiResponse<TeacherDto>.Error("Teacher not found"));
    }

    teacher.FirstName = request.FirstName.Trim();
    teacher.LastName = request.LastName.Trim();
    teacher.Email = request.Email.Trim().ToLower();
    teacher.Department = request.Department.Trim();
    teacher.Specialization = request.Specialization.Trim();

    repository.Update(teacher);

    logger.LogInformation("Teacher updated successfully with ID: {TeacherId}", teacher.Id);
    return Results.Ok(ApiResponse<TeacherDto>.Ok(teacher.ToDto(), "Teacher updated successfully"));
})
.WithName("UpdateTeacher")
.WithOpenApi();

// DELETE /teachers/{id} - Delete teacher
app.MapDelete("/teachers/{id}", (string id, ITeacherRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Deleting teacher with ID: {TeacherId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse.Error("Teacher ID is required"));
    }

    var teacher = repository.GetById(id);
    if (teacher == null)
    {
        logger.LogWarning("Teacher not found for deletion with ID: {TeacherId}", id);
        return Results.NotFound(ApiResponse.Error("Teacher not found"));
    }

    repository.Delete(id);

    logger.LogInformation("Teacher deleted successfully with ID: {TeacherId}", id);
    return Results.Ok(ApiResponse.Ok("Teacher deleted successfully"));
})
.WithName("DeleteTeacher")
.WithOpenApi();

app.Run();

// ============== Validation Helpers ==============

static Dictionary<string, string[]> ValidateCreateTeacherRequest(CreateTeacherRequest request)
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

    if (string.IsNullOrWhiteSpace(request.Department))
    {
        errors["Department"] = new[] { "Department is required" };
    }

    if (string.IsNullOrWhiteSpace(request.Specialization))
    {
        errors["Specialization"] = new[] { "Specialization is required" };
    }

    return errors;
}

static Dictionary<string, string[]> ValidateUpdateTeacherRequest(UpdateTeacherRequest request)
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

    if (string.IsNullOrWhiteSpace(request.Department))
    {
        errors["Department"] = new[] { "Department is required" };
    }

    if (string.IsNullOrWhiteSpace(request.Specialization))
    {
        errors["Specialization"] = new[] { "Specialization is required" };
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

public interface ITeacherRepository
{
    List<Teacher> GetAll();
    Teacher? GetById(string id);
    void Add(Teacher teacher);
    void Update(Teacher teacher);
    void Delete(string id);
}

public class InMemoryTeacherRepository : ITeacherRepository
{
    private readonly ConcurrentDictionary<string, Teacher> _teachers;
    private readonly ILogger<InMemoryTeacherRepository> _logger;

    public InMemoryTeacherRepository(ILogger<InMemoryTeacherRepository> logger)
    {
        _logger = logger;
        _teachers = new ConcurrentDictionary<string, Teacher>();

        // Seed with sample data
        var teacher1 = new Teacher
        {
            Id = Guid.NewGuid().ToString(),
            FirstName = "Robert",
            LastName = "Johnson",
            Email = "robert.johnson@school.com",
            Department = "Mathematics",
            Specialization = "Advanced Calculus",
            JoiningDate = DateTime.UtcNow.AddYears(-2)
        };

        var teacher2 = new Teacher
        {
            Id = Guid.NewGuid().ToString(),
            FirstName = "Sarah",
            LastName = "Williams",
            Email = "sarah.williams@school.com",
            Department = "Science",
            Specialization = "Biology",
            JoiningDate = DateTime.UtcNow.AddYears(-3)
        };

        _teachers.TryAdd(teacher1.Id, teacher1);
        _teachers.TryAdd(teacher2.Id, teacher2);

        _logger.LogInformation("InMemoryTeacherRepository initialized with {TeacherCount} teachers", _teachers.Count);
    }

    public List<Teacher> GetAll()
    {
        return _teachers.Values.ToList();
    }

    public Teacher? GetById(string id)
    {
        _teachers.TryGetValue(id, out var teacher);
        return teacher;
    }

    public void Add(Teacher teacher)
    {
        _teachers.TryAdd(teacher.Id, teacher);
        _logger.LogInformation("Teacher added: {TeacherId}", teacher.Id);
    }

    public void Update(Teacher teacher)
    {
        _teachers.AddOrUpdate(teacher.Id, teacher, (_, _) => teacher);
        _logger.LogInformation("Teacher updated: {TeacherId}", teacher.Id);
    }

    public void Delete(string id)
    {
        _teachers.TryRemove(id, out _);
        _logger.LogInformation("Teacher deleted: {TeacherId}", id);
    }
}

// ============== Extension Methods ==============

public static class TeacherExtensions
{
    public static TeacherDto ToDto(this Teacher teacher)
    {
        return new TeacherDto
        {
            Id = teacher.Id,
            FirstName = teacher.FirstName,
            LastName = teacher.LastName,
            Email = teacher.Email,
            Department = teacher.Department,
            Specialization = teacher.Specialization,
            JoiningDate = teacher.JoiningDate
        };
    }
}

using System.Collections.Concurrent;
using EduOS.Shared;

var builder = WebApplicationBuilder.CreateBuilder(args);

builder.Services.AddSingleton<IParentRepository, InMemoryParentRepository>();
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
            { "service", "Parent Service" },
            { "version", "1.0.0" },
            { "database", "In-Memory" },
            { "uptime", DateTime.UtcNow }
        }
    });
})
.WithName("ParentHealth")
.WithOpenApi();

// GET /parents - Get all parents
app.MapGet("/parents", (IParentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Retrieving all parents");
    var parents = repository.GetAll();
    return Results.Ok(ApiResponse<List<ParentDto>>.Ok(
        parents.Select(p => p.ToDto()).ToList(),
        "Parents retrieved successfully"
    ));
})
.WithName("GetAllParents")
.WithOpenApi();

// GET /parents/{id} - Get parent by ID
app.MapGet("/parents/{id}", (string id, IParentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Retrieving parent with ID: {ParentId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse<ParentDto>.Error("Parent ID is required"));
    }

    var parent = repository.GetById(id);
    if (parent == null)
    {
        logger.LogWarning("Parent not found with ID: {ParentId}", id);
        return Results.NotFound(ApiResponse<ParentDto>.Error("Parent not found"));
    }

    return Results.Ok(ApiResponse<ParentDto>.Ok(parent.ToDto(), "Parent retrieved successfully"));
})
.WithName("GetParentById")
.WithOpenApi();

// GET /parents/student/{studentId} - Get parents by student ID
app.MapGet("/parents/student/{studentId}", (string studentId, IParentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Retrieving parents for student ID: {StudentId}", studentId);

    if (string.IsNullOrWhiteSpace(studentId))
    {
        return Results.BadRequest(ApiResponse<List<ParentDto>>.Error("Student ID is required"));
    }

    var parents = repository.GetByStudentId(studentId);
    return Results.Ok(ApiResponse<List<ParentDto>>.Ok(
        parents.Select(p => p.ToDto()).ToList(),
        "Parents retrieved successfully"
    ));
})
.WithName("GetParentsByStudentId")
.WithOpenApi();

// POST /parents - Create parent
app.MapPost("/parents", (CreateParentRequest request, IParentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Creating new parent: {FirstName} {LastName} for student {StudentId}",
        request.FirstName, request.LastName, request.StudentId);

    var errors = ValidateCreateParentRequest(request);
    if (errors.Count > 0)
    {
        logger.LogWarning("Parent creation validation failed");
        return Results.BadRequest(ApiResponse<ParentDto>.Error("Validation failed", errors));
    }

    var parent = new Parent
    {
        Id = Guid.NewGuid().ToString(),
        FirstName = request.FirstName.Trim(),
        LastName = request.LastName.Trim(),
        Email = request.Email.Trim().ToLower(),
        PhoneNumber = request.PhoneNumber.Trim(),
        Relationship = request.Relationship.Trim(),
        StudentId = request.StudentId.Trim()
    };

    repository.Add(parent);

    logger.LogInformation("Parent created successfully with ID: {ParentId}", parent.Id);
    return Results.Created($"/parents/{parent.Id}",
        ApiResponse<ParentDto>.Ok(parent.ToDto(), "Parent created successfully"));
})
.WithName("CreateParent")
.WithOpenApi();

// PUT /parents/{id} - Update parent
app.MapPut("/parents/{id}", (string id, UpdateParentRequest request, IParentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Updating parent with ID: {ParentId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse<ParentDto>.Error("Parent ID is required"));
    }

    var errors = ValidateUpdateParentRequest(request);
    if (errors.Count > 0)
    {
        logger.LogWarning("Parent update validation failed for ID: {ParentId}", id);
        return Results.BadRequest(ApiResponse<ParentDto>.Error("Validation failed", errors));
    }

    var parent = repository.GetById(id);
    if (parent == null)
    {
        logger.LogWarning("Parent not found for update with ID: {ParentId}", id);
        return Results.NotFound(ApiResponse<ParentDto>.Error("Parent not found"));
    }

    parent.FirstName = request.FirstName.Trim();
    parent.LastName = request.LastName.Trim();
    parent.Email = request.Email.Trim().ToLower();
    parent.PhoneNumber = request.PhoneNumber.Trim();
    parent.Relationship = request.Relationship.Trim();

    repository.Update(parent);

    logger.LogInformation("Parent updated successfully with ID: {ParentId}", parent.Id);
    return Results.Ok(ApiResponse<ParentDto>.Ok(parent.ToDto(), "Parent updated successfully"));
})
.WithName("UpdateParent")
.WithOpenApi();

// DELETE /parents/{id} - Delete parent
app.MapDelete("/parents/{id}", (string id, IParentRepository repository, ILogger<Program> logger) =>
{
    logger.LogInformation("Deleting parent with ID: {ParentId}", id);

    if (string.IsNullOrWhiteSpace(id))
    {
        return Results.BadRequest(ApiResponse.Error("Parent ID is required"));
    }

    var parent = repository.GetById(id);
    if (parent == null)
    {
        logger.LogWarning("Parent not found for deletion with ID: {ParentId}", id);
        return Results.NotFound(ApiResponse.Error("Parent not found"));
    }

    repository.Delete(id);

    logger.LogInformation("Parent deleted successfully with ID: {ParentId}", id);
    return Results.Ok(ApiResponse.Ok("Parent deleted successfully"));
})
.WithName("DeleteParent")
.WithOpenApi();

app.Run();

// ============== Validation Helpers ==============

static Dictionary<string, string[]> ValidateCreateParentRequest(CreateParentRequest request)
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

    if (string.IsNullOrWhiteSpace(request.PhoneNumber))
    {
        errors["PhoneNumber"] = new[] { "Phone number is required" };
    }
    else if (!IsValidPhoneNumber(request.PhoneNumber))
    {
        errors["PhoneNumber"] = new[] { "Phone number format is invalid" };
    }

    if (string.IsNullOrWhiteSpace(request.Relationship))
    {
        errors["Relationship"] = new[] { "Relationship is required" };
    }

    if (string.IsNullOrWhiteSpace(request.StudentId))
    {
        errors["StudentId"] = new[] { "Student ID is required" };
    }

    return errors;
}

static Dictionary<string, string[]> ValidateUpdateParentRequest(UpdateParentRequest request)
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

    if (string.IsNullOrWhiteSpace(request.PhoneNumber))
    {
        errors["PhoneNumber"] = new[] { "Phone number is required" };
    }
    else if (!IsValidPhoneNumber(request.PhoneNumber))
    {
        errors["PhoneNumber"] = new[] { "Phone number format is invalid" };
    }

    if (string.IsNullOrWhiteSpace(request.Relationship))
    {
        errors["Relationship"] = new[] { "Relationship is required" };
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

static bool IsValidPhoneNumber(string phoneNumber)
{
    return !string.IsNullOrWhiteSpace(phoneNumber) && phoneNumber.Length >= 10 && phoneNumber.Length <= 15;
}

// ============== Repository ==============

public interface IParentRepository
{
    List<Parent> GetAll();
    Parent? GetById(string id);
    List<Parent> GetByStudentId(string studentId);
    void Add(Parent parent);
    void Update(Parent parent);
    void Delete(string id);
}

public class InMemoryParentRepository : IParentRepository
{
    private readonly ConcurrentDictionary<string, Parent> _parents;
    private readonly ILogger<InMemoryParentRepository> _logger;

    public InMemoryParentRepository(ILogger<InMemoryParentRepository> logger)
    {
        _logger = logger;
        _parents = new ConcurrentDictionary<string, Parent>();

        // Seed with sample data (note: using placeholder student IDs)
        var studentId1 = Guid.NewGuid().ToString();
        var studentId2 = Guid.NewGuid().ToString();

        var parent1 = new Parent
        {
            Id = Guid.NewGuid().ToString(),
            FirstName = "Michael",
            LastName = "Doe",
            Email = "michael.doe@email.com",
            PhoneNumber = "+1-555-0101",
            Relationship = "Father",
            StudentId = studentId1
        };

        var parent2 = new Parent
        {
            Id = Guid.NewGuid().ToString(),
            FirstName = "Emma",
            LastName = "Doe",
            Email = "emma.doe@email.com",
            PhoneNumber = "+1-555-0102",
            Relationship = "Mother",
            StudentId = studentId1
        };

        var parent3 = new Parent
        {
            Id = Guid.NewGuid().ToString(),
            FirstName = "James",
            LastName = "Smith",
            Email = "james.smith@email.com",
            PhoneNumber = "+1-555-0201",
            Relationship = "Father",
            StudentId = studentId2
        };

        _parents.TryAdd(parent1.Id, parent1);
        _parents.TryAdd(parent2.Id, parent2);
        _parents.TryAdd(parent3.Id, parent3);

        _logger.LogInformation("InMemoryParentRepository initialized with {ParentCount} parents", _parents.Count);
    }

    public List<Parent> GetAll()
    {
        return _parents.Values.ToList();
    }

    public Parent? GetById(string id)
    {
        _parents.TryGetValue(id, out var parent);
        return parent;
    }

    public List<Parent> GetByStudentId(string studentId)
    {
        return _parents.Values
            .Where(p => p.StudentId == studentId)
            .ToList();
    }

    public void Add(Parent parent)
    {
        _parents.TryAdd(parent.Id, parent);
        _logger.LogInformation("Parent added: {ParentId} for student {StudentId}", parent.Id, parent.StudentId);
    }

    public void Update(Parent parent)
    {
        _parents.AddOrUpdate(parent.Id, parent, (_, _) => parent);
        _logger.LogInformation("Parent updated: {ParentId}", parent.Id);
    }

    public void Delete(string id)
    {
        _parents.TryRemove(id, out _);
        _logger.LogInformation("Parent deleted: {ParentId}", id);
    }
}

// ============== Extension Methods ==============

public static class ParentExtensions
{
    public static ParentDto ToDto(this Parent parent)
    {
        return new ParentDto
        {
            Id = parent.Id,
            FirstName = parent.FirstName,
            LastName = parent.LastName,
            Email = parent.Email,
            PhoneNumber = parent.PhoneNumber,
            Relationship = parent.Relationship,
            StudentId = parent.StudentId
        };
    }
}

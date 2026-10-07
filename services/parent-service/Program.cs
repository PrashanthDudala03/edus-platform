using EduOS.ServiceAuth;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, config) =>
    config.MinimumLevel.Information()
        .WriteTo.Console()
        .WriteTo.File("logs/parent-service-.txt", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Service", "Parent-Service"));

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("DefaultConnection not found");

builder.Services.AddDbContext<ParentDbContext>(options =>
    options.UseNpgsql(connectionString, opt => opt.MigrationsHistoryTable("__EFMigrationsHistory", "parent_db")));

builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblies(typeof(Program).Assembly));
builder.Services.AddScoped<IValidator<CreateParentCommand>, CreateParentValidator>();
builder.Services.AddScoped<IValidator<UpdateParentCommand>, UpdateParentValidator>();
builder.Services.AddScoped<IParentRepository, ParentRepository>();
builder.Services.AddHealthChecks();

// This service verifies access tokens itself; it does not trust gateway headers.
builder.Services.AddEduOSAuthentication(builder.Configuration);

var app = builder.Build();
app.Use(async (ctx, next) => {
    if ((ctx.Request.Query.TryGetValue("page", out var p) && (!int.TryParse(p, out var page) || page < 1 || page > 100000)) ||
        (ctx.Request.Query.TryGetValue("pageSize", out var z) && (!int.TryParse(z, out var size) || size < 1 || size > 100))) {
        ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { message = "Page must be positive and page size between 1 and 100." }); return;
    }
    try { await next(); }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsJsonAsync(new { message = "A record with those details already exists." }); }
});

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ParentDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1 FROM parent_db.parents LIMIT 1");
        Log.Information("Database schema verified");
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Database schema validation failed");
        throw;
    }
}

app.UseRouting();
app.UseEduOSAuthorization("/api", "/api/health");
// Health endpoint - return Prometheus metrics format
app.MapGet("/api/health", async (ParentDbContext db) => {try { return await db.Database.CanConnectAsync() ? Results.Ok(new {status="ready"}) : Results.StatusCode(503); } catch { return Results.StatusCode(503); }}).AllowAnonymous();

// Directory endpoints: leadership reads, administrators change. schoolId is rewritten from the verified token before handlers run.
var parents = app.MapGroup("/api/parents").RequireAuthorization(EduOSPolicies.Leadership);
// Changes need the Administrator role on top of the group's leadership policy; Principal is read-only.
var parentsWrites = parents.MapGroup("").RequireAuthorization(EduOSPolicies.Administrators);
parents.MapGet("", async (IMediator mediator, int page = 1, int pageSize = 20, string? schoolId = null) =>
{
    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
        return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    try
    {
        var result = await mediator.Send(new GetParentListQuery { SchoolId = schoolIdGuid, Page = page, PageSize = pageSize });
        return Results.Ok(new { statusCode = 200, data = result });
    }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex) { Log.Error(ex, "Error fetching parents"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
});

parents.MapGet("/count", async (IMediator mediator, string? schoolId = null) =>
{
    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
        return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    try
    {
        var count = await mediator.Send(new GetParentCountQuery { SchoolId = schoolIdGuid });
        return Results.Ok(new { statusCode = 200, data = new { count } });
    }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex) { Log.Error(ex, "Error fetching parent count"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
});

parentsWrites.MapPost("", async (CreateParentCommand request, IMediator mediator, IValidator<CreateParentCommand> validator) =>
{
    try
    {
        var validationResult = await validator.ValidateAsync(request);
        if (!validationResult.IsValid)
            return Results.BadRequest(new { statusCode = 400, message = "Validation failed", errors = validationResult.Errors.Select(e => new { field = e.PropertyName, message = e.ErrorMessage }) });
        var result = await mediator.Send(request);
        return Results.Created($"/api/parents/{result.Id}", new { statusCode = 201, data = result });
    }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex) { Log.Error(ex, "Error creating parent"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
});

parentsWrites.MapPut("/{id}", async (string id, UpdateParentCommand request, IMediator mediator, IValidator<UpdateParentCommand> validator) =>
{
    if (!Guid.TryParse(id, out var parentId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid ID" });
    request.Id = parentId;
    try
    {
        var validationResult = await validator.ValidateAsync(request);
        if (!validationResult.IsValid)
            return Results.BadRequest(new { statusCode = 400, message = "Validation failed", errors = validationResult.Errors.Select(e => new { field = e.PropertyName, message = e.ErrorMessage }) });
        var result = await mediator.Send(request);
        return Results.Ok(new { statusCode = 200, data = result });
    }
    catch (InvalidOperationException ex) { return Results.NotFound(new { statusCode = 404, message = ex.Message }); }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex) { Log.Error(ex, "Error updating parent"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
});

parentsWrites.MapDelete("/{id}", async (string id, IMediator mediator, string? schoolId = null) =>
{
    if (!Guid.TryParse(id, out var parentId)) return Results.BadRequest(new { statusCode = 400, message = "Invalid ID" });
    if (string.IsNullOrEmpty(schoolId) || !Guid.TryParse(schoolId, out var schoolIdGuid))
        return Results.BadRequest(new { statusCode = 400, message = "schoolId required" });
    try
    {
        await mediator.Send(new DeleteParentCommand { Id = parentId, SchoolId = schoolIdGuid });
        return Results.Ok(new { statusCode = 200, message = "Parent deleted" });
    }
    catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "A record with these details already exists or a field is invalid." }); }
    catch (Exception ex) { Log.Error(ex, "Error deleting parent"); return Results.Json(new { statusCode = 500, message = "Error" }, statusCode: 500); }
});

app.Run();

#region Models and DB Context

public class Parent
{
    public Guid Id { get; set; }
    public Guid SchoolId { get; set; }
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string PhoneNumber { get; set; } = "";
    public string? Occupation { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }

    public ParentDto ToDto() => new() { Id = Id.ToString(), FirstName = FirstName, LastName = LastName, Email = Email, PhoneNumber = PhoneNumber, SchoolId = SchoolId.ToString() };
}

public class ParentDto { public required string Id { get; set; } public required string FirstName { get; set; } public required string LastName { get; set; } public required string Email { get; set; } public required string PhoneNumber { get; set; } public required string SchoolId { get; set; } }
public class ParentListResponse { public required int Page { get; set; } public required int PageSize { get; set; } public required int TotalCount { get; set; } public required List<ParentDto> Data { get; set; } }

public class ParentDbContext : DbContext
{
    public ParentDbContext(DbContextOptions<ParentDbContext> options) : base(options) { }
    public DbSet<Parent> Parents { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.HasDefaultSchema("parent_db");
        modelBuilder.Entity<Parent>(e =>
        {
            e.ToTable("parents");
            e.HasKey(p => p.Id);
            e.Property(p => p.Id).HasColumnName("id");
            e.Property(p => p.SchoolId).HasColumnName("school_id");
            e.Property(p => p.FirstName).HasColumnName("first_name").HasMaxLength(100);
            e.Property(p => p.LastName).HasColumnName("last_name").HasMaxLength(100);
            e.Property(p => p.Email).HasColumnName("email").HasMaxLength(255);
            e.Property(p => p.PhoneNumber).HasColumnName("phone_number").HasMaxLength(20);
            e.Property(p => p.Occupation).HasColumnName("occupation").HasMaxLength(100);
            e.Property(p => p.CreatedAt).HasColumnName("created_at").HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            e.Property(p => p.UpdatedAt).HasColumnName("updated_at").HasConversion(v => v, v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v);
            e.Property(p => p.DeletedAt).HasColumnName("deleted_at");
            e.HasIndex(p => new { p.SchoolId });
            e.HasIndex(p => new { p.SchoolId, p.PhoneNumber }).IsUnique().HasDatabaseName("parents_school_phone_number_key");
            e.HasQueryFilter(p => p.DeletedAt == null);
        });
    }
}

public interface IParentRepository
{
    Task<(List<Parent>, int)> GetBySchoolAsync(Guid schoolId, int page, int pageSize);
    Task<int> GetCountAsync(Guid schoolId);
    Task<Parent?> GetByIdAsync(Guid id, Guid schoolId);
    Task CreateAsync(Parent parent);
    Task UpdateAsync(Parent parent);
    Task DeleteAsync(Guid id, Guid schoolId);
}

public class ParentRepository : IParentRepository
{
    private readonly ParentDbContext _context;
    public ParentRepository(ParentDbContext context) => _context = context;

    public async Task<(List<Parent>, int)> GetBySchoolAsync(Guid schoolId, int page, int pageSize)
    {
        var query = _context.Parents.Where(p => p.SchoolId == schoolId);
        var total = await query.CountAsync();
        var items = await query.OrderBy(p => p.FirstName).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return (items, total);
    }

    public Task<int> GetCountAsync(Guid schoolId) => _context.Parents.CountAsync(p => p.SchoolId == schoolId);
    public Task<Parent?> GetByIdAsync(Guid id, Guid schoolId) => _context.Parents.FirstOrDefaultAsync(p => p.Id == id && p.SchoolId == schoolId);
    public async Task CreateAsync(Parent parent) { _context.Parents.Add(parent); await _context.SaveChangesAsync(); }
    public async Task UpdateAsync(Parent parent) { _context.Parents.Update(parent); await _context.SaveChangesAsync(); }
    public async Task DeleteAsync(Guid id, Guid schoolId)
    {
        var parent = await GetByIdAsync(id, schoolId);
        if (parent != null)
        {
            parent.DeletedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
        }
    }
}

public class CreateParentCommand : IRequest<ParentDto> { public required Guid SchoolId { get; set; } public required string FirstName { get; set; } public required string LastName { get; set; } public required string Email { get; set; } public string? PhoneNumber { get; set; } }
public class CreateParentHandler : IRequestHandler<CreateParentCommand, ParentDto>
{
    private readonly IParentRepository _repo;
    public CreateParentHandler(IParentRepository repo) => _repo = repo;
    public async Task<ParentDto> Handle(CreateParentCommand request, CancellationToken ct)
    {
        var parent = new Parent { Id = Guid.NewGuid(), SchoolId = request.SchoolId, FirstName = request.FirstName, LastName = request.LastName, Email = request.Email, PhoneNumber = request.PhoneNumber ?? "" };
        await _repo.CreateAsync(parent);
        return parent.ToDto();
    }
}

public class UpdateParentCommand : IRequest<ParentDto> { public Guid Id { get; set; } public required Guid SchoolId { get; set; } public required string FirstName { get; set; } public required string LastName { get; set; } public required string Email { get; set; } public string? PhoneNumber { get; set; } }
public class UpdateParentHandler : IRequestHandler<UpdateParentCommand, ParentDto>
{
    private readonly IParentRepository _repo;
    public UpdateParentHandler(IParentRepository repo) => _repo = repo;
    public async Task<ParentDto> Handle(UpdateParentCommand request, CancellationToken ct)
    {
        var parent = await _repo.GetByIdAsync(request.Id, request.SchoolId) ?? throw new InvalidOperationException("Parent not found");
        parent.FirstName = request.FirstName;
        parent.LastName = request.LastName;
        parent.Email = request.Email;
        parent.PhoneNumber = request.PhoneNumber ?? "";
        parent.UpdatedAt = DateTime.UtcNow;
        await _repo.UpdateAsync(parent);
        return parent.ToDto();
    }
}

public class DeleteParentCommand : IRequest { public Guid Id { get; set; } public Guid SchoolId { get; set; } }
public class DeleteParentHandler : IRequestHandler<DeleteParentCommand>
{
    private readonly IParentRepository _repo;
    public DeleteParentHandler(IParentRepository repo) => _repo = repo;
    public async Task Handle(DeleteParentCommand request, CancellationToken ct) => await _repo.DeleteAsync(request.Id, request.SchoolId);
}

public class GetParentListQuery : IRequest<ParentListResponse> { public Guid SchoolId { get; set; } public int Page { get; set; } = 1; public int PageSize { get; set; } = 20; }
public class GetParentListHandler : IRequestHandler<GetParentListQuery, ParentListResponse>
{
    private readonly IParentRepository _repo;
    public GetParentListHandler(IParentRepository repo) => _repo = repo;
    public async Task<ParentListResponse> Handle(GetParentListQuery request, CancellationToken ct)
    {
        var (parents, total) = await _repo.GetBySchoolAsync(request.SchoolId, request.Page, request.PageSize);
        return new ParentListResponse { Page = request.Page, PageSize = request.PageSize, TotalCount = total, Data = parents.Select(p => p.ToDto()).ToList() };
    }
}

public class GetParentCountQuery : IRequest<int> { public Guid SchoolId { get; set; } }
public class GetParentCountHandler : IRequestHandler<GetParentCountQuery, int>
{
    private readonly IParentRepository _repo;
    public GetParentCountHandler(IParentRepository repo) => _repo = repo;
    public Task<int> Handle(GetParentCountQuery request, CancellationToken ct) => _repo.GetCountAsync(request.SchoolId);
}

public class CreateParentValidator : AbstractValidator<CreateParentCommand>
{
    public CreateParentValidator()
    {
        RuleFor(x => x.SchoolId).NotEmpty().Must(x => x != Guid.Empty);
        RuleFor(x => x.FirstName).NotEmpty().Length(1, 100);
        RuleFor(x => x.LastName).NotEmpty().Length(1, 100);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().Length(1, 255);
        RuleFor(x => x.PhoneNumber).NotEmpty().Length(1, 20);
    }
}

public class UpdateParentValidator : AbstractValidator<UpdateParentCommand>
{
    public UpdateParentValidator()
    {
        RuleFor(x => x.Id).NotEmpty().Must(x => x != Guid.Empty);
        RuleFor(x => x.SchoolId).NotEmpty().Must(x => x != Guid.Empty);
        RuleFor(x => x.FirstName).NotEmpty().Length(1, 100);
        RuleFor(x => x.LastName).NotEmpty().Length(1, 100);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().Length(1, 255);
        RuleFor(x => x.PhoneNumber).NotEmpty().Length(1, 20);
    }
}

#endregion

using System.Security.Claims;
using System.Text.Json;
using EduOS.ServiceAuth;
using Microsoft.EntityFrameworkCore;
using Services.Auth.Data;
using Services.Auth.Models;

public sealed class IamError(int status, string message) : Exception(message) { public int Status => status; }
public record CatalogueSeed(string Key, string Group, string[] Defaults);
public record RoleEdit(string Name, string Description, Guid TemplateId, bool Enabled, bool Assignable, string[] Permissions);
public record AssignmentEdit(Guid RoleId, bool IsActive, string? FirstName=null, string? LastName=null, string? Email=null, string? PhoneNumber=null);
public record SignupInput(string Email, string Password, string FirstName, string LastName, string Phone, string SchoolCode, string RequestedRole);
public record ReviewInput(bool Approve, Guid? RoleId, string? Reason, Guid? StudentId, Guid? TeacherId);
public record BoundaryEdit(string[] Allowed);

public static class Iam
{
    // Platform-level permissions are never delegated to a school or granted through a school template.
    public static bool PlatformOnly(string key) => key.StartsWith("platform.") || key.StartsWith("billing.") || key == "ai.platform.manage";
    public static void Check(bool condition, string message, int status = 400) { if (!condition) throw new IamError(status, message); }
    // Serialize security mutations and token issuance, including changes to global boundaries.
    public static Task Lock(AuthDbContext db) => db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(610012026)");
    // Token issuance only needs to wait for in-flight mutations, not for other logins and refreshes.
    public static Task SharedLock(AuthDbContext db) => db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock_shared(610012026)");
    public static Task Audit(AuthDbContext db, TenantContext? actor, Guid school, string action, Guid? target, object? before, object? after) =>
        db.Database.ExecuteSqlInterpolatedAsync($"""
        INSERT INTO auth_db.iam_audit(school_id,actor_id,actor_role,action,target_id,old_value,new_value)
        VALUES ({school},{(actor == null ? (Guid?)null : actor.UserId)},{(actor == null ? "Anonymous" : actor.Role)},{action},{target},
        {JsonSerializer.Serialize(before)}::jsonb,{JsonSerializer.Serialize(after)}::jsonb)
        """);

    public const int SignupExpiryDays = 30;
    // Unreviewed requests lapse instead of staying approvable forever; each one is audited as a system action.
    public static Task ExpireSignups(AuthDbContext db) => db.Database.ExecuteSqlInterpolatedAsync($"""
        WITH expired AS (
            UPDATE auth_db.signup_requests SET status='Expired',reviewed_at=now(),reason='No administrator review within the request period.'
            WHERE status='Pending' AND created_at < now() - make_interval(days => {SignupExpiryDays}) RETURNING id,school_id)
        INSERT INTO auth_db.iam_audit(school_id,actor_role,action,target_id,old_value,new_value)
        SELECT school_id,'System','signup.expired',id,jsonb_build_object('status','Pending'),jsonb_build_object('status','Expired') FROM expired
        """);

    public static async Task Initialize(AuthDbContext db)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        await Lock(db);
        var migration=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Migrations/20261001_01_iam.sql"));
        // EF treats raw SQL braces as composite-format placeholders; SQL array/JSON literals are literal braces.
        await db.Database.ExecuteSqlRawAsync(migration.Replace("{","{{").Replace("}","}}"));
        var seeds = JsonSerializer.Deserialize<CatalogueSeed[]>(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"PermissionCatalogue.json")),new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        foreach (var p in seeds)
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO auth_db.permissions(key,module,delegatable) VALUES({p.Key},{p.Group},{!PlatformOnly(p.Key)}) ON CONFLICT(key) DO UPDATE SET module=EXCLUDED.module");
        await db.Database.ExecuteSqlRawAsync("UPDATE auth_db.permissions SET delegatable=false WHERE key='platform.manage'");
        foreach (var name in EduOSRoles.All)
        {
            var scope = name switch { "Teacher" => "teacher", "Parent" => "parent", "Student" => "student", "SuperAdmin" => "platform", _ => "school" };
            var grants = seeds.Where(p => p.Defaults.Contains(name)).Select(p => p.Key).ToArray();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO auth_db.role_templates(id,name,data_scope,assignable,maximum,defaults)
                VALUES({Guid.NewGuid()},{name},{scope},{name != "SuperAdmin" && name != "Administrator"},{grants},{grants}) ON CONFLICT DO NOTHING
                """);
        }
        // Templates only bind unconfigured roles; subsequent starts never restore removed permissions.
        await EnsureSchools(db);
        var schoolHome=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Migrations/20261002_02_school_home.sql"));
        await db.Database.ExecuteSqlRawAsync(schoolHome.Replace("{","{{").Replace("}","}}"));
        var notificationTemplates=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Migrations/20261002_03_notification_templates.sql"));
        await db.Database.ExecuteSqlRawAsync(notificationTemplates.Replace("{","{{").Replace("}","}}"));
        var timetableLeave=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Migrations/20261005_01_timetable_leave.sql"));
        await db.Database.ExecuteSqlRawAsync(timetableLeave.Replace("{","{{").Replace("}","}}"));
        var admissions=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Migrations/20261006_01_admissions_onboarding.sql"));
        await db.Database.ExecuteSqlRawAsync(admissions.Replace("{","{{").Replace("}","}}"));
        await tx.CommitAsync();
    }

    public static async Task EnsureSchools(AuthDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO auth_db.school_access(school_id,allowed)
            SELECT id,ARRAY(SELECT key FROM auth_db.permissions WHERE enabled AND delegatable)
            FROM school_db.schools WHERE id <> '00000000-0000-0000-0000-00000000e005' ON CONFLICT DO NOTHING;
            INSERT INTO auth_db.role_permissions(id,role_id,permission_key)
            SELECT gen_random_uuid(),r.id,p FROM auth_db.roles r JOIN auth_db.role_templates t ON t.name=r.name,
            unnest(t.defaults) p WHERE r.template_id IS NULL
            AND NOT EXISTS(SELECT 1 FROM auth_db.role_permissions rp WHERE rp.role_id=r.id AND rp.permission_key=p);
            UPDATE auth_db.users SET token_version=token_version+1 WHERE role_id IN(SELECT id FROM auth_db.roles WHERE template_id IS NULL);
            UPDATE auth_db.refresh_tokens SET revoked_at=now() WHERE revoked_at IS NULL AND user_id IN
            (SELECT u.id FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id WHERE r.template_id IS NULL);
            UPDATE auth_db.roles r SET template_id=t.id,assignable=t.assignable FROM auth_db.role_templates t WHERE r.template_id IS NULL AND r.name=t.name;
            """);
    }

    public static async Task Hydrate(AuthDbContext db, User user)
    {
        var template = user.Role?.TemplateId is Guid id ? await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id) : null;
        user.DataScope = template?.DataScope ?? "none";
        user.EffectivePermissions = user.Role is null ? [] : (await db.Database.SqlQuery<string>($"SELECT permission_key AS \"Value\" FROM auth_db.effective_permissions WHERE role_id={user.Role.Id}").ToListAsync()).ToArray();
        // The user entity is tracked; changing IsActive here would be saved by the next SaveChanges.
        user.AccessSuspended = user.Role?.Enabled != true || template?.Enabled != true;
    }

    public static async Task Revoke(AuthDbContext db, Guid? school = null, Guid? user = null)
    {
        await db.Users.Where(u => (school == null || u.SchoolId == school) && (user == null || u.Id == user))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.TokenVersion, u => u.TokenVersion + 1));
        await db.RefreshTokens.IgnoreQueryFilters().Where(t => (school == null || t.SchoolId == school) && (user == null || t.UserId == user) && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
    }

    public static Guid Scope(HttpContext http, Guid? targetSchool)
    {
        var actor = http.GetTenant();
        if (!actor.IsPlatform) { Check(targetSchool == null || targetSchool == actor.SchoolId,"School is outside your scope.",403); return actor.SchoolId; }
        Check(targetSchool.HasValue,"Select a school.");
        return targetSchool!.Value;
    }
    public static void Permit(HttpContext http, string permission)
    {
        Check(http.GetTenant().IsPlatform || http.User.HasClaim("permission",permission),"Permission denied.",403);
    }
    public static async Task<string[]> Maximum(AuthDbContext db, RoleTemplate template, Guid school, bool delegated)
    {
        var allowed = school == EduOSTenants.Platform ? template.Maximum : (await db.Boundaries.SingleAsync(b => b.SchoolId == school)).Allowed;
        var enabled = await db.Permissions.Where(p => p.Enabled && (!delegated || p.Delegatable)).Select(p => p.Key).ToListAsync();
        return template.Maximum.Intersect(allowed).Intersect(enabled).ToArray();
    }
    public static async Task<Role> AssignableRole(AuthDbContext db, HttpContext http, Guid school, Guid roleId)
    {
        var role = await db.Roles.SingleOrDefaultAsync(r => r.Id == roleId && r.SchoolId == school && r.Enabled);
        Check(role != null,"Role is unavailable in this school.",403);
        var template = await db.Templates.SingleOrDefaultAsync(t => t.Id == role!.TemplateId && t.Enabled);
        Check(template != null,"Role template is disabled.",403);
        Check(http.GetTenant().IsPlatform || (school != EduOSTenants.Platform && template!.DataScope != "platform" && template.Assignable && role!.Assignable),"This role is controlled by the Platform Administrator.",403);
        return role!;
    }

    public static async Task ManageableUser(AuthDbContext db,HttpContext http,User user)
    {
        Check(user.Id!=http.GetTenant().UserId,"Another administrator must change your account.",403);
        if(http.GetTenant().IsPlatform)return;
        var role=await db.Roles.SingleAsync(r=>r.Id==user.RoleId);
        var template=await db.Templates.SingleAsync(t=>t.Id==role.TemplateId);
        Check(user.SchoolId==http.GetTenant().SchoolId && role.Assignable && template.Assignable && template.DataScope!="platform","This account is controlled by the Platform Administrator.",403);
    }

    public static void Map(WebApplication app)
    {
        app.MapPost("/api/auth/signup", async (SignupInput input, AuthDbContext db) =>
        {
            try {
                Check(input.Email?.Length <= 255 && System.Net.Mail.MailAddress.TryCreate(input.Email,out _),"Enter a valid email.");
                Check(!string.IsNullOrWhiteSpace(input.FirstName) && input.FirstName.Length<=100 && !string.IsNullOrWhiteSpace(input.LastName) && input.LastName.Length<=100 && input.Phone?.Length<=20,"Enter valid personal details.");
                Check(input.Password?.Length>=16 && System.Text.Encoding.UTF8.GetByteCount(input.Password)<=72,"Use a password of at least 16 characters and at most 72 UTF-8 bytes.");
                Check(new[]{"Principal","Teacher","Parent","Student","School Staff"}.Contains(input.RequestedRole),"Select an available account category.");
                await using var tx=await db.Database.BeginTransactionAsync(); await Lock(db); await ExpireSignups(db);
                var boundary=await db.Boundaries.SingleOrDefaultAsync(b=>b.SignupCode==input.SchoolCode);
                Check(boundary!=null && await RoleModel.SchoolIsActive(db,boundary.SchoolId),"School code is unavailable.");
                var email=input.Email!.Trim().ToLowerInvariant();var school=boundary!.SchoolId;
                Check(!await db.Users.AnyAsync(u=>u.SchoolId==school && u.Email.ToLower()==email) && !await db.Signups.AnyAsync(s=>s.SchoolId==school && s.Email==email && s.Status=="Pending"),"An account or pending request already exists.",409);
                var row=new SignupRequest{Id=Guid.NewGuid(),SchoolId=school,Email=email,FirstName=input.FirstName.Trim(),LastName=input.LastName.Trim(),Phone=input.Phone!,RequestedRole=input.RequestedRole,PasswordHash=BCrypt.Net.BCrypt.HashPassword(input.Password,12)};
                db.Signups.Add(row);await db.SaveChangesAsync();
                await Audit(db,null,school,"signup.submitted",row.Id,null,new{row.Email,row.RequestedRole});await tx.CommitAsync();
                return Results.Json(new{message="Your access request has been submitted to the school administrator for approval."},statusCode:201);
            }catch(IamError ex){return Results.Json(new{message=ex.Message},statusCode:ex.Status);}
        }).AllowAnonymous();

        var group=app.MapGroup("/api/control").RequireAuthorization(EduOSPolicies.AnyRole);
        group.AddEndpointFilter(async (context,next)=>{
            try { return await next(context); }
            catch(IamError ex){return Results.Json(new{message=ex.Message},statusCode:ex.Status);}
        });
        group.MapGet("/me",async(HttpContext http,AuthDbContext db)=>{
            var actor=http.GetTenant();var user=await db.Users.Include(u=>u.Role).SingleAsync(u=>u.Id==actor.UserId && u.SchoolId==actor.SchoolId);
            await Hydrate(db,user);return Results.Ok(new{data=user.ToDto()});
        });
        // Which product modules this school has and this account may use. A view over the school's boundary and the
        // account's effective permissions; it stores nothing and takes nothing from the request.
        group.MapGet("/features",async(HttpContext http,AuthDbContext db)=>{
            var actor=http.GetTenant();var user=await db.Users.Include(u=>u.Role).SingleAsync(u=>u.Id==actor.UserId && u.SchoolId==actor.SchoolId);
            await Hydrate(db,user);
            var boundary=actor.IsPlatform?[]:await db.Database.SqlQuery<string>($"SELECT unnest(allowed) AS \"Value\" FROM auth_db.school_access WHERE school_id={actor.SchoolId}").ToListAsync();
            return Results.Ok(new{data=FeatureCatalogue.Evaluate(boundary,user.EffectivePermissions)});
        });
        GuardianReview.Map(group);
        group.MapGet("/configuration",async(Guid? targetSchool,HttpContext http,AuthDbContext db)=>{
            Permit(http,"roles.view");var school=Scope(http,targetSchool);var platform=http.GetTenant().IsPlatform;
            var templates=await db.Templates.AsNoTracking().Where(t=>platform || (t.DataScope!="platform" && t.Assignable)).OrderBy(t=>t.Name).ToListAsync();
            var roles=await db.Roles.AsNoTracking().Include(r=>r.Permissions).Where(r=>r.SchoolId==school).OrderBy(r=>r.Name).ToListAsync();
            var rows=new List<object>();
            foreach(var r in roles){var t=await db.Templates.AsNoTracking().SingleAsync(t=>t.Id==r.TemplateId);rows.Add(new{r.Id,r.Name,r.Description,r.TemplateId,r.Enabled,r.Assignable,dataScope=t.DataScope,
                permissions=r.Permissions.Select(p=>p.PermissionKey),effectivePermissions=await db.Database.SqlQuery<string>($"SELECT permission_key AS \"Value\" FROM auth_db.effective_permissions WHERE role_id={r.Id}").ToListAsync(),maximum=await Maximum(db,t,school,!platform),users=await db.Users.CountAsync(u=>u.RoleId==r.Id),canAssign=r.Enabled&&t.Enabled&&(platform || r.Assignable&&t.Assignable)});}
            return Results.Ok(new{data=new{roles=rows,templates,permissions=await db.Permissions.OrderBy(p=>p.Module).ThenBy(p=>p.Key).ToListAsync(),boundary=await db.Boundaries.SingleOrDefaultAsync(b=>b.SchoolId==school)}});
        });
        group.MapGet("/users",async(Guid? targetSchool,string? search,string? status,Guid? roleId,HttpContext http,AuthDbContext db,int page=1)=>{
            Permit(http,"users.view");var school=Scope(http,targetSchool);Check(page>0&&page<100000,"Invalid page.");
            var q=db.Users.Where(u=>u.SchoolId==school && (roleId==null||u.RoleId==roleId));
            if(!string.IsNullOrWhiteSpace(search))q=q.Where(u=>u.Email.Contains(search)||u.Username.Contains(search)||((u.FirstName??"")+" "+(u.LastName??"")).Contains(search));
            if(status=="active")q=q.Where(u=>u.IsActive);if(status=="disabled")q=q.Where(u=>!u.IsActive);
            return Results.Ok(new{data=new{totalCount=await q.CountAsync(),data=await q.OrderBy(u=>u.Email).Skip((page-1)*20).Take(20).Select(u=>new{u.Id,u.FirstName,u.LastName,u.Email,u.PhoneNumber,u.RoleId,role=u.Role!.Name,u.IsActive,u.SchoolId,u.CreatedAt,u.LastLoginAt}).ToListAsync()}});
        });
        group.MapPost("/users",async(Guid? targetSchool,CreateUserRequest input,HttpContext http,AuthDbContext db)=>{
            Permit(http,"users.create");Permit(http,"roles.assign");var school=Scope(http,targetSchool);
            Check(Guid.TryParse(input.RoleId,out var roleId),"Select a role.");
            Check(!string.IsNullOrWhiteSpace(input.Username)&&input.Username.Length<=100&&!string.IsNullOrWhiteSpace(input.FirstName)&&input.FirstName.Length<=100&&!string.IsNullOrWhiteSpace(input.LastName)&&input.LastName.Length<=100&&input.Email.Length<=255&&System.Net.Mail.MailAddress.TryCreate(input.Email,out _),"Enter valid account details.");
            Check(input.Password.Length>=16&&System.Text.Encoding.UTF8.GetByteCount(input.Password)<=72,"Use a password of at least 16 characters and at most 72 UTF-8 bytes.");
            await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);
            var role=await AssignableRole(db,http,school,roleId);
            var user=new User{Id=Guid.NewGuid(),SchoolId=school,Username=input.Username.Trim(),Email=input.Email.Trim().ToLowerInvariant(),FirstName=input.FirstName.Trim(),LastName=input.LastName.Trim(),PasswordHash=BCrypt.Net.BCrypt.HashPassword(input.Password,12),RoleId=role.Id,CreatedByUserId=http.GetTenant().UserId};
            db.Users.Add(user);await db.SaveChangesAsync();await Audit(db,http.GetTenant(),school,"user.created",user.Id,null,new{user.RoleId,user.Email});await tx.CommitAsync();return Results.Json(new{data=new{user.Id}},statusCode:201);
        });
        group.MapGet("/users/{id:guid}/permissions",async(Guid id,Guid? targetSchool,HttpContext http,AuthDbContext db)=>{
            Permit(http,"users.view");var school=Scope(http,targetSchool);var user=await db.Users.Include(u=>u.Role).SingleOrDefaultAsync(u=>u.Id==id&&u.SchoolId==school);Check(user!=null,"User not found.",404);
            await Hydrate(db,user!);return Results.Ok(new{data=user!.ToDto()});
        });
        group.MapGet("/profiles",async(Guid? targetSchool,HttpContext http,AuthDbContext db)=>{
            Permit(http,"signup.review");Permit(http,"account-links.manage");var school=Scope(http,targetSchool);
            var students=await db.Database.SqlQuery<ProfileOption>($"SELECT id AS \"Id\",first_name || ' ' || last_name AS \"Label\" FROM student_db.students WHERE school_id={school} AND deleted_at IS NULL ORDER BY first_name").ToListAsync();
            var teachers=await db.Database.SqlQuery<ProfileOption>($"SELECT id AS \"Id\",first_name || ' ' || last_name AS \"Label\" FROM teacher_db.teachers WHERE school_id={school} AND deleted_at IS NULL ORDER BY first_name").ToListAsync();
            return Results.Ok(new{data=new{students,teachers}});
        });
        group.MapPost("/users/{id:guid}/recovery",async(Guid id,Guid? targetSchool,HttpContext http,AuthDbContext db)=>{
            Permit(http,"users.update");var school=Scope(http,targetSchool);
            await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);
            var user=await db.Users.SingleOrDefaultAsync(u=>u.Id==id&&u.SchoolId==school&&u.IsActive);Check(user!=null,"Active user not found.",404);await ManageableUser(db,http,user!);
            var code=Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));var hash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)));
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE auth_db.password_resets SET used_at=now() WHERE user_id={id} AND used_at IS NULL");
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO auth_db.password_resets(id,school_id,user_id,code_hash,expires_at) VALUES({Guid.NewGuid()},{school},{id},{hash},{DateTime.UtcNow.AddMinutes(15)})");
            await Audit(db,http.GetTenant(),school,"user.recovery.issued",id,null,null);await tx.CommitAsync();return Results.Ok(new{data=new{code}});
        });
        group.MapPut("/users/{id:guid}",async(Guid id,Guid? targetSchool,AssignmentEdit input,HttpContext http,AuthDbContext db)=>{
            Permit(http,"roles.assign");Permit(http,input.IsActive?"users.update":"users.disable");var school=Scope(http,targetSchool);
            await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);
            var user=await db.Users.Include(u=>u.Role).SingleOrDefaultAsync(u=>u.Id==id&&u.SchoolId==school);Check(user!=null,"User not found.",404);
            var role=await AssignableRole(db,http,school,input.RoleId);
            // School managers cannot alter platform-provisioned administrators, including themselves.
            await ManageableUser(db,http,user!);
            Check(id!=http.GetTenant().UserId,"Another authorized administrator must change your access.",403);
            await ValidateLinks(db,school,id,role.TemplateId!.Value);
            var before=new{user!.RoleId,user.IsActive,user.FirstName,user.LastName,user.Email,user.PhoneNumber};user.RoleId=role.Id;user.IsActive=input.IsActive;user.UpdatedAt=DateTime.UtcNow;
            Check(input.FirstName==null||input.FirstName.Length is >0 and <=100,"Invalid first name.");Check(input.LastName==null||input.LastName.Length is >0 and <=100,"Invalid last name.");
            Check(input.Email==null||(input.Email.Length<=255&&System.Net.Mail.MailAddress.TryCreate(input.Email,out _)),"Invalid email.");Check(input.PhoneNumber==null||input.PhoneNumber.Length<=20,"Invalid phone.");
            if(input.FirstName!=null)user.FirstName=input.FirstName.Trim();if(input.LastName!=null)user.LastName=input.LastName.Trim();if(input.Email!=null)user.Email=input.Email.Trim().ToLowerInvariant();if(input.PhoneNumber!=null)user.PhoneNumber=input.PhoneNumber.Trim();
            await db.SaveChangesAsync();await Revoke(db,school,id);await Audit(db,http.GetTenant(),school,"user.access.changed",id,before,input);await tx.CommitAsync();
            return Results.Ok(new{message="Access updated. Previous sessions revoked."});
        });
        group.MapPost("/roles",async(Guid? targetSchool,RoleEdit input,HttpContext http,AuthDbContext db)=>await SaveRole(null,targetSchool,input,http,db));
        group.MapPut("/roles/{id:guid}",async(Guid id,Guid? targetSchool,RoleEdit input,HttpContext http,AuthDbContext db)=>await SaveRole(id,targetSchool,input,http,db));
        group.MapGet("/signup-requests",async(Guid? targetSchool,HttpContext http,AuthDbContext db)=>{
            Permit(http,"signup.review");var school=Scope(http,targetSchool);await ExpireSignups(db);
            return Results.Ok(new{data=await db.Signups.Where(s=>s.SchoolId==school).OrderByDescending(s=>s.CreatedAt).Take(200).Select(s=>new{s.Id,s.FirstName,s.LastName,s.Email,s.Phone,s.RequestedRole,s.Status,s.CreatedAt,s.ApprovedRole,s.ReviewedBy,s.ReviewedAt,s.Reason}).ToListAsync()});
        });
        group.MapPost("/signup-requests/{id:guid}/review",Review);
        group.MapGet("/access-history",async(Guid? targetSchool,HttpContext http,AuthDbContext db,int page=1)=>{
            Permit(http,"access-history.view");var school=Scope(http,targetSchool);Check(page>0&&page<100000,"Invalid page.");
            var rows=await db.Database.SqlQuery<string>($"SELECT row_to_json(a)::text AS \"Value\" FROM auth_db.iam_audit a WHERE school_id={school} ORDER BY created_at DESC,id LIMIT 50 OFFSET {(page-1)*50}").ToListAsync();
            return Results.Ok(new{data=rows.Select(x=>JsonSerializer.Deserialize<JsonElement>(x))});
        });
        group.MapPut("/boundary",async(Guid? targetSchool,BoundaryEdit input,HttpContext http,AuthDbContext db)=>{
            Check(http.GetTenant().IsPlatform,"Platform access required.",403);var school=Scope(http,targetSchool);
            await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);
            var known=await db.Permissions.Select(p=>p.Key).ToListAsync();Check(input.Allowed.All(known.Contains),"Unknown permission.");
            var boundary=await db.Boundaries.SingleAsync(b=>b.SchoolId==school);var old=boundary.Allowed;boundary.Allowed=input.Allowed.Distinct().ToArray();
            await db.SaveChangesAsync();await Revoke(db,school);await Audit(db,http.GetTenant(),school,"boundary.changed",school,old,input);await tx.CommitAsync();return Results.Ok(new{message="School boundary saved; sessions revoked."});
        });
        group.MapPut("/templates/{id:guid}",async(Guid id,RoleTemplate input,HttpContext http,AuthDbContext db)=>{
            Check(http.GetTenant().IsPlatform,"Platform access required.",403);
            await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);
            Check(input.Name.Length is >0 and <=100 && input.Description.Length<=1000,"Enter a valid name and description.");
            Check(new[]{"school","teacher","parent","student","platform"}.Contains(input.DataScope),"Invalid data scope.");
            var known=await db.Permissions.Select(p=>p.Key).ToListAsync();Check(input.Maximum.All(known.Contains)&&input.Defaults.All(input.Maximum.Contains),"Permissions exceed the catalogue or maximum.");
            var current=await db.Templates.SingleOrDefaultAsync(t=>t.Id==id);var before=current==null?null:JsonSerializer.Serialize(current);
            if(current!=null)Check(current.DataScope==input.DataScope,"Create a new template to change data scope; existing profile links must stay protected.");
            Check(current?.Name!="SuperAdmin" && input.Name!="SuperAdmin","The platform root template is protected.",403);
            Check(input.DataScope=="platform" || !input.Maximum.Any(PlatformOnly),"Platform permissions cannot be granted to school templates.",403);
            if(input.DataScope=="platform")input.Assignable=false;
            if(current==null){current=new RoleTemplate{Id=id};db.Templates.Add(current);}
            current.Name=input.Name.Trim();current.Description=input.Description;current.DataScope=input.DataScope;current.Enabled=input.Enabled;current.Assignable=input.Assignable;current.Maximum=input.Maximum.Distinct().ToArray();current.Defaults=input.Defaults.Distinct().ToArray();
            await db.SaveChangesAsync();await Revoke(db);await Audit(db,http.GetTenant(),EduOSTenants.Platform,"template.changed",id,before,input);await tx.CommitAsync();return Results.Ok(new{message="Template saved; sessions revoked."});
        });
        group.MapPut("/permissions/{key}",async(string key,PermissionDefinition input,HttpContext http,AuthDbContext db)=>{
            Check(http.GetTenant().IsPlatform,"Platform access required.",403);await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);
            Check(!key.StartsWith("platform."),"Platform root access is protected.",403);
            var p=await db.Permissions.SingleOrDefaultAsync(p=>p.Key==key);Check(p!=null,"Only implemented permissions can be configured.",404);var old=new{p!.Enabled,p.Delegatable};p.Enabled=input.Enabled;p.Delegatable=input.Delegatable;
            await db.SaveChangesAsync();await Revoke(db);await Audit(db,http.GetTenant(),EduOSTenants.Platform,"permission.changed",null,old,new{key,input.Enabled,input.Delegatable});await tx.CommitAsync();return Results.Ok(new{message="Permission saved; sessions revoked."});
        });
    }

    static async Task<IResult> SaveRole(Guid? id,Guid? targetSchool,RoleEdit input,HttpContext http,AuthDbContext db)
    {
        Permit(http,"roles.manage");var school=Scope(http,targetSchool);var platform=http.GetTenant().IsPlatform;
        Check(!string.IsNullOrWhiteSpace(input.Name)&&input.Name.Length<=100&&input.Description.Length<=1000,"Enter a valid role name and description.");
        Check(!input.Name.Equals("SuperAdmin",StringComparison.OrdinalIgnoreCase) || school==EduOSTenants.Platform,"Platform roles cannot belong to a school.",403);
        await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);
        var template=await db.Templates.SingleOrDefaultAsync(t=>t.Id==input.TemplateId&&t.Enabled);Check(template!=null,"Template unavailable.",403);
        Check((template!.DataScope=="platform")== (school==EduOSTenants.Platform),"Template scope mismatch.",403);
        Check(platform||template.Assignable,"Template is controlled by the Platform Administrator.",403);
        var maximum=await Maximum(db,template,school,!platform);Check(input.Permissions.All(maximum.Contains),"Permission is outside the platform delegation boundary.",403);
        var role=id.HasValue?await db.Roles.Include(r=>r.Permissions).SingleOrDefaultAsync(r=>r.Id==id&&r.SchoolId==school):null;
        Check(!id.HasValue||role!=null,"Role not found.",404);
        if(role!=null){Check(role.TemplateId==input.TemplateId,"Create a new role to change its template.");Check(platform||role.Assignable,"This role is controlled by the Platform Administrator.",403);Check(role.Name!="SuperAdmin","The platform root role is protected.",403);}
        Check(role==null||!await db.Users.AnyAsync(u=>u.Id==http.GetTenant().UserId&&u.RoleId==role.Id),"Another administrator must change your own role permissions.",403);
        Check(!await db.Roles.AnyAsync(r=>r.SchoolId==school&&r.Id!=id&&r.Name.ToLower()==input.Name.Trim().ToLower()),"Role name already exists.",409);
        var old=role==null?null:new{role.Name,role.Description,role.Enabled,role.Assignable,permissions=role.Permissions.Select(p=>p.PermissionKey).ToArray()};
        if(role==null){role=new Role{Id=Guid.NewGuid(),SchoolId=school,Name=input.Name,TemplateId=input.TemplateId};db.Roles.Add(role);}
        role.Name=input.Name.Trim();role.Description=input.Description;role.Enabled=input.Enabled;role.Assignable=platform?input.Assignable:true;
        var removed=role.Permissions.Where(p=>!input.Permissions.Contains(p.PermissionKey)).ToList();
        db.RolePermissions.RemoveRange(removed);
        foreach(var item in removed)role.Permissions.Remove(item);
        foreach(var key in input.Permissions.Distinct().Where(key=>!role.Permissions.Any(p=>p.PermissionKey==key)))
        {
            // Added through the set, so it is inserted. A row with its key already set that is only put into the
            // loaded role's collection is taken for an existing row and updated, which changes nothing and fails.
            var grant=new RolePermission{Id=Guid.NewGuid(),RoleId=role.Id,PermissionKey=key};
            db.RolePermissions.Add(grant);role.Permissions.Add(grant);
        }
        await db.SaveChangesAsync();await Revoke(db,school);await Audit(db,http.GetTenant(),school,id.HasValue?"role.changed":"role.created",role.Id,old,input);await tx.CommitAsync();return Results.Ok(new{data=new{role.Id},message="Role saved; school sessions revoked."});
    }

    public static async Task ValidateLinks(AuthDbContext db,Guid school,Guid user,Guid templateId)
    {
        var scope=await db.Templates.Where(t=>t.Id==templateId).Select(t=>t.DataScope).SingleAsync();
        if(scope is not ("student" or "teacher"))return;
        var key=scope=="student"?"studentId":"teacherId";
        var count=await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM suite.records WHERE school_id={school} AND kind='account-links' AND archived_at IS NULL AND data->>'userId'={user.ToString()} AND COALESCE(data->>{key},'')<>'' AND data->>'relationship'={scope}").SingleAsync();
        Check(count==1,"This role requires exactly one verified "+scope+" profile link. Manage account profile links first.",409);
    }

    static async Task<IResult> Review(Guid id,Guid? targetSchool,ReviewInput input,HttpContext http,AuthDbContext db)
    {
        Permit(http,"signup.review");Permit(http,"roles.assign");var school=Scope(http,targetSchool);
        await using var tx=await db.Database.BeginTransactionAsync();await Lock(db);await ExpireSignups(db);
        var row=await db.Signups.SingleOrDefaultAsync(s=>s.Id==id&&s.SchoolId==school);Check(row!=null,"Request not found.",404);Check(row!.Status=="Pending","Request has already been reviewed.",409);
        Check((input.Reason?.Length??0)<=1000,"Reason is too long.");
        if(input.Approve){
            Check(input.RoleId.HasValue,"Select the approved role.");var role=await AssignableRole(db,http,school,input.RoleId!.Value);
            var scope=await db.Templates.Where(t=>t.Id==role.TemplateId).Select(t=>t.DataScope).SingleAsync();
            Check(scope!="platform","Public requests cannot receive platform access.",403);
            Check(scope!="student"||input.StudentId.HasValue,"Select an existing student.");Check(scope!="teacher"||input.TeacherId.HasValue,"Select an existing teacher.");
            Check(!input.StudentId.HasValue || scope is "parent" or "student","Student links require a parent or student scope.");Check(!input.TeacherId.HasValue || scope=="teacher","Teacher links require a teacher scope.");
            var user=new User{Id=Guid.NewGuid(),SchoolId=school,Username=row.Email,Email=row.Email,FirstName=row.FirstName,LastName=row.LastName,PhoneNumber=row.Phone,PasswordHash=row.PasswordHash,RoleId=role.Id,IsActive=true,CreatedByUserId=http.GetTenant().UserId};
            db.Users.Add(user);await db.SaveChangesAsync();
            if(input.StudentId.HasValue||input.TeacherId.HasValue){
                Permit(http,"account-links.manage");var record=input.StudentId??input.TeacherId;
                var exists=input.StudentId.HasValue?await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM student_db.students WHERE id={record} AND school_id={school} AND deleted_at IS NULL").SingleAsync():await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM teacher_db.teachers WHERE id={record} AND school_id={school} AND deleted_at IS NULL").SingleAsync();Check(exists==1,"Profile is not available in this school.");
                var data=JsonSerializer.Serialize(new{userId=user.Id.ToString(),studentId=input.StudentId?.ToString()??"",teacherId=input.TeacherId?.ToString()??"",relationship=scope});
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES({Guid.NewGuid()},{school},'account-links',{data}::jsonb,{http.GetTenant().UserId},{http.GetTenant().UserId})");
                await Audit(db,http.GetTenant(),school,"profile.linked",user.Id,null,new{input.StudentId,input.TeacherId});
            }
            row.UserId=user.Id;row.ApprovedRole=role.Id;
        }
        row.Status=input.Approve?"Approved":"Rejected";row.ReviewedAt=DateTime.UtcNow;row.ReviewedBy=http.GetTenant().UserId;row.Reason=input.Reason;
        await db.SaveChangesAsync();await Audit(db,http.GetTenant(),school,"signup."+row.Status.ToLowerInvariant(),row.Id,new{status="Pending"},new{row.Status,row.UserId,row.ApprovedRole,row.Reason});await tx.CommitAsync();return Results.Ok(new{message="Request "+row.Status.ToLowerInvariant()+"."});
    }
}
public class ProfileOption { public Guid Id {get;set;} public string Label {get;set;}=""; }

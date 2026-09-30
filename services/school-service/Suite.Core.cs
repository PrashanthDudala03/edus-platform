using System.Text.Json;
using System.Text.Json.Nodes;
using EduOS.ServiceAuth;
using Npgsql;
using NpgsqlTypes;

public record SuiteField(string Key,string Label,string Type,bool Required,string? Source,string[]? Options);
public record SuiteSchema(string Kind,string Title,string Group,SuiteField[] Fields,string[] Read,string[] Write);
public sealed class SuiteError(int status,string message):Exception(message) { public int Status {get;}=status; }
public sealed class SchoolAccess
{
    public Guid School {get;init;} public Guid User {get;init;} public string Role {get;init;}="";
    /// <summary>School administrator: operational configuration, finance, users and archiving.</summary>
    public bool Admin => SchoolWide;
    public HashSet<string> Permissions {get;init;}=[];
    public bool Can(string permission)=>Permissions.Contains(permission);
    /// <summary>Administrator or Principal: sees the whole school without profile-link scoping. Writes are still limited by each module's Write roles.</summary>
    public bool SchoolWide => Role is "Administrator" or "Principal";
    public HashSet<string> Students {get;}=[]; public HashSet<string> Teachers {get;}=[]; public HashSet<string> Classes {get;}=[];
    public HashSet<string> Exams {get;}=[]; public HashSet<string> Homework {get;}=[];
}
public static partial class Suite
{
    private static string Connection="";
    private static readonly JsonSerializerOptions JsonOptions=new(JsonSerializerDefaults.Web);
    private static readonly Dictionary<string,SuiteSchema> Schemas=JsonSerializer.Deserialize<SuiteSchema[]>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"SuiteSchemas.json")),JsonOptions)!.ToDictionary(s=>s.Kind);
    private static readonly string[] KnownRoles=["Administrator","Principal","Teacher","Parent","Student"];
    static string Text(JsonObject o,string key)=>o[key]?.ToString().Trim()??"";
    static decimal Number(JsonObject o,string key)=>decimal.TryParse(Text(o,key),System.Globalization.NumberStyles.Number,System.Globalization.CultureInfo.InvariantCulture,out var n)?n:throw new SuiteError(400,key+" must be a number.");
    static Guid Id(JsonObject o,string key)=>Guid.TryParse(Text(o,key),out var id)?id:throw new SuiteError(400,key+" must be a valid record.");
    static DateOnly Day(JsonObject o,string key)=>DateOnly.TryParse(Text(o,key),out var d)?d:throw new SuiteError(400,key+" must be a valid date.");
    static void Require(bool condition,string message,int status=400){if(!condition)throw new SuiteError(status,message);}
    static async Task<NpgsqlConnection> Open(){var c=new NpgsqlConnection(Connection);await c.OpenAsync();return c;}
    static NpgsqlCommand Command(NpgsqlConnection c,string sql,(string,object?)[] args){
        var cmd=new NpgsqlCommand(sql,c);
        foreach(var(k,v)in args)cmd.Parameters.AddWithValue(k,v??DBNull.Value);
        return cmd;
    }
    static async Task<int> E(NpgsqlConnection c,string sql,params (string,object?)[] args){await using var cmd=Command(c,sql,args);return await cmd.ExecuteNonQueryAsync();}
    static async Task<List<JsonObject>> Q(NpgsqlConnection c,string sql,params (string,object?)[] args){
        await using var cmd=Command(c,sql,args);await using var reader=await cmd.ExecuteReaderAsync();var list=new List<JsonObject>();
        while(await reader.ReadAsync()){var row=new JsonObject();for(var i=0;i<reader.FieldCount;i++)row[reader.GetName(i)]=reader.IsDBNull(i)?null:JsonSerializer.SerializeToNode(reader.GetValue(i),JsonOptions);list.Add(row);}return list;
    }
    static JsonObject Record(JsonObject row){
        var doc=JsonNode.Parse(Text(row,"data"))!.AsObject();
        doc["id"]=Text(row,"id");doc["version"]=row["version"]?.DeepClone();doc["createdAt"]=row["createdAt"]?.DeepClone();return doc;
    }
    static async Task<List<JsonObject>> Records(NpgsqlConnection c,Guid school,string kind){
        var rows=await Q(c,"SELECT id,data::text,version,created_at AS \"createdAt\" FROM suite.records WHERE school_id=@school AND kind=@kind AND archived_at IS NULL ORDER BY created_at DESC,id",("school",school),("kind",kind));
        return rows.Select(Record).ToList();
    }
    static async Task<JsonObject> Get(NpgsqlConnection c,Guid school,string kind,Guid id){
        var rows=await Q(c,"SELECT id,data::text,version,created_at AS \"createdAt\" FROM suite.records WHERE school_id=@school AND kind=@kind AND id=@id AND archived_at IS NULL",("school",school),("kind",kind),("id",id));
        Require(rows.Count==1,"Record not found in this school.",404);return Record(rows[0]);
    }
    static async Task<SchoolAccess> Access(HttpContext http,NpgsqlConnection c){
        // Scope comes from the verified access token only, never from headers or query values a caller could set.
        var tenant=http.TryGetTenant();Require(tenant is not null,"School scope is missing.",403);
        var school=tenant!.SchoolId;var user=tenant.UserId;var role=http.User.FindFirst("data_scope")?.Value switch {"school"=>"Principal","teacher"=>"Teacher","parent"=>"Parent","student"=>"Student",_=>""};Require(role!="","Data scope is not allowed.",403);
        var a=new SchoolAccess{School=school,User=user,Role=role,Permissions=http.User.FindAll("permission").Select(p=>p.Value).ToHashSet()};
        if(a.SchoolWide)return a;
        var links=await Q(c,"SELECT data::text FROM suite.records WHERE school_id=@s AND kind='account-links' AND archived_at IS NULL AND data->>'userId'=@u",("s",school),("u",user.ToString()));
        foreach(var l in links){var d=JsonNode.Parse(Text(l,"data"))!.AsObject();if((role=="Parent"&&Text(d,"relationship")=="parent"||role=="Student"&&Text(d,"relationship")=="student") && Text(d,"studentId")!="")a.Students.Add(Text(d,"studentId"));if(role=="Teacher" && Text(d,"relationship")=="teacher" && Text(d,"teacherId")!="")a.Teachers.Add(Text(d,"teacherId"));}
        Require(role!="Student"||a.Students.Count<=1,"Student link requires administrator review.",403);
        var classes=await Records(c,school,"classes");
        foreach(var cl in classes)if(a.Teachers.Contains(Text(cl,"teacherId")))a.Classes.Add(Text(cl,"id"));
        foreach(var assignment in await Records(c,school,"teaching-assignments"))if(a.Teachers.Contains(Text(assignment,"teacherId")))a.Classes.Add(Text(assignment,"classId"));
        var enrollment=await Q(c,"SELECT student_id::text AS student,class_id::text AS class FROM suite.student_classes WHERE school_id=@s",("s",school));
        foreach(var en in enrollment)if(a.Students.Contains(Text(en,"student")))a.Classes.Add(Text(en,"class"));
        if(role=="Teacher")foreach(var en in enrollment)if(a.Classes.Contains(Text(en,"class")))a.Students.Add(Text(en,"student"));
        foreach(var exam in await Records(c,school,"exams"))if(a.Classes.Contains(Text(exam,"classId"))&&(role=="Teacher"||Text(exam,"status")=="Published"))a.Exams.Add(Text(exam,"id"));
        foreach(var homework in await Records(c,school,"homework"))if(a.Classes.Contains(Text(homework,"classId")))a.Homework.Add(Text(homework,"id"));
        return a;
    }
    static bool Readable(string kind,JsonObject d,SchoolAccess a){
        if(!a.Can(kind+".view"))return false;
        if(a.SchoolWide)return true;
        return kind switch{
            "academic-years" or "subjects" or "calendar" or "school-config"=>true,
            "classes"=>a.Classes.Contains(Text(d,"id")),
            "teaching-assignments" or "staff-attendance" or "leave-requests"=>a.Teachers.Contains(Text(d,"teacherId")),
            "exams"=>a.Exams.Contains(Text(d,"id")),
            "marks"=>a.Students.Contains(Text(d,"studentId"))&&a.Exams.Contains(Text(d,"examId")),
            "homework"=>a.Homework.Contains(Text(d,"id")),
            "submissions"=>a.Students.Contains(Text(d,"studentId"))&&a.Homework.Contains(Text(d,"homeworkId")),
            "certificates"=>a.Students.Contains(Text(d,"studentId")),
            "circulars"=>(Text(d,"audience")=="All"||Text(d,"audience")==a.Role)&&(Text(d,"classId")==""||a.Classes.Contains(Text(d,"classId"))),
            "messages"=>Text(d,"recipientUserId")==a.User.ToString(),
            "timetable"=>a.Classes.Contains(Text(d,"classId")),
            _=>false
        };
    }
    static void Writable(string kind,JsonObject d,SchoolAccess a,JsonObject? old){
        Require(a.Can(kind+".manage"),"Your role cannot change this module.",403);
        if(a.SchoolWide)return;
        if(a.Role=="Teacher"){
            if(kind=="leave-requests"){Require(a.Teachers.Contains(Text(d,"teacherId")),"Leave must belong to your staff profile.",403);Require(Text(d,"status")=="Pending"&&Text(d,"approvalRemark")=="","Only school leadership can approve leave.",403);Require(old is null||Text(old,"status")=="Pending","Reviewed leave cannot be changed.",409);}
            else if(kind=="homework")Require(a.Classes.Contains(Text(d,"classId")),"This class is not assigned to you.",403);
            else if(kind=="marks")Require(a.Exams.Contains(Text(d,"examId"))&&a.Students.Contains(Text(d,"studentId")),"This result is outside your classes.",403);
            else if(kind=="submissions")Require(old is not null&&a.Homework.Contains(Text(d,"homeworkId"))&&a.Students.Contains(Text(d,"studentId"))&&Text(d,"response")==Text(old,"response")&&Text(d,"homeworkId")==Text(old,"homeworkId")&&Text(d,"studentId")==Text(old,"studentId"),"Teachers may add feedback to assigned submissions only.",403);
            else if(kind!="messages")throw new SuiteError(403,"Action is not allowed.");
        } else {
            Require(kind=="submissions"&&a.Students.Contains(Text(d,"studentId"))&&a.Homework.Contains(Text(d,"homeworkId")),"Submission is outside your assigned student records.",403);
            Require(Text(d,"feedback")==Text(old??new(),"feedback")&&Text(d,"grade")==Text(old??new(),"grade"),"Only teachers may grade submissions.",403);
        }
    }
    public static async Task Initialize(string connection){
        Connection=connection;await using var c=await Open();
        await E(c,File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"SuiteSchema.sql")));
    }
    public static void Map(WebApplication app){
        // Every school role may enter the suite; each handler then narrows by role and profile links.
        var group=app.MapGroup("/api/suite").RequireAuthorization(EduOSPolicies.Suite);
        group.AddEndpointFilter(async(context,next)=>{
            try{return await next(context);}
            catch(System.Text.Json.JsonException){return Results.BadRequest(new{message="Invalid JSON field value."});}
            catch(FormatException){return Results.BadRequest(new{message="A record identifier or value has an invalid format."});}
            catch(SuiteError ex){return Results.Json(new{message=ex.Message},statusCode:ex.Status);}
            catch(PostgresException ex) when(ex.SqlState is "23505" or "23503" or "23514" or "40001"){return Results.Conflict(new{message="This change conflicts with an existing record or another update. Refresh and try again."});}
        });
        group.MapGet("/school",async(HttpContext http)=>{await using var c=await Open();var a=await Access(http,c);return Results.Ok(new{data=(await Q(c,"SELECT name FROM school_db.schools WHERE id=@s",("s",a.School))).First()});});
        group.MapGet("/catalog",async(HttpContext http)=>{await using var c=await Open();var a=await Access(http,c);return Results.Ok(new{data=Schemas.Values.Where(s=>a.Can(s.Kind+".view")).Select(s=>new{s.Kind,s.Title,s.Group,s.Fields,canWrite=a.Can(s.Kind+".manage")})});});
        group.MapGet("/records/{kind}",async(string kind,HttpContext http,int page=1,string? search=null)=>{
            Require(Schemas.ContainsKey(kind),"Module not found.",404);Require(page>0&&page<100000,"Invalid page.");
            await using var c=await Open();var a=await Access(http,c);Require(a.Can(kind+".view"),"Access denied.",403);
            var rows=(await Records(c,a.School,kind)).Where(d=>Readable(kind,d,a)&& (string.IsNullOrEmpty(search)||d.ToJsonString().Contains(search,StringComparison.OrdinalIgnoreCase))).ToList();
            return Results.Ok(new{data=new{data=rows.Skip((page-1)*20).Take(20),totalCount=rows.Count,page,pageSize=20}});
        });
        group.MapPost("/records/{kind}",async(string kind,JsonObject data,HttpContext http)=>await Save(kind,null,data,http));
        group.MapPut("/records/{kind}/{id:guid}",async(string kind,Guid id,JsonObject data,HttpContext http)=>await Save(kind,id,data,http));
        group.MapDelete("/records/{kind}/{id:guid}",async(string kind,Guid id,HttpContext http)=>{
            Require(Schemas.ContainsKey(kind),"Module not found.",404);await using var c=await Open();var a=await Access(http,c);Require(a.Can(kind+".archive"),"Archive permission required.",403);
            Require(!new[]{"academic-years","classes","subjects","fee-structures","exams","marks","school-config","certificates","admissions"}.Contains(kind),"This record is retained for academic or financial history. Change its status instead.",409);
            Require(kind!="account-links","Profile links are retained. Contact platform support to correct a relationship.",409);
            var old=await Get(c,a.School,kind,id);
            await E(c,"UPDATE suite.records SET archived_at=now(),updated_by=@u,version=version+1 WHERE id=@id AND school_id=@s",("u",a.User),("id",id),("s",a.School));
            return Results.Ok(new{message="Record archived."});
        });
        group.MapGet("/options",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);var result=new Dictionary<string,object>();var years=await Records(c,a.School,"academic-years");var classes=await Records(c,a.School,"classes");var subjects=await Records(c,a.School,"subjects");
            string RefName(List<JsonObject> records,JsonObject doc,string key)=>records.FirstOrDefault(x=>Text(x,"id")==Text(doc,key)) is JsonObject found?Text(found,"name"):"";
            string OptionLabel(string kind,JsonObject doc)=>kind=="classes"?Label(kind,doc)+" ("+RefName(years,doc,"yearId")+")":kind=="exams"?Label(kind,doc)+" / "+RefName(classes,doc,"classId")+" / "+RefName(subjects,doc,"subjectId"):Label(kind,doc);
            foreach(var schema in Schemas.Values){var records=await Records(c,a.School,schema.Kind);result[schema.Kind]=records.Where(d=>Readable(schema.Kind,d,a)).Select(d=>new{id=Text(d,"id"),label=OptionLabel(schema.Kind,d)}).ToList();}
            foreach(var(kind,table)in new[]{("students","student_db.students"),("teachers","teacher_db.teachers"),("parents","parent_db.parents")}){
                var rows=await Q(c,$"SELECT id::text AS id,first_name || ' ' || last_name AS label FROM {table} WHERE school_id=@s AND deleted_at IS NULL ORDER BY first_name",("s",a.School));
                result[kind]=rows.Where(d=>(a.SchoolWide && (a.Can(kind+".view")||Schemas.Values.Any(s=>a.Can(s.Kind+".manage")&&s.Fields.Any(f=>f.Source==kind))))||(kind=="students"&&a.Students.Contains(Text(d,"id")))||(kind=="teachers"&&a.Teachers.Contains(Text(d,"id")))).ToList();
            }
            var users=await Q(c,"SELECT id::text AS id,first_name || ' ' || last_name || ' (' || username || ')' AS label FROM auth_db.users WHERE school_id=@s AND deleted_at IS NULL AND is_active",("s",a.School));
            if(a.Can("users.view")||a.Can("account-links.manage")||a.Can("messages.manage"))result["users"]=a.SchoolWide?users:users.Where(u=>Text(u,"id")==a.User.ToString()).ToList();
            else if(a.Role=="Teacher"){
                var links=await Records(c,a.School,"account-links");var ids=links.Where(l=>a.Students.Contains(Text(l,"studentId"))).Select(l=>Text(l,"userId")).ToHashSet();
                result["users"]=users.Where(u=>ids.Contains(Text(u,"id"))).ToList();
            }else result["users"]=Array.Empty<object>();
            return Results.Ok(new{data=result});
        });
        MapAcademic(group);MapFinance(group);MapDocuments(group);MapReports(group);
    }
    static string Label(string kind,JsonObject d)=>kind switch{
        "classes"=>Text(d,"name")+" - "+Text(d,"section"),
        "admissions"=>Text(d,"admissionNumber")+" · "+Text(d,"firstName")+" "+Text(d,"lastName"),
        "marks"=>"Result "+Text(d,"id")[..8],
        _=>new[]{"title","name","admissionNumber","day","fromDate","type","userId"}.Select(k=>Text(d,k)).FirstOrDefault(s=>s!="")??Text(d,"id")[..8]
    };
    static async Task<IResult> Save(string kind,Guid? id,JsonObject input,HttpContext http){
        Require(Schemas.ContainsKey(kind),"Module not found.",404);await using var c=await Open();var a=await Access(http,c);
        // Authorize before validating: a role that cannot write this module learns nothing from field or reference checks.
        Require(a.Can(kind+".manage"),"Your role cannot change this module.",403);
        await using var tx=await c.BeginTransactionAsync();
        await E(c,"SELECT pg_advisory_xact_lock(hashtextextended(@s,0))",("s",a.School.ToString()));
        var old=id.HasValue?await Get(c,a.School,kind,id.Value):null;
        var d=new JsonObject();
        foreach(var f in Schemas[kind].Fields){
            Require(input[f.Key] is null or JsonValue,f.Label+" must be a single value.");var value=Text(input,f.Key);Require(!f.Required||value!="",f.Label+" is required.");
            Require(value.Length<=(f.Type=="textarea"?4000:255),f.Label+" is too long.");
            if(value!=""){
                if(f.Type=="select")Require(f.Options!.Contains(value),"Invalid "+f.Label+".");
                if(f.Type=="email")Require(System.Net.Mail.MailAddress.TryCreate(value,out _),"Invalid "+f.Label+".");
                if(f.Type=="date")Require(DateOnly.TryParseExact(value,"yyyy-MM-dd",out _),"Invalid "+f.Label+".");
                if(f.Type=="time")Require(TimeOnly.TryParseExact(value,"HH:mm",out _),"Invalid "+f.Label+".");
                if(f.Type is "number" or "money"){Require(decimal.TryParse(value,System.Globalization.NumberStyles.Number,System.Globalization.CultureInfo.InvariantCulture,out var n)&&n>=0&&n<=100000000,f.Label+" must be between 0 and 100,000,000.");Require(f.Type!="money"||decimal.Round(n,2)==n,"Use at most two decimal places.");d[f.Key]=n;continue;}
                if(f.Type=="reference")await Reference(c,a,f.Source!,value);
            }
            d[f.Key]=value;
        }
        if(old is not null){
            foreach(var key in new[]{"studentId","acceptedAt","certificateNumber"})if(old[key]is not null&&!d.ContainsKey(key))d[key]=old[key]!.DeepClone();
        }
        Writable(kind,d,a,old);
        await ValidateBusiness(c,a,kind,d,old,id);
        if(kind=="certificates"&&old is null){d["certificateNumber"]=await NextNumber(c,a.School,"certificate","DOC");d["schoolSnapshot"]=await SchoolPrint(c,a.School);d["studentSnapshot"]=(await Q(c,"SELECT first_name || ' ' || last_name AS name,roll_number AS \"admissionNumber\",current_class AS class,date_of_birth AS \"dateOfBirth\" FROM student_db.students WHERE id=@id AND school_id=@s",("id",Id(d,"studentId")),("s",a.School))).First();}
        if(id is null){
            id=Guid.NewGuid();await E(c,"INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES(@id,@s,@k,@d::jsonb,@u,@u)",("id",id),("s",a.School),("k",kind),("d",d.ToJsonString()),("u",a.User));
        }else{
            var rawVersion=Number(input,"version");Require(rawVersion>=1&&rawVersion<=int.MaxValue&&decimal.Truncate(rawVersion)==rawVersion,"Invalid record version.");var version=(int)rawVersion;
            var changed=await E(c,"UPDATE suite.records SET data=@d::jsonb,version=version+1,updated_at=now(),updated_by=@u WHERE school_id=@s AND id=@id AND version=@v",("d",d.ToJsonString()),("u",a.User),("s",a.School),("id",id),("v",version));
            Require(changed==1,"This record changed since you opened it. Refresh before saving.",409);
        }
        if(kind=="classes")await E(c,"UPDATE student_db.students SET current_class=@label,updated_at=now() WHERE school_id=@s AND id IN(SELECT student_id FROM suite.student_classes WHERE school_id=@s AND class_id=@c)",("label",Label("classes",d)),("s",a.School),("c",id));
        if(kind=="account-links"){
            await E(c,"UPDATE auth_db.users SET token_version=token_version+1 WHERE id=@id AND school_id=@s",("id",Id(d,"userId")),("s",a.School));
            await E(c,"UPDATE auth_db.refresh_tokens SET revoked_at=now() WHERE user_id=@id AND school_id=@s AND revoked_at IS NULL",("id",Id(d,"userId")),("s",a.School));
            await E(c,"INSERT INTO auth_db.iam_audit(school_id,actor_id,actor_role,action,target_id,old_value,new_value) VALUES(@s,@u,@r,'profile.linked',@id,@old::jsonb,@new::jsonb)",("s",a.School),("u",a.User),("r",http.GetTenant().Role),("id",Id(d,"userId")),("old",old?.ToJsonString()??"null"),("new",d.ToJsonString()));
        }
        await tx.CommitAsync();return Results.Json(new{data=new{id}},statusCode:old is null?201:200);
    }
    static async Task Reference(NpgsqlConnection c,SchoolAccess a,string source,string value){
        Require(Guid.TryParse(value,out var id),"Select a valid "+source+" record.");
        if(source is "students" or "teachers" or "parents" or "users"){
            var table=source switch{"students"=>"student_db.students","teachers"=>"teacher_db.teachers","parents"=>"parent_db.parents",_=>"auth_db.users"};
            Require((await Q(c,$"SELECT id FROM {table} WHERE id=@id AND school_id=@s AND deleted_at IS NULL",("id",id),("s",a.School))).Count==1,"Linked "+source+" record is not available in this school.");
        }else await Get(c,a.School,source,id);
    }
    static async Task<string> NextNumber(NpgsqlConnection c,Guid school,string kind,string prefix){
        var rows=await Q(c,"INSERT INTO suite.counters(school_id,kind,value) VALUES(@s,@k,1) ON CONFLICT(school_id,kind) DO UPDATE SET value=suite.counters.value+1 RETURNING value",("s",school),("k",kind));
        return prefix+"-"+DateTime.UtcNow.Year+"-"+Text(rows[0],"value").PadLeft(6,'0');
    }
}

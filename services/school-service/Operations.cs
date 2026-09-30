using EduOS.ServiceAuth;
using Npgsql;
using NpgsqlTypes;
using System.Data;
using System.Text.Json;

public static class Operations
{
    public static async Task Initialize(string connectionString)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS school_db.attendance (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                school_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_db.students(id),
                day date NOT NULL, status varchar(10) NOT NULL CHECK(status IN ('Present','Absent','Late','Excused')),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE(school_id, student_id, day)
            );
            CREATE INDEX IF NOT EXISTS attendance_school_day ON school_db.attendance(school_id, day);
            CREATE TABLE IF NOT EXISTS school_db.announcements (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL,
                title varchar(150) NOT NULL, body varchar(4000) NOT NULL,
                priority varchar(10) NOT NULL CHECK(priority IN ('Normal','Important')),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS announcements_school ON school_db.announcements(school_id, created_at DESC);
            CREATE OR REPLACE FUNCTION school_db.record_change() RETURNS trigger AS $$
            DECLARE row_data jsonb;
            BEGIN
                row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
                INSERT INTO school_db.audit_logs(school_id, action, entity_type, entity_id)
                VALUES (COALESCE((row_data->>'school_id')::uuid,(row_data->>'id')::uuid), TG_OP, TG_TABLE_NAME, (row_data->>'id')::uuid);
                IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
            END;
            $$ LANGUAGE plpgsql;
            DO $$
            DECLARE t text;
            BEGIN
                FOREACH t IN ARRAY ARRAY['student_db.students','teacher_db.teachers','parent_db.parents','auth_db.users','school_db.schools','school_db.attendance','school_db.announcements']
                LOOP
                    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='eduos_audit' AND tgrelid=t::regclass) THEN
                        EXECUTE format('CREATE TRIGGER eduos_audit AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION school_db.record_change()',t);
                    END IF;
                END LOOP;
            END $$;
            """, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<List<Dictionary<string,object?>>> Query(string connectionString, string sql, params (string,object)[] parameters)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql,connection);
        foreach(var (key,value) in parameters) command.Parameters.AddWithValue(key,value);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<Dictionary<string,object?>>();
        while(await reader.ReadAsync()) {
            var row = new Dictionary<string,object?>();
            for(var i=0;i<reader.FieldCount;i++) row[reader.GetName(i)] = reader.IsDBNull(i)?null:reader.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    public static void Map(WebApplication app, string connectionString)
    {
        // Leadership runs the daily school operations: overview, registers, noticeboard and audit.
        var group=app.MapGroup("/api/operations").RequireAuthorization(EduOSPolicies.Leadership);
        group.MapGet("/overview", async (Guid schoolId, DateOnly day) => {
            var stats=await Query(connectionString,"""
                SELECT
                (SELECT count(*) FROM student_db.students WHERE school_id=@school AND deleted_at IS NULL) AS students,
                (SELECT count(*) FROM teacher_db.teachers WHERE school_id=@school AND deleted_at IS NULL) AS teachers,
                (SELECT count(*) FROM parent_db.parents WHERE school_id=@school AND deleted_at IS NULL) AS parents,
                (SELECT count(DISTINCT current_class) FROM student_db.students WHERE school_id=@school AND deleted_at IS NULL) AS classes,
                (SELECT count(*) FROM school_db.attendance a JOIN student_db.students s ON s.id=a.student_id
                    WHERE a.school_id=@school AND a.day=@day AND s.deleted_at IS NULL AND a.status IN ('Present','Late')) AS present,
                (SELECT count(*) FROM school_db.attendance a JOIN student_db.students s ON s.id=a.student_id
                    WHERE a.school_id=@school AND a.day=@day AND s.deleted_at IS NULL) AS marked
                """,("school",schoolId),("day",day));
            var classes=await Query(connectionString,"""
                SELECT current_class AS name,count(*) AS count FROM student_db.students
                WHERE school_id=@school AND deleted_at IS NULL GROUP BY current_class ORDER BY current_class
                """,("school",schoolId));
            return Results.Ok(new {data=new {stats=stats[0],classes}});
        });
        group.MapGet("/directory/{kind}", async (string kind, Guid schoolId, string? search, int page=1) => {
            var table=kind switch {"students"=>"student_db.students","teachers"=>"teacher_db.teachers","parents"=>"parent_db.parents",_=>null};
            if(table is null || page<1 || page>100000 || search?.Length>100) return Results.BadRequest(new {message="Invalid directory query."});
            var extra=kind switch {"students"=>"roll_number AS \"rollNumber\",current_class AS \"currentClass\",date_of_birth AS \"dateOfBirth\",status,",
                "teachers"=>"employee_code AS \"employeeCode\",department,status,",_=>""};
            var where="school_id=@school AND deleted_at IS NULL AND (first_name || ' ' || last_name || ' ' || email) ILIKE @search";
            var parameters=new (string,object)[]{("school",schoolId),("search","%"+(search??"")+"%"),("offset",(page-1)*20)};
            var count=await Query(connectionString,$"SELECT count(*) AS total FROM {table} WHERE {where}",parameters);
            var data=await Query(connectionString,$"""
                SELECT id,first_name AS "firstName",last_name AS "lastName",email,phone_number AS "phoneNumber",{extra}
                school_id AS "schoolId" FROM {table} WHERE {where} ORDER BY first_name,last_name,id LIMIT 20 OFFSET @offset
                """,parameters);
            return Results.Ok(new {data=new {data,totalCount=count[0]["total"],page,pageSize=20}});
        });
        group.MapGet("/attendance",async(Guid schoolId,DateOnly day,string? className,int page=1)=>{
            if(page<1 || page>100000 || className?.Length>50) return Results.BadRequest(new {message="Invalid attendance query."});
            var rows=await Query(connectionString,"""
                SELECT s.id,s.roll_number AS "rollNumber",s.first_name AS "firstName",s.last_name AS "lastName",
                       s.current_class AS "currentClass",a.status
                FROM student_db.students s
                LEFT JOIN school_db.attendance a ON a.student_id=s.id AND a.school_id=@school AND a.day=@day
                WHERE s.school_id=@school AND s.deleted_at IS NULL AND s.status='Active' AND (@class='' OR s.current_class=@class)
                ORDER BY s.current_class,s.roll_number,s.id LIMIT 100 OFFSET @offset
                """,("school",schoolId),("day",day),("class",className??""),("offset",(page-1)*100));
            var count=await Query(connectionString,"SELECT count(*) AS total FROM student_db.students WHERE school_id=@school AND deleted_at IS NULL AND status='Active' AND (@class='' OR current_class=@class)",
                ("school",schoolId),("class",className??""));
            return Results.Ok(new {data=new {data=rows,totalCount=count[0]["total"],page}});
        });
        group.MapPost("/attendance",async(Guid schoolId, AttendanceRequest request)=>{
            if(request.Day> DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) || request.Day < new DateOnly(2000,1,1) ||
                request.Entries is null || request.Entries.Count is <1 or >100 ||
                request.Entries.Select(e=>e.StudentId).Distinct().Count()!=request.Entries.Count ||
                request.Entries.Any(e=>!new[]{"Present","Absent","Late","Excused"}.Contains(e.Status)))
                return Results.BadRequest(new {message="Select a valid date and attendance status for 1–100 students."});
            await using var connection=new NpgsqlConnection(connectionString); await connection.OpenAsync();
            await using var transaction=await connection.BeginTransactionAsync();
            foreach(var entry in request.Entries) {
                await using var command=new NpgsqlCommand("""
                    INSERT INTO school_db.attendance(school_id,student_id,day,status)
                    SELECT @school,id,@day,@status FROM student_db.students
                    WHERE id=@student AND school_id=@school AND deleted_at IS NULL AND status='Active'
                    ON CONFLICT(school_id,student_id,day) DO UPDATE SET status=EXCLUDED.status,updated_at=now()
                    """,connection,transaction);
                command.Parameters.AddWithValue("school",schoolId);command.Parameters.AddWithValue("student",entry.StudentId);
                command.Parameters.AddWithValue("day",request.Day);command.Parameters.AddWithValue("status",entry.Status);
                if(await command.ExecuteNonQueryAsync()!=1) return Results.BadRequest(new {message="A student is unavailable in this school. Refresh the register."});
            }
            await transaction.CommitAsync();
            return Results.Ok(new {data=new {saved=request.Entries.Count}});
        });
        group.MapGet("/announcements",async(Guid schoolId)=>{
            var rows=await Query(connectionString,"SELECT id,title,body,priority,created_at AS \"createdAt\" FROM school_db.announcements WHERE school_id=@school ORDER BY created_at DESC LIMIT 100",("school",schoolId));
            return Results.Ok(new {data=rows});
        });
        group.MapPost("/announcements",async(Guid schoolId,AnnouncementRequest request)=>{
            if(string.IsNullOrWhiteSpace(request.Title)||request.Title.Length>150||string.IsNullOrWhiteSpace(request.Body)||request.Body.Length>4000||!new[]{"Normal","Important"}.Contains(request.Priority))
                return Results.BadRequest(new {message="A title (150 characters max), message (4,000 max), and valid priority are required."});
            var rows=await Query(connectionString,"INSERT INTO school_db.announcements(school_id,title,body,priority) VALUES(@school,@title,@body,@priority) RETURNING id",
                ("school",schoolId),("title",request.Title.Trim()),("body",request.Body.Trim()),("priority",request.Priority));
            return Results.Json(new {data=rows[0]},statusCode:201);
        });
        group.MapDelete("/announcements/{id:guid}",async(Guid schoolId,Guid id)=>{
            var rows=await Query(connectionString,"DELETE FROM school_db.announcements WHERE school_id=@school AND id=@id RETURNING id",("school",schoolId),("id",id));
            return rows.Count==0?Results.NotFound(new{message="Announcement not found."}):Results.Ok(new{message="Announcement removed."});
        });
        group.MapGet("/audit",async(Guid schoolId,int page=1)=>{
            if(page<1 || page>100000) return Results.BadRequest(new{message="Invalid page."});
            var rows=await Query(connectionString,"SELECT id,action,entity_type AS \"entityType\",entity_id AS \"entityId\",timestamp FROM school_db.audit_logs WHERE school_id=@school ORDER BY timestamp DESC,id LIMIT 50 OFFSET @offset",
                ("school",schoolId),("offset",(page-1)*50));
            var count=await Query(connectionString,"SELECT count(*) AS total FROM school_db.audit_logs WHERE school_id=@school",("school",schoolId));
            return Results.Ok(new{data=new{data=rows,totalCount=count[0]["total"],page}});
        });
    }
}
public record AttendanceEntry(Guid StudentId,string Status);
public record AttendanceRequest(DateOnly Day,List<AttendanceEntry> Entries);
public record AnnouncementRequest(string Title,string Body,string Priority);

using System.Text.Json.Nodes;
using Npgsql;
public static partial class Suite
{
    static void MapReports(RouteGroupBuilder group){
        group.MapGet("/reports/attendance",async(string month,HttpContext http)=>{
            Require(DateOnly.TryParseExact(month+"-01","yyyy-MM-dd",out var start),"Choose a valid report month.");
            await using var c=await Open();var a=await Access(http,c);
            var rows=await Q(c,"""
                SELECT s.id AS "studentId",s.roll_number AS "admissionNumber",s.first_name || ' ' || s.last_name AS name,
                s.current_class AS class,count(*) FILTER(WHERE t.status='Present') AS present,
                count(*) FILTER(WHERE t.status='Absent') AS absent,count(*) FILTER(WHERE t.status='Late') AS late,
                count(*) FILTER(WHERE t.status='Excused') AS excused,count(t.id) AS "markedDays"
                FROM student_db.students s LEFT JOIN school_db.attendance t ON t.student_id=s.id AND t.school_id=s.school_id AND t.day>=@start AND t.day<@end
                WHERE s.school_id=@s AND s.deleted_at IS NULL GROUP BY s.id ORDER BY s.current_class,s.first_name
                """,("start",start),("end",start.AddMonths(1)),("s",a.School));
            return Results.Ok(new{data=rows.Where(r=>a.Admin||a.Students.Contains(Text(r,"studentId")))});
        });
        group.MapGet("/reports/staff-attendance",async(string month,HttpContext http)=>{
            Require(DateOnly.TryParseExact(month+"-01","yyyy-MM-dd",out var start),"Choose a valid report month.");
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin||a.Role=="Teacher","Staff attendance access denied.",403);
            var rows=await Q(c,"""
                SELECT t.id AS "teacherId",t.employee_code AS code,t.first_name || ' ' || t.last_name AS name,
                count(*) FILTER(WHERE r.data->>'status'='Present') AS present,count(*) FILTER(WHERE r.data->>'status'='Absent') AS absent,
                count(*) FILTER(WHERE r.data->>'status'='Late') AS late,count(*) FILTER(WHERE r.data->>'status'='Excused') AS excused
                FROM teacher_db.teachers t LEFT JOIN suite.records r ON r.school_id=t.school_id AND r.kind='staff-attendance'
                AND r.archived_at IS NULL AND r.data->>'teacherId'=t.id::text AND (r.data->>'day')::date>=@start AND (r.data->>'day')::date<@end
                WHERE t.school_id=@s AND t.deleted_at IS NULL GROUP BY t.id ORDER BY t.first_name
                """,("s",a.School),("start",start),("end",start.AddMonths(1)));
            return Results.Ok(new{data=rows.Where(r=>a.Admin||a.Teachers.Contains(Text(r,"teacherId")))});
        });
        group.MapGet("/reports/admissions",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Admission report access denied.",403);
            return Results.Ok(new{data=await Records(c,a.School,"admissions")});
        });
        group.MapGet("/reports/marks",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);
            var exams=await Records(c,a.School,"exams");var students=await Q(c,"SELECT id,first_name || ' ' || last_name AS name FROM student_db.students WHERE school_id=@s",("s",a.School));
            var marks=(await Records(c,a.School,"marks")).Where(m=>Readable("marks",m,a)).ToList();
            foreach(var m in marks){m["student"]=students.FirstOrDefault(s=>Text(s,"id")==Text(m,"studentId"))?["name"]?.DeepClone();m["exam"]=exams.FirstOrDefault(s=>Text(s,"id")==Text(m,"examId"))?["name"]?.DeepClone();}
            return Results.Ok(new{data=marks});
        });
        group.MapGet("/reports/audit",async(HttpContext http,int page=1)=>{
            Require(page>0,"Invalid page.");await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Audit access denied.",403);
            var rows=await Q(c,"SELECT a.id,a.action,a.entity_type AS module,a.entity_id AS record,a.created_at AS time,COALESCE(u.username,'System') AS actor FROM suite.audit a LEFT JOIN auth_db.users u ON u.id=a.user_id WHERE a.school_id=@s ORDER BY a.created_at DESC LIMIT 100 OFFSET @skip",("s",a.School),("skip",(page-1)*100));
            return Results.Ok(new{data=rows});
        });
        group.MapGet("/report-cards/{student:guid}",async(Guid student,HttpContext http,string? examName=null)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin||a.Students.Contains(student.ToString()),"Student record not available.",403);
            var pupil=(await Q(c,"SELECT id,first_name || ' ' || last_name AS name,roll_number AS \"admissionNumber\",current_class AS class FROM student_db.students WHERE id=@id AND school_id=@s",("id",student),("s",a.School))).FirstOrDefault();Require(pupil is not null,"Student not found.",404);
            var exams=(await Records(c,a.School,"exams")).Where(e=>Text(e,"status")=="Published"&&(string.IsNullOrWhiteSpace(examName)||Text(e,"name")==examName)).ToList();
            var subjects=await Records(c,a.School,"subjects");var marks=(await Records(c,a.School,"marks")).Where(m=>Text(m,"studentId")==student.ToString()).ToList();
            var results=new List<object>();decimal obtained=0,maximum=0;
            foreach(var mark in marks){var exam=exams.FirstOrDefault(e=>Text(e,"id")==Text(mark,"examId"));if(exam is null)continue;obtained+=Number(mark,"score");maximum+=Number(exam,"maxMarks");
                results.Add(new{exam=Text(exam,"name"),subject=Text(subjects.First(s=>Text(s,"id")==Text(exam,"subjectId")),"name"),score=Number(mark,"score"),maximum=Number(exam,"maxMarks"),pass=Number(mark,"score")>=Number(exam,"passMarks"),remarks=Text(mark,"remarks")});}
            var percent=maximum>0?decimal.Round(obtained/maximum*100,2):0;
            var config=(await Records(c,a.School,"school-config")).FirstOrDefault();
            decimal Threshold(string key,decimal fallback)=>config is null?fallback:Number(config,key);
            var grade=maximum==0?"Not available":percent>=Threshold("gradeA",90)?"A":percent>=Threshold("gradeB",75)?"B":percent>=Threshold("gradeC",60)?"C":percent>=Threshold("gradeD",40)?"D":"E";
            return Results.Ok(new{data=new{school=await SchoolPrint(c,a.School),student=pupil,results,obtained,maximum,percent,grade,note="Only published exams with entered marks are included. This report is not a board-issued certificate."}});
        });
        group.MapGet("/certificates/{id:guid}/print",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);var certificate=await Get(c,a.School,"certificates",id);Require(Readable("certificates",certificate,a),"Certificate access denied.",403);
            var student=(await Q(c,"SELECT first_name || ' ' || last_name AS name,roll_number AS \"admissionNumber\",current_class AS class,date_of_birth AS \"dateOfBirth\" FROM student_db.students WHERE id=@id AND school_id=@s",("id",Id(certificate,"studentId")),("s",a.School))).First();
            return Results.Ok(new{data=new{certificate,student=certificate["studentSnapshot"]?.DeepClone()??student,school=certificate["schoolSnapshot"]?.DeepClone()??await SchoolPrint(c,a.School)}});
        });
        group.MapPost("/imports/{kind}",async(string kind,JsonObject d,HttpContext http)=>{
            Require(kind is "students" or "teachers","Only student or staff imports are supported.");await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Only administrators can import records.",403);
            Require(d["rows"] is JsonArray,"Import rows must be an array.");Require(d["commit"] is JsonValue commitValue&&commitValue.TryGetValue<bool>(out _),"Commit must be true or false.");var rows=d["rows"]?.AsArray();Require(rows is not null&&rows.Count is >0 and <=500,"Import 1–500 rows per workbook.");
            var errors=new List<string>();var items=new List<JsonObject>();var codes=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for(var i=0;i<rows!.Count;i++){
                if(rows[i] is not JsonObject row){errors.Add("Row "+(i+2)+": Invalid row.");continue;}items.Add(row);
                foreach(var key in new[]{"firstName","lastName","email",kind=="students"?"rollNumber":"employeeCode"})if(string.IsNullOrWhiteSpace(Text(row,key)))errors.Add("Row "+(i+2)+": "+key+" is required.");
                foreach(var key in new[]{"firstName","lastName"})if(Text(row,key).Length>100)errors.Add("Row "+(i+2)+": "+key+" exceeds 100 characters.");
                if(!System.Net.Mail.MailAddress.TryCreate(Text(row,"email"),out _))errors.Add("Row "+(i+2)+": Invalid email.");
                var code=Text(row,kind=="students"?"rollNumber":"employeeCode");if(code.Length>50||!codes.Add(code))errors.Add("Row "+(i+2)+": Duplicate or oversized record number.");
                if(Text(row,"phoneNumber").Length>20)errors.Add("Row "+(i+2)+": Phone number is too long.");
                if(kind=="students"&&(!DateOnly.TryParse(Text(row,"dateOfBirth"),out var birth)||birth>=DateOnly.FromDateTime(DateTime.UtcNow)))errors.Add("Row "+(i+2)+": Invalid dateOfBirth; use YYYY-MM-DD.");
                if(kind=="students"&&Text(row,"currentClass").Length is <1 or >50)errors.Add("Row "+(i+2)+": currentClass is required, up to 50 characters.");
                if(kind=="teachers"&&Text(row,"department").Length is <1 or >50)errors.Add("Row "+(i+2)+": department is required, up to 50 characters.");
            }
            if(errors.Count>0||d["commit"]?.GetValue<bool>()!=true)return Results.Ok(new{data=new{valid=errors.Count==0,errors,count=rows.Count,committed=false}});
            await using var tx=await c.BeginTransactionAsync();
            foreach(var row in items){
                if(kind=="students")await E(c,"INSERT INTO student_db.students(id,school_id,roll_number,first_name,last_name,email,phone_number,date_of_birth,admission_date,current_class,status) VALUES(@id,@s,@code,@first,@last,@email,@phone,@dob,CURRENT_DATE,@class,'Active')",
                    ("id",Guid.NewGuid()),("s",a.School),("code",Text(row,"rollNumber")),("first",Text(row,"firstName")),("last",Text(row,"lastName")),("email",Text(row,"email")),("phone",Text(row,"phoneNumber")),("dob",Day(row,"dateOfBirth")),("class",Text(row,"currentClass")));
                else await E(c,"INSERT INTO teacher_db.teachers(id,school_id,employee_code,first_name,last_name,email,phone_number,department,status) VALUES(@id,@s,@code,@first,@last,@email,@phone,@department,'Active')",
                    ("id",Guid.NewGuid()),("s",a.School),("code",Text(row,"employeeCode")),("first",Text(row,"firstName")),("last",Text(row,"lastName")),("email",Text(row,"email")),("phone",Text(row,"phoneNumber")),("department",Text(row,"department")));
            }
            await tx.CommitAsync();return Results.Ok(new{data=new{valid=true,errors,count=rows.Count,committed=true}});
        });
    }
}

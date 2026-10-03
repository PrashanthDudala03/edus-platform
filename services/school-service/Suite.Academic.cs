using System.Text.Json.Nodes;
using Npgsql;
public static partial class Suite
{
    static async Task ValidateBusiness(NpgsqlConnection c,SchoolAccess a,string kind,JsonObject d,JsonObject? old,Guid? id)
    {
        var peers=(await Records(c,a.School,kind)).Where(x=>Text(x,"id")!=id?.ToString()).ToList();
        void Unique(params string[] keys)=>Require(!peers.Any(p=>keys.All(k=>string.Equals(Text(p,k),Text(d,k),StringComparison.OrdinalIgnoreCase))),"A record with these details already exists.",409);
        if(kind=="academic-years"){Require(Day(d,"startsOn")<Day(d,"endsOn"),"Academic year must end after it starts.");Unique("name");if(Text(d,"status")=="Current")Require(!peers.Any(p=>Text(p,"status")=="Current"),"Close the current academic year before selecting a new one.",409);}
        if(kind=="classes"){Require((Text(d,"name")+" - "+Text(d,"section")).Length<=50,"Class and section label must be at most 50 characters.");Require(Number(d,"capacity")>=1&&Number(d,"capacity")<=500&&decimal.Truncate(Number(d,"capacity"))==Number(d,"capacity"),"Class capacity must be a whole number from 1 to 500.");Unique("name","section","yearId");if(id.HasValue){var count=await Q(c,"SELECT count(*) AS n FROM suite.student_classes WHERE class_id=@id AND school_id=@s",("id",id),("s",a.School));Require(Number(count[0],"n")<=Number(d,"capacity"),"Capacity cannot be lower than current enrollment.");}}
        if(kind=="subjects")Unique("code");
        if(kind=="teaching-assignments")Unique("classId","subjectId","teacherId");
        if(kind=="admissions"){Require(Text(d,"admissionNumber").Length<=50&&Text(d,"firstName").Length<=100&&Text(d,"lastName").Length<=100,"Admission number or student name is too long.");Require(Text(d,"phoneNumber").Length<=20&&Text(d,"guardianPhone").Length<=20,"Phone numbers must be at most 20 characters.");Require(Text(d,"guardianName").Split(' ',2).All(part=>part.Length<=100),"Guardian name parts must be at most 100 characters.");Unique("admissionNumber");Require(Day(d,"dateOfBirth")<DateOnly.FromDateTime(DateTime.UtcNow),"Date of birth must be in the past.");Require(old is null||Text(old,"status")!="Accepted","Accepted admissions are preserved. Edit the student record instead.",409);}
        if(kind=="staff-attendance"){Unique("teacherId","day");Require(Day(d,"day")<=DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)),"Attendance cannot be entered in the future.");}
        if(kind=="leave-requests"){
            Require(Day(d,"fromDate")<=Day(d,"toDate"),"Leave end date must be on or after the start.");
            Require(!peers.Any(p=>Text(p,"teacherId")==Text(d,"teacherId")&&Text(p,"status")!="Rejected"&&Text(d,"status")!="Rejected"&&Day(p,"fromDate")<=Day(d,"toDate")&&Day(p,"toDate")>=Day(d,"fromDate")),"This staff member already has an overlapping leave request.",409);
        }
        if(kind=="fee-structures"){Require(Number(d,"amount")>0,"Fee amount must be positive.");Unique("name","classId","installment");if(old is not null){var issued=await Q(c,"SELECT id FROM suite.charges WHERE structure_id=@id AND school_id=@s LIMIT 1",("id",id),("s",a.School));Require(issued.Count==0,"An issued fee structure is immutable. Create a new structure or instalment.",409);}}
        if(kind=="exams"){Require(Number(d,"maxMarks")>0&&Number(d,"passMarks")<=Number(d,"maxMarks"),"Pass marks must be within the positive maximum marks.");Unique("name","classId","subjectId");if(old is not null&&Text(old,"status")=="Published")Require(Text(d,"maxMarks")==Text(old,"maxMarks")&&Text(d,"classId")==Text(old,"classId")&&Text(d,"subjectId")==Text(old,"subjectId"),"Published exam details cannot be changed.");}
        if(kind=="marks"){
            Unique("examId","studentId");var exam=await Get(c,a.School,"exams",Id(d,"examId"));
            Require(Text(exam,"status")=="Draft","Unpublish this exam before correcting marks.",409);
            Require(Number(d,"score")<=Number(exam,"maxMarks"),"Marks cannot exceed the exam maximum.");
            await InClass(c,a.School,Id(d,"studentId"),Id(exam,"classId"));
        }
        if(kind=="circulars"&&Text(d,"dueDate")!="")Require(Day(d,"dueDate")>=DateOnly.FromDateTime(DateTime.UtcNow),"Acknowledgement deadline cannot be in the past.");
        if(kind=="calendar")Require(Day(d,"startsOn")<=Day(d,"endsOn"),"Event end date must follow its start.");
        if(kind=="messages"&&!a.SchoolWide){
            var links=await Records(c,a.School,"account-links");Require(links.Any(l=>Text(l,"userId")==Text(d,"recipientUserId")&&a.Students.Contains(Text(l,"studentId"))),"Teachers may message linked accounts in their assigned classes only.",403);
        }
        if(kind=="homework"){
            // Lifecycle: a new assignment is a draft unless published outright; later changes follow the allowed transitions.
            if(Text(d,"status")=="")d["status"]=old is null?"Published":HomeworkRules.Status(Text(old,"status"));
            var handedIn=old is null?0:(await Records(c,a.School,"submissions")).Count(s=>Text(s,"homeworkId")==id.ToString());
            var problem=HomeworkRules.TransitionProblem(old is null?"Draft":Text(old,"status"),Text(d,"status"),handedIn);Require(problem is null,problem??"",409);
            if(old is null&&Text(d,"status")=="Published")Require(Day(d,"dueDate")>=DateOnly.FromDateTime(DateTime.UtcNow),"A new assignment cannot be due in the past.");
            if(Text(d,"status")=="Published"&&(old is null||HomeworkRules.Status(Text(old,"status"))!="Published"))d["publishedOn"]=DateTime.UtcNow.ToString("yyyy-MM-dd");
            else if(old?["publishedOn"] is not null)d["publishedOn"]=old["publishedOn"]!.DeepClone();
            if(d["maxMarks"] is JsonValue m&&m.TryGetValue<decimal>(out var max))Require(max>0&&max<=1000,"Maximum marks must be between 1 and 1000.");
            // A teacher sets work only for a subject they are assigned to teach in that class (the class teacher may set any subject).
            if(a.Role=="Teacher"&&!a.SchoolWide){var mine=(await Records(c,a.School,"teaching-assignments")).Where(t=>a.Teachers.Contains(Text(t,"teacherId"))&&Text(t,"classId")==Text(d,"classId")).Select(t=>Text(t,"subjectId")).ToList();
                var classTeacher=(await Records(c,a.School,"classes")).Any(cl=>Text(cl,"id")==Text(d,"classId")&&a.Teachers.Contains(Text(cl,"teacherId")));
                Require(classTeacher||mine.Count==0||mine.Contains(Text(d,"subjectId")),"You are not assigned to teach this subject in this class.",403);}
        }
        if(kind=="submissions"){
            Unique("homeworkId","studentId");var homework=await Get(c,a.School,"homework",Id(d,"homeworkId"));await InClass(c,a.School,Id(d,"studentId"),Id(homework,"classId"));
            foreach(var key in new[]{"submittedAt","late","status","reviewedAt","verifiedAt","history"})if(old?[key] is not null)d[key]=old[key]!.DeepClone();
            var staff=a.SchoolWide||a.Role=="Teacher";var now=DateTime.UtcNow;var mode=HomeworkRules.Mode(Text(homework,"submissionMode"));
            if(!staff){
                // Students never set the teacher's check, marks or feedback; those stay as they were.
                d["outcome"]=old is null?"":Text(old,"outcome");d["grade"]=old is null?"":Text(old,"grade");d["feedback"]=old is null?"":Text(old,"feedback");
                var problem=HomeworkRules.SubmitProblem(Text(homework,"status"),Text(old??new(),"status"),Text(d,"outcome"),mode,Text(d,"response"));Require(problem is null,problem??"",409);
                if(old is not null&&Text(old,"response")!=Text(d,"response")){
                    // Handing in again keeps the earlier work: the newest few versions travel with the record.
                    var history=old["history"] is JsonArray h?(JsonArray)h.DeepClone():new JsonArray();history.Add(new JsonObject{["response"]=Text(old,"response"),["submittedAt"]=Text(old,"submittedAt")});
                    while(history.Count>HomeworkRules.MaxHistory)history.RemoveAt(0);d["history"]=history;
                }
                // A first hand-in (or a changed one) is stamped now and judged against the due moment; it clears a "missing" check.
                if(old is null||Text(old,"response")!=Text(d,"response")){d["submittedAt"]=now.ToString("o");d["late"]=HomeworkRules.IsLate(now,Text(homework,"dueDate"),Text(homework,"dueTime"))?"Yes":"No";d["status"]="Submitted";if(Text(d,"outcome")=="Missing")d["outcome"]="";}
            }else{
                // Marks and feedback make the work reviewed; clearing both returns it to handed in. The check (Completed, Late, Missing, Excused) is stamped when it changes.
                Require(Text(d,"outcome")==""||HomeworkRules.Outcomes.Contains(Text(d,"outcome")),"Choose Completed, Late, Missing or Excused.");
                var marks=HomeworkRules.MarksProblem(Text(homework,"maxMarks"),Text(d,"grade"));Require(marks is null,marks??"");
                var reviewed=Text(d,"grade")!=""||Text(d,"feedback")!="";if(reviewed)d["status"]="Reviewed";else if(Text(d,"status")=="Reviewed")d["status"]="Submitted";
                if(reviewed&&(old is null||Text(old,"grade")!=Text(d,"grade")||Text(old,"feedback")!=Text(d,"feedback")||Text(old,"status")!="Reviewed"))d["reviewedAt"]=now.ToString("o");else if(!reviewed)d.Remove("reviewedAt");
                if(Text(d,"outcome")!=(old is null?"":Text(old,"outcome")))d["verifiedAt"]=now.ToString("o");
            }
            if(Text(d,"status")=="")d["status"]=Text(d,"outcome")==""?"Submitted":"";
        }
        if(kind=="timetable"){
            Require(TimeOnly.Parse(Text(d,"startsAt"))<TimeOnly.Parse(Text(d,"endsAt")),"Period must end after it starts.");
            foreach(var p in peers)if(Text(p,"day")==Text(d,"day")&&(Text(p,"classId")==Text(d,"classId")||Text(p,"teacherId")==Text(d,"teacherId"))&&TimeOnly.Parse(Text(p,"startsAt"))<TimeOnly.Parse(Text(d,"endsAt"))&&TimeOnly.Parse(Text(p,"endsAt"))>TimeOnly.Parse(Text(d,"startsAt")))throw new SuiteError(409,"This period overlaps an existing class or teacher timetable slot.");
            var assignments=await Records(c,a.School,"teaching-assignments");Require(assignments.Any(x=>Text(x,"classId")==Text(d,"classId")&&Text(x,"subjectId")==Text(d,"subjectId")&&Text(x,"teacherId")==Text(d,"teacherId")),"Create the matching teacher / class / subject assignment first.");
        }
        if(kind=="account-links"){
            Require(old is null || Text(old,"userId")==Text(d,"userId"),"A profile link cannot be transferred to another account.");
            Require((Text(d,"studentId")!="")^(Text(d,"teacherId")!=""),"Link either one student or one teacher per access link.");
            var user=await Q(c,"SELECT t.data_scope AS role FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id JOIN auth_db.role_templates t ON t.id=r.template_id WHERE u.id=@id AND u.school_id=@s",("id",Id(d,"userId")),("s",a.School));
            var role=Text(user[0],"role");
            if(Text(d,"relationship")=="")d["relationship"]=Text(d,"teacherId")!=""?"teacher":role=="student"?"student":"parent";
            Require(Text(d,"teacherId")!=""?Text(d,"relationship")=="teacher":Text(d,"relationship") is "parent" or "student","Relationship does not match the linked profile.");
            Require(old is null || Text(old,"relationship")==Text(d,"relationship"),"Create a new verified link to change relationship type.");
            Unique("userId","studentId","teacherId");
            if(Text(d,"relationship")=="student"||Text(d,"teacherId")!="")Require(!peers.Any(p=>Text(p,"userId")==Text(d,"userId") && Text(p,"relationship")==Text(d,"relationship")),"This account already has a profile link.",409);
        }
        if(kind=="school-config"){
            Require(peers.Count==0,"Edit the existing school configuration.",409);
            var grades=new[]{Number(d,"gradeA"),Number(d,"gradeB"),Number(d,"gradeC"),Number(d,"gradeD")};
            Require(grades.All(v=>v>=0&&v<=100)&&grades[0]>grades[1]&&grades[1]>grades[2]&&grades[2]>grades[3],"Grade thresholds must descend from A to D within 0–100.");
        }
        if(kind=="certificates"){Require(Day(d,"issuedOn")<=DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)),"Issue date cannot be in the future.");Require(old is null,"Issued certificates are immutable. Issue a replacement with a note if needed.",409);}
    }
    static async Task InClass(NpgsqlConnection c,Guid school,Guid student,Guid cl){
        var rows=await Q(c,"SELECT student_id FROM suite.student_classes WHERE school_id=@s AND student_id=@u AND class_id=@c",("s",school),("u",student),("c",cl));
        Require(rows.Count==1,"The student is not allocated to this class.");
    }
    static async Task Allocate(NpgsqlConnection c,SchoolAccess a,Guid student,Guid classId){
        var cl=await Get(c,a.School,"classes",classId);
        var capacity=await Q(c,"SELECT count(*) AS count FROM suite.student_classes WHERE school_id=@s AND class_id=@c AND student_id<>@u",("s",a.School),("c",classId),("u",student));
        Require(Number(capacity[0],"count")<Number(cl,"capacity"),"This class is at capacity.",409);
        await E(c,"INSERT INTO suite.student_classes(school_id,student_id,class_id) VALUES(@s,@u,@c) ON CONFLICT(school_id,student_id) DO UPDATE SET class_id=excluded.class_id,updated_at=now()",("s",a.School),("u",student),("c",classId));
        await E(c,"UPDATE student_db.students SET current_class=@label,updated_at=now() WHERE id=@id AND school_id=@s",("label",Label("classes",cl)),("id",student),("s",a.School));
    }
    static void MapAcademic(RouteGroupBuilder group){
        group.MapGet("/student-attendance",async(DateOnly day,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.SchoolWide||a.Role=="Teacher","Register access denied.",403);
            var rows=await Q(c,"SELECT s.id,s.roll_number AS code,s.first_name || ' ' || s.last_name AS name,s.current_class AS class,t.status FROM student_db.students s LEFT JOIN school_db.attendance t ON t.student_id=s.id AND t.school_id=s.school_id AND t.day=@day WHERE s.school_id=@s AND s.deleted_at IS NULL AND s.status='Active' ORDER BY s.current_class,s.first_name",("s",a.School),("day",day));
            return Results.Ok(new{data=rows.Where(r=>a.SchoolWide||a.Students.Contains(Text(r,"id")))});
        });
        group.MapPost("/student-attendance",SaveRegister);
        MapHomework(group);
        MapAttendance(group);
        group.MapPost("/admissions/{id:guid}/accept",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Only administrators can accept admissions.",403);
            await using var tx=await c.BeginTransactionAsync();await E(c,"SELECT pg_advisory_xact_lock(hashtextextended(@s,0))",("s",a.School.ToString()));
            var d=await Get(c,a.School,"admissions",id);Require(Text(d,"status")=="Submitted","Submit this application before accepting it.",409);
            var guardian=await Q(c,"SELECT id FROM parent_db.parents WHERE school_id=@s AND email=@e AND deleted_at IS NULL",("s",a.School),("e",Text(d,"guardianEmail")));
            var parentId=guardian.Count>0?Guid.Parse(Text(guardian[0],"id")):Guid.NewGuid();
            if(guardian.Count==0){var parts=Text(d,"guardianName").Split(' ',2);await E(c,"INSERT INTO parent_db.parents(id,school_id,first_name,last_name,email,phone_number) VALUES(@id,@s,@first,@last,@email,@phone)",("id",parentId),("s",a.School),("first",parts[0]),("last",parts.Length>1?parts[1]:"Guardian"),("email",Text(d,"guardianEmail")),("phone",Text(d,"guardianPhone")));}
            var studentId=Guid.NewGuid();
            await E(c,"INSERT INTO student_db.students(id,school_id,roll_number,first_name,last_name,date_of_birth,gender,email,phone_number,address,admission_date,status,parent_guardian_id) VALUES(@id,@s,@no,@first,@last,@dob,@gender,@email,@phone,@address,CURRENT_DATE,'Active',@parent)",
                ("id",studentId),("s",a.School),("no",Text(d,"admissionNumber")),("first",Text(d,"firstName")),("last",Text(d,"lastName")),("dob",Day(d,"dateOfBirth")),("gender",Text(d,"gender")),("email",Text(d,"email")),("phone",Text(d,"phoneNumber")),("address",Text(d,"address")),("parent",parentId));
            await Allocate(c,a,studentId,Id(d,"classId"));
            d.Remove("id");d.Remove("version");d.Remove("createdAt");d["status"]="Accepted";d["studentId"]=studentId.ToString();d["acceptedAt"]=DateTime.UtcNow;
            await E(c,"UPDATE suite.records SET data=@d::jsonb,version=version+1,updated_by=@u,updated_at=now() WHERE id=@id AND school_id=@s",("d",d.ToJsonString()),("u",a.User),("id",id),("s",a.School));
            await tx.CommitAsync();return Results.Ok(new{data=new{studentId}});
        });
        group.MapPost("/allocate",async(JsonObject d,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Only administrators can allocate or promote students.",403);
            Require(d["studentIds"] is JsonArray,"Student IDs must be an array.");var ids=d["studentIds"]?.AsArray().Select(n=>Guid.Parse(n!.ToString())).Distinct().ToList()??[];
            Require(ids.Count is >0 and <=500,"Choose between 1 and 500 students.");var cl=Id(d,"classId");
            await using var tx=await c.BeginTransactionAsync();await E(c,"SELECT pg_advisory_xact_lock(hashtextextended(@s,0))",("s",a.School.ToString()));
            foreach(var student in ids){await Reference(c,a,"students",student.ToString());await Allocate(c,a,student,cl);}
            await tx.CommitAsync();return Results.Ok(new{data=new{allocated=ids.Count}});
        });
        group.MapGet("/allocations",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);
            var rows=await Q(c,"SELECT sc.student_id AS \"studentId\",sc.class_id AS \"classId\",s.first_name || ' ' || s.last_name AS name,s.current_class AS class FROM suite.student_classes sc JOIN student_db.students s ON s.id=sc.student_id WHERE sc.school_id=@s AND s.deleted_at IS NULL ORDER BY s.first_name",("s",a.School));
            return Results.Ok(new{data=rows.Where(r=>a.SchoolWide||a.Students.Contains(Text(r,"studentId")))});
        });
        group.MapPost("/circulars/{id:guid}/acknowledge",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);var record=await Get(c,a.School,"circulars",id);Require(Readable("circulars",record,a),"Circular is not addressed to your account.",403);
            await E(c,"INSERT INTO suite.acknowledgements(school_id,record_id,user_id) VALUES(@s,@r,@u) ON CONFLICT DO NOTHING",("s",a.School),("r",id),("u",a.User));return Results.Ok(new{message="Acknowledgement recorded."});
        });
        group.MapGet("/circulars/{id:guid}/acknowledgements",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.SchoolWide,"Only administrators can view acknowledgement tracking.",403);
            await Get(c,a.School,"circulars",id);
            return Results.Ok(new{data=await Q(c,"SELECT u.first_name || ' ' || u.last_name AS name,a.created_at AS \"acknowledgedAt\" FROM suite.acknowledgements a JOIN auth_db.users u ON u.id=a.user_id WHERE a.school_id=@s AND a.record_id=@r ORDER BY a.created_at",("s",a.School),("r",id))});
        });
        group.MapPost("/absence-notifications",async(JsonObject d,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.SchoolWide,"Only administrators can send absence notices.",403);var day=Day(d,"day");
            var absent=await Q(c,"SELECT student_id FROM school_db.attendance WHERE school_id=@s AND day=@d AND status='Absent'",("s",a.School),("d",day));
            var sent=0;foreach(var student in absent)sent+=await NotifyStudent(c,a,Guid.Parse(Text(student,"student_id")),"Absence notification","Attendance was marked absent on "+day.ToString("yyyy-MM-dd")+". Please contact the school if this needs correction.","absence:"+Text(student,"student_id")+":"+day.ToString("yyyy-MM-dd"));
            return Results.Ok(new{data=new{sent},message=sent>0?sent+" in-app notifications made available.":"No new notifications: recipients are unlinked or notices already exist."});
        });
    }
    static async Task<int> NotifyStudent(NpgsqlConnection c,SchoolAccess a,Guid student,string title,string body,string key){
        var links=(await Records(c,a.School,"account-links")).Where(l=>Text(l,"studentId")==student.ToString()).Select(l=>Text(l,"userId")).Distinct().ToList();var count=0;
        foreach(var user in links){
            var d=new JsonObject{["title"]=title,["message"]=body,["recipientUserId"]=user,["notificationKey"]=key};
            var existing=await Q(c,"SELECT id FROM suite.records WHERE school_id=@s AND kind='messages' AND data->>'notificationKey'=@key AND data->>'recipientUserId'=@u",("s",a.School),("key",key),("u",user));
            if(existing.Count>0)continue;
            await E(c,"INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES(@id,@s,'messages',@d::jsonb,@u,@u)",("id",Guid.NewGuid()),("s",a.School),("d",d.ToJsonString()),("u",a.User));count++;
        }return count;
    }
}

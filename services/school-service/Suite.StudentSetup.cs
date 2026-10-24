using System.Text.Json.Nodes;
using Npgsql;
using EduOS.ServiceAuth;

public static partial class Suite
{
    static async Task<SchoolAccess> StudentSetupAccess(HttpContext http,NpgsqlConnection c)
    {
        var a=await Access(http,c);
        Require(a.SchoolWide&&a.Can("users.view")&&a.Can("students.view")&&a.Can("parents.view")&&a.Can("classes.view")&&a.Can("account-links.manage"),"Your role cannot set up student connections.",403);return a;
    }
    static async Task<JsonObject> SetupAccount(NpgsqlConnection c,SchoolAccess a,Guid id,string scope)
    {
        var row=(await Q(c,"SELECT u.id,u.first_name AS \"firstName\",u.last_name AS \"lastName\",u.email,u.phone_number AS phone FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id JOIN auth_db.role_templates t ON t.id=r.template_id WHERE u.school_id=@s AND u.id=@id AND u.is_active AND u.deleted_at IS NULL AND r.enabled AND t.data_scope=@scope",("s",a.School),("id",id),("scope",scope))).FirstOrDefault();
        Require(row is not null,"Account not available in this school with the required role.",404);return row!;
    }
    static bool SetupFlag(JsonObject input,string key)=>input[key] is JsonValue value&&value.TryGetValue<bool>(out var flag)&&flag;
    static async Task SetupLink(NpgsqlConnection c,SchoolAccess a,Guid account,Guid student,string relationship)
    {
        var peers=await Records(c,a.School,"account-links");
        if(peers.Any(l=>Text(l,"userId")==account.ToString()&&Text(l,"studentId")==student.ToString()&&Text(l,"relationship")==relationship))return;
        Require(relationship!="student"||!peers.Any(l=>Text(l,"relationship")=="student"&&(Text(l,"userId")==account.ToString()||Text(l,"studentId")==student.ToString())),"This student or account is already connected to a different profile. Review the existing link.",409);
        var link=new JsonObject{["userId"]=account.ToString(),["studentId"]=student.ToString(),["teacherId"]="",["relationship"]=relationship};
        await E(c,"INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES(@id,@s,'account-links',@d::jsonb,@u,@u)",("id",Guid.NewGuid()),("s",a.School),("d",link.ToJsonString()),("u",a.User));
        await E(c,"UPDATE auth_db.users SET token_version=token_version+1 WHERE school_id=@s AND id=@id",("s",a.School),("id",account));
        await E(c,"UPDATE auth_db.refresh_tokens SET revoked_at=now() WHERE school_id=@s AND user_id=@id AND revoked_at IS NULL",("s",a.School),("id",account));
        await E(c,"INSERT INTO auth_db.iam_audit(school_id,actor_id,actor_role,action,target_id,old_value,new_value) VALUES(@s,@u,@role,'profile.linked',@id,'null'::jsonb,@d::jsonb)",("s",a.School),("u",a.User),("role",a.Role),("id",account),("d",link.ToJsonString()));
    }
    static void MapStudentSetup(RouteGroupBuilder group)
    {
        group.MapGet("/student-setup/{account:guid}",async(Guid account,HttpContext http,string? search=null)=>{
            await using var c=await Open();var a=await StudentSetupAccess(http,c);var user=await SetupAccount(c,a,account,"student");
            var links=await Records(c,a.School,"account-links");var link=links.FirstOrDefault(l=>Text(l,"userId")==account.ToString()&&Text(l,"relationship")=="student");
            var linked=Guid.TryParse(Text(link??new(),"studentId"),out var sid)?sid:(Guid?)null;
            var students=await Q(c,"""
                SELECT s.id,s.first_name||' '||s.last_name AS name,s.email,s.roll_number AS number,s.parent_guardian_id AS "guardianId",sc.class_id AS "classId"
                FROM student_db.students s LEFT JOIN suite.student_classes sc ON sc.school_id=@s AND sc.student_id=s.id
                WHERE s.school_id=@s AND s.deleted_at IS NULL AND (s.id=@linked::uuid OR @q='' OR s.first_name||' '||s.last_name ILIKE @like OR s.email ILIKE @like OR s.roll_number ILIKE @like)
                ORDER BY s.id=@linked::uuid DESC NULLS LAST,lower(s.email)=lower(@email) DESC,s.first_name LIMIT 250
                """,("s",a.School),("linked",linked),("q",search??""),("like","%"+(search??"").Trim().Take(100).Aggregate("",(s,ch)=>s+ch)+"%"),("email",Text(user,"email")));
            var parents=await Q(c,"SELECT id,first_name||' '||last_name AS name,email,phone_number AS phone FROM parent_db.parents WHERE school_id=@s AND deleted_at IS NULL ORDER BY first_name LIMIT 500",("s",a.School));
            var accounts=await Q(c,"SELECT u.id,u.first_name||' '||u.last_name AS name,u.email FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id JOIN auth_db.role_templates t ON t.id=r.template_id WHERE u.school_id=@s AND u.is_active AND u.deleted_at IS NULL AND t.data_scope='parent' ORDER BY u.first_name LIMIT 500",("s",a.School));
            return Results.Ok(new{data=new{account=user,linkedStudentId=linked,students,parents,parentAccounts=accounts,parentLinks=links.Where(l=>Text(l,"relationship")=="parent").Select(l=>new{userId=Text(l,"userId"),studentId=Text(l,"studentId")}),classes=(await Records(c,a.School,"classes")).Select(cl=>new{id=Text(cl,"id"),name=Label("classes",cl)})}});
        });
        group.MapPost("/student-setup/{account:guid}",async(Guid account,JsonObject input,HttpContext http)=>{
            await using var c=await Open();var a=await StudentSetupAccess(http,c);await using var tx=await c.BeginTransactionAsync();
            await E(c,"SELECT pg_advisory_xact_lock(610012026)");await E(c,"SELECT pg_advisory_xact_lock(hashtextextended(@s,0))",("s",a.School.ToString()));
            var user=await SetupAccount(c,a,account,"student");var mode=Text(input,"mode");Require(mode is "new" or "existing","Choose a student setup path.");
            var links=await Records(c,a.School,"account-links");var current=links.FirstOrDefault(l=>Text(l,"userId")==account.ToString()&&Text(l,"relationship")=="student");
            if(mode=="new"&&current is not null){await tx.RollbackAsync();return Results.Ok(new{data=new{studentId=Text(current,"studentId"),alreadyLinked=true},message="This account already has a student profile. Existing record kept."});}
            Guid student;JsonObject? existing=null;
            if(mode=="existing"){
                student=Id(input,"studentId");await Reference(c,a,"students",student.ToString());
                Require(current is null||Text(current,"studentId")==student.ToString(),"This login already belongs to another student. It cannot be reassigned here.",409);
                Require(!links.Any(l=>Text(l,"relationship")=="student"&&Text(l,"studentId")==student.ToString()&&Text(l,"userId")!=account.ToString()),"This student already has another login. Keep that connection.",409);
                existing=(await Q(c,"SELECT parent_guardian_id AS parent FROM student_db.students WHERE school_id=@s AND id=@id",("s",a.School),("id",student)))[0];
                Require(SetupFlag(input,"verified"),"Confirm the selected student is the same person.");
            }else{
                Require(a.Can("students.create"),"Student creation permission is required.",403);
                Require((await Q(c,"SELECT id FROM student_db.students WHERE school_id=@s AND deleted_at IS NULL AND lower(email)=lower(@e)",("s",a.School),("e",Text(user,"email")))).Count==0,"A student record already uses this email. Choose Link existing student.",409);student=Guid.NewGuid();
                Require(Day(input,"dateOfBirth")<DateOnly.FromDateTime(DateTime.UtcNow),"Enter the student's actual date of birth, before today.");Require(Text(input,"gender") is "Male" or "Female" or "Other","Choose a gender.");
            }
            var guardianMode=Text(input,"guardianMode");Require(guardianMode is "keep" or "existing" or "new","Choose how to connect the guardian.");
            Guid? parent=existing is not null&&Guid.TryParse(Text(existing,"parent"),out var pid)?pid:null;var guardianEmail="";
            if(guardianMode!="keep"){
                Require(a.Can("students.update")||mode=="new","Student update permission is required.",403);
                Require(SetupFlag(input,"guardianVerified"),"Verify the guardian relationship before linking.");
                if(guardianMode=="existing"){parent=Id(input,"parentId");await Reference(c,a,"parents",parent.ToString()!);}
                else{
                    Require(a.Can("parents.create"),"Parent creation permission is required.",403);
                    var first=Text(input,"guardianFirstName");var last=Text(input,"guardianLastName");guardianEmail=Text(input,"guardianEmail");var phone=Text(input,"guardianPhone");
                    Require(first.Length is >0 and <=100&&last.Length is >0 and <=100&&phone.Length<=30&&guardianEmail.Length<=255&&System.Net.Mail.MailAddress.TryCreate(guardianEmail,out _),"Enter valid guardian names, email and phone.");
                    Require((await Q(c,"SELECT id FROM parent_db.parents WHERE school_id=@s AND deleted_at IS NULL AND lower(email)=lower(@e)",("s",a.School),("e",guardianEmail))).Count==0,"This guardian email already exists. Select the existing guardian.",409);
                    parent=Guid.NewGuid();await E(c,"INSERT INTO parent_db.parents(id,school_id,first_name,last_name,email,phone_number) VALUES(@id,@s,@first,@last,@e,@phone)",("id",parent), ("s",a.School),("first",first),("last",last),("e",guardianEmail),("phone",phone));
                }
            }
            if(mode=="new"){
                var number=await NextNumber(c,a.School,"student","STU");
                await E(c,"INSERT INTO student_db.students(id,school_id,roll_number,first_name,last_name,email,phone_number,date_of_birth,gender,address,admission_date,status,parent_guardian_id) VALUES(@id,@s,@n,@first,@last,@e,@phone,@dob,@gender,@address,CURRENT_DATE,'Active',@parent)",("id",student),("s",a.School),("n",number),("first",Text(user,"firstName")),("last",Text(user,"lastName")),("e",Text(user,"email")),("phone",Text(user,"phone")),("dob",Day(input,"dateOfBirth")),("gender",Text(input,"gender")),("address",Text(input,"address").Length<=1000?Text(input,"address"):throw new SuiteError(400,"Address is too long.")),("parent",parent));
            }else if(guardianMode!="keep")await E(c,"UPDATE student_db.students SET parent_guardian_id=@parent,updated_at=now() WHERE school_id=@s AND id=@id",("parent",parent),("s",a.School),("id",student));
            if(Text(input,"classId")!=""){Require(a.Can("allocations.manage"),"Class allocation permission is required.",403);await Allocate(c,a,student,Id(input,"classId"));}
            await SetupLink(c,a,account,student,"student");
            if(Text(input,"parentUserId")!=""){
                Require(parent.HasValue&&SetupFlag(input,"guardianVerified"),"Select and verify the guardian before connecting a parent login.");
                guardianEmail=Text((await Q(c,"SELECT email FROM parent_db.parents WHERE school_id=@s AND id=@id",("s",a.School),("id",parent)))[0],"email");var parentAccount=Id(input,"parentUserId");await SetupAccount(c,a,parentAccount,"parent");
                Require(await AccountProblem(c,a.School,parentAccount.ToString(),"parent",guardianEmail,student.ToString()) is null,"The parent login must match the verified guardian's email.",409);await SetupLink(c,a,parentAccount,student,"parent");
            }
            await E(c,"INSERT INTO auth_db.iam_audit(school_id,actor_id,actor_role,action,target_id,old_value,new_value) VALUES(@s,@u,@role,'student.setup',@id,'null'::jsonb,@d::jsonb)",("s",a.School),("u",a.User),("role",a.Role),("id",account),("d",new JsonObject{["studentId"]=student.ToString(),["mode"]=mode,["classId"]=Text(input,"classId"),["guardianId"]=parent?.ToString()}.ToJsonString()));
            await tx.CommitAsync();return Results.Ok(new{data=new{studentId=student.ToString(),alreadyLinked=false},message="Student connections saved. Linked accounts must sign in again."});
        });
    }
}

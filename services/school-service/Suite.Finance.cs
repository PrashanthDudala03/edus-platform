using System.Text.Json.Nodes;
using Npgsql;
public static partial class Suite
{
    static long Cents(JsonObject d,string key){var n=Number(d,key);Require(n>=0&&n<=100000000&&decimal.Round(n,2)==n,"Money must be non-negative with at most two decimal places.");return checked((long)(n*100));}
    static void MapFinance(RouteGroupBuilder group){
        group.MapGet("/fees",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin||a.Role is "Parent" or "Student","Fee access is limited to administrators and linked families.",403);
            var rows=await Q(c,"""
                SELECT ch.id,ch.student_id AS "studentId",s.first_name || ' ' || s.last_name AS student,ch.description,ch.due_date AS "dueDate",
                ch.gross/100.0 AS gross,ch.concession/100.0 AS concession,COALESCE(sum(p.amount),0)/100.0 AS paid,
                (ch.gross-ch.concession-COALESCE(sum(p.amount),0))/100.0 AS balance,ch.currency
                FROM suite.charges ch JOIN student_db.students s ON s.id=ch.student_id
                LEFT JOIN suite.payments p ON p.charge_id=ch.id AND p.school_id=ch.school_id
                WHERE ch.school_id=@s GROUP BY ch.id,s.first_name,s.last_name ORDER BY ch.due_date,ch.created_at
                """,("s",a.School));
            return Results.Ok(new{data=rows.Where(r=>a.Admin||a.Students.Contains(Text(r,"studentId")))});
        });
        group.MapPost("/fees/charges",async(JsonObject d,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Only administrators may issue charges.",403);
            var student=Id(d,"studentId");await Reference(c,a,"students",student.ToString());
            await using var tx=await c.BeginTransactionAsync();await E(c,"SELECT pg_advisory_xact_lock(hashtextextended(@s,0))",("s",a.School.ToString()));
            var structure=await Get(c,a.School,"fee-structures",Id(d,"structureId"));await InClass(c,a.School,student,Id(structure,"classId"));
            var gross=Cents(structure,"amount");var concession=Cents(d,"concession");Require(concession<=gross,"Concession cannot exceed the charge.");
            var config=(await Records(c,a.School,"school-config")).FirstOrDefault();var currency=config is null?"INR":Text(config,"currency");
            var id=Guid.NewGuid();
            await E(c,"INSERT INTO suite.charges(id,school_id,student_id,structure_id,description,due_date,gross,concession,currency,created_by) VALUES(@id,@s,@student,@structure,@desc,@due,@gross,@concession,@currency,@user)",
                ("id",id),("s",a.School),("student",student),("structure",Id(d,"structureId")),("desc",Text(structure,"name")+" · "+Text(structure,"installment")),("due",Day(structure,"dueDate")),("gross",gross),("concession",concession),("currency",currency),("user",a.User));
            await tx.CommitAsync();return Results.Json(new{data=new{id}},statusCode:201);
        });
        group.MapPost("/fees/payments",async(JsonObject d,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Only administrators may record payments.",403);
            var idempotency=Id(d,"idempotencyKey");var charge=Id(d,"chargeId");var amount=Cents(d,"amount");
            Require(amount>0,"Payment amount must be positive.");var method=Text(d,"method");var reference=Text(d,"reference");
            Require(new[]{"Cash","Bank transfer","UPI","Cheque"}.Contains(method),"Choose a valid payment method.");Require(reference.Length<=150&&(method=="Cash"||reference.Length>0),"A bank / UPI / cheque reference is required.");
            var paidOn=Day(d,"paidOn");Require(paidOn<=DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)),"Payment date cannot be in the future.");
            await using var tx=await c.BeginTransactionAsync();await E(c,"SELECT pg_advisory_xact_lock(hashtextextended(@s,0))",("s",a.School.ToString()));
            var previous=await Q(c,"SELECT id,receipt,charge_id,amount,method,reference,paid_on::text FROM suite.payments WHERE school_id=@s AND idempotency_key=@key",("s",a.School),("key",idempotency));
            if(previous.Count>0){var p=previous[0];Require(Text(p,"charge_id")==charge.ToString()&&Number(p,"amount")==amount&&Text(p,"method")==method&&Text(p,"reference")==reference&&Text(p,"paid_on")==paidOn.ToString("yyyy-MM-dd"),"This payment request identifier was already used for different details.",409);await tx.CommitAsync();return Results.Ok(new{data=new{id=Text(p,"id"),receipt=Text(p,"receipt")}});}
            var charges=await Q(c,"SELECT gross-concession AS net,(SELECT COALESCE(sum(amount),0) FROM suite.payments WHERE charge_id=@id AND school_id=@s) AS paid FROM suite.charges WHERE id=@id AND school_id=@s FOR UPDATE",("id",charge),("s",a.School));
            Require(charges.Count==1,"Charge not found.",404);Require(amount<=Number(charges[0],"net")-Number(charges[0],"paid"),"Payment exceeds the outstanding balance.",409);
            var id=Guid.NewGuid();var receipt=await NextNumber(c,a.School,"receipt","RCPT");
            await E(c,"INSERT INTO suite.payments(id,school_id,charge_id,amount,method,reference,paid_on,receipt,idempotency_key,created_by) VALUES(@id,@s,@charge,@amount,@method,@ref,@date,@receipt,@key,@user)",
                ("id",id),("s",a.School),("charge",charge),("amount",amount),("method",method),("ref",reference),("date",paidOn),("receipt",receipt),("key",idempotency),("user",a.User));
            await tx.CommitAsync();return Results.Json(new{data=new{id,receipt}},statusCode:201);
        });
        group.MapGet("/fees/payments",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin||a.Role is "Parent" or "Student","Fee access denied.",403);
            var rows=await Q(c,"SELECT p.id,p.receipt,p.amount/100.0 AS amount,p.method,p.reference,p.paid_on AS \"paidOn\",ch.student_id AS \"studentId\",s.first_name || ' ' || s.last_name AS student,ch.currency FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id JOIN student_db.students s ON s.id=ch.student_id WHERE p.school_id=@s ORDER BY p.created_at DESC",("s",a.School));
            return Results.Ok(new{data=rows.Where(r=>a.Admin||a.Students.Contains(Text(r,"studentId")))});
        });
        group.MapGet("/fees/receipts/{id:guid}",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin||a.Role is "Parent" or "Student","Fee access denied.",403);
            var rows=await Q(c,"SELECT p.receipt,p.amount/100.0 AS amount,p.method,p.reference,p.paid_on AS \"paidOn\",ch.student_id AS \"studentId\",s.first_name || ' ' || s.last_name AS student,s.roll_number AS \"admissionNumber\",ch.description,ch.currency FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id JOIN student_db.students s ON s.id=ch.student_id WHERE p.id=@id AND p.school_id=@s",("id",id),("s",a.School));
            Require(rows.Count==1&&(a.Admin||a.Students.Contains(Text(rows[0],"studentId"))),"Receipt not found.",404);
            return Results.Ok(new{data=new{receipt=rows[0],school=await SchoolPrint(c,a.School)}});
        });
        group.MapPost("/fees/{id:guid}/remind",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Admin,"Only administrators can send reminders.",403);
            var rows=await Q(c,"SELECT ch.student_id,ch.description,ch.currency,(ch.gross-ch.concession-COALESCE((SELECT sum(amount) FROM suite.payments WHERE charge_id=ch.id),0))/100.0 AS balance FROM suite.charges ch WHERE ch.id=@id AND ch.school_id=@s",("id",id),("s",a.School));
            Require(rows.Count==1,"Charge not found.",404);var charge=rows[0];Require(Number(charge,"balance")>0,"This charge has no outstanding balance.",409);
            var count=await NotifyStudent(c,a,Guid.Parse(Text(charge,"student_id")),"Fee reminder",Text(charge,"description")+": outstanding "+Text(charge,"currency")+" "+Text(charge,"balance")+". Please contact the school accounts office.","fee:"+id+":"+DateTime.UtcNow.ToString("yyyy-MM-dd"));
            return Results.Ok(new{data=new{sent=count},message=count>0?count+" in-app reminders made available.":"No new reminders: link a parent/student account, or a reminder was already issued today."});
        });
    }
    static async Task<JsonObject> SchoolPrint(NpgsqlConnection c,Guid school){
        var profile=(await Q(c,"SELECT name,principal_name AS principal FROM school_db.schools WHERE id=@s",("s",school))).First();
        var config=(await Records(c,school,"school-config")).FirstOrDefault();
        if(config is not null)foreach(var item in config)if(item.Key is not "id" and not "version" and not "createdAt")profile[item.Key]=item.Value?.DeepClone();
        return profile;
    }
}

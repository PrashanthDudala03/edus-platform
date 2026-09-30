using System.Text.Json.Nodes;
using Npgsql;
public static partial class Suite
{
    static string DocumentRoot => Environment.GetEnvironmentVariable("EDUOS_DOCUMENTS_PATH")??Path.Combine(AppContext.BaseDirectory,"documents");
    static async Task<(string,JsonObject)> DocumentRecord(NpgsqlConnection c,SchoolAccess a,Guid recordId,bool write){
        var rows=await Q(c,"SELECT kind FROM suite.records WHERE id=@id AND school_id=@s AND archived_at IS NULL",("id",recordId),("s",a.School));
        Require(rows.Count==1,"Document record not found.",404);var kind=Text(rows[0],"kind");var d=await Get(c,a.School,kind,recordId);
        Require(Readable(kind,d,a),"Document access denied.",403);
        if(write){Require(new[]{"admissions","homework","submissions","circulars","school-config"}.Contains(kind),"Attachments are not supported for this record.");Writable(kind,d,a,d);if(kind=="submissions"&&!a.SchoolWide&&a.Role!="Teacher"){var homework=await Get(c,a.School,"homework",Id(d,"homeworkId"));Require(Day(homework,"dueDate")>=DateOnly.FromDateTime(DateTime.UtcNow),"This assignment is past its submission deadline.",409);}}
        return(kind,d);
    }
    static void MapDocuments(RouteGroupBuilder group){
        group.MapGet("/documents",async(Guid recordId,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);await DocumentRecord(c,a,recordId,false);
            return Results.Ok(new{data=await Q(c,"SELECT id,file_name AS name,content_type AS type,length,created_at AS \"uploadedAt\" FROM suite.documents WHERE school_id=@s AND record_id=@r ORDER BY created_at",("s",a.School),("r",recordId))});
        });
        group.MapPost("/documents",async(Guid recordId,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);await DocumentRecord(c,a,recordId,true);
            Require(http.Request.HasFormContentType,"Upload a multipart file.");
            var form=await http.Request.ReadFormAsync();Require(form.Files.Count==1,"Upload one document at a time.");
            var file=form.Files[0];Require(file.Length>0&&file.Length<=8*1024*1024,"Documents must be between 1 byte and 8 MB.");
            var existing=await Q(c,"SELECT count(*) AS n FROM suite.documents WHERE record_id=@r AND school_id=@s",("r",recordId),("s",a.School));Require(Number(existing[0],"n")<20,"This record already has 20 attachments.",409);
            await using var buffer=new MemoryStream();await file.CopyToAsync(buffer);var bytes=buffer.ToArray();
            var mime=bytes.Length>=5&&System.Text.Encoding.ASCII.GetString(bytes,0,5)=="%PDF-"?"application/pdf":
                bytes.Length>=8&&bytes.Take(8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10})?"image/png":
                bytes.Length>=3&&bytes[0]==255&&bytes[1]==216&&bytes[2]==255?"image/jpeg":null;
            Require(mime is not null,"Only valid PDF, PNG, or JPEG documents are accepted.");
            var name=Path.GetFileName(file.FileName).Replace("\r","").Replace("\n","");Require(name.Length is >0 and <=150,"File name must be at most 150 characters.");
            var extension=Path.GetExtension(name).ToLowerInvariant();Require(mime=="application/pdf"?extension==".pdf":mime=="image/png"?extension==".png":extension is ".jpg" or ".jpeg","The file extension must match its document type.");
            var id=Guid.NewGuid();Directory.CreateDirectory(DocumentRoot);var target=Path.Combine(DocumentRoot,id.ToString("N")+".bin");
            await File.WriteAllBytesAsync(target,bytes);
            try{await E(c,"INSERT INTO suite.documents(id,school_id,record_id,file_name,content_type,length,uploaded_by) VALUES(@id,@s,@r,@name,@type,@length,@user)",("id",id),("s",a.School),("r",recordId),("name",name),("type",mime),("length",file.Length),("user",a.User));}
            catch{File.Delete(target);throw;}
            return Results.Json(new{data=new{id,name}},statusCode:201);
        });
        group.MapGet("/documents/{id:guid}",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);
            var rows=await Q(c,"SELECT record_id,file_name,content_type FROM suite.documents WHERE id=@id AND school_id=@s",("id",id),("s",a.School));Require(rows.Count==1,"Document not found.",404);
            await DocumentRecord(c,a,Guid.Parse(Text(rows[0],"record_id")),false);var file=Path.Combine(DocumentRoot,id.ToString("N")+".bin");
            Require(File.Exists(file),"The stored file is missing. Contact the administrator to restore the document backup.",404);
            http.Response.Headers["X-Content-Type-Options"]="nosniff";return Results.File(file,Text(rows[0],"content_type"),Text(rows[0],"file_name"),enableRangeProcessing:true);
        });
    }
}

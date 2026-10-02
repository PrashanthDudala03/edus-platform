using System.Globalization;
using System.Text.Json.Nodes;
using EduOS.ServiceAuth;
using Npgsql;
// School Home: the school's own welcome page, shown after sign-in. One suite record per school (kind "school-home")
// holds the draft and the published copy; its images are suite documents attached to that record. The kind has no
// entry in SuiteSchemas.json, so the generic record and document endpoints never read or write it.
public static partial class Suite
{
    const string HomeKind="school-home",HomeManage="school-home.manage";
    static readonly string[] HomeSections=["hero","identity","principal","results","statistics","faculty","achievements","events","announcements","gallery"];
    static readonly string[] HomePositions=["center","top","bottom","left","right"];
    static readonly string[] HomeCategories=["Academic","Sports","Cultural","Other"];
    static readonly string[] HomeSources=["students","teachers","custom"];
    sealed record HomeRow(Guid Id,int Version,JsonObject Data);

    static string Clip(JsonNode? n,int max,string label){
        Require(n is null or JsonValue,label+" must be a single value.");var v=n?.ToString().Trim()??"";
        Require(v.Length<=max,label+" must be at most "+max+" characters.");return v;
    }
    static JsonObject Part(JsonNode? n,string label){Require(n is null or JsonObject,label+" is invalid.");return n as JsonObject??new JsonObject();}
    static List<JsonObject> Entries(JsonNode? n,int max,string label){
        Require(n is null or JsonArray,label+" must be a list.");var list=(n as JsonArray??new JsonArray()).ToList();
        Require(list.Count<=max,label+" allows at most "+max+" entries.");Require(list.All(x=>x is JsonObject),label+" has an invalid entry.");
        return list.Select(x=>x!.AsObject()).ToList();
    }
    static JsonArray List(IEnumerable<JsonObject> items)=>new(items.Select(x=>(JsonNode?)x).ToArray());
    static bool Flag(JsonNode? n)=>!(n is JsonValue v&&v.TryGetValue<bool>(out var on)&&!on);
    static string Figure(JsonNode? n,decimal max,bool whole,string label){
        var v=Clip(n,20,label);if(v=="")return v;
        Require(decimal.TryParse(v,NumberStyles.Number,CultureInfo.InvariantCulture,out var d)&&d>=0&&d<=max&&(!whole||decimal.Truncate(d)==d),label+" must be a "+(whole?"whole ":"")+"number between 0 and "+max.ToString(CultureInfo.InvariantCulture)+".");
        return d.ToString(CultureInfo.InvariantCulture);
    }
    static int Shown(JsonNode? n)=>int.TryParse(Clip(n,5,"Number shown"),out var i)&&i is >=1 and <=10?i:5;

    // Rebuilds the draft from known fields only, so nothing a browser adds is stored or later shown to the school.
    static JsonObject HomeClean(JsonObject input,HashSet<string> images,HashSet<string> teachers){
        string Image(JsonNode? n,string label){var v=Clip(n,40,label);Require(v==""||images.Contains(v),label+" is not a School Home image. Upload it again.");return v;}
        string Position(JsonNode? n){var v=Clip(n,10,"Image position");return HomePositions.Contains(v)?v:"center";}
        var order=new List<string>();var hidden=new HashSet<string>();
        foreach(var s in Entries(input["sections"],HomeSections.Length,"Sections")){
            var key=Clip(s["key"],20,"Section");Require(HomeSections.Contains(key)&&!order.Contains(key),"Each section must be listed once.");
            order.Add(key);if(!Flag(s["visible"]))hidden.Add(key);
        }
        foreach(var key in HomeSections)if(!order.Contains(key)){order.Add(key);if(input["sections"] is not null)hidden.Add(key);}
        var hero=Part(input["hero"],"Hero");var identity=Part(input["identity"],"Motto, vision and mission");var principal=Part(input["principal"],"Principal message");var results=Part(input["results"],"Results");
        // The school's two brand colours. Blank means the EduOS palette; readable shades are derived when the page is drawn.
        string Colour(JsonNode? n,string label){var v=Clip(n,7,label).ToLowerInvariant();Require(v==""||(v.Length==7&&v[0]=='#'&&v.Skip(1).All(Uri.IsHexDigit)),label+" must be a colour such as #1a5fb4.");return v;}
        var brand=Part(input["brand"],"School colours");
        return new JsonObject{
            ["sections"]=List(order.Select(k=>new JsonObject{["key"]=k,["visible"]=!hidden.Contains(k)})),
            ["brand"]=new JsonObject{["primary"]=Colour(brand["primary"],"Primary colour"),["accent"]=Colour(brand["accent"],"Accent colour")},
            ["hero"]=new JsonObject{["tagline"]=Clip(hero["tagline"],160,"Tagline"),["bannerId"]=Image(hero["bannerId"],"Banner image"),["bannerPosition"]=Position(hero["bannerPosition"]),["logoId"]=Image(hero["logoId"],"Logo")},
            ["identity"]=new JsonObject{["motto"]=Clip(identity["motto"],200,"Motto"),["vision"]=Clip(identity["vision"],1000,"Vision"),["mission"]=Clip(identity["mission"],1000,"Mission")},
            ["principal"]=new JsonObject{["name"]=Clip(principal["name"],120,"Principal name"),["designation"]=Clip(principal["designation"],120,"Principal designation"),["message"]=Clip(principal["message"],2000,"Principal message"),["photoId"]=Image(principal["photoId"],"Principal photo"),["photoPosition"]=Position(principal["photoPosition"])},
            // Results and toppers are typed by the school; nothing here is read from student records.
            ["results"]=new JsonObject{["academicYear"]=Clip(results["academicYear"],20,"Academic year"),["passPercentage"]=Figure(results["passPercentage"],100,false,"Pass percentage"),["distinctions"]=Figure(results["distinctions"],100000,true,"Distinctions"),
                ["toppers"]=List(Entries(results["toppers"],10,"Ranks").Select(t=>{var name=Clip(t["name"],120,"Rank holder name");Require(name!="","Each rank needs a name.");return new JsonObject{["rank"]=Clip(t["rank"],30,"Rank"),["name"]=name,["detail"]=Clip(t["detail"],120,"Rank detail")};}))},
            ["statistics"]=new JsonObject{["items"]=List(Entries(Part(input["statistics"],"Statistics")["items"],8,"Statistics").Select(s=>{
                var label=Clip(s["label"],40,"Statistic label");var source=Clip(s["source"],10,"Statistic source");var value=source=="custom"?Clip(s["value"],20,"Statistic value"):"";
                Require(label!=""&&HomeSources.Contains(source)&&(source!="custom"||value!=""),"Each statistic needs a label and either a live count or a value.");
                return new JsonObject{["label"]=label,["source"]=source,["value"]=value};}))},
            // A featured person is a reference to a teacher of this school; the name always comes from the teacher record.
            ["faculty"]=new JsonObject{["items"]=List(Entries(Part(input["faculty"],"Featured faculty")["items"],24,"Featured faculty").Where(f=>{var id=Clip(f["teacherId"],40,"Teacher");Require(id!="","Choose a teacher for each featured faculty entry.");return teachers.Contains(id);})
                .Select(f=>new JsonObject{["teacherId"]=Clip(f["teacherId"],40,"Teacher"),["designation"]=Clip(f["designation"],120,"Faculty designation"),["description"]=Clip(f["description"],400,"Faculty description"),["photoId"]=Image(f["photoId"],"Faculty photo"),["photoPosition"]=Position(f["photoPosition"]),["visible"]=Flag(f["visible"])}))},
            ["achievements"]=new JsonObject{["items"]=List(Entries(Part(input["achievements"],"Achievements")["items"],24,"Achievements").Select(x=>{
                var title=Clip(x["title"],120,"Achievement title");var category=Clip(x["category"],20,"Achievement category");Require(title!=""&&HomeCategories.Contains(category),"Each achievement needs a title and a category.");
                return new JsonObject{["title"]=title,["description"]=Clip(x["description"],600,"Achievement description"),["category"]=category,["imageId"]=Image(x["imageId"],"Achievement image")};}))},
            ["events"]=new JsonObject{["count"]=Shown(Part(input["events"],"Upcoming events")["count"])},
            ["announcements"]=new JsonObject{["count"]=Shown(Part(input["announcements"],"Announcements")["count"])},
            ["gallery"]=new JsonObject{["items"]=List(Entries(Part(input["gallery"],"Gallery")["items"],30,"Gallery").Select(g=>{
                var image=Image(g["imageId"],"Gallery image");Require(image!="","Each gallery entry needs an image.");return new JsonObject{["imageId"]=image,["caption"]=Clip(g["caption"],120,"Gallery caption")};}))},
        };
    }
    static HashSet<string> HomeImages(JsonObject? config){
        var ids=new HashSet<string>();if(config is null)return ids;
        void Add(JsonNode? n){var v=n?.ToString()??"";if(v!="")ids.Add(v);}
        Add(config["hero"]?["bannerId"]);Add(config["hero"]?["logoId"]);Add(config["principal"]?["photoId"]);
        foreach(var(section,key)in new[]{("faculty","photoId"),("achievements","imageId"),("gallery","imageId")})
            foreach(var item in config[section]?["items"] as JsonArray??new JsonArray())Add(item?[key]);
        return ids;
    }
    static async Task<HomeRow?> HomeLoad(NpgsqlConnection c,Guid school){
        var rows=await Q(c,"SELECT id,data::text,version FROM suite.records WHERE school_id=@s AND kind=@k AND archived_at IS NULL ORDER BY created_at,id LIMIT 1",("s",school),("k",HomeKind));
        return rows.Count==0?null:new HomeRow(Guid.Parse(Text(rows[0],"id")),(int)Number(rows[0],"version"),JsonNode.Parse(Text(rows[0],"data"))!.AsObject());
    }
    // Call inside a transaction: the school lock keeps the record single per school.
    static async Task<HomeRow> HomeEnsure(NpgsqlConnection c,SchoolAccess a){
        await E(c,"SELECT pg_advisory_xact_lock(hashtextextended(@s,0))",("s",a.School.ToString()));
        if(await HomeLoad(c,a.School) is HomeRow found)return found;
        var data=new JsonObject{["draft"]=HomeClean(new JsonObject(),[],[]),["published"]=null,["publishedAt"]=null};var id=Guid.NewGuid();
        await E(c,"INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES(@id,@s,@k,@d::jsonb,@u,@u)",("id",id),("s",a.School),("k",HomeKind),("d",data.ToJsonString()),("u",a.User));
        return new HomeRow(id,1,data);
    }
    // Scope comes from the verified access token only. Profile links are not needed to read the page or to edit it.
    static SchoolAccess HomeCaller(HttpContext http,bool manage=false){
        var tenant=http.TryGetTenant();Require(tenant is not null&&http.User.FindFirst("data_scope")?.Value is "school" or "teacher" or "parent" or "student","School scope is missing.",403);
        var a=new SchoolAccess{School=tenant!.SchoolId,User=tenant.UserId,Permissions=http.User.FindAll("permission").Select(p=>p.Value).ToHashSet()};
        Require(!manage||a.Can(HomeManage),"Your role cannot manage School Home.",403);return a;
    }
    static bool HomePending(JsonObject data)=>data["published"] is not JsonObject||!JsonNode.DeepEquals(data["draft"],data["published"]);

    // Turns a stored configuration into what a reader sees: visible sections in order, with live school data resolved for this caller.
    static async Task<JsonObject> HomeView(NpgsqlConnection c,SchoolAccess a,JsonObject config){
        var school=(await Q(c,"SELECT name,principal_name AS \"principalName\" FROM school_db.schools WHERE id=@s",("s",a.School))).First();
        var sections=new JsonArray();
        foreach(var s in config["sections"]!.AsArray()){
            if(!Flag(s!["visible"]))continue;
            var key=Text(s.AsObject(),"key");var part=(config[key] as JsonObject??new JsonObject()).DeepClone().AsObject();
            var items=(part["items"] as JsonArray??new JsonArray()).Select(x=>x!.AsObject()).ToList();
            JsonObject? content=null;
            // The motto belongs to the school's identity on the banner, whether or not the vision and mission section is shown.
            if(key=="hero"){part["motto"]=Text(config["identity"] as JsonObject??new JsonObject(),"motto");content=part;}
            else if(key=="identity"){if(new[]{"motto","vision","mission"}.Any(k=>Text(part,k)!=""))content=part;}
            else if(key=="principal"){
                if(Text(part,"name")=="")part["name"]=Text(school,"principalName");
                if(Text(part,"message")!=""||Text(part,"photoId")!="")content=part;
            }
            else if(key=="results"){if(new[]{"academicYear","passPercentage","distinctions"}.Any(k=>Text(part,k)!="")||part["toppers"]!.AsArray().Count>0)content=part;}
            else if(key=="statistics"&&items.Count>0){
                // Live figures are whole-school counts only; no individual record is exposed.
                var counts=(await Q(c,"SELECT (SELECT count(*) FROM student_db.students WHERE school_id=@s AND deleted_at IS NULL) AS students,(SELECT count(*) FROM teacher_db.teachers WHERE school_id=@s AND deleted_at IS NULL) AS teachers",("s",a.School))).First();
                content=new JsonObject{["items"]=List(items.Select(i=>new JsonObject{["label"]=Text(i,"label"),["value"]=Text(i,"source")=="custom"?Text(i,"value"):Text(counts,Text(i,"source"))}))};
            }
            else if(key=="faculty"&&items.Count>0){
                var teachers=(await Q(c,"SELECT id::text AS id,first_name || ' ' || last_name AS name,department FROM teacher_db.teachers WHERE school_id=@s AND deleted_at IS NULL",("s",a.School))).ToDictionary(t=>Text(t,"id"));
                var shown=items.Where(i=>Flag(i["visible"])&&teachers.ContainsKey(Text(i,"teacherId"))).Select(i=>{var t=teachers[Text(i,"teacherId")];
                    return new JsonObject{["name"]=Text(t,"name"),["department"]=Text(t,"department"),["designation"]=Text(i,"designation"),["description"]=Text(i,"description"),["photoId"]=Text(i,"photoId"),["photoPosition"]=Text(i,"photoPosition")};}).ToList();
                if(shown.Count>0)content=new JsonObject{["items"]=List(shown)};
            }
            else if(key is "achievements" or "gallery"){if(items.Count>0)content=part;}
            else if(key=="events"&&a.Can("calendar.view")){
                var today=DateOnly.FromDateTime(DateTime.UtcNow);
                var upcoming=(await Records(c,a.School,"calendar")).Where(e=>DateOnly.TryParse(Text(e,"endsOn"),out var end)&&end>=today).OrderBy(e=>Text(e,"startsOn")).Take(Shown(part["count"]));
                content=new JsonObject{["items"]=List(upcoming.Select(e=>new JsonObject{["title"]=Text(e,"title"),["startsOn"]=Text(e,"startsOn"),["endsOn"]=Text(e,"endsOn"),["description"]=Text(e,"description")}))};
            }
            else if(key=="announcements"&&a.Can("circulars.view")){
                // The same audience and class rules as the circulars module decide what this caller may read.
                var notices=(await Records(c,a.School,"circulars")).Where(n=>Readable("circulars",n,a)).Take(Shown(part["count"]));
                content=new JsonObject{["items"]=List(notices.Select(n=>new JsonObject{["title"]=Text(n,"title"),["message"]=Text(n,"message"),["createdAt"]=n["createdAt"]?.DeepClone()}))};
            }
            if(content is not null)sections.Add(new JsonObject{["key"]=key,["content"]=content});
        }
        return new JsonObject{["schoolName"]=Text(school,"name"),["brand"]=config["brand"]?.DeepClone(),["sections"]=sections};
    }

    static void MapHome(RouteGroupBuilder group){
        group.MapGet("/home",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);var home=await HomeLoad(c,a.School);
            return Results.Ok(new{data=new{home=home?.Data["published"] is JsonObject published?await HomeView(c,a,published):null,canManage=a.Can(HomeManage)}});
        });
        group.MapGet("/home/manage",async(HttpContext http)=>{
            await using var c=await Open();var a=HomeCaller(http,true);
            await using var tx=await c.BeginTransactionAsync();var home=await HomeEnsure(c,a);await tx.CommitAsync();
            var teachers=a.Can("teachers.view")?await Q(c,"SELECT id::text AS id,first_name || ' ' || last_name AS label FROM teacher_db.teachers WHERE school_id=@s AND deleted_at IS NULL ORDER BY first_name,last_name",("s",a.School)):new List<JsonObject>();
            return Results.Ok(new{data=new{draft=home.Data["draft"],version=home.Version,published=home.Data["published"] is JsonObject,publishedAt=home.Data["publishedAt"]?.ToString(),pending=HomePending(home.Data),teachers}});
        });
        group.MapGet("/home/preview",async(HttpContext http)=>{
            await using var c=await Open();var a=await Access(http,c);Require(a.Can(HomeManage),"Your role cannot manage School Home.",403);
            var home=await HomeLoad(c,a.School);Require(home is not null,"Save School Home before previewing it.",404);
            return Results.Ok(new{data=await HomeView(c,a,home!.Data["draft"]!.AsObject())});
        });
        group.MapPut("/home",async(JsonObject input,HttpContext http)=>{
            await using var c=await Open();var a=HomeCaller(http,true);
            var action=Clip(input["action"],10,"Action");Require(action is "save" or "publish" or "unpublish","Unknown action.");Require(input["draft"] is JsonObject,"Draft is required.");
            await using var tx=await c.BeginTransactionAsync();var home=await HomeEnsure(c,a);
            Require(Clip(input["version"],12,"Version")==home.Version.ToString(),"School Home changed since you opened it. Refresh before saving.",409);
            var stored=(await Q(c,"SELECT id::text AS id FROM suite.documents WHERE school_id=@s AND record_id=@r",("s",a.School),("r",home.Id))).Select(r=>Text(r,"id")).ToHashSet();
            var teachers=(await Q(c,"SELECT id::text AS id FROM teacher_db.teachers WHERE school_id=@s AND deleted_at IS NULL",("s",a.School))).Select(r=>Text(r,"id")).ToHashSet();
            var data=home.Data;data["draft"]=HomeClean(input["draft"]!.AsObject(),stored,teachers);
            if(action=="publish"){data["published"]=data["draft"]!.DeepClone();data["publishedAt"]=DateTime.UtcNow.ToString("O");}
            if(action=="unpublish"){data["published"]=null;data["publishedAt"]=null;}
            await E(c,"UPDATE suite.records SET data=@d::jsonb,version=version+1,updated_at=now(),updated_by=@u WHERE id=@id AND school_id=@s",("d",data.ToJsonString()),("u",a.User),("id",home.Id),("s",a.School));
            // Images used by neither the draft nor the published page are removed with this change.
            var keep=HomeImages(data["draft"] as JsonObject);keep.UnionWith(HomeImages(data["published"] as JsonObject));
            var unused=stored.Where(id=>!keep.Contains(id)).Select(Guid.Parse).ToArray();
            if(unused.Length>0)await E(c,"DELETE FROM suite.documents WHERE school_id=@s AND record_id=@r AND id=ANY(@ids)",("s",a.School),("r",home.Id),("ids",unused));
            await tx.CommitAsync();
            foreach(var id in unused)try{File.Delete(Path.Combine(DocumentRoot,id.ToString("N")+".bin"));}catch(IOException){}
            return Results.Ok(new{data=new{draft=data["draft"],version=home.Version+1,published=data["published"] is JsonObject,publishedAt=data["publishedAt"]?.ToString(),pending=HomePending(data)}});
        });
        group.MapPost("/home/images",async(HttpContext http)=>{
            await using var c=await Open();var a=HomeCaller(http,true);
            Require(http.Request.HasFormContentType,"Upload a multipart file.");
            var form=await http.Request.ReadFormAsync();Require(form.Files.Count==1,"Upload one image at a time.");
            var file=form.Files[0];Require(file.Length>0&&file.Length<=5*1024*1024,"Images must be between 1 byte and 5 MB.");
            await using var buffer=new MemoryStream();await file.CopyToAsync(buffer);
            await using var tx=await c.BeginTransactionAsync();var home=await HomeEnsure(c,a);
            var existing=await Q(c,"SELECT count(*) AS n FROM suite.documents WHERE record_id=@r AND school_id=@s",("r",home.Id),("s",a.School));Require(Number(existing[0],"n")<200,"School Home already holds 200 images. Save the page to clear unused images.",409);
            var(id,_)=await StoreDocument(c,a,home.Id,file,buffer.ToArray(),true);
            try{await tx.CommitAsync();}catch{File.Delete(Path.Combine(DocumentRoot,id.ToString("N")+".bin"));throw;}
            return Results.Json(new{data=new{id}},statusCode:201);
        });
        // Readers receive only images the published page uses; an editor also sees images of the draft.
        group.MapGet("/home/images/{id:guid}",async(Guid id,HttpContext http)=>{
            await using var c=await Open();var a=HomeCaller(http);var home=await HomeLoad(c,a.School);
            Require(home is not null&&(a.Can(HomeManage)||HomeImages(home.Data["published"] as JsonObject).Contains(id.ToString())),"Image not found.",404);
            var rows=await Q(c,"SELECT content_type FROM suite.documents WHERE id=@id AND school_id=@s AND record_id=@r",("id",id),("s",a.School),("r",home!.Id));Require(rows.Count==1,"Image not found.",404);
            var file=Path.Combine(DocumentRoot,id.ToString("N")+".bin");Require(File.Exists(file),"Image not found.",404);
            http.Response.Headers["X-Content-Type-Options"]="nosniff";http.Response.Headers["Cache-Control"]="private, max-age=300";
            return Results.File(file,Text(rows[0],"content_type"));
        });
    }
}

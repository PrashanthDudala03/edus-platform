using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace EduOS.Ai.Tools;

public record LookupField(string Key,string Label,string? Source=null);
public record LookupSpec(string Name,string Title,string Kind,string Permission,LookupField[] Fields,string[] Aliases,bool Priority=false);

/// <summary>Fixed, permission-scoped GETs; no record text is sent to a model.</summary>
public sealed class RecordLookupTool(LookupSpec spec) : IAiTool
{
    public ToolDefinition Definition { get; }=new(spec.Name,"Read authorized "+spec.Title+" from school records, with a bounded first page.",spec.Permission,[],["title","total","lines","more","path"]);
    public IReadOnlyList<string> Paths {get;}=["/api/v1/suite/records/"+spec.Kind,"/api/v1/suite/options"];
    public async Task<JsonObject> Run(ToolCaller caller,ToolArguments arguments,IEduOsApi api,DateOnly today,CancellationToken cancellation)
    {
        var response=ToolJson.Property(await api.Get(Paths[0],new Dictionary<string,string>{{"page","1"}},caller,cancellation),"data",JsonValueKind.Object);
        var rows=ToolJson.Property(response,"data",JsonValueKind.Array);var total=ToolJson.Count(response,"totalCount");
        if(rows.GetArrayLength()>20)throw new ToolFailure(ToolResult.TooLarge);
        JsonElement? options=null;
        if(rows.GetArrayLength()>0&&spec.Fields.Any(f=>f.Source is not null))options=ToolJson.Property(await api.Get(Paths[1],null,caller,cancellation),"data",JsonValueKind.Object);
        var lines=new JsonArray();
        foreach(var row in rows.EnumerateArray())
        {
            var cells=new List<string>();
            foreach(var field in spec.Fields)
            {
                if(!row.TryGetProperty(field.Key,out var value)||value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)continue;
                var text=value.ValueKind==JsonValueKind.String?value.GetString()!:value.ToString();
                if(field.Source is not null)
                {
                    var found=false;
                    if(options is {} choices&&choices.TryGetProperty(field.Source,out var list)&&list.ValueKind==JsonValueKind.Array)
                        foreach(var option in list.EnumerateArray())if(ToolJson.Text(option,"id")==text){text=ToolJson.Text(option,"label")??"Linked record";found=true;break;}
                    if(!found)text="Linked record (name unavailable)";
                }
                if(text.Length>0)cells.Add(field.Label+": "+ToolJson.Label(text,140));
            }
            lines.Add(string.Join(" · ",cells));
        }
        return new JsonObject{["title"]=spec.Title,["total"]=total,["lines"]=lines,["more"]=total>lines.Count,["path"]="/suite/"+spec.Kind};
    }
}

public sealed class StaffDirectoryTool : IAiTool
{
    public ToolDefinition Definition {get;}=new("staff_directory","Read the authorized staff directory: names, employee codes, departments and status. Private contacts are excluded.","teachers.view",[],["title","total","lines","more","path"]);
    public IReadOnlyList<string> Paths {get;}=["/api/v1/teachers"];
    public async Task<JsonObject> Run(ToolCaller caller,ToolArguments arguments,IEduOsApi api,DateOnly today,CancellationToken cancellation)
    {
        var data=ToolJson.Property(await api.Get(Paths[0],new Dictionary<string,string>{{"page","1"},{"pageSize","20"}},caller,cancellation),"data",JsonValueKind.Object);
        var rows=ToolJson.Property(data,"data",JsonValueKind.Array);if(rows.GetArrayLength()>20)throw new ToolFailure(ToolResult.TooLarge);
        var lines=new JsonArray();foreach(var row in rows.EnumerateArray())lines.Add(Format(row));
        var total=ToolJson.Count(data,"totalCount");return new JsonObject{["title"]="Staff directory",["total"]=total,["lines"]=lines,["more"]=total>lines.Count,["path"]="/teachers"};
    }
    static string Format(JsonElement row)=>ToolJson.Label((ToolJson.Text(row,"firstName")??"")+" "+ToolJson.Text(row,"lastName"))+" · Code: "+ToolJson.Label(ToolJson.Text(row,"employeeCode"))+" · Department: "+ToolJson.Label(ToolJson.Text(row,"department"))+" · Status: "+ToolJson.Label(ToolJson.Text(row,"status"));
}

public sealed class StaffLeaveBalancesTool : IAiTool
{
    public ToolDefinition Definition {get;}=new("staff_leave_balances","Read staff leave balances from the authorized leave service. Teachers see their own linked profile only.","leave-requests.view",[],["title","total","lines","more","path"]);
    public IReadOnlyList<string> Paths {get;}=["/api/v1/teachers","/api/v1/suite/leave/balances"];
    public async Task<JsonObject> Run(ToolCaller caller,ToolArguments arguments,IEduOsApi api,DateOnly today,CancellationToken cancellation)
    {
        var lines=new JsonArray();var total=1;var shown=1;
        if(caller.Permissions.Contains("teachers.view"))
        {
            var data=ToolJson.Property(await api.Get(Paths[0],new Dictionary<string,string>{{"page","1"},{"pageSize","10"}},caller,cancellation),"data",JsonValueKind.Object);
            var staff=ToolJson.Property(data,"data",JsonValueKind.Array);if(staff.GetArrayLength()>10)throw new ToolFailure(ToolResult.TooLarge);
            total=ToolJson.Count(data,"totalCount");shown=staff.GetArrayLength();
            foreach(var teacher in staff.EnumerateArray())
            {
                if(!Guid.TryParse(ToolJson.Text(teacher,"id"),out var id))throw new ToolFailure(ToolResult.Unavailable);
                Add(ToolJson.Property(await api.Get(Paths[1],new Dictionary<string,string>{{"teacherId",id.ToString()}},caller,cancellation),"data",JsonValueKind.Object),lines);
            }
        }
        else Add(ToolJson.Property(await api.Get(Paths[1],null,caller,cancellation),"data",JsonValueKind.Object),lines);
        return new JsonObject{["title"]="Staff leave balances",["total"]=total,["lines"]=lines,["more"]=total>shown,["path"]="/suite/leave-requests"};
    }
    static void Add(JsonElement data,JsonArray lines)
    {
        var name=ToolJson.Label(ToolJson.Text(data,"teacherName"));var balances=ToolJson.Property(data,"balances",JsonValueKind.Array);
        if(balances.GetArrayLength()>50)throw new ToolFailure(ToolResult.TooLarge);
        if(balances.GetArrayLength()==0){lines.Add(name+": no configured leave balances.");return;}
        foreach(var balance in balances.EnumerateArray())
        {
            var parts=new List<string>();
            foreach(var key in new[]{"allowance","added","deducted","used","pending","remaining"})if(balance.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.Number)parts.Add(key+": "+value.ToString());
            lines.Add(name+" · "+ToolJson.Label(ToolJson.Text(balance,"typeName")??ToolJson.Text(balance,"name"))+" · "+string.Join(", ",parts));
        }
    }
}

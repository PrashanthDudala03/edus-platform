using System.Text.Json;
using System.Text.Json.Nodes;
using EduOS.Ai.Tools;
using EduOS.ServiceAuth;
using Xunit;

public class SchoolLookupTests
{
 sealed class Api(Dictionary<string,string> responses):IEduOsApi
 {
  public List<string> Calls=[];
  public Task<JsonElement> Get(string path,IReadOnlyDictionary<string,string>? query,ToolCaller caller,CancellationToken cancellation){Calls.Add(path);return Task.FromResult(JsonSerializer.Deserialize<JsonElement>(responses[path]));}
 }
 static ToolCaller Caller()=>new(new TenantContext(Guid.NewGuid(),Guid.NewGuid(),"Administrator"),"opaque-token",[]);
 static ToolArguments Args()=>new(new Dictionary<string,object>());
 [Fact] public async Task DirectoryExcludesContactsAndIdentifiers()
 {
  var api=new Api(new(){["/api/v1/teachers"]="""{"data":{"totalCount":25,"data":[{"firstName":"Ravi","lastName":"Kumar","employeeCode":"T1","department":"Science","status":"Active","email":"private@example.test","phoneNumber":"9999999999","schoolId":"private-id"}]}}"""});
  var result=await new StaffDirectoryTool().Run(Caller(),Args(),api,DateOnly.FromDateTime(DateTime.UtcNow),default);
  var text=SchoolLookupCatalogue.Format(result);Assert.Contains("Ravi Kumar",text);Assert.Contains("Science",text);Assert.Contains("first page",text);Assert.DoesNotContain("private",text);Assert.DoesNotContain("999999",text);
 }
 [Fact] public async Task RecordsResolveReferencesAndOnlyExposeSelectedFields()
 {
  var spec=SchoolLookupCatalogue.All.Single(s=>s.Kind=="staff-attendance");
  var api=new Api(new(){["/api/v1/suite/records/staff-attendance"]="""{"data":{"totalCount":1,"data":[{"teacherId":"t1","day":"2026-10-09","status":"Present","notes":"PRIVATE MEDICAL NOTE","schoolId":"private"}]}}""",["/api/v1/suite/options"]="""{"data":{"teachers":[{"id":"t1","label":"Sunita Rao"}]}}"""});
  var result=await new RecordLookupTool(spec).Run(Caller(),Args(),api,DateOnly.FromDateTime(DateTime.UtcNow),default);
  var text=SchoolLookupCatalogue.Format(result);Assert.Contains("Sunita Rao",text);Assert.Contains("2026-10-09",text);Assert.DoesNotContain("PRIVATE",text);Assert.DoesNotContain("t1",text);Assert.Equal(2,api.Calls.Count);
 }
 [Fact] public async Task EmptyRecordsDoNotFetchOptionsOrInventData()
 {
  var spec=SchoolLookupCatalogue.All.Single(s=>s.Kind=="leave-adjustments");var api=new Api(new(){["/api/v1/suite/records/leave-adjustments"]="""{"data":{"totalCount":0,"data":[]}}"""});
  var text=SchoolLookupCatalogue.Format(await new RecordLookupTool(spec).Run(Caller(),Args(),api,DateOnly.FromDateTime(DateTime.UtcNow),default));Assert.Contains("no records are saved",text);Assert.Single(api.Calls);
 }
 [Fact] public async Task UnauthorizedDirectoryQuestionDoesNotReadDataOrInvokeAModel()
 {
  var downstream=new StubRuntime((_,_)=>throw new InvalidOperationException("Unauthorized API read"));
  await using var host=await AiHost.Start(true,new StubBootstrap(true),usage:new InMemoryUsageStore(),toolAudit:new InMemoryToolAudit(),eduos:downstream);
  var response=await host.Post("/api/ai/assistant/ask",host.Token("Parent","parent",permissions:["ai.assistant.use"]),"""{"question":"give me all the staff details"}""");
  var data=await AiGatewayTests.Data(response);Assert.Equal("assistant",data.GetProperty("kind").GetString());Assert.Contains("isn't available for your account",data.GetProperty("answer").GetString());Assert.Empty(downstream.Calls);
 }
}

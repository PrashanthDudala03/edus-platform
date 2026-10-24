using System.Text.Json;
using System.Text.RegularExpressions;
using EduOS.Ai.Providers;
using Xunit;
public class SelectorFlowTests
{
 [Fact] public async Task SemanticChoiceIsCachedButDataAndPermissionsAreRechecked()
 {
  var model=new RecordingModel((request,_)=>{
   Assert.InRange(request.MaxOutputTokens,1,32);
   var text=request.Messages[0].Content;
   Assert.DoesNotContain("Bearer",text);Assert.DoesNotContain("private-contact",text);
   var choice=Regex.Match(text,@"(?m)^staff_directory=");Assert.True(choice.Success);
   return Task.FromResult(new ModelResponse("recording","selector","{\"t\":\"staff_directory\",\"o\":\"count\"}",FinishReason.Completed,new TokenUsage(80,12,false)));
  });
  var count=11;var downstream=new StubRuntime((_,_)=>StubRuntime.Reply("{\"data\":{\"totalCount\":"+(++count)+",\"data\":[]}}"));
  var usage=new InMemoryUsageStore();
  await using var host=await AiHost.Start(true,new StubBootstrap(true),settings:new(){["Ai:Assistant:ToolSelectionEnabled"]="true"},model:new GuardedModelProvider(model,TimeSpan.FromSeconds(5)),usage:usage,eduos:downstream,toolAudit:new InMemoryToolAudit());
  var token=host.Token("Administrator","school",permissions:["ai.assistant.use","teachers.view"]);
  async Task<JsonElement> Ask(string bearer)=>await AiGatewayTests.Data(await host.Post("/api/ai/assistant/ask",bearer,"{\"question\":\"How big is our teaching team?\"}"));
  var first=await Ask(token);Assert.Equal("live",first.GetProperty("kind").GetString());Assert.Contains("12",first.GetProperty("answer").GetString());
  var second=await Ask(token);Assert.Contains("13",second.GetProperty("answer").GetString());Assert.Single(model.Requests);Assert.Equal(2,downstream.Calls.Count);
  var forbidden=await Ask(host.Token("Parent","parent",permissions:["ai.assistant.use"]));Assert.Equal("assistant",forbidden.GetProperty("kind").GetString());Assert.Single(model.Requests);Assert.Equal(2,downstream.Calls.Count);
  Assert.Single(usage.Records);Assert.Equal("assistant.route",usage.Records[0].Record.Feature);
 }
}

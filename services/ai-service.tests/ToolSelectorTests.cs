using EduOS.Ai.Gateway;
using EduOS.Ai.Tools;
using Xunit;
public class ToolSelectorTests
{
 static readonly ToolDefinition[] Tools=[new("staff_directory","List staff","teachers.view",[],["total","lines"]),new("fee_summary","Fee totals","fees.view",[],["currencies"])];
 [Theory]
 [InlineData("{\"t\":\"staff_directory\",\"o\":\"count\"}",true)]
 [InlineData("{\"t\":\"staff_directory\",\"o\":\"list\"}",true)]
 [InlineData("{\"t\":\"fee_summary\",\"o\":\"count\"}",false)]
 [InlineData("{\"t\":9,\"o\":\"list\"}",false)]
 [InlineData("{\"t\":-1,\"o\":\"list\"}",false)]
 [InlineData("{\"t\":\"staff_directory\",\"o\":\"delete\"}",false)]
 [InlineData("{\"t\":\"staff_directory\",\"o\":\"list\",\"schoolId\":\"other\"}",false)]
 [InlineData("{\"t\":0,\"o\":\"list\"}",false)]
 [InlineData("run sql select * from users",false)]
 public void OnlyOfferedReadOperationsAreAccepted(string text,bool accepted)=>Assert.Equal(accepted,AiToolSelector.Parse(text,Tools) is not null);
 [Theory]
 [InlineData("number")]
 [InlineData("headcount")]
 public void CountSynonymsStayReadOnly(string operation)=>Assert.Equal("count",AiToolSelector.Parse("{\"t\":\"staff_directory\",\"o\":\""+operation+"\"}",Tools)!.Focus);
 [Fact] public void AForbiddenToolCannotBeSelected()=>Assert.Null(AiToolSelector.Parse("{\"t\":\"staff_directory\",\"o\":\"count\"}",[]));
 [Theory]
 [InlineData("Explain photosynthesis",false)]
 [InlineData("What does the school policy say about attendance?",false)]
 [InlineData("How big is our teaching team?",true)]
 [InlineData("List the instructors working here",true)]
 public void RoutineStudyAndPolicyQuestionsAvoidExtraModelCalls(string text,bool expected)=>Assert.Equal(expected,AiToolSelector.ShouldSelect(text));
}

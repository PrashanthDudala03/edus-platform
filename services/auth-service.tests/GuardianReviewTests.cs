using Xunit;

public class GuardianReviewTests
{
    [Theory]
    [InlineData(true,true,true," Parent@School.test ","parent@school.test","Match")]
    [InlineData(true,true,true,"other@school.test","parent@school.test","Mismatch")]
    [InlineData(true,true,true," ","parent@school.test","Guardian email missing")]
    [InlineData(true,true,true,null,"parent@school.test","Guardian email missing")]
    [InlineData(true,true,false,"parent@school.test","parent@school.test","No active guardian")]
    [InlineData(true,false,false,null,"parent@school.test","Student unavailable")]
    [InlineData(false,true,true,"parent@school.test",null,"Account unavailable")]
    public void ClassifiesDirectoryHintsWithoutImplyingVerifiedAccess(bool account,bool student,bool guardian,string? email,string? accountEmail,string expected)
        => Assert.Equal(expected,GuardianReview.Status(account,student,guardian,email,accountEmail));
}

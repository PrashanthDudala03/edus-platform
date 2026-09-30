using System.Security.Cryptography;
using Services.Auth.Models;
using Services.Auth.Services;
using Xunit;

namespace Services.Auth.Tests;
public class IamTokenTests
{
    [Fact]
    public void TokenUsesEffectiveGrantsInsteadOfUnfilteredRolePermissions()
    {
        using var rsa=RSA.Create(2048);
        var jwt=new JwtService(new JwtSettings{PrivateKeyPem=rsa.ExportPkcs8PrivateKeyPem(),PublicKeyPem=rsa.ExportSubjectPublicKeyInfoPem()});
        var user=new User{Id=Guid.NewGuid(),SchoolId=Guid.NewGuid(),Username="finance",Email="finance@example.test",PasswordHash="unused",TokenVersion=4,DataScope="school",EffectivePermissions=["fees.view"],Role=new Role{Id=Guid.NewGuid(),Name="Accountant",Permissions=[new RolePermission{Id=Guid.NewGuid(),PermissionKey="fees.collect"}]}};
        var issued=jwt.IssueTokens(user);var principal=jwt.ValidateToken(issued.AccessToken)!;
        Assert.True(principal.IsInRole("Accountant"));Assert.True(principal.HasClaim("permission","fees.view"));Assert.False(principal.HasClaim("permission","fees.collect"));
        Assert.Equal("4",principal.FindFirst("token_version")?.Value);Assert.Equal("school",principal.FindFirst("data_scope")?.Value);
        Assert.Equal(new[]{"fees.view"},issued.User.Permissions);
    }
    [Fact]
    public void SuspendedRoleBlocksSignInWithoutDeactivatingTheAccount()
    {
        // Hydrate runs on tracked entities; the suspension must not reach IsActive or a later SaveChanges would persist it.
        var user=new User{Id=Guid.NewGuid(),SchoolId=Guid.NewGuid(),Username="user",Email="user@example.test",PasswordHash="unused",AccessSuspended=true};
        Assert.True(user.IsActive);Assert.False(user.CanSignIn);
        user.AccessSuspended=false;Assert.True(user.CanSignIn);
    }
    [Theory]
    [InlineData("Teacher","Principal","school")]
    [InlineData("Principal","Teacher","teacher")]
    [InlineData("Teacher","Office Staff","school")]
    public void ReissuedTokenReflectsAuthoritativeAssignment(string previous,string next,string scope)
    {
        using var rsa=RSA.Create(2048);
        var jwt=new JwtService(new JwtSettings{PrivateKeyPem=rsa.ExportPkcs8PrivateKeyPem(),PublicKeyPem=rsa.ExportSubjectPublicKeyInfoPem()});
        var user=new User{Id=Guid.NewGuid(),SchoolId=Guid.NewGuid(),Username="user",Email="user@example.test",PasswordHash="unused",Role=new Role{Id=Guid.NewGuid(),Name=previous}};
        var old=jwt.IssueTokens(user);
        user.Role=new Role{Id=Guid.NewGuid(),Name=next};user.TokenVersion++;user.DataScope=scope;
        var current=jwt.ValidateToken(jwt.IssueTokens(user).AccessToken)!;
        Assert.True(current.IsInRole(next));Assert.False(current.IsInRole(previous));Assert.Equal("1",current.FindFirst("token_version")?.Value);
        Assert.Equal("0",jwt.ValidateToken(old.AccessToken)!.FindFirst("token_version")?.Value);
    }
}

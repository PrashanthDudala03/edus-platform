using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace EduOS.ServiceAuth.Tests;

public class PermissionTests
{
    static DefaultHttpContext Context(string role,string scope,string path,string method,params string[] permissions)
    {
        var http=new DefaultHttpContext();
        http.Request.Path=path;http.Request.Method=method;
        http.User=new ClaimsPrincipal(new ClaimsIdentity(new[]{new Claim(ClaimTypes.Role,role),new Claim("data_scope",scope),new Claim("school_id",Guid.NewGuid().ToString()),new Claim(ClaimTypes.NameIdentifier,Guid.NewGuid().ToString())}.Concat(permissions.Select(p=>new Claim("permission",p))),"test"));
        return http;
    }
    [Theory]
    [InlineData("Accountant","fees.collect","/api/suite/fees/payments","POST")]
    [InlineData("Admissions Staff","admissions.manage","/api/suite/admissions/123/accept","POST")]
    [InlineData("HR","teachers.view","/api/teachers","GET")]
    [InlineData("Coordinator","classes.manage","/api/suite/records/classes/123","PUT")]
    public void CustomRolesUsePermissionsWithoutNameRegistration(string role,string permission,string path,string method)
    {
        var http=Context(role,"school",path,method,permission);
        Assert.True(TenantContext.TryFrom(http.User,out _));Assert.True(PermissionAccess.Allows(http));
        http.User=new ClaimsPrincipal(new ClaimsIdentity(http.User.Claims.Where(c=>c.Type!="permission"),"test"));
        Assert.False(PermissionAccess.Allows(http));
    }
    [Theory]
    [InlineData("parent")][InlineData("student")][InlineData("teacher")]
    public void DirectoryRequiresSchoolScopeEvenWithPermission(string scope)
    {
        Assert.False(PermissionAccess.Allows(Context("Custom",scope,"/api/students","GET","students.view")));
    }
    [Fact]
    public void UnknownEndpointsFailClosed()=>Assert.False(PermissionAccess.Allows(Context("Administrator","school","/api/future-module","GET")));
    [Fact]
    public void RoleNameAloneNeverGrantsPermission()=>Assert.False(PermissionAccess.Allows(Context("Administrator","school","/api/users","GET")));
    [Fact]
    public void SchoolRoleCannotBecomePlatformByName()
    {
        var http=Context("SuperAdmin","school","/api/control","GET","platform.manage");
        Assert.True(TenantContext.TryFrom(http.User,out var tenant));Assert.False(tenant.IsPlatform);
    }
    [Fact]
    public void PermissionMappingMatchesAcrossGatewayAndDirectService()=>Assert.Equal(PermissionAccess.Required("/api/v1/suite/records/homework","PUT"),PermissionAccess.Required("/api/suite/records/homework","PUT"));
}

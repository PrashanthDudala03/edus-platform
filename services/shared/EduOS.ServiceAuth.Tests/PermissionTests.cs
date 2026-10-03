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
    [Theory]
    [InlineData("/api/ai/status","GET","ai.assistant.use")][InlineData("/api/v1/ai/assistant/ask","POST","ai.assistant.use")]
    [InlineData("/api/ai/knowledge/documents","POST","ai.knowledge.manage")][InlineData("/api/ai/usage","GET","ai.usage.view")]
    [InlineData("/api/ai/admin/schools","PUT","ai.platform.manage")]
    public void AiRoutesRequireTheirOwnPermission(string path,string method,string permission)
    {
        Assert.Equal(permission,PermissionAccess.Required(path,method));
        foreach(var scope in new[]{"school","teacher","parent","student"})
        {
            Assert.True(PermissionAccess.Allows(Context("Custom",scope,path,method,permission)));
            Assert.False(PermissionAccess.Allows(Context("Administrator",scope,path,method,"students.view","ai.other")));
        }
    }
    [Theory]
    [InlineData("/api/ai")][InlineData("/api/ai/sql")][InlineData("/api/ai/models")][InlineData("/api/v1/ai/tools/run")]
    public void UnlistedAiRoutesFailClosed(string path)=>Assert.False(PermissionAccess.Allows(Context("Administrator","school",path,"GET","ai.assistant.use","ai.knowledge.manage","ai.usage.view","ai.platform.manage")));
    [Fact]
    public void AiHealthNeedsNoPermission()=>Assert.Null(PermissionAccess.Required("/api/ai/health","GET"));
    [Theory]
    [InlineData("/api/suite/home","GET")][InlineData("/api/v1/suite/home/images/7c1d0000-0000-4000-8000-0000000000d1","GET")]
    public void EverySchoolUserReadsSchoolHome(string path,string method)
    {
        Assert.Null(PermissionAccess.Required(path,method));
        foreach(var scope in new[]{"school","teacher","parent","student"})Assert.True(PermissionAccess.Allows(Context("Custom",scope,path,method)));
    }
    [Theory]
    [InlineData("/api/suite/home","PUT")][InlineData("/api/suite/home/manage","GET")][InlineData("/api/suite/home/preview","GET")]
    [InlineData("/api/v1/suite/home/images","POST")][InlineData("/api/suite/home/images/7c1d0000-0000-4000-8000-0000000000d1","DELETE")]
    public void SchoolHomeChangesNeedTheManagePermission(string path,string method)
    {
        Assert.Equal("school-home.manage",PermissionAccess.Required(path,method));
        Assert.True(PermissionAccess.Allows(Context("Custom","school",path,method,"school-home.manage")));
        Assert.False(PermissionAccess.Allows(Context("Administrator","school",path,method,"school.settings.manage","school-config.manage")));
    }
    [Theory]
    [InlineData("/api/notifications","GET")][InlineData("/api/v1/notifications/unread-count","GET")][InlineData("/api/notifications/7c1d0000-0000-4000-8000-0000000000d1/read","POST")]
    [InlineData("/api/notifications/read-all","POST")][InlineData("/api/v1/notifications/preferences","PUT")]
    [InlineData("/api/notifications/devices","GET")][InlineData("/api/v1/notifications/devices","PUT")][InlineData("/api/notifications/devices/3f2b8c1e-9d4a-4f6b","DELETE")]
    public void EverySchoolUserReachesTheirOwnNotifications(string path,string method)
    {
        Assert.Null(PermissionAccess.Required(path,method));
        foreach(var scope in new[]{"school","teacher","parent","student"})Assert.True(PermissionAccess.Allows(Context("Custom",scope,path,method)));
    }
    [Theory]
    [InlineData("/api/notifications/templates","GET")][InlineData("/api/v1/notifications/templates/leave.approved","GET")][InlineData("/api/notifications/templates/leave.approved/preview","POST")]
    [InlineData("/api/v1/notifications/templates/leave.approved","PUT")][InlineData("/api/notifications/templates/leave.approved/enabled","PUT")][InlineData("/api/notifications/templates/leave.approved","DELETE")]
    [InlineData("/api/notifications/history","GET")][InlineData("/api/v1/notifications/history/7c1d0000-0000-4000-8000-0000000000d1","GET")]
    public void NotificationWordingAndHistoryNeedTheManagePermission(string path,string method)
    {
        Assert.Equal("notifications.manage",PermissionAccess.Required(path,method));
        Assert.True(PermissionAccess.Allows(Context("Custom","school",path,method,"notifications.manage")));
        Assert.False(PermissionAccess.Allows(Context("Administrator","school",path,method,"school.settings.manage","school-home.manage","circulars.manage")));
        foreach(var scope in new[]{"teacher","parent","student"})Assert.False(PermissionAccess.Allows(Context("Custom",scope,path,method,"circulars.view","leave-requests.view")));
    }
    [Theory]
    [InlineData("school")][InlineData("teacher")][InlineData("parent")][InlineData("student")][InlineData("platform")]
    public void EveryAccountMayAskWhichModulesItHas(string scope)
    {
        Assert.Null(PermissionAccess.Required("/api/v1/control/features","GET"));
        Assert.True(PermissionAccess.Allows(Context("Custom",scope,"/api/control/features","GET")));
    }
    [Theory]
    [InlineData("/api/suite/student-attendance/registers","GET","attendance.view")][InlineData("/api/v1/suite/student-attendance/history","GET","attendance.view")]
    [InlineData("/api/suite/student-attendance","POST","attendance.mark")][InlineData("/api/suite/homework/board","GET","homework.view")][InlineData("/api/v1/suite/homework/overview","GET","homework.view")]
    [InlineData("/api/suite/homework/7c1d0000-0000-4000-8000-0000000000d1/submissions","GET","homework.view")][InlineData("/api/suite/homework/7c1d0000-0000-4000-8000-0000000000d1/review/7c1d0000-0000-4000-8000-0000000000d2","PUT","homework.manage")][InlineData("/api/v1/suite/reports/attendance/days","GET","reports.view")][InlineData("/api/suite/reports/attendance/classes","GET","reports.view")]
    public void AttendanceWorkflowRoutesKeepTheExistingPermissions(string path,string method,string permission)
    {
        Assert.Equal(permission,PermissionAccess.Required(path,method));
        Assert.False(PermissionAccess.Allows(Context("Custom","parent",path,method,"circulars.view")));
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

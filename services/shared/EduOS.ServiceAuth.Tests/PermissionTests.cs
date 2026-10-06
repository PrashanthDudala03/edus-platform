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
    [InlineData("/api/suite/fees/ledger/7c1d0000-0000-4000-8000-0000000000a1","GET","fees.view")][InlineData("/api/v1/suite/fees/payments","POST","fees.collect")][InlineData("/api/suite/fees/payments/7c1d0000-0000-4000-8000-0000000000p1/reverse","POST","fees.manage")][InlineData("/api/suite/fees/concessions","POST","fees.manage")][InlineData("/api/v1/suite/fees/online/intents","POST","fees.view")][InlineData("/api/suite/fees/online/intents/7c1d0000-0000-4000-8000-0000000000c1/confirm","POST","fees.view")][InlineData("/api/suite/fees/payment-config","PUT","fees.manage")][InlineData("/api/suite/fees/reports/daily","GET","fees.view")][InlineData("/api/suite/records/fee-heads","POST","fee-structures.manage")]
    [InlineData("/api/suite/fees/ledger/7c1d0000-0000-4000-8000-0000000000a1","GET","fees.view")][InlineData("/api/v1/suite/fees/payments","POST","fees.collect")][InlineData("/api/suite/fees/payments/7c1d0000-0000-4000-8000-0000000000b1/reverse","POST","fees.manage")]
    [InlineData("/api/suite/fees/concessions","POST","fees.manage")][InlineData("/api/suite/fees/payment-config","PUT","fees.manage")][InlineData("/api/suite/fees/reports/daily","GET","fees.view")][InlineData("/api/suite/fees/plans","POST","fees.manage")]
    [InlineData("/api/suite/records/fee-heads","POST","fee-structures.manage")][InlineData("/api/v1/suite/records/fee-heads","GET","fee-structures.view")]
    [InlineData("/api/suite/students/7c1d0000-0000-4000-8000-0000000000a1/360","GET","reports.view")][InlineData("/api/v1/suite/students/7c1d0000-0000-4000-8000-0000000000a1/360/timeline","GET","reports.view")][InlineData("/api/suite/students/7c1d0000-0000-4000-8000-0000000000a1/360","POST","unsupported")]
    [InlineData("/api/suite/exams/timetable","GET","exams.view")][InlineData("/api/v1/suite/exams/overview","GET","exams.view")][InlineData("/api/suite/exams/7c1d0000-0000-4000-8000-0000000000e1/marksheet","GET","exams.view")]
    [InlineData("/api/suite/exams/7c1d0000-0000-4000-8000-0000000000e1/marksheet","POST","marks.manage")][InlineData("/api/v1/suite/exams/7c1d0000-0000-4000-8000-0000000000e1/transition","POST","exams.view")]
    [InlineData("/api/suite/records/assessment-schemes","GET","exams.view")][InlineData("/api/v1/suite/records/assessment-schemes","POST","exams.manage")][InlineData("/api/suite/records/exams","PUT","exams.manage")]
    [InlineData("/api/suite/timetable/week","GET","timetable.view")][InlineData("/api/v1/suite/timetable/today","GET","timetable.view")][InlineData("/api/suite/timetable/operations","GET","substitutions.view")][InlineData("/api/suite/timetable/candidates","GET","substitutions.manage")][InlineData("/api/v1/suite/timetable/copy","POST","timetable.manage")]
    [InlineData("/api/suite/leave/balances","GET","leave-requests.view")][InlineData("/api/v1/suite/leave/queue","GET","leave-requests.view")][InlineData("/api/suite/leave/7c1d0000-0000-4000-8000-0000000000f1/impact","GET","leave-requests.view")][InlineData("/api/suite/leave/7c1d0000-0000-4000-8000-0000000000f1/decision","POST","leave-requests.approve")][InlineData("/api/v1/suite/leave/7c1d0000-0000-4000-8000-0000000000f1/cancel","POST","leave-requests.manage")]
    [InlineData("/api/suite/records/substitutions","POST","substitutions.manage")][InlineData("/api/v1/suite/records/period-slots","GET","period-slots.view")][InlineData("/api/suite/records/leave-types","PUT","leave-types.manage")][InlineData("/api/suite/records/leave-adjustments","DELETE","leave-adjustments.archive")]
    [InlineData("/api/suite/admissions/pipeline","GET","admissions.view")][InlineData("/api/v1/suite/admissions/7c1d0000-0000-4000-8000-0000000000a9","GET","admissions.view")][InlineData("/api/suite/admissions/7c1d0000-0000-4000-8000-0000000000a9/transition","POST","admissions.view")]
    [InlineData("/api/suite/admissions/7c1d0000-0000-4000-8000-0000000000a9/onboarding/start","POST","onboarding.manage")][InlineData("/api/v1/suite/admissions/7c1d0000-0000-4000-8000-0000000000a9/onboarding","PUT","onboarding.manage")][InlineData("/api/suite/admissions/7c1d0000-0000-4000-8000-0000000000a9/activate","POST","onboarding.manage")]
    [InlineData("/api/suite/admissions/7c1d0000-0000-4000-8000-0000000000a9/accept","POST","admissions.manage")][InlineData("/api/suite/admissions/7c1d0000-0000-4000-8000-0000000000a9/candidates","GET","admissions.view")][InlineData("/api/suite/records/admission-fields","POST","admission-fields.manage")]
    [InlineData("/api/suite/student-attendance","POST","attendance.mark")][InlineData("/api/suite/homework/board","GET","homework.view")][InlineData("/api/v1/suite/homework/overview","GET","homework.view")]
    [InlineData("/api/suite/homework/7c1d0000-0000-4000-8000-0000000000d1/submissions","GET","homework.view")][InlineData("/api/suite/homework/7c1d0000-0000-4000-8000-0000000000d1/review/7c1d0000-0000-4000-8000-0000000000d2","PUT","homework.manage")][InlineData("/api/v1/suite/reports/attendance/days","GET","reports.view")][InlineData("/api/suite/reports/attendance/classes","GET","reports.view")]
    public void AttendanceWorkflowRoutesKeepTheExistingPermissions(string path,string method,string permission)
    {
        Assert.Equal(permission,PermissionAccess.Required(path,method));
        Assert.False(PermissionAccess.Allows(Context("Custom","parent",path,method,"circulars.view")));
    }
    [Theory]
    [InlineData("/api/suite/communications","GET","circulars.manage")][InlineData("/api/v1/suite/communications/attention","GET","circulars.manage")][InlineData("/api/suite/communications/audience","POST","circulars.manage")]
    [InlineData("/api/suite/communications/7c1d0000-0000-4000-8000-0000000000c1","GET","circulars.manage")][InlineData("/api/v1/suite/communications/7c1d0000-0000-4000-8000-0000000000c1/acknowledgements","GET","circulars.manage")]
    [InlineData("/api/suite/communications/7c1d0000-0000-4000-8000-0000000000c1/publish","POST","circulars.manage")][InlineData("/api/suite/communications/7c1d0000-0000-4000-8000-0000000000c1/schedule","POST","circulars.manage")]
    [InlineData("/api/suite/communications/7c1d0000-0000-4000-8000-0000000000c1/cancel","POST","circulars.manage")][InlineData("/api/v1/suite/communications/7c1d0000-0000-4000-8000-0000000000c1/archive","POST","circulars.manage")]
    public void CommunicationManagementNeedsTheCircularsManagePermission(string path,string method,string permission)
    {
        Assert.Equal(permission,PermissionAccess.Required(path,method));
        // Recipients hold view (and acknowledge); neither reaches the workspace, the summary, the audience preview or a status move.
        foreach(var scope in new[]{"parent","student","teacher"})Assert.False(PermissionAccess.Allows(Context("Custom",scope,path,method,"circulars.view","circulars.acknowledge")));
        Assert.True(PermissionAccess.Allows(Context("Custom","school",path,method,"circulars.manage")));
    }
    [Theory]
    [InlineData("/api/suite/communications/feed","GET")][InlineData("/api/v1/suite/communications/7c1d0000-0000-4000-8000-0000000000c1/read","POST")]
    public void ARecipientsOwnFeedAndReadMarksNeedOnlyTheViewPermission(string path,string method)
    {
        Assert.Equal("circulars.view",PermissionAccess.Required(path,method));
        Assert.True(PermissionAccess.Allows(Context("Custom","parent",path,method,"circulars.view")));
        Assert.False(PermissionAccess.Allows(Context("Custom","parent",path,method,"homework.view")));
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

using Microsoft.AspNetCore.Http;

namespace EduOS.ServiceAuth;

/// <summary>One endpoint-to-permission map shared by every service and the gateway.</summary>
public static class PermissionAccess
{
    public static string? Required(string path, string method)
    {
        var p = path.Replace("/api/v1/", "/api/").TrimEnd('/').Split('/');
        if (p.Length < 3) return null;
        var read = method is "GET" or "HEAD";
        var resource = p[2];
        if (resource is "auth" or "internal" or "health" or "platform" or "control" or "billing" or "promotions") return null;
        // Platform billing is held to the platform policy; a school only reads and pays for its own subscription.
        if (resource == "subscription") return read || p.ElementAtOrDefault(3) == "quote" ? "subscription.view" : "subscription.purchase";
        // AI routes are listed one by one; anything else under /api/ai is refused until it is added here.
        if (resource == "ai") return p.ElementAtOrDefault(3) switch {
            "health" => null, "status" or "assistant" => "ai.assistant.use", "knowledge" => "ai.knowledge.manage",
            "usage" => "ai.usage.view", "admin" => "ai.platform.manage", _ => "unsupported" };
        // A person's own notification inbox, read state and preferences; the service binds every query to the caller.
        // Devices are the caller's own too. A school's wording and its delivery history are management areas.
        if (resource == "notifications") return p.ElementAtOrDefault(3) is "templates" or "history" ? "notifications.manage" : null;
        if (resource == "roles") return "roles.view";
        if (resource == "users") return read ? "users.view" : method == "DELETE" ? "users.disable" : method == "POST" && p.Length == 3 ? "users.create" : "users.update";
        if (resource is "students" or "teachers" or "parents") return resource + (read ? ".view" : method == "POST" ? ".create" : method == "DELETE" ? ".archive" : ".update");
        if (resource == "schools") return "school.settings." + (read ? "view" : "manage");
        if (resource == "operations") return p.ElementAtOrDefault(3) switch {
            "overview" => "overview.view", "directory" => p.ElementAtOrDefault(4) + ".view",
            "attendance" => read ? "attendance.view" : "attendance.mark",
            "announcements" => read ? "announcements.view" : "announcements.manage", "audit" => "audit.view", _ => "unsupported" };
        if (resource != "suite") return "unsupported";
        var action = p.ElementAtOrDefault(3);
        return action switch {
            "school" or "catalog" or "options" => null,
            // Every school user reads the published School Home and its images; the editor, preview and uploads need the permission.
            "home" => read && p.ElementAtOrDefault(4) is null or "images" ? null : "school-home.manage",
            // Assessment schemes are configuration of the exams module and share its permission.
            "records" => (p.ElementAtOrDefault(4) == "assessment-schemes" ? "exams" : p.ElementAtOrDefault(4)) + (read ? ".view" : method == "DELETE" ? ".archive" : ".manage"),
            "student-attendance" => read ? "attendance.view" : "attendance.mark",
            "homework" => read ? "homework.view" : "homework.manage",
            // Timetable, overview and marksheets are read with exams.view; marks entry needs marks.manage and the lifecycle call is checked per role by the service.
            "exams" => read ? "exams.view" : p.ElementAtOrDefault(5) == "marksheet" ? "marks.manage" : "exams.view",
            "fees" => read ? "fees.view" : p.ElementAtOrDefault(4) == "payments" ? "fees.collect" : "fees.manage",
            "reports" => p.ElementAtOrDefault(4) == "audit" ? "audit.view" : "reports.view",
            "report-cards" => "reports.view", "certificates" => "certificates.view",
            "documents" => read ? "documents.view" : "documents.upload",
            "imports" => p.ElementAtOrDefault(4) + ".create",
            "allocate" => "allocations.manage", "allocations" => "allocations.view",
            "admissions" => "admissions.manage",
            "circulars" => read ? "circulars.manage" : "circulars.acknowledge",
            "absence-notifications" => "announcements.manage", _ => "unsupported" };
    }

    public static bool Allows(HttpContext http)
    {
        var path = http.Request.Path.Value ?? "";
        var permission = Required(path, http.Request.Method);
        if (permission != null && !http.User.HasClaim("permission", permission)) return false;
        // Directory and legacy operation endpoints return whole-school data. A scoped role
        // must use suite endpoints, which additionally enforce verified profile links.
        var normalized = path.Replace("/api/v1/", "/api/");
        if (new[] { "/api/students", "/api/teachers", "/api/parents", "/api/operations", "/api/schools" }
            .Any(prefix => normalized == prefix || normalized.StartsWith(prefix + "/")))
            return http.User.HasClaim("data_scope", "school");
        return true;
    }
}

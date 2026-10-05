using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EduOS.ServiceAuth;
using Npgsql;

/// <summary>
/// The rules of Admissions 2.0 and Student Onboarding 2.0, kept pure so they are tested without a database: the
/// application lifecycle and who may move it, the admission form's answers, duplicate matching, and what still blocks
/// activation. Onboarding is a plan held on the application; nothing is created until activation commits it at once.
/// </summary>
public static class AdmissionRules
{
    public static readonly string[] Statuses = ["Draft", "Submitted", "Under Review", "Approved", "Waitlisted", "Rejected", "Withdrawn", "Onboarding", "Ready", "Active"];
    /// <summary>Statuses an office moves an application to by decision. Onboarding, Ready and Active are reached only by onboarding operations.</summary>
    public static readonly string[] Decisions = ["Submitted", "Under Review", "Approved", "Waitlisted", "Rejected", "Withdrawn"];
    public static readonly string[] DocumentStatuses = ["Required", "Uploaded", "Verified", "Rejected", "Not applicable"];
    public static readonly string[] Relationships = ["Mother", "Father", "Guardian", "Other"];
    public static readonly string[] AnswerTypes = ["Text", "Paragraph", "Number", "Date", "Dropdown", "Single choice", "Multiple choice", "Checkbox", "Document"];
    public const int MaxHistory = 50;
    /// <summary>Applications accepted before Admissions 2.0 carry "Accepted"; they are active students.</summary>
    public static string Status(string status) => status == "Accepted" ? "Active" : status == "" ? "Draft" : status;
    /// <summary>Active, rejected and withdrawn applications are history: their details never change again.</summary>
    public static bool Closed(string status) => Status(status) is "Active" or "Rejected" or "Withdrawn";
    public static bool InOnboarding(string status) => Status(status) is "Onboarding" or "Ready";
    public static bool NeedsReason(string to) => to is "Rejected" or "Waitlisted" or "Withdrawn";
    /// <summary>
    /// Whether a decision is allowed and the HTTP status when it is not: 403 when the right person could make it, 409 when
    /// nobody can from here. Staying where it is changes nothing. Approving, rejecting and waitlisting need the approve
    /// permission; submitting, starting review and withdrawing need manage (an approver may also start a review).
    /// </summary>
    public static (string message, int status)? TransitionProblem(string from, string to, bool manage, bool approve, string reason)
    {
        from = Status(from);
        if (!Decisions.Contains(to)) return ("Choose a valid decision.", 400);
        if (from == to) return null;
        if (NeedsReason(to) && string.IsNullOrWhiteSpace(reason)) return ("Give a reason for this decision.", 400);
        var (allowed, byApprover) = (from, to) switch
        {
            ("Draft", "Submitted") or ("Draft", "Withdrawn") => (true, false),
            ("Submitted", "Under Review") => (true, manage ? false : true),
            ("Submitted", "Rejected") => (true, true),
            ("Submitted", "Withdrawn") => (true, false),
            ("Under Review", "Approved") or ("Under Review", "Rejected") or ("Under Review", "Waitlisted") => (true, true),
            ("Under Review", "Withdrawn") => (true, false),
            ("Waitlisted", "Approved") or ("Waitlisted", "Rejected") or ("Waitlisted", "Under Review") => (true, true),
            ("Waitlisted", "Withdrawn") => (true, false),
            ("Approved", "Withdrawn") or ("Onboarding", "Withdrawn") or ("Ready", "Withdrawn") => (true, false),
            _ => (false, false),
        };
        if (!allowed) return ("An application that is " + from.ToLowerInvariant() + " cannot become " + to.ToLowerInvariant() + ".", 409);
        return (byApprover ? approve : manage) ? null : (byApprover ? "Only an admissions approver can make this decision." : "Your role cannot change this application.", 403);
    }
    /// <summary>Why one answer to the school's admission form is not acceptable, or null. Document questions are answered by uploads.</summary>
    public static string? AnswerProblem(string label, string type, string options, bool required, JsonNode? value)
    {
        var choices = options.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (type == "Document") return null;
        if (value is null || value is JsonValue v0 && string.IsNullOrWhiteSpace(v0.ToString()) || value is JsonArray { Count: 0 })
            return required && type != "Checkbox" ? label + " is required." : null;
        switch (type)
        {
            case "Multiple choice":
                if (value is not JsonArray list) return label + " must be a list of choices.";
                var picked = list.Select(x => x?.ToString() ?? "").ToList();
                return picked.All(choices.Contains) && picked.Distinct().Count() == picked.Count ? null : "Choose " + label + " from the listed options.";
            case "Checkbox": return value is JsonValue cb && cb.TryGetValue<bool>(out var ticked) ? (required && !ticked ? label + " must be confirmed." : null) : label + " must be ticked or not.";
        }
        if (value is not JsonValue single) return label + " must be a single answer.";
        var text = single.ToString().Trim();
        return type switch
        {
            "Text" => text.Length <= 255 ? null : label + " is too long.",
            "Paragraph" => text.Length <= 2000 ? null : label + " is too long.",
            "Number" => decimal.TryParse(text, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out _) ? null : label + " must be a number.",
            "Date" => DateOnly.TryParseExact(text, "yyyy-MM-dd", out _) ? null : label + " must be a date.",
            "Dropdown" or "Single choice" => choices.Contains(text) ? null : "Choose " + label + " from the listed options.",
            _ => "Unknown question type for " + label + ".",
        };
    }
    public static bool ValidKey(string key) => Regex.IsMatch(key, "^[a-z][a-z0-9-]{0,39}$");
    /// <summary>The documents asked for when a school has not configured its own document questions.</summary>
    public static readonly (string key, string label, bool required)[] DefaultDocuments = [("birth-certificate", "Birth certificate", true), ("address-proof", "Proof of address", true), ("transfer-certificate", "Previous school transfer certificate", false)];

    /// <summary>The fields duplicate matching reads, normalised.</summary>
    public sealed record Applicant(string FirstName, string LastName, string DateOfBirth, string Email, string GuardianEmail, string GuardianPhone, string Number);
    public static string Name(string first, string last) => Regex.Replace((first + " " + last).Trim().ToLowerInvariant(), @"\s+", " ");
    public static string Digits(string phone) { var d = new string(phone.Where(char.IsDigit).ToArray()); return d.Length > 10 ? d[^10..] : d; }
    /// <summary>
    /// Why two people may be the same child, strongest first. Name alone is never enough: it must come with the date of
    /// birth. Contact details match exactly (emails case-insensitively, phones on their last ten digits). Nothing is merged.
    /// </summary>
    public static List<string> DuplicateReasons(Applicant a, Applicant b)
    {
        var reasons = new List<string>();
        if (a.Number != "" && string.Equals(a.Number, b.Number, StringComparison.OrdinalIgnoreCase)) reasons.Add("Same admission number");
        if (Name(a.FirstName, a.LastName) == Name(b.FirstName, b.LastName) && a.DateOfBirth != "" && a.DateOfBirth == b.DateOfBirth) reasons.Add("Same name and date of birth");
        if (a.Email != "" && string.Equals(a.Email, b.Email, StringComparison.OrdinalIgnoreCase)) reasons.Add("Same student email");
        var sameFamily = a.GuardianEmail != "" && string.Equals(a.GuardianEmail, b.GuardianEmail, StringComparison.OrdinalIgnoreCase) || Digits(a.GuardianPhone).Length >= 7 && Digits(a.GuardianPhone) == Digits(b.GuardianPhone);
        // A shared guardian is a sibling more often than a duplicate: it only counts alongside the same first name.
        if (sameFamily && string.Equals(a.FirstName.Trim(), b.FirstName.Trim(), StringComparison.OrdinalIgnoreCase)) reasons.Add("Same first name and guardian contact");
        return reasons;
    }
    /// <summary>A guardian already on file may be linked only when the application names their email or phone: never on a name.</summary>
    public static bool ContactMatches(string appEmail, string appPhone, string email, string phone) =>
        appEmail != "" && string.Equals(appEmail.Trim(), email.Trim(), StringComparison.OrdinalIgnoreCase) || Digits(appPhone).Length >= 7 && Digits(appPhone) == Digits(phone);
    /// <summary>Required steps still open, in order; accounts are recommended and never block activation.</summary>
    public static List<string> Blockers(IEnumerable<(string key, string label, bool done, bool required, string detail)> steps) =>
        steps.Where(s => s.required && !s.done).Select(s => s.label + ": " + s.detail).ToList();
}

// Admissions 2.0 and Student Onboarding 2.0. An application moves through explicit decisions; once approved, onboarding
// builds a plan (guardian, documents, class, fees, accounts) on the application itself and activation commits the whole
// plan in one transaction under the school lock, so a retry or a second click never creates a second student, guardian,
// enrolment, charge or account link. Every statement names the school of the token; foreign ids are refused before use.
public static partial class Suite
{
    static async Task<SchoolAccess> AdmissionsOffice(NpgsqlConnection c, HttpContext http)
    {
        var a = await Access(http, c); Require(a.SchoolWide && a.Can("admissions.view"), "Admissions are handled by the school office.", 403); return a;
    }
    static JsonObject Clean(JsonObject record) { var d = (JsonObject)record.DeepClone(); d.Remove("id"); d.Remove("version"); d.Remove("createdAt"); return d; }
    static void Remember(JsonObject d, SchoolAccess a, string from, string to, string reason)
    {
        var history = d["history"] as JsonArray ?? new JsonArray(); if (d["history"] is null) d["history"] = history;
        history.Add(new JsonObject { ["from"] = from, ["to"] = to, ["by"] = a.User.ToString(), ["at"] = DateTime.UtcNow.ToString("o"), ["reason"] = reason });
        while (history.Count > AdmissionRules.MaxHistory) history.RemoveAt(0);
    }
    static async Task WriteAdmission(NpgsqlConnection c, SchoolAccess a, Guid id, JsonObject d, int version)
    {
        var changed = await E(c, "UPDATE suite.records SET data=@d::jsonb,version=version+1,updated_at=now(),updated_by=@u WHERE school_id=@s AND id=@id AND kind='admissions' AND version=@v AND archived_at IS NULL", ("d", d.ToJsonString()), ("u", a.User), ("s", a.School), ("id", id), ("v", version));
        Require(changed == 1, "This application changed since you opened it. Refresh and try again.", 409);
    }
    static int VersionOf(JsonObject input, JsonObject current) => input["version"] is JsonValue v && v.TryGetValue<int>(out var n) ? n : (int)Number(current, "version");
    static async Task<List<JsonObject>> FormFields(NpgsqlConnection c, Guid school) =>
        (await Records(c, school, "admission-fields")).Where(f => Text(f, "enabled") == "Yes").OrderBy(f => Number(f, "order")).ThenBy(f => Text(f, "label")).ToList();
    static async Task<List<(string key, string label, bool required)>> DocumentList(NpgsqlConnection c, Guid school)
    {
        var configured = (await FormFields(c, school)).Where(f => Text(f, "type") == "Document").Select(f => (Text(f, "key"), Text(f, "label"), Text(f, "required") == "Yes")).ToList();
        return configured.Count > 0 ? configured : AdmissionRules.DefaultDocuments.ToList();
    }

    /// <summary>Generic record saves of an application: field rules, the form's answers, numbers and stamps. Status moves only through decisions.</summary>
    static async Task ValidateAdmission(NpgsqlConnection c, SchoolAccess a, JsonObject d, JsonObject? old, Guid? id, List<JsonObject> peers)
    {
        Require(Text(d, "admissionNumber").Length <= 50 && Text(d, "firstName").Length <= 100 && Text(d, "lastName").Length <= 100, "Admission number or student name is too long.");
        Require(Text(d, "phoneNumber").Length <= 20 && Text(d, "guardianPhone").Length <= 20, "Phone numbers must be at most 20 characters.");
        Require(Text(d, "guardianName").Split(' ', 2).All(part => part.Length <= 100), "Guardian name parts must be at most 100 characters.");
        Require(Day(d, "dateOfBirth") < DateOnly.FromDateTime(DateTime.UtcNow), "Date of birth must be in the past.");
        if (Text(d, "admissionNumber") != "") Require(!peers.Any(p => string.Equals(Text(p, "admissionNumber"), Text(d, "admissionNumber"), StringComparison.OrdinalIgnoreCase)), "A record with these details already exists.", 409);
        var status = AdmissionRules.Status(Text(d, "status"));
        if (old is null) Require(status is "Draft" or "Submitted", "A new application is saved as a draft or submitted.", 409);
        else
        {
            Require(!AdmissionRules.Closed(Text(old, "status")), "Active, rejected and withdrawn applications are preserved. Edit the student record instead.", 409);
            Require(status == AdmissionRules.Status(Text(old, "status")), "Use the application's decisions to change its status.", 409);
            d["status"] = Text(old, "status");
        }
        // The class must belong to the academic year applied for; the year defaults to the class's year.
        var cls = await Get(c, a.School, "classes", Id(d, "classId"));
        if (Text(d, "yearId") == "") d["yearId"] = Text(cls, "yearId"); else Require(Text(cls, "yearId") == Text(d, "yearId"), "That class belongs to another academic year.");
        // Answers to the school's own questions: only enabled questions are kept; required ones are enforced once submitted.
        var answers = d["answers"] as JsonObject ?? new JsonObject(); var kept = new JsonObject();
        foreach (var f in await FormFields(c, a.School))
        {
            var key = Text(f, "key"); if (Text(f, "type") == "Document") continue;
            var problem = AdmissionRules.AnswerProblem(Text(f, "label"), Text(f, "type"), Text(f, "options"), status != "Draft" && Text(f, "required") == "Yes", answers[key]);
            Require(problem is null, problem ?? "");
            if (answers[key] is not null) kept[key] = answers[key]!.DeepClone();
        }
        d["answers"] = kept;
        if (old is null)
        {
            d["applicationNumber"] = await NextNumber(c, a.School, "application", "APP"); d["history"] = new JsonArray(); Remember(d, a, "", status, "");
            if (status == "Submitted") d["submittedAt"] = DateTime.UtcNow.ToString("o");
        }
        if (AdmissionRules.InOnboarding(status) && id is not null) { var (_, blockers) = await Checklist(c, a, d, id.Value); d["status"] = blockers.Count == 0 ? "Ready" : "Onboarding"; }
    }

    /// <summary>Other applications and students of this school that may be the same child. School-bound: another school is never searched.</summary>
    static async Task<JsonArray> DuplicatesOf(NpgsqlConnection c, SchoolAccess a, JsonObject d, string id, List<JsonObject>? applications = null, List<JsonObject>? students = null)
    {
        var me = new AdmissionRules.Applicant(Text(d, "firstName"), Text(d, "lastName"), Text(d, "dateOfBirth"), Text(d, "email"), Text(d, "guardianEmail"), Text(d, "guardianPhone"), Text(d, "admissionNumber"));
        var found = new JsonArray();
        foreach (var other in applications ?? await Records(c, a.School, "admissions"))
        {
            if (Text(other, "id") == id || AdmissionRules.Status(Text(other, "status")) is "Rejected" or "Withdrawn" || Text(other, "studentId") != "" && Text(other, "studentId") == Text(d, "studentId")) continue;
            var reasons = AdmissionRules.DuplicateReasons(me, new(Text(other, "firstName"), Text(other, "lastName"), Text(other, "dateOfBirth"), Text(other, "email"), Text(other, "guardianEmail"), Text(other, "guardianPhone"), Text(other, "admissionNumber")));
            if (reasons.Count > 0) found.Add(new JsonObject { ["source"] = "application", ["id"] = Text(other, "id"), ["label"] = Text(other, "firstName") + " " + Text(other, "lastName"), ["number"] = Text(other, "applicationNumber"), ["status"] = AdmissionRules.Status(Text(other, "status")), ["reasons"] = new JsonArray(reasons.Select(r => (JsonNode)r).ToArray()) });
        }
        students ??= await SchoolStudents(c, a.School);
        foreach (var s in students)
        {
            if (Text(s, "id") == Text(d, "studentId")) continue;
            var reasons = AdmissionRules.DuplicateReasons(me, new(Text(s, "firstName"), Text(s, "lastName"), Text(s, "dateOfBirth"), Text(s, "email"), Text(s, "guardianEmail"), Text(s, "guardianPhone"), Text(s, "number")));
            if (reasons.Count > 0) found.Add(new JsonObject { ["source"] = "student", ["id"] = Text(s, "id"), ["label"] = Text(s, "firstName") + " " + Text(s, "lastName"), ["number"] = Text(s, "number"), ["status"] = Text(s, "status"), ["reasons"] = new JsonArray(reasons.Select(r => (JsonNode)r).ToArray()) });
        }
        return found;
    }
    static Task<List<JsonObject>> SchoolStudents(NpgsqlConnection c, Guid school) => Q(c, """
        SELECT s.id::text AS id,s.first_name AS "firstName",s.last_name AS "lastName",to_char(s.date_of_birth,'YYYY-MM-DD') AS "dateOfBirth",coalesce(s.email,'') AS email,s.roll_number AS number,s.status,
        coalesce(p.email,'') AS "guardianEmail",coalesce(p.phone_number,'') AS "guardianPhone"
        FROM student_db.students s LEFT JOIN parent_db.parents p ON p.id=s.parent_guardian_id AND p.school_id=s.school_id WHERE s.school_id=@s AND s.deleted_at IS NULL
        """, ("s", school));

    /// <summary>
    /// The onboarding checklist and what still blocks activation, read live from the school's records: the guardian on file,
    /// the documents and their checks, the class and its free places, the fee structures and the accounts chosen.
    /// </summary>
    static async Task<(JsonObject view, List<string> blockers)> Checklist(NpgsqlConnection c, SchoolAccess a, JsonObject d, Guid id)
    {
        var plan = d["onboarding"] as JsonObject ?? new JsonObject(); var steps = new List<(string key, string label, bool done, bool required, string detail)>();
        // Applicant: the details are confirmed and the admission number, if chosen, is free.
        var number = Text(d, "admissionNumber");
        var numberTaken = number != "" && (await Q(c, "SELECT id FROM student_db.students WHERE school_id=@s AND lower(roll_number)=lower(@n) AND deleted_at IS NULL", ("s", a.School), ("n", number))).Count > 0;
        steps.Add(("details", "Applicant", plan["detailsConfirmed"]?.GetValue<bool>() == true && !numberTaken, true, numberTaken ? "admission number " + number + " belongs to another student" : "confirm the student's details"));
        // Guardian: an existing guardian whose contact matches, or a new one from the application; the relationship is confirmed.
        var guardian = plan["guardian"] as JsonObject ?? new JsonObject(); string guardianDetail = "confirm the guardian and relationship"; var guardianOk = guardian["confirmed"]?.GetValue<bool>() == true && Text(guardian, "relationship") != "";
        if (guardianOk && Text(guardian, "mode") == "existing")
        {
            var parent = (await Q(c, "SELECT email,coalesce(phone_number,'') AS phone FROM parent_db.parents WHERE id=@id AND school_id=@s AND deleted_at IS NULL", ("id", Guid.TryParse(Text(guardian, "parentId"), out var pid) ? pid : Guid.Empty), ("s", a.School))).FirstOrDefault();
            guardianOk = parent is not null && AdmissionRules.ContactMatches(Text(d, "guardianEmail"), Text(d, "guardianPhone"), Text(parent, "email"), Text(parent, "phone"));
            if (!guardianOk) guardianDetail = "the chosen guardian is no longer available";
        }
        steps.Add(("guardian", "Guardian", guardianOk, true, guardianDetail));
        // Documents: every required document verified (or marked not applicable); nothing waiting for a replacement.
        var checks = plan["documents"] as JsonObject ?? new JsonObject(); var attachments = await Q(c, "SELECT id,file_name AS name,created_at AS \"uploadedAt\" FROM suite.documents WHERE school_id=@s AND record_id=@r ORDER BY created_at", ("s", a.School), ("r", id));
        var documents = new JsonArray(); var missing = new List<string>();
        foreach (var (key, label, required) in await DocumentList(c, a.School))
        {
            var check = checks[key] as JsonObject; var status = check is null ? (attachments.Count > 0 ? "Uploaded" : "Required") : Text(check, "status");
            if (required && status is not ("Verified" or "Not applicable")) missing.Add(label);
            documents.Add(new JsonObject { ["key"] = key, ["label"] = label, ["required"] = required, ["status"] = status, ["note"] = check is null ? "" : Text(check, "note"), ["checkedAt"] = check is null ? "" : Text(check, "at") });
        }
        steps.Add(("documents", "Documents", missing.Count == 0, true, missing.Count == 0 ? "" : string.Join(", ", missing) + " not verified"));
        // Academics: the class exists in this school, belongs to the year applied for, and has a free place.
        var academics = plan["academics"] as JsonObject ?? new JsonObject(); var classId = Text(academics, "classId"); string classDetail = "choose the class and section"; var classOk = false; JsonObject? cls = null;
        if (Guid.TryParse(classId, out var cid))
        {
            cls = (await Records(c, a.School, "classes")).FirstOrDefault(x => Text(x, "id") == cid.ToString());
            if (cls is null) classDetail = "the chosen class is not available";
            else if (Text(d, "yearId") != "" && Text(cls, "yearId") != Text(d, "yearId")) classDetail = "the class belongs to another academic year";
            else
            {
                var taken = Number((await Q(c, "SELECT count(*) AS n FROM suite.student_classes WHERE school_id=@s AND class_id=@c", ("s", a.School), ("c", cid)))[0], "n");
                classOk = taken < Number(cls, "capacity"); classDetail = classOk ? "" : Label("classes", cls) + " is full";
            }
        }
        steps.Add(("academics", "Academics", classOk, true, classDetail));
        // Fees: the structures to charge, all for that class, or a recorded decision that none apply yet.
        var fees = plan["fees"] as JsonObject ?? new JsonObject(); var feeOk = false; string feeDetail = "assign fee structures or record that none apply"; var preview = new JsonArray(); long total = 0;
        if (Text(fees, "mode") == "none") { feeOk = Text(fees, "reason") != ""; feeDetail = feeOk ? "" : "give a reason for no fees"; }
        else if (Text(fees, "mode") == "assign" && fees["structureIds"] is JsonArray chosen && chosen.Count > 0)
        {
            var structures = (await Records(c, a.School, "fee-structures")).ToDictionary(x => Text(x, "id")); feeOk = true;
            foreach (var sid in chosen.Select(x => x?.ToString() ?? ""))
            {
                if (!structures.TryGetValue(sid, out var st) || Text(st, "classId") != classId || Text(st, "studentId") != "") { feeOk = false; feeDetail = "a chosen fee structure does not belong to the chosen class"; continue; }
                var amount = Cents(st, "amount"); total += amount;
                preview.Add(new JsonObject { ["id"] = sid, ["name"] = Text(st, "name"), ["installment"] = Text(st, "installment"), ["dueDate"] = Text(st, "dueDate"), ["amount"] = amount / 100m });
            }
        }
        steps.Add(("fees", "Fees", feeOk, true, feeOk ? "" : feeDetail));
        // Accounts: recommended, never blocking. A chosen account must still match the application and be free.
        var accounts = plan["accounts"] as JsonObject ?? new JsonObject(); var accountProblem = "";
        foreach (var (field, scope, email) in new[] { ("parentUserId", "parent", Text(d, "guardianEmail")), ("studentUserId", "student", Text(d, "email")) })
            if (Text(accounts, field) != "" && await AccountProblem(c, a.School, Text(accounts, field), scope, email, Text(d, "studentId")) is string p) accountProblem = p;
        steps.Add(("accounts", "Accounts", accountProblem == "" && (Text(accounts, "parentUserId") != "" || Text(accounts, "studentUserId") != ""), accountProblem != "", accountProblem == "" ? "no account linked yet (optional)" : accountProblem));
        var blockers = AdmissionRules.Blockers(steps);
        var view = new JsonObject
        {
            ["steps"] = new JsonArray(steps.Select(s => (JsonNode)new JsonObject { ["key"] = s.key, ["label"] = s.label, ["done"] = s.done, ["required"] = s.required, ["detail"] = s.done ? "" : s.detail }).ToArray()),
            ["blockers"] = new JsonArray(blockers.Select(b => (JsonNode)b).ToArray()), ["done"] = steps.Count(s => s.done), ["total"] = steps.Count,
            ["documents"] = documents, ["attachments"] = new JsonArray(attachments.Select(x => (JsonNode)x).ToArray()),
            ["guardian"] = guardian.DeepClone(), ["academics"] = new JsonObject { ["classId"] = classId, ["className"] = cls is null ? "" : Label("classes", cls) },
            ["fees"] = new JsonObject { ["mode"] = Text(fees, "mode"), ["reason"] = Text(fees, "reason"), ["structures"] = preview, ["total"] = total / 100m },
            ["accounts"] = accounts.DeepClone(), ["detailsConfirmed"] = plan["detailsConfirmed"]?.GetValue<bool>() == true,
        };
        return (view, blockers);
    }
    /// <summary>Why a user cannot be linked: not in this school, inactive, of another kind, a different email, or already linked elsewhere.</summary>
    static async Task<string?> AccountProblem(NpgsqlConnection c, Guid school, string userId, string scope, string email, string studentId)
    {
        if (!Guid.TryParse(userId, out var uid)) return "the chosen account is not valid";
        var user = (await Q(c, "SELECT u.email,u.is_active AS active,t.data_scope AS scope FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id JOIN auth_db.role_templates t ON t.id=r.template_id WHERE u.id=@id AND u.school_id=@s AND u.deleted_at IS NULL", ("id", uid), ("s", school))).FirstOrDefault();
        if (user is null || user["active"]?.GetValue<bool>() != true) return "the chosen account is not available";
        if (Text(user, "scope") != scope) return "the chosen account is not a " + scope + " account";
        if (!string.Equals(Text(user, "email"), email, StringComparison.OrdinalIgnoreCase)) return "the chosen account's email does not match the application";
        if (scope == "student" && (await Records(c, school, "account-links")).Any(l => Text(l, "userId") == userId && Text(l, "studentId") != studentId)) return "the chosen student account is linked to another student";
        return null;
    }
    static async Task<(Dictionary<string, JsonObject> classes, Dictionary<string, JsonObject> years)> ClassesAndYears(NpgsqlConnection c, Guid school) =>
        ((await Records(c, school, "classes")).ToDictionary(x => Text(x, "id")), (await Records(c, school, "academic-years")).ToDictionary(x => Text(x, "id")));
    static JsonObject AdmissionView(JsonObject d, bool detail, Dictionary<string, JsonObject> classes, Dictionary<string, JsonObject> years)
    {
        var v = new JsonObject
        {
            ["id"] = Text(d, "id"), ["version"] = d["version"]?.DeepClone(), ["applicationNumber"] = Text(d, "applicationNumber"), ["admissionNumber"] = Text(d, "admissionNumber"), ["status"] = AdmissionRules.Status(Text(d, "status")),
            ["name"] = Text(d, "firstName") + " " + Text(d, "lastName"), ["classId"] = Text(d, "classId"), ["className"] = classes.TryGetValue(Text(d, "classId"), out var cl) ? Label("classes", cl) : "",
            ["yearId"] = Text(d, "yearId"), ["yearName"] = years.TryGetValue(Text(d, "yearId"), out var yr) ? Text(yr, "name") : "", ["guardianName"] = Text(d, "guardianName"),
            ["submittedAt"] = Text(d, "submittedAt"), ["createdAt"] = Text(d, "createdAt"), ["studentId"] = Text(d, "studentId"),
        };
        if (!detail) return v;
        var application = new JsonObject(); v["application"] = application; foreach (var f in Schemas["admissions"].Fields) application[f.Key] = d[f.Key]?.DeepClone();
        v["answers"] = d["answers"]?.DeepClone() ?? new JsonObject(); v["history"] = d["history"]?.DeepClone() ?? new JsonArray();
        return v;
    }

    static void MapAdmissions(RouteGroupBuilder group)
    {
        // The office's pipeline: counts per status and one page of applications with their documents and onboarding progress.
        group.MapGet("/admissions/pipeline", async (HttpContext http, string? status = null, string? yearId = null, string? classId = null, string? search = null, bool missingDocuments = false, int page = 1) =>
        {
            await using var c = await Open(); var a = await AdmissionsOffice(c, http); Require(page is > 0 and < 10000, "Invalid page.");
            var all = await Records(c, a.School, "admissions"); var students = await SchoolStudents(c, a.School); var counts = new JsonObject();
            foreach (var s in AdmissionRules.Statuses) counts[s] = all.Count(r => AdmissionRules.Status(Text(r, "status")) == s);
            var documents = (await Q(c, "SELECT record_id::text AS id,count(*) AS n FROM suite.documents WHERE school_id=@s GROUP BY record_id", ("s", a.School))).ToDictionary(r => Text(r, "id"), r => (int)Number(r, "n"));
            var required = (await DocumentList(c, a.School)).Where(x => x.required).Select(x => x.key).ToList(); var (classes, years) = await ClassesAndYears(c, a.School);
            var rows = new List<JsonObject>();
            foreach (var r in all.Where(r => (string.IsNullOrEmpty(status) || AdmissionRules.Status(Text(r, "status")) == status) && (string.IsNullOrEmpty(yearId) || Text(r, "yearId") == yearId) && (string.IsNullOrEmpty(classId) || Text(r, "classId") == classId)
                && (string.IsNullOrWhiteSpace(search) || (Text(r, "firstName") + " " + Text(r, "lastName") + " " + Text(r, "applicationNumber") + " " + Text(r, "admissionNumber") + " " + Text(r, "guardianName") + " " + Text(r, "guardianEmail")).Contains(search.Trim(), StringComparison.OrdinalIgnoreCase)))
                .OrderByDescending(r => Text(r, "createdAt")))
            {
                var checks = r["onboarding"]?["documents"] as JsonObject; var verified = required.Count(k => Text(checks?[k] as JsonObject ?? new(), "status") is "Verified" or "Not applicable");
                if (missingDocuments && verified == required.Count) continue;
                var v = AdmissionView(r, false, classes, years); v["documents"] = new JsonObject { ["required"] = required.Count, ["verified"] = verified, ["files"] = documents.GetValueOrDefault(Text(r, "id")) };
                v["duplicates"] = AdmissionRules.Closed(Text(r, "status")) ? 0 : (await DuplicatesOf(c, a, r, Text(r, "id"), all, students)).Count;
                rows.Add(v);
            }
            return Results.Ok(new { data = new { counts, total = rows.Count, page, pageSize = 25, items = new JsonArray(rows.Skip((page - 1) * 25).Take(25).Select(x => (JsonNode)x).ToArray()), canApprove = a.Can("admissions.approve"), canManage = a.Can("admissions.manage"), canOnboard = a.Can("onboarding.manage") } });
        });
        // One application with its history, possible duplicates, checklist and form.
        group.MapGet("/admissions/{id:guid}", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await AdmissionsOffice(c, http); var d = await Get(c, a.School, "admissions", id);
            var (classes, years) = await ClassesAndYears(c, a.School); var v = AdmissionView(d, true, classes, years); var (checklist, blockers) = await Checklist(c, a, d, id);
            v["duplicates"] = await DuplicatesOf(c, a, d, id.ToString()); v["onboarding"] = checklist; v["started"] = d["onboarding"] is JsonObject;
            v["form"] = new JsonArray((await FormFields(c, a.School)).Select(f => (JsonNode)new JsonObject { ["key"] = Text(f, "key"), ["label"] = Text(f, "label"), ["type"] = Text(f, "type"), ["options"] = Text(f, "options"), ["required"] = Text(f, "required") == "Yes" }).ToArray());
            return Results.Ok(new { data = v });
        });
        // A decision: submit, review, approve, waitlist, reject or withdraw, with the reason where one is needed.
        group.MapPost("/admissions/{id:guid}/transition", async (Guid id, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await AdmissionsOffice(c, http); var to = Text(input, "to"); var reason = Text(input, "reason"); Require(reason.Length <= 1000, "The reason is too long.");
            await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
            var record = await Get(c, a.School, "admissions", id); var from = AdmissionRules.Status(Text(record, "status"));
            var problem = AdmissionRules.TransitionProblem(from, to, a.Can("admissions.manage"), a.Can("admissions.approve"), reason); Require(problem is null, problem?.message ?? "", problem?.status ?? 409);
            if (from == to) return Results.Ok(new { data = new { id, status = to, changed = false } });
            var d = Clean(record);
            if (to == "Submitted") foreach (var f in (await FormFields(c, a.School)).Where(f => Text(f, "type") != "Document")) { var p = AdmissionRules.AnswerProblem(Text(f, "label"), Text(f, "type"), Text(f, "options"), Text(f, "required") == "Yes", (d["answers"] as JsonObject)?[Text(f, "key")]); Require(p is null, p ?? ""); }
            if (to == "Approved")
            {
                var duplicates = await DuplicatesOf(c, a, d, id.ToString());
                Require(duplicates.Count == 0 || input["acknowledgeDuplicates"]?.GetValue<bool>() == true, duplicates.Count + " possible duplicate(s) found. Review them and confirm before approving.", 409);
            }
            d["status"] = to; Remember(d, a, from, to, reason);
            if (to == "Submitted") d["submittedAt"] = DateTime.UtcNow.ToString("o");
            if (to is "Approved" or "Rejected" or "Waitlisted") { d["decidedBy"] = a.User.ToString(); d["decidedAt"] = DateTime.UtcNow.ToString("o"); }
            await WriteAdmission(c, a, id, d, VersionOf(input, record)); await tx.CommitAsync();
            await AnnounceAdmission(a, to == "Submitted" ? "admission.submitted" : to == "Approved" ? "admission.approved" : null, id, d);
            return Results.Ok(new { data = new { id, status = to, changed = true } });
        });
        // Start onboarding: the approved application becomes a plan. Nothing is created yet; a second start changes nothing.
        group.MapPost("/admissions/{id:guid}/onboarding/start", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await AdmissionsOffice(c, http); Require(a.Can("onboarding.manage"), "Onboarding is handled by the school office.", 403);
            await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
            var record = await Get(c, a.School, "admissions", id); var status = AdmissionRules.Status(Text(record, "status"));
            if (AdmissionRules.InOnboarding(status) || status == "Active") return Results.Ok(new { data = new { id, status, started = false } });
            Require(status == "Approved", "Only an approved application can start onboarding.", 409);
            var d = Clean(record);
            // A guardian already on file is suggested only when the application names their email or phone exactly.
            var known = (await Q(c, "SELECT id::text AS id,email,coalesce(phone_number,'') AS phone FROM parent_db.parents WHERE school_id=@s AND deleted_at IS NULL", ("s", a.School))).Where(p => AdmissionRules.ContactMatches(Text(d, "guardianEmail"), Text(d, "guardianPhone"), Text(p, "email"), Text(p, "phone"))).ToList();
            d["onboarding"] = new JsonObject
            {
                ["startedAt"] = DateTime.UtcNow.ToString("o"), ["startedBy"] = a.User.ToString(), ["detailsConfirmed"] = false,
                ["guardian"] = new JsonObject { ["mode"] = known.Count == 1 ? "existing" : "new", ["parentId"] = known.Count == 1 ? Text(known[0], "id") : "", ["relationship"] = Text(d, "guardianRelationship"), ["confirmed"] = false },
                ["documents"] = new JsonObject(), ["academics"] = new JsonObject { ["classId"] = Text(d, "classId") }, ["fees"] = new JsonObject { ["mode"] = "", ["structureIds"] = new JsonArray() }, ["accounts"] = new JsonObject(),
            };
            d["status"] = "Onboarding"; Remember(d, a, status, "Onboarding", "");
            await WriteAdmission(c, a, id, d, (int)Number(record, "version")); await tx.CommitAsync();
            return Results.Ok(new { data = new { id, status = "Onboarding", started = true } });
        });
        // One section of the plan: details, guardian, a document check, academics, fees or accounts. The readiness follows.
        group.MapPut("/admissions/{id:guid}/onboarding", async (Guid id, JsonObject input, HttpContext http) =>
        {
            await using var c = await Open(); var a = await AdmissionsOffice(c, http); Require(a.Can("onboarding.manage"), "Onboarding is handled by the school office.", 403);
            await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
            var record = await Get(c, a.School, "admissions", id); var status = AdmissionRules.Status(Text(record, "status"));
            Require(AdmissionRules.InOnboarding(status), "Start onboarding before changing it.", 409);
            var d = Clean(record); var plan = (JsonObject)d["onboarding"]!; var section = Text(input, "section"); var stamp = new JsonObject { ["by"] = a.User.ToString(), ["at"] = DateTime.UtcNow.ToString("o") };
            switch (section)
            {
                case "details":
                    var number = Text(input, "admissionNumber"); Require(number.Length <= 50, "The admission number is too long.");
                    if (number != "")
                    {
                        Require(!(await Records(c, a.School, "admissions")).Any(p => Text(p, "id") != id.ToString() && string.Equals(Text(p, "admissionNumber"), number, StringComparison.OrdinalIgnoreCase)), "This admission number is already used by another application.", 409);
                        Require((await Q(c, "SELECT id FROM student_db.students WHERE school_id=@s AND lower(roll_number)=lower(@n) AND deleted_at IS NULL", ("s", a.School), ("n", number))).Count == 0, "This admission number belongs to another student.", 409);
                        d["admissionNumber"] = number;
                    }
                    plan["detailsConfirmed"] = input["confirmed"]?.GetValue<bool>() == true; break;
                case "guardian":
                    var mode = Text(input, "mode"); Require(mode is "existing" or "new", "Choose an existing guardian or a new one."); var relationship = Text(input, "relationship");
                    Require(AdmissionRules.Relationships.Contains(relationship), "Choose the guardian's relationship.");
                    var guardian = new JsonObject { ["mode"] = mode, ["parentId"] = "", ["relationship"] = relationship, ["confirmed"] = input["confirmed"]?.GetValue<bool>() == true };
                    if (mode == "existing")
                    {
                        // Only a guardian of this school whose email or phone is the one on the application: never a name match.
                        var parent = (await Q(c, "SELECT id::text AS id,email,coalesce(phone_number,'') AS phone FROM parent_db.parents WHERE id=@id AND school_id=@s AND deleted_at IS NULL", ("id", Id(input, "parentId")), ("s", a.School))).FirstOrDefault();
                        Require(parent is not null, "Guardian not found in this school.", 404);
                        Require(AdmissionRules.ContactMatches(Text(d, "guardianEmail"), Text(d, "guardianPhone"), Text(parent!, "email"), Text(parent!, "phone")), "Only a guardian whose email or phone matches the application can be linked.");
                        guardian["parentId"] = Text(parent!, "id");
                    }
                    plan["guardian"] = guardian; d["guardianRelationship"] = relationship; break;
                case "documents":
                    var key = Text(input, "key"); var docStatus = Text(input, "status"); var note = Text(input, "note"); Require(note.Length <= 500, "The note is too long.");
                    var list = await DocumentList(c, a.School); Require(list.Any(x => x.key == key), "Unknown document.");
                    Require(AdmissionRules.DocumentStatuses.Contains(docStatus), "Choose a document status.");
                    if (docStatus == "Verified") Require((await Q(c, "SELECT id FROM suite.documents WHERE school_id=@s AND record_id=@r LIMIT 1", ("s", a.School), ("r", id))).Count > 0, "Upload the document before verifying it.");
                    if (docStatus is "Rejected" or "Not applicable") Require(note != "", "Add a note explaining this.");
                    var checks = plan["documents"] as JsonObject ?? new JsonObject(); plan["documents"] = checks; stamp["status"] = docStatus; stamp["note"] = note; checks[key] = stamp; break;
                case "academics":
                    var cls = await Get(c, a.School, "classes", Id(input, "classId"));
                    Require(Text(d, "yearId") == "" || Text(cls, "yearId") == Text(d, "yearId"), "That class belongs to another academic year.");
                    plan["academics"] = new JsonObject { ["classId"] = Text(cls, "id") };
                    // Fee structures follow the class: a change of class clears structures chosen for the old one.
                    if (plan["fees"] is JsonObject oldFees && Text(oldFees, "mode") == "assign") plan["fees"] = new JsonObject { ["mode"] = "", ["structureIds"] = new JsonArray() };
                    break;
                case "fees":
                    var feeMode = Text(input, "mode"); Require(feeMode is "assign" or "none", "Choose fee structures or record that none apply.");
                    if (feeMode == "none") { var why = Text(input, "reason"); Require(why != "" && why.Length <= 500, "Give a reason why no fees apply."); plan["fees"] = new JsonObject { ["mode"] = "none", ["reason"] = why, ["structureIds"] = new JsonArray() }; break; }
                    Require(a.Can("fees.manage"), "Assigning fees needs fee management access.", 403);
                    Require(input["structureIds"] is JsonArray, "Choose the fee structures.");
                    var ids = input["structureIds"]!.AsArray().Select(x => x?.ToString() ?? "").Distinct().ToList(); Require(ids.Count is > 0 and <= 24, "Choose between 1 and 24 fee structures.");
                    var planned = Text(plan["academics"] as JsonObject ?? new(), "classId");
                    foreach (var sid in ids) { var st = await Get(c, a.School, "fee-structures", Guid.TryParse(sid, out var g) ? g : Guid.Empty); Require(Text(st, "classId") == planned && Text(st, "studentId") == "", "Choose fee structures of the chosen class."); }
                    plan["fees"] = new JsonObject { ["mode"] = "assign", ["reason"] = "", ["structureIds"] = new JsonArray(ids.Select(x => (JsonNode)x).ToArray()) }; break;
                case "accounts":
                    var accounts = new JsonObject();
                    foreach (var (field, scope, email) in new[] { ("parentUserId", "parent", Text(d, "guardianEmail")), ("studentUserId", "student", Text(d, "email")) })
                    {
                        var userId = Text(input, field); if (userId == "") continue;
                        var problem = await AccountProblem(c, a.School, userId, scope, email, Text(d, "studentId")); Require(problem is null, problem is null ? "" : char.ToUpperInvariant(problem[0]) + problem[1..] + ".");
                        accounts[field] = userId;
                    }
                    plan["accounts"] = accounts; break;
                default: throw new SuiteError(400, "Unknown onboarding section.");
            }
            var (view, blockers) = await Checklist(c, a, d, id); var next = blockers.Count == 0 ? "Ready" : "Onboarding";
            if (next != status) Remember(d, a, status, next, "");
            d["status"] = next; await WriteAdmission(c, a, id, d, VersionOf(input, record)); await tx.CommitAsync();
            if (next == "Ready" && status != "Ready") await AnnounceAdmission(a, "onboarding.ready", id, d);
            return Results.Ok(new { data = new { id, status = next, onboarding = view } });
        });
        // Existing guardians and accounts that may be linked: only those whose email or phone is on the application.
        group.MapGet("/admissions/{id:guid}/candidates", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await AdmissionsOffice(c, http); var d = await Get(c, a.School, "admissions", id);
            var guardians = (await Q(c, """
                SELECT p.id::text AS id,p.first_name || ' ' || p.last_name AS name,p.email,coalesce(p.phone_number,'') AS phone,(SELECT count(*) FROM student_db.students s WHERE s.school_id=p.school_id AND s.parent_guardian_id=p.id AND s.deleted_at IS NULL) AS children
                FROM parent_db.parents p WHERE p.school_id=@s AND p.deleted_at IS NULL
                """, ("s", a.School))).Where(p => AdmissionRules.ContactMatches(Text(d, "guardianEmail"), Text(d, "guardianPhone"), Text(p, "email"), Text(p, "phone"))).ToList();
            var users = await Q(c, "SELECT u.id::text AS id,u.first_name || ' ' || u.last_name AS name,u.email,t.data_scope AS scope FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id JOIN auth_db.role_templates t ON t.id=r.template_id WHERE u.school_id=@s AND u.deleted_at IS NULL AND u.is_active AND lower(u.email)=ANY(@emails)",
                ("s", a.School), ("emails", new[] { Text(d, "guardianEmail").ToLowerInvariant(), Text(d, "email").ToLowerInvariant() }));
            return Results.Ok(new { data = new { guardians = new JsonArray(guardians.Select(g => (JsonNode)g).ToArray()), users = new JsonArray(users.Where(u => Text(u, "scope") is "parent" or "student").Select(u => (JsonNode)u).ToArray()) } });
        });
        // Activate: the whole plan at once. Guardian, student, enrolment, charges and account links are created together or not at all.
        group.MapPost("/admissions/{id:guid}/activate", async (Guid id, HttpContext http) => await Activate(id, http, false));
    }

    static async Task<IResult> Activate(Guid id, HttpContext http, bool express)
    {
        await using var c = await Open(); var a = await AdmissionsOffice(c, http); Require(a.Can("onboarding.manage"), "Activation is handled by the school office.", 403);
        await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
        var record = await Get(c, a.School, "admissions", id); var status = AdmissionRules.Status(Text(record, "status"));
        if (status == "Active") { Require(!express, "This application has already been accepted.", 409); return Results.Ok(new { data = new { studentId = Text(record, "studentId"), status, activated = false } }); }
        var d = Clean(record);
        if (express)
        {
            // The pre-2.0 express acceptance, kept for schools that admit in one step: a submitted or approved application,
            // its guardian matched by email, its class, no fees or accounts. It needs the same permissions as onboarding.
            Require(status is "Submitted" or "Approved", "Submit this application before accepting it.", 409); Require(a.Can("admissions.approve"), "Accepting an application needs the approve permission.", 403);
            var known = (await Q(c, "SELECT id::text AS id FROM parent_db.parents WHERE school_id=@s AND email=@e AND deleted_at IS NULL", ("s", a.School), ("e", Text(d, "guardianEmail")))).FirstOrDefault();
            d["onboarding"] = new JsonObject { ["express"] = true, ["guardian"] = new JsonObject { ["mode"] = known is null ? "new" : "existing", ["parentId"] = known is null ? "" : Text(known, "id"), ["relationship"] = Text(d, "guardianRelationship") }, ["academics"] = new JsonObject { ["classId"] = Text(d, "classId") }, ["fees"] = new JsonObject { ["mode"] = "none" }, ["accounts"] = new JsonObject() };
        }
        else
        {
            Require(status == "Ready", "Complete onboarding before activating the student.", 409);
            var (_, blockers) = await Checklist(c, a, d, id); Require(blockers.Count == 0, "Activation is blocked. " + string.Join(" ", blockers.Take(3)), 409);
        }
        var plan = (JsonObject)d["onboarding"]!; var guardian = plan["guardian"] as JsonObject ?? new(); var classId = Guid.Parse(Text(plan["academics"] as JsonObject ?? new(), "classId"));
        // Guardian: the one on file, or one found by the application's email at this moment, or a new one.
        Guid parentId;
        if (Text(guardian, "mode") == "existing" && Guid.TryParse(Text(guardian, "parentId"), out var chosen)) parentId = chosen;
        else
        {
            var found = (await Q(c, "SELECT id FROM parent_db.parents WHERE school_id=@s AND lower(email)=lower(@e) AND deleted_at IS NULL", ("s", a.School), ("e", Text(d, "guardianEmail")))).FirstOrDefault();
            parentId = found is null ? Guid.NewGuid() : Guid.Parse(Text(found, "id"));
            if (found is null) { var parts = Text(d, "guardianName").Split(' ', 2); await E(c, "INSERT INTO parent_db.parents(id,school_id,first_name,last_name,email,phone_number) VALUES(@id,@s,@first,@last,@email,@phone)", ("id", parentId), ("s", a.School), ("first", parts[0]), ("last", parts.Length > 1 ? parts[1] : "Guardian"), ("email", Text(d, "guardianEmail")), ("phone", Text(d, "guardianPhone"))); }
        }
        // Student: the admission number chosen, the one entered with the application, or the next in the school's series.
        var number = Text(d, "admissionNumber"); if (number == "") number = await NextNumber(c, a.School, "admission", "ADM");
        Require((await Q(c, "SELECT id FROM student_db.students WHERE school_id=@s AND (lower(roll_number)=lower(@n) OR lower(email)=lower(@e)) AND deleted_at IS NULL", ("s", a.School), ("n", number), ("e", Text(d, "email")))).Count == 0, "A student with this admission number or email already exists.", 409);
        var studentId = Guid.NewGuid();
        await E(c, "INSERT INTO student_db.students(id,school_id,roll_number,first_name,last_name,date_of_birth,gender,email,phone_number,address,admission_date,status,parent_guardian_id) VALUES(@id,@s,@no,@first,@last,@dob,@gender,@email,@phone,@address,CURRENT_DATE,'Active',@parent)",
            ("id", studentId), ("s", a.School), ("no", number), ("first", Text(d, "firstName")), ("last", Text(d, "lastName")), ("dob", Day(d, "dateOfBirth")), ("gender", Text(d, "gender")), ("email", Text(d, "email")), ("phone", Text(d, "phoneNumber")), ("address", Text(d, "address")), ("parent", parentId));
        // Enrolment: the class's capacity is checked again here, under the lock.
        await Allocate(c, a, studentId, classId);
        // Fees: one charge per chosen structure, issued exactly as the Fees office issues them.
        var charges = new List<(Guid id, long net, string currency, DateOnly due)>(); var fees = plan["fees"] as JsonObject ?? new();
        if (Text(fees, "mode") == "assign")
        {
            Require(a.Can("fees.manage"), "Assigning fees needs fee management access.", 403);
            foreach (var sid in (fees["structureIds"] as JsonArray ?? []).Select(x => x?.ToString() ?? ""))
            {
                var structure = await Get(c, a.School, "fee-structures", Guid.Parse(sid)); Require(Text(structure, "classId") == classId.ToString(), "A chosen fee structure does not belong to the class.", 409);
                var (cid, net, currency) = await IssueCharge(c, a, studentId, structure, 0, "Issued at admission " + Text(d, "applicationNumber")); charges.Add((cid, net, currency, Day(structure, "dueDate")));
            }
        }
        // Accounts: links through the same account-link records, with the account's sessions revoked so the new access applies.
        var accounts = plan["accounts"] as JsonObject ?? new();
        foreach (var (field, relationship, scope, email) in new[] { ("parentUserId", "parent", "parent", Text(d, "guardianEmail")), ("studentUserId", "student", "student", Text(d, "email")) })
        {
            var userId = Text(accounts, field); if (userId == "") continue;
            var problem = await AccountProblem(c, a.School, userId, scope, email, studentId.ToString()); Require(problem is null, "Account linking failed: " + problem + ".", 409);
            var link = new JsonObject { ["userId"] = userId, ["studentId"] = studentId.ToString(), ["teacherId"] = "", ["relationship"] = relationship };
            await E(c, "INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES(@id,@s,'account-links',@d::jsonb,@u,@u)", ("id", Guid.NewGuid()), ("s", a.School), ("d", link.ToJsonString()), ("u", a.User));
            await E(c, "UPDATE auth_db.users SET token_version=token_version+1 WHERE id=@id AND school_id=@s", ("id", Guid.Parse(userId)), ("s", a.School));
            await E(c, "UPDATE auth_db.refresh_tokens SET revoked_at=now() WHERE user_id=@id AND school_id=@s AND revoked_at IS NULL", ("id", Guid.Parse(userId)), ("s", a.School));
            await E(c, "INSERT INTO auth_db.iam_audit(school_id,actor_id,actor_role,action,target_id,old_value,new_value) VALUES(@s,@u,@r,'profile.linked',@id,'null'::jsonb,@new::jsonb)", ("s", a.School), ("u", a.User), ("r", http.GetTenant().Role), ("id", Guid.Parse(userId)), ("new", link.ToJsonString()));
        }
        d["status"] = "Active"; d["studentId"] = studentId.ToString(); d["parentId"] = parentId.ToString(); d["admissionNumber"] = number; d["activatedAt"] = DateTime.UtcNow.ToString("o"); d["activatedBy"] = a.User.ToString();
        Remember(d, a, status, "Active", express ? "Express acceptance" : "");
        await WriteAdmission(c, a, id, d, (int)Number(record, "version")); await tx.CommitAsync();
        foreach (var (cid, net, currency, due) in charges) await AnnounceCharge(a, cid, studentId, net, currency, due);
        await AnnounceAdmission(a, "student.activated", id, d);
        return Results.Ok(new { data = new { studentId, status = "Active", activated = true } });
    }

    /// <summary>Admission notifications: the approvers hear of a submission, the office of an approval or a ready plan, the family of activation.</summary>
    static async Task AnnounceAdmission(SchoolAccess a, string? key, Guid id, JsonObject d)
    {
        if (key is null) return;
        try
        {
            await using var c = await Open();
            var cls = (await Records(c, a.School, "classes")).FirstOrDefault(x => Text(x, "id") == Text(d, "classId"));
            var values = new Dictionary<string, string?> { ["studentName"] = Text(d, "firstName") + " " + Text(d, "lastName"), ["className"] = cls is null ? "" : Label("classes", cls), ["reference"] = Text(d, "applicationNumber"), ["date"] = NotificationTemplates.Day(DateTime.UtcNow.ToString("yyyy-MM-dd")), ["schoolName"] = await SchoolName(c, a.School) };
            var recipients = key switch
            {
                "admission.submitted" => await UsersWith(c, a.School, "admissions.approve", ["school"]),
                "admission.approved" or "onboarding.ready" => await UsersWith(c, a.School, "onboarding.manage", ["school"]),
                _ => Guid.TryParse(Text(d, "studentId"), out var student) ? (await GuardiansOf(c, a.School, [student], "reports.view", "student")).GetValueOrDefault(student) ?? [] : [],
            };
            await Send(c, a.School, key, NotificationRules.EventKey(key, id), values, id, recipients, a.User, "suite.admissions");
        }
        catch (Exception ex) { Serilog.Log.Warning(ex, "Admission notification {Key} for {Id} was not created", key, id); }
    }

    /// <summary>What Student 360 shows of how a student joined: numbers, dates and document checks. Never review notes, reasons or history.</summary>
    static async Task<JsonObject> AdmissionSummary(NpgsqlConnection c, SchoolAccess a, Guid student)
    {
        var d = (await Records(c, a.School, "admissions")).FirstOrDefault(r => Text(r, "studentId") == student.ToString());
        if (d is null) return new JsonObject { ["available"] = false };
        var summary = new JsonObject { ["available"] = true, ["admissionNumber"] = Text(d, "admissionNumber"), ["admittedOn"] = Text(d, "activatedAt") == "" ? "" : Text(d, "activatedAt")[..10] };
        if (a.Role == "Teacher") return summary;
        var required = (await DocumentList(c, a.School)).Where(x => x.required).Select(x => x.key).ToList(); var checks = d["onboarding"]?["documents"] as JsonObject;
        summary["applicationNumber"] = Text(d, "applicationNumber"); summary["status"] = AdmissionRules.Status(Text(d, "status"));
        summary["documentsVerified"] = required.Count(k => Text(checks?[k] as JsonObject ?? new(), "status") is "Verified" or "Not applicable"); summary["documentsRequired"] = required.Count;
        return summary;
    }
}

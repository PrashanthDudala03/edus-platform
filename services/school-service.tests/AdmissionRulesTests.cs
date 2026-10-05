using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;

// Admissions 2.0 and Student Onboarding 2.0 rules: the lifecycle and who may move it, the admission form's answers,
// duplicate matching that never relies on a name alone, guardian linking by contact only, and what blocks activation.
// Plus source guards: every statement names the school, activation is one locked transaction, and Student 360 never
// carries review notes or decision reasons.
public class AdmissionRulesTests
{
    [Fact]
    public void TheLifecycleIsExplicitAndApprovalNeverMeansActive()
    {
        Assert.Equal(new[] { "Draft", "Submitted", "Under Review", "Approved", "Waitlisted", "Rejected", "Withdrawn", "Onboarding", "Ready", "Active" }, AdmissionRules.Statuses);
        Assert.Null(AdmissionRules.TransitionProblem("Draft", "Submitted", true, false, ""));
        Assert.Null(AdmissionRules.TransitionProblem("Submitted", "Under Review", true, false, "")); Assert.Null(AdmissionRules.TransitionProblem("Submitted", "Under Review", false, true, ""));
        Assert.Null(AdmissionRules.TransitionProblem("Under Review", "Approved", false, true, ""));
        Assert.Null(AdmissionRules.TransitionProblem("Under Review", "Waitlisted", false, true, "Class is full"));
        Assert.Null(AdmissionRules.TransitionProblem("Waitlisted", "Approved", false, true, ""));
        // Onboarding, Ready and Active are reached by onboarding operations, never by a decision.
        foreach (var to in new[] { "Onboarding", "Ready", "Active", "Accepted", "anything" }) Assert.Equal(400, AdmissionRules.TransitionProblem("Approved", to, true, true, "x")!.Value.status);
        Assert.Equal(409, AdmissionRules.TransitionProblem("Draft", "Approved", true, true, "")!.Value.status);
        Assert.Equal(409, AdmissionRules.TransitionProblem("Rejected", "Under Review", true, true, "")!.Value.status);
        Assert.Equal(409, AdmissionRules.TransitionProblem("Active", "Withdrawn", true, true, "Moved away")!.Value.status);
        Assert.Equal(409, AdmissionRules.TransitionProblem("Accepted", "Rejected", true, true, "x")!.Value.status);
        Assert.Null(AdmissionRules.TransitionProblem("Approved", "Approved", false, false, ""));
    }

    [Fact]
    public void OnlyApproversDecideAndReasonsAreRequiredWhereTheyMatter()
    {
        Assert.Equal(("Only an admissions approver can make this decision.", 403), AdmissionRules.TransitionProblem("Under Review", "Approved", true, false, ""));
        Assert.Equal(403, AdmissionRules.TransitionProblem("Submitted", "Rejected", true, false, "Incomplete")!.Value.status);
        Assert.Equal(("Your role cannot change this application.", 403), AdmissionRules.TransitionProblem("Under Review", "Withdrawn", false, true, "Family moved"));
        Assert.Equal(("Give a reason for this decision.", 400), AdmissionRules.TransitionProblem("Under Review", "Rejected", true, true, " "));
        Assert.Equal(400, AdmissionRules.TransitionProblem("Under Review", "Waitlisted", true, true, "")!.Value.status);
        Assert.Equal(400, AdmissionRules.TransitionProblem("Approved", "Withdrawn", true, true, "")!.Value.status);
        Assert.True(AdmissionRules.Closed("Active")); Assert.True(AdmissionRules.Closed("Accepted")); Assert.True(AdmissionRules.Closed("Rejected")); Assert.False(AdmissionRules.Closed("Approved"));
        Assert.True(AdmissionRules.InOnboarding("Ready")); Assert.False(AdmissionRules.InOnboarding("Approved"));
        Assert.Equal("Active", AdmissionRules.Status("Accepted")); Assert.Equal("Draft", AdmissionRules.Status(""));
    }

    [Fact]
    public void FormAnswersFollowTheQuestionType()
    {
        Assert.Null(AdmissionRules.AnswerProblem("Blood group", "Dropdown", "A+, B+, O+", true, JsonValue.Create("O+")));
        Assert.Equal("Choose Blood group from the listed options.", AdmissionRules.AnswerProblem("Blood group", "Dropdown", "A+, B+, O+", true, JsonValue.Create("Z")));
        Assert.Equal("Blood group is required.", AdmissionRules.AnswerProblem("Blood group", "Dropdown", "A+, B+", true, null));
        Assert.Null(AdmissionRules.AnswerProblem("Blood group", "Dropdown", "A+, B+", false, null));
        Assert.Null(AdmissionRules.AnswerProblem("Languages", "Multiple choice", "English, Hindi, Tamil", true, new JsonArray("English", "Tamil")));
        Assert.NotNull(AdmissionRules.AnswerProblem("Languages", "Multiple choice", "English, Hindi", true, new JsonArray("English", "English")));
        Assert.NotNull(AdmissionRules.AnswerProblem("Languages", "Multiple choice", "English, Hindi", true, JsonValue.Create("English")));
        Assert.Equal("Consent must be confirmed.", AdmissionRules.AnswerProblem("Consent", "Checkbox", "", true, JsonValue.Create(false)));
        Assert.Null(AdmissionRules.AnswerProblem("Consent", "Checkbox", "", true, JsonValue.Create(true)));
        Assert.NotNull(AdmissionRules.AnswerProblem("Siblings", "Number", "", false, JsonValue.Create("two"))); Assert.Null(AdmissionRules.AnswerProblem("Siblings", "Number", "", false, JsonValue.Create("2")));
        Assert.NotNull(AdmissionRules.AnswerProblem("Last attended", "Date", "", false, JsonValue.Create("05/10/2026")));
        Assert.Null(AdmissionRules.AnswerProblem("Photo", "Document", "", true, null));
        Assert.NotNull(AdmissionRules.AnswerProblem("Note", "Text", "", false, JsonValue.Create(new string('x', 256))));
        Assert.True(AdmissionRules.ValidKey("blood-group")); Assert.False(AdmissionRules.ValidKey("Blood Group")); Assert.False(AdmissionRules.ValidKey("__proto__"));
    }

    [Fact]
    public void DuplicatesNeedMoreThanANameAndSiblingsAreNotDuplicates()
    {
        var a = new AdmissionRules.Applicant("Aarav", "Sharma", "2014-03-12", "aarav@example.test", "neha@example.test", "+91 98765 43210", "");
        Assert.Equal(new[] { "Same name and date of birth" }, AdmissionRules.DuplicateReasons(a, new("aarav ", "SHARMA", "2014-03-12", "", "", "", "")));
        Assert.Empty(AdmissionRules.DuplicateReasons(a, new("Aarav", "Sharma", "2015-01-01", "", "", "", "")));
        // A sibling shares the guardian but not the first name.
        Assert.Empty(AdmissionRules.DuplicateReasons(a, new("Diya", "Sharma", "2016-07-01", "diya@example.test", "NEHA@example.test", "9876543210", "")));
        Assert.Equal(new[] { "Same first name and guardian contact" }, AdmissionRules.DuplicateReasons(a, new("Aarav", "S", "2014-03-13", "", "", "098765-43210", "")));
        Assert.Contains("Same student email", AdmissionRules.DuplicateReasons(a, new("A", "B", "", "AARAV@example.test", "", "", "")));
        Assert.Contains("Same admission number", AdmissionRules.DuplicateReasons(a with { Number = "ADM-7" }, new("X", "Y", "", "", "", "", "adm-7")));
        Assert.Equal("9876543210", AdmissionRules.Digits("+91 98765-43210"));
    }

    [Fact]
    public void AGuardianIsLinkedByContactNeverByName()
    {
        Assert.True(AdmissionRules.ContactMatches("Neha@Example.test", "", "neha@example.test", ""));
        Assert.True(AdmissionRules.ContactMatches("", "+91 98765 43210", "x@y.test", "9876543210"));
        Assert.False(AdmissionRules.ContactMatches("neha@example.test", "98765", "other@example.test", "98765"));
        Assert.False(AdmissionRules.ContactMatches("", "", "", ""));
    }

    [Fact]
    public void RequiredStepsBlockActivationAndAccountsNeverDo()
    {
        var steps = new[] { ("details", "Applicant", true, true, ""), ("guardian", "Guardian", false, true, "confirm the guardian"), ("documents", "Documents", false, true, "Birth certificate not verified"), ("accounts", "Accounts", false, false, "optional") };
        Assert.Equal(new[] { "Guardian: confirm the guardian", "Documents: Birth certificate not verified" }, AdmissionRules.Blockers(steps));
        Assert.Empty(AdmissionRules.Blockers([("accounts", "Accounts", false, false, "optional")]));
        Assert.Equal(new[] { ("birth-certificate", "Birth certificate", true), ("address-proof", "Proof of address", true), ("transfer-certificate", "Previous school transfer certificate", false) }, AdmissionRules.DefaultDocuments);
    }

    [Fact]
    public void EveryAdmissionStatementNamesTheSchoolAndActivationIsOneLockedTransaction()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Admissions.cs"));
        var uses = Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(suite\.\w+|student_db\.students|parent_db\.parents|auth_db\.\w+)").ToList();
        Assert.True(uses.Count >= 12);
        foreach (Match use in uses)
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            Assert.True(Regex.IsMatch(sql, @"school_id=(@s|p\.school_id|s\.school_id)|VALUES\(@id,@s|VALUES\(@s,"), $"not bound to the school: {sql[..Math.Min(100, sql.Length)]}");
        }
        // Activation: the school lock, then the guardian, student, enrolment, charges and links, then one commit.
        var activate = text[text.IndexOf("static async Task<IResult> Activate")..text.IndexOf("static async Task AnnounceAdmission")];
        Assert.True(activate.IndexOf("pg_advisory_xact_lock") < activate.IndexOf("INSERT INTO student_db.students"));
        Assert.True(activate.IndexOf("INSERT INTO student_db.students") < activate.IndexOf("await Allocate(") && activate.IndexOf("await Allocate(") < activate.IndexOf("IssueCharge(") && activate.IndexOf("IssueCharge(") < activate.IndexOf("tx.CommitAsync()"));
        Assert.Contains("if (status == \"Active\")", activate); Assert.Contains("Require(blockers.Count == 0", activate);
        // Approval does not create anything: onboarding start only writes the plan.
        var start = text[text.IndexOf("/onboarding/start")..text.IndexOf("group.MapPut(\"/admissions/{id:guid}/onboarding\"")];
        Assert.DoesNotContain("INSERT INTO", start);
        // Student 360 gets numbers and document counts only: no review notes, reasons or history.
        var summary = text[text.IndexOf("static async Task<JsonObject> AdmissionSummary")..];
        Assert.DoesNotContain("reviewNotes", summary); Assert.DoesNotContain("history", summary); Assert.DoesNotContain("reason", summary);
        // Office access is settled from the token before any lookup.
        Assert.Contains("Require(a.SchoolWide && a.Can(\"admissions.view\")", text);
    }
}

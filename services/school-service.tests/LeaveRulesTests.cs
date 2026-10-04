using System.Text.RegularExpressions;
using Xunit;

// Leave & Approvals 2.0 rules: how many days a request takes, which status moves are allowed and by whom, and what a
// balance comes to. Plus a source guard that every leave statement names the school and that decisions and balances
// are the server's alone.
public class LeaveRulesTests
{
    static readonly DateOnly Mon = new(2026, 10, 5), Wed = new(2026, 10, 7);

    [Fact]
    public void DaysAreInclusiveAndAHalfDayIsHalfOfOne()
    {
        Assert.Equal(3m, LeaveRules.Days(Mon, Wed, "No")); Assert.Equal(1m, LeaveRules.Days(Mon, Mon, "")); Assert.Equal(0.5m, LeaveRules.Days(Mon, Mon, "First half")); Assert.Equal(0.5m, LeaveRules.Days(Mon, Mon, "Second half"));
        Assert.Null(LeaveRules.SpanProblem(Mon, Wed, "No")); Assert.Equal("Leave end date must be on or after the start.", LeaveRules.SpanProblem(Wed, Mon, "No"));
        Assert.Equal("A half day is a single date.", LeaveRules.SpanProblem(Mon, Wed, "First half")); Assert.Equal("Leave cannot run for more than a year.", LeaveRules.SpanProblem(Mon, Mon.AddDays(400), "No"));
        Assert.True(LeaveRules.Covers(Mon, Wed, Mon.AddDays(1))); Assert.False(LeaveRules.Covers(Mon, Wed, Wed.AddDays(1)));
        Assert.Equal(new[] { "Pending", "Approved", "Rejected", "Cancelled" }, LeaveRules.Statuses); Assert.Equal(new[] { "No", "First half", "Second half" }, LeaveRules.HalfDays);
    }

    [Fact]
    public void OnlyApproversDecideAndOnlyPendingLeaveCanBeDecided()
    {
        Assert.Null(LeaveRules.TransitionProblem("", "Pending", false, true)); Assert.Equal(("New leave starts as Pending.", 409), LeaveRules.TransitionProblem("", "Approved", true, false));
        Assert.Null(LeaveRules.TransitionProblem("Pending", "Approved", true, false)); Assert.Null(LeaveRules.TransitionProblem("Pending", "Rejected", true, false));
        Assert.Equal(("Only school leadership can approve leave.", 403), LeaveRules.TransitionProblem("Pending", "Approved", false, true));
        Assert.Equal(("Only school leadership can approve leave.", 403), LeaveRules.TransitionProblem("Pending", "Rejected", false, false));
        // The staff member withdraws their own pending request; approved leave is cancelled by leadership only.
        Assert.Null(LeaveRules.TransitionProblem("Pending", "Cancelled", false, true)); Assert.Null(LeaveRules.TransitionProblem("Pending", "Cancelled", true, false));
        Assert.Equal(403, LeaveRules.TransitionProblem("Pending", "Cancelled", false, false)!.Value.status);
        Assert.Null(LeaveRules.TransitionProblem("Approved", "Cancelled", true, false)); Assert.Equal(403, LeaveRules.TransitionProblem("Approved", "Cancelled", false, true)!.Value.status);
        // Nothing comes back from a decision; the same status is an edit, judged by the field rules.
        Assert.Equal(("Leave that is rejected cannot become approved.", 409), LeaveRules.TransitionProblem("Rejected", "Approved", true, false));
        Assert.Equal(409, LeaveRules.TransitionProblem("Approved", "Pending", true, true)!.Value.status); Assert.Equal(409, LeaveRules.TransitionProblem("Cancelled", "Pending", true, true)!.Value.status);
        Assert.Null(LeaveRules.TransitionProblem("Approved", "Approved", false, true));
        Assert.True(LeaveRules.Locked("Approved")); Assert.True(LeaveRules.Locked("Rejected")); Assert.True(LeaveRules.Locked("Cancelled")); Assert.False(LeaveRules.Locked("Pending"));
        Assert.True(LeaveRules.Counts("Pending")); Assert.True(LeaveRules.Counts("Approved")); Assert.False(LeaveRules.Counts("Rejected")); Assert.False(LeaveRules.Counts("Cancelled"));
    }

    [Fact]
    public void ABalanceIsAllowancePlusAdjustmentsLessWhatWasTaken()
    {
        Assert.Equal(8.5m, LeaveRules.Remaining(12, 1.5m, 2, 3));
        Assert.Null(LeaveRules.BalanceProblem(true, 2, 2, "Casual leave")); Assert.Equal("Only 1.5 day(s) of Casual leave remain.", LeaveRules.BalanceProblem(true, 1.5m, 2, "Casual leave"));
        Assert.Null(LeaveRules.BalanceProblem(false, -4, 10, "Unpaid leave"));
        Assert.Equal(366, LeaveRules.MaxDaysPerYear);
    }

    [Fact]
    public void EveryLeaveStatementNamesTheSchoolAndTheServerAloneDecidesAndCounts()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Leave.cs"));
        foreach (Match use in Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(suite\.\w+|student_db\.students|teacher_db\.teachers)"))
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            Assert.True(sql.Contains("school_id=@s"), $"not bound to the school: {sql[..Math.Min(90, sql.Length)]}");
        }
        // Decisions and cancellations go through the ordinary record save (its rules, audit trigger and notifications); nothing writes records here.
        Assert.DoesNotContain("INSERT INTO", text); Assert.DoesNotContain("UPDATE suite", text); Assert.Contains("return await Save(\"leave-requests\", id, input, http);", text);
        // The approve permission is checked with the school-wide role, days are stamped by the server, and a rejection carries a reason.
        // Decided leave is refused as a lifecycle conflict before its new dates are validated: a far-off date on approved leave is 409, not 400.
        Assert.True(text.IndexOf("Decided leave cannot be edited") < text.IndexOf("LeaveRules.SpanProblem(from, to"), "the immutability check must come before the span validation");
        Assert.Contains("var approver = a.SchoolWide && a.Can(\"leave-requests.approve\");", text); Assert.Contains("d[\"days\"] = days;", text); Assert.Contains("Give a reason when rejecting leave.", text);
        // A teacher reads their own balance only; the office must name a staff member.
        Assert.Contains("Require(a.Teachers.Contains(teacherId), \"You may read your own balance only.\", 403);", text);
        Assert.Contains("Require(Readable(\"leave-requests\", leave, a), \"This leave is outside your scope.\", 403);", text);
    }
}

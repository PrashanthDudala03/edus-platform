using System.Text.RegularExpressions;
using Xunit;

// The daily register's rules: reasons, register states, who may correct, and low attendance. Plus a source guard that
// every attendance statement names the school, since the SQL has not run against a database here.
public class AttendanceRulesTests
{
    static readonly DateOnly Today = new(2026, 10, 5);

    [Fact]
    public void StatusesMatchTheRegisterAndReasonsAreAFixedList()
    {
        Assert.Equal(new[] { "Present", "Absent", "Late", "Excused" }, AttendanceRules.Statuses);
        Assert.Contains("Sick", AttendanceRules.Reasons); Assert.Contains("Approved leave", AttendanceRules.Reasons); Assert.Contains("Transport delay", AttendanceRules.Reasons); Assert.Contains("Other", AttendanceRules.Reasons);
        Assert.All(AttendanceRules.Reasons, reason => Assert.InRange(reason.Length, 1, 40));   // the column width
    }

    [Theory]
    [InlineData("Present", "", "", false, null)]
    [InlineData("Absent", "", "", false, null)]                       // a plain marking needs no reason
    [InlineData("Absent", "Sick", "", false, null)]
    [InlineData("Late", "Transport delay", "Bus broke down", false, null)]
    [InlineData("Absent", "", "", true, "Give a reason for the change.")]  // a correction always does
    [InlineData("Absent", "", "Spoke to the parent", true, null)]       // a remark alone is a reason for a correction
    [InlineData("Present", "Sick", "", false, "A reason goes with Absent, Late or Excused.")]
    [InlineData("Absent", "Holiday", "", false, "Choose a reason from the list.")]
    [InlineData("Absent", "Other", "", false, "Say what the reason is.")]
    [InlineData("Absent", "Other", "Family function", false, null)]
    public void ReasonsAreStructuredAndRequiredForCorrections(string status, string reason, string remark, bool correction, string? problem) =>
        Assert.Equal(problem, AttendanceRules.ReasonProblem(status, reason, remark, correction));

    [Fact]
    public void ALongRemarkIsRefused() => Assert.Contains("200", AttendanceRules.ReasonProblem("Absent", "Sick", new string('x', 201), false));

    [Theory]
    [InlineData(30, 0, null, "Not started")][InlineData(30, 12, null, "In progress")][InlineData(30, 30, null, "Marked")]
    [InlineData(30, 30, "Submitted", "Submitted")][InlineData(30, 30, "Corrected", "Corrected")][InlineData(0, 0, null, "Not started")]
    public void ARegisterHasOneStateLeadershipCanRead(int expected, int marked, string? submitted, string state) => Assert.Equal(state, AttendanceRules.RegisterState(expected, marked, submitted));

    [Fact]
    public void ASubmittedRegisterIsCorrectedByItsTeacherTheSameDayAndByTheOfficeAfterwards()
    {
        Assert.True(AttendanceRules.MayCorrect(false, Today, Today));
        Assert.False(AttendanceRules.MayCorrect(false, Today.AddDays(-1), Today));
        Assert.True(AttendanceRules.MayCorrect(true, Today.AddDays(-30), Today));
    }

    [Fact]
    public void AttendancePercentageAndLowAttendanceUseTheThreshold()
    {
        Assert.Equal(0, AttendanceRules.Percent(0, 0));
        Assert.Equal(90, AttendanceRules.Percent(18, 20));
        Assert.Equal(67, AttendanceRules.Percent(2, 3));
        Assert.True(AttendanceRules.Low(14, 0, 20, 75));
        Assert.False(AttendanceRules.Low(14, 1, 20, 75));    // late still counts as attended
        Assert.False(AttendanceRules.Low(0, 0, 0, 75));      // nothing marked is not low
        Assert.Equal(75, AttendanceRules.Threshold(null)); Assert.Equal(75, AttendanceRules.Threshold("0")); Assert.Equal(75, AttendanceRules.Threshold("abc")); Assert.Equal(80, AttendanceRules.Threshold("80"));
    }

    [Fact]
    public void EveryAttendanceStatementNamesTheSchool()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Attendance.cs"));
        var uses = Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(school_db\.attendance\w*|student_db\.students|notify\.notifications)").ToList();
        Assert.True(uses.Count >= 12);
        foreach (Match use in uses)
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            Assert.True(sql.Contains("school_id=@s") || sql.Contains("@s,") || sql.Contains("school_id=h.school_id") || sql.Contains("school_id=s.school_id"), $"not bound to the school: {sql[..Math.Min(90, sql.Length)]}");
        }
        var schema = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "AttendanceSchema.sql"));
        Assert.DoesNotMatch(@"(?i)\b(drop|truncate|delete from)\b", schema);
        Assert.Contains("PRIMARY KEY(school_id,day,class_name)", schema);
        Assert.Contains("kind varchar(12) NOT NULL CHECK(kind IN('submission','correction'))", schema);
    }
}

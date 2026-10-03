using System.Text.RegularExpressions;
using Xunit;

// Homework & assignments: lifecycle, the submission window, server-side lateness, the state a family sees, marks
// bounds, and a source guard that every homework statement names the school.
public class HomeworkRulesTests
{
    static readonly DateTime Noon = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void OldAssignmentsWithoutAStatusArePublished()
    {
        Assert.Equal("Published", HomeworkRules.Status(null)); Assert.Equal("Published", HomeworkRules.Status("")); Assert.Equal("Draft", HomeworkRules.Status("Draft"));
    }

    [Fact]
    public void SubmissionModesDecideWhoActsAndWhetherFilesAreAskedFor()
    {
        Assert.Equal("Text", HomeworkRules.Mode(null)); Assert.Equal("Text", HomeworkRules.Mode("Yes")); Assert.Equal("Done", HomeworkRules.Mode("Done")); Assert.Equal("Physical", HomeworkRules.Mode("Physical"));
        Assert.Equal(new[] { "None", "Done", "Text", "File", "Physical" }, HomeworkRules.Modes); Assert.Equal(new[] { "Completed", "Late", "Missing", "Excused" }, HomeworkRules.Outcomes);
        Assert.True(HomeworkRules.StudentSubmits("Done")); Assert.True(HomeworkRules.StudentSubmits("Text")); Assert.True(HomeworkRules.StudentSubmits("File"));
        Assert.False(HomeworkRules.StudentSubmits("None")); Assert.False(HomeworkRules.StudentSubmits("Physical"));
        Assert.False(HomeworkRules.Tracked("None")); Assert.True(HomeworkRules.Tracked("Physical")); Assert.True(HomeworkRules.Tracked("Done"));
        // Only written and uploaded work waits for a teacher; a tap-to-confirm or an in-class check is complete as it stands.
        Assert.True(HomeworkRules.Pending("Text", "Submitted", "")); Assert.True(HomeworkRules.Pending("File", "Submitted", null)); Assert.False(HomeworkRules.Pending("Done", "Submitted", ""));
        Assert.False(HomeworkRules.Pending("Text", "Reviewed", "")); Assert.False(HomeworkRules.Pending("Text", "Submitted", "Completed"));
        Assert.True(HomeworkRules.Done("Submitted", "")); Assert.True(HomeworkRules.Done(null, "Late")); Assert.False(HomeworkRules.Done("Submitted", "Missing")); Assert.False(HomeworkRules.Done(null, "Excused")); Assert.False(HomeworkRules.Done(null, ""));
    }

    [Theory]
    [InlineData("Draft", "Published", 0, null)][InlineData("Published", "Closed", 3, null)][InlineData("Closed", "Published", 3, null)][InlineData("Published", "Published", 3, null)]
    [InlineData("Published", "Draft", 0, null)][InlineData("Published", "Draft", 1, "Work has already been handed in; close the assignment instead of unpublishing it.")]
    [InlineData("Draft", "Closed", 0, "Publish the assignment before closing it.")][InlineData("Closed", "Draft", 0, "A closed assignment cannot go back to a draft.")]
    [InlineData(null, "Closed", 0, null)][InlineData("Published", "Archived", 0, "Choose a valid assignment status.")]
    public void TheLifecycleOnlyMovesForwardOrReopens(string? from, string to, int submissions, string? problem) => Assert.Equal(problem, HomeworkRules.TransitionProblem(from, to, submissions));

    [Fact]
    public void TheDueMomentIsTheDueTimeOrTheEndOfTheDueDay()
    {
        Assert.Equal(new DateTime(2026, 10, 5, 15, 30, 0, DateTimeKind.Utc), HomeworkRules.DueAt("2026-10-05", "15:30"));
        Assert.Equal(new DateTime(2026, 10, 5, 23, 59, 59, DateTimeKind.Utc), HomeworkRules.DueAt("2026-10-05", ""));
        Assert.Equal(DateTime.MaxValue, HomeworkRules.DueAt("someday", null));
    }

    [Fact]
    public void LatenessIsDecidedByTheServerAgainstTheDueMoment()
    {
        Assert.False(HomeworkRules.IsLate(Noon, "2026-10-05", "15:30"));
        Assert.True(HomeworkRules.IsLate(Noon.AddHours(4), "2026-10-05", "15:30"));
        Assert.False(HomeworkRules.IsLate(Noon.AddHours(11), "2026-10-05", ""));   // 23:00 on the due day is still in time
        Assert.True(HomeworkRules.IsLate(Noon.AddDays(1), "2026-10-05", ""));
    }

    [Theory]
    [InlineData("Published", null, "", "Text", "My answer", null)][InlineData("Published", "Submitted", "", "Text", "Changed", null)][InlineData("Published", null, "", "Done", "", null)][InlineData("Published", null, "", "File", "", null)]
    [InlineData("Published", null, "", "Text", "  ", "Write your response before handing in.")]
    [InlineData("Draft", null, "", "Text", "x", "This assignment is not published yet.")][InlineData("Closed", null, "", "Done", "", "This assignment is closed and no longer takes submissions.")]
    [InlineData("Published", "Reviewed", "", "Text", "x", "This work has been reviewed and cannot be changed.")][InlineData("Published", null, "Excused", "Done", "", "You have been excused from this assignment.")]
    [InlineData("Published", null, "", "None", "x", "This assignment does not take submissions.")][InlineData("Published", null, "", "Physical", "x", "This work is shown to the teacher in class, not handed in online.")]
    public void AStudentHandsInWhilePublishedAndUntilReviewed(string status, string? submission, string outcome, string mode, string response, string? problem) => Assert.Equal(problem, HomeworkRules.SubmitProblem(status, submission, outcome, mode, response));

    [Fact]
    public void EveryAssignmentHasOneStateForAStudent()
    {
        Assert.Equal("due-today", HomeworkRules.Group("Published", "2026-10-05", "", "Text", null, null, false, Noon));
        Assert.Equal("upcoming", HomeworkRules.Group("Published", "2026-10-07", "", "Done", null, null, false, Noon));
        Assert.Equal("missing", HomeworkRules.Group("Published", "2026-10-04", "", "Text", null, null, false, Noon));
        Assert.Equal("missing", HomeworkRules.Group("Published", "2026-10-04", "", "Physical", null, null, false, Noon));   // in-class work not yet checked off is missing once overdue
        Assert.Equal("closed", HomeworkRules.Group("Closed", "2026-10-04", "", "Text", null, null, false, Noon));
        Assert.Equal("closed", HomeworkRules.Group("Published", "2026-10-04", "", "None", null, null, false, Noon));   // information only, so nothing is missing
        Assert.Equal("submitted", HomeworkRules.Group("Published", "2026-10-07", "", "Text", "Submitted", "", false, Noon));
        Assert.Equal("late", HomeworkRules.Group("Published", "2026-10-04", "", "Done", "Submitted", "", true, Noon));
        Assert.Equal("reviewed", HomeworkRules.Group("Closed", "2026-10-04", "", "Text", "Reviewed", "Late", true, Noon));
        // The teacher's check decides for notebook and in-class work, and overrides what the calendar would say.
        Assert.Equal("submitted", HomeworkRules.Group("Published", "2026-10-04", "", "Physical", "", "Completed", false, Noon));
        Assert.Equal("late", HomeworkRules.Group("Published", "2026-10-07", "", "Physical", "", "Late", false, Noon));
        Assert.Equal("missing", HomeworkRules.Group("Published", "2026-10-07", "", "Done", "Submitted", "Missing", false, Noon));
        Assert.Equal("excused", HomeworkRules.Group("Closed", "2026-10-04", "", "Text", "", "Excused", false, Noon));
        Assert.Equal(new[] { "due-today", "upcoming", "submitted", "reviewed", "late", "missing", "excused", "closed" }, HomeworkRules.Groups);
    }

    [Fact]
    public void MarksStayWithinTheMaximumWhenOneIsSet()
    {
        Assert.Null(HomeworkRules.MarksProblem("", "A+")); Assert.Null(HomeworkRules.MarksProblem("20", "")); Assert.Null(HomeworkRules.MarksProblem("20", "Good work"));
        Assert.Null(HomeworkRules.MarksProblem("20", "17.5")); Assert.Equal("Marks must be between 0 and 20.", HomeworkRules.MarksProblem("20", "21")); Assert.Equal("Marks must be between 0 and 20.", HomeworkRules.MarksProblem("20", "-1"));
    }

    [Fact]
    public void EveryHomeworkStatementNamesTheSchool()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Homework.cs"));
        var uses = Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(suite\.\w+|student_db\.students|teacher_db\.teachers)").ToList();
        Assert.True(uses.Count >= 5);
        foreach (Match use in uses)
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            Assert.True(sql.Contains("school_id=@s") || sql.Contains("school_id=sc.school_id"), $"not bound to the school: {sql[..Math.Min(90, sql.Length)]}");
        }
        // Reads go through Records()/Get() (school-bound) and the scope check; the only write is the ordinary record save.
        Assert.DoesNotContain("INSERT INTO", text); Assert.DoesNotContain("UPDATE suite", text);
        Assert.Contains("Save(\"submissions\"", text);
    }
}

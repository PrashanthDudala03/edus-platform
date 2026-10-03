using System.Text.RegularExpressions;
using Xunit;

// Exams & report cards: assessment schemes, the lifecycle and who may move it, marks validation against the scheme
// (absent, exempt, grade-only), clashes on the timetable, what families may see, and a source guard that every exam
// statement names the school.
public class ExamRulesTests
{
    static Scheme Build(string type, string components = "", string grades = "", decimal? passPercent = null, decimal max = 100, decimal pass = 40)
    {
        var problem = ExamRules.Build(type, components, grades, passPercent, max, pass, ExamRules.LegacyGrades(90, 75, 60, 40), out var scheme);
        Assert.Null(problem); return scheme;
    }
    static readonly Dictionary<string, decimal> None = [];

    [Fact]
    public void AnExamWithoutASchemeIsPlainMarksOutOfItsMaximum()
    {
        var s = Build("", max: 50, pass: 20);
        Assert.Equal("Marks", s.Type); Assert.Single(s.Components); Assert.Equal(50, s.Max); Assert.Equal(20, s.PassMarks); Assert.Equal(5, s.Grades.Count);
        Assert.Equal("A", ExamRules.Grade(s, 95)); Assert.Equal("C", ExamRules.Grade(s, 60)); Assert.Equal("E", ExamRules.Grade(s, 10));
    }

    [Fact]
    public void TheoryPlusPracticalAndInternalPlusExternalAreComponentSchemes()
    {
        var s = Build("Components", "Theory:70:28, Practical:30", grades: "A+:90, A:80, B+:70, B:60, C:50, D:0");
        Assert.Equal(100, s.Max); Assert.Equal(2, s.Components.Count); Assert.Equal(28, s.Components[0].Pass); Assert.Null(s.Components[1].Pass);
        Assert.Equal(40, s.PassMarks);   // no pass percentage and not every component has a pass mark, so the exam's own pass marks apply
        Assert.Equal("B+", ExamRules.Grade(s, 72)); Assert.Equal("D", ExamRules.Grade(s, 3));
        var t = Build("Components", "Internal:20, External:80", passPercent: 35); Assert.Equal(35, t.PassMarks);
        var u = Build("Components", "Internal:20:8, External:80:32"); Assert.Equal(40, u.PassMarks);   // every component has a pass mark: they add up
    }

    [Fact]
    public void AGradeOnlySchemeHasNoMarks()
    {
        var s = Build("Grade", grades: "A+:90, A:75, B+:60, B:45, C:0");
        Assert.True(s.GradeOnly); Assert.Empty(s.Components); Assert.Equal(0, s.Max); Assert.Null(s.PassMarks);
        Assert.Equal("A+", s.Grades[0].Label); Assert.Equal("C", s.Grades[^1].Label);
    }

    [Theory]
    [InlineData("Components", "Theory:70", "", "A component scheme needs at least two components.")]
    [InlineData("Grade", "", "", "A grade-only scheme needs its grade scale.")]
    [InlineData("Marks", "Theory:0", "", "The maximum for Theory must be between 1 and 1000.")]
    [InlineData("Components", "Theory:70:80, Practical:30", "", "The pass mark for Theory must be between 0 and its maximum.")]
    [InlineData("Components", "Theory:70, Theory:30", "", "Component names must be different.")]
    [InlineData("Marks", "", "A:90", "A grade scale needs at least two grades.")]
    [InlineData("Marks", "", "A:90, B:120", "The minimum for grade B must be between 0 and 100.")]
    [InlineData("Marks", "", "A-90", "Write each grade as Label:MinimumPercent, separated by commas.")]
    [InlineData("Essay", "", "", "Choose a valid assessment type.")]
    public void ASchemeThatCannotBeAppliedIsRefused(string type, string components, string grades, string problem) =>
        Assert.Equal(problem, ExamRules.Build(type, components, grades, null, 100, 40, ExamRules.LegacyGrades(90, 75, 60, 40), out _));

    [Fact]
    public void MarksAreValidatedAgainstTheSchemeAndGradedByIt()
    {
        var s = Build("", max: 100, pass: 40);
        Assert.Null(ExamRules.MarkProblem(s, "", None, 92, "", out var total, out var grade, out var pass)); Assert.Equal(92, total); Assert.Equal("A", grade); Assert.True(pass);
        Assert.Equal("Marks must be between 0 and 100.", ExamRules.MarkProblem(s, "Present", None, 101, "", out _, out _, out _));
        Assert.Equal("Enter the marks obtained.", ExamRules.MarkProblem(s, "Present", None, null, "", out _, out _, out _));
        Assert.Null(ExamRules.MarkProblem(s, "Present", None, 39, "", out _, out grade, out pass)); Assert.Equal("E", grade); Assert.False(pass);
        var c = Build("Components", "Theory:70:28, Practical:30", passPercent: 40);
        var entered = new Dictionary<string, decimal> { ["Theory"] = 56, ["Practical"] = 25 };
        Assert.Null(ExamRules.MarkProblem(c, "Present", entered, null, "", out total, out grade, out pass)); Assert.Equal(81, total); Assert.Equal("B", grade); Assert.True(pass);   // the school's A to D scale applies when the scheme sets none
        Assert.Equal("Enter the marks for Practical.", ExamRules.MarkProblem(c, "Present", new Dictionary<string, decimal> { ["Theory"] = 56 }, null, "", out _, out _, out _));
        Assert.Equal("Marks for Practical must be between 0 and 30.", ExamRules.MarkProblem(c, "Present", new Dictionary<string, decimal> { ["Theory"] = 56, ["Practical"] = 31 }, null, "", out _, out _, out _));
        // Passing the total is not enough when a component has its own pass mark.
        Assert.Null(ExamRules.MarkProblem(c, "Present", new Dictionary<string, decimal> { ["Theory"] = 20, ["Practical"] = 30 }, null, "", out total, out _, out pass)); Assert.Equal(50, total); Assert.False(pass);
    }

    [Fact]
    public void AbsentScoresNothingExemptIsLeftOutAndGradeOnlyNeedsAGradeFromTheScale()
    {
        var s = Build("", max: 100, pass: 40);
        Assert.Null(ExamRules.MarkProblem(s, "Absent", None, null, "", out var total, out var grade, out var pass)); Assert.Equal(0, total); Assert.Equal("AB", grade); Assert.False(pass);
        Assert.Null(ExamRules.MarkProblem(s, "Exempt", None, null, "", out total, out grade, out pass)); Assert.Null(total); Assert.Equal("EX", grade); Assert.True(pass);
        Assert.Equal("Choose Present, Absent or Exempt.", ExamRules.MarkProblem(s, "Late", None, 50, "", out _, out _, out _));
        var g = Build("Grade", grades: "A+:90, A:75, B:60, C:0");
        Assert.Null(ExamRules.MarkProblem(g, "Present", None, null, "a", out total, out grade, out pass)); Assert.Null(total); Assert.Equal("A", grade); Assert.True(pass);
        Assert.Equal("Choose one of the scheme's grades: A+, A, B, C.", ExamRules.MarkProblem(g, "Present", None, null, "Z", out _, out _, out _));
    }

    [Fact]
    public void EnteredComponentsRoundTripAsText()
    {
        var entered = ExamRules.ParseEntered("Theory=56; Practical=25.5; junk; Lab=x");
        Assert.Equal(2, entered.Count); Assert.Equal(25.5m, entered["practical"]);
        Assert.Equal("Theory=56; Practical=25.5", ExamRules.FormatEntered(entered));
    }

    [Theory]
    // leadership moves forward by any number of stages and back only to return, unpublish or reopen
    [InlineData("Draft", "Scheduled", true, false, 0, null)][InlineData("Draft", "Published", true, false, 0, null)][InlineData("Scheduled", "MarksEntry", true, false, 0, null)]
    [InlineData("Submitted", "Approved", true, false, 0, null)][InlineData("Approved", "Published", true, false, 0, null)][InlineData("Published", "Closed", true, false, 0, null)]
    [InlineData("Submitted", "MarksEntry", true, false, 0, null)][InlineData("Approved", "MarksEntry", true, false, 0, null)][InlineData("Published", "Approved", true, false, 0, null)][InlineData("Closed", "Published", true, false, 0, null)]
    [InlineData("Published", "Draft", true, false, 0, "That status change is not allowed. Return marks for correction, unpublish, or reopen instead.")]
    [InlineData("Closed", "MarksEntry", true, false, 0, "That status change is not allowed. Return marks for correction, unpublish, or reopen instead.")]
    [InlineData("Draft", "Draft", true, false, 0, null)][InlineData(null, "Scheduled", true, false, 0, null)][InlineData("Draft", "Live", true, false, 0, "Choose a valid exam status.")]
    // a teacher only submits, only before approval, and only with marks entered
    [InlineData("MarksEntry", "Submitted", false, true, 12, null)][InlineData("Draft", "Submitted", false, true, 3, null)]
    [InlineData("MarksEntry", "Submitted", false, true, 0, "Enter marks before submitting them for approval.")]
    [InlineData("Submitted", "Submitted", false, true, 5, null)][InlineData("Approved", "Submitted", false, true, 5, "These marks have already been submitted.")]
    [InlineData("MarksEntry", "Published", false, true, 12, "Teachers submit marks for approval; the school approves and publishes.")]
    [InlineData("MarksEntry", "Approved", false, true, 12, "Teachers submit marks for approval; the school approves and publishes.")]
    [InlineData("Draft", "Scheduled", false, false, 0, "Only school leadership can change an exam.")]
    public void TheLifecycleIsMovedByLeadershipAndSubmittedByTeachers(string? from, string to, bool leadership, bool teacher, int entered, string? problem) =>
        Assert.Equal(problem, ExamRules.TransitionProblem(from, to, leadership, teacher, entered));

    [Fact]
    public void FamiliesSeeScheduledExamsAndOnlyPublishedResults()
    {
        Assert.False(ExamRules.FamilyVisible("Draft")); Assert.False(ExamRules.FamilyVisible(null)); Assert.True(ExamRules.FamilyVisible("Scheduled")); Assert.True(ExamRules.FamilyVisible("Submitted"));
        Assert.False(ExamRules.ResultsVisible("Approved")); Assert.True(ExamRules.ResultsVisible("Published")); Assert.True(ExamRules.ResultsVisible("Closed"));
        Assert.True(ExamRules.MarksEditable("MarksEntry", false)); Assert.False(ExamRules.MarksEditable("Submitted", false)); Assert.True(ExamRules.MarksEditable("Submitted", true)); Assert.True(ExamRules.MarksEditable("Approved", true));
        Assert.False(ExamRules.MarksEditable("Published", true)); Assert.False(ExamRules.MarksEditable("Closed", true));
        Assert.Equal(new[] { "Draft", "Scheduled", "MarksEntry", "Submitted", "Approved", "Published", "Closed" }, ExamRules.Statuses);
    }

    [Fact]
    public void TwoSittingsOfAClassCannotOverlapOnOneDay()
    {
        Assert.True(ExamRules.Clash("2026-10-20", "09:00", "11:00", "2026-10-20", "10:30", "12:00"));
        Assert.False(ExamRules.Clash("2026-10-20", "09:00", "11:00", "2026-10-20", "11:00", "12:00"));
        Assert.False(ExamRules.Clash("2026-10-20", "09:00", "11:00", "2026-10-21", "09:00", "11:00"));
        Assert.False(ExamRules.Clash("2026-10-20", "", "", "2026-10-20", "09:00", "11:00"));   // without times the day is shared
    }

    [Fact]
    public void EveryExamStatementNamesTheSchool()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Exams.cs"));
        var uses = Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(suite\.\w+|student_db\.students|teacher_db\.teachers|school_db\.attendance)").ToList();
        Assert.True(uses.Count >= 4);
        foreach (Match use in uses)
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            Assert.True(sql.Contains("school_id=@s") || sql.Contains("school_id=sc.school_id"), $"not bound to the school: {sql[..Math.Min(90, sql.Length)]}");
        }
        // Marks are written only through the ordinary record save; the lifecycle write checks the school and the version.
        Assert.DoesNotContain("INSERT INTO", text); Assert.Contains("Save(\"marks\"", text); Assert.Contains("WHERE school_id=@s AND id=@id AND kind='exams' AND version=@v", text);
        // The report card checks the caller's scope before any lookup (in Suite.Reports.cs) and reads published results only.
        Assert.Contains("ExamRules.ResultsVisible(Text(e, \"status\"))", text);
    }
}

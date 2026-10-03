using System.Text.RegularExpressions;
using Xunit;

// Student 360: what each role sees, how the composed timeline is ordered and paged, how homework completion reads,
// and a source guard that the student is checked before any lookup and every statement names the school.
public class Student360RulesTests
{
    static readonly DateTime T = new(2026, 10, 5, 9, 0, 0, DateTimeKind.Utc);
    static StudentEvent E(int minutesAgo, string kind, string title) => new(T.AddMinutes(-minutesAgo), kind, title, "", kind, "");

    [Theory]
    [InlineData("Administrator", true, true, true)][InlineData("Principal", true, true, true)][InlineData("Parent", true, true, true)][InlineData("Student", true, true, true)]
    [InlineData("Teacher", false, false, true)][InlineData("", false, false, false)][InlineData("Custom", false, false, false)]
    public void ContactDetailsAndFeesStayWithTheOfficeAndTheFamily(string role, bool contact, bool fees, bool guardians)
    {
        var see = Student360Rules.Visibility(role);
        Assert.Equal(contact, see.contact); Assert.Equal(fees, see.fees); Assert.Equal(guardians, see.guardians);
    }

    [Fact]
    public void TheTimelineIsNewestFirstAndPaged()
    {
        var events = new[] { E(30, "homework", "Handed in"), E(5, "attendance", "Marked Present"), E(5, "exam", "Exam scheduled"), E(120, "payment", "Payment received") };
        var (first, total, more) = Student360Rules.Page(events, 1, 2);
        Assert.Equal(4, total); Assert.True(more); Assert.Equal(new[] { "Marked Present", "Exam scheduled" }, first.Select(e => e.Title));   // same moment: stable by kind
        var (second, _, last) = Student360Rules.Page(events, 2, 2);
        Assert.False(last); Assert.Equal(new[] { "Handed in", "Payment received" }, second.Select(e => e.Title));
        Assert.Empty(Student360Rules.Page(events, 9, 2).items); Assert.Equal(first, Student360Rules.Page(events, 0, 2).items);
        Assert.Equal(20, Student360Rules.PageSize(null)); Assert.Equal(20, Student360Rules.PageSize(0)); Assert.Equal(100, Student360Rules.PageSize(5000)); Assert.Equal(7, Student360Rules.PageSize(7));
    }

    [Fact]
    public void HomeworkCompletionCountsDoneWorkOverTrackedWorkAndIsUnknownWithoutAny()
    {
        Assert.Null(Student360Rules.HomeworkCompletion(new Dictionary<string, int>()));
        Assert.Null(Student360Rules.HomeworkCompletion(new Dictionary<string, int> { ["closed"] = 3, ["excused"] = 1 }));
        Assert.Equal(75, Student360Rules.HomeworkCompletion(new Dictionary<string, int> { ["submitted"] = 2, ["reviewed"] = 1, ["missing"] = 1 }));
        Assert.Equal(50, Student360Rules.HomeworkCompletion(new Dictionary<string, int> { ["late"] = 1, ["upcoming"] = 1 }));
    }

    [Fact]
    public void TimestampsAreReadAsUtcOrIgnored()
    {
        Assert.True(Student360Rules.Parse("2026-10-05T09:00:00.0000000Z", out var at)); Assert.Equal(DateTimeKind.Utc, at.Kind); Assert.Equal(T, at);
        Assert.True(Student360Rules.Parse("2026-10-05", out var day)); Assert.Equal(new DateTime(2026, 10, 5, 0, 0, 0, DateTimeKind.Utc), day);
        Assert.False(Student360Rules.Parse("", out _)); Assert.False(Student360Rules.Parse("soon", out _));
    }

    [Fact]
    public void TheStudentIsCheckedBeforeAnyLookupAndEveryStatementNamesTheSchool()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Student360.cs"));
        var uses = Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(suite\.\w+|student_db\.students|teacher_db\.teachers|auth_db\.users|school_db\.\w+)").ToList();
        Assert.True(uses.Count >= 8);
        foreach (Match use in uses)
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            Assert.True(sql.Contains("school_id=@s") || sql.Contains("school_id=ch.school_id") || sql.Contains("school_id=p.school_id"), $"not bound to the school: {sql[..Math.Min(90, sql.Length)]}");
        }
        // Scope first (403 before the student row is read), then the row; never a write.
        var scope = text.IndexOf("a.SchoolWide || a.Students.Contains(id.ToString())", StringComparison.Ordinal); var lookup = text.IndexOf("FROM student_db.students", StringComparison.Ordinal);
        Assert.True(scope > 0 && scope < lookup);
        Assert.DoesNotContain("INSERT INTO", text); Assert.DoesNotContain("UPDATE suite", text); Assert.DoesNotContain("DELETE FROM", text);
        // Results come from the report card, which reads published exams only; fees are read only when the role may see them.
        Assert.Contains("await ReportCard(c, a, id, null, null, null)", text); Assert.Contains("if (see.fees)", text); Assert.Contains("ExamRules.FamilyVisible", text);
    }
}

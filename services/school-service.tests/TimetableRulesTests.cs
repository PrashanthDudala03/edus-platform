using System.Text.RegularExpressions;
using Xunit;

// Timetable 2.0 rules: when two periods clash (teacher, class, room; same day, same year, half-open times), whether a
// teacher can cover a period on a date, which lessons a span of dates touches, and where a day stands. Plus a source
// guard that every timetable statement names the school and that families never receive leave details.
public class TimetableRulesTests
{
    static TimetableRules.Period P(string id, string day, string start, string end, string cls, string teacher, string room = "", string year = "Y1", string subject = "S1", string className = "Grade 6 - A") =>
        new(id, day, start, end, cls, teacher, room, year, subject, "", className);

    [Theory]
    [InlineData("09:00", "09:45", "09:45", "10:30", false)][InlineData("09:00", "09:45", "09:30", "10:15", true)][InlineData("09:00", "10:00", "09:15", "09:30", true)][InlineData("10:00", "10:45", "09:00", "09:45", false)]
    public void OverlapIsHalfOpen(string a1, string a2, string b1, string b2, bool clash) => Assert.Equal(clash, TimetableRules.Overlaps(a1, a2, b1, b2));

    [Fact]
    public void ASpanMustEndAfterItStartsAndTimesMustBeValid()
    {
        Assert.True(TimetableRules.ValidSpan("09:00", "09:45")); Assert.False(TimetableRules.ValidSpan("09:45", "09:45")); Assert.False(TimetableRules.ValidSpan("10:00", "09:00")); Assert.False(TimetableRules.ValidSpan("9am", "10:00"));
        Assert.Equal(-1, TimetableRules.Minutes("")); Assert.Equal(585, TimetableRules.Minutes("09:45"));
    }

    [Fact]
    public void TheWeekdayOfADateFollowsTheTimetableNames()
    {
        Assert.Equal("Monday", TimetableRules.DayOf(new DateOnly(2026, 10, 5))); Assert.Equal("Sunday", TimetableRules.DayOf(new DateOnly(2026, 10, 11)));
        Assert.Equal((new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 11)), TimetableRules.Week(new DateOnly(2026, 10, 8)));
        Assert.Equal(new[] { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" }, TimetableRules.Days);
        Assert.Equal(new[] { "Teaching", "Break", "Lunch", "Assembly", "Activity", "Free" }, TimetableRules.SlotTypes);
    }

    [Fact]
    public void TeacherClassAndRoomClashesAreNamedAndOtherDaysYearsAndTimesAreNot()
    {
        var existing = P("t1", "Monday", "09:00", "09:45", "C1", "T1", "Room 4");
        Assert.Equal("This teacher is already with Grade 6 - A at 09:00–09:45 on Monday.", TimetableRules.Conflict(P("n", "Monday", "09:30", "10:15", "C2", "T1"), [existing]));
        Assert.Equal("Grade 6 - A already has a period at 09:00–09:45 on Monday.", TimetableRules.Conflict(P("n", "Monday", "09:30", "10:15", "C1", "T2"), [existing]));
        Assert.Equal("room 4 is taken by Grade 6 - A at 09:00–09:45 on Monday.", TimetableRules.Conflict(P("n", "Monday", "09:30", "10:15", "C2", "T2", " room 4 "), [existing]));
        Assert.Null(TimetableRules.Conflict(P("n", "Tuesday", "09:00", "09:45", "C1", "T1", "Room 4"), [existing]));
        Assert.Null(TimetableRules.Conflict(P("n", "Monday", "09:45", "10:30", "C1", "T1", "Room 4"), [existing]));
        Assert.Null(TimetableRules.Conflict(P("n", "Monday", "09:00", "09:45", "C1", "T1", "Room 4", year: "Y2"), [existing]));
        // A period without a year is checked against every year; an empty room never clashes.
        Assert.NotNull(TimetableRules.Conflict(P("n", "Monday", "09:00", "09:45", "C9", "T1", year: ""), [existing]));
        Assert.Null(TimetableRules.Conflict(P("n", "Monday", "09:00", "09:45", "C2", "T2", ""), [P("t2", "Monday", "09:00", "09:45", "C3", "T3", "")]));
    }

    [Fact]
    public void ASubstituteMustBeFreeThatDayAndThatTime()
    {
        var period = P("t1", "Monday", "09:00", "09:45", "C1", "T1"); var monday = new DateOnly(2026, 10, 5);
        Assert.Equal("Choose a teacher other than the one being covered.", TimetableRules.SubstituteProblem(period, "T1", monday, [], [], false));
        Assert.Equal("This teacher is away that day.", TimetableRules.SubstituteProblem(period, "T2", monday, [], [], true));
        Assert.Equal("This teacher is teaching at that time.", TimetableRules.SubstituteProblem(period, "T2", monday, [P("t2", "Monday", "09:30", "10:15", "C2", "T2")], [], false));
        Assert.Equal("This teacher already covers another period at that time.", TimetableRules.SubstituteProblem(period, "T2", monday, [], [("09:00", "09:45")], false));
        Assert.Null(TimetableRules.SubstituteProblem(period, "T2", monday, [P("t2", "Tuesday", "09:00", "09:45", "C2", "T2"), P("t3", "Monday", "09:45", "10:30", "C2", "T2")], [("10:30", "11:15")], false));
    }

    [Fact]
    public void LeaveTouchesEveryLessonOnItsDaysInOrder()
    {
        var mine = new[] { P("a", "Monday", "11:00", "11:45", "C1", "T1"), P("b", "Monday", "09:00", "09:45", "C2", "T1", className: "Grade 7 - B"), P("c", "Wednesday", "09:00", "09:45", "C1", "T1") };
        var affected = TimetableRules.Affected(mine, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 6));
        Assert.Equal(new[] { ("2026-10-05", "b"), ("2026-10-05", "a") }, affected.Select(e => (e.date.ToString("yyyy-MM-dd"), e.period.Id)));
        Assert.Equal(3, TimetableRules.Affected(mine, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 11)).Count);
        Assert.Empty(TimetableRules.Affected(mine, new DateOnly(2026, 10, 10), new DateOnly(2026, 10, 11)));
        Assert.Equal(7, TimetableRules.Dates(new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 11)).Count());
    }

    [Fact]
    public void TheDayKnowsItsCurrentAndNextPeriod()
    {
        var day = new[] { ("09:00", "09:45"), ("09:45", "10:30"), ("11:00", "11:45") };
        Assert.Equal((-1, 0), TimetableRules.Position(day, 8 * 60)); Assert.Equal((0, 1), TimetableRules.Position(day, 9 * 60 + 10)); Assert.Equal((-1, 2), TimetableRules.Position(day, 10 * 60 + 40));
        Assert.Equal((2, -1), TimetableRules.Position(day, 11 * 60 + 30)); Assert.Equal((-1, -1), TimetableRules.Position(day, 13 * 60)); Assert.Equal((-1, -1), TimetableRules.Position([], 9 * 60));
    }

    [Fact]
    public void EveryTimetableStatementNamesTheSchoolAndFamiliesNeverReadLeave()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Timetable.cs"));
        foreach (Match use in Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(suite\.\w+|student_db\.students|teacher_db\.teachers)"))
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            Assert.True(sql.Contains("school_id=@s") || sql.Contains("VALUES(@id,@s"), $"not bound to the school: {sql[..Math.Min(90, sql.Length)]}");
        }
        // The family view of a period carries the effective teacher only: no away flag, status, substitution note or leave.
        Assert.Contains("if (!office) return v;", text); Assert.Contains("PeriodView(x, t, date, false)", text);
        Assert.DoesNotContain("reason", text.Split("static JsonObject FamilyDay")[1].Split("static void MapTimetable")[0]);
        // Scope is settled from the token before any lookup; a student's class is checked against the caller's students.
        Assert.Contains("Require(a.SchoolWide || a.Students.Contains(student.ToString()), \"This student is outside your scope.\", 403);", text);
        Assert.Contains("Require(a.SchoolWide && a.Can(\"substitutions.manage\")", text); Assert.Contains("Require(a.SchoolWide && a.Can(\"timetable.manage\")", text);
    }
}

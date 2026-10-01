using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace EduOS.Ai.Tools;

// The first tools. Each reads one existing endpoint and returns totals or a short list without names of people
// or identifiers. The school in a query is always the caller's, from the verified token.

/// <summary>How many students the school has. Endpoint: GET /api/v1/students/count (students.view).</summary>
public sealed class StudentCountTool : IAiTool
{
    const string Path = "/api/v1/students/count";
    public ToolDefinition Definition { get; } = new("student_count", "The number of students currently enrolled in the caller's school.", "students.view", [], ["students"]);
    public IReadOnlyList<string> Paths { get; } = [Path];

    public async Task<JsonObject> Run(ToolCaller caller, ToolArguments arguments, IEduOsApi api, DateOnly today, CancellationToken cancellation)
    {
        var body = await api.Get(Path, new Dictionary<string, string> { ["schoolId"] = caller.Tenant.SchoolId.ToString() }, caller, cancellation);
        return new JsonObject { ["students"] = ToolJson.Count(ToolJson.Property(body, "data", JsonValueKind.Object), "count") };
    }
}

/// <summary>Attendance of the whole school on one day, as counts. Endpoint: GET /api/v1/operations/overview (overview.view).</summary>
public sealed class AttendanceSummaryTool : IAiTool
{
    const string Path = "/api/v1/operations/overview";
    public ToolDefinition Definition { get; } = new("attendance_summary", "School-wide student attendance for one day: how many were marked, how many were present.", "overview.view",
        [new("day", ToolParameterKind.Date, "The day, as yyyy-MM-dd. Today when omitted. Not in the future and not more than a year ago.")],
        ["day", "students", "marked", "present", "notPresent", "notMarked", "percentPresentOfMarked"]);
    public IReadOnlyList<string> Paths { get; } = [Path];

    public async Task<JsonObject> Run(ToolCaller caller, ToolArguments arguments, IEduOsApi api, DateOnly today, CancellationToken cancellation)
    {
        var day = arguments.Date("day") ?? today;
        var body = await api.Get(Path, new Dictionary<string, string> { ["schoolId"] = caller.Tenant.SchoolId.ToString(), ["day"] = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) }, caller, cancellation);
        var stats = ToolJson.Property(ToolJson.Property(body, "data", JsonValueKind.Object), "stats", JsonValueKind.Object);
        int students = ToolJson.Count(stats, "students"), marked = ToolJson.Count(stats, "marked"), present = ToolJson.Count(stats, "present");
        if (present > marked) throw new ToolFailure(ToolResult.Unavailable);
        return new JsonObject
        {
            ["day"] = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ["students"] = students, ["marked"] = marked, ["present"] = present,
            ["notPresent"] = marked - present, ["notMarked"] = Math.Max(0, students - marked),
            ["percentPresentOfMarked"] = marked == 0 ? null : Math.Round(100m * present / marked, 1) + 0.0m,
        };
    }
}

/// <summary>
/// Fee totals: charged, paid, outstanding and overdue, per currency. For a parent or student EduOS returns only the
/// linked children's charges, so the totals are theirs. Endpoint: GET /api/v1/suite/fees (fees.view).
/// </summary>
public sealed class FeeSummaryTool : IAiTool
{
    const string Path = "/api/v1/suite/fees";
    /// <summary>More charges than this are not summarised; the tool says so instead of reading on.</summary>
    public const int MaxCharges = 5000;
    const int MaxCurrencies = 5;
    public ToolDefinition Definition { get; } = new("fee_summary", "Totals of the fees the caller may see: charged, concession, paid, balance and overdue, per currency. No student or payment details.", "fees.view", [],
        ["asOf", "currencies[].currency", "currencies[].charges", "currencies[].gross", "currencies[].concession", "currencies[].paid", "currencies[].balance", "currencies[].chargesWithBalance", "currencies[].overdueCharges", "currencies[].overdueBalance"]);
    public IReadOnlyList<string> Paths { get; } = [Path];

    public async Task<JsonObject> Run(ToolCaller caller, ToolArguments arguments, IEduOsApi api, DateOnly today, CancellationToken cancellation)
    {
        var rows = ToolJson.Property(await api.Get(Path, null, caller, cancellation), "data", JsonValueKind.Array);
        if (rows.GetArrayLength() > MaxCharges) throw new ToolFailure(ToolResult.TooLarge);
        var totals = new SortedDictionary<string, (int Charges, decimal Gross, decimal Concession, decimal Paid, decimal Balance, int Open, int OverdueCharges, decimal Overdue)>(StringComparer.Ordinal);
        foreach (var row in rows.EnumerateArray())
        {
            // Only amounts, the due date and the currency are read. Names, descriptions and identifiers are left where they are.
            if (ToolJson.Text(row, "currency") is not { Length: 3 } currency || !currency.All(char.IsAsciiLetterUpper)) throw new ToolFailure(ToolResult.Unavailable);
            decimal gross = ToolJson.Money(row, "gross"), concession = ToolJson.Money(row, "concession"), paid = ToolJson.Money(row, "paid"), balance = ToolJson.Money(row, "balance");
            var overdue = balance > 0 && DateTime.TryParse(ToolJson.Text(row, "dueDate"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var due) && DateOnly.FromDateTime(due) < today;
            var t = totals.GetValueOrDefault(currency);
            totals[currency] = (t.Charges + 1, t.Gross + gross, t.Concession + concession, t.Paid + paid, t.Balance + balance, t.Open + (balance > 0 ? 1 : 0), t.OverdueCharges + (overdue ? 1 : 0), t.Overdue + (overdue ? balance : 0));
        }
        if (totals.Count > MaxCurrencies) throw new ToolFailure(ToolResult.TooLarge);
        // Always two decimal places, whatever precision the endpoint used.
        static decimal Round(decimal amount) => Math.Round(amount, 2) + 0.00m;
        return new JsonObject
        {
            ["asOf"] = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["currencies"] = new JsonArray(totals.Select(t => (JsonNode)new JsonObject
            {
                ["currency"] = t.Key, ["charges"] = t.Value.Charges, ["gross"] = Round(t.Value.Gross), ["concession"] = Round(t.Value.Concession), ["paid"] = Round(t.Value.Paid),
                ["balance"] = Round(t.Value.Balance), ["chargesWithBalance"] = t.Value.Open, ["overdueCharges"] = t.Value.OverdueCharges, ["overdueBalance"] = Round(t.Value.Overdue),
            }).ToArray()),
        };
    }
}

/// <summary>Exams the caller may see, upcoming or recent, as a short list. Endpoint: GET /api/v1/suite/records/exams (exams.view).</summary>
public sealed class ExamScheduleTool : IAiTool
{
    const string Path = "/api/v1/suite/records/exams";
    /// <summary>The endpoint serves twenty records a page. This many pages are read and no more.</summary>
    public const int MaxPages = 5;
    public ToolDefinition Definition { get; } = new("exam_schedule", "Exams the caller may see: the next ones, or the most recent ones, with their dates.", "exams.view",
        [new("period", ToolParameterKind.Choice, "\"upcoming\" (default) or \"recent\".", Choices: ["upcoming", "recent"]), new("limit", ToolParameterKind.Integer, "How many exams to return, 1 to 20. Ten when omitted.", 1, 20)],
        ["period", "exams[].name", "exams[].date", "exams[].status", "exams[].maxMarks", "exams[].passMarks", "more"]);
    public IReadOnlyList<string> Paths { get; } = [Path];

    public async Task<JsonObject> Run(ToolCaller caller, ToolArguments arguments, IEduOsApi api, DateOnly today, CancellationToken cancellation)
    {
        string period = arguments.Choice("period") ?? "upcoming"; var limit = arguments.Integer("limit") ?? 10;
        var exams = new List<(DateOnly Date, JsonObject Exam)>(); var more = false;
        for (var page = 1; page <= MaxPages; page++)
        {
            var data = ToolJson.Property(await api.Get(Path, new Dictionary<string, string> { ["page"] = page.ToString(CultureInfo.InvariantCulture) }, caller, cancellation), "data", JsonValueKind.Object);
            var rows = ToolJson.Property(data, "data", JsonValueKind.Array); var total = ToolJson.Count(data, "totalCount");
            foreach (var row in rows.EnumerateArray())
            {
                if (!DateOnly.TryParseExact(ToolJson.Text(row, "date"), "yyyy-MM-dd", out var date) || (period == "upcoming") != (date >= today)) continue;
                // The class and the subject are identifiers in this endpoint, so they are left out.
                var exam = new JsonObject { ["name"] = ToolJson.Label(ToolJson.Text(row, "name")), ["date"] = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ["status"] = ToolJson.Label(ToolJson.Text(row, "status"), 30) };
                foreach (var marks in new[] { "maxMarks", "passMarks" })
                    if (row.TryGetProperty(marks, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number) && number is >= 0 and <= 100000) exam[marks] = number;
                exams.Add((date, exam));
            }
            if (rows.GetArrayLength() == 0 || page * 20 >= total) break;
            if (page == MaxPages) more = true;
        }
        var ordered = (period == "upcoming" ? exams.OrderBy(e => e.Date) : exams.OrderByDescending(e => e.Date)).ThenBy(e => (string?)e.Exam["name"], StringComparer.Ordinal).ToList();
        return new JsonObject { ["period"] = period, ["exams"] = new JsonArray(ordered.Take(limit).Select(e => (JsonNode)e.Exam).ToArray()), ["more"] = more || ordered.Count > limit };
    }
}

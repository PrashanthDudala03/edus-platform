using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;
using Serilog;

/// <summary>
/// The rules of the school fee ledger, kept pure so they are tested without a database: what a student owes after
/// concessions, waivers and fines, the state of a charge, what a payment or a reversal may be, how instalments are
/// laid out, and how an online payment attempt moves. Money is whole minor units (paise); nothing is a float.
/// </summary>
public static class FeeRules
{
    public static readonly string[] Methods = ["Cash", "UPI", "Bank transfer", "Cheque", "Other"];
    public static readonly string[] Frequencies = ["One-time", "Monthly", "Quarterly", "Term", "Annual", "Custom"];
    public static readonly string[] ChargeStatuses = ["Active", "Waived", "Cancelled"];
    public static readonly string[] States = ["Unpaid", "Partial", "Paid", "Overdue", "Waived", "Cancelled"];
    public static readonly string[] IntentStatuses = ["Pending", "Verified", "Failed", "Expired"];
    public const int MaxConcessionPercent = 10000;   // basis points

    /// <summary>Net payable: gross less the concession given at issue, later concessions and any waiver, never below zero, plus fines.</summary>
    public static long Net(long gross, long concession, long later, long waived, long fine) => Math.Max(0, gross - concession - later - waived) + fine;
    /// <summary>A percentage concession is kept in basis points; a fixed one in minor units. Neither exceeds what is left to concede.</summary>
    public static long ConcessionAmount(string kind, long value, long remaining) => remaining <= 0 ? 0 : kind == "Percent" ? Math.Min(remaining, (long)Math.Round(remaining * (decimal)value / 10000, MidpointRounding.AwayFromZero)) : Math.Min(remaining, value);
    public static string? ConcessionProblem(string kind, long value, string reason, DateOnly? from, DateOnly? to)
    {
        if (kind is not ("Percent" or "Fixed")) return "A concession is a percentage or a fixed amount.";
        if (value <= 0) return "The concession must be more than zero.";
        if (kind == "Percent" && value > MaxConcessionPercent) return "A percentage concession cannot exceed 100%.";
        if (reason.Trim().Length < 3 || reason.Length > 300) return "Give the reason for the concession.";
        return from is not null && to is not null && to < from ? "The concession must end on or after it starts." : null;
    }
    public static bool Applies(DateOnly? from, DateOnly? to, DateOnly due) => (from is null || due >= from) && (to is null || due <= to);
    /// <summary>The state a charge is in for the people who read it; Overdue means unpaid or part-paid after the due date.</summary>
    public static string State(string status, long net, long paid, DateOnly due, DateOnly today) => status switch
    {
        "Cancelled" => "Cancelled", "Waived" => "Waived",
        _ => paid >= net ? "Paid" : due < today ? "Overdue" : paid > 0 ? "Partial" : "Unpaid",
    };
    public static bool IsOverdue(string status, long net, long paid, DateOnly due, DateOnly today) => status == "Active" && paid < net && due < today;
    public static string? PaymentProblem(long amount, long outstanding, string method, string reference, DateOnly paidOn, DateOnly today)
    {
        if (amount <= 0) return "Payment amount must be positive.";
        if (!Methods.Contains(method)) return "Choose a valid payment method.";
        if (reference.Length > 150 || (reference.Length == 0 && method is "UPI" or "Bank transfer" or "Cheque")) return "A bank / UPI / cheque reference is required.";
        if (paidOn > today.AddDays(1)) return "Payment date cannot be in the future.";
        return amount > outstanding ? "Payment exceeds the outstanding balance." : null;
    }
    public static string? ReversalProblem(string status, string reason) => status != "Completed" ? "Only a completed payment can be reversed." : reason.Trim().Length < 5 || reason.Length > 300 ? "Give the reason for the reversal." : null;
    public static string? ChargeStatusProblem(string from, string to, long paid, string reason)
    {
        if (!ChargeStatuses.Contains(to)) return "Choose Active, Waived or Cancelled.";
        if (from == to) return null;
        if (to == "Cancelled" && paid > 0) return "A charge with payments cannot be cancelled; reverse the payments first or waive the balance.";
        return reason.Trim().Length < 3 || reason.Length > 300 ? "Give the reason for the change." : null;
    }
    /// <summary>Instalment labels and due dates for a plan: one, or a run from the first due date at the frequency's step.</summary>
    public static List<(string Label, DateOnly Due)> Instalments(string frequency, DateOnly first, int count)
    {
        if (!Frequencies.Contains(frequency)) throw new ArgumentException("Choose a valid frequency.", nameof(frequency));
        var n = frequency is "One-time" or "Annual" ? 1 : Math.Clamp(count, 1, 24); var step = frequency switch { "Quarterly" => 3, "Term" => 4, _ => 1 };
        var list = new List<(string, DateOnly)>();
        for (var i = 0; i < n; i++) list.Add((frequency switch { "One-time" => "One-time", "Annual" => "Annual", "Monthly" => first.AddMonths(i).ToString("MMMM yyyy", CultureInfo.InvariantCulture), "Quarterly" => "Quarter " + (i + 1), "Term" => "Term " + (i + 1), _ => "Instalment " + (i + 1) }, first.AddMonths(i * step)));
        return list;
    }
    /// <summary>Pending -> Verified | Failed | Expired; a decided attempt never moves again. Repeating the same decision is harmless.</summary>
    public static string? IntentTransition(string from, string to) => !IntentStatuses.Contains(to) ? "Unknown payment state." : from == to ? null : from != "Pending" ? "This payment attempt was already decided." : null;
    public static string Hmac(string data, string secret) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(data))).ToLowerInvariant();
}

/// <summary>The school's own payment relationship, as the ledger sees it. No credential is ever part of this.</summary>
public sealed record SchoolPaymentConfig(Guid School, string Provider, string MerchantReference, string ConnectionStatus, bool OnlineEnabled, string SettlementStatus);
public sealed record ProviderOrder(string Reference, string Instructions);
/// <summary>What a provider tells the school about one attempt, after its signature has been verified.</summary>
public sealed record ProviderEvent(string EventId, string OrderReference, string PaymentReference, long Amount, string Currency, string Status);
/// <summary>
/// The boundary between the fee ledger and any online payment provider. The ledger asks for an order and later
/// receives verified events; it never knows which provider is behind them. The provider acts for the school's own
/// merchant or linked account (configured per school), never for an EduOS account.
/// </summary>
public interface ISchoolPaymentProvider
{
    string Name { get; }
    /// <summary>Connected when the deployment holds what this provider needs for the school; the ledger refuses online payments otherwise.</summary>
    string ConnectionStatus(SchoolPaymentConfig config);
    Task<ProviderOrder> CreateOrder(SchoolPaymentConfig config, Guid intent, long amount, string currency);
    /// <summary>The event in the request, or null when the signature does not verify. Never throws on bad input.</summary>
    ProviderEvent? Parse(SchoolPaymentConfig config, string? signature, string body);
}
/// <summary>A test provider: orders are references, and an event is accepted when it is signed with the deployment's fake secret.</summary>
public sealed class FakeSchoolPaymentProvider : ISchoolPaymentProvider
{
    public const string SecretVariable = "SCHOOL_FEES_FAKE_SECRET";
    readonly Func<string?> secret;
    public FakeSchoolPaymentProvider(Func<string?>? secret = null) => this.secret = secret ?? (() => Environment.GetEnvironmentVariable(SecretVariable));
    public string Name => "fake";
    public string ConnectionStatus(SchoolPaymentConfig config) => string.IsNullOrEmpty(secret()) ? "NotConnected" : "Connected";
    public Task<ProviderOrder> CreateOrder(SchoolPaymentConfig config, Guid intent, long amount, string currency) => Task.FromResult(new ProviderOrder("fake_" + intent.ToString("N"), "Test provider: confirm the payment by posting a signed event to the fees webhook."));
    public ProviderEvent? Parse(SchoolPaymentConfig config, string? signature, string body)
    {
        var key = secret(); if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(signature) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(FeeRules.Hmac(body, key)), Encoding.UTF8.GetBytes(signature.Trim().ToLowerInvariant()))) return null;
        try
        {
            var o = JsonNode.Parse(body) as JsonObject; if (o is null) return null;
            string T(string k) => o[k]?.ToString().Trim() ?? "";
            return long.TryParse(T("amount"), out var amount) && T("eventId") != "" && T("orderReference") != "" ? new(T("eventId"), T("orderReference"), T("paymentReference"), amount, T("currency"), T("status") == "captured" ? "captured" : "failed") : null;
        }
        catch (JsonException) { return null; }
    }
}
/// <summary>
/// Razorpay for school fees is deliberately not connected: whether each school's money moves through a Razorpay
/// Route linked account, the school's own merchant account or a partner model is a commercial and compliance decision
/// still to be made with Razorpay. Until then the provider exists, refuses orders, and never shares the platform's
/// billing credentials.
/// </summary>
public sealed class RazorpaySchoolPaymentProvider : ISchoolPaymentProvider
{
    public string Name => "razorpay";
    public string ConnectionStatus(SchoolPaymentConfig config) => "NotConnected";
    public Task<ProviderOrder> CreateOrder(SchoolPaymentConfig config, Guid intent, long amount, string currency) => throw new SuiteError(503, "Online payments through Razorpay are not connected for this school yet. Payments can be recorded at the school office.");
    public ProviderEvent? Parse(SchoolPaymentConfig config, string? signature, string body) => null;
}

// Fees & Collections 2.0 on the existing ledger: fee heads and structures as records, charges and payments as rows,
// concessions, waivers and reversals that never erase history, receipts numbered per school, an accountant's
// ledger and reports, and an online-payment attempt that only a verified provider event can complete.
public static partial class Suite
{
    public sealed record Ledger(Guid Id, Guid StudentId, string Student, string Class, string Description, Guid StructureId, DateOnly Due, long Gross, long Concession, long Later, long Fine, string Status, long Paid, string Currency, DateTime CreatedAt, string Note)
    { public long Net => FeeRules.Net(Gross, Concession, Later, 0, Fine); public long Outstanding => Status == "Active" ? Math.Max(0, Net - Paid) : 0; }
    static readonly Dictionary<string, ISchoolPaymentProvider> Providers = new() { ["fake"] = new FakeSchoolPaymentProvider(), ["razorpay"] = new RazorpaySchoolPaymentProvider() };
    public static async Task InitializeFees()
    {
        await using var c = await Open();
        await E(c, File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "FeesSchema.sql")));
    }
    static decimal Rupees(long minor) => minor / 100m;
    static DateOnly DayOf(JsonObject r, string key) => DateOnly.FromDateTime(r[key]!.GetValue<DateTime>());
    /// <summary>Every charge of the school (or one student) with payments received and the later concessions that apply; one query each, no per-row lookups.</summary>
    static async Task<List<Ledger>> LedgerRows(NpgsqlConnection c, Guid school, Guid? student = null)
    {
        var rows = await Q(c, """
            SELECT ch.id,ch.student_id AS student,s.first_name || ' ' || s.last_name AS name,s.current_class AS class,ch.description,ch.structure_id AS structure,ch.due_date AS due,ch.gross,ch.concession,ch.fine,ch.status,ch.currency,ch.created_at AS created,ch.note,
            COALESCE((SELECT sum(p.amount) FROM suite.payments p WHERE p.charge_id=ch.id AND p.school_id=ch.school_id AND p.status='Completed'),0) AS paid
            FROM suite.charges ch JOIN student_db.students s ON s.id=ch.student_id AND s.school_id=ch.school_id
            WHERE ch.school_id=@s AND (@student::uuid IS NULL OR ch.student_id=@student) ORDER BY ch.due_date,ch.created_at
            """, ("s", school), ("student", student));
        var concessions = await Q(c, "SELECT student_id AS student,charge_id AS charge,kind,value,effective_from AS \"from\",effective_to AS \"to\" FROM suite.concessions WHERE school_id=@s AND status='Active' AND (@student::uuid IS NULL OR student_id=@student)", ("s", school), ("student", student));
        var list = new List<Ledger>();
        foreach (var r in rows)
        {
            long gross = (long)Number(r, "gross"), concession = (long)Number(r, "concession"), fine = (long)Number(r, "fine"); var due = DayOf(r, "due"); long later = 0;
            foreach (var x in concessions.Where(x => Text(x, "student") == Text(r, "student") && (Text(x, "charge") == "" || Text(x, "charge") == Text(r, "id"))))
            {
                DateOnly? from = x["from"] is null ? null : DayOf(x, "from"), to = x["to"] is null ? null : DayOf(x, "to");
                if (FeeRules.Applies(from, to, due)) later += FeeRules.ConcessionAmount(Text(x, "kind"), (long)Number(x, "value"), gross - concession - later);
            }
            list.Add(new(Guid.Parse(Text(r, "id")), Guid.Parse(Text(r, "student")), Text(r, "name"), Text(r, "class"), Text(r, "description"), Guid.Parse(Text(r, "structure")), due, gross, concession, later, fine, Text(r, "status"), (long)Number(r, "paid"), Text(r, "currency"), r["created"]!.GetValue<DateTime>(), Text(r, "note")));
        }
        return list;
    }
    static JsonObject LedgerView(Ledger l, DateOnly today) => new()
    {
        ["id"] = l.Id, ["studentId"] = l.StudentId, ["student"] = l.Student, ["class"] = l.Class, ["description"] = l.Description, ["structureId"] = l.StructureId, ["dueDate"] = l.Due.ToString("yyyy-MM-dd"),
        ["gross"] = Rupees(l.Gross), ["concession"] = Rupees(l.Concession + l.Later), ["issueConcession"] = Rupees(l.Concession), ["laterConcession"] = Rupees(l.Later), ["fine"] = Rupees(l.Fine), ["net"] = Rupees(l.Net), ["paid"] = Rupees(l.Paid),
        ["balance"] = Rupees(l.Outstanding), ["outstanding"] = Rupees(l.Outstanding), ["status"] = l.Status, ["state"] = FeeRules.State(l.Status, l.Net, l.Paid, l.Due, today), ["overdue"] = FeeRules.IsOverdue(l.Status, l.Net, l.Paid, l.Due, today), ["currency"] = l.Currency, ["note"] = l.Note,
    };
    static JsonObject Totals(IEnumerable<Ledger> rows, DateOnly today)
    {
        var list = rows.ToList(); var active = list.Where(l => l.Status == "Active").ToList();
        return new JsonObject
        {
            ["charges"] = list.Count, ["applicable"] = Rupees(active.Sum(l => l.Gross)), ["concessions"] = Rupees(active.Sum(l => l.Concession + l.Later)), ["fines"] = Rupees(active.Sum(l => l.Fine)), ["net"] = Rupees(active.Sum(l => l.Net)),
            ["paid"] = Rupees(active.Sum(l => Math.Min(l.Paid, l.Net))), ["outstanding"] = Rupees(active.Sum(l => l.Outstanding)), ["overdue"] = Rupees(active.Where(l => FeeRules.IsOverdue(l.Status, l.Net, l.Paid, l.Due, today)).Sum(l => l.Outstanding)),
            ["overdueCount"] = active.Count(l => FeeRules.IsOverdue(l.Status, l.Net, l.Paid, l.Due, today)), ["waived"] = list.Count(l => l.Status == "Waived"), ["currency"] = list.Select(l => l.Currency).FirstOrDefault() ?? "",
        };
    }
    /// <summary>The figures Student 360 and the family screens show for one student: the same ledger, summarised.</summary>
    static async Task<JsonObject> LedgerSummary(NpgsqlConnection c, Guid school, Guid student, DateOnly today)
    {
        var rows = await LedgerRows(c, school, student); var totals = Totals(rows, today);
        var payments = await Q(c, "SELECT p.id::text AS id,p.receipt,p.amount/100.0 AS amount,p.method,p.status,p.source,p.paid_on AS \"paidOn\",ch.description,ch.currency FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id AND ch.school_id=p.school_id WHERE p.school_id=@s AND ch.student_id=@id ORDER BY p.paid_on DESC,p.created_at DESC LIMIT 5", ("s", school), ("id", student));
        totals["available"] = true; totals["recentPayments"] = new JsonArray(payments.Select(p => (JsonNode)p.DeepClone()).ToArray());
        totals["nextDue"] = rows.Where(l => l.Status == "Active" && l.Outstanding > 0).OrderBy(l => l.Due).Select(l => (JsonNode?)new JsonObject { ["description"] = l.Description, ["dueDate"] = l.Due.ToString("yyyy-MM-dd"), ["outstanding"] = Rupees(l.Outstanding) }).FirstOrDefault();
        return totals;
    }
    static async Task<SchoolPaymentConfig> PaymentConfigOf(NpgsqlConnection c, Guid school)
    {
        var row = (await Q(c, "SELECT provider,merchant_reference AS merchant,online_enabled AS online,settlement_status AS settlement FROM suite.school_payment_config WHERE school_id=@s", ("s", school))).FirstOrDefault();
        var provider = row is null ? "none" : Text(row, "provider"); var merchant = row is null ? "" : Text(row, "merchant"); var online = row is not null && row["online"]?.GetValue<bool>() == true; var settlement = row is null ? "NotReady" : Text(row, "settlement");
        var connection = Providers.TryGetValue(provider, out var p) ? p.ConnectionStatus(new(school, provider, merchant, "NotConnected", online, settlement)) : "NotConnected";
        return new(school, provider, merchant, connection, online && connection == "Connected", settlement);
    }
    static JsonObject ConfigView(SchoolPaymentConfig k) => new() { ["provider"] = k.Provider, ["merchantReference"] = k.MerchantReference, ["connectionStatus"] = k.ConnectionStatus, ["onlineEnabled"] = k.OnlineEnabled, ["settlementStatus"] = k.SettlementStatus, ["providers"] = new JsonArray("none", "fake", "razorpay"), ["note"] = "Credentials are never stored here. The fake provider is for testing; Razorpay waits for the school onboarding decision." };
    static bool Office(SchoolAccess a) => a.SchoolWide && a.Can("fees.view");
    static bool Finance(SchoolAccess a) => a.SchoolWide && a.Can("fees.manage");
    static void RequireStudent(SchoolAccess a, Guid student) => Require(a.SchoolWide || a.Students.Contains(student.ToString()), "This student is outside your scope.", 403);
    static async Task<string> UserName(NpgsqlConnection c, Guid school, string? id) => string.IsNullOrEmpty(id) ? "" : (await Q(c, "SELECT COALESCE(first_name || ' ' || last_name,username) AS name FROM auth_db.users WHERE school_id=@s AND id=@u", ("s", school), ("u", Guid.Parse(id)))).Select(r => Text(r, "name")).FirstOrDefault() ?? "";

    static void MapFinance(RouteGroupBuilder group)
    {
        // The ledger as every reader sees it: the office the school, a family its own students; teachers never.
        group.MapGet("/fees", async (HttpContext http, Guid? studentId = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role is "Parent" or "Student", "Fee access is limited to administrators and linked families.", 403);
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            return Results.Ok(new { data = (await LedgerRows(c, a.School, studentId)).Where(l => a.SchoolWide || a.Students.Contains(l.StudentId.ToString())).Select(l => LedgerView(l, today)) });
        });
        // One student's whole picture: totals, every charge with its state, concessions, paged payments, and whether online payment is open.
        group.MapGet("/fees/ledger/{studentId:guid}", async (Guid studentId, HttpContext http, int page = 1, int pageSize = 20) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role is "Parent" or "Student", "Fee access is limited to administrators and linked families.", 403); RequireStudent(a, studentId);
            var today = DateOnly.FromDateTime(DateTime.UtcNow); var rows = await LedgerRows(c, a.School, studentId); var size = Math.Clamp(pageSize, 1, 100); var p = Math.Max(1, page);
            var pupil = (await Q(c, "SELECT id::text AS id,first_name || ' ' || last_name AS name,roll_number AS \"admissionNumber\",current_class AS class FROM student_db.students WHERE id=@id AND school_id=@s AND deleted_at IS NULL", ("id", studentId), ("s", a.School))).FirstOrDefault(); Require(pupil is not null, "Student not found.", 404);
            var payments = await Q(c, "SELECT p.id::text AS id,p.receipt,p.amount/100.0 AS amount,p.method,p.reference,p.status,p.source,p.note,p.paid_on AS \"paidOn\",p.created_at AS \"createdAt\",p.reversal_reason AS \"reversalReason\",p.reversed_at AS \"reversedAt\",ch.description,ch.currency,count(*) OVER() AS total FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id AND ch.school_id=p.school_id WHERE p.school_id=@s AND ch.student_id=@id ORDER BY p.paid_on DESC,p.created_at DESC LIMIT @take OFFSET @skip", ("s", a.School), ("id", studentId), ("take", size), ("skip", (p - 1) * size));
            var total = payments.Count == 0 ? 0 : (int)Number(payments[0], "total"); foreach (var x in payments) x.Remove("total");
            var concessions = Office(a) ? await Q(c, "SELECT id::text AS id,charge_id::text AS \"chargeId\",kind,value,reason,effective_from AS \"from\",effective_to AS \"to\",status,created_at AS \"createdAt\" FROM suite.concessions WHERE school_id=@s AND student_id=@id ORDER BY created_at DESC", ("s", a.School), ("id", studentId)) : [];
            foreach (var x in concessions) x["value"] = Text(x, "kind") == "Percent" ? (decimal)Number(x, "value") / 100 : Rupees((long)Number(x, "value"));
            var config = await PaymentConfigOf(c, a.School);
            return Results.Ok(new { data = new { student = pupil, totals = Totals(rows, today), charges = rows.Select(l => LedgerView(l, today)), payments = new { items = payments, total, page = p, pageSize = size, more = p * size < total }, concessions, online = new { enabled = config.OnlineEnabled, provider = config.Provider } } });
        });
        group.MapPost("/fees/charges", async (JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Admin && a.Can("fees.manage"), "Only administrators may issue charges.", 403);
            var student = Id(d, "studentId"); await Reference(c, a, "students", student.ToString());
            await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
            var structure = await Get(c, a.School, "fee-structures", Id(d, "structureId")); await InClass(c, a.School, student, Id(structure, "classId"));
            Require(Text(structure, "studentId") == "" || Text(structure, "studentId") == student.ToString(), "This fee structure is for another student.");
            var gross = Cents(structure, "amount"); var concession = Cents(d, "concession"); Require(concession <= gross, "Concession cannot exceed the charge.");
            var config = (await Records(c, a.School, "school-config")).FirstOrDefault(); var currency = config is null ? "INR" : Text(config, "currency");
            var id = Guid.NewGuid();
            await E(c, "INSERT INTO suite.charges(id,school_id,student_id,structure_id,description,due_date,gross,concession,currency,created_by,note) VALUES(@id,@s,@student,@structure,@desc,@due,@gross,@concession,@currency,@user,@note)",
                ("id", id), ("s", a.School), ("student", student), ("structure", Id(d, "structureId")), ("desc", Text(structure, "name") + " · " + Text(structure, "installment")), ("due", Day(structure, "dueDate")), ("gross", gross), ("concession", concession), ("currency", currency), ("user", a.User), ("note", Text(d, "note").Length > 300 ? Text(d, "note")[..300] : Text(d, "note")));
            await tx.CommitAsync();
            await AnnounceCharge(a, id, student, gross - concession, currency, Day(structure, "dueDate")); return Results.Json(new { data = new { id } }, statusCode: 201);
        });
        // A plan lays out instalments as fee structures in one go (monthly, quarterly, term-wise, annual or custom); charges are issued from them as usual.
        group.MapPost("/fees/plans", async (JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Admin && a.Can("fees.manage"), "Only administrators may set up fee plans.", 403);
            Require(FeeRules.Frequencies.Contains(Text(d, "frequency")), "Choose a valid frequency."); var count = d["count"] is JsonValue cv && cv.TryGetValue<int>(out var n) ? n : 1;
            var instalments = FeeRules.Instalments(Text(d, "frequency"), Day(d, "firstDueDate"), count); var ids = new JsonArray();
            foreach (var (label, due) in instalments)
            {
                var record = new JsonObject { ["name"] = Text(d, "name"), ["headId"] = Text(d, "headId"), ["yearId"] = Text(d, "yearId"), ["classId"] = Text(d, "classId"), ["studentId"] = Text(d, "studentId"), ["amount"] = d["amount"]?.DeepClone(), ["installment"] = label, ["frequency"] = Text(d, "frequency"), ["dueDate"] = due.ToString("yyyy-MM-dd") };
                var result = await Save("fee-structures", null, record, http); if (result is IStatusCodeHttpResult { StatusCode: 201 }) ids.Add(label);
            }
            return Results.Json(new { data = new { created = ids.Count, instalments = ids } }, statusCode: 201);
        });
        group.MapPost("/fees/payments", async (JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Admin && a.Can("fees.collect"), "Only administrators may record payments.", 403);
            var idempotency = Id(d, "idempotencyKey"); var charge = Id(d, "chargeId"); var amount = Cents(d, "amount"); var method = Text(d, "method"); var reference = Text(d, "reference"); var paidOn = Day(d, "paidOn"); var note = Text(d, "note");
            Require(note.Length <= 300, "The note is too long.");
            await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", a.School.ToString()));
            // The same request twice (a double click, a retried call) answers with the first receipt; a different request with the same key is refused.
            var previous = await Q(c, "SELECT id,receipt,charge_id,amount,method,reference,paid_on::text FROM suite.payments WHERE school_id=@s AND idempotency_key=@key", ("s", a.School), ("key", idempotency));
            if (previous.Count > 0) { var p = previous[0]; Require(Text(p, "charge_id") == charge.ToString() && Number(p, "amount") == amount && Text(p, "method") == method && Text(p, "reference") == reference && Text(p, "paid_on") == paidOn.ToString("yyyy-MM-dd"), "This payment request identifier was already used for different details.", 409); await tx.CommitAsync(); return Results.Ok(new { data = new { id = Text(p, "id"), receipt = Text(p, "receipt") } }); }
            var row = (await LedgerRows(c, a.School)).FirstOrDefault(l => l.Id == charge); Require(row is not null, "Charge not found.", 404); Require(row!.Status == "Active", "This charge is " + row.Status.ToLowerInvariant() + " and takes no payment.", 409);
            var problem = FeeRules.PaymentProblem(amount, row.Outstanding, method, reference, paidOn, DateOnly.FromDateTime(DateTime.UtcNow)); Require(problem is null, problem ?? "", problem == "Payment exceeds the outstanding balance." ? 409 : 400);
            var id = Guid.NewGuid(); var receipt = await NextNumber(c, a.School, "receipt", "RCPT");
            await E(c, "INSERT INTO suite.payments(id,school_id,charge_id,amount,method,reference,paid_on,receipt,idempotency_key,created_by,note,status,source) VALUES(@id,@s,@charge,@amount,@method,@ref,@date,@receipt,@key,@user,@note,'Completed','manual')",
                ("id", id), ("s", a.School), ("charge", charge), ("amount", amount), ("method", method), ("ref", reference), ("date", paidOn), ("receipt", receipt), ("key", idempotency), ("user", a.User), ("note", note));
            await tx.CommitAsync();
            await AnnouncePayment(a, id, row.StudentId, amount, row.Currency, receipt, row.Description); return Results.Json(new { data = new { id, receipt } }, statusCode: 201);
        });
        // A payment is never deleted: a reversal keeps the row, marks it, records who and why, and the balance reopens.
        group.MapPost("/fees/payments/{id:guid}/reverse", async (Guid id, JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Finance(a), "Only the school office may reverse a payment.", 403);
            var reason = Text(d, "reason"); var p = (await Q(c, "SELECT status FROM suite.payments WHERE id=@id AND school_id=@s", ("id", id), ("s", a.School))).FirstOrDefault(); Require(p is not null, "Payment not found.", 404);
            var problem = FeeRules.ReversalProblem(Text(p!, "status"), reason); Require(problem is null, problem ?? "", problem == "Only a completed payment can be reversed." ? 409 : 400);
            await E(c, "UPDATE suite.payments SET status='Reversed',reversed_by=@u,reversed_at=now(),reversal_reason=@r,updated_by=@u WHERE id=@id AND school_id=@s AND status='Completed'", ("u", a.User), ("r", reason.Trim()), ("id", id), ("s", a.School));
            return Results.Ok(new { data = new { id, status = "Reversed" } });
        });
        // A charge is waived or cancelled with a reason, never deleted; a charge with payments cannot be cancelled.
        group.MapPost("/fees/charges/{id:guid}/status", async (Guid id, JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Finance(a), "Only the school office may change a charge.", 403);
            var row = (await LedgerRows(c, a.School)).FirstOrDefault(l => l.Id == id); Require(row is not null, "Charge not found.", 404);
            var to = Text(d, "status"); var reason = Text(d, "reason"); var problem = FeeRules.ChargeStatusProblem(row!.Status, to, row.Paid, reason); Require(problem is null, problem ?? "", problem is not null && problem.StartsWith("A charge with payments") ? 409 : 400);
            await E(c, "UPDATE suite.charges SET status=@to,note=@note,updated_by=@u,updated_at=now() WHERE id=@id AND school_id=@s", ("to", to), ("note", (to == "Active" ? "Reactivated: " : to + ": ") + reason.Trim()), ("u", a.User), ("id", id), ("s", a.School));
            return Results.Ok(new { data = new { id, status = to } });
        });
        group.MapGet("/fees/concessions", async (HttpContext http, Guid? studentId = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Office(a), "Concessions are managed by the school office.", 403);
            var rows = await Q(c, "SELECT x.id::text AS id,x.student_id::text AS \"studentId\",s.first_name || ' ' || s.last_name AS student,x.charge_id::text AS \"chargeId\",x.kind,x.value,x.reason,x.effective_from AS \"from\",x.effective_to AS \"to\",x.status,x.created_at AS \"createdAt\",x.revoke_reason AS \"revokeReason\" FROM suite.concessions x JOIN student_db.students s ON s.id=x.student_id AND s.school_id=x.school_id WHERE x.school_id=@s AND (@student::uuid IS NULL OR x.student_id=@student) ORDER BY x.created_at DESC LIMIT 500", ("s", a.School), ("student", studentId));
            foreach (var x in rows) x["value"] = Text(x, "kind") == "Percent" ? (decimal)Number(x, "value") / 100 : Rupees((long)Number(x, "value"));
            return Results.Ok(new { data = rows });
        });
        group.MapPost("/fees/concessions", async (JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Finance(a), "Only the school office may give a concession.", 403);
            var student = Id(d, "studentId"); await Reference(c, a, "students", student.ToString()); var kind = Text(d, "kind");
            var value = kind == "Percent" ? (long)Math.Round(Number(d, "value") * 100, MidpointRounding.AwayFromZero) : Cents(d, "value");
            DateOnly? from = Text(d, "from") == "" ? null : Day(d, "from"), to = Text(d, "to") == "" ? null : Day(d, "to");
            var problem = FeeRules.ConcessionProblem(kind, value, Text(d, "reason"), from, to); Require(problem is null, problem ?? "");
            Guid? charge = Text(d, "chargeId") == "" ? null : Id(d, "chargeId");
            if (charge is not null) Require((await Q(c, "SELECT id FROM suite.charges WHERE id=@id AND school_id=@s AND student_id=@st", ("id", charge), ("s", a.School), ("st", student))).Count == 1, "Charge not found for this student.", 404);
            var id = Guid.NewGuid();
            await E(c, "INSERT INTO suite.concessions(id,school_id,student_id,charge_id,kind,value,reason,effective_from,effective_to,created_by) VALUES(@id,@s,@st,@ch,@kind,@value,@reason,@from,@to,@u)", ("id", id), ("s", a.School), ("st", student), ("ch", charge), ("kind", kind), ("value", value), ("reason", Text(d, "reason").Trim()), ("from", from), ("to", to), ("u", a.User));
            return Results.Json(new { data = new { id } }, statusCode: 201);
        });
        group.MapPost("/fees/concessions/{id:guid}/revoke", async (Guid id, JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Finance(a), "Only the school office may revoke a concession.", 403);
            var reason = Text(d, "reason"); Require(reason.Trim().Length >= 3 && reason.Length <= 300, "Give the reason for revoking the concession.");
            var changed = await E(c, "UPDATE suite.concessions SET status='Revoked',revoked_by=@u,revoked_at=now(),revoke_reason=@r,updated_by=@u WHERE id=@id AND school_id=@s AND status='Active'", ("u", a.User), ("r", reason.Trim()), ("id", id), ("s", a.School));
            Require(changed == 1, "Concession not found or already revoked.", 404); return Results.Ok(new { data = new { id, status = "Revoked" } });
        });
        // Payment history for the office: every payment and reversal, filtered and paged.
        group.MapGet("/fees/history", async (HttpContext http, Guid? studentId = null, string? classId = null, string? from = null, string? to = null, string? method = null, string? status = null, string? search = null, int page = 1, int pageSize = 25) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Office(a), "Payment history is for the school office.", 403);
            var size = Math.Clamp(pageSize, 1, 100); var p = Math.Max(1, page); DateOnly? f = DateOnly.TryParse(from, out var fd) ? fd : null, t = DateOnly.TryParse(to, out var td) ? td : null;
            var rows = await Q(c, """
                SELECT p.id::text AS id,p.receipt,p.amount/100.0 AS amount,p.method,p.reference,p.status,p.source,p.note,p.paid_on AS "paidOn",p.created_at AS "createdAt",p.reversal_reason AS "reversalReason",ch.student_id::text AS "studentId",s.first_name || ' ' || s.last_name AS student,s.current_class AS class,ch.description,ch.currency,
                COALESCE(u.first_name || ' ' || u.last_name,u.username,'') AS "collectedBy",count(*) OVER() AS total
                FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id AND ch.school_id=p.school_id JOIN student_db.students s ON s.id=ch.student_id AND s.school_id=ch.school_id LEFT JOIN auth_db.users u ON u.id=p.created_by AND u.school_id=p.school_id
                WHERE p.school_id=@s AND (@student::uuid IS NULL OR ch.student_id=@student) AND (@class='' OR s.current_class=@class) AND (@from::date IS NULL OR p.paid_on>=@from) AND (@to::date IS NULL OR p.paid_on<=@to)
                AND (@method='' OR p.method=@method) AND (@status='' OR p.status=@status) AND (@search='' OR p.receipt ILIKE @like OR p.reference ILIKE @like OR s.first_name || ' ' || s.last_name ILIKE @like)
                ORDER BY p.paid_on DESC,p.created_at DESC LIMIT @take OFFSET @skip
                """, ("s", a.School), ("student", studentId), ("class", classId ?? ""), ("from", f), ("to", t), ("method", method ?? ""), ("status", status ?? ""), ("search", search ?? ""), ("like", "%" + (search ?? "") + "%"), ("take", size), ("skip", (p - 1) * size));
            var total = rows.Count == 0 ? 0 : (int)Number(rows[0], "total"); foreach (var x in rows) x.Remove("total");
            return Results.Ok(new { data = new { items = rows, total, page = p, pageSize = size, more = p * size < total } });
        });
        group.MapGet("/fees/payments", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role is "Parent" or "Student", "Fee access denied.", 403);
            var rows = await Q(c, "SELECT p.id,p.receipt,p.amount/100.0 AS amount,p.method,p.reference,p.status,p.source,p.paid_on AS \"paidOn\",ch.student_id AS \"studentId\",s.first_name || ' ' || s.last_name AS student,ch.currency FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id JOIN student_db.students s ON s.id=ch.student_id WHERE p.school_id=@s ORDER BY p.created_at DESC LIMIT 500", ("s", a.School));
            return Results.Ok(new { data = rows.Where(r => a.SchoolWide || a.Students.Contains(Text(r, "studentId"))) });
        });
        group.MapGet("/fees/receipts/{id:guid}", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role is "Parent" or "Student", "Fee access denied.", 403);
            var rows = await Q(c, "SELECT p.receipt,p.amount/100.0 AS amount,p.method,p.reference,p.status,p.source,p.note,p.paid_on AS \"paidOn\",p.created_at AS \"createdAt\",p.created_by::text AS \"createdBy\",p.reversal_reason AS \"reversalReason\",p.reversed_at AS \"reversedAt\",ch.student_id AS \"studentId\",s.first_name || ' ' || s.last_name AS student,s.roll_number AS \"admissionNumber\",s.current_class AS class,ch.description,ch.currency,ch.structure_id::text AS \"structureId\" FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id JOIN student_db.students s ON s.id=ch.student_id WHERE p.id=@id AND p.school_id=@s", ("id", id), ("s", a.School));
            Require(rows.Count == 1 && (a.SchoolWide || a.Students.Contains(Text(rows[0], "studentId"))), "Receipt not found.", 404);
            var receipt = rows[0]; receipt["collectedBy"] = await UserName(c, a.School, Text(receipt, "createdBy")); receipt.Remove("createdBy");
            var structure = Guid.TryParse(Text(receipt, "structureId"), out var sid) ? (await Records(c, a.School, "fee-structures")).FirstOrDefault(x => Text(x, "id") == sid.ToString()) : null;
            var years = (await Records(c, a.School, "academic-years")).ToDictionary(x => Text(x, "id")); var heads = (await Records(c, a.School, "fee-heads")).ToDictionary(x => Text(x, "id"));
            receipt["academicYear"] = structure is not null && years.TryGetValue(Text(structure, "yearId"), out var y) ? Text(y, "name") : years.Values.Where(x => Text(x, "status") == "Current").Select(x => Text(x, "name")).FirstOrDefault() ?? "";
            receipt["feeHead"] = structure is not null && heads.TryGetValue(Text(structure, "headId"), out var h) ? Text(h, "name") : "";
            return Results.Ok(new { data = new { receipt, school = await SchoolPrint(c, a.School) } });
        });
        group.MapPost("/fees/{id:guid}/remind", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Admin && a.Can("fees.manage"), "Only administrators can send reminders.", 403);
            var row = (await LedgerRows(c, a.School)).FirstOrDefault(l => l.Id == id); Require(row is not null, "Charge not found.", 404); Require(row!.Outstanding > 0, "This charge has no outstanding balance.", 409);
            var count = await NotifyStudent(c, a, row.StudentId, "Fee reminder", row.Description + ": outstanding " + row.Currency + " " + Rupees(row.Outstanding).ToString("0.00", CultureInfo.InvariantCulture) + ". Please contact the school accounts office.", "fee:" + id + ":" + DateTime.UtcNow.ToString("yyyy-MM-dd"));
            return Results.Ok(new { data = new { sent = count }, message = count > 0 ? count + " in-app reminders made available." : "No new reminders: link a parent/student account, or a reminder was already issued today." });
        });
        // Reports for the office: a day's collection, what is outstanding, dues by class, and the leadership summary.
        group.MapGet("/fees/reports/daily", async (HttpContext http, DateOnly? day = null) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Office(a), "Collection reports are for the school office.", 403); var d = day ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var rows = await Q(c, "SELECT p.id::text AS id,p.receipt,p.amount/100.0 AS amount,p.method,p.status,p.source,s.first_name || ' ' || s.last_name AS student,s.current_class AS class,ch.description,ch.currency,COALESCE(u.first_name || ' ' || u.last_name,u.username,'') AS \"collectedBy\" FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id AND ch.school_id=p.school_id JOIN student_db.students s ON s.id=ch.student_id AND s.school_id=ch.school_id LEFT JOIN auth_db.users u ON u.id=p.created_by AND u.school_id=p.school_id WHERE p.school_id=@s AND p.paid_on=@d ORDER BY p.created_at", ("s", a.School), ("d", d));
            var completed = rows.Where(r => Text(r, "status") == "Completed").ToList(); var byMethod = new JsonObject(); foreach (var g in completed.GroupBy(r => Text(r, "method"))) byMethod[g.Key] = g.Sum(r => Number(r, "amount"));
            return Results.Ok(new { data = new { day = d.ToString("yyyy-MM-dd"), total = completed.Sum(r => Number(r, "amount")), count = completed.Count, reversed = rows.Count(r => Text(r, "status") == "Reversed"), byMethod, transactions = rows, currency = rows.Select(r => Text(r, "currency")).FirstOrDefault() ?? "" } });
        });
        group.MapGet("/fees/reports/outstanding", async (HttpContext http, string? classId = null, bool overdueOnly = false, int page = 1, int pageSize = 50) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Office(a), "Outstanding reports are for the school office.", 403); var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var rows = (await LedgerRows(c, a.School)).Where(l => l.Status == "Active" && l.Outstanding > 0 && (string.IsNullOrEmpty(classId) || l.Class == classId) && (!overdueOnly || FeeRules.IsOverdue(l.Status, l.Net, l.Paid, l.Due, today)))
                .GroupBy(l => l.StudentId).Select(g => new JsonObject { ["studentId"] = g.Key, ["student"] = g.First().Student, ["class"] = g.First().Class, ["applicable"] = Rupees(g.Sum(l => l.Net)), ["paid"] = Rupees(g.Sum(l => Math.Min(l.Paid, l.Net))), ["outstanding"] = Rupees(g.Sum(l => l.Outstanding)), ["overdue"] = Rupees(g.Where(l => FeeRules.IsOverdue(l.Status, l.Net, l.Paid, l.Due, today)).Sum(l => l.Outstanding)), ["charges"] = g.Count(), ["currency"] = g.First().Currency })
                .OrderByDescending(r => Number(r, "outstanding")).ToList();
            var size = Math.Clamp(pageSize, 1, 200); var p = Math.Max(1, page);
            return Results.Ok(new { data = new { items = rows.Skip((p - 1) * size).Take(size), total = rows.Count, page = p, pageSize = size, more = p * size < rows.Count, outstanding = rows.Sum(r => Number(r, "outstanding")), overdue = rows.Sum(r => Number(r, "overdue")) } });
        });
        group.MapGet("/fees/reports/classes", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Office(a), "Dues by class are for the school office.", 403); var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var rows = (await LedgerRows(c, a.School)).Where(l => l.Status == "Active").GroupBy(l => l.Class).Select(g => new { @class = g.Key, students = g.Select(l => l.StudentId).Distinct().Count(), applicable = Rupees(g.Sum(l => l.Net)), paid = Rupees(g.Sum(l => Math.Min(l.Paid, l.Net))), outstanding = Rupees(g.Sum(l => l.Outstanding)), overdue = Rupees(g.Where(l => FeeRules.IsOverdue(l.Status, l.Net, l.Paid, l.Due, today)).Sum(l => l.Outstanding)), currency = g.First().Currency }).OrderBy(r => r.@class).ToList();
            return Results.Ok(new { data = rows });
        });
        group.MapGet("/fees/summary", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Office(a), "The fee summary is for the school office.", 403); var today = DateOnly.FromDateTime(DateTime.UtcNow); var monthStart = new DateOnly(today.Year, today.Month, 1);
            var rows = await LedgerRows(c, a.School); var totals = Totals(rows, today);
            var collected = (await Q(c, "SELECT COALESCE(sum(amount) FILTER(WHERE paid_on=@d),0) AS today,COALESCE(sum(amount) FILTER(WHERE paid_on>=@m),0) AS month,count(*) FILTER(WHERE status='Reversed' AND paid_on>=@m) AS reversed FROM suite.payments WHERE school_id=@s AND status='Completed' OR (school_id=@s AND status='Reversed')", ("s", a.School), ("d", today), ("m", monthStart))).First();
            var recent = await Q(c, "SELECT p.id::text AS id,p.receipt,p.amount/100.0 AS amount,p.method,p.status,p.paid_on AS \"paidOn\",s.first_name || ' ' || s.last_name AS student,ch.currency FROM suite.payments p JOIN suite.charges ch ON ch.id=p.charge_id AND ch.school_id=p.school_id JOIN student_db.students s ON s.id=ch.student_id AND s.school_id=ch.school_id WHERE p.school_id=@s ORDER BY p.created_at DESC LIMIT 10", ("s", a.School));
            var byClass = rows.Where(l => l.Status == "Active").GroupBy(l => l.Class).Select(g => new { @class = g.Key, outstanding = Rupees(g.Sum(l => l.Outstanding)), overdue = Rupees(g.Where(l => FeeRules.IsOverdue(l.Status, l.Net, l.Paid, l.Due, today)).Sum(l => l.Outstanding)), paid = Rupees(g.Sum(l => Math.Min(l.Paid, l.Net))) }).OrderByDescending(r => r.outstanding).Take(12).ToList();
            return Results.Ok(new { data = new { collectedToday = Rupees((long)Number(collected, "today")), collectedThisMonth = Rupees((long)Number(collected, "month")), reversalsThisMonth = (int)Number(collected, "reversed"), totals, byClass, recent, online = ConfigView(await PaymentConfigOf(c, a.School)) } });
        });
        // The school's payment relationship: read by the office, changed by the administrator. Never a credential.
        group.MapGet("/fees/payment-config", async (HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(Office(a), "Payment settings are for the school office.", 403);
            return Results.Ok(new { data = ConfigView(await PaymentConfigOf(c, a.School)) });
        });
        group.MapPut("/fees/payment-config", async (JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.Admin && a.Can("fees.manage"), "Only administrators may change payment settings.", 403);
            var provider = Text(d, "provider"); Require(provider == "none" || Providers.ContainsKey(provider), "Choose a supported provider."); var merchant = Text(d, "merchantReference"); Require(merchant.Length <= 120, "The merchant reference is too long.");
            var online = d["onlineEnabled"] is JsonValue v && v.TryGetValue<bool>(out var o) && o; Require(!online || provider != "none", "Choose a provider before switching online payments on.");
            await E(c, "INSERT INTO suite.school_payment_config(school_id,provider,merchant_reference,online_enabled,updated_by) VALUES(@s,@p,@m,@o,@u) ON CONFLICT(school_id) DO UPDATE SET provider=excluded.provider,merchant_reference=excluded.merchant_reference,online_enabled=excluded.online_enabled,updated_by=excluded.updated_by,updated_at=now()", ("s", a.School), ("p", provider), ("m", merchant), ("o", online), ("u", a.User));
            var config = await PaymentConfigOf(c, a.School);
            await E(c, "UPDATE suite.school_payment_config SET connection_status=@c,settlement_status=@st WHERE school_id=@s", ("c", config.ConnectionStatus), ("st", config.ConnectionStatus == "Connected" ? "Ready" : "NotReady"), ("s", a.School));
            return Results.Ok(new { data = ConfigView(await PaymentConfigOf(c, a.School)) });
        });
        // An online payment attempt by the family (or the office on their behalf): an order with the school's provider, pending until the provider confirms.
        group.MapPost("/fees/online/intents", async (JsonObject d, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c); Require(a.SchoolWide || a.Role is "Parent" or "Student", "Fee access is limited to administrators and linked families.", 403);
            var config = await PaymentConfigOf(c, a.School); Require(config.OnlineEnabled, "Online payments are not enabled for this school. Payments can be recorded at the school office.", 409);
            var charge = Id(d, "chargeId"); var row = (await LedgerRows(c, a.School)).FirstOrDefault(l => l.Id == charge); Require(row is not null, "Charge not found.", 404); RequireStudent(a, row!.StudentId);
            var amount = d["amount"] is null ? row.Outstanding : Cents(d, "amount"); Require(row.Status == "Active" && amount > 0 && amount <= row.Outstanding, "The amount must be within the outstanding balance.", 409);
            var id = Guid.NewGuid(); var order = await Providers[config.Provider].CreateOrder(config, id, amount, row.Currency);
            await E(c, "INSERT INTO suite.payment_intents(id,school_id,student_id,charge_id,amount,currency,provider,provider_order,created_by) VALUES(@id,@s,@st,@ch,@a,@cur,@p,@o,@u)", ("id", id), ("s", a.School), ("st", row.StudentId), ("ch", charge), ("a", amount), ("cur", row.Currency), ("p", config.Provider), ("o", order.Reference), ("u", a.User));
            return Results.Json(new { data = new { id, status = "Pending", provider = config.Provider, orderReference = order.Reference, amount = Rupees(amount), currency = row.Currency, instructions = order.Instructions } }, statusCode: 201);
        });
        group.MapGet("/fees/online/intents/{id:guid}", async (Guid id, HttpContext http) =>
        {
            await using var c = await Open(); var a = await Access(http, c);
            var row = (await Q(c, "SELECT id::text AS id,student_id::text AS \"studentId\",status,provider,provider_order AS \"orderReference\",provider_payment AS \"paymentReference\",amount/100.0 AS amount,currency,failure,payment_id::text AS \"paymentId\",created_at AS \"createdAt\",verified_at AS \"verifiedAt\" FROM suite.payment_intents WHERE id=@id AND school_id=@s", ("id", id), ("s", a.School))).FirstOrDefault();
            Require(row is not null && (a.SchoolWide || a.Students.Contains(Text(row, "studentId"))), "Payment attempt not found.", 404);
            return Results.Ok(new { data = row });
        });
    }
    /// <summary>
    /// The provider's confirmation, outside any session: the event is verified with the school's provider, recorded once,
    /// and only then does a payment and its receipt exist. A repeated event answers "already processed" and changes nothing.
    /// </summary>
    public static void MapFeeWebhooks(WebApplication app)
    {
        app.MapPost("/api/fees/webhooks/{provider}", async (string provider, HttpContext http) =>
        {
            if (!Providers.TryGetValue(provider, out var adapter)) return Results.NotFound(new { message = "Unknown provider." });
            using var reader = new StreamReader(http.Request.Body); var body = await reader.ReadToEndAsync(); if (body.Length > 64 * 1024) return Results.BadRequest(new { message = "Event too large." });
            await using var c = await Open();
            // The order reference names the attempt, and the attempt names the school; the school's own configuration verifies the event.
            string? orderRef = null; try { orderRef = (JsonNode.Parse(body) as JsonObject)?["orderReference"]?.ToString(); } catch (JsonException) { }
            var intent = string.IsNullOrEmpty(orderRef) ? null : (await Q(c, "SELECT id,school_id AS school,student_id AS student,charge_id AS charge,amount,currency,status FROM suite.payment_intents WHERE provider=@p AND provider_order=@o", ("p", provider), ("o", orderRef))).FirstOrDefault();
            if (intent is null) return Results.NotFound(new { message = "Unknown payment attempt." });
            var school = Guid.Parse(Text(intent, "school")); var config = await PaymentConfigOf(c, school);
            var ev = adapter.Parse(config, http.Request.Headers["X-Signature"].FirstOrDefault(), body); if (ev is null) return Results.Unauthorized();
            await using var tx = await c.BeginTransactionAsync(); await E(c, "SELECT pg_advisory_xact_lock(hashtextextended(@s,0))", ("s", school.ToString()));
            var outcome = ev.Status == "captured" ? "captured" : "failed";
            if (await E(c, "INSERT INTO suite.payment_events(school_id,provider,event_id,intent_id,outcome) VALUES(@s,@p,@e,@i,@o) ON CONFLICT DO NOTHING", ("s", school), ("p", provider), ("e", ev.EventId), ("i", Guid.Parse(Text(intent, "id"))), ("o", outcome)) == 0) { await tx.CommitAsync(); return Results.Ok(new { data = new { status = "already-processed" } }); }
            var current = (await Q(c, "SELECT status FROM suite.payment_intents WHERE id=@id FOR UPDATE", ("id", Guid.Parse(Text(intent, "id"))))).First();
            var to = outcome == "captured" ? "Verified" : "Failed"; var move = FeeRules.IntentTransition(Text(current, "status"), to);
            if (move is not null || Text(current, "status") == to) { await tx.CommitAsync(); return Results.Ok(new { data = new { status = "already-decided" } }); }
            var intentId = Guid.Parse(Text(intent, "id")); var expected = (long)Number(intent, "amount");
            if (outcome == "captured" && (ev.Amount != expected || (ev.Currency != "" && ev.Currency != Text(intent, "currency"))))
            { await E(c, "UPDATE suite.payment_intents SET status='Failed',failure='Amount or currency did not match the attempt',provider_event=@e WHERE id=@id", ("e", ev.EventId), ("id", intentId)); await tx.CommitAsync(); return Results.Ok(new { data = new { status = "rejected" } }); }
            if (outcome == "failed") { await E(c, "UPDATE suite.payment_intents SET status='Failed',failure='Provider reported failure',provider_event=@e,provider_payment=@pp WHERE id=@id", ("e", ev.EventId), ("pp", ev.PaymentReference), ("id", intentId)); await tx.CommitAsync(); return Results.Ok(new { data = new { status = "failed" } }); }
            var charge = Guid.Parse(Text(intent, "charge")); var paymentId = Guid.NewGuid(); var receipt = await NextNumber(c, school, "receipt", "RCPT");
            await E(c, "INSERT INTO suite.payments(id,school_id,charge_id,amount,method,reference,paid_on,receipt,idempotency_key,created_by,status,source,provider,provider_order,provider_payment,provider_event) VALUES(@id,@s,@ch,@a,'Online',@ref,@d,@r,@key,@u,'Completed','online',@p,@o,@pp,@e)",
                ("id", paymentId), ("s", school), ("ch", charge), ("a", expected), ("ref", ev.PaymentReference), ("d", DateOnly.FromDateTime(DateTime.UtcNow)), ("r", receipt), ("key", intentId), ("u", Guid.Parse(Text(intent, "student")) is var st ? st : Guid.Empty), ("p", provider), ("o", ev.OrderReference), ("pp", ev.PaymentReference), ("e", ev.EventId));
            await E(c, "UPDATE suite.payment_intents SET status='Verified',verified_at=now(),provider_payment=@pp,provider_event=@e,payment_id=@pay WHERE id=@id", ("pp", ev.PaymentReference), ("e", ev.EventId), ("pay", paymentId), ("id", intentId));
            await tx.CommitAsync();
            var row = (await LedgerRows(c, school)).FirstOrDefault(l => l.Id == charge);
            if (row is not null) await AnnouncePayment(new SchoolAccess { School = school, User = Guid.Parse(Text(intent, "student")), Role = "Administrator" }, paymentId, row.StudentId, expected, row.Currency, receipt, row.Description);
            Log.Information("Online fee payment verified for school {School}, attempt {Intent}, receipt {Receipt}", school, intentId, receipt);
            return Results.Ok(new { data = new { status = "verified", receipt } });
        }).AllowAnonymous();
    }
}

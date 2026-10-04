using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;

// Fees & Collections: net payable and states in whole minor units, concessions, payments and reversals, instalment
// plans, the online attempt's state machine, the fake provider's signature check, and a source guard that every
// financial statement names the school and nothing is ever deleted.
public class FeeRulesTests
{
    static readonly DateOnly Today = new(2026, 10, 5);

    [Fact]
    public void NetPayableNeverGoesBelowZeroAndFinesAreAddedAfterRelief()
    {
        Assert.Equal(90000, FeeRules.Net(100000, 10000, 0, 0, 0));
        Assert.Equal(0, FeeRules.Net(100000, 60000, 50000, 0, 0));
        Assert.Equal(500, FeeRules.Net(100000, 0, 0, 100000, 500));
        Assert.Equal(65000, FeeRules.Net(100000, 10000, 15000, 10000, 0));
    }

    [Fact]
    public void ConcessionsAreBasisPointsOrFixedAndNeverExceedWhatIsLeft()
    {
        Assert.Equal(2500, FeeRules.ConcessionAmount("Percent", 2500, 10000));     // 25% of 100.00
        Assert.Equal(3334, FeeRules.ConcessionAmount("Percent", 3333, 10003));     // rounded half away from zero, in paise
        Assert.Equal(10000, FeeRules.ConcessionAmount("Percent", 10000, 10000));
        Assert.Equal(4000, FeeRules.ConcessionAmount("Fixed", 4000, 10000)); Assert.Equal(10000, FeeRules.ConcessionAmount("Fixed", 50000, 10000)); Assert.Equal(0, FeeRules.ConcessionAmount("Fixed", 4000, 0));
        Assert.Null(FeeRules.ConcessionProblem("Percent", 1000, "Sibling discount", null, null));
        Assert.Equal("A percentage concession cannot exceed 100%.", FeeRules.ConcessionProblem("Percent", 10001, "x y z", null, null));
        Assert.Equal("Give the reason for the concession.", FeeRules.ConcessionProblem("Fixed", 100, "", null, null));
        Assert.Equal("The concession must end on or after it starts.", FeeRules.ConcessionProblem("Fixed", 100, "Scholarship", new(2026, 6, 1), new(2026, 5, 1)));
        Assert.Equal("A concession is a percentage or a fixed amount.", FeeRules.ConcessionProblem("Half", 100, "Scholarship", null, null));
        Assert.True(FeeRules.Applies(null, null, Today)); Assert.True(FeeRules.Applies(new(2026, 4, 1), new(2027, 3, 31), Today)); Assert.False(FeeRules.Applies(new(2026, 11, 1), null, Today)); Assert.False(FeeRules.Applies(null, new(2026, 9, 30), Today));
    }

    [Theory]
    [InlineData("Active", 10000, 0, "2026-10-20", "Unpaid")][InlineData("Active", 10000, 4000, "2026-10-20", "Partial")][InlineData("Active", 10000, 10000, "2026-09-01", "Paid")]
    [InlineData("Active", 10000, 0, "2026-10-04", "Overdue")][InlineData("Active", 10000, 4000, "2026-10-04", "Overdue")][InlineData("Active", 0, 0, "2026-09-01", "Paid")]
    [InlineData("Waived", 10000, 0, "2026-09-01", "Waived")][InlineData("Cancelled", 10000, 0, "2026-09-01", "Cancelled")]
    public void AChargeHasOneStateForTheReader(string status, long net, long paid, string due, string state)
    {
        var d = DateOnly.Parse(due);
        Assert.Equal(state, FeeRules.State(status, net, paid, d, Today));
        Assert.Equal(state == "Overdue", FeeRules.IsOverdue(status, net, paid, d, Today));
    }

    [Fact]
    public void PaymentsStayWithinTheBalanceWithAReferenceWhereOneIsNeeded()
    {
        Assert.Null(FeeRules.PaymentProblem(5000, 10000, "Cash", "", Today, Today));
        Assert.Null(FeeRules.PaymentProblem(10000, 10000, "UPI", "UPI-123", Today, Today));
        Assert.Equal("Payment exceeds the outstanding balance.", FeeRules.PaymentProblem(10001, 10000, "Cash", "", Today, Today));
        Assert.Equal("Payment amount must be positive.", FeeRules.PaymentProblem(0, 10000, "Cash", "", Today, Today));
        Assert.Equal("Choose a valid payment method.", FeeRules.PaymentProblem(100, 10000, "Card", "", Today, Today));
        Assert.Equal("A bank / UPI / cheque reference is required.", FeeRules.PaymentProblem(100, 10000, "Cheque", "", Today, Today));
        Assert.Null(FeeRules.PaymentProblem(100, 10000, "Other", "", Today, Today));
        Assert.Equal("Payment date cannot be in the future.", FeeRules.PaymentProblem(100, 10000, "Cash", "", Today.AddDays(2), Today));
        Assert.Equal(new[] { "Cash", "UPI", "Bank transfer", "Cheque", "Other" }, FeeRules.Methods);
    }

    [Fact]
    public void ReversalsAndStatusChangesNeedAReasonAndNeverEraseAPayment()
    {
        Assert.Null(FeeRules.ReversalProblem("Completed", "Entered against the wrong student"));
        Assert.Equal("Only a completed payment can be reversed.", FeeRules.ReversalProblem("Reversed", "Entered twice"));
        Assert.Equal("Give the reason for the reversal.", FeeRules.ReversalProblem("Completed", "no"));
        Assert.Null(FeeRules.ChargeStatusProblem("Active", "Waived", 0, "Scholarship awarded"));
        Assert.Null(FeeRules.ChargeStatusProblem("Active", "Active", 0, ""));
        Assert.Equal("A charge with payments cannot be cancelled; reverse the payments first or waive the balance.", FeeRules.ChargeStatusProblem("Active", "Cancelled", 500, "Issued in error"));
        Assert.Equal("Give the reason for the change.", FeeRules.ChargeStatusProblem("Active", "Cancelled", 0, ""));
        Assert.Equal("Choose Active, Waived or Cancelled.", FeeRules.ChargeStatusProblem("Active", "Deleted", 0, "x y z"));
    }

    [Fact]
    public void PlansLayOutInstalmentsWithDueDates()
    {
        var monthly = FeeRules.Instalments("Monthly", new(2026, 4, 10), 3);
        Assert.Equal(new[] { "April 2026", "May 2026", "June 2026" }, monthly.Select(i => i.Label)); Assert.Equal(new DateOnly(2026, 6, 10), monthly[2].Due);
        var quarterly = FeeRules.Instalments("Quarterly", new(2026, 4, 1), 4); Assert.Equal(4, quarterly.Count); Assert.Equal(new DateOnly(2027, 1, 1), quarterly[3].Due); Assert.Equal("Quarter 4", quarterly[3].Label);
        var term = FeeRules.Instalments("Term", new(2026, 6, 1), 3); Assert.Equal(new DateOnly(2027, 2, 1), term[2].Due);
        Assert.Single(FeeRules.Instalments("Annual", new(2026, 4, 1), 12)); Assert.Single(FeeRules.Instalments("One-time", new(2026, 4, 1), 5));
        Assert.Equal(24, FeeRules.Instalments("Custom", new(2026, 4, 1), 99).Count); Assert.Equal("Instalment 2", FeeRules.Instalments("Custom", new(2026, 4, 1), 2)[1].Label);
        Assert.Throws<ArgumentException>(() => FeeRules.Instalments("Weekly", new(2026, 4, 1), 2));
    }

    [Fact]
    public void AnOnlineAttemptIsDecidedOnceByTheProviderAndTheFakeProviderChecksTheSignature()
    {
        Assert.Null(FeeRules.IntentTransition("Pending", "Verified")); Assert.Null(FeeRules.IntentTransition("Pending", "Failed")); Assert.Null(FeeRules.IntentTransition("Verified", "Verified"));
        Assert.Equal("This payment attempt was already decided.", FeeRules.IntentTransition("Verified", "Failed")); Assert.Equal("This payment attempt was already decided.", FeeRules.IntentTransition("Failed", "Verified"));
        Assert.Equal("Unknown payment state.", FeeRules.IntentTransition("Pending", "Paid"));
        var config = new SchoolPaymentConfig(Guid.NewGuid(), "fake", "acc_test", "Connected", true, "Ready");
        var provider = new FakeSchoolPaymentProvider(() => "test-secret"); var body = "{\"eventId\":\"evt_1\",\"orderReference\":\"fake_abc\",\"paymentReference\":\"pay_1\",\"amount\":150000,\"currency\":\"INR\",\"status\":\"captured\"}";
        Assert.Equal("Connected", provider.ConnectionStatus(config)); Assert.Equal("NotConnected", new FakeSchoolPaymentProvider(() => null).ConnectionStatus(config));
        var ev = provider.Parse(config, FeeRules.Hmac(body, "test-secret"), body);
        Assert.NotNull(ev); Assert.Equal("evt_1", ev!.EventId); Assert.Equal(150000, ev.Amount); Assert.Equal("captured", ev.Status);
        Assert.Null(provider.Parse(config, FeeRules.Hmac(body, "other-secret"), body)); Assert.Null(provider.Parse(config, null, body)); Assert.Null(provider.Parse(config, FeeRules.Hmac("{", "test-secret"), "{"));
        Assert.Null(new FakeSchoolPaymentProvider(() => null).Parse(config, FeeRules.Hmac(body, ""), body));   // no secret: nothing verifies
        var order = provider.CreateOrder(config, Guid.Empty, 100, "INR", "Tuition").Result; Assert.StartsWith("fake_", order.Reference); Assert.Equal("X-Signature", provider.SignatureHeader); Assert.Equal("", provider.PublicKeyId); Assert.False(provider.VerifyCheckout("a", "b", "c"));
        Assert.Equal("fake_abc", provider.OrderReferenceOf(body)); Assert.Null(provider.OrderReferenceOf("{"));
    }

    static readonly RazorpaySchoolSettings TestKeys = new("Test", "rzp_test_abc123", "test-key-secret", "test-webhook-secret", "https://razorpay.test");
    static RazorpaySchoolPaymentProvider Razorpay(RazorpaySchoolSettings? s = null, HttpMessageHandler? handler = null) => new(() => s ?? TestKeys, handler);
    static readonly SchoolPaymentConfig RzpConfig = new(Guid.Parse("11111111-1111-4111-8111-111111111111"), "razorpay", "acc_test", "Connected", true, "Ready");

    [Fact]
    public void RazorpayRunsInTestModeOnlyAndRefusesAnythingLive()
    {
        Assert.True(TestKeys.TestMode); Assert.True(TestKeys.Usable); Assert.False(TestKeys.Live);
        Assert.Equal("Connected", Razorpay().ConnectionStatus(RzpConfig)); Assert.Equal("rzp_test_abc123", Razorpay().PublicKeyId);
        foreach (var bad in new[] { TestKeys with { Mode = "Live" }, TestKeys with { KeyId = "rzp_live_abc123" }, TestKeys with { Mode = "" }, TestKeys with { Mode = "Production" }, TestKeys with { KeySecret = "" }, TestKeys with { KeyId = "abc" } })
        {
            Assert.False(bad.Usable); Assert.Equal("NotConnected", Razorpay(bad).ConnectionStatus(RzpConfig)); Assert.Equal("", Razorpay(bad).PublicKeyId);
            var ex = Assert.ThrowsAsync<SuiteError>(() => Razorpay(bad).CreateOrder(RzpConfig, Guid.NewGuid(), 100, "INR", "Tuition")).Result; Assert.Equal(503, ex.Status);
            if (bad.Live) Assert.Contains("live mode is not permitted", ex.Message);
        }
        Assert.Equal("X-Razorpay-Signature", Razorpay().SignatureHeader); Assert.Equal("razorpay", Razorpay().Name);
    }

    sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? Last; public string? Body;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { Last = request; Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(token); return respond(request); }
    }

    [Fact]
    public void RazorpayOrdersCarryTheServerAmountAndTheTestKeyNeverTheSecretInTheBody()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent("{\"id\":\"order_test_77\",\"amount\":150000,\"currency\":\"INR\",\"status\":\"created\"}") });
        var intent = Guid.NewGuid(); var order = Razorpay(handler: handler).CreateOrder(RzpConfig, intent, 150000, "INR", "Tuition · Term 1").Result;
        Assert.Equal("order_test_77", order.Reference); Assert.Contains("no real money", order.Instructions);
        Assert.Equal("https://razorpay.test/v1/orders", handler.Last!.RequestUri!.ToString()); Assert.Equal("Basic", handler.Last.Headers.Authorization!.Scheme);
        var sent = JsonNode.Parse(handler.Body!)!.AsObject();
        Assert.Equal(150000, (long)sent["amount"]!.GetValue<decimal>()); Assert.Equal("INR", sent["currency"]!.ToString()); Assert.Equal(intent.ToString("N"), sent["receipt"]!.ToString()); Assert.Equal("test", sent["notes"]!["eduos_mode"]!.ToString());
        Assert.DoesNotContain("test-key-secret", handler.Body); Assert.DoesNotContain("test-webhook-secret", handler.Body);
        var refused = new StubHandler(_ => new HttpResponseMessage(System.Net.HttpStatusCode.BadRequest) { Content = new StringContent("{\"error\":{}}") });
        Assert.Equal(502, Assert.ThrowsAsync<SuiteError>(() => Razorpay(handler: refused).CreateOrder(RzpConfig, intent, 100, "INR", "x")).Result.Status);
        var odd = new StubHandler(_ => new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent("{\"id\":\"pay_notanorder\"}") });
        Assert.Equal(502, Assert.ThrowsAsync<SuiteError>(() => Razorpay(handler: odd).CreateOrder(RzpConfig, intent, 100, "INR", "x")).Result.Status);
    }

    [Fact]
    public void TheBrowserResultIsVerifiedWithTheKeySecretInConstantTimeAndNothingElseIsTrusted()
    {
        var p = Razorpay(); var good = FeeRules.Hmac("order_test_77|pay_test_9", "test-key-secret");
        Assert.True(p.VerifyCheckout("order_test_77", "pay_test_9", good)); Assert.True(p.VerifyCheckout("order_test_77", "pay_test_9", good.ToUpperInvariant()));
        Assert.False(p.VerifyCheckout("order_test_78", "pay_test_9", good));                       // another order
        Assert.False(p.VerifyCheckout("order_test_77", "pay_test_8", good));                       // another payment
        Assert.False(p.VerifyCheckout("order_test_77", "pay_test_9", FeeRules.Hmac("order_test_77|pay_test_9", "other")));
        Assert.False(p.VerifyCheckout("order_test_77", "pay_test_9", "")); Assert.False(p.VerifyCheckout("", "pay_test_9", good)); Assert.False(p.VerifyCheckout("order_test_77", "pay_test_9", good[..10]));
        Assert.False(Razorpay(TestKeys with { KeySecret = "" }).VerifyCheckout("order_test_77", "pay_test_9", good));
        Assert.True(FeeRules.SignatureMatches("x", "k", FeeRules.Hmac("x", "k"))); Assert.False(FeeRules.SignatureMatches("x", "k", null)); Assert.False(FeeRules.SignatureMatches("x", "", FeeRules.Hmac("x", "")));
    }

    [Fact]
    public void RazorpayWebhooksAreVerifiedWithTheWebhookSecretAndOnlyPaymentEventsDecideAnAttempt()
    {
        var p = Razorpay(); string Body(string ev, string status = "captured") => "{\"event\":\"" + ev + "\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_test_9\",\"order_id\":\"order_test_77\",\"amount\":150000,\"currency\":\"INR\",\"status\":\"" + status + "\"}}}}";
        var captured = Body("payment.captured"); var sig = FeeRules.Hmac(captured, "test-webhook-secret");
        Assert.Equal("order_test_77", p.OrderReferenceOf(captured)); Assert.Null(p.OrderReferenceOf("{")); Assert.Null(p.OrderReferenceOf("{\"event\":\"x\"}"));
        var ev = p.Parse(RzpConfig, sig, captured); Assert.NotNull(ev);
        Assert.Equal("captured", ev!.Status); Assert.Equal("pay_test_9:payment.captured", ev.EventId); Assert.Equal("order_test_77", ev.OrderReference); Assert.Equal("pay_test_9", ev.PaymentReference); Assert.Equal(150000, ev.Amount); Assert.Equal("INR", ev.Currency);
        Assert.Null(p.Parse(RzpConfig, FeeRules.Hmac(captured, "test-key-secret"), captured));         // the key secret is not the webhook secret
        Assert.Null(p.Parse(RzpConfig, sig, captured + " "));                                           // the body must be the signed bytes
        Assert.Null(p.Parse(RzpConfig, null, captured)); Assert.Null(Razorpay(TestKeys with { WebhookSecret = "" }).Parse(RzpConfig, sig, captured));
        var failed = Body("payment.failed", "failed"); Assert.Equal("failed", p.Parse(RzpConfig, FeeRules.Hmac(failed, "test-webhook-secret"), failed)!.Status);
        var paid = Body("order.paid"); Assert.Equal("captured", p.Parse(RzpConfig, FeeRules.Hmac(paid, "test-webhook-secret"), paid)!.Status);
        var other = Body("payment.authorized", "authorized"); Assert.Equal("ignored", p.Parse(RzpConfig, FeeRules.Hmac(other, "test-webhook-secret"), other)!.Status);
        var refund = "{\"event\":\"refund.created\",\"payload\":{\"refund\":{\"entity\":{\"id\":\"rfnd_1\"}}}}"; Assert.Equal("ignored", p.Parse(RzpConfig, FeeRules.Hmac(refund, "test-webhook-secret"), refund)!.Status);
    }

    [Fact]
    public void EveryFinancialStatementNamesTheSchoolAndNothingIsDeleted()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "Suite.Fees.cs"));
        var uses = Regex.Matches(text, @"\b(FROM|JOIN|UPDATE|INTO)\s+(suite\.\w+|student_db\.students|auth_db\.users)").ToList();
        Assert.True(uses.Count >= 20);
        foreach (Match use in uses)
        {
            var end = text.IndexOf('"', use.Index); var sql = text[use.Index..(end < 0 ? text.Length : end)];
            // The webhook finds the attempt by its provider order, which is unique across the system, and then works within that attempt's school.
            var insert = use.Groups[1].Value == "INTO" && sql.Contains("school_id") && sql.Contains("@s");   // every insert names the school column and binds it to the token's school
            Assert.True(insert || sql.Contains("school_id=@s") || sql.Contains("school_id=ch.school_id") || sql.Contains("school_id=p.school_id") || sql.Contains("provider=@p AND provider_order=@o") || sql.Contains("WHERE id=@id") && sql.Contains("payment_intents"), $"not bound to the school: {sql[..Math.Min(100, sql.Length)]}");
        }
        Assert.DoesNotContain("DELETE FROM", text); Assert.DoesNotContain("DROP ", text);
        Assert.Contains("ON CONFLICT DO NOTHING", text);                          // a repeated provider event is recorded once
        Assert.Contains("status='Reversed'", text); Assert.DoesNotContain("DELETE FROM suite.payments", text);
        // Secrets stay server-side: the checkout gets the public key id only, no log line carries a key, and the platform's billing keys are never read here.
        Assert.Contains("keyId = adapter.PublicKeyId", text); Assert.DoesNotContain("\"RAZORPAY_KEY", text); Assert.DoesNotContain("KeySecret}", text); Assert.DoesNotContain("KeySecret);", text.Replace("s.KeyId + \":\" + s.KeySecret)", ""));
        var schema = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sources", "FeesSchema.sql"));
        Assert.DoesNotContain("DROP ", schema); Assert.Contains("IF NOT EXISTS", schema);
        Assert.DoesNotMatch(@"(?i)(secret|api_key|token)\w*\s+(varchar|text|bytea)", schema);   // no credential column anywhere in the fee ledger
    }
}

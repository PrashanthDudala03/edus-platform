using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using EduOS.ServiceAuth;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Services.Auth.Data;

public record PlanRow(Guid Id,string Name,string Description,string Status,string BillingPeriod,long BasePrice,string Currency,int TrialDays,string[] Features,int DisplayOrder,bool Highlighted);
public record OfferRule(Guid Id,string Name,string? Code,string DiscountType,long DiscountValue,string Currency,DateTimeOffset StartsAt,DateTimeOffset EndsAt,string Status,Guid[] PlanIds,Guid[] SchoolIds,bool NewCustomersOnly,int? MaxUses,int Used);
public record Quote(long BasePrice,long Discount,long FinalAmount,string Currency,Guid? OfferId,string? OfferName);
public record PaymentRow(Guid Id,Guid SchoolId,Guid PlanId,Guid? OfferId,string ProviderOrderId,long BaseAmount,long Discount,long Amount,string Currency,string BillingPeriod,string Status);
public record PriceRow(Guid PlanId,long Price);
public record PlanInput(string? Name,string? Description,string? Status,string? BillingPeriod,long BasePrice,string? Currency,int TrialDays,string[]? Features,int DisplayOrder,bool Highlighted);
public record OfferInput(string? Name,string? Code,string? Description,string? DiscountType,long DiscountValue,string? Currency,DateTimeOffset StartsAt,DateTimeOffset EndsAt,string? Status,Guid[]? PlanIds,Guid[]? SchoolIds,bool NewCustomersOnly,int? MaxUses);
public record BannerInput(string? Title,string? Message,string? CtaLabel,string? CtaUrl,string? Placement,bool Enabled,DateTimeOffset StartsAt,DateTimeOffset EndsAt);
public record SubscriptionAction(string? Action,Guid? PlanId,int? Days,string? Note);
public record PriceOverride(long? Price,string? Note);
public record BillingSettings(int GraceDays);
public record CheckoutInput(Guid PlanId,string? Coupon);
public record VerifyInput(string? OrderId,string? PaymentId,string? Signature);
public record RazorpaySettings(string KeyId,string KeySecret,string WebhookSecret,string ApiBase) { public bool Configured => KeyId.Length>0 && KeySecret.Length>0; }

/// <summary>The only place a payable amount is calculated. Clients never supply one.</summary>
public static class Pricing
{
    public static string? Rejection(OfferRule o,Guid plan,Guid school,string currency,bool newCustomer,DateTimeOffset now) =>
        o.Status!="Active" ? "This offer is not active." :
        now<o.StartsAt ? "This offer has not started yet." :
        now>=o.EndsAt ? "This offer has expired." :
        o.PlanIds.Length>0 && !o.PlanIds.Contains(plan) ? "This offer does not apply to the selected plan." :
        o.SchoolIds.Length>0 && !o.SchoolIds.Contains(school) ? "This offer is not available to your school." :
        o.NewCustomersOnly && !newCustomer ? "This offer is for new customers only." :
        o.MaxUses is int max && o.Used>=max ? "This offer has been fully redeemed." :
        o.DiscountType=="fixed" && o.Currency!=currency ? "This offer does not apply to this currency." : null;

    // Clamped so that no configuration can produce a negative price.
    public static long Discount(OfferRule o,long price) =>
        Math.Clamp(o.DiscountType=="percent" ? price*Math.Clamp(o.DiscountValue,0,100)/100 : o.DiscountValue,0,price);

    /// <summary>Base price, replaced by the school price when one is set, less the best eligible offer.</summary>
    public static Quote Calculate(long planPrice,long? schoolPrice,string currency,IEnumerable<OfferRule> offers,string? coupon,Guid plan,Guid school,bool newCustomer,DateTimeOffset now)
    {
        var price=schoolPrice??planPrice; Iam.Check(price>=0,"Invalid price.");
        var list=offers.ToList(); OfferRule? chosen=null;
        if(!string.IsNullOrWhiteSpace(coupon))
        {
            chosen=list.FirstOrDefault(o=>o.Code!=null && o.Code.Equals(coupon.Trim(),StringComparison.OrdinalIgnoreCase));
            Iam.Check(chosen!=null,"This coupon code is not valid.");
            var reason=Rejection(chosen!,plan,school,currency,newCustomer,now); Iam.Check(reason==null,reason??"");
        }
        var automatic=list.Where(o=>o.Code==null && Rejection(o,plan,school,currency,newCustomer,now)==null).OrderByDescending(o=>Discount(o,price)).FirstOrDefault();
        if(automatic!=null && (chosen==null || Discount(automatic,price)>Discount(chosen,price))) chosen=automatic;
        var discount=chosen==null ? 0 : Discount(chosen,price);
        return new Quote(price,discount,price-discount,currency,chosen?.Id,chosen?.Name);
    }
}

public static class Razorpay
{
    static string Hmac(string data,string secret) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret),Encoding.UTF8.GetBytes(data))).ToLowerInvariant();
    static bool Same(string expected,string? actual) => actual!=null && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected),Encoding.UTF8.GetBytes(actual.Trim().ToLowerInvariant()));
    public static bool ValidPayment(string orderId,string paymentId,string? signature,string keySecret) => keySecret.Length>0 && Same(Hmac(orderId+"|"+paymentId,keySecret),signature);
    public static bool ValidWebhook(string body,string? signature,string webhookSecret) => webhookSecret.Length>0 && Same(Hmac(body,webhookSecret),signature);
    public static object OrderRequest(Quote quote,Guid paymentId,Guid school,Guid plan) =>
        new { amount=quote.FinalAmount, currency=quote.Currency, receipt="eduos_"+paymentId.ToString("N"), notes=new { school_id=school.ToString(), plan_id=plan.ToString() } };
}

/// <summary>
/// Plans, offers, school subscriptions and payments. /api/billing is platform-only; /api/subscription is the
/// school's own read and purchase view. Access can always be granted by the platform without any payment.
/// </summary>
public static class Billing
{
    static readonly JsonSerializerOptions Web=new(JsonSerializerDefaults.Web);
    static readonly HttpClient Http=new(){Timeout=TimeSpan.FromSeconds(15)};
    static readonly string[] Periods=["monthly","quarterly","yearly"], Placements=["login","pricing","admin-dashboard","subscription"];
    const long MaxAmount=10_000_000_000;
    const string All="00000000-0000-0000-0000-000000000000";

    const string PlanJson="""SELECT row_to_json(x)::text AS "Value" FROM (SELECT id,name,description,status,billing_period AS "billingPeriod",base_price AS "basePrice",currency,trial_days AS "trialDays",features,display_order AS "displayOrder",highlighted FROM billing.plans ORDER BY display_order,name) x""";
    const string OfferJson="""SELECT row_to_json(x)::text AS "Value" FROM (SELECT id,name,code,description,discount_type AS "discountType",discount_value AS "discountValue",currency,starts_at AS "startsAt",ends_at AS "endsAt",status,plan_ids AS "planIds",school_ids AS "schoolIds",new_customers_only AS "newCustomersOnly",max_uses AS "maxUses",used,CASE WHEN status<>'Active' THEN status WHEN now()<starts_at THEN 'Scheduled' WHEN now()>=ends_at THEN 'Expired' ELSE 'Active' END AS state FROM billing.offers ORDER BY starts_at DESC,name) x""";
    const string BannerJson="""SELECT row_to_json(x)::text AS "Value" FROM (SELECT id,title,message,cta_label AS "ctaLabel",cta_url AS "ctaUrl",placement,enabled,starts_at AS "startsAt",ends_at AS "endsAt" FROM billing.banners ORDER BY starts_at DESC) x""";
    const string SubscriptionJson="""
        SELECT row_to_json(x)::text AS "Value" FROM (SELECT s.id AS "schoolId",s.name AS "schoolName",COALESCE(s.is_active,TRUE) AS "schoolActive",b.plan_id AS "planId",p.name AS "planName",
        b.status,b.previous_status AS "previousStatus",b.starts_at AS "startsAt",b.ends_at AS "endsAt",b.billing_period AS "billingPeriod",COALESCE(b.base_price,0) AS "basePrice",
        COALESCE(b.discount,0) AS discount,COALESCE(b.final_amount,0) AS "finalAmount",COALESCE(b.currency,'INR') AS currency,b.payment_state AS "paymentState",b.note,b.updated_at AS "updatedAt",
        (SELECT COALESCE(json_agg(json_build_object('planId',sp.plan_id,'price',sp.price,'note',sp.note)),'[]'::json) FROM billing.school_prices sp WHERE sp.school_id=s.id) AS overrides
        FROM school_db.schools s LEFT JOIN billing.subscriptions b ON b.school_id=s.id LEFT JOIN billing.plans p ON p.id=b.plan_id
        WHERE s.deleted_at IS NULL AND s.id<>{0} AND (s.id={1} OR {1}='00000000-0000-0000-0000-000000000000') ORDER BY s.name) x
        """;
    const string PaymentJson="""
        SELECT row_to_json(x)::text AS "Value" FROM (SELECT p.id,p.school_id AS "schoolId",s.name AS "schoolName",pl.name AS "planName",p.provider,p.provider_order_id AS "providerOrderId",
        p.provider_payment_id AS "providerPaymentId",p.base_amount AS "baseAmount",p.discount,p.amount,p.currency,p.billing_period AS "billingPeriod",p.status,p.failure_reason AS "failureReason",
        p.receipt_no AS "receiptNo",p.created_at AS "createdAt",p.verified_at AS "verifiedAt"
        FROM billing.payments p JOIN school_db.schools s ON s.id=p.school_id JOIN billing.plans pl ON pl.id=p.plan_id
        WHERE (p.school_id={0} OR {0}='00000000-0000-0000-0000-000000000000') ORDER BY p.created_at DESC LIMIT 200) x
        """;

    public static int Months(string? period) => period switch { "monthly"=>1, "quarterly"=>3, _=>12 };
    /// <summary>Expiry never deletes or blocks anything by itself: a lapsed subscription is in grace, then Expired.</summary>
    public static string Effective(string status,DateTimeOffset? endsAt,int graceDays,DateTimeOffset now) =>
        status=="Cancelled" || endsAt==null || endsAt>now ? status : now<endsAt.Value.AddDays(graceDays) ? "Grace Period" : "Expired";

    public static async Task Initialize(AuthDbContext db)
    {
        var sql=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Migrations/20261002_01_billing.sql"));
        await using var tx=await db.Database.BeginTransactionAsync(); await Iam.Lock(db);
        await db.Database.ExecuteSqlRawAsync(sql.Replace("{","{{").Replace("}","}}")); await tx.CommitAsync();
    }

    static async Task<List<T>> Read<T>(AuthDbContext db,string sql,params object[] args) =>
        (await db.Database.SqlQueryRaw<string>(sql,args).ToListAsync()).Select(x=>JsonSerializer.Deserialize<T>(x,Web)!).ToList();
    static async Task<int> Grace(AuthDbContext db) => (await db.Database.SqlQuery<int>($"SELECT grace_days AS \"Value\" FROM billing.settings").ToListAsync())[0];
    static RazorpaySettings Rzp(IConfiguration c) => new(c["RAZORPAY_KEY_ID"]?.Trim()??"",c["RAZORPAY_KEY_SECRET"]?.Trim()??"",c["RAZORPAY_WEBHOOK_SECRET"]?.Trim()??"",
        (c["RAZORPAY_API_BASE"]?.Trim() is {Length:>0} api ? api : "https://api.razorpay.com").TrimEnd('/'));
    static Task SchoolLock(AuthDbContext db,Guid school) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"billing:"+school},0))");

    static async Task<List<JsonObject>> Subscriptions(AuthDbContext db,Guid school)
    {
        var grace=await Grace(db); var now=DateTimeOffset.UtcNow;
        var rows=await Read<JsonObject>(db,SubscriptionJson,EduOSTenants.Platform,school);
        foreach(var row in rows)
            row["effectiveStatus"]=row["status"] is null ? "None" : Effective(row["status"]!.GetValue<string>(),row["endsAt"]?.GetValue<DateTimeOffset>(),grace,now);
        return rows;
    }

    sealed record Pricer(List<OfferRule> Offers,Dictionary<Guid,long> Overrides,bool NewCustomer,Guid School)
    {
        public Quote Quote(PlanRow plan,string? coupon) =>
            Pricing.Calculate(plan.BasePrice,Overrides.TryGetValue(plan.Id,out var price) ? price : null,plan.Currency,Offers,coupon,plan.Id,School,NewCustomer,DateTimeOffset.UtcNow);
    }
    static async Task<Pricer> PricerFor(AuthDbContext db,Guid school)
    {
        var overrides=await Read<PriceRow>(db,"""SELECT row_to_json(x)::text AS "Value" FROM (SELECT plan_id AS "planId",price FROM billing.school_prices WHERE school_id={0}) x""",school);
        var paid=(await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM billing.payments WHERE school_id={school} AND status='Paid'").ToListAsync())[0];
        return new Pricer(await Read<OfferRule>(db,OfferJson),overrides.ToDictionary(o=>o.PlanId,o=>o.Price),paid==0,school);
    }

    // A renewal of a running subscription on the same plan starts when the current period ends; anything else starts now.
    static Task Activate(AuthDbContext db,Guid school,Guid plan,string period,Quote quote,string paymentState,Guid? actor) =>
        db.Database.ExecuteSqlInterpolatedAsync($"""
        INSERT INTO billing.subscriptions AS b(school_id,plan_id,status,starts_at,ends_at,billing_period,base_price,discount,final_amount,currency,payment_state,modified_by)
        VALUES({school},{plan},'Active',now(),now()+make_interval(months=>{Months(period)}),{period},{quote.BasePrice},{quote.Discount},{quote.FinalAmount},{quote.Currency},{paymentState},{actor})
        ON CONFLICT(school_id) DO UPDATE SET
        ends_at=CASE WHEN b.status='Active' AND b.plan_id=EXCLUDED.plan_id AND b.ends_at>now() THEN b.ends_at+make_interval(months=>{Months(period)}) ELSE EXCLUDED.ends_at END,
        starts_at=CASE WHEN b.status='Active' AND b.plan_id=EXCLUDED.plan_id AND b.ends_at>now() THEN b.starts_at ELSE EXCLUDED.starts_at END,
        plan_id=EXCLUDED.plan_id,status='Active',previous_status=NULL,billing_period=EXCLUDED.billing_period,base_price=EXCLUDED.base_price,discount=EXCLUDED.discount,
        final_amount=EXCLUDED.final_amount,currency=EXCLUDED.currency,payment_state=EXCLUDED.payment_state,modified_by=EXCLUDED.modified_by,updated_at=now()
        """);

    static async Task<PaymentRow?> Locked(AuthDbContext db,string orderId) => (await Read<PaymentRow>(db,"""
        SELECT row_to_json(x)::text AS "Value" FROM (SELECT id,school_id AS "schoolId",plan_id AS "planId",offer_id AS "offerId",provider_order_id AS "providerOrderId",
        base_amount AS "baseAmount",discount,amount,currency,billing_period AS "billingPeriod",status FROM billing.payments WHERE provider_order_id={0} FOR UPDATE) x
        """,orderId)).SingleOrDefault();

    // Runs under the payment row lock. A second verification or webhook for a paid order changes nothing.
    static async Task<bool> Settle(AuthDbContext db,PaymentRow payment,string providerPaymentId,TenantContext? actor,string source)
    {
        if(payment.Status=="Paid") return false;
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.payments SET status='Paid',provider_payment_id={providerPaymentId},verified_at=now(),failure_reason=NULL WHERE id={payment.Id}");
        if(payment.OfferId is Guid offer) await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.offers SET used=used+1 WHERE id={offer}");
        await Activate(db,payment.SchoolId,payment.PlanId,payment.BillingPeriod,new Quote(payment.BaseAmount,payment.Discount,payment.Amount,payment.Currency,payment.OfferId,null),"Paid",actor?.UserId);
        await Iam.Audit(db,actor,payment.SchoolId,"billing.payment.verified",payment.Id,new{status=payment.Status},new{status="Paid",source,providerPaymentId,payment.Amount,payment.Currency});
        await Iam.Audit(db,actor,payment.SchoolId,"billing.subscription.activated",payment.SchoolId,null,new{payment.PlanId,payment.BillingPeriod,source});
        return true;
    }

    static Guid Own(HttpContext http,string permission)
    {
        var tenant=http.GetTenant();
        Iam.Check(!tenant.IsPlatform && http.User.HasClaim("permission",permission),"Permission denied.",403);
        return tenant.SchoolId;
    }
    static void Window(DateTimeOffset start,DateTimeOffset end) => Iam.Check(end>start && start.Year is >2000 and <2200 && end.Year is >2000 and <2200,"The end must be after the start.");

    public static void Map(WebApplication app)
    {
        var platform=app.MapGroup("/api/billing").RequireAuthorization(EduOSPolicies.Platform);
        var p=EduOSTenants.Platform;

        platform.MapGet("/overview",async(HttpContext http,AuthDbContext db)=>{
            Iam.Permit(http,"billing.view");
            var subs=await Subscriptions(db,Guid.Empty); var soon=DateTimeOffset.UtcNow.AddDays(30); var now=DateTimeOffset.UtcNow;
            int count(string status)=>subs.Count(s=>s["effectiveStatus"]!.GetValue<string>()==status);
            var revenue=await Read<JsonElement>(db,"""SELECT row_to_json(x)::text AS "Value" FROM (SELECT currency,count(*)::int AS payments,sum(amount)::bigint AS total FROM billing.payments WHERE status='Paid' GROUP BY currency ORDER BY currency) x""");
            var offers=(await Read<OfferRule>(db,OfferJson)).Count(o=>o.Status=="Active" && now>=o.StartsAt && now<o.EndsAt);
            var audit=await Read<JsonElement>(db,"""SELECT row_to_json(x)::text AS "Value" FROM (SELECT a.id,a.action,a.actor_role AS "actorRole",a.created_at AS "createdAt",s.name AS "schoolName" FROM auth_db.iam_audit a LEFT JOIN school_db.schools s ON s.id=a.school_id AND s.id<>{0} WHERE a.action LIKE 'billing.%' ORDER BY a.created_at DESC LIMIT 20) x""",p);
            return Results.Ok(new{data=new{schools=subs.Count,active=count("Active"),trials=count("Trial"),complimentary=count("Complimentary"),grace=count("Grace Period"),expired=count("Expired"),cancelled=count("Cancelled"),none=count("None"),
                expiringSoon=subs.Count(s=>s["effectiveStatus"]!.GetValue<string>() is "Active" or "Trial" or "Complimentary" && s["endsAt"]?.GetValue<DateTimeOffset>()<soon),revenue,activeOffers=offers,audit}});
        });

        platform.MapGet("/plans",async(HttpContext http,AuthDbContext db)=>{Iam.Permit(http,"billing.view");return Results.Ok(new{data=await Read<PlanRow>(db,PlanJson)});});
        platform.MapPost("/plans",(PlanInput input,HttpContext http,AuthDbContext db)=>SavePlan(null,input,http,db));
        platform.MapPut("/plans/{id:guid}",(Guid id,PlanInput input,HttpContext http,AuthDbContext db)=>SavePlan(id,input,http,db));

        platform.MapGet("/offers",async(HttpContext http,AuthDbContext db)=>{Iam.Permit(http,"billing.view");return Results.Ok(new{data=await Read<JsonElement>(db,OfferJson)});});
        platform.MapPost("/offers",(OfferInput input,HttpContext http,AuthDbContext db)=>SaveOffer(null,input,http,db));
        platform.MapPut("/offers/{id:guid}",(Guid id,OfferInput input,HttpContext http,AuthDbContext db)=>SaveOffer(id,input,http,db));

        platform.MapGet("/banners",async(HttpContext http,AuthDbContext db)=>{Iam.Permit(http,"billing.view");return Results.Ok(new{data=await Read<JsonElement>(db,BannerJson)});});
        platform.MapPost("/banners",(BannerInput input,HttpContext http,AuthDbContext db)=>SaveBanner(null,input,http,db));
        platform.MapPut("/banners/{id:guid}",(Guid id,BannerInput input,HttpContext http,AuthDbContext db)=>SaveBanner(id,input,http,db));

        platform.MapGet("/subscriptions",async(HttpContext http,AuthDbContext db)=>{Iam.Permit(http,"billing.view");return Results.Ok(new{data=await Subscriptions(db,Guid.Empty)});});
        platform.MapPost("/schools/{id:guid}/subscription",ChangeSubscription);
        platform.MapPut("/schools/{id:guid}/prices/{planId:guid}",async(Guid id,Guid planId,PriceOverride input,HttpContext http,AuthDbContext db)=>{
            Iam.Permit(http,"billing.subscriptions.manage");
            Iam.Check(input.Price is null or (>=0 and <=MaxAmount) && (input.Note?.Length??0)<=500,"Enter a valid price and a note of at most 500 characters.");
            await using var tx=await db.Database.BeginTransactionAsync(); await SchoolLock(db,id);
            var current=(await Subscriptions(db,id)).SingleOrDefault(); Iam.Check(id!=p && current!=null,"School not found.",404);
            Iam.Check((await Read<PlanRow>(db,PlanJson)).Any(x=>x.Id==planId),"Plan not found.",404);
            var before=current!["overrides"]!.AsArray().FirstOrDefault(o=>o!["planId"]!.GetValue<Guid>()==planId)?["price"]?.GetValue<long>();
            if(input.Price is long price) await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO billing.school_prices(school_id,plan_id,price,note,modified_by) VALUES({id},{planId},{price},{input.Note??""},{http.GetTenant().UserId})
                ON CONFLICT(school_id,plan_id) DO UPDATE SET price=EXCLUDED.price,note=EXCLUDED.note,modified_by=EXCLUDED.modified_by,updated_at=now()
                """);
            else await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.school_prices WHERE school_id={id} AND plan_id={planId}");
            await Iam.Audit(db,http.GetTenant(),id,"billing.price.overridden",planId,new{price=before},new{input.Price,input.Note});
            await tx.CommitAsync(); return Results.Ok(new{message=input.Price==null ? "School price removed; the plan price applies." : "School price saved."});
        });

        platform.MapGet("/payments",async(Guid? school,HttpContext http,AuthDbContext db)=>{Iam.Permit(http,"billing.payments.view");return Results.Ok(new{data=await Read<JsonElement>(db,PaymentJson,school??Guid.Empty)});});
        platform.MapGet("/settings",async(HttpContext http,AuthDbContext db,IConfiguration config)=>{
            Iam.Permit(http,"billing.view");var rzp=Rzp(config);
            return Results.Ok(new{data=new{graceDays=await Grace(db),paymentsEnabled=rzp.Configured,webhookConfigured=rzp.WebhookSecret.Length>0,provider="razorpay",testMode=rzp.KeyId.StartsWith("rzp_test_")}});
        });
        platform.MapPut("/settings",async(BillingSettings input,HttpContext http,AuthDbContext db)=>{
            Iam.Permit(http,"billing.settings.manage");Iam.Check(input.GraceDays is >=0 and <=90,"Grace period must be between 0 and 90 days.");
            await using var tx=await db.Database.BeginTransactionAsync();var before=await Grace(db);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.settings SET grace_days={input.GraceDays}");
            await Iam.Audit(db,http.GetTenant(),p,"billing.settings.changed",null,new{graceDays=before},input);await tx.CommitAsync();return Results.Ok(new{message="Billing settings saved."});
        });

        var school=app.MapGroup("/api/subscription").RequireAuthorization(EduOSPolicies.AnyRole);
        school.MapGet("/current",async(HttpContext http,AuthDbContext db,IConfiguration config)=>{
            var id=Own(http,"subscription.view"); var subscription=(await Subscriptions(db,id)).SingleOrDefault(); Iam.Check(subscription!=null,"School not found.",404);
            subscription!.Remove("overrides"); subscription.Remove("note");
            var pricer=await PricerFor(db,id);
            var plans=(await Read<PlanRow>(db,PlanJson)).Where(x=>x.Status=="Active").Select(x=>new{x.Id,x.Name,x.Description,x.BillingPeriod,x.Currency,x.TrialDays,x.Features,x.Highlighted,listPrice=x.BasePrice,quote=pricer.Quote(x,null)});
            return Results.Ok(new{data=new{subscription,plans,graceDays=await Grace(db),paymentsEnabled=Rzp(config).Configured,canPurchase=http.User.HasClaim("permission","subscription.purchase"),payments=await Read<JsonElement>(db,PaymentJson,id)}});
        });
        school.MapPost("/quote",async(CheckoutInput input,HttpContext http,AuthDbContext db)=>{
            var id=Own(http,"subscription.view"); var plan=(await Read<PlanRow>(db,PlanJson)).SingleOrDefault(x=>x.Id==input.PlanId && x.Status=="Active"); Iam.Check(plan!=null,"Plan is not available.",404);
            return Results.Ok(new{data=(await PricerFor(db,id)).Quote(plan!,input.Coupon)});
        });
        // The body has no amount field: the order is always created from the server's own quote.
        school.MapPost("/checkout",async(CheckoutInput input,HttpContext http,AuthDbContext db,IConfiguration config)=>{
            var id=Own(http,"subscription.purchase"); var rzp=Rzp(config); var actor=http.GetTenant();
            var plan=(await Read<PlanRow>(db,PlanJson)).SingleOrDefault(x=>x.Id==input.PlanId && x.Status=="Active"); Iam.Check(plan!=null,"Plan is not available.",404);
            var quote=(await PricerFor(db,id)).Quote(plan!,input.Coupon);
            if(quote.FinalAmount==0)
            {
                // Nothing to collect: the platform's own price or offer made this plan free for the school.
                await using var free=await db.Database.BeginTransactionAsync(); await SchoolLock(db,id);
                if(quote.OfferId is Guid used) await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.offers SET used=used+1 WHERE id={used}");
                await Activate(db,id,plan!.Id,plan.BillingPeriod,quote,"NotRequired",actor.UserId);
                await Iam.Audit(db,actor,id,"billing.subscription.activated",id,null,new{planId=plan.Id,plan.BillingPeriod,source="zero-amount",quote.OfferId});
                await free.CommitAsync(); return Results.Ok(new{data=new{activated=true}});
            }
            Iam.Check(rzp.Configured,"Online payment is not configured yet. Contact the EduOS platform administrator.",503);
            var paymentId=Guid.NewGuid(); string orderId;
            try
            {
                using var request=new HttpRequestMessage(HttpMethod.Post,rzp.ApiBase+"/v1/orders"){Content=JsonContent.Create(Razorpay.OrderRequest(quote,paymentId,id,plan!.Id))};
                request.Headers.Authorization=new AuthenticationHeaderValue("Basic",Convert.ToBase64String(Encoding.UTF8.GetBytes(rzp.KeyId+":"+rzp.KeySecret)));
                using var response=await Http.SendAsync(request); response.EnsureSuccessStatusCode();
                orderId=(await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString() ?? throw new JsonException("Order id missing.");
                Iam.Check(orderId.Length is >0 and <=64,"The payment provider returned an invalid order.",502);
            }
            catch(Exception ex) when(ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException)
            {
                Log.Warning("Razorpay order creation failed for school {School}: {Error}",id,ex.Message);
                throw new IamError(502,"The payment provider could not be reached. Please try again.");
            }
            await using var tx=await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO billing.payments(id,school_id,plan_id,offer_id,provider_order_id,base_amount,discount,amount,currency,billing_period,created_by)
                VALUES({paymentId},{id},{plan.Id},{quote.OfferId},{orderId},{quote.BasePrice},{quote.Discount},{quote.FinalAmount},{quote.Currency},{plan.BillingPeriod},{actor.UserId})
                """);
            await Iam.Audit(db,actor,id,"billing.payment.created",paymentId,null,new{orderId,quote.FinalAmount,quote.Currency,planId=plan.Id,quote.OfferId});
            await tx.CommitAsync();
            return Results.Ok(new{data=new{paymentId,orderId,amount=quote.FinalAmount,currency=quote.Currency,keyId=rzp.KeyId,plan=plan.Name}});
        });
        school.MapPost("/verify",async(VerifyInput input,HttpContext http,AuthDbContext db,IConfiguration config)=>{
            var id=Own(http,"subscription.purchase"); var actor=http.GetTenant();
            Iam.Check(input.OrderId?.Length is >0 and <=64 && input.PaymentId?.Length is >0 and <=64,"Invalid payment reference.");
            await using var tx=await db.Database.BeginTransactionAsync();
            var payment=await Locked(db,input.OrderId!); Iam.Check(payment!=null && payment.SchoolId==id,"Payment not found.",404);
            if(!Razorpay.ValidPayment(input.OrderId!,input.PaymentId!,input.Signature,Rzp(config).KeySecret))
            {
                await Iam.Audit(db,actor,id,"billing.payment.verification_failed",payment!.Id,null,new{input.OrderId});
                await tx.CommitAsync();
                return Results.Json(new{message="This payment could not be verified, so the subscription was not changed. If money was deducted, it is confirmed automatically once the provider reports it."},statusCode:400);
            }
            var changed=await Settle(db,payment!,input.PaymentId!,actor,"checkout"); await tx.CommitAsync();
            return Results.Ok(new{data=new{status="Paid",alreadyProcessed=!changed}});
        });
        school.MapPost("/payments/{id:guid}/cancel",async(Guid id,HttpContext http,AuthDbContext db)=>{
            var own=Own(http,"subscription.purchase");
            var rows=await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.payments SET status='Cancelled' WHERE id={id} AND school_id={own} AND status='Created'");
            if(rows>0) await Iam.Audit(db,http.GetTenant(),own,"billing.payment.cancelled",id,null,null);
            return Results.Ok(new{data=new{cancelled=rows>0}});
        });

        app.MapGet("/api/promotions",async(string? placement,AuthDbContext db)=>Results.Ok(new{data=await Read<JsonElement>(db,"""
            SELECT row_to_json(x)::text AS "Value" FROM (SELECT id,title,message,cta_label AS "ctaLabel",cta_url AS "ctaUrl",placement FROM billing.banners
            WHERE enabled AND now()>=starts_at AND now()<ends_at AND placement={0} ORDER BY starts_at DESC LIMIT 3) x
            """,placement??"")})).AllowAnonymous();

        // Razorpay calls this without a session; the HMAC over the raw body is the only credential.
        app.MapPost("/api/billing/webhooks/razorpay",async(HttpRequest request,AuthDbContext db,IConfiguration config)=>{
            using var reader=new StreamReader(request.Body,Encoding.UTF8); var body=await reader.ReadToEndAsync();
            if(body.Length>200_000 || !Razorpay.ValidWebhook(body,request.Headers["X-Razorpay-Signature"].FirstOrDefault(),Rzp(config).WebhookSecret))
                return Results.Json(new{message="Invalid signature."},statusCode:400);
            JsonElement root; try { root=JsonSerializer.Deserialize<JsonElement>(body); } catch(JsonException) { return Results.BadRequest(new{message="Invalid payload."}); }
            string? text(JsonElement e,string name) => e.ValueKind==JsonValueKind.Object && e.TryGetProperty(name,out var v) && v.ValueKind==JsonValueKind.String ? v.GetString() : null;
            var name=text(root,"event")??"";
            if(name is not ("payment.captured" or "order.paid" or "payment.failed") || !root.TryGetProperty("payload",out var payload) || payload.ValueKind!=JsonValueKind.Object
                || !payload.TryGetProperty("payment",out var wrapper) || wrapper.ValueKind!=JsonValueKind.Object || !wrapper.TryGetProperty("entity",out var entity))
                return Results.Ok(new{status="ignored"});
            var orderId=text(entity,"order_id"); var paymentId=text(entity,"id");
            if(orderId is not {Length:>0 and <=64} || paymentId is not {Length:>0 and <=64}) return Results.Ok(new{status="ignored"});
            var eventId=request.Headers["X-Razorpay-Event-Id"].FirstOrDefault() is {Length:>0 and <=100} header ? header : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body)));
            await using var tx=await db.Database.BeginTransactionAsync();
            if(await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO billing.webhook_events(event_id,event) VALUES({eventId},{name}) ON CONFLICT DO NOTHING")==0)
                return Results.Ok(new{status="duplicate"});
            var payment=await Locked(db,orderId);
            if(payment==null) { await tx.CommitAsync(); return Results.Ok(new{status="ignored"}); }
            var status="processed";
            if(name=="payment.failed")
            {
                if(payment.Status=="Created")
                {
                    var reason=text(entity,"error_description")??"Payment failed."; if(reason.Length>300) reason=reason[..300];
                    await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.payments SET status='Failed',provider_payment_id={paymentId},failure_reason={reason} WHERE id={payment.Id}");
                    await Iam.Audit(db,null,payment.SchoolId,"billing.payment.failed",payment.Id,new{status="Created"},new{status="Failed",source="webhook"});
                }
            }
            else if(!entity.TryGetProperty("amount",out var amount) || amount.ValueKind!=JsonValueKind.Number || !amount.TryGetInt64(out var paid) || paid!=payment.Amount
                || !string.Equals(text(entity,"currency"),payment.Currency,StringComparison.OrdinalIgnoreCase))
            {
                // Never activate on an amount other than the one this server quoted for the order.
                await Iam.Audit(db,null,payment.SchoolId,"billing.payment.amount_mismatch",payment.Id,new{payment.Amount,payment.Currency},new{source="webhook",paymentId});
                status="mismatch";
            }
            else await Settle(db,payment,paymentId,null,"webhook");
            await tx.CommitAsync(); return Results.Ok(new{status});
        }).AllowAnonymous();
    }

    static async Task<IResult> SavePlan(Guid? id,PlanInput input,HttpContext http,AuthDbContext db)
    {
        Iam.Permit(http,"billing.plans.manage");
        var name=input.Name?.Trim()??""; var currency=(input.Currency??"INR").Trim().ToUpperInvariant(); var features=(input.Features??[]).Select(f=>(f??"").Trim()).Where(f=>f.Length>0).Distinct().ToArray();
        Iam.Check(name.Length is >0 and <=100 && (input.Description?.Length??0)<=1000,"Enter a plan name of up to 100 characters.");
        Iam.Check(input.Status is "Active" or "Disabled" && Periods.Contains(input.BillingPeriod),"Select a valid status and billing period.");
        Iam.Check(input.BasePrice is >=0 and <=MaxAmount && currency.Length==3 && currency.All(char.IsAsciiLetterUpper),"Enter a valid price and a three-letter currency.");
        Iam.Check(input.TrialDays is >=0 and <=365 && features.Length<=50 && features.All(f=>f.Length<=100) && input.DisplayOrder is >=0 and <=1000,"Enter valid trial days, features and display order.");
        await using var tx=await db.Database.BeginTransactionAsync(); await Iam.Lock(db);
        var plans=await Read<PlanRow>(db,PlanJson); var before=plans.SingleOrDefault(x=>x.Id==id);
        Iam.Check(!id.HasValue || before!=null,"Plan not found.",404);
        Iam.Check(!plans.Any(x=>x.Id!=id && x.Name.Equals(name,StringComparison.OrdinalIgnoreCase)),"A plan with this name already exists.",409);
        var key=id??Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO billing.plans(id,name,description,status,billing_period,base_price,currency,trial_days,features,display_order,highlighted)
            VALUES({key},{name},{input.Description??""},{input.Status},{input.BillingPeriod},{input.BasePrice},{currency},{input.TrialDays},{features},{input.DisplayOrder},{input.Highlighted})
            ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,status=EXCLUDED.status,billing_period=EXCLUDED.billing_period,base_price=EXCLUDED.base_price,
            currency=EXCLUDED.currency,trial_days=EXCLUDED.trial_days,features=EXCLUDED.features,display_order=EXCLUDED.display_order,highlighted=EXCLUDED.highlighted,updated_at=now()
            """);
        await Iam.Audit(db,http.GetTenant(),EduOSTenants.Platform,before==null ? "billing.plan.created" : before.BasePrice!=input.BasePrice ? "billing.plan.price_changed" : "billing.plan.changed",key,before,input);
        await tx.CommitAsync(); return Results.Json(new{data=new{id=key}},statusCode:before==null ? 201 : 200);
    }

    static async Task<IResult> SaveOffer(Guid? id,OfferInput input,HttpContext http,AuthDbContext db)
    {
        Iam.Permit(http,"billing.offers.manage");
        var name=input.Name?.Trim()??""; var code=string.IsNullOrWhiteSpace(input.Code) ? null : input.Code.Trim().ToUpperInvariant(); var currency=(input.Currency??"INR").Trim().ToUpperInvariant();
        var planIds=(input.PlanIds??[]).Distinct().ToArray(); var schoolIds=(input.SchoolIds??[]).Distinct().ToArray();
        Iam.Check(name.Length is >0 and <=100 && (input.Description?.Length??0)<=1000,"Enter an offer name of up to 100 characters.");
        Iam.Check(code==null || code.Length is >=3 and <=40 && code.All(c=>char.IsAsciiLetterOrDigit(c) || c is '-' or '_'),"Offer codes use 3 to 40 letters, digits, hyphens or underscores.");
        Iam.Check(input.DiscountType is "percent" or "fixed","Select a percentage or fixed discount.");
        Iam.Check(input.DiscountType=="percent" ? input.DiscountValue is >0 and <=100 : input.DiscountValue is >0 and <=MaxAmount,input.DiscountType=="percent" ? "A percentage discount must be between 1 and 100." : "Enter a fixed discount greater than zero.");
        Iam.Check(input.Status is "Draft" or "Active" or "Disabled" && currency.Length==3 && currency.All(char.IsAsciiLetterUpper),"Select a valid status and currency.");
        Iam.Check(input.MaxUses is null or >0 && planIds.Length<=100 && schoolIds.Length<=1000,"Enter a valid usage limit and selection.");
        Window(input.StartsAt,input.EndsAt);
        await using var tx=await db.Database.BeginTransactionAsync(); await Iam.Lock(db);
        var offers=await Read<OfferRule>(db,OfferJson); var before=offers.SingleOrDefault(o=>o.Id==id);
        Iam.Check(!id.HasValue || before!=null,"Offer not found.",404);
        Iam.Check(code==null || !offers.Any(o=>o.Id!=id && o.Code==code),"An offer with this code already exists.",409);
        Iam.Check(planIds.All((await Read<PlanRow>(db,PlanJson)).Select(x=>x.Id).Contains),"Select existing plans.");
        var known=(await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM school_db.schools WHERE deleted_at IS NULL AND id<>{EduOSTenants.Platform}").ToListAsync()).ToHashSet();
        Iam.Check(schoolIds.All(known.Contains),"Select existing schools.");
        var key=id??Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO billing.offers(id,name,code,description,discount_type,discount_value,currency,starts_at,ends_at,status,plan_ids,school_ids,new_customers_only,max_uses)
            VALUES({key},{name},{code},{input.Description??""},{input.DiscountType},{input.DiscountValue},{currency},{input.StartsAt.ToUniversalTime()},{input.EndsAt.ToUniversalTime()},{input.Status},{planIds},{schoolIds},{input.NewCustomersOnly},{input.MaxUses})
            ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,code=EXCLUDED.code,description=EXCLUDED.description,discount_type=EXCLUDED.discount_type,discount_value=EXCLUDED.discount_value,currency=EXCLUDED.currency,
            starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,status=EXCLUDED.status,plan_ids=EXCLUDED.plan_ids,school_ids=EXCLUDED.school_ids,new_customers_only=EXCLUDED.new_customers_only,max_uses=EXCLUDED.max_uses,updated_at=now()
            """);
        await Iam.Audit(db,http.GetTenant(),EduOSTenants.Platform,before==null ? "billing.offer.created" : "billing.offer.changed",key,before,input);
        await tx.CommitAsync(); return Results.Json(new{data=new{id=key}},statusCode:before==null ? 201 : 200);
    }

    static async Task<IResult> SaveBanner(Guid? id,BannerInput input,HttpContext http,AuthDbContext db)
    {
        Iam.Permit(http,"billing.offers.manage");
        var title=input.Title?.Trim()??""; var url=input.CtaUrl?.Trim()??""; var label=input.CtaLabel?.Trim()??"";
        Iam.Check(title.Length is >0 and <=120 && (input.Message?.Length??0)<=500 && label.Length<=60,"Enter a title of up to 120 characters and a message of up to 500.");
        Iam.Check(Placements.Contains(input.Placement),"Select where the promotion is shown.");
        // Only in-app paths, so a banner can never send people to another site or run a script.
        Iam.Check(url.Length==0 || url.Length<=300 && url.StartsWith('/') && !url.StartsWith("//") && !url.Contains('\\'),"The button link must be a page in EduOS, such as /subscription.");
        Iam.Check((label.Length==0)==(url.Length==0),"Enter both the button text and its link, or neither.");
        Window(input.StartsAt,input.EndsAt);
        await using var tx=await db.Database.BeginTransactionAsync();
        var exists=id.HasValue && (await Read<JsonElement>(db,BannerJson)).Any(b=>b.GetProperty("id").GetGuid()==id);
        Iam.Check(!id.HasValue || exists,"Promotion not found.",404);
        var key=id??Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO billing.banners(id,title,message,cta_label,cta_url,placement,enabled,starts_at,ends_at)
            VALUES({key},{title},{input.Message??""},{label},{url},{input.Placement},{input.Enabled},{input.StartsAt.ToUniversalTime()},{input.EndsAt.ToUniversalTime()})
            ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,message=EXCLUDED.message,cta_label=EXCLUDED.cta_label,cta_url=EXCLUDED.cta_url,placement=EXCLUDED.placement,enabled=EXCLUDED.enabled,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at
            """);
        await Iam.Audit(db,http.GetTenant(),EduOSTenants.Platform,exists ? "billing.banner.changed" : "billing.banner.created",key,null,input);
        await tx.CommitAsync(); return Results.Json(new{data=new{id=key}},statusCode:exists ? 200 : 201);
    }

    static async Task<IResult> ChangeSubscription(Guid id,SubscriptionAction input,HttpContext http,AuthDbContext db)
    {
        Iam.Permit(http,"billing.subscriptions.manage"); var actor=http.GetTenant(); var note=input.Note?.Trim()??"";
        Iam.Check(note.Length<=500,"The note can be at most 500 characters.");
        await using var tx=await db.Database.BeginTransactionAsync(); await SchoolLock(db,id);
        var current=(await Subscriptions(db,id)).SingleOrDefault(); Iam.Check(id!=EduOSTenants.Platform && current!=null,"School not found.",404);
        var status=current!["status"]?.GetValue<string>(); var currentPlan=current["planId"]?.GetValue<Guid>();
        var plan=input.PlanId is Guid planId ? (await Read<PlanRow>(db,PlanJson)).SingleOrDefault(x=>x.Id==planId) : null;
        Iam.Check(input.PlanId==null || plan!=null,"Plan not found.",404);
        var now=DateTimeOffset.UtcNow; var audit="billing.subscription.changed"; var message="Subscription updated.";
        Task Upsert(string newStatus,Guid? newPlan,DateTimeOffset? end,string? period,Quote quote) => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO billing.subscriptions(school_id,plan_id,status,starts_at,ends_at,billing_period,base_price,discount,final_amount,currency,payment_state,note,modified_by)
            VALUES({id},{newPlan},{newStatus},{now},{end},{period},{quote.BasePrice},{quote.Discount},{quote.FinalAmount},{quote.Currency},'NotRequired',{note},{actor.UserId})
            ON CONFLICT(school_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,previous_status=NULL,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,billing_period=EXCLUDED.billing_period,
            base_price=EXCLUDED.base_price,discount=EXCLUDED.discount,final_amount=EXCLUDED.final_amount,currency=EXCLUDED.currency,payment_state='NotRequired',note=EXCLUDED.note,modified_by=EXCLUDED.modified_by,updated_at=now()
            """);
        switch(input.Action)
        {
            case "complimentary":
                Iam.Check(input.Days is null or (>0 and <=3650),"Enter 1 to 3650 days, or leave it empty for access without an end date.");
                var listed=plan?.BasePrice??0;
                await Upsert("Complimentary",plan?.Id??currentPlan,input.Days is int free ? now.AddDays(free) : null,null,new Quote(listed,listed,0,plan?.Currency??"INR",null,null));
                audit="billing.subscription.complimentary"; message="Complimentary access granted."; break;
            case "trial":
                Iam.Check(plan!=null,"Select a plan for the trial.");
                var days=input.Days??plan!.TrialDays; Iam.Check(days is >0 and <=365,"Enter a trial of 1 to 365 days.");
                await Upsert("Trial",plan!.Id,now.AddDays(days),null,new Quote(plan.BasePrice,plan.BasePrice,0,plan.Currency,null,null));
                audit="billing.subscription.trial"; message="Trial started."; break;
            case "activate":
                Iam.Check(plan!=null,"Select a plan to activate.");
                var quote=(await PricerFor(db,id)).Quote(plan!,null);
                await Upsert("Active",plan!.Id,now.AddMonths(Months(plan.BillingPeriod)),plan.BillingPeriod,quote);
                audit="billing.subscription.activated"; message="Subscription activated without online payment."; break;
            case "extend":
                Iam.Check(status is "Trial" or "Active" or "Complimentary" && current["endsAt"]!=null,"Only a subscription with an end date can be extended.");
                Iam.Check(input.Days is >0 and <=3650,"Enter 1 to 3650 days.");
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.subscriptions SET ends_at=GREATEST(ends_at,now())+make_interval(days=>{input.Days!.Value}),note={note},modified_by={actor.UserId},updated_at=now() WHERE school_id={id}");
                audit=status=="Trial" ? "billing.trial.extended" : "billing.subscription.extended"; message="Subscription extended."; break;
            case "change-plan":
                Iam.Check(status!=null && plan!=null,"Select a plan for a school that already has a subscription.");
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.subscriptions SET plan_id={plan!.Id},note={note},modified_by={actor.UserId},updated_at=now() WHERE school_id={id}");
                audit="billing.subscription.plan_changed"; message="Plan changed."; break;
            case "cancel":
                Iam.Check(status is "Trial" or "Active" or "Complimentary","There is no running subscription to cancel.");
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.subscriptions SET previous_status=status,status='Cancelled',note={note},modified_by={actor.UserId},updated_at=now() WHERE school_id={id}");
                audit="billing.subscription.cancelled"; message="Subscription cancelled. School data is kept."; break;
            case "restore":
                Iam.Check(status=="Cancelled","Only a cancelled subscription can be restored.");
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE billing.subscriptions SET status=COALESCE(previous_status,'Active'),previous_status=NULL,note={note},modified_by={actor.UserId},updated_at=now() WHERE school_id={id}");
                audit="billing.subscription.restored"; message="Subscription restored."; break;
            default: throw new IamError(400,"Unknown subscription action.");
        }
        await Iam.Audit(db,actor,id,audit,id,new{status,planId=currentPlan,endsAt=current["endsAt"]?.GetValue<DateTimeOffset>()},new{input.Action,input.PlanId,input.Days,note});
        await tx.CommitAsync(); return Results.Ok(new{message});
    }
}

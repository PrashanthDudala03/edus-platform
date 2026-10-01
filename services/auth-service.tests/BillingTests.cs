using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Xunit;

public class BillingTests
{
    static readonly Guid Plan=Guid.NewGuid(),OtherPlan=Guid.NewGuid(),School=Guid.NewGuid(),OtherSchool=Guid.NewGuid();
    static readonly DateTimeOffset Now=new(2026,10,20,0,0,0,TimeSpan.Zero);
    static OfferRule Offer(string? code,string type,long value,string status="Active",int startDays=-5,int endDays=5,Guid[]? plans=null,Guid[]? schools=null,bool newOnly=false,int? max=null,int used=0,string currency="INR") =>
        new(Guid.NewGuid(),code??"Automatic sale",code,type,value,currency,Now.AddDays(startDays),Now.AddDays(endDays),status,plans??[],schools??[],newOnly,max,used);
    static Quote Price(IEnumerable<OfferRule> offers,string? coupon=null,long? schoolPrice=null,Guid? school=null,bool newCustomer=true,Guid? plan=null) =>
        Pricing.Calculate(3_000_000,schoolPrice,"INR",offers,coupon,plan??Plan,school??School,newCustomer,Now);
    static string Hmac(string data,string secret) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret),Encoding.UTF8.GetBytes(data))).ToLowerInvariant();

    [Fact] public void BasePriceAppliesWithoutOffers() => Assert.Equal(new Quote(3_000_000,0,3_000_000,"INR",null,null),Price([]));
    [Fact] public void PercentageCouponReducesThePrice() { var q=Price([Offer("DIWALI25","percent",25)],"diwali25"); Assert.Equal((750_000L,2_250_000L),(q.Discount,q.FinalAmount)); }
    [Fact] public void FixedCouponReducesThePrice() { var q=Price([Offer("LAUNCH","fixed",500_000)],"LAUNCH"); Assert.Equal((500_000L,2_500_000L),(q.Discount,q.FinalAmount)); }
    [Fact] public void FixedDiscountNeverProducesANegativePrice() { var q=Price([Offer("BIG","fixed",9_000_000)],"BIG"); Assert.Equal((3_000_000L,0L),(q.Discount,q.FinalAmount)); }
    [Fact] public void SchoolPriceTakesPrecedenceAndDiscountsApplyToIt() { var q=Price([Offer(null,"percent",10)],schoolPrice:2_500_000); Assert.Equal((2_500_000L,250_000L,2_250_000L),(q.BasePrice,q.Discount,q.FinalAmount)); }
    [Fact] public void ComplimentarySchoolPriceIsZero() => Assert.Equal(0,Price([],schoolPrice:0).FinalAmount);
    [Fact] public void AutomaticPromotionNeedsNoCoupon() => Assert.Equal(2_400_000,Price([Offer(null,"percent",20)]).FinalAmount);
    [Fact] public void BestEligibleDiscountWins() => Assert.Equal(2_250_000,Price([Offer(null,"percent",25),Offer("SMALL","percent",5)],"SMALL").FinalAmount);
    [Fact] public void UnknownCouponIsRejected() => Assert.Throws<IamError>(()=>Price([Offer("REAL","percent",10)],"FAKE"));
    [Fact] public void ExpiredCouponIsRejected() => Assert.Contains("expired",Assert.Throws<IamError>(()=>Price([Offer("OLD","percent",10,endDays:-1)],"OLD")).Message);
    [Fact] public void ScheduledCouponIsRejected() => Assert.Contains("not started",Assert.Throws<IamError>(()=>Price([Offer("SOON","percent",10,startDays:1)],"SOON")).Message);
    [Theory] [InlineData("Disabled")] [InlineData("Draft")]
    public void InactiveCouponIsRejected(string status) => Assert.Contains("not active",Assert.Throws<IamError>(()=>Price([Offer("OFF","percent",10,status)],"OFF")).Message);
    [Fact] public void SchoolSpecificOfferIsRejectedForAnotherSchool()
    {
        var offer=Offer("ONLYA","percent",50,schools:[School]);
        Assert.Equal(1_500_000,Price([offer],"ONLYA").FinalAmount);
        Assert.Contains("not available to your school",Assert.Throws<IamError>(()=>Price([offer],"ONLYA",school:OtherSchool)).Message);
    }
    [Fact] public void PlanSpecificOfferIsRejectedForAnotherPlan() => Assert.Throws<IamError>(()=>Price([Offer("PRO","percent",10,plans:[OtherPlan])],"PRO"));
    [Fact] public void NewCustomerOfferIsRejectedForAReturningSchool() => Assert.Throws<IamError>(()=>Price([Offer("NEW","percent",10,newOnly:true)],"NEW",newCustomer:false));
    [Fact] public void FullyRedeemedOfferIsRejected() => Assert.Throws<IamError>(()=>Price([Offer("FEW","percent",10,max:2,used:2)],"FEW"));
    [Fact] public void FixedOfferInAnotherCurrencyIsRejected() => Assert.Throws<IamError>(()=>Price([Offer("USD","fixed",100,currency:"USD")],"USD"));
    [Fact] public void IneligibleAutomaticPromotionsAreIgnored() =>
        Assert.Equal(3_000_000,Price([Offer(null,"percent",50,endDays:-1),Offer(null,"percent",50,"Disabled"),Offer(null,"percent",50,schools:[OtherSchool])]).FinalAmount);
    [Fact] public void OutOfRangePercentageIsClamped() => Assert.Equal(0,Pricing.Discount(Offer(null,"percent",-10),1000));

    [Fact] public void OrderAmountComesFromTheServerQuote()
    {
        var quote=Price([Offer("DIWALI25","percent",25)],"DIWALI25");
        var order=JsonSerializer.SerializeToElement(Razorpay.OrderRequest(quote,Guid.NewGuid(),School,Plan));
        Assert.Equal(2_250_000,order.GetProperty("amount").GetInt64());
        Assert.Equal("INR",order.GetProperty("currency").GetString());
        Assert.True(order.GetProperty("receipt").GetString()!.Length<=40);
    }
    [Fact] public void ValidPaymentSignatureIsAccepted() => Assert.True(Razorpay.ValidPayment("order_1","pay_1",Hmac("order_1|pay_1","secret"),"secret"));
    [Theory] [InlineData("order_1","pay_2")] [InlineData("order_2","pay_1")]
    public void SignatureForAnotherOrderOrPaymentIsRejected(string order,string payment) => Assert.False(Razorpay.ValidPayment(order,payment,Hmac("order_1|pay_1","secret"),"secret"));
    [Theory] [InlineData(null)] [InlineData("")] [InlineData("not-a-signature")]
    public void MissingOrForgedPaymentSignatureIsRejected(string? signature) => Assert.False(Razorpay.ValidPayment("order_1","pay_1",signature,"secret"));
    [Fact] public void SignaturesAreRejectedWhenNoSecretIsConfigured() => Assert.False(Razorpay.ValidPayment("order_1","pay_1",Hmac("order_1|pay_1",""),""));
    [Fact] public void WebhookSignatureCoversTheRawBody()
    {
        const string body="{\"event\":\"payment.captured\"}";
        Assert.True(Razorpay.ValidWebhook(body,Hmac(body,"hook"),"hook"));
        Assert.False(Razorpay.ValidWebhook(body+" ",Hmac(body,"hook"),"hook"));
        Assert.False(Razorpay.ValidWebhook(body,Hmac(body,"other"),"hook"));
    }

    [Theory]
    [InlineData("Active",5,7,"Active")] [InlineData("Trial",5,7,"Trial")]
    [InlineData("Active",-3,7,"Grace Period")] [InlineData("Active",-8,7,"Expired")] [InlineData("Trial",-1,0,"Expired")]
    [InlineData("Cancelled",-30,7,"Cancelled")]
    public void SubscriptionStatusFollowsExpiryAndGrace(string status,int endsInDays,int grace,string expected) =>
        Assert.Equal(expected,Billing.Effective(status,Now.AddDays(endsInDays),grace,Now));
    [Fact] public void AccessWithoutAnEndDateNeverExpires() => Assert.Equal("Complimentary",Billing.Effective("Complimentary",null,7,Now));
    [Theory] [InlineData("monthly",1)] [InlineData("quarterly",3)] [InlineData("yearly",12)]
    public void BillingPeriodLength(string period,int months) => Assert.Equal(months,Billing.Months(period));
}

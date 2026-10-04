using System.Text.Json.Nodes;
using Npgsql;
// Money helpers shared by the fee ledger and printed documents. The fee endpoints themselves are in Suite.Fees.cs.
public static partial class Suite
{
    static long Cents(JsonObject d,string key){var n=Number(d,key);Require(n>=0&&n<=100000000&&decimal.Round(n,2)==n,"Money must be non-negative with at most two decimal places.");return checked((long)(n*100));}
    static async Task<JsonObject> SchoolPrint(NpgsqlConnection c,Guid school){
        var profile=(await Q(c,"SELECT name,principal_name AS principal FROM school_db.schools WHERE id=@s",("s",school))).First();
        var config=(await Records(c,school,"school-config")).FirstOrDefault();
        if(config is not null)foreach(var item in config)if(item.Key is not "id" and not "version" and not "createdAt")profile[item.Key]=item.Value?.DeepClone();
        return profile;
    }
}

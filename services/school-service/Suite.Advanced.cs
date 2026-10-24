using System.Text.Json.Nodes;
using Npgsql;

public static class AdvancedRules
{
    public static bool Whole(decimal value) => value >= 1 && value <= 100000 && decimal.Truncate(value) == value;
    public static bool HasCapacity(decimal capacity, decimal occupied, decimal requested) => Whole(capacity) && Whole(requested) && occupied >= 0 && occupied + requested <= capacity;
    public static bool LoanDates(DateOnly issued, DateOnly due, DateOnly? returned) => due >= issued && (returned is null || returned >= issued);
}

public static partial class Suite
{
    static readonly string[] AdvancedKinds = ["library-books", "library-loans", "inventory-items", "inventory-assignments", "transport-routes", "transport-stops", "transport-assignments"];
    static async Task ValidateAdvanced(NpgsqlConnection c, SchoolAccess a, string kind, JsonObject d, JsonObject? old, Guid? id)
    {
        if (!AdvancedKinds.Contains(kind)) return;
        Require(a.SchoolWide, "School operations are managed by the school office.", 403);
        var peers = (await Records(c, a.School, kind)).Where(r => Text(r, "id") != id?.ToString()).ToList();
        var active = Text(d, "status") is "Issued" or "Assigned" or "Active";
        void Unique(string key) => Require(!peers.Any(r => string.Equals(Text(r, key), Text(d, key), StringComparison.OrdinalIgnoreCase)), "This code or name is already in use.", 409);
        if (kind is "library-books" or "inventory-items")
        {
            Unique("code"); var amount = Number(d, kind == "library-books" ? "copies" : "quantity");
            Require(AdvancedRules.Whole(amount), "Stock must be a whole number from 1 to 100,000.");
            if (id is not null)
            {
                var loans = await Records(c, a.School, kind == "library-books" ? "library-loans" : "inventory-assignments");
                var outstanding = loans.Where(r => Text(r, kind == "library-books" ? "bookId" : "itemId") == id.ToString() && Text(r, "status") == (kind == "library-books" ? "Issued" : "Assigned")).Sum(r => kind == "library-books" ? 1m : Number(r, "quantity"));
                Require(amount >= outstanding, "Stock cannot be lower than the quantity currently issued.", 409);
                Require(outstanding == 0 || Text(d, "status") is "Active" or "Available", "Return outstanding items before retiring stock.", 409);
            }
        }
        if (kind is "library-loans" or "inventory-assignments")
        {
            var book = kind == "library-loans"; var key = book ? "bookId" : "itemId";
            var stock = await Get(c, a.School, book ? "library-books" : "inventory-items", Id(d, key));
            var quantity = book ? 1m : Number(d, "quantity"); Require(AdvancedRules.Whole(quantity), "Issue a positive whole quantity.");
            if (old is not null)
            {
                Require(Text(d,key)==Text(old,key) && Text(d,book?"studentId":"teacherId")==Text(old,book?"studentId":"teacherId") && Text(d,"issuedOn")==Text(old,"issuedOn") && (book || Number(d,"quantity")==Number(old,"quantity")), "The item, borrower, issue date and quantity are permanent. Return it and create a new issue instead.",409);
                Require(Text(old,"status")!="Returned" || Text(d,"status")=="Returned", "A completed return cannot be reopened.",409);
            }
            DateOnly? returned = Text(d,"returnedOn")=="" ? null : Day(d,"returnedOn");
            Require(AdvancedRules.LoanDates(Day(d,"issuedOn"),book?Day(d,"dueOn"):Day(d,"issuedOn"),returned),"Due and return dates cannot precede the issue date.");
            Require((Text(d,"status")=="Returned")==returned.HasValue,"Set a return date only when the status is Returned.");
            Require(Day(d,"issuedOn")<=DateOnly.FromDateTime(DateTime.UtcNow) && (returned is null || returned<=DateOnly.FromDateTime(DateTime.UtcNow)),"Issue and return dates cannot be in the future.");
            if(active)
            {
                Require(Text(stock,"status")== (book?"Available":"Active"),"This item is retired.",409);
                var occupied=peers.Where(r=>Text(r,key)==Text(d,key)&&Text(r,"status")== (book?"Issued":"Assigned")).Sum(r=>book?1m:Number(r,"quantity"));
                Require(AdvancedRules.HasCapacity(Number(stock,book?"copies":"quantity"),occupied,quantity),"No available stock remains for this issue.",409);
                if(book)Require(!peers.Any(r=>Text(r,"bookId")==Text(d,"bookId")&&Text(r,"studentId")==Text(d,"studentId")&&Text(r,"status")=="Issued"),"This student already has an outstanding copy.",409);
            }
        }
        if(kind=="transport-routes")
        {
            Unique("name"); Require(AdvancedRules.Whole(Number(d,"capacity")),"Capacity must be a positive whole number.");
            if(id is not null)
            {
                var passengers=(await Records(c,a.School,"transport-assignments")).Count(r=>Text(r,"routeId")==id.ToString()&&Text(r,"status")=="Active");
                Require(passengers<=Number(d,"capacity"),"Capacity cannot be lower than assigned passengers.",409);
                Require(passengers==0||active,"Reassign passengers before deactivating this route.",409);
            }
        }
        if(kind=="transport-stops")
        {
            Require(AdvancedRules.Whole(Number(d,"sequence")),"Stop order must be a positive whole number.");
            Require(!peers.Any(r=>Text(r,"routeId")==Text(d,"routeId")&&(Number(r,"sequence")==Number(d,"sequence")||string.Equals(Text(r,"name"),Text(d,"name"),StringComparison.OrdinalIgnoreCase))),"This route already has that stop name or order.",409);
            if(old is not null && Text(old,"routeId")!=Text(d,"routeId"))Require(!(await Records(c,a.School,"transport-assignments")).Any(r=>Text(r,"stopId")==id.ToString()&&Text(r,"status")=="Active"),"Reassign passengers before moving their stop to another route.",409);
        }
        if(kind=="transport-assignments")
        {
            var route=await Get(c,a.School,"transport-routes",Id(d,"routeId")); var stop=await Get(c,a.School,"transport-stops",Id(d,"stopId"));
            Require(Text(stop,"routeId")==Text(d,"routeId"),"Choose a stop on the selected route.");
            if(active)
            {
                Require(Text(route,"status")=="Active","The route is inactive.",409);
                Require(!peers.Any(r=>Text(r,"studentId")==Text(d,"studentId")&&Text(r,"status")=="Active"),"This student already has an active transport assignment.",409);
                Require(AdvancedRules.HasCapacity(Number(route,"capacity"),peers.Count(r=>Text(r,"routeId")==Text(d,"routeId")&&Text(r,"status")=="Active"),1),"This route has no seats available.",409);
            }
        }
    }

    static void MapAdvanced(RouteGroupBuilder group)
    {
        group.MapGet("/analytics/operations",async(HttpContext http)=>
        {
            await using var c=await Open();var a=await Access(http,c);Require(a.SchoolWide&&a.Can("reports.view"),"School reporting permission is required.",403);
            var result=new JsonObject(); var today=DateOnly.FromDateTime(DateTime.UtcNow);
            if(a.Can("library-books.view")&&a.Can("library-loans.view"))
            {
                var books=await Records(c,a.School,"library-books");var loans=await Records(c,a.School,"library-loans");
                result["library"]=new JsonObject{["titles"]=books.Count,["issued"]=loans.Count(r=>Text(r,"status")=="Issued"),["overdue"]=loans.Count(r=>Text(r,"status")=="Issued"&&DateOnly.TryParse(Text(r,"dueOn"),out var due)&&due<today)};
            }
            if(a.Can("inventory-items.view")&&a.Can("inventory-assignments.view"))
            {
                var items=await Records(c,a.School,"inventory-items");var issues=await Records(c,a.School,"inventory-assignments");
                result["inventory"]=new JsonObject{["items"]=items.Count,["assigned"]=issues.Where(r=>Text(r,"status")=="Assigned").Sum(r=>Number(r,"quantity"))};
            }
            if(a.Can("transport-routes.view")&&a.Can("transport-assignments.view"))
            {
                var routes=await Records(c,a.School,"transport-routes");var assignments=await Records(c,a.School,"transport-assignments");
                result["transport"]=new JsonObject{["routes"]=routes.Count(r=>Text(r,"status")=="Active"),["passengers"]=assignments.Count(r=>Text(r,"status")=="Active"),["capacity"]=routes.Where(r=>Text(r,"status")=="Active").Sum(r=>Number(r,"capacity"))};
            }
            return Results.Ok(new{data=result});
        });
    }
}

using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EduOS.Ai.Tools;

namespace EduOS.Ai.Gateway;

// Decides what kind of question was asked, by fixed rules in this service. No model takes part in the decision,
// and a rule can only choose among routes and tools that exist here: it cannot name a path, a school or a user.

public enum AssistantRouteKind { Greeting, Thanks, Farewell, Identity, Personal, Tool, Knowledge }

/// <param name="Tool">For a tool route: one registered tool name. The registry still decides whether it runs.</param>
/// <param name="Focus">For the caller's own profile: which part was asked for (name, role, email or all).</param>
/// <param name="ClassScoped">The question named a class or section. The figures are for the whole school, and the reply says so.</param>
public sealed record AssistantRoute(AssistantRouteKind Kind, string? Tool = null, JsonObject? Arguments = null, string? Focus = null, bool ClassScoped = false);

public static partial class AssistantRouter
{
    /// <summary>What a reply is based on, as the response reports it. The words are never shown to a user.</summary>
    public const string School = "documents", Live = "live", General = "general", Assistant = "assistant";

    /// <summary>Lower case, contractions opened, possessives and punctuation removed, so one rule covers many ways of typing.</summary>
    public static string Normalize(string question)
    {
        var text = question.ToLowerInvariant().Replace('’', '\'');
        text = Contraction().Replace(text, "$1 is");
        text = Possessive().Replace(text, "$1").Replace("'", "");
        return Spaces().Replace(Punctuation().Replace(text, " "), " ").Trim();
    }

    public static AssistantRoute Route(string question, DateOnly today)
    {
        var text = Normalize(question);
        if (text.Length <= 60)
        {
            if (Greeting().IsMatch(text)) return new(AssistantRouteKind.Greeting);
            if (Thanks().IsMatch(text)) return new(AssistantRouteKind.Thanks);
            if (Farewell().IsMatch(text)) return new(AssistantRouteKind.Farewell);
        }
        if (Identity().IsMatch(text)) return new(AssistantRouteKind.Identity);
        // The caller's own account: one tool that can only ever return the signed-in user.
        if (Profile().Match(text) is { Success: true } own)
            return new(AssistantRouteKind.Tool, "current_user_profile", Focus: own.Value.Contains("name") && !own.Value.Contains("user") ? "name" : ProfileRole().IsMatch(own.Value) ? "role" : ProfileEmail().IsMatch(own.Value) ? "email" : "all");
        // Other records of the caller or of one particular person: nothing here can look those up yet.
        if (Personal().IsMatch(text)) return new(AssistantRouteKind.Personal);

        // Live figures. A question about a rule or a policy is left to the school's documents.
        if (!Policy().IsMatch(text))
        {
            var byClass = ClassScope().IsMatch(text); var dated = Today().IsMatch(text) || text.Contains("yesterday") || ExplicitDay().IsMatch(text);
            if ((AttendanceTopic().IsMatch(text) && (dated || AttendanceFigure().IsMatch(text))) || (Strength().IsMatch(text) && dated))
            {
                var day = ExplicitDay().Match(text) is { Success: true } stated ? stated.Value : (text.Contains("yesterday") ? today.AddDays(-1) : today).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                return new(AssistantRouteKind.Tool, "attendance_summary", new JsonObject { ["day"] = day }, ClassScoped: byClass);
            }
            if (StudentCount().IsMatch(text) || Strength().IsMatch(text)) return new(AssistantRouteKind.Tool, "student_count", ClassScoped: byClass);
            if (FeeTopic().IsMatch(text) && FeeFigure().IsMatch(text) && !FeeProcedure().IsMatch(text)) return new(AssistantRouteKind.Tool, "fee_summary");
            if (ExamTopic().IsMatch(text) && ExamTiming().IsMatch(text))
                return new(AssistantRouteKind.Tool, "exam_schedule", new JsonObject { ["period"] = ExamPast().IsMatch(text) ? "recent" : "upcoming" });
        }
        return new(AssistantRouteKind.Knowledge);
    }

    /// <summary>
    /// True for a request to explain, define or produce study material that names nothing of a particular school.
    /// Only such a question may be answered from the model's general knowledge when the school's documents have nothing.
    /// </summary>
    public static bool LooksGeneral(string question)
    {
        var text = Normalize(question);
        return GeneralRequest().IsMatch(text) && !SchoolSpecific().IsMatch(text);
    }

    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
    [GeneratedRegex(@"\b(what|who|where|when|how|that|it|there)'s\b")] private static partial Regex Contraction();
    [GeneratedRegex(@"(\w)'s\b")] private static partial Regex Possessive();
    [GeneratedRegex(@"[^a-z0-9\-]+")] private static partial Regex Punctuation();
    [GeneratedRegex(@"^(hi+|hello|hey|hello there|hi there|hey there|good (morning|afternoon|evening|day)|namaste|greetings|how are you)( eduos( ai)?)?$")] private static partial Regex Greeting();
    [GeneratedRegex(@"^((ok|okay|great|cool|nice|got it) )?(thanks|thank you|thankyou|thx|ty)\b.{0,25}$")] private static partial Regex Thanks();
    [GeneratedRegex(@"^(bye|goodbye|good bye|see you|good night)\b.{0,15}$")] private static partial Regex Farewell();
    [GeneratedRegex(@"\bwho are you\b|\bwhat are you\b|\bwhat is your name\b|\byour name\b|\bwhat can you do\b|\bwhat do you do\b|\bhow can you help\b|\bwhat can i ask\b|^help$|^help me$")] private static partial Regex Identity();
    [GeneratedRegex(@"\bmy (own |full |first |last )?(name|role|designation|email|e-mail|mail id|email id|username|user name|login|profile|details|account|info|information)\b|\bwho am i\b|\babout (me|myself)\b|\b(signed|logged) in as\b")] private static partial Regex Profile();
    [GeneratedRegex(@"role|designation|(signed|logged) in as")] private static partial Regex ProfileRole();
    [GeneratedRegex(@"mail|username|user name|login")] private static partial Regex ProfileEmail();
    [GeneratedRegex(@"\bmy (own )?(marks|grades|results?|report card|attendance|timetable|homework|teacher|class teacher|roll number|children|child|son|daughter|kid|kids)\b")] private static partial Regex Personal();
    [GeneratedRegex(@"\bpolic(y|ies)\b|\brules?\b|\brequire(d|ment|ments|s)?\b|\bminimum\b|\bmust\b|\bshould\b|\ballowed\b|\bhandbook\b")] private static partial Regex Policy();
    [GeneratedRegex(@"\b(class|classes|section|sections|grade|std|standard)\b")] private static partial Regex ClassScope();
    [GeneratedRegex(@"\b(todays?|now|currently|right now|at present|this morning)\b")] private static partial Regex Today();
    [GeneratedRegex(@"\b(attendance|present|absent|absentees?|turnout|attended|turned up|showed up|came)\b")] private static partial Regex AttendanceTopic();
    [GeneratedRegex(@"\bhow many\b|\bsummary\b|\bnumber of\b|\bcount\b|\bfigures?\b|\bstatus\b")] private static partial Regex AttendanceFigure();
    [GeneratedRegex(@"\b\d{4}-\d{2}-\d{2}\b")] private static partial Regex ExplicitDay();
    [GeneratedRegex(@"\b(strength|headcount|head count|enrolment|enrollment|enrolled|on roll)\b")] private static partial Regex Strength();
    [GeneratedRegex(@"\b(how many|number of|no of|count of|total|total number of)\b.{0,30}\b(students?|pupils?|children|kids|learners)\b|\b(students?|pupils?) (count|total|numbers?|population)\b")] private static partial Regex StudentCount();
    [GeneratedRegex(@"\b(fees?|dues|payments?|arrears)\b")] private static partial Regex FeeTopic();
    [GeneratedRegex(@"\b(pending|outstanding|overdue|unpaid|balance|collected|collection|how much|total|summary|dues?|arrears|owed?|owes|owing|paid|remaining|left|status|to pay|yet to)\b")] private static partial Regex FeeFigure();
    [GeneratedRegex(@"\bwhen\b|\bdeadline\b|\blast date\b|\bdue date\b|\bstructure\b|\bhow (to|do i|can i) pay\b|\bmode of payment\b")] private static partial Regex FeeProcedure();
    [GeneratedRegex(@"\b(exams?|examinations?|tests?|assessments?|midterms?)\b")] private static partial Regex ExamTopic();
    [GeneratedRegex(@"\b(upcoming|next|schedule|scheduled|planned|when|dates?|coming|ahead|soon|any|recent|last|previous|past|timetable|this (week|month|term)|next (week|month|term))\b")] private static partial Regex ExamTiming();
    [GeneratedRegex(@"\b(recent|last|previous|past)\b")] private static partial Regex ExamPast();
    [GeneratedRegex(@"^(please |can you |could you )?(explain|describe|define|summari[sz]e|simplify|translate|solve|calculate|compare|list|write|create|make|generate|draft|give me|suggest|teach me|help me (understand|study|learn|with))\b|^(what is|what are|what does|what do|how does|how do|how to|how can i|why (is|are|do|does|did)|who (was|were|invented|discovered|wrote)|difference between|meaning of)\b|\b(study|practice|practise|quiz) questions\b|\bmcqs?\b")] private static partial Regex GeneralRequest();
    [GeneratedRegex(@"\b(school|schools|our|my|we|us|principal|headmaster|headmistress|teacher|teachers|staff|section|timetable|holiday|holidays|fee|fees|uniform|admission|admissions|bus|transport|canteen|hostel|pool|playground|campus|circular|circulars|notice|pta|policy|policies|handbook|rule|rules|leave|attendance|exam|exams|marks|results|today|todays|tomorrow|yesterday|this (week|month|term|year)|next (week|month|term|year))\b")] private static partial Regex SchoolSpecific();
}

/// <summary>What the assistant says without a model: fixed sentences, and figures a tool returned put into words.</summary>
public static class AssistantReplies
{
    public const string GeneralInstruction =
        "You are EduOS AI, a school assistant. Answer this question from general knowledge, clearly and briefly, at a level suitable for school students and staff. "
        + "You know nothing about any particular school, its people, dates, fees, rules, schedules or facilities. If the question needs such a fact, say that you do not have that information. "
        + "Never invent names, dates, times or amounts.";
    public const string Thanks = "You're welcome! Ask me anything else whenever you like.";
    public const string Farewell = "Goodbye! I'm here whenever you need me.";
    public const string Personal = "I can't look up personal records such as marks, attendance or timetables for you or for individual students yet. You can find them in your EduOS pages. I can tell you who you are signed in as, and help with your school's documents, general study questions and the school information your account can see.";
    public const string NoAccess = "That information isn't available for your account. Your school administrator can tell you who has access to it.";
    public const string NotNow = "I couldn't get that information from EduOS just now. Please try again later.";
    public const string BadDay = "I can look up attendance for one day within the past year, up to today.";
    public const string WholeSchool = "I can't break this down by class yet, so this is for the whole school. ";

    static readonly (string Tool, string Topic, string Title)[] Live =
    [
        ("student_count", "student numbers", "Student records"), ("attendance_summary", "daily attendance", "Attendance register"), ("fee_summary", "fee totals", "Fee records"),
        ("exam_schedule", "exam dates", "Exam schedule"), ("current_user_profile", "", "Your EduOS account"),
    ];

    static string Topics(IEnumerable<ToolDefinition> offered)
    {
        var topics = Live.Where(l => l.Topic.Length > 0 && offered.Any(o => o.Name == l.Tool)).Select(l => l.Topic).ToList();
        return topics.Count == 0 ? "" : " I can also look up " + (topics.Count == 1 ? topics[0] : string.Join(", ", topics.Take(topics.Count - 1)) + " and " + topics[^1]) + " for you.";
    }
    public static string Greeting(IEnumerable<ToolDefinition> offered) => "Hello! I'm EduOS AI. I can answer questions from your school's documents and explain general study topics." + Topics(offered) + " What would you like to know?";
    public static string Identity(IEnumerable<ToolDefinition> offered) => "I'm EduOS AI, your school's assistant. I answer questions from the documents your school has added, and I can explain general study topics." + Topics(offered) + " I can't look up records of individual people yet.";

    public static string ForFailure(string status) => status is ToolResult.NotPermitted or ToolResult.Denied ? NoAccess : status == ToolResult.InvalidArguments ? BadDay : NotNow;

    /// <summary>Where live figures came from, in a reader's words. Never an identifier.</summary>
    public static AssistantSource Source(string tool) => new(1, null, Live.First(l => l.Tool == tool).Title, "Live EduOS data", null, null);

    static string Day(string? value) => DateOnly.TryParseExact(value, "yyyy-MM-dd", out var day) ? day.ToString("d MMMM yyyy", CultureInfo.InvariantCulture) : value ?? "";
    static string Count(int number, string one, string many) => number.ToString("N0", CultureInfo.InvariantCulture) + " " + (number == 1 ? one : many);
    static string Money(JsonNode? amount) => ((decimal?)amount ?? 0).ToString("N2", CultureInfo.InvariantCulture);

    /// <param name="family">True for a parent or a student: EduOS returned only what is linked to them.</param>
    public static string ForTool(string tool, JsonObject data, bool family, AssistantRoute route)
    {
        var scope = route.ClassScoped ? WholeSchool : "";
        switch (tool)
        {
            case "current_user_profile":
                string name = (string?)data["name"] ?? "", role = (string?)data["role"] ?? "", email = (string?)data["email"] ?? "";
                return route.Focus switch
                {
                    "name" when name.Length > 0 => $"Your name is {name}.",
                    "role" when role.Length > 0 => $"Your role in EduOS is {role}.",
                    "email" when email.Length > 0 => $"Your account email is {email}.",
                    _ => $"You are {(name.Length > 0 ? name : "signed in")}" + (role.Length > 0 ? $", with the role {role}" : "") + (email.Length > 0 ? $" ({email})" : "") + ". I can't look up other personal records such as marks or attendance yet.",
                };
            case "student_count":
                var students = (int)data["students"]!;
                return scope + $"There {(students == 1 ? "is" : "are")} {Count(students, "student", "students")} enrolled in your school.";
            case "attendance_summary":
                int marked = (int)data["marked"]!, present = (int)data["present"]!, notMarked = (int)data["notMarked"]!; var day = Day((string?)data["day"]); var enrolled = Count((int)data["students"]!, "student", "students");
                if (marked == 0) return scope + $"Attendance has not been marked for {day} yet. The school has {enrolled} enrolled.";
                return scope + $"On {day}, {present:N0} of the {Count(marked, "student", "students")} marked were present ({((decimal)data["percentPresentOfMarked"]!).ToString("0.#", CultureInfo.InvariantCulture)}%)."
                    + (notMarked > 0 ? $" {Count(notMarked, "student was", "students were")} not marked." : "") + $" The school has {enrolled} enrolled.";
            case "fee_summary":
                var currencies = data["currencies"]!.AsArray(); var whose = family ? "the students linked to your account" : "your school";
                if (currencies.Count == 0) return $"There are no fee charges on record for {whose}.";
                return $"Fee totals for {whose}, as of {Day((string?)data["asOf"])}:" + string.Concat(currencies.Select(c =>
                    $"\n{(string?)c!["currency"]}: charged {Money(c["gross"])}, concession {Money(c["concession"])}, paid {Money(c["paid"])}, outstanding {Money(c["balance"])} on {Count((int)c["chargesWithBalance"]!, "charge", "charges")}"
                    + ((int)c["overdueCharges"]! > 0 ? $", of which {Money(c["overdueBalance"])} is overdue." : ", nothing overdue.")));
            default:
                var exams = data["exams"]!.AsArray(); var upcoming = (string?)data["period"] != "recent";
                if (exams.Count == 0) return upcoming ? "There are no upcoming exams on record." : "There are no recent exams on record.";
                return (upcoming ? "Upcoming exams:" : "Most recent exams:") + string.Concat(exams.Select(e => $"\n{Day((string?)e!["date"])}: {(string?)e["name"]}"))
                    + ((bool)data["more"]! ? "\nThere are more; these are the nearest." : "");
        }
    }
}

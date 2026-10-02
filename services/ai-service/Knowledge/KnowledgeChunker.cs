using System.Text.RegularExpressions;
using EduOS.Ai.Providers;

namespace EduOS.Ai.Knowledge;

/// <param name="CharStart">Offset in the normalised text, inclusive.</param>
/// <param name="CharEnd">Offset in the normalised text, exclusive.</param>
/// <param name="Section">The nearest Markdown heading at or before the chunk, when there is one.</param>
/// <param name="Page">Reserved for formats with pages; always null for text and Markdown.</param>
public sealed record KnowledgeChunk(int Ordinal, string Text, int CharStart, int CharEnd, string? Section, int TokenEstimate, int? Page = null);

/// <summary>
/// Step 4. Splits normalised text into pieces of bounded size without a model. The same text and settings always
/// give the same chunks. In Markdown a chunk ends where the next heading begins. Otherwise it ends at a paragraph,
/// line, sentence or word boundary when one exists in the second half of its window, and failing that at the size limit.
/// </summary>
public static partial class KnowledgeChunker
{
    public const int MinSize = 200, MaxSize = 8000;

    public static string? Problem(int maxChars, int overlapChars) =>
        maxChars is < MinSize or > MaxSize ? $"The chunk size must be between {MinSize} and {MaxSize} characters."
        : overlapChars < 0 || overlapChars > maxChars / 2 ? "The chunk overlap must be between 0 and half the chunk size." : null;

    public static IReadOnlyList<KnowledgeChunk> Split(string text, int maxChars, int overlapChars, bool markdown)
    {
        if (Problem(maxChars, overlapChars) is string problem) throw new ArgumentException(problem);
        var headings = markdown ? Heading().Matches(text).Select(m => (m.Index, Title: Shorten(m.Groups[1].Value))).ToList() : [];
        var chunks = new List<KnowledgeChunk>();
        var start = SkipWhitespace(text, 0);
        while (start < text.Length)
        {
            var end = Math.Min(start + maxChars, text.Length);
            // A Markdown heading always starts a new chunk, so a chunk never mixes two sections and its section is exact.
            var heading = headings.FindIndex(h => h.Index > start && h.Index < end);
            if (heading >= 0) end = headings[heading].Index;
            else if (end < text.Length) end = Break(text, start, end, maxChars);
            var stop = end;
            while (stop > start && char.IsWhiteSpace(text[stop - 1])) stop--;
            var piece = text[start..stop];
            chunks.Add(new KnowledgeChunk(chunks.Count, piece, start, stop, headings.LastOrDefault(h => h.Index <= start).Title, Math.Max(1, AiTokens.Estimate(piece))));
            if (end >= text.Length) break;
            // The next chunk starts inside the end of this one, at the beginning of a word, and always further on.
            // A new section starts clean, without text of the previous one.
            var next = heading >= 0 ? end : end - overlapChars;
            next = next <= start ? end : WordStart(text, next, end);
            start = SkipWhitespace(text, next);
        }
        return chunks;
    }

    static int Break(string text, int start, int end, int maxChars)
    {
        var earliest = start + maxChars / 2;
        foreach (var boundary in new[] { "\n\n", "\n", ". ", "? ", "! ", " " })
        {
            var at = text.LastIndexOf(boundary, end - 1, end - earliest, StringComparison.Ordinal);
            if (at >= earliest) return at + boundary.Length;
        }
        // No boundary at all: cut at the limit, but never between the two halves of one character.
        return char.IsHighSurrogate(text[end - 1]) ? end - 1 : end;
    }

    static int WordStart(string text, int from, int end)
    {
        for (var i = from; i < end; i++)
            if (i == 0 || char.IsWhiteSpace(text[i - 1])) return i;
        return end;
    }

    static int SkipWhitespace(string text, int from)
    {
        while (from < text.Length && char.IsWhiteSpace(text[from])) from++;
        return from;
    }

    static string Shorten(string title) => title.Length <= 200 ? title : title[..200];

    [GeneratedRegex(@"^#{1,6}[ \t]+(.+?)[ \t#]*$", RegexOptions.Multiline)]
    private static partial Regex Heading();
}

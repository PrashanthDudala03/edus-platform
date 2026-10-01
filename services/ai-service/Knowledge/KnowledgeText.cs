using System.Security.Cryptography;
using System.Text;

namespace EduOS.Ai.Knowledge;

/// <summary>A document that is refused. The message is safe to show; the category is safe to log.</summary>
public sealed class KnowledgeRejection(int status, string category, string message) : Exception(message)
{
    public int Status => status;
    public string Category => category;
}

public sealed record KnowledgeUpload(string? FileName, string? DeclaredType, byte[] Bytes, string? Title, IReadOnlyList<string> Audience);

/// <summary>What validation accepts: a label for the file, the type decided from its extension, a title and who may read it.</summary>
public sealed record ValidatedUpload(string FileName, string MediaType, string Title, string[] Audience, byte[] Bytes);

/// <summary>Step 1. Decides from the name, the declared type and the size whether a file is one we handle.</summary>
public static class KnowledgeValidation
{
    public const string PlainText = "text/plain", Markdown = "text/markdown";
    public static readonly IReadOnlyList<string> Audiences = ["school", "teacher", "parent", "student"];
    static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase) { [".txt"] = PlainText, [".md"] = Markdown, [".markdown"] = Markdown };
    // What browsers send for these files. Anything else is a different kind of file under an allowed name.
    static readonly string[] Declared = ["", PlainText, Markdown, "text/x-markdown", "application/octet-stream"];

    /// <summary>The last path segment with control characters removed. It is only ever a label: nothing is written to disk under it.</summary>
    public static string Label(string? name)
    {
        var last = (name ?? "").Replace('\\', '/').Split('/')[^1];
        return new string(last.Where(c => !char.IsControl(c)).ToArray()).Trim();
    }

    public static ValidatedUpload Check(KnowledgeUpload upload, int maxBytes)
    {
        if (upload.Bytes.Length == 0) throw new KnowledgeRejection(400, "empty", "The file is empty.");
        if (upload.Bytes.Length > maxBytes) throw new KnowledgeRejection(413, "too-large", $"The file is larger than {maxBytes / 1024} KB.");
        var name = Label(upload.FileName);
        if (name.Length is 0 or > 150 || name.Trim('.').Length == 0) throw new KnowledgeRejection(400, "file-name", "The file needs a name of at most 150 characters.");
        if (!Types.TryGetValue(Path.GetExtension(name), out var type))
            throw new KnowledgeRejection(415, "unsupported-type", "Only plain text (.txt) and Markdown (.md) files can be added.");
        var declared = (upload.DeclaredType ?? "").Split(';')[0].Trim().ToLowerInvariant();
        if (!Declared.Contains(declared)) throw new KnowledgeRejection(415, "unsupported-type", "Only plain text (.txt) and Markdown (.md) files can be added.");
        var title = new string((upload.Title ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (title.Length == 0) title = Path.GetFileNameWithoutExtension(name);
        if (title.Length is 0 or > 200) throw new KnowledgeRejection(400, "title", "The title can be at most 200 characters.");
        var audience = upload.Audience.Select(a => a.Trim().ToLowerInvariant()).Where(a => a.Length > 0).Distinct().Order(StringComparer.Ordinal).ToArray();
        if (audience.Length == 0 || audience.Any(a => !Audiences.Contains(a)))
            throw new KnowledgeRejection(400, "audience", "Choose who may read this document: school, teacher, parent or student.");
        return new ValidatedUpload(name, type, title, audience, upload.Bytes);
    }
}

/// <summary>Step 2. Turns the bytes of a supported type into text, or refuses them. Nothing is executed or rendered.</summary>
public static class KnowledgeExtraction
{
    static readonly UTF8Encoding Strict = new(false, true);
    // A PDF or an Office file can be made of readable characters only, so these two are refused by their signature.
    // Every other binary format fails the checks below: it holds a zero byte or is not valid UTF-8.
    static readonly byte[][] Binary = ["%PDF-"u8.ToArray(), [0x50, 0x4B, 0x03, 0x04]];

    public static string Text(ValidatedUpload upload)
    {
        var bytes = upload.Bytes;
        if (Binary.Any(signature => bytes.AsSpan().StartsWith(signature)) || bytes.AsSpan().IndexOf((byte)0) >= 0) throw NotText();
        string text;
        try { text = Strict.GetString(bytes); }
        catch (DecoderFallbackException) { throw NotText(); }
        // A text file has almost no control characters beyond line breaks and tabs.
        var controls = text.Count(c => char.IsControl(c) && c is not ('\n' or '\r' or '\t' or '\f'));
        if (controls * 100 > text.Length) throw NotText();
        return text;
    }
    static KnowledgeRejection NotText() => new(415, "not-text", "The file is not readable text. Only UTF-8 plain text and Markdown can be added.");
}

/// <summary>Step 3. One canonical form of the text, so the same document always produces the same chunks and the same hash.</summary>
public static class KnowledgeNormalization
{
    public static string Normalize(string text)
    {
        text = text.Normalize(NormalizationForm.FormC).Replace("\r\n", "\n").Replace('\r', '\n');
        var kept = new StringBuilder(text.Length);
        foreach (var c in text)
            if (c is '\n' or '\t' || (!char.IsControl(c) && c is not ('﻿' or '​'))) kept.Append(c);
        var lines = kept.ToString().Split('\n').Select(line => line.TrimEnd()).ToList();
        var result = new StringBuilder(kept.Length); var blank = 0;
        foreach (var line in lines)
        {
            blank = line.Length == 0 ? blank + 1 : 0;
            // At most one empty line in a row: paragraphs stay separate without wasting space.
            if (blank <= 1) result.Append(line).Append('\n');
        }
        return result.ToString().Trim();
    }

    public static string Hash(string normalized) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized))).ToLowerInvariant();
}

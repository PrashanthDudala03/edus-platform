using System.Net;
using System.Text;
using System.Text.Json;
using EduOS.Ai.Knowledge;
using EduOS.ServiceAuth;
using Microsoft.Extensions.Options;
using Xunit;

/// <summary>
/// The store's rules without a database: per school, all or nothing, the same text only once per school, and a
/// document ready only when every one of its chunks has a vector of the space's dimension.
/// </summary>
public sealed class InMemoryKnowledgeStore : IKnowledgeStore
{
    readonly object gate = new();
    readonly Dictionary<Guid, Guid[]> chunkIds = [];
    public List<(Guid School, Guid User, Guid Id, NewKnowledgeDocument Document, IReadOnlyList<KnowledgeChunk> Chunks)> Documents { get; } = [];
    public Dictionary<Guid, (string Status, Guid? Space, string? Failure, int Tokens)> States { get; } = [];
    /// <summary>Vectors by document, then by embedding space.</summary>
    public Dictionary<Guid, Dictionary<Guid, List<ChunkVector>>> Vectors { get; } = [];
    public bool FailReads, FailWrites;
    /// <summary>How many times a vector search actually ran.</summary>
    public int Searches;
    /// <summary>When set, every search of every school finds this one chunk whatever the question. For tests that are about something other than retrieval.</summary>
    public KnowledgeMatch? Evidence;
    public static readonly KnowledgeMatch Sample = new(Guid.Parse("7c1d0000-0000-4000-8000-0000000000c1"), Guid.Parse("7c1d0000-0000-4000-8000-0000000000d1"), "Term dates", "term-dates.txt", 0,
        "The autumn term starts on the first Monday of September.", null, null, 0, 56, 1);
    public static InMemoryKnowledgeStore WithEvidence() => new() { Evidence = Sample };

    public Task<KnowledgeSaved> Save(TenantContext tenant, NewKnowledgeDocument document, IReadOnlyList<KnowledgeChunk> chunks, CancellationToken cancellation)
    {
        if (FailWrites) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate)
        {
            var same = Documents.FirstOrDefault(d => d.School == tenant.SchoolId && d.Document.TextSha256 == document.TextSha256);
            if (same.Document is not null) return Task.FromResult(new KnowledgeSaved(same.Id, same.Document.Title, same.Chunks.Count, same.Document.CharCount, true, States[same.Id].Status, States[same.Id].Space));
            var id = Guid.NewGuid(); Documents.Add((tenant.SchoolId, tenant.UserId, id, document, chunks));
            States[id] = ("processing", null, null, 0); chunkIds[id] = chunks.Select(_ => Guid.NewGuid()).ToArray(); Vectors[id] = [];
            return Task.FromResult(new KnowledgeSaved(id, document.Title, chunks.Count, document.CharCount, false));
        }
    }

    public Task<IReadOnlyList<KnowledgeDocumentInfo>> List(TenantContext tenant, CancellationToken cancellation)
    {
        if (FailReads) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate) return Task.FromResult<IReadOnlyList<KnowledgeDocumentInfo>>(Documents.Where(d => d.School == tenant.SchoolId)
            .Select(d => new KnowledgeDocumentInfo(d.Id, d.Document.Title, d.Document.FileName, d.Document.MediaType, d.Document.Audience, States[d.Id].Status, d.Document.ByteCount, d.Document.CharCount, d.Chunks.Count, default, States[d.Id].Space)).ToList());
    }

    public Task<bool> Delete(TenantContext tenant, Guid id, CancellationToken cancellation)
    {
        if (FailWrites) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate)
        {
            if (Documents.RemoveAll(d => d.School == tenant.SchoolId && d.Id == id) == 0) return Task.FromResult(false);
            States.Remove(id); Vectors.Remove(id); chunkIds.Remove(id);
            return Task.FromResult(true);
        }
    }

    public Task<IReadOnlyList<StoredChunk>?> Chunks(TenantContext tenant, Guid documentId, CancellationToken cancellation)
    {
        if (FailReads) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate)
        {
            var document = Documents.FirstOrDefault(d => d.School == tenant.SchoolId && d.Id == documentId);
            return Task.FromResult<IReadOnlyList<StoredChunk>?>(document.Document is null ? null : document.Chunks.Select((c, i) => new StoredChunk(chunkIds[documentId][i], c.Ordinal, c.Text)).ToList());
        }
    }

    public Task CompleteEmbedding(TenantContext tenant, Guid documentId, EmbeddingSpace space, IReadOnlyList<ChunkVector> vectors, int tokens, CancellationToken cancellation)
    {
        if (FailWrites) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate)
        {
            if (!Documents.Any(d => d.School == tenant.SchoolId && d.Id == documentId)) throw new InvalidOperationException("The document is not available.");
            if (vectors.Any(v => v.Vector.Length != space.Dimension)) throw new InvalidOperationException("A vector does not have the dimension of its embedding space.");
            if (vectors.Count != chunkIds[documentId].Length || !vectors.Select(v => v.ChunkId).Order().SequenceEqual(chunkIds[documentId].Order())) throw new InvalidOperationException("The vectors do not cover every chunk of the document.");
            Vectors[documentId][space.Id] = vectors.ToList();
            States[documentId] = ("ready", space.Id, null, tokens);
            return Task.CompletedTask;
        }
    }

    public Task<IReadOnlyList<KnowledgeMatch>> Search(TenantContext tenant, EmbeddingSpace space, string audience, float[] query, int limit, CancellationToken cancellation)
    {
        if (FailReads) throw new InvalidOperationException("database is down at db.internal.example");
        if (query.Length != space.Dimension) throw new InvalidOperationException("The query vector does not have the dimension of the embedding space.");
        static double Cosine(float[] a, float[] b) => a.Zip(b, (x, y) => (double)x * y).Sum() / (Math.Sqrt(a.Sum(x => (double)x * x)) * Math.Sqrt(b.Sum(x => (double)x * x)));
        lock (gate)
        {
            Searches++;
            if (Evidence is not null) return Task.FromResult<IReadOnlyList<KnowledgeMatch>>([Evidence]);
            var matches = new List<KnowledgeMatch>();
            foreach (var d in Documents.Where(d => d.School == tenant.SchoolId && States[d.Id].Status == "ready" && States[d.Id].Space == space.Id && d.Document.Audience.Contains(audience)))
                foreach (var v in Vectors[d.Id].GetValueOrDefault(space.Id) ?? [])
                {
                    var chunk = d.Chunks[Array.IndexOf(chunkIds[d.Id], v.ChunkId)];
                    matches.Add(new KnowledgeMatch(v.ChunkId, d.Id, d.Document.Title, d.Document.FileName, chunk.Ordinal, chunk.Text, chunk.Section, chunk.Page, chunk.CharStart, chunk.CharEnd, Cosine(query, v.Vector)));
                }
            return Task.FromResult<IReadOnlyList<KnowledgeMatch>>(matches.OrderByDescending(m => m.Similarity).ThenBy(m => m.DocumentId).ThenBy(m => m.Ordinal).Take(limit).ToList());
        }
    }

    public Task FailEmbedding(TenantContext tenant, Guid documentId, string failure, CancellationToken cancellation)
    {
        if (FailWrites) throw new InvalidOperationException("database is down at db.internal.example");
        lock (gate)
            if (States.TryGetValue(documentId, out var state) && state.Status != "ready" && Documents.Any(d => d.School == tenant.SchoolId && d.Id == documentId)) States[documentId] = ("failed", state.Space, failure, state.Tokens);
        return Task.CompletedTask;
    }
}

public class KnowledgePipelineTests
{
    static KnowledgeUpload File(string name, string text = "Some text.", string? type = "text/plain", string? title = null, params string[] audience) =>
        new(name, type, Encoding.UTF8.GetBytes(text), title, audience.Length == 0 ? ["school"] : audience);
    static string Words(int count) => string.Join(" ", Enumerable.Range(0, count).Select(i => "word" + i));

    [Theory]
    [InlineData("handbook.txt", "handbook.txt", "text/plain")] [InlineData("Fees Policy.MD", "Fees Policy.MD", "text/markdown")] [InlineData("notes.markdown", "notes.markdown", "text/markdown")]
    [InlineData("../../etc/passwd.txt", "passwd.txt", "text/plain")] [InlineData("..\\..\\windows\\system32\\policy.md", "policy.md", "text/markdown")]
    [InlineData("C:\\Users\\admin\\Desktop\\rules.txt", "rules.txt", "text/plain")] [InlineData("/var/www/html/index.txt", "index.txt", "text/plain")] [InlineData("a\r\nb\0.txt", "ab.txt", "text/plain")]
    public void AFileNameBecomesALabelAndItsExtensionDecidesTheType(string given, string label, string type)
    {
        var valid = KnowledgeValidation.Check(File(given), 1000);
        Assert.Equal((label, type), (valid.FileName, valid.MediaType));
        Assert.DoesNotMatch(@"[/\\\p{Cc}]", valid.FileName);
    }

    [Theory]
    [InlineData("report.pdf", "text/plain", 415)] [InlineData("report.docx", "text/plain", 415)] [InlineData("run.exe", "text/plain", 415)] [InlineData("photo.png", "image/png", 415)]
    [InlineData("noextension", "text/plain", 415)] [InlineData("policy.txt.exe", "text/plain", 415)] [InlineData("policy.txt", "application/pdf", 415)] [InlineData("policy.md", "text/html", 415)]
    [InlineData("", "text/plain", 400)] [InlineData("../", "text/plain", 400)] [InlineData("..", "text/plain", 400)]
    public void UnsupportedTypesAndUnusableNamesAreRefused(string name, string declared, int status) =>
        Assert.Equal(status, Assert.Throws<KnowledgeRejection>(() => KnowledgeValidation.Check(File(name, type: declared), 1000)).Status);

    [Fact]
    public void SizeTitleAndAudienceAreChecked()
    {
        Assert.Equal(400, Assert.Throws<KnowledgeRejection>(() => KnowledgeValidation.Check(File("a.txt", ""), 1000)).Status);
        Assert.Equal(413, Assert.Throws<KnowledgeRejection>(() => KnowledgeValidation.Check(File("a.txt", new string('x', 1001)), 1000)).Status);
        Assert.Equal("too-large", Assert.Throws<KnowledgeRejection>(() => KnowledgeValidation.Check(File("a.txt", new string('x', 1001)), 1000)).Category);
        Assert.NotNull(KnowledgeValidation.Check(File("a.txt", new string('x', 1000)), 1000));
        Assert.Equal("handbook", KnowledgeValidation.Check(File("handbook.txt"), 1000).Title);
        Assert.Equal("Staff handbook", KnowledgeValidation.Check(File("h.txt", title: "  Staff\r\n handbook "), 1000).Title.Replace("  ", " "));
        Assert.Equal(400, Assert.Throws<KnowledgeRejection>(() => KnowledgeValidation.Check(File("a.txt", title: new string('t', 201)), 1000)).Status);
        Assert.Equal(new[] { "parent", "teacher" }, KnowledgeValidation.Check(File("a.txt", audience: [" Teacher", "parent", "teacher"]), 1000).Audience);
        foreach (var audience in new[] { new[] { "everyone" }, new[] { "platform" }, new[] { " " }, new[] { "teacher", "admin" } })
            Assert.Equal("audience", Assert.Throws<KnowledgeRejection>(() => KnowledgeValidation.Check(File("a.txt", audience: audience), 1000)).Category);
    }

    [Fact]
    public void OnlyReadableUtf8TextIsExtracted()
    {
        static ValidatedUpload Bytes(params byte[] bytes) => new("a.txt", "text/plain", "a", ["school"], bytes);
        Assert.Equal("Fee ₹500 — café", KnowledgeExtraction.Text(Bytes(Encoding.UTF8.GetBytes("Fee ₹500 — café"))));
        foreach (var binary in new[]
        {
            Encoding.ASCII.GetBytes("%PDF-1.7 plain looking pdf"), [0x50, 0x4B, 0x03, 0x04, 0x41], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A], [0xFF, 0xD8, 0xFF, 0xE0],
            Encoding.ASCII.GetBytes("text with a zero\0byte"), [0xC3, 0x28], Encoding.Unicode.GetBytes("UTF-16 text"), Encoding.ASCII.GetBytes("\u0001\u0002\u0003\u0004\u0005\u0006 mostly control"),
        })
        {
            var refused = Assert.Throws<KnowledgeRejection>(() => KnowledgeExtraction.Text(Bytes(binary)));
            Assert.Equal((415, "not-text"), (refused.Status, refused.Category));
        }
    }

    [Fact]
    public void NormalisationGivesOneCanonicalFormAndAStableHash()
    {
        var messy = "\uFEFFTitle  \r\n\r\n\r\n\r\nLine one\t tabbed   \rLine two\u0007\u200B\n\n\n   \nCafe\u0301 ";
        var clean = KnowledgeNormalization.Normalize(messy);
        Assert.Equal("Title\n\nLine one\t tabbed\nLine two\n\nCafé", clean);
        Assert.Equal(clean, KnowledgeNormalization.Normalize(clean));
        Assert.Equal(KnowledgeNormalization.Hash(clean), KnowledgeNormalization.Hash(KnowledgeNormalization.Normalize("Title\n\nLine one\t tabbed\r\nLine two\n\nCaf\u00E9\n\n")));
        Assert.Matches("^[0-9a-f]{64}$", KnowledgeNormalization.Hash(clean));
        Assert.Equal("", KnowledgeNormalization.Normalize(" \r\n\t\n "));
    }

    [Fact]
    public void AShortTextIsOneChunkWithExactOffsets()
    {
        var chunk = Assert.Single(KnowledgeChunker.Split("The term starts on 3 June.", 1200, 150, false));
        Assert.Equal(new KnowledgeChunk(0, "The term starts on 3 June.", 0, 26, null, chunk.TokenEstimate), chunk);
        Assert.Empty(KnowledgeChunker.Split("", 1200, 150, false));
    }

    [Theory]
    [InlineData(200, 0)] [InlineData(200, 100)] [InlineData(500, 60)] [InlineData(1200, 150)] [InlineData(8000, 4000)]
    public void ChunksAreBoundedOrderedCoverTheTextAndOverlapAsConfigured(int size, int overlap)
    {
        var text = KnowledgeNormalization.Normalize(string.Join("\n\n", Enumerable.Range(0, 60).Select(p => $"Paragraph {p}. " + Words(40 + p % 7) + ".")));
        var chunks = KnowledgeChunker.Split(text, size, overlap, false);
        Assert.Equal(chunks, KnowledgeChunker.Split(text, size, overlap, false));
        Assert.Equal(Enumerable.Range(0, chunks.Count), chunks.Select(c => c.Ordinal));
        var covered = new bool[text.Length];
        foreach (var chunk in chunks)
        {
            Assert.InRange(chunk.Text.Length, 1, size);
            Assert.Equal(text[chunk.CharStart..chunk.CharEnd], chunk.Text);
            Assert.False(char.IsWhiteSpace(chunk.Text[0]) || char.IsWhiteSpace(chunk.Text[^1]));
            Assert.True(chunk.TokenEstimate > 0);
            for (var i = chunk.CharStart; i < chunk.CharEnd; i++) covered[i] = true;
        }
        // Nothing but whitespace is left out.
        Assert.DoesNotContain(Enumerable.Range(0, text.Length), i => !covered[i] && !char.IsWhiteSpace(text[i]));
        foreach (var (previous, next) in chunks.Zip(chunks.Skip(1)))
        {
            Assert.True(next.CharStart > previous.CharStart && next.CharEnd > previous.CharEnd);
            Assert.InRange(previous.CharEnd - next.CharStart, overlap == 0 ? int.MinValue : 0, overlap);
            if (overlap == 0) Assert.True(next.CharStart >= previous.CharEnd);
            // An overlapping chunk starts at the beginning of a word.
            Assert.True(next.CharStart == 0 || char.IsWhiteSpace(text[next.CharStart - 1]));
        }
    }

    [Theory]
    [InlineData(199, 1)] [InlineData(200, 1)] [InlineData(201, 2)] [InlineData(400, 2)] [InlineData(401, 3)]
    public void TextWithoutAnyBoundaryIsCutExactlyAtTheLimit(int length, int expected)
    {
        var chunks = KnowledgeChunker.Split(new string('x', length), 200, 0, false);
        Assert.Equal(expected, chunks.Count);
        Assert.Equal(length, chunks.Sum(c => c.Text.Length));
        Assert.All(chunks, c => Assert.InRange(c.Text.Length, 1, 200));
    }

    [Fact]
    public void ACutNeverSplitsOneCharacterInTwo()
    {
        var text = new string('x', 199) + "😀" + new string('y', 300);
        var chunks = KnowledgeChunker.Split(text, 200, 0, false);
        Assert.All(chunks, c => Assert.False(char.IsHighSurrogate(c.Text[^1]) || char.IsLowSurrogate(c.Text[0])));
        Assert.Equal(text, string.Concat(chunks.Select(c => c.Text)));
    }

    [Fact]
    public void ChunksPreferParagraphAndSentenceBoundaries()
    {
        var text = new string('a', 150) + ". " + new string('b', 30) + "\n\n" + new string('c', 100) + ". " + new string('d', 100);
        var chunks = KnowledgeChunker.Split(text, 200, 0, false);
        Assert.Equal(new string('a', 150) + ". " + new string('b', 30), chunks[0].Text);
        Assert.Equal(new string('c', 100) + ".", chunks[1].Text);
        Assert.Equal(new string('d', 100), chunks[2].Text);
    }

    [Fact]
    public void MarkdownChunksCarryTheirSectionForCitations()
    {
        var text = KnowledgeNormalization.Normalize("Intro before any heading.\n\n# Fees\n\n" + Words(60) + "\n\n## Late payment ##\n\n" + Words(60) + "\n\n# Transport\n\n" + Words(20));
        var chunks = KnowledgeChunker.Split(text, 300, 0, true);
        Assert.Null(chunks[0].Section);
        Assert.Equal(new[] { "Fees", "Late payment", "Transport" }, chunks.Select(c => c.Section).Where(s => s is not null).Distinct());
        Assert.Equal("Transport", chunks[^1].Section);
        Assert.All(chunks, c => Assert.Null(c.Page));
        Assert.All(KnowledgeChunker.Split(text, 300, 0, false), c => Assert.Null(c.Section));
    }

    [Theory]
    [InlineData(199, 0)] [InlineData(8001, 0)] [InlineData(0, 0)] [InlineData(1000, 501)] [InlineData(1000, -1)]
    public void UnreasonableChunkSettingsAreRefused(int size, int overlap)
    {
        Assert.NotNull(KnowledgeChunker.Problem(size, overlap));
        Assert.Throws<ArgumentException>(() => KnowledgeChunker.Split("text", size, overlap, false));
    }
}

public class AiKnowledgeTests
{
    const string Manage = "ai.knowledge.manage", Marker = "quokka-lantern";
    static readonly byte[] Handbook = Encoding.UTF8.GetBytes("# Attendance\n\nStudents arrive by 8:15. " + Marker + " is the late-arrival code word.\n\n# Fees\n\n" + string.Join(" ", Enumerable.Repeat("Fees are due on the fifth of each month.", 60)));
    static Task<AiHost> On(InMemoryKnowledgeStore? store = null, InMemoryUsageStore? usage = null, Dictionary<string, string?>? settings = null, TimeProvider? clock = null) => AiGatewayTests.On(settings: settings, usage: usage, knowledge: store, clock: clock);
    static async Task<JsonElement> Data(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"{(int)response.StatusCode}: {body}");
        return JsonSerializer.Deserialize<JsonElement>(body).GetProperty("data");
    }

    [Fact]
    public async Task ASchoolUserWithThePermissionAddsListsAndRemovesADocument()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token("Administrator", "school", permissions: Manage);
        var added = await Data(await host.Upload(token, "Staff Handbook.md", Handbook, "text/markdown", "teacher,school", "Staff handbook 2026"), HttpStatusCode.Created);
        Assert.Equal((true, "Staff handbook 2026", "ready", false), (added.GetProperty("available").GetBoolean(), added.GetProperty("title").GetString(), added.GetProperty("status").GetString(), added.GetProperty("duplicate").GetBoolean()));
        var (school, user, id, document, chunks) = Assert.Single(store.Documents);
        Assert.Equal(host.School, school);
        Assert.Equal((added.GetProperty("id").GetGuid(), added.GetProperty("chunks").GetInt32(), added.GetProperty("characters").GetInt32()), (id, chunks.Count, document.CharCount));
        Assert.Equal(("Staff Handbook.md", "text/markdown", Handbook.Length), (document.FileName, document.MediaType, document.ByteCount));
        Assert.Equal(new[] { "school", "teacher" }, document.Audience);
        Assert.True(chunks.Count > 1);
        Assert.All(chunks, c => Assert.InRange(c.Text.Length, 1, 1200));
        Assert.Equal(new[] { "Attendance", "Fees" }, chunks.Select(c => c.Section).Distinct());

        var listed = (await Data(await host.Get(AiHost.Knowledge, token))).GetProperty("documents");
        Assert.Equal(id, Assert.Single(listed.EnumerateArray()).GetProperty("id").GetGuid());
        // The list describes documents; it never returns their text.
        Assert.DoesNotContain(Marker, listed.GetRawText());
        Assert.Equal(HttpStatusCode.NoContent, (await host.Delete(AiHost.Knowledge + "/" + id, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.Delete(AiHost.Knowledge + "/" + id, token)).StatusCode);
        Assert.Empty(store.Documents);
    }

    [Fact]
    public async Task OnlyAPermittedSchoolUserMayManageKnowledge()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var id = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Upload(null, "a.txt", Handbook)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Get(AiHost.Knowledge, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Delete(AiHost.Knowledge + "/" + id, null)).StatusCode);
        foreach (var token in new[]
        {
            host.Token("Administrator", "school", permissions: ["ai.assistant.use", "ai.usage.view", "documents.upload"]),
            host.Token("Teacher", "teacher", permissions: "ai.assistant.use"),
            host.Token("SuperAdmin", "platform", EduOSTenants.Platform, null, "platform.manage", "ai.platform.manage", Manage),
        })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await host.Upload(token, "a.txt", Handbook)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await host.Get(AiHost.Knowledge, token)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await host.Delete(AiHost.Knowledge + "/" + id, token)).StatusCode);
        }
        Assert.Empty(store.Documents);
    }

    [Fact]
    public async Task TheSchoolComesFromTheTokenWhateverTheUploadClaims()
    {
        var store = new InMemoryKnowledgeStore(); var other = Guid.NewGuid();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Upload(token, "a.txt", Handbook, url: AiHost.Knowledge + "?schoolId=" + other)).StatusCode);
        Assert.Empty(store.Documents);
        // Form fields that name a school are not read at all.
        await Data(await host.Upload(token, "a.txt", Handbook, extra: [("schoolId", other.ToString()), ("school_id", other.ToString()), ("school", other.ToString())]), HttpStatusCode.Created);
        Assert.Equal(host.School, Assert.Single(store.Documents).School);
    }

    [Fact]
    public async Task EachSchoolSeesAndRemovesOnlyItsOwnDocuments()
    {
        var store = new InMemoryKnowledgeStore(); var other = Guid.NewGuid();
        await using var host = await On(store);
        var mine = host.Token(permissions: Manage); var theirs = host.Token(school: other, permissions: Manage);
        var myId = (await Data(await host.Upload(mine, "mine.txt", Encoding.UTF8.GetBytes("Our school rules.")), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var theirId = (await Data(await host.Upload(theirs, "theirs.txt", Encoding.UTF8.GetBytes("Their school rules.")), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        Assert.Equal(myId, Assert.Single((await Data(await host.Get(AiHost.Knowledge, mine))).GetProperty("documents").EnumerateArray()).GetProperty("id").GetGuid());
        Assert.Equal(theirId, Assert.Single((await Data(await host.Get(AiHost.Knowledge, theirs))).GetProperty("documents").EnumerateArray()).GetProperty("id").GetGuid());
        Assert.Equal(HttpStatusCode.NotFound, (await host.Delete(AiHost.Knowledge + "/" + theirId, mine)).StatusCode);
        Assert.Equal(2, store.Documents.Count);
        // The same text in two schools is two documents: one school learns nothing about the other from a duplicate.
        var copy = await Data(await host.Upload(theirs, "copy.txt", Encoding.UTF8.GetBytes("Our school rules.")), HttpStatusCode.Created);
        Assert.False(copy.GetProperty("duplicate").GetBoolean());
        Assert.NotEqual(myId, copy.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task TheSameTextIsStoredOncePerSchool()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        var first = await Data(await host.Upload(token, "rules.txt", Encoding.UTF8.GetBytes("Rule one.\r\n\r\nRule two.  \r\n")), HttpStatusCode.Created);
        // Different name, line endings and trailing space, same text.
        var again = await Data(await host.Upload(token, "rules-copy.md", Encoding.UTF8.GetBytes("Rule one.\n\nRule two."), "text/markdown", title: "Another title"));
        Assert.Equal((true, first.GetProperty("id").GetGuid()), (again.GetProperty("duplicate").GetBoolean(), again.GetProperty("id").GetGuid()));
        Assert.Single(store.Documents);
    }

    [Theory]
    [InlineData("report.pdf", "application/pdf", HttpStatusCode.UnsupportedMediaType)] [InlineData("report.docx", "application/octet-stream", HttpStatusCode.UnsupportedMediaType)]
    [InlineData("script.exe", "application/octet-stream", HttpStatusCode.UnsupportedMediaType)] [InlineData("page.html", "text/html", HttpStatusCode.UnsupportedMediaType)]
    [InlineData("notes.txt", "application/pdf", HttpStatusCode.UnsupportedMediaType)] [InlineData("..", "text/plain", HttpStatusCode.BadRequest)]
    public async Task UnsupportedFilesAreRefusedAndNothingIsStored(string name, string type, HttpStatusCode expected)
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var response = await host.Upload(host.Token(permissions: Manage), name, Handbook, type);
        Assert.Equal(expected, response.StatusCode);
        Assert.Empty(store.Documents);
    }

    [Fact]
    public async Task BinaryContentUnderATextNameIsRefused()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        foreach (var bytes in new[] { Encoding.ASCII.GetBytes("%PDF-1.7\n1 0 obj"), new byte[] { 0x50, 0x4B, 0x03, 0x04, 0x14, 0x00 }, new byte[] { 0x89, 0x50, 0x4E, 0x47 }, Encoding.ASCII.GetBytes("looks fine\0but is not"), Encoding.UTF8.GetBytes("   \r\n \t ") })
            Assert.Contains((await host.Upload(token, "innocent.txt", bytes)).StatusCode, new[] { HttpStatusCode.UnsupportedMediaType, HttpStatusCode.BadRequest });
        Assert.Empty(store.Documents);
    }

    [Fact]
    public async Task OversizedUploadsAndOversizedTextAreRefused()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store, settings: new() { ["Ai:Knowledge:MaxUploadBytes"] = "4096", ["Ai:Knowledge:MaxTextChars"] = "2000" });
        var token = host.Token(permissions: Manage);
        // Larger than the whole request allowance: refused before the body is read.
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await host.Upload(token, "big.txt", new byte[4096 + AiService.UploadOverheadBytes + 1])).StatusCode);
        // Fits in the request but the file itself is over the limit.
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await host.Upload(token, "big.txt", Encoding.ASCII.GetBytes(new string('a', 4097)))).StatusCode);
        // The file is within the limit but holds more text than one document may.
        var long_ = await host.Upload(token, "long.txt", Encoding.ASCII.GetBytes(string.Join(" ", Enumerable.Repeat("word", 600))));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, long_.StatusCode);
        Assert.Contains("2000 characters", await long_.Content.ReadAsStringAsync());
        Assert.Empty(store.Documents);
        await Data(await host.Upload(token, "ok.txt", Encoding.ASCII.GetBytes(string.Join(" ", Enumerable.Repeat("word", 300)))), HttpStatusCode.Created);
    }

    [Fact]
    public async Task AFileNameIsOnlyALabelAndNeverAPath()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        var names = new[] { "../../../etc/cron.d/job.txt", "..\\..\\appsettings.md", "/app/Migrations/x.txt", "C:\\inetpub\\wwwroot\\y.txt" };
        for (var i = 0; i < names.Length; i++) await Data(await host.Upload(token, names[i], Encoding.UTF8.GetBytes("Document number " + i)), HttpStatusCode.Created);
        Assert.Equal(new[] { "job.txt", "appsettings.md", "x.txt", "y.txt" }, store.Documents.Select(d => d.Document.FileName));
        Assert.Equal(new[] { "job", "appsettings", "x", "y" }, store.Documents.Select(d => d.Document.Title));
    }

    [Fact]
    public async Task MalformedUploadsAreRefused()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await host.Post(AiHost.Knowledge, token, "{\"file\":\"text\"}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await host.Upload(token, "a.txt", Handbook, audience: null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await host.Upload(token, "a.txt", Handbook, audience: "everyone")).StatusCode);
        var twoFiles = new MultipartFormDataContent { { new ByteArrayContent(Handbook), "file", "a.txt" }, { new ByteArrayContent(Handbook), "file", "b.txt" }, { new StringContent("school"), "audience" } };
        var wrongField = new MultipartFormDataContent { { new ByteArrayContent(Handbook), "document", "a.txt" }, { new StringContent("school"), "audience" } };
        foreach (var content in new[] { twoFiles, wrongField })
        {
            var request = new HttpRequestMessage(HttpMethod.Post, AiHost.Knowledge) { Content = content };
            request.Headers.Authorization = new("Bearer", token);
            Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.SendAsync(request)).StatusCode);
        }
        Assert.Empty(store.Documents);
    }

    [Fact]
    public async Task AFailedWriteLeavesNothingBehindAndIsReportedSafely()
    {
        var store = new InMemoryKnowledgeStore { FailWrites = true };
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        var response = await host.Upload(token, "a.txt", Handbook);
        Assert.DoesNotContain("internal.example", await response.Content.ReadAsStringAsync());
        Assert.Equal((false, "database-unavailable"), ((await Data(response)).GetProperty("available").GetBoolean(), (await Data(response)).GetProperty("reason").GetString()));
        store.FailWrites = false;
        Assert.Empty((await Data(await host.Get(AiHost.Knowledge, token))).GetProperty("documents").EnumerateArray());
        store.FailReads = true;
        Assert.Equal("database-unavailable", (await Data(await host.Get(AiHost.Knowledge, token))).GetProperty("reason").GetString());
    }

    [Fact]
    public async Task KnowledgeFollowsTheDeploymentAndSchoolSwitchesAndChargesNoQuota()
    {
        var store = new InMemoryKnowledgeStore(); var usage = new InMemoryUsageStore { Default = new() { Enabled = false } };
        await using var host = await On(store, usage);
        var token = host.Token(permissions: Manage);
        Assert.Equal("school-disabled", (await Data(await host.Upload(token, "a.txt", Handbook))).GetProperty("reason").GetString());
        Assert.Equal("school-disabled", (await Data(await host.Get(AiHost.Knowledge, token))).GetProperty("reason").GetString());
        Assert.Empty(store.Documents);
        // Switched on with no token allowance at all: ingestion calls no model, so it is not a matter of quota.
        usage.Default = new() { Enabled = true, Budget = 0 };
        await Data(await host.Upload(token, "a.txt", Handbook), HttpStatusCode.Created);
        Assert.Empty(usage.Records); Assert.Empty(usage.Reservations);
        await using var off = await AiHost.Start(false, new StubBootstrap(true), knowledge: store);
        Assert.Equal("not-configured", (await Data(await off.Upload(off.Token(permissions: Manage), "b.txt", Handbook))).GetProperty("reason").GetString());
        Assert.Single(store.Documents);
    }

    [Fact]
    public async Task UploadsAreRateLimitedLikeOtherAiRequests()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store, settings: new() { ["Ai:Limits:UserRequestsPerMinute"] = "2" }, clock: new ManualClock());
        var token = host.Token(permissions: Manage);
        for (var i = 0; i < 2; i++) await Data(await host.Upload(token, "a.txt", Encoding.UTF8.GetBytes("Document " + i)), HttpStatusCode.Created);
        var limited = await Data(await host.Upload(token, "a.txt", Encoding.UTF8.GetBytes("Document 3")));
        Assert.Equal("rate-limited", limited.GetProperty("reason").GetString());
        Assert.InRange(limited.GetProperty("retryAfterSeconds").GetInt32(), 1, 60);
        Assert.Equal(2, store.Documents.Count);
    }

    [Fact]
    public async Task NoDocumentTextReachesTheLogs()
    {
        var store = new InMemoryKnowledgeStore();
        await using var host = await On(store);
        var token = host.Token(permissions: Manage);
        var id = (await Data(await host.Upload(token, "Staff Handbook.md", Handbook, "text/markdown", title: "Handbook"), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        await host.Upload(token, "bad.pdf", Handbook, "application/pdf");
        store.FailWrites = true;
        await host.Upload(token, "again.txt", Encoding.UTF8.GetBytes(Marker + " once more"));
        Assert.DoesNotContain(host.Logs, line => line.Contains(Marker) || line.Contains("late-arrival") || line.Contains("fifth of each month"));
        Assert.Contains(host.Logs, line => line.Contains($"Knowledge document {id} stored: {Handbook.Length} bytes"));
        Assert.Contains(host.Logs, line => line.Contains("Knowledge document rejected: unsupported-type"));
        Assert.Contains(host.Logs, line => line.Contains("Knowledge write failed (InvalidOperationException)"));
    }

    [Theory]
    [InlineData("Ai:Knowledge:ChunkMaxChars", "100")] [InlineData("Ai:Knowledge:ChunkOverlapChars", "5000")] [InlineData("Ai:Knowledge:MaxUploadBytes", "999999999")] [InlineData("Ai:Knowledge:MaxTextChars", "10")]
    public async Task InvalidKnowledgeLimitsStopTheServiceAtStart(string key, string value) =>
        await Assert.ThrowsAsync<OptionsValidationException>(() => On(settings: new() { [key] = value }));
}

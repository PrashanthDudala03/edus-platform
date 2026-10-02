using System.Net;
using System.Text;
using EduOS.Ai.Gateway;
using EduOS.Ai.Knowledge;
using Npgsql;
using Xunit;

/// <summary>School knowledge against a real AI database, as ai_app. Skipped without AI_TEST_DB_*.</summary>
public class AiKnowledgeIntegrationTests(AiDatabaseFixture fixture) : IClassFixture<AiDatabaseFixture>
{
    static (NewKnowledgeDocument Document, IReadOnlyList<KnowledgeChunk> Chunks) Prepared(string text, string title = "Rules")
    {
        var normal = KnowledgeNormalization.Normalize(text);
        return (new NewKnowledgeDocument(title, "rules.md", "text/markdown", ["school", "teacher"], Encoding.UTF8.GetByteCount(text), normal.Length, KnowledgeNormalization.Hash(normal)), KnowledgeChunker.Split(normal, 200, 40, true));
    }
    static string Long(string marker) => "# Rules\n\n" + string.Join(" ", Enumerable.Range(0, 120).Select(i => marker + i));
    static Task<long> Count(string table, Guid school) => AiDatabaseFixture.AsOwner<long>($"SELECT count(*) FROM ai.{table} WHERE school_id = @s", ("s", school));
    PostgresKnowledgeStore Store => new(fixture.Database);
    Task<long> CountAs(Guid school, string table) => fixture.Database.InSchool(AiDatabaseFixture.Tenant(school), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, $"SELECT count(*) FROM ai.{table}", t));
    Task<int> RunAs(Guid school, string sql) => fixture.Database.InSchool(AiDatabaseFixture.Tenant(school), async (c, t, _) => { await using var command = new NpgsqlCommand(sql, c, t); return await command.ExecuteNonQueryAsync(); });

    [DatabaseFact]
    public async Task ADocumentIsStoredWithItsChunksAndCitationData()
    {
        var school = Guid.NewGuid(); var caller = AiDatabaseFixture.Tenant(school); var (document, chunks) = Prepared(Long("alpha"));
        var saved = await Store.Save(caller, document, chunks, default);
        Assert.Equal((false, chunks.Count, document.CharCount), (saved.Duplicate, saved.Chunks, saved.Characters));
        Assert.True(chunks.Count > 3);
        Assert.Equal($"Rules|rules.md|text/markdown|school,teacher|processing|{document.ByteCount}|{document.CharCount}|{chunks.Count}|{caller.UserId}", await AiDatabaseFixture.AsOwner<string>(
            "SELECT concat_ws('|', title, file_name, media_type, array_to_string(audience, ','), status, byte_count, char_count, chunk_count, uploaded_by) FROM ai.knowledge_documents WHERE id = @id", ("id", saved.Id)));
        // Every chunk is there, in order, with the offsets and section a citation will need, and with the school of its document.
        Assert.Equal(string.Join(";", chunks.Select(c => $"{c.Ordinal}:{c.CharStart}-{c.CharEnd}:{c.Section}:{c.Text.Length}")), await AiDatabaseFixture.AsOwner<string>(
            "SELECT string_agg(ordinal || ':' || char_start || '-' || char_end || ':' || COALESCE(section, '') || ':' || length(text), ';' ORDER BY ordinal) FROM ai.knowledge_chunks WHERE document_id = @id AND school_id = @s", ("id", saved.Id), ("s", school)));
        var listed = Assert.Single(await Store.List(caller, default));
        Assert.Equal((saved.Id, "Rules", "processing", chunks.Count), (listed.Id, listed.Title, listed.Status, listed.Chunks));
        Assert.Null(listed.EmbeddingSpaceId);
        Assert.Equal(new[] { "school", "teacher" }, listed.Audience);
    }

    [DatabaseFact]
    public async Task KnowledgeIsInvisibleWithoutASchoolAndToEveryOtherSchool()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        var (documentA, chunksA) = Prepared(Long("alpha")); var (documentB, chunksB) = Prepared(Long("bravo"), "Other rules");
        var savedA = await Store.Save(AiDatabaseFixture.Tenant(a), documentA, chunksA, default);
        var savedB = await Store.Save(AiDatabaseFixture.Tenant(b), documentB, chunksB, default);
        // No school: nothing, in either table, even when the row is named.
        await using (var connection = new NpgsqlConnection(AiDatabaseFixture.Runtime))
        {
            await connection.OpenAsync();
            Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.knowledge_documents"));
            Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, "SELECT count(*) FROM ai.knowledge_chunks"));
            Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, $"SELECT count(*) FROM ai.knowledge_chunks WHERE document_id = '{savedA.Id}'"));
            // A delete without a school finds no row to remove, and an insert is refused.
            Assert.Equal(0, await AiDatabaseFixture.Scalar<long>(connection, $"WITH x AS (DELETE FROM ai.knowledge_documents WHERE id = '{savedA.Id}' RETURNING 1) SELECT count(*) FROM x"));
            await AiDatabaseFixture.Denied(() => AiDatabaseFixture.Scalar<long>(connection, $"WITH x AS (INSERT INTO ai.knowledge_chunks (school_id, document_id, ordinal, text, char_start, char_end, token_estimate) VALUES ('{a}', '{savedA.Id}', 998, 'planted', 0, 7, 2) RETURNING 1) SELECT count(*) FROM x"));
        }
        Assert.Equal(1, await Count("knowledge_documents", a));
        // Each school: its own document and chunks only.
        Assert.Equal((1L, (long)chunksA.Count), (await CountAs(a, "knowledge_documents"), await CountAs(a, "knowledge_chunks")));
        Assert.Equal((1L, (long)chunksB.Count), (await CountAs(b, "knowledge_documents"), await CountAs(b, "knowledge_chunks")));
        Assert.Equal(savedA.Id, Assert.Single(await Store.List(AiDatabaseFixture.Tenant(a), default)).Id);
        Assert.Equal(0, await fixture.Database.InSchool(AiDatabaseFixture.Tenant(a), (c, t, _) => AiDatabaseFixture.Scalar<long>(c, $"SELECT count(*) FROM ai.knowledge_chunks WHERE document_id = '{savedB.Id}' OR text LIKE '%bravo%'", t)));
        // One school cannot remove, or add chunks to, a document of another.
        Assert.False(await Store.Delete(AiDatabaseFixture.Tenant(a), savedB.Id, default));
        Assert.Equal(chunksB.Count, await Count("knowledge_chunks", b));
        await AiDatabaseFixture.Denied(() => RunAs(a, $"INSERT INTO ai.knowledge_chunks (school_id, document_id, ordinal, text, char_start, char_end, token_estimate) VALUES ('{b}', '{savedB.Id}', 999, 'planted', 0, 7, 2)"));
        // With its own school on the row it passes row-level security, and the two-column reference refuses it instead.
        await AiDatabaseFixture.Denied(() => RunAs(a, $"INSERT INTO ai.knowledge_chunks (school_id, document_id, ordinal, text, char_start, char_end, token_estimate) VALUES ('{a}', '{savedB.Id}', 999, 'planted', 0, 7, 2)"), "23503");
        await AiDatabaseFixture.Denied(() => RunAs(a, $"INSERT INTO ai.knowledge_documents (school_id, title, file_name, media_type, audience, byte_count, char_count, chunk_count, text_sha256, uploaded_by) VALUES ('{b}', 't', 'f.txt', 'text/plain', ARRAY['school'], 1, 1, 1, repeat('a', 64), gen_random_uuid())"));
        Assert.Equal(chunksB.Count, await Count("knowledge_chunks", b));
    }

    [DatabaseFact]
    public async Task TheSameTextIsKeptOncePerSchoolAndSeparatelyAcrossSchools()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(); var (document, chunks) = Prepared(Long("charlie"));
        var first = await Store.Save(AiDatabaseFixture.Tenant(a), document, chunks, default);
        var again = await Store.Save(AiDatabaseFixture.Tenant(a), document with { Title = "Renamed" }, chunks, default);
        Assert.Equal((true, first.Id, "Rules"), (again.Duplicate, again.Id, again.Title));
        var elsewhere = await Store.Save(AiDatabaseFixture.Tenant(b), document, chunks, default);
        Assert.False(elsewhere.Duplicate); Assert.NotEqual(first.Id, elsewhere.Id);
        Assert.Equal((1L, 1L), (await Count("knowledge_documents", a), await Count("knowledge_documents", b)));
        // Simultaneous uploads of one text in one school still give one document.
        var school = Guid.NewGuid(); var (same, pieces) = Prepared(Long("delta"));
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => Store.Save(AiDatabaseFixture.Tenant(school), same, pieces, default))));
        Assert.Equal(1, results.Count(r => !r.Duplicate)); Assert.Single(results.Select(r => r.Id).Distinct());
        Assert.Equal((1L, (long)pieces.Count), (await Count("knowledge_documents", school), await Count("knowledge_chunks", school)));
    }

    [DatabaseFact]
    public async Task AFailedIngestionLeavesNoDocumentAndNoChunks()
    {
        var school = Guid.NewGuid(); var (document, chunks) = Prepared(Long("echo"));
        // The last chunk breaks a table rule, so the statement that writes the chunks fails after the document row was written.
        var broken = chunks.Take(chunks.Count - 1).Append(chunks[^1] with { CharEnd = chunks[^1].CharStart }).ToList();
        await Assert.ThrowsAsync<PostgresException>(() => Store.Save(AiDatabaseFixture.Tenant(school), document, broken, default));
        Assert.Equal((0L, 0L), (await Count("knowledge_documents", school), await Count("knowledge_chunks", school)));
        // The same text can then be added normally.
        Assert.False((await Store.Save(AiDatabaseFixture.Tenant(school), document, chunks, default)).Duplicate);
        Assert.Equal((1L, (long)chunks.Count), (await Count("knowledge_documents", school), await Count("knowledge_chunks", school)));
    }

    [DatabaseFact]
    public async Task RemovingADocumentRemovesItsChunksAndNothingElseCanBeChanged()
    {
        var school = Guid.NewGuid(); var caller = AiDatabaseFixture.Tenant(school);
        var keep = await Store.Save(caller, Prepared(Long("foxtrot")).Document, Prepared(Long("foxtrot")).Chunks, default);
        var remove = await Store.Save(caller, Prepared(Long("golf")).Document, Prepared(Long("golf")).Chunks, default);
        foreach (var sql in new[]
        {
            "UPDATE ai.knowledge_documents SET audience = ARRAY['student']", "UPDATE ai.knowledge_documents SET title = 'renamed'", "UPDATE ai.knowledge_documents SET text_sha256 = repeat('b', 64)", "UPDATE ai.knowledge_documents SET school_id = gen_random_uuid()", "UPDATE ai.knowledge_chunks SET text = 'changed'",
            "DELETE FROM ai.knowledge_chunks", "TRUNCATE ai.knowledge_chunks", "TRUNCATE ai.knowledge_documents CASCADE", "ALTER TABLE ai.knowledge_chunks DISABLE ROW LEVEL SECURITY", "DROP POLICY tenant_isolation ON ai.knowledge_documents",
        })
        {
            var error = await Assert.ThrowsAsync<PostgresException>(() => RunAs(school, sql));
            Assert.True(error.SqlState == "42501", sql + " -> " + error.SqlState);
        }
        Assert.True(await Store.Delete(caller, remove.Id, default));
        Assert.False(await Store.Delete(caller, remove.Id, default));
        Assert.Equal(0, await AiDatabaseFixture.AsOwner<long>("SELECT count(*) FROM ai.knowledge_chunks WHERE document_id = @id", ("id", remove.Id)));
        Assert.Equal(keep.Id, Assert.Single(await Store.List(caller, default)).Id);
        Assert.Equal(keep.Chunks, await Count("knowledge_chunks", school));
    }

    [DatabaseFact]
    public async Task TheUploadEndpointStoresThroughTheRealDatabaseForTheCallersSchoolOnly()
    {
        Guid on = Guid.NewGuid(), other = Guid.NewGuid(), off = Guid.NewGuid();
        foreach (var (school, enabled) in new[] { (on, true), (other, true), (off, false) })
            await AiDatabaseFixture.AsOwner<int>("WITH x AS (INSERT INTO ai.school_settings (school_id, enabled, monthly_token_budget) VALUES (@s, @e, 0) RETURNING 1) SELECT count(*)::int FROM x", ("s", school), ("e", enabled));
        await using var host = await AiHost.Start(true, new StubBootstrap(true, new(fixture.Space, null)), usage: new PostgresAiUsageStore(fixture.Database, TimeProvider.System), knowledge: Store);
        var text = Encoding.UTF8.GetBytes("# Transport\n\nBus routes change on Mondays, heron-compass.\n\n# Fees\n\n" + string.Join(" ", Enumerable.Repeat("Fees are due on the fifth.", 80)));
        var token = host.Token(school: on, permissions: "ai.knowledge.manage");
        var created = await host.Upload(token, "../../Transport Policy.md", text, "text/markdown", "parent,student", extra: [("schoolId", other.ToString())]);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("Transport Policy.md|Transport Policy|parent,student|ready", await AiDatabaseFixture.AsOwner<string>(
            "SELECT concat_ws('|', file_name, title, array_to_string(audience, ','), status) FROM ai.knowledge_documents WHERE school_id = @s", ("s", on)));
        Assert.Equal("Fees,Transport", await AiDatabaseFixture.AsOwner<string>("SELECT string_agg(DISTINCT section, ',' ORDER BY section) FROM ai.knowledge_chunks WHERE school_id = @s", ("s", on)));
        Assert.Equal((0L, 0L), (await Count("knowledge_documents", other), await Count("knowledge_chunks", other)));
        // Another school lists nothing; a school that is switched off can neither add nor list.
        var theirs = await AiGatewayTests.Data(await host.Get(AiHost.Knowledge, host.Token(school: other, permissions: "ai.knowledge.manage")));
        Assert.Empty(theirs.GetProperty("documents").EnumerateArray());
        Assert.Equal("school-disabled", (await AiGatewayTests.Data(await host.Upload(host.Token(school: off, permissions: "ai.knowledge.manage"), "a.txt", text))).GetProperty("reason").GetString());
        Assert.Equal(0, await Count("knowledge_documents", off));
        // Ingestion made no model call, so nothing was metered or reserved.
        Assert.Equal((0L, 0L), (await Count("usage_events", on), await Count("usage_reservations", on)));
        Assert.Equal(HttpStatusCode.OK, (await host.Upload(token, "copy.md", text, "text/markdown", "parent")).StatusCode);
        Assert.Equal(1, await Count("knowledge_documents", on));
    }
}

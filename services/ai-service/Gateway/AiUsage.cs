using EduOS.ServiceAuth;
using Npgsql;

namespace EduOS.Ai.Gateway;

public enum AiAdmission { Granted, SchoolDisabled, QuotaExceeded }

public sealed record AiReservation(AiAdmission Admission, Guid Id = default);

/// <summary>What is kept about one provider call. Counts and identifiers only: never the question, the answer or any school data.</summary>
public sealed record AiUsageRecord(string Feature, string Provider, string Model, int InputTokens, int OutputTokens, bool Estimated, int LatencyMs, bool Success, string? ErrorCode = null, int Tier = 1);

public sealed record AiUsageSummary(bool Enabled, long MonthlyTokenBudget, long TokensUsed, long TokensReserved, long Calls, long FailedCalls, DateTimeOffset MonthStart)
{
    public long TokensRemaining => Math.Max(0, MonthlyTokenBudget - TokensUsed - TokensReserved);
}

/// <summary>
/// A school's AI switch, monthly allowance and usage. Every method works for the school in the verified token
/// and for no other; there is no way to name a school.
/// </summary>
public interface IAiUsageStore
{
    /// <summary>
    /// Atomically checks the switch and the allowance and, if both allow it, holds <paramref name="tokens"/> until
    /// the call is settled or <paramref name="hold"/> has passed.
    /// </summary>
    Task<AiReservation> Reserve(TenantContext tenant, int tokens, TimeSpan hold, CancellationToken cancellation);
    /// <summary>Removes the reservation and, when a record is given, stores it in the same transaction.</summary>
    Task Settle(TenantContext tenant, Guid reservation, AiUsageRecord? record, CancellationToken cancellation);
    Task<AiUsageSummary> Summary(TenantContext tenant, CancellationToken cancellation);
}

/// <summary>
/// The allowance is the school's monthly token budget (calendar month, UTC). Spent tokens are those of successful
/// calls this month; failed calls are recorded but not charged. A request is admitted only if spent tokens, the
/// reservations of calls still in progress and its own worst case all fit in the budget.
/// </summary>
public sealed class PostgresAiUsageStore(AiDatabase database, TimeProvider clock) : IAiUsageStore
{
    static DateTimeOffset Month(DateTimeOffset now) => new(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
    static NpgsqlCommand Command(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql, params (string Name, object? Value)[] parameters)
    {
        var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }

    public Task<AiReservation> Reserve(TenantContext tenant, int tokens, TimeSpan hold, CancellationToken cancellation)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(tokens, 1);
        var now = clock.GetUtcNow();
        return database.InSchool(tenant, async (connection, transaction, token) =>
        {
            // One request of a school at a time decides and reserves, so two cannot both take the last of the allowance.
            await using (var serialize = Command(connection, transaction, "SELECT pg_advisory_xact_lock(hashtextextended(@key, 0))", ("key", "ai-quota:" + tenant.SchoolId)))
                await serialize.ExecuteNonQueryAsync(token);
            await using (var expire = Command(connection, transaction, "DELETE FROM ai.usage_reservations WHERE expires_at <= @now", ("now", now)))
                await expire.ExecuteNonQueryAsync(token);
            bool enabled; long budget, used, reserved;
            await using (var read = Command(connection, transaction, """
                SELECT s.enabled, s.monthly_token_budget,
                 (SELECT COALESCE(sum(input_tokens::bigint + output_tokens), 0)::bigint FROM ai.usage_events WHERE success AND created_at >= @month),
                 (SELECT COALESCE(sum(tokens::bigint), 0)::bigint FROM ai.usage_reservations)
                FROM ai.school_settings s
                """, ("month", Month(now))))
            await using (var row = await read.ExecuteReaderAsync(token))
            {
                // No settings row means the school has never been switched on.
                if (!await row.ReadAsync(token)) return new AiReservation(AiAdmission.SchoolDisabled);
                (enabled, budget, used, reserved) = (row.GetBoolean(0), row.GetInt64(1), row.GetInt64(2), row.GetInt64(3));
            }
            if (!enabled) return new AiReservation(AiAdmission.SchoolDisabled);
            if (used + reserved + tokens > budget) return new AiReservation(AiAdmission.QuotaExceeded);
            await using var reserve = Command(connection, transaction,
                "INSERT INTO ai.usage_reservations (school_id, user_id, tokens, created_at, expires_at) VALUES (@school, @user, @tokens, @now, @expires) RETURNING id",
                ("school", tenant.SchoolId), ("user", tenant.UserId), ("tokens", tokens), ("now", now), ("expires", now + hold));
            return new AiReservation(AiAdmission.Granted, (Guid)(await reserve.ExecuteScalarAsync(token))!);
        }, cancellation);
    }

    public Task Settle(TenantContext tenant, Guid reservation, AiUsageRecord? record, CancellationToken cancellation) =>
        database.InSchool(tenant, async (connection, transaction, token) =>
        {
            await using (var release = Command(connection, transaction, "DELETE FROM ai.usage_reservations WHERE id = @id", ("id", reservation)))
                await release.ExecuteNonQueryAsync(token);
            if (record is null) return 0;
            await using var insert = Command(connection, transaction, """
                INSERT INTO ai.usage_events (school_id, user_id, feature, provider, model, tier, input_tokens, output_tokens, usage_estimated, latency_ms, success, error_code, created_at)
                VALUES (@school, @user, @feature, @provider, @model, @tier, @input, @output, @estimated, @latency, @success, @error, @now)
                """,
                ("school", tenant.SchoolId), ("user", tenant.UserId), ("feature", record.Feature), ("provider", record.Provider), ("model", record.Model), ("tier", (short)record.Tier),
                ("input", record.InputTokens), ("output", record.OutputTokens), ("estimated", record.Estimated), ("latency", record.LatencyMs), ("success", record.Success),
                ("error", record.ErrorCode), ("now", clock.GetUtcNow()));
            return await insert.ExecuteNonQueryAsync(token);
        }, cancellation);

    public Task<AiUsageSummary> Summary(TenantContext tenant, CancellationToken cancellation)
    {
        var now = clock.GetUtcNow(); var month = Month(now);
        return database.InSchool(tenant, async (connection, transaction, token) =>
        {
            await using var read = Command(connection, transaction, """
                SELECT COALESCE((SELECT enabled FROM ai.school_settings), false), COALESCE((SELECT monthly_token_budget FROM ai.school_settings), 0)::bigint,
                 COALESCE(sum(input_tokens::bigint + output_tokens) FILTER (WHERE success), 0)::bigint, count(*) FILTER (WHERE success), count(*) FILTER (WHERE NOT success),
                 (SELECT COALESCE(sum(tokens::bigint), 0)::bigint FROM ai.usage_reservations WHERE expires_at > @now)
                FROM ai.usage_events WHERE created_at >= @month
                """, ("month", month), ("now", now));
            await using var row = await read.ExecuteReaderAsync(token);
            await row.ReadAsync(token);
            return new AiUsageSummary(row.GetBoolean(0), row.GetInt64(1), row.GetInt64(2), row.GetInt64(5), row.GetInt64(3), row.GetInt64(4), month);
        }, cancellation);
    }
}

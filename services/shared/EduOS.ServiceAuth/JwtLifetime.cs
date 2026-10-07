namespace EduOS.ServiceAuth;

public static class JwtLifetime
{
    // Permit only a small issuer/validator clock difference; never extend expiration.
    public static readonly TimeSpan NotBeforeTolerance = TimeSpan.FromSeconds(10);

    public static bool IsValid(DateTime? notBefore, DateTime? expires, DateTime now) =>
        expires.HasValue && expires.Value > now &&
        (!notBefore.HasValue || (notBefore.Value <= expires.Value && notBefore.Value <= now.Add(NotBeforeTolerance)));
}

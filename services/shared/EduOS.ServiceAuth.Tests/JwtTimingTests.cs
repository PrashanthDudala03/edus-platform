using System.Net;
using Xunit;

namespace EduOS.ServiceAuth.Tests;

public class JwtTimingTests(ServiceHost host) : IClassFixture<ServiceHost>
{
    [Theory]
    [InlineData(2, 1800, HttpStatusCode.OK)]
    [InlineData(6, 1800, HttpStatusCode.OK)]
    [InlineData(30, 1800, HttpStatusCode.Unauthorized)]
    [InlineData(-60, -1, HttpStatusCode.Unauthorized)]
    public async Task NotBeforeToleranceDoesNotExtendExpiration(int notBefore, int expires, HttpStatusCode expected)
    {
        using var response = await host.Client.SendAsync(ServiceHost.Request(HttpMethod.Get, "/api/users",
            host.Token(EduOSRoles.Administrator, notBeforeSeconds: notBefore, expiresSeconds: expires)));
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public void LifetimeBoundariesAndMalformedLifetimesStayStrict()
    {
        var now = new DateTime(2026, 10, 7, 0, 0, 0, DateTimeKind.Utc);
        Assert.True(JwtLifetime.IsValid(now.AddSeconds(10), now.AddMinutes(1), now));
        Assert.False(JwtLifetime.IsValid(now.AddSeconds(10).AddTicks(1), now.AddMinutes(1), now));
        Assert.False(JwtLifetime.IsValid(now.AddMinutes(-1), now, now));
        Assert.False(JwtLifetime.IsValid(null, null, now));
        Assert.False(JwtLifetime.IsValid(now.AddSeconds(6), now.AddSeconds(5), now));
    }

    [Theory]
    [InlineData(0, HttpStatusCode.OK, HttpStatusCode.OK)]
    [InlineData(1, HttpStatusCode.OK, HttpStatusCode.Unauthorized)]
    [InlineData(0, HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized)]
    public async Task SmallClockDifferenceNeverBypassesLiveRevocation(int version, HttpStatusCode sessionStatus, HttpStatusCode expected)
    {
        var service = new ServiceHost { SessionVersion = version, SessionStatus = sessionStatus };
        await service.InitializeAsync(validateSession: true);
        try
        {
            using var response = await service.Client.SendAsync(ServiceHost.Request(HttpMethod.Get, "/api/users",
                service.Token(EduOSRoles.Administrator, notBeforeSeconds: 2)));
            Assert.Equal(expected, response.StatusCode);
        }
        finally { await service.DisposeAsync(); }
    }

    [Fact]
    public async Task SmallClockDifferenceDoesNotPermitAnotherTenant()
    {
        using var response = await host.Client.SendAsync(ServiceHost.Request(HttpMethod.Get,
            "/api/users?schoolId=" + Guid.NewGuid(), host.Token(EduOSRoles.Administrator, notBeforeSeconds: 2)));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("platform")]
    [InlineData("none")]
    public async Task SmallClockDifferenceDoesNotPermitWrongScope(string scope)
    {
        using var response = await host.Client.SendAsync(ServiceHost.Request(HttpMethod.Get, "/api/users",
            host.Token(EduOSRoles.Administrator, notBeforeSeconds: 2, dataScope: scope)));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}

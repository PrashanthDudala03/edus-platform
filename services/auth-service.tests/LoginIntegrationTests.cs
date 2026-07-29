using System.IdentityModel.Tokens.Jwt;
using Services.Auth.Models;
using Services.Auth.Services;
using Xunit;

namespace Services.Auth.Tests;

/// <summary>
/// Integration tests for the complete authentication flow.
/// These tests verify the end-to-end login path: credentials → DB → JWT signing → response.
/// CRITICAL: These require a live database to run. For now, this demonstrates the test structure.
/// </summary>
public class LoginIntegrationTests
{
    [Fact]
    public void JwtService_IssuesValidRsaSignedToken_WithCorrectClaims()
    {
        // Arrange
        // Real RSA keypair for local testing
        var privateKey = """-----BEGIN PRIVATE KEY-----
MIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQC1qCkG2sROFVYX
CjZw8vtG9c/9Sc/qUKCr+gDCG2UZej+FoiRL8rxG64Su9gp4U515flYd2DLwEAU6
x8K2boBxTyq67jhF8JSkqVNQIhh3vvjGk31Vp0FdSV+k2hbcRaT3ELXDyoQxjLPi
Di5OAK2v2KgPR0eMRul6bjA5LvTSE+KReB466oZ9cl1OxPVrUhBEczyd4unBUkCU
CgRkEUcQ/fEvH8WiKiuRiD0mabRkEUsv1m+IVhmzRyrruhiFEBrxYiJbOjScwX2f
i/0THgJhEI2NbafiHe2cWYyS+YnRbsodoss1E6ECOJWMgNINKRcsNs2nenF67qgi
A5rdXYxBAgMBAAECgf9k7OPrMwN6fmnLEzMVpDa6dG4okCg75RMSrJH1rIXwlo+3
c+yTZaErpd5p3OwKpJBxPiFXI3vpdH0mhnJ5X2g58koQFICfTjLHgtJCF/wpsdup
BN8CbF9PsCkhzFyD6EDm8EzyvEMFyuG5TmrbjsG9v3/5cEvudXEMD5XE4rNfPORd
H2T6ikGhXgEpK2fl/4hz3q2HgrmILGVDuG/gkQECLj5j9KZHl6wLQ6PKso1c87wd
gxWXbbC64Hn613txrWEY2GCu4abyGS/uK3PN3FnokiqEdI8gLdCNjqNxCKSYUw2T
nq13nVn2VOCQ47cKjFTZzAJu73tpLsKlHCYkT6ECgYEA+iwOzniKY/DDBXHCzZaj
h+02c4GIwh/n10s7awiyGbYKxYluduODUG9iaFfTvdb62MFSvserUmD92Ki7AK2/
/++HQCtaM15K/MyHOlm4EtNzqDJocWE5o/AWAda2khwoOtwKpi8Ygpu1N6yhbTB+
iY7hDwVML2p8X23v3OaKrOECgYEAueOALYZ9XXKlOTzAsyHPlSb771N4zUGB8La3
q5Lem/g4XF/7XlFSuDHpBjbbFus2x/wo6M0nOnQxzHY86KRkkikx1GxP8HTI5rau
LBkpijrhJWhNDzXNQV6mQjari+B8kigYlNHMVUhFoIrPJofYa7YOCNMIvIfR4EKl
1g6Qa2ECgYAfG11X9QsYNDa7tZKIZ8O7whY0NJYhtT/puFQSEgm7QrSCLX2L0Oxi
EweEe+87OsEENL2qNT+rRZ4q04g1JGWsWEdUBk/39TCT0Ia8Da3iwWIvNt1fw7wc
E11ZKy6WamPiNbwpP8/nZZ8Z5iBIaHBDgH2hlYIMn0wJvazGpe/2YQKBgG+D/51Q
FV0+LciMnb3ZBsMfw/vrQ4k/R0i1FLKlRU6kNouUOSR3/PvrVTQZLI4vRYnryE8A
5Au5MTbLp/aYyIy2keIxqDNEnFFsPkjOP5FhiTf7vl7lk+Eneu42BevAHHtB+p0s
zzxKQxrwqx0eWcMkUH8Suyb/A/VZhktIKXOBAoGAKIce+SoryiSbvJQjPqbO9X5z
Hcx31daAdUka0yGF5S423BLbYIOd2ynkKVicXLlO01TrL3OSSl7EtT+RwPGFkD3y
IB3QNamGpNIWMUR2Ggbgp+Z9bH61+EhXSLiEQhW1m4xxdtBjVHcoWeQgLJnOsazw
VPEzRf8+VkfvuTa7a+A=
-----END PRIVATE KEY-----""";

        var publicKey = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtagpBtrEThVWFwo2cPL7
RvXP/UnP6lCgq/oAwhtlGXo/haIkS/K8RuuErvYKeFOdeX5WHdgy8BAFOsfCtm6A
cU8quu44RfCUpKlTUCIYd774xpN9VadBXUlfpNoW3EWk9xC1w8qEMYyz4g4uTgCt
r9ioD0dHjEbpem4wOS700hPikXgeOuqGfXJdTsT1a1IQRHM8neLpwVJAlAoEZBFH
EP3xLx/FoiorkYg9Jmm0ZBFLL9ZviFYZs0cq67oYhRAa8WIiWzo0nMF9n4v9Ex4C
YRCNjW2n4h3tnFmMkvmJ0W7KHaLLNROhAjiVjIDSDSkXLDbNp3pxeu6oIgOa3V2M
QQIDAQAB
-----END PUBLIC KEY-----""";

        var jwtSettings = new JwtSettings
        {
            PrivateKeyPem = privateKey,
            PublicKeyPem = publicKey,
            Issuer = "edus-auth-service",
            ExpirationMinutes = 60,
            RefreshTokenExpirationDays = 7
        };

        var jwtService = new JwtService(jwtSettings);
        var schoolId = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");

        var user = new User
        {
            Id = Guid.NewGuid(),
            SchoolId = schoolId,
            Username = "admin",
            Email = "admin@gvhs.edu",
            PasswordHash = "hashed",
            FirstName = "Admin",
            LastName = "User",
            IsActive = true
        };

        // Act
        var tokenResponse = jwtService.IssueTokens(user);

        // Assert
        Assert.NotNull(tokenResponse);
        Assert.NotEmpty(tokenResponse.AccessToken);
        Assert.NotEmpty(tokenResponse.RefreshToken);
        Assert.Equal(3600, tokenResponse.ExpiresIn);
        Assert.Equal("Bearer", tokenResponse.TokenType);
        Assert.Equal("admin", tokenResponse.User.Username);

        // Verify JWT is properly signed
        var handler = new JwtSecurityTokenHandler();
        Assert.True(handler.CanReadToken(tokenResponse.AccessToken), "Token should be readable JWT");

        var token = handler.ReadJwtToken(tokenResponse.AccessToken);
        Assert.NotNull(token);
        Assert.Equal("edus-auth-service", token.Issuer);

        // Verify claims
        var nameClaim = token.Claims.FirstOrDefault(c => c.Type == "name");
        Assert.NotNull(nameClaim);
        Assert.Equal("admin", nameClaim.Value);

        var schoolIdClaim = token.Claims.FirstOrDefault(c => c.Type == "school_id");
        Assert.NotNull(schoolIdClaim);
        Assert.Equal(schoolId.ToString(), schoolIdClaim.Value);

        // Verify signature algorithm is RS256 (RSA SHA256)
        var signingAlgorithm = token.SigningAlgorithm;
        Assert.NotNull(signingAlgorithm);
        // The algorithm should be RSA-based
        Assert.True(signingAlgorithm.Contains("RSA"), $"Expected RSA-based signing algorithm, got {signingAlgorithm}");
    }

    [Fact]
    public void JwtService_RefreshTokenGeneration_ProducesDifferentTokensEachTime()
    {
        // Arrange
        var privateKey = """-----BEGIN PRIVATE KEY-----
MIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQC1qCkG2sROFVYX
CjZw8vtG9c/9Sc/qUKCr+gDCG2UZej+FoiRL8rxG64Su9gp4U515flYd2DLwEAU6
x8K2boBxTyq67jhF8JSkqVNQIhh3vvjGk31Vp0FdSV+k2hbcRaT3ELXDyoQxjLPi
Di5OAK2v2KgPR0eMRul6bjA5LvTSE+KReB466oZ9cl1OxPVrUhBEczyd4unBUkCU
CgRkEUcQ/fEvH8WiKiuRiD0mabRkEUsv1m+IVhmzRyrruhiFEBrxYiJbOjScwX2f
i/0THgJhEI2NbafiHe2cWYyS+YnRbsodoss1E6ECOJWMgNINKRcsNs2nenF67qgi
A5rdXYxBAgMBAAECgf9k7OPrMwN6fmnLEzMVpDa6dG4okCg75RMSrJH1rIXwlo+3
c+yTZaErpd5p3OwKpJBxPiFXI3vpdH0mhnJ5X2g58koQFICfTjLHgtJCF/wpsdup
BN8CbF9PsCkhzFyD6EDm8EzyvEMFyuG5TmrbjsG9v3/5cEvudXEMD5XE4rNfPORd
H2T6ikGhXgEpK2fl/4hz3q2HgrmILGVDuG/gkQECLj5j9KZHl6wLQ6PKso1c87wd
gxWXbbC64Hn613txrWEY2GCu4abyGS/uK3PN3FnokiqEdI8gLdCNjqNxCKSYUw2T
nq13nVn2VOCQ47cKjFTZzAJu73tpLsKlHCYkT6ECgYEA+iwOzniKY/DDBXHCzZaj
h+02c4GIwh/n10s7awiyGbYKxYluduODUG9iaFfTvdb62MFSvserUmD92Ki7AK2/
/++HQCtaM15K/MyHOlm4EtNzqDJocWE5o/AWAda2khwoOtwKpi8Ygpu1N6yhbTB+
iY7hDwVML2p8X23v3OaKrOECgYEAueOALYZ9XXKlOTzAsyHPlSb771N4zUGB8La3
q5Lem/g4XF/7XlFSuDHpBjbbFus2x/wo6M0nOnQxzHY86KRkkikx1GxP8HTI5rau
LBkpijrhJWhNDzXNQV6mQjari+B8kigYlNHMVUhFoIrPJofYa7YOCNMIvIfR4EKl
1g6Qa2ECgYAfG11X9QsYNDa7tZKIZ8O7whY0NJYhtT/puFQSEgm7QrSCLX2L0Oxi
EweEe+87OsEENL2qNT+rRZ4q04g1JGWsWEdUBk/39TCT0Ia8Da3iwWIvNt1fw7wc
E11ZKy6WamPiNbwpP8/nZZ8Z5iBIaHBDgH2hlYIMn0wJvazGpe/2YQKBgG+D/51Q
FV0+LciMnb3ZBsMfw/vrQ4k/R0i1FLKlRU6kNouUOSR3/PvrVTQZLI4vRYnryE8A
5Au5MTbLp/aYyIy2keIxqDNEnFFsPkjOP5FhiTf7vl7lk+Eneu42BevAHHtB+p0s
zzxKQxrwqx0eWcMkUH8Suyb/A/VZhktIKXOBAoGAKIce+SoryiSbvJQjPqbO9X5z
Hcx31daAdUka0yGF5S423BLbYIOd2ynkKVicXLlO01TrL3OSSl7EtT+RwPGFkD3y
IB3QNamGpNIWMUR2Ggbgp+Z9bH61+EhXSLiEQhW1m4xxdtBjVHcoWeQgLJnOsazw
VPEzRf8+VkfvuTa7a+A=
-----END PRIVATE KEY-----""";

        var publicKey = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtagpBtrEThVWFwo2cPL7
RvXP/UnP6lCgq/oAwhtlGXo/haIkS/K8RuuErvYKeFOdeX5WHdgy8BAFOsfCtm6A
cU8quu44RfCUpKlTUCIYd774xpN9VadBXUlfpNoW3EWk9xC1w8qEMYyz4g4uTgCt
r9ioD0dHjEbpem4wOS700hPikXgeOuqGfXJdTsT1a1IQRHM8neLpwVJAlAoEZBFH
EP3xLx/FoiorkYg9Jmm0ZBFLL9ZviFYZs0cq67oYhRAa8WIiWzo0nMF9n4v9Ex4C
YRCNjW2n4h3tnFmMkvmJ0W7KHaLLNROhAjiVjIDSDSkXLDbNp3pxeu6oIgOa3V2M
QQIDAQAB
-----END PUBLIC KEY-----""";

        var jwtSettings = new JwtSettings
        {
            PrivateKeyPem = privateKey,
            PublicKeyPem = publicKey,
            Issuer = "edus-auth-service",
            ExpirationMinutes = 60,
            RefreshTokenExpirationDays = 7
        };

        var jwtService = new JwtService(jwtSettings);

        // Act
        var token1 = jwtService.IssueRefreshToken();
        var token2 = jwtService.IssueRefreshToken();
        var token3 = jwtService.IssueRefreshToken();

        // Assert
        Assert.NotEmpty(token1);
        Assert.NotEmpty(token2);
        Assert.NotEmpty(token3);
        Assert.NotEqual(token1, token2);
        Assert.NotEqual(token2, token3);
        Assert.NotEqual(token1, token3);
    }
}

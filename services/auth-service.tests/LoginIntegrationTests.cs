using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;
using Services.Auth.Models;
using Services.Auth.Services;
using Xunit;
namespace Services.Auth.Tests;
public class LoginIntegrationTests {
 [Fact] public void IssuedTokenHasVerifiedSignatureAndSchoolScope() {
 using var rsa=RSA.Create(2048);
 var service=new JwtService(new JwtSettings {PrivateKeyPem=rsa.ExportPkcs8PrivateKeyPem(),PublicKeyPem=rsa.ExportSubjectPublicKeyInfoPem(),Issuer="edus-auth-service",Audience="edus-api",ExpirationMinutes=60,RefreshTokenExpirationDays=7});
 var user=new User {Id=Guid.NewGuid(),SchoolId=Guid.NewGuid(),Username="admin",Email="admin@example.test",PasswordHash="unused",Role=new Role{Id=Guid.NewGuid(),Name="SuperAdmin"}};
 var result=service.IssueTokens(user);
 var principal=new JwtSecurityTokenHandler().ValidateToken(result.AccessToken,new TokenValidationParameters {ValidateIssuerSigningKey=true,IssuerSigningKey=new RsaSecurityKey(rsa),ValidateIssuer=true,ValidIssuer="edus-auth-service",ValidateAudience=true,ValidAudience="edus-api",ValidateLifetime=true},out var token);
 Assert.Equal(user.SchoolId.ToString(),principal.FindFirst("school_id")?.Value);
 Assert.True(principal.IsInRole("SuperAdmin"));
 Assert.Equal(SecurityAlgorithms.RsaSha256,((JwtSecurityToken)token).Header.Alg);
 Assert.NotEqual(result.RefreshToken,service.IssueRefreshToken());
 }
}

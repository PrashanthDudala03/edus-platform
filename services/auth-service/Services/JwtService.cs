using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;
using Services.Auth.Models;

namespace Services.Auth.Services;

public class JwtSettings
{
    public required string PrivateKeyPem { get; set; }
    public required string PublicKeyPem { get; set; }
    public string Issuer { get; set; } = "edus-auth-service";
    public string Audience { get; set; } = "edus-api";
    public int ExpirationMinutes { get; set; } = 60;
    public int RefreshTokenExpirationDays { get; set; } = 7;
}

public interface IJwtService
{
    JwtTokenResponse IssueTokens(User user);
    ClaimsPrincipal? ValidateToken(string token);
    string IssueRefreshToken();
}

public class JwtService : IJwtService
{
    private readonly JwtSettings _settings;
    private readonly RSA _privateKey;
    private readonly RSA _publicKey;

    public JwtService(JwtSettings settings)
    {
        _settings = settings;
        _privateKey = RSA.Create();
        _publicKey = RSA.Create();
        _privateKey.ImportFromPem(_settings.PrivateKeyPem.AsSpan());
        _publicKey.ImportFromPem(_settings.PublicKeyPem.AsSpan());
    }

    public JwtTokenResponse IssueTokens(User user)
    {
        var now = DateTime.UtcNow;
        var expires = now.AddMinutes(_settings.ExpirationMinutes);

        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim("school_id", user.SchoolId.ToString()),
            new Claim("token_version", user.TokenVersion.ToString()),
            new Claim("data_scope", user.DataScope),
            new Claim("role_id", user.RoleId?.ToString() ?? ""),
            new Claim("first_name", user.FirstName ?? string.Empty),
            new Claim("last_name", user.LastName ?? string.Empty),
        };

        if (user.Role is not null)
        {
            claims.Add(new Claim(ClaimTypes.Role, user.Role.Name));
            foreach (var permission in user.EffectivePermissions)
            {
                claims.Add(new Claim("permission", permission));
            }
        }

        var signingCredentials = new SigningCredentials(
            new RsaSecurityKey(_privateKey),
            SecurityAlgorithms.RsaSha256);

        var token = new JwtSecurityToken(
            issuer: _settings.Issuer,
            audience: _settings.Audience,
            claims: claims,
            notBefore: now,
            expires: expires,
            signingCredentials: signingCredentials);

        var accessToken = new JwtSecurityTokenHandler().WriteToken(token);
        var refreshToken = IssueRefreshToken();

        return new JwtTokenResponse
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken,
            ExpiresIn = (int)TimeSpan.FromMinutes(_settings.ExpirationMinutes).TotalSeconds,
            TokenType = "Bearer",
            User = user.ToDto()
        };
    }

    public ClaimsPrincipal? ValidateToken(string token)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            var validationParameters = new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new RsaSecurityKey(_publicKey),
                ValidateIssuer = true,
                ValidIssuer = _settings.Issuer,
                ValidateAudience = true,
                ValidAudience = _settings.Audience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            };

            var principal = handler.ValidateToken(token, validationParameters, out var validatedToken);
            return principal;
        }
        catch
        {
            return null;
        }
    }

    public string IssueRefreshToken()
    {
        var randomBytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(randomBytes);
        }
        return Convert.ToBase64String(randomBytes);
    }
}

public class JwtTokenResponse
{
    public required string AccessToken { get; set; }
    public required string RefreshToken { get; set; }
    public int ExpiresIn { get; set; }
    public string TokenType { get; set; } = "Bearer";
    public required UserDto User { get; set; }
}

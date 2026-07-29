using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using EduOS.Shared;

var builder = WebApplicationBuilder.CreateBuilder(args);

// JWT Configuration
var jwtSettings = new JwtSettings
{
    SecretKey = builder.Configuration["Jwt:SecretKey"] ?? "your-super-secret-key-minimum-32-characters-long!!",
    Issuer = builder.Configuration["Jwt:Issuer"] ?? "https://eduos-auth-service",
    Audience = builder.Configuration["Jwt:Audience"] ?? "eduos-clients",
    AccessTokenExpirationMinutes = int.Parse(builder.Configuration["Jwt:AccessTokenExpirationMinutes"] ?? "15"),
    RefreshTokenExpirationDays = int.Parse(builder.Configuration["Jwt:RefreshTokenExpirationDays"] ?? "7")
};

builder.Services.AddSingleton(jwtSettings);
builder.Services.AddSingleton<IUserService, InMemoryUserService>();
builder.Services.AddSingleton<ITokenService, JwtTokenService>();
builder.Services.AddLogging();
builder.Services.AddHealthChecks();

// Add authentication
var key = Encoding.ASCII.GetBytes(jwtSettings.SecretKey);
builder.Services.AddAuthentication("Bearer")
    .AddJwtBearer("Bearer", options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(key),
            ValidateIssuer = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtSettings.Audience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

// Health check
app.MapGet("/health", () =>
{
    return Results.Ok(new HealthCheckResponse
    {
        Status = "Healthy",
        Details = new Dictionary<string, object>
        {
            { "service", "Auth Service" },
            { "version", "1.0.0" },
            { "database", "In-Memory" }
        }
    });
}).WithName("AuthHealth").WithOpenApi();

// Login endpoint
app.MapPost("/login", async (LoginRequest request, IUserService userService, ITokenService tokenService, ILogger<Program> logger) =>
{
    logger.LogInformation("Login attempt for user: {Email}", request.Email);

    if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.BadRequest(ApiResponse<LoginResponse>.Error("Email and password are required"));
    }

    var user = await userService.AuthenticateAsync(request.Email, request.Password);
    if (user == null)
    {
        logger.LogWarning("Authentication failed for user: {Email}", request.Email);
        return Results.Unauthorized();
    }

    var accessToken = tokenService.GenerateAccessToken(user);
    var refreshToken = tokenService.GenerateRefreshToken();

    await userService.StoreRefreshTokenAsync(user.Id, refreshToken);

    var response = new LoginResponse
    {
        UserId = user.Id,
        Email = user.Email,
        AccessToken = accessToken,
        RefreshToken = refreshToken,
        ExpiresIn = DateTime.UtcNow.AddMinutes(jwtSettings.AccessTokenExpirationMinutes)
    };

    logger.LogInformation("Successful login for user: {Email}", request.Email);
    return Results.Ok(ApiResponse<LoginResponse>.Ok(response, "Login successful"));
})
.WithName("Login")
.WithOpenApi();

// Refresh token endpoint
app.MapPost("/refresh", async (RefreshTokenRequest request, IUserService userService, ITokenService tokenService, ILogger<Program> logger) =>
{
    logger.LogInformation("Token refresh requested");

    if (string.IsNullOrWhiteSpace(request.RefreshToken))
    {
        return Results.BadRequest(ApiResponse<LoginResponse>.Error("Refresh token is required"));
    }

    var user = await userService.ValidateRefreshTokenAsync(request.RefreshToken);
    if (user == null)
    {
        logger.LogWarning("Invalid refresh token provided");
        return Results.Unauthorized();
    }

    var accessToken = tokenService.GenerateAccessToken(user);
    var newRefreshToken = tokenService.GenerateRefreshToken();

    await userService.StoreRefreshTokenAsync(user.Id, newRefreshToken);

    var response = new LoginResponse
    {
        UserId = user.Id,
        Email = user.Email,
        AccessToken = accessToken,
        RefreshToken = newRefreshToken,
        ExpiresIn = DateTime.UtcNow.AddMinutes(jwtSettings.AccessTokenExpirationMinutes)
    };

    logger.LogInformation("Token refreshed for user: {UserId}", user.Id);
    return Results.Ok(ApiResponse<LoginResponse>.Ok(response, "Token refreshed successfully"));
})
.WithName("RefreshToken")
.WithOpenApi();

// Logout endpoint
app.MapPost("/logout", async (LogoutRequest request, IUserService userService, ILogger<Program> logger) =>
{
    logger.LogInformation("Logout requested for user: {UserId}", request.UserId);

    if (string.IsNullOrWhiteSpace(request.UserId))
    {
        return Results.BadRequest(ApiResponse.Error("UserId is required"));
    }

    await userService.InvalidateTokenAsync(request.UserId);

    logger.LogInformation("User logged out: {UserId}", request.UserId);
    return Results.Ok(ApiResponse.Ok("Logged out successfully"));
})
.WithName("Logout")
.WithOpenApi();

// Validate token endpoint
app.MapGet("/validate", () =>
{
    return Results.Ok(new { valid = true, message = "Token is valid" });
})
.RequireAuthorization()
.WithName("ValidateToken")
.WithOpenApi();

app.Run();

// ============== Services ==============

public class JwtSettings
{
    public string SecretKey { get; set; } = string.Empty;
    public string Issuer { get; set; } = string.Empty;
    public string Audience { get; set; } = string.Empty;
    public int AccessTokenExpirationMinutes { get; set; } = 15;
    public int RefreshTokenExpirationDays { get; set; } = 7;
}

public interface ITokenService
{
    string GenerateAccessToken(User user);
    string GenerateRefreshToken();
    ClaimsPrincipal? ValidateToken(string token);
}

public class JwtTokenService : ITokenService
{
    private readonly JwtSettings _jwtSettings;
    private readonly ILogger<JwtTokenService> _logger;

    public JwtTokenService(JwtSettings jwtSettings, ILogger<JwtTokenService> logger)
    {
        _jwtSettings = jwtSettings;
        _logger = logger;
    }

    public string GenerateAccessToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.ASCII.GetBytes(_jwtSettings.SecretKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: _jwtSettings.Issuer,
            audience: _jwtSettings.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_jwtSettings.AccessTokenExpirationMinutes),
            signingCredentials: credentials
        );

        var tokenHandler = new JwtSecurityTokenHandler();
        return tokenHandler.WriteToken(token);
    }

    public string GenerateRefreshToken()
    {
        var randomNumber = new byte[32];
        using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
        {
            rng.GetBytes(randomNumber);
            return Convert.ToBase64String(randomNumber);
        }
    }

    public ClaimsPrincipal? ValidateToken(string token)
    {
        try
        {
            var key = new SymmetricSecurityKey(Encoding.ASCII.GetBytes(_jwtSettings.SecretKey));
            var tokenHandler = new JwtSecurityTokenHandler();

            var principal = tokenHandler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ValidateIssuer = true,
                ValidIssuer = _jwtSettings.Issuer,
                ValidateAudience = true,
                ValidAudience = _jwtSettings.Audience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            }, out SecurityToken validatedToken);

            return principal;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Token validation failed: {Exception}", ex.Message);
            return null;
        }
    }
}

public interface IUserService
{
    Task<User?> AuthenticateAsync(string email, string password);
    Task<User?> ValidateRefreshTokenAsync(string refreshToken);
    Task StoreRefreshTokenAsync(string userId, string refreshToken);
    Task InvalidateTokenAsync(string userId);
}

public class InMemoryUserService : IUserService
{
    private readonly ConcurrentDictionary<string, User> _users;
    private readonly ConcurrentDictionary<string, RefreshTokenData> _refreshTokens;
    private readonly ILogger<InMemoryUserService> _logger;

    public InMemoryUserService(ILogger<InMemoryUserService> logger)
    {
        _logger = logger;
        _users = new ConcurrentDictionary<string, User>();
        _refreshTokens = new ConcurrentDictionary<string, RefreshTokenData>();

        // Seed with test users
        var testUser1 = new User
        {
            Id = Guid.NewGuid().ToString(),
            Email = "admin@eduos.com",
            Password = "admin123", // In production, use hashed passwords
            Role = "Admin"
        };

        var testUser2 = new User
        {
            Id = Guid.NewGuid().ToString(),
            Email = "teacher@eduos.com",
            Password = "teacher123",
            Role = "Teacher"
        };

        var testUser3 = new User
        {
            Id = Guid.NewGuid().ToString(),
            Email = "parent@eduos.com",
            Password = "parent123",
            Role = "Parent"
        };

        _users.TryAdd(testUser1.Id, testUser1);
        _users.TryAdd(testUser2.Id, testUser2);
        _users.TryAdd(testUser3.Id, testUser3);

        _logger.LogInformation("InMemoryUserService initialized with {UserCount} test users", _users.Count);
    }

    public Task<User?> AuthenticateAsync(string email, string password)
    {
        var user = _users.Values.FirstOrDefault(u => u.Email == email && u.Password == password);
        return Task.FromResult(user);
    }

    public Task<User?> ValidateRefreshTokenAsync(string refreshToken)
    {
        if (_refreshTokens.TryGetValue(refreshToken, out var tokenData))
        {
            if (tokenData.ExpiresAt > DateTime.UtcNow)
            {
                if (_users.TryGetValue(tokenData.UserId, out var user))
                {
                    return Task.FromResult<User?>(user);
                }
            }
            else
            {
                _refreshTokens.TryRemove(refreshToken, out _);
            }
        }

        return Task.FromResult<User?>(null);
    }

    public Task StoreRefreshTokenAsync(string userId, string refreshToken)
    {
        var tokenData = new RefreshTokenData
        {
            UserId = userId,
            Token = refreshToken,
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(7)
        };

        _refreshTokens.AddOrUpdate(refreshToken, tokenData, (_, _) => tokenData);
        return Task.CompletedTask;
    }

    public Task InvalidateTokenAsync(string userId)
    {
        var tokensToRemove = _refreshTokens
            .Where(kvp => kvp.Value.UserId == userId)
            .Select(kvp => kvp.Key)
            .ToList();

        foreach (var token in tokensToRemove)
        {
            _refreshTokens.TryRemove(token, out _);
        }

        _logger.LogInformation("Invalidated {TokenCount} tokens for user: {UserId}", tokensToRemove.Count, userId);
        return Task.CompletedTask;
    }

    private class RefreshTokenData
    {
        public string UserId { get; set; } = string.Empty;
        public string Token { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public DateTime ExpiresAt { get; set; }
    }
}

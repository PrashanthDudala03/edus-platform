using FluentValidation;
using MediatR;
using Serilog;
using Services.Auth.Data;
using Services.Auth.Models;
using Services.Auth.Services;

namespace Services.Auth.Handlers;

public class LoginCommand : IRequest<JwtTokenResponse>
{
    public string Username { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
    public string SchoolId { get; init; } = string.Empty;

    public LoginCommand(string username, string password, string schoolId)
    {
        Username = username;
        Password = password;
        SchoolId = schoolId;
    }
}

public class LoginCommandHandler : IRequestHandler<LoginCommand, JwtTokenResponse>
{
    private readonly IUserRepository _userRepository;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly IPasswordService _passwordService;
    private readonly IJwtService _jwtService;
    private readonly IValidator<LoginCommand> _validator;

    public LoginCommandHandler(
        IUserRepository userRepository,
        IRefreshTokenRepository refreshTokenRepository,
        IPasswordService passwordService,
        IJwtService jwtService,
        IValidator<LoginCommand> validator)
    {
        _userRepository = userRepository;
        _refreshTokenRepository = refreshTokenRepository;
        _passwordService = passwordService;
        _jwtService = jwtService;
        _validator = validator;
    }

    public async Task<JwtTokenResponse> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        // Validate
        var validationResult = await _validator.ValidateAsync(request, cancellationToken);
        if (!validationResult.IsValid)
        {
            throw new ValidationException(validationResult.Errors);
        }

        var schoolId = Guid.Parse(request.SchoolId);

        // Find user
        var user = await _userRepository.GetByUsernameAsync(schoolId, request.Username);
        if (user == null)
        {
            Log.Warning("Login failed: user {Username} not found in school {SchoolId}", request.Username, schoolId);
            throw new InvalidOperationException("Invalid credentials");
        }

        // Verify password
        if (!_passwordService.VerifyPassword(request.Password, user.PasswordHash))
        {
            Log.Warning("Login failed: invalid password for user {Username}", request.Username);
            throw new InvalidOperationException("Invalid credentials");
        }

        // Issue JWT and refresh token
        var tokenResponse = _jwtService.IssueTokens(user);

        // Store refresh token
        var refreshToken = new RefreshToken
        {
            Id = Guid.NewGuid(),
            SchoolId = schoolId,
            UserId = user.Id,
            Token = tokenResponse.RefreshToken,
            ExpiresAt = DateTime.UtcNow.AddDays(7),
            CreatedAt = DateTime.UtcNow
        };

        await _refreshTokenRepository.CreateAsync(refreshToken);

        // Update last login
        user.LastLoginAt = DateTime.UtcNow;
        await _userRepository.UpdateAsync(user);

        Log.Information("User {Username} logged in successfully", request.Username);
        return tokenResponse;
    }
}

public class RefreshTokenCommand : IRequest<JwtTokenResponse>
{
    public string RefreshToken { get; init; } = string.Empty;

    public RefreshTokenCommand(string refreshToken)
    {
        RefreshToken = refreshToken;
    }
}

public class RefreshTokenCommandHandler : IRequestHandler<RefreshTokenCommand, JwtTokenResponse>
{
    private readonly IUserRepository _userRepository;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly IJwtService _jwtService;

    public RefreshTokenCommandHandler(
        IUserRepository userRepository,
        IRefreshTokenRepository refreshTokenRepository,
        IJwtService jwtService)
    {
        _userRepository = userRepository;
        _refreshTokenRepository = refreshTokenRepository;
        _jwtService = jwtService;
    }

    public async Task<JwtTokenResponse> Handle(RefreshTokenCommand request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            throw new InvalidOperationException("Invalid or expired refresh token");
        }

        var storedToken = await _refreshTokenRepository.GetByTokenAsync(request.RefreshToken);
        if (storedToken is null)
        {
            throw new InvalidOperationException("Invalid or expired refresh token");
        }

        var user = await _userRepository.GetByIdAsync(storedToken.UserId);
        if (user is null || user.SchoolId != storedToken.SchoolId)
        {
            await _refreshTokenRepository.RevokeAsync(storedToken.Id);
            throw new InvalidOperationException("Invalid or expired refresh token");
        }

        await _refreshTokenRepository.RevokeAsync(storedToken.Id);
        var rotatedTokens = _jwtService.IssueTokens(user);
        await _refreshTokenRepository.CreateAsync(new RefreshToken
        {
            Id = Guid.NewGuid(),
            SchoolId = user.SchoolId,
            UserId = user.Id,
            Token = rotatedTokens.RefreshToken,
            ExpiresAt = DateTime.UtcNow.AddDays(7),
            CreatedAt = DateTime.UtcNow
        });
        return rotatedTokens;
    }
}

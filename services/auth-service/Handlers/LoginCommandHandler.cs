using FluentValidation;
using MediatR;
using Serilog;
using Services.Auth.Data;
using Services.Auth.Models;
using Services.Auth.Services;

namespace Services.Auth.Handlers;

/// <summary>A sign-in refused for a reason the user may be told, with the HTTP status to answer.</summary>
public class LoginRejectedException(int status, string message, IReadOnlyList<SchoolChoice>? schools = null) : InvalidOperationException(message)
{
    public int Status { get; } = status;
    /// <summary>The schools to choose from, when the same sign-in name and password belong to several.</summary>
    public IReadOnlyList<SchoolChoice>? Schools { get; } = schools;
    /// <summary>What the client is told. Schools appear only when there is a choice to make.</summary>
    public object Body => Schools is null
        ? new { statusCode = Status, message = Message }
        : new { statusCode = Status, message = Message, schools = Schools.Select(school => new { id = school.Id, name = school.Name }) };
}

/// <summary>A school offered at sign-in. Built only from accounts whose password was just proved.</summary>
public sealed record SchoolChoice(Guid Id, string Name);

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
    private static string? _decoy;

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

        Guid? requestedSchool = string.IsNullOrWhiteSpace(request.SchoolId) ? null : Guid.Parse(request.SchoolId);

        // The role and school always come from the matched account, never from the request.
        var candidates = await _userRepository.FindLoginCandidatesAsync(requestedSchool, request.Username.Trim());
        var matches = candidates.Where(candidate => _passwordService.VerifyPassword(request.Password, candidate.PasswordHash)).ToList();
        // A sign-in name nobody has still costs one password check, so the answer and its timing do not show
        // whether the name (or the name in a chosen school) exists.
        if (candidates.Count == 0) _passwordService.VerifyPassword(request.Password, _decoy ??= _passwordService.HashPassword(Guid.NewGuid().ToString("N")));
        if (matches.Count == 0)
        {
            Log.Warning("Login failed for {Username}", request.Username);
            throw new InvalidOperationException("Invalid credentials");
        }
        // Account state is revealed only to someone who already proved the password.
        var user = matches[0];
        if (matches.Count > 1)
        {
            // The same sign-in name and password in several schools. The person chooses, and is offered only the
            // schools these proven accounts can enter; a wrong password never reaches this point.
            var usable = new List<User>();
            foreach (var match in matches)
                if (match.CanSignIn && await _userRepository.IsSchoolActiveAsync(match.SchoolId)) usable.Add(match);
            var schools = usable.Select(match => match.SchoolId).Distinct().ToArray();
            if (schools.Length != usable.Count)
                throw new LoginRejectedException(409, "More than one account in your school uses this sign-in name. Contact your school administrator.");
            if (usable.Count > 1)
            {
                var names = await _userRepository.GetSchoolNamesAsync(schools);
                throw new LoginRejectedException(409, "This sign-in name is used in more than one school. Choose your school to continue.",
                    schools.Select(id => new SchoolChoice(id, names.GetValueOrDefault(id, "School"))).OrderBy(school => school.Name, StringComparer.OrdinalIgnoreCase).ToList());
            }
            if (usable.Count == 1) user = usable[0];
        }
        if (!user.CanSignIn)
            throw new LoginRejectedException(403, "Your account is currently disabled. Contact your school administrator.");
        if (!await _userRepository.IsSchoolActiveAsync(user.SchoolId))
            throw new LoginRejectedException(403, "This school's EduOS workspace is deactivated. Contact EduOS support.");
        var schoolId = user.SchoolId;

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
        if (user is null || user.SchoolId != storedToken.SchoolId || !await _userRepository.IsSchoolActiveAsync(user.SchoolId))
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

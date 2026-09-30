using FluentValidation;
using Moq;
using Services.Auth.Data;
using Services.Auth.Handlers;
using Services.Auth.Models;
using Services.Auth.Services;
using Services.Auth.Validation;
using Xunit;

namespace Services.Auth.Tests;

public class LoginCommandHandlerTests
{
    private readonly Mock<IUserRepository> _mockUserRepository;
    private readonly Mock<IRefreshTokenRepository> _mockRefreshTokenRepository;
    private readonly Mock<IPasswordService> _mockPasswordService;
    private readonly Mock<IJwtService> _mockJwtService;
    private readonly IValidator<LoginCommand> _validator;
    private readonly LoginCommandHandler _handler;

    public LoginCommandHandlerTests()
    {
        _mockUserRepository = new Mock<IUserRepository>();
        _mockRefreshTokenRepository = new Mock<IRefreshTokenRepository>();
        _mockPasswordService = new Mock<IPasswordService>();
        _mockJwtService = new Mock<IJwtService>();
        _validator = new LoginCommandValidator();

        _handler = new LoginCommandHandler(
            _mockUserRepository.Object,
            _mockRefreshTokenRepository.Object,
            _mockPasswordService.Object,
            _mockJwtService.Object,
            _validator);
    }

    [Fact]
    public async Task Handle_WithValidCredentials_ReturnsJwtTokenResponse()
    {
        // Arrange
        var schoolId = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");
        var userId = Guid.NewGuid();
        var command = new LoginCommand("testuser", "password123", schoolId.ToString());

        var user = new User
        {
            Id = userId,
            SchoolId = schoolId,
            Username = "testuser",
            Email = "test@example.com",
            PasswordHash = "hashed_password",
            FirstName = "Test",
            LastName = "User",
            IsActive = true
        };

        var tokenResponse = new JwtTokenResponse
        {
            AccessToken = "jwt_token_value",
            RefreshToken = "refresh_token_value",
            ExpiresIn = 3600,
            TokenType = "Bearer",
            User = user.ToDto()
        };

        _mockUserRepository
            .Setup(r => r.FindLoginCandidatesAsync(schoolId, "testuser"))
            .ReturnsAsync([user]);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(schoolId)).ReturnsAsync(true);

        _mockPasswordService
            .Setup(s => s.VerifyPassword("password123", "hashed_password"))
            .Returns(true);

        _mockJwtService
            .Setup(s => s.IssueTokens(user))
            .Returns(tokenResponse);

        _mockRefreshTokenRepository
            .Setup(r => r.CreateAsync(It.IsAny<RefreshToken>()))
            .Returns(Task.CompletedTask);

        _mockUserRepository
            .Setup(r => r.UpdateAsync(It.IsAny<User>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await _handler.Handle(command, CancellationToken.None);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("jwt_token_value", result.AccessToken);
        Assert.Equal("refresh_token_value", result.RefreshToken);
        Assert.Equal(3600, result.ExpiresIn);
        Assert.Equal("testuser", result.User.Username);

        _mockUserRepository.Verify(r => r.UpdateAsync(It.IsAny<User>()), Times.Once);
        _mockRefreshTokenRepository.Verify(r => r.CreateAsync(It.IsAny<RefreshToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_WithInvalidPassword_ThrowsException()
    {
        // Arrange
        var schoolId = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");
        var command = new LoginCommand("testuser", "wrongpassword", schoolId.ToString());

        var user = new User
        {
            Id = Guid.NewGuid(),
            SchoolId = schoolId,
            Username = "testuser",
            Email = "test@example.com",
            PasswordHash = "hashed_password",
            IsActive = true
        };

        _mockUserRepository
            .Setup(r => r.FindLoginCandidatesAsync(schoolId, "testuser"))
            .ReturnsAsync([user]);

        _mockPasswordService
            .Setup(s => s.VerifyPassword("wrongpassword", "hashed_password"))
            .Returns(false);

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_WithNonexistentUser_ThrowsException()
    {
        // Arrange
        var schoolId = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");
        var command = new LoginCommand("nonexistent", "password123", schoolId.ToString());

        _mockUserRepository
            .Setup(r => r.FindLoginCandidatesAsync(schoolId, "nonexistent"))
            .ReturnsAsync([]);

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_WithInvalidUsername_ThrowsValidationException()
    {
        // Arrange
        var schoolId = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");
        var command = new LoginCommand("ab", "password123", schoolId.ToString()); // Username too short

        // Act & Assert
        await Assert.ThrowsAsync<ValidationException>(
            () => _handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_WithInvalidSchoolId_ThrowsValidationException()
    {
        // Arrange
        var command = new LoginCommand("testuser", "password123", "invalid-guid");

        // Act & Assert
        await Assert.ThrowsAsync<ValidationException>(
            () => _handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_WithEmptyPassword_ThrowsValidationException()
    {
        // Arrange
        var schoolId = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");
        var command = new LoginCommand("testuser", "", schoolId.ToString());

        // Act & Assert
        await Assert.ThrowsAsync<ValidationException>(
            () => _handler.Handle(command, CancellationToken.None));
    }

    private static User Account(Guid school, bool active = true, string hash = "hashed_password") => new()
    {
        Id = Guid.NewGuid(), SchoolId = school, Username = "person@example.test", Email = "person@example.test",
        PasswordHash = hash, IsActive = active, Role = new Role { Id = Guid.NewGuid(), SchoolId = school, Name = "Teacher" }
    };

    [Fact]
    public async Task Handle_WithoutSchoolId_SignsInTheSingleMatchingAccountInItsOwnSchool()
    {
        var school = Guid.NewGuid();
        var user = Account(school);
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([user]);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(school)).ReturnsAsync(true);
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);
        _mockJwtService.Setup(s => s.IssueTokens(user)).Returns(new JwtTokenResponse { AccessToken = "a", RefreshToken = "r", User = user.ToDto() });

        var result = await _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None);

        Assert.Equal(school.ToString(), result.User.SchoolId);
        _mockRefreshTokenRepository.Verify(r => r.CreateAsync(It.Is<RefreshToken>(t => t.SchoolId == school && t.UserId == user.Id)), Times.Once);
    }

    [Fact]
    public async Task Handle_SameCredentialsInTwoSchools_AsksForSchoolIdInsteadOfGuessing()
    {
        var first = Account(Guid.NewGuid());
        var second = Account(Guid.NewGuid());
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([first, second]);
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);

        var error = await Assert.ThrowsAsync<LoginRejectedException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None));
        Assert.Equal(409, error.Status);
        _mockJwtService.Verify(s => s.IssueTokens(It.IsAny<User>()), Times.Never);
    }

    [Fact]
    public async Task Handle_DisabledAccountWithCorrectPassword_ExplainsWithoutIssuingTokens()
    {
        var user = Account(Guid.NewGuid(), active: false);
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([user]);
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);

        var error = await Assert.ThrowsAsync<LoginRejectedException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None));
        Assert.Equal(403, error.Status);
        Assert.Contains("disabled", error.Message);
        _mockJwtService.Verify(s => s.IssueTokens(It.IsAny<User>()), Times.Never);
    }

    [Fact]
    public async Task Handle_DisabledAccountWithWrongPassword_RevealsNothing()
    {
        var user = Account(Guid.NewGuid(), active: false);
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([user]);
        _mockPasswordService.Setup(s => s.VerifyPassword("wrong-password", "hashed_password")).Returns(false);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => _handler.Handle(new LoginCommand("person@example.test", "wrong-password", ""), CancellationToken.None));
        Assert.IsNotType<LoginRejectedException>(error);
        Assert.Equal("Invalid credentials", error.Message);
    }

    [Fact]
    public async Task Handle_DeactivatedSchool_RefusesSignIn()
    {
        var school = Guid.NewGuid();
        var user = Account(school);
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([user]);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(school)).ReturnsAsync(false);
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);

        var error = await Assert.ThrowsAsync<LoginRejectedException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None));
        Assert.Equal(403, error.Status);
        Assert.Contains("deactivated", error.Message);
        _mockJwtService.Verify(s => s.IssueTokens(It.IsAny<User>()), Times.Never);
    }
}

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
            .Setup(r => r.GetByUsernameAsync(schoolId, "testuser"))
            .ReturnsAsync(user);

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
            .Setup(r => r.GetByUsernameAsync(schoolId, "testuser"))
            .ReturnsAsync(user);

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
            .Setup(r => r.GetByUsernameAsync(schoolId, "nonexistent"))
            .ReturnsAsync((User?)null);

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
}

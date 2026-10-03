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

    private (User First, User Second) TwoSchools(bool secondActive = true, bool secondSchoolActive = true)
    {
        var first = Account(Guid.NewGuid());
        var second = Account(Guid.NewGuid(), secondActive);
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([first, second]);
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(first.SchoolId, "person@example.test")).ReturnsAsync([first]);
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(second.SchoolId, "person@example.test")).ReturnsAsync([second]);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(first.SchoolId)).ReturnsAsync(true);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(second.SchoolId)).ReturnsAsync(secondSchoolActive);
        _mockUserRepository.Setup(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>()))
            .ReturnsAsync((IReadOnlyCollection<Guid> ids) => ids.ToDictionary(id => id, id => id == first.SchoolId ? "Riverside School" : "Hillview Academy"));
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);
        _mockJwtService.Setup(s => s.IssueTokens(It.IsAny<User>())).Returns((User u) => new JwtTokenResponse { AccessToken = "token", RefreshToken = "refresh", User = u.ToDto() });
        return (first, second);
    }

    [Fact]
    public async Task Handle_SameCredentialsInTwoSchools_OffersThoseSchoolsByNameInsteadOfGuessing()
    {
        var (first, second) = TwoSchools();

        var error = await Assert.ThrowsAsync<LoginRejectedException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None));
        Assert.Equal(409, error.Status);
        Assert.Equal([new SchoolChoice(second.SchoolId, "Hillview Academy"), new SchoolChoice(first.SchoolId, "Riverside School")], error.Schools);
        // Only the two proven schools were looked up, and the answer carries an id and a name and nothing else.
        _mockUserRepository.Verify(r => r.GetSchoolNamesAsync(It.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 2 && ids.Contains(first.SchoolId) && ids.Contains(second.SchoolId))), Times.Once);
        var body = System.Text.Json.JsonSerializer.SerializeToNode(error.Body)!.AsObject();
        Assert.Equal(["statusCode", "message", "schools"], body.Select(p => p.Key));
        Assert.All(body["schools"]!.AsArray(), school => Assert.Equal(["id", "name"], school!.AsObject().Select(p => p.Key)));
        Assert.DoesNotContain("School ID", error.Message);
        _mockJwtService.Verify(s => s.IssueTokens(It.IsAny<User>()), Times.Never);
        _mockRefreshTokenRepository.Verify(r => r.CreateAsync(It.IsAny<RefreshToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_ChosenSchool_SignsInToThatSchoolOnly()
    {
        var (_, second) = TwoSchools();

        var result = await _handler.Handle(new LoginCommand("person@example.test", "password123", second.SchoolId.ToString()), CancellationToken.None);

        Assert.Equal(second.SchoolId.ToString(), result.User.SchoolId);
        _mockRefreshTokenRepository.Verify(r => r.CreateAsync(It.Is<RefreshToken>(t => t.SchoolId == second.SchoolId && t.UserId == second.Id)), Times.Once);
        _mockUserRepository.Verify(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>()), Times.Never);
    }

    [Fact]
    public async Task Handle_WrongPasswordForASharedSignInName_RevealsNoSchools()
    {
        TwoSchools();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => _handler.Handle(new LoginCommand("person@example.test", "wrong-password", ""), CancellationToken.None));

        Assert.IsNotType<LoginRejectedException>(error);
        Assert.Equal("Invalid credentials", error.Message);
        _mockUserRepository.Verify(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>()), Times.Never);
        _mockUserRepository.Verify(r => r.IsSchoolActiveAsync(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Handle_SchoolThatDoesNotHoldTheseCredentials_LooksLikeAWrongPassword()
    {
        TwoSchools();
        var other = Guid.NewGuid();
        // Another school: either the name does not exist there, or it does with a different password.
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(other, "person@example.test")).ReturnsAsync([Account(other, hash: "another_hash")]);

        var stranger = await Assert.ThrowsAsync<InvalidOperationException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", other.ToString()), CancellationToken.None));
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(other, "person@example.test")).ReturnsAsync([]);
        var absent = await Assert.ThrowsAsync<InvalidOperationException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", other.ToString()), CancellationToken.None));

        foreach (var error in new[] { stranger, absent })
        {
            Assert.IsNotType<LoginRejectedException>(error);
            Assert.Equal("Invalid credentials", error.Message);
        }
        _mockUserRepository.Verify(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>()), Times.Never);
        _mockJwtService.Verify(s => s.IssueTokens(It.IsAny<User>()), Times.Never);
    }

    [Theory]
    [InlineData("not-a-school")][InlineData("1234")][InlineData("aeea48a8-f51f-4676-ada6")][InlineData("' OR 1=1 --")]
    public async Task Handle_MalformedSchoolSelection_IsRefusedBeforeAnyLookup(string schoolId)
    {
        await Assert.ThrowsAsync<ValidationException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", schoolId), CancellationToken.None));
        _mockUserRepository.Verify(r => r.FindLoginCandidatesAsync(It.IsAny<Guid?>(), It.IsAny<string>()), Times.Never);
    }

    [Theory]
    [InlineData(false, true)][InlineData(true, false)]
    public async Task Handle_OnlyOneOfTheSchoolsCanBeEntered_SignsInThereAndNeverNamesTheOther(bool secondActive, bool secondSchoolActive)
    {
        var (first, second) = TwoSchools(secondActive, secondSchoolActive);

        var result = await _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None);

        Assert.Equal(first.SchoolId.ToString(), result.User.SchoolId);
        _mockJwtService.Verify(s => s.IssueTokens(It.Is<User>(u => u.Id == second.Id)), Times.Never);
        _mockUserRepository.Verify(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>()), Times.Never);
    }

    [Fact]
    public async Task Handle_ThreeSchoolsWithOneAccountDisabledAndOneSchoolDeactivated_OffersOnlyTheUsableOnes()
    {
        var open = Account(Guid.NewGuid()); var alsoOpen = Account(Guid.NewGuid()); var disabled = Account(Guid.NewGuid(), false); var closed = Account(Guid.NewGuid());
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([open, disabled, closed, alsoOpen]);
        foreach (var account in new[] { open, alsoOpen, disabled }) _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(account.SchoolId)).ReturnsAsync(true);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(closed.SchoolId)).ReturnsAsync(false);
        _mockUserRepository.Setup(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>())).ReturnsAsync((IReadOnlyCollection<Guid> ids) => ids.ToDictionary(id => id, id => "School " + id.ToString()[..4]));
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);

        var error = await Assert.ThrowsAsync<LoginRejectedException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None));

        Assert.Equal(new[] { open.SchoolId, alsoOpen.SchoolId }.Order(), error.Schools!.Select(school => school.Id).Order());
        // The disabled account's school and the deactivated school were never even looked up by name.
        _mockUserRepository.Verify(r => r.GetSchoolNamesAsync(It.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 2 && !ids.Contains(disabled.SchoolId) && !ids.Contains(closed.SchoolId))), Times.Once);
        _mockJwtService.Verify(s => s.IssueTokens(It.IsAny<User>()), Times.Never);
    }

    [Fact]
    public async Task Handle_PartlyMatchingPasswords_OffersOnlySchoolsWhereThisPasswordIsRight()
    {
        // The same sign-in name in three schools, but this password belongs to two of them. The third is someone else's account.
        var mine = Account(Guid.NewGuid()); var alsoMine = Account(Guid.NewGuid()); var someoneElse = Account(Guid.NewGuid(), hash: "another_hash");
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([mine, someoneElse, alsoMine]);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(It.IsAny<Guid>())).ReturnsAsync(true);
        _mockUserRepository.Setup(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>())).ReturnsAsync((IReadOnlyCollection<Guid> ids) => ids.ToDictionary(id => id, id => "School " + id.ToString()[..4]));
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);

        var error = await Assert.ThrowsAsync<LoginRejectedException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None));

        Assert.DoesNotContain(error.Schools!, school => school.Id == someoneElse.SchoolId);
        Assert.Equal(2, error.Schools!.Count);
        _mockUserRepository.Verify(r => r.IsSchoolActiveAsync(someoneElse.SchoolId), Times.Never);
    }

    [Theory]
    [InlineData("")][InlineData("550e8400-e29b-41d4-a716-446655440000")]
    public async Task Handle_UnknownSignInName_StillCostsOnePasswordCheckAndSaysTheSameThing(string schoolId)
    {
        // Whether or not a name (or a name in a chosen school) exists, the caller sees the same error after the same kind of work.
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(It.IsAny<Guid?>(), "nobody@example.test")).ReturnsAsync([]);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => _handler.Handle(new LoginCommand("nobody@example.test", "password123", schoolId), CancellationToken.None));

        Assert.IsNotType<LoginRejectedException>(error);
        Assert.Equal("Invalid credentials", error.Message);
        _mockPasswordService.Verify(s => s.VerifyPassword("password123", It.IsAny<string>()), Times.Once);
        _mockUserRepository.Verify(r => r.GetSchoolNamesAsync(It.IsAny<IReadOnlyCollection<Guid>>()), Times.Never);
    }

    [Fact]
    public async Task Handle_TwoAccountsInOneSchool_AreNeverChosenBetween()
    {
        var school = Guid.NewGuid();
        _mockUserRepository.Setup(r => r.FindLoginCandidatesAsync(null, "person@example.test")).ReturnsAsync([Account(school), Account(school)]);
        _mockUserRepository.Setup(r => r.IsSchoolActiveAsync(school)).ReturnsAsync(true);
        _mockPasswordService.Setup(s => s.VerifyPassword("password123", "hashed_password")).Returns(true);

        var error = await Assert.ThrowsAsync<LoginRejectedException>(() => _handler.Handle(new LoginCommand("person@example.test", "password123", ""), CancellationToken.None));

        Assert.Equal(409, error.Status);
        Assert.Null(error.Schools);
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

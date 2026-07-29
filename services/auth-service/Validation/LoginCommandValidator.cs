using FluentValidation;
using Services.Auth.Handlers;

namespace Services.Auth.Validation;

public class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
        RuleFor(x => x.Username)
            .NotEmpty().WithMessage("Username is required")
            .MinimumLength(3).WithMessage("Username must be at least 3 characters")
            .MaximumLength(255).WithMessage("Username must not exceed 255 characters");

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Password is required")
            .MinimumLength(6).WithMessage("Password must be at least 6 characters");

        RuleFor(x => x.SchoolId)
            .NotEmpty().WithMessage("SchoolId is required")
            .Must(x =>
            {
                if (string.IsNullOrWhiteSpace(x)) return false;
                return Guid.TryParse(x, out _);
            }).WithMessage("SchoolId must be a valid GUID");
    }
}

using FluentValidation;
using TeacherService.Handlers;

namespace TeacherService.Validation;

public class CreateTeacherValidator : AbstractValidator<CreateTeacherCommand>
{
    public CreateTeacherValidator()
    {
        RuleFor(x => x.SchoolId)
            .NotEmpty().WithMessage("SchoolId is required")
            .Must(id => id != Guid.Empty).WithMessage("SchoolId must be a valid GUID");

        RuleFor(x => x.EmployeeCode)
            .NotEmpty().WithMessage("Employee code is required")
            .Length(1, 50).WithMessage("Employee code must be between 1 and 50 characters");

        RuleFor(x => x.FirstName)
            .NotEmpty().WithMessage("First name is required")
            .Length(1, 255).WithMessage("First name must be between 1 and 255 characters");

        RuleFor(x => x.LastName)
            .NotEmpty().WithMessage("Last name is required")
            .Length(1, 255).WithMessage("Last name must be between 1 and 255 characters");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required")
            .EmailAddress().WithMessage("Email must be a valid email address")
            .Length(1, 255).WithMessage("Email must be between 1 and 255 characters");

        RuleFor(x => x.Department)
            .NotEmpty().WithMessage("Department is required")
            .Length(1, 50).WithMessage("Department must be between 1 and 50 characters");

        RuleFor(x => x.PhoneNumber)
            .Length(1, 20).WithMessage("Phone number must be between 1 and 20 characters")
            .When(x => !string.IsNullOrEmpty(x.PhoneNumber));
    }
}

public class UpdateTeacherValidator : AbstractValidator<UpdateTeacherCommand>
{
    public UpdateTeacherValidator()
    {
        RuleFor(x => x.Id)
            .NotEmpty().WithMessage("Teacher ID is required")
            .Must(id => id != Guid.Empty).WithMessage("Teacher ID must be a valid GUID");

        RuleFor(x => x.SchoolId)
            .NotEmpty().WithMessage("SchoolId is required")
            .Must(id => id != Guid.Empty).WithMessage("SchoolId must be a valid GUID");

        RuleFor(x => x.FirstName)
            .NotEmpty().WithMessage("First name is required")
            .Length(1, 255).WithMessage("First name must be between 1 and 255 characters");

        RuleFor(x => x.LastName)
            .NotEmpty().WithMessage("Last name is required")
            .Length(1, 255).WithMessage("Last name must be between 1 and 255 characters");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required")
            .EmailAddress().WithMessage("Email must be a valid email address")
            .Length(1, 255).WithMessage("Email must be between 1 and 255 characters");

        RuleFor(x => x.Department)
            .NotEmpty().WithMessage("Department is required")
            .Length(1, 50).WithMessage("Department must be between 1 and 50 characters");

        RuleFor(x => x.Status)
            .NotEmpty().WithMessage("Status is required")
            .Must(s => s == "Active" || s == "Inactive" || s == "Retired")
            .WithMessage("Status must be Active, Inactive, or Retired");

        RuleFor(x => x.PhoneNumber)
            .Length(1, 20).WithMessage("Phone number must be between 1 and 20 characters")
            .When(x => !string.IsNullOrEmpty(x.PhoneNumber));
    }
}

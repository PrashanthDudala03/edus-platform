using FluentValidation;
using StudentService.Handlers;

namespace StudentService.Validation;

public class CreateStudentValidator : AbstractValidator<CreateStudentCommand>
{
    public CreateStudentValidator()
    {
        RuleFor(x => x.SchoolId)
            .NotEmpty().WithMessage("SchoolId is required")
            .Must(id => id != Guid.Empty).WithMessage("SchoolId must be a valid GUID");

        RuleFor(x => x.RollNumber)
            .NotEmpty().WithMessage("Roll number is required")
            .Length(1, 50).WithMessage("Roll number must be between 1 and 50 characters");

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

        RuleFor(x => x.CurrentClass)
            .NotEmpty().WithMessage("Current class is required")
            .Length(1, 50).WithMessage("Current class must be between 1 and 50 characters");

        RuleFor(x => x.DateOfBirth)
            .NotEmpty().WithMessage("Date of birth is required")
            .LessThan(DateTime.Today).WithMessage("Date of birth must be in the past");

        RuleFor(x => x.PhoneNumber)
            .Length(1, 20).WithMessage("Phone number must be between 1 and 20 characters")
            .When(x => !string.IsNullOrEmpty(x.PhoneNumber));
    }
}

public class UpdateStudentValidator : AbstractValidator<UpdateStudentCommand>
{
    public UpdateStudentValidator()
    {
        RuleFor(x => x.Id)
            .NotEmpty().WithMessage("Student ID is required")
            .Must(id => id != Guid.Empty).WithMessage("Student ID must be a valid GUID");

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

        RuleFor(x => x.CurrentClass)
            .NotEmpty().WithMessage("Current class is required")
            .Length(1, 50).WithMessage("Current class must be between 1 and 50 characters");

        RuleFor(x => x.DateOfBirth)
            .NotEmpty().WithMessage("Date of birth is required")
            .LessThan(DateTime.Today).WithMessage("Date of birth must be in the past");

        RuleFor(x => x.Status)
            .NotEmpty().WithMessage("Status is required")
            .Must(s => s == "Active" || s == "Inactive" || s == "Graduated")
            .WithMessage("Status must be Active, Inactive, or Graduated");

        RuleFor(x => x.PhoneNumber)
            .Length(1, 20).WithMessage("Phone number must be between 1 and 20 characters")
            .When(x => !string.IsNullOrEmpty(x.PhoneNumber));
    }
}

namespace Edus.Common.Exceptions;

public class ValidationException : Exception
{
    public List<string> Errors { get; }

    public ValidationException(string message, List<string>? errors = null)
        : base(message)
    {
        Errors = errors ?? new();
    }

    public ValidationException(List<string> errors)
        : base("Validation failed")
    {
        Errors = errors;
    }
}

public class NotFoundException : Exception
{
    public NotFoundException(string message) : base(message) { }
}

public class UnauthorizedException : Exception
{
    public UnauthorizedException(string message) : base(message) { }
}

public class ForbiddenException : Exception
{
    public ForbiddenException(string message) : base(message) { }
}

public class ConflictException : Exception
{
    public ConflictException(string message) : base(message) { }
}

public class InternalServerException : Exception
{
    public InternalServerException(string message, Exception? innerException = null)
        : base(message, innerException) { }
}

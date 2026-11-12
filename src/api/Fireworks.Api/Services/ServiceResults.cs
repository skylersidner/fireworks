namespace Fireworks.Api.Services;

public enum ServiceErrorType
{
    NotFound,
    Validation,

    /// <summary>
    /// The request is well-formed but the current state of other data forbids it. Distinct from
    /// <see cref="Validation"/> because nothing about the request itself is wrong, and the caller
    /// fixes it by changing the data, not the payload.
    /// </summary>
    Conflict
}

public sealed record ServiceError(ServiceErrorType Type, string Message);

public sealed class ServiceResult<T>
{
    public T? Value { get; init; }
    public ServiceError? Error { get; init; }

    public bool IsSuccess => Error is null;

    public static ServiceResult<T> Success(T value) => new() { Value = value };

    public static ServiceResult<T> NotFound(string message) => new()
    {
        Error = new ServiceError(ServiceErrorType.NotFound, message)
    };

    public static ServiceResult<T> Validation(string message) => new()
    {
        Error = new ServiceError(ServiceErrorType.Validation, message)
    };

    public static ServiceResult<T> Conflict(string message) => new()
    {
        Error = new ServiceError(ServiceErrorType.Conflict, message)
    };
}

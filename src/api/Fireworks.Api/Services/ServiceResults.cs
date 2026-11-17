using Fireworks.Api.Contracts;

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
    Conflict,

    /// <summary>
    /// The current user may not do this at all: writes (and "my creations") are switched off, or
    /// nobody is signed in (plan §3.4, <c>ICurrentUser.CanWrite</c>). 403. Never used for "you
    /// don't own that one": a creation the user doesn't own is <see cref="NotFound"/>, so a
    /// non-owner can't tell "exists" from "doesn't" (schema.md §10).
    /// </summary>
    Forbidden,

    /// <summary>415: the body isn't JSON, or has no Content-Type at all (schema.md §2.6 step 1, Boo S6).</summary>
    UnsupportedMediaType,

    /// <summary>413: the body is over the endpoint's limit (schema.md §2.5).</summary>
    PayloadTooLarge,

    /// <summary>428: a PUT without <c>If-Match</c> (schema.md §11.4). A header check, before the body.</summary>
    PreconditionRequired,

    /// <summary>
    /// 412: the owner's PUT carried a tag that isn't the current one (or can never match: <c>*</c>,
    /// a list, a weak or <c>-p</c> tag, an unparseable one). Only after the owner-filtered 404, so
    /// a non-owner never sees it. <see cref="ServiceError.CurrentUpdatedAt"/> carries the current tag.
    /// </summary>
    PreconditionFailed
}

/// <summary>
/// <paramref name="Issues"/> is set only for a structured validation failure (schema.md §2.4); the
/// controller then writes <c>{ message, errors, truncated }</c> (<c>ValidationErrorResponse</c>,
/// capped at 100 issues) instead of <c>{ message }</c>.
/// </summary>
/// <paramref name="CurrentUpdatedAt"/> is set only for <see cref="ServiceErrorType.PreconditionFailed"/>: the row's current tag.
public sealed record ServiceError(
    ServiceErrorType Type, string Message, IReadOnlyList<ValidationIssue>? Issues = null, DateTimeOffset? CurrentUpdatedAt = null);

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

    public static ServiceResult<T> Validation(string message, IReadOnlyList<ValidationIssue> issues) => new()
    {
        Error = new ServiceError(ServiceErrorType.Validation, message, issues)
    };

    public static ServiceResult<T> Conflict(string message) => new()
    {
        Error = new ServiceError(ServiceErrorType.Conflict, message)
    };

    public static ServiceResult<T> Forbidden(string message) => new()
    {
        Error = new ServiceError(ServiceErrorType.Forbidden, message)
    };

    public static ServiceResult<T> Failure(ServiceError error) => new() { Error = error };
}

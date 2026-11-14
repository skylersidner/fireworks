namespace Fireworks.Api.Contracts;

/// <summary>
/// <c>GET api/me</c>. Serialized camelCase: <c>{ userId, displayName, isAuthenticated, canWrite }</c>.
/// <c>userId</c> and <c>displayName</c> are null only when nobody is signed in, which cannot
/// happen before Phase 8.
/// </summary>
public sealed record MeResponse(Guid? UserId, string? DisplayName, bool IsAuthenticated, bool CanWrite);

/// <summary>
/// One validation problem (schema.md §2.4). <c>path</c> and <c>code</c> are the contract (§6.3);
/// <c>message</c> is developer-facing, and UIs build their copy from <c>code</c>.
/// </summary>
public sealed record ValidationIssue(string Path, string Code, string Message);

/// <summary>
/// The structured 400 body (schema.md §2.4): exactly <c>{ message, errors, truncated }</c>.
/// <c>errors</c> holds at most <see cref="MaxIssues"/> issues; <c>truncated</c> is always present
/// and true only when more were found (Boo S25). The cap is applied here, where the body is built:
/// the validators always return the complete multiset.
/// </summary>
public sealed record ValidationErrorResponse(string Message, IReadOnlyList<ValidationIssue> Errors, bool Truncated)
{
    public const int MaxIssues = 100;

    public static ValidationErrorResponse From(string message, IReadOnlyList<ValidationIssue> issues) =>
        issues.Count > MaxIssues
            ? new(message, issues.Take(MaxIssues).ToList(), true)
            : new(message, issues, false);
}

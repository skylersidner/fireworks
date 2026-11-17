namespace Fireworks.Api.Contracts;

/// <summary>
/// <c>GET api/me</c> (schema.md §2.8). Serialized camelCase, exactly
/// <c>{ userId, displayName, isAuthenticated, canWrite, signedInWith }</c> (Boo A28). Anonymous:
/// <c>null, null, false, false, null</c>. <c>signedInWith</c> is <c>"google"</c> or <c>null</c>, from
/// <c>users.external_provider</c>; never a provider subject or an email. Invariant:
/// <c>canWrite == isAuthenticated</c> (Boo A42).
/// </summary>
public sealed record MeResponse(Guid? UserId, string? DisplayName, bool IsAuthenticated, bool CanWrite, string? SignedInWith)
{
    public static readonly MeResponse Anonymous = new(null, null, false, false, null);
}

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

/// <summary>
/// <c>GET api/client-config</c>. Serialized camelCase:
/// <c>{ playback: { seekBudgetMs, catchingUpDelayMs, checkpointIntervalSeconds, checkpointMemoryMiB }, loginProviders: [{ id, name }] }</c>.
/// Anonymous; carries no identity data. <c>loginProviders</c> is empty only in Development and
/// Testing without a configured client (schema.md §2.8).
/// </summary>
public sealed record ClientConfigResponse(ClientPlaybackConfig Playback, IReadOnlyList<LoginProviderConfig> LoginProviders);

/// <summary>One sign-in button: <c>{ id: "google", name: "Google" }</c>. <c>id</c> is the <c>api/auth/login/{provider}</c> route value.</summary>
public sealed record LoginProviderConfig(string Id, string Name);

/// <summary>The <c>ClientPlayback</c> section, validated at startup (ranges in <c>ClientPlaybackOptions</c>).</summary>
public sealed record ClientPlaybackConfig(int SeekBudgetMs, int CatchingUpDelayMs, int CheckpointIntervalSeconds, int CheckpointMemoryMiB);

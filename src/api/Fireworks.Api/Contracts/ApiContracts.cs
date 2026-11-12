namespace Fireworks.Api.Contracts;

/// <summary>
/// <c>GET api/me</c>. Serialized camelCase: <c>{ userId, displayName, isAuthenticated, canWrite }</c>.
/// <c>userId</c> and <c>displayName</c> are null only when nobody is signed in, which cannot
/// happen before Phase 8.
/// </summary>
public sealed record MeResponse(Guid? UserId, string? DisplayName, bool IsAuthenticated, bool CanWrite);

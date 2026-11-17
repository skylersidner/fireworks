namespace Fireworks.Api.Services.Identity;

/// <summary>
/// The only way services and controllers learn who is acting (plan §3.4). Scoped: one instance per
/// request. Phase 8 made it <see cref="ClaimsCurrentUser"/>, read from the session cookie; no
/// caller changed.
/// </summary>
public interface ICurrentUser
{
    /// <summary>The signed-in user's id, or <c>null</c> when nobody is signed in.</summary>
    Guid? UserId { get; }

    /// <summary><c>UserId is not null</c>: one definition, shared with the fallback policy (<see cref="FireworksClaims.TryGetUserId"/>).</summary>
    bool IsAuthenticated { get; }

    /// <summary>
    /// Whether this user may create, update or delete persisted data: exactly
    /// <see cref="IsAuthenticated"/> (Skyler, 2026-11-16; Boo A42). Write endpoints still check it as
    /// defense in depth, and <c>GET api/me</c> reports it.
    /// </summary>
    bool CanWrite { get; }
}

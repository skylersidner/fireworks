namespace Fireworks.Api.Services.Identity;

/// <summary>
/// The only way services and controllers learn who is acting (plan §3.4). Scoped: one instance per
/// request. Phase 8 replaces the single DI registration with a claims-based implementation; no
/// caller changes.
/// </summary>
public interface ICurrentUser
{
    /// <summary>The acting user's id, or <c>null</c> when nobody is signed in (possible from Phase 8 on).</summary>
    Guid? UserId { get; }

    /// <summary>Always <c>false</c> until Phase 8.</summary>
    bool IsAuthenticated { get; }

    /// <summary>
    /// Whether this user may create, update or delete persisted data. Interim:
    /// <see cref="DefaultUserOptions.AllowAnonymousWrites"/>. After Phase 8: <see cref="IsAuthenticated"/>.
    /// Write endpoints check this, and <c>GET api/me</c> reports it so the client can hide write
    /// controls rather than let them fail.
    /// </summary>
    bool CanWrite { get; }
}

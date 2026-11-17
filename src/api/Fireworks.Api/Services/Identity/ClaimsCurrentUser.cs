namespace Fireworks.Api.Services.Identity;

/// <summary>
/// <see cref="ICurrentUser"/> from the session cookie's principal (design §3.1). Only our own
/// <c>NameIdentifier</c> claim is read, the one <see cref="UserProvisioning"/> issued; a provider's
/// <c>sub</c> never reaches here.
/// </summary>
public sealed class ClaimsCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? UserId =>
        FireworksClaims.TryGetUserId(accessor.HttpContext?.User, out var id) ? id : null;

    public bool IsAuthenticated => UserId is not null;

    public bool CanWrite => IsAuthenticated;
}

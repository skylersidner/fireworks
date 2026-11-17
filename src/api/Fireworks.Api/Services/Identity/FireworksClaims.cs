using System.Security.Claims;

namespace Fireworks.Api.Services.Identity;

/// <summary>
/// The one predicate that decides "signed in" (Boo A18). <see cref="ClaimsCurrentUser"/>, the
/// fallback authorization policy and the cookie's <c>OnValidatePrincipal</c> all call it, so the
/// policy and <see cref="ICurrentUser"/> can never disagree: a cookie whose id doesn't parse is
/// anonymous everywhere at once (401, never the service's 403).
/// </summary>
public static class FireworksClaims
{
    /// <summary>True when <paramref name="principal"/> is authenticated and carries a parseable, non-empty <c>NameIdentifier</c>.</summary>
    public static bool TryGetUserId(ClaimsPrincipal? principal, out Guid userId)
    {
        if (principal?.Identity?.IsAuthenticated == true
            && Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            && id != Guid.Empty)
        {
            userId = id;
            return true;
        }

        userId = Guid.Empty;
        return false;
    }

    /// <summary>The session's principal: exactly one claim, our <c>users.id</c> (Boo A10). No provider claims.</summary>
    public static ClaimsPrincipal PrincipalFor(Guid userId, string authenticationType) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], authenticationType));
}

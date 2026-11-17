using Fireworks.Api.Services.Identity;
using Fireworks.Api.Services.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Fireworks.Api.Controllers;

/// <summary>
/// Sign-in and sign-out (design §3.4, Boo A5, A9, A11). The callback,
/// <c>/api/auth/callback/google</c>, is not here: the Google handler answers it inside
/// <c>UseAuthentication</c>, before any endpoint. Both actions are anonymous and limited by the
/// <c>auth</c> policy (20 a minute per IP). Neither takes a body.
/// </summary>
[ApiController]
[AllowAnonymous]
public sealed class AuthController(FireworksAuthSetup authSetup) : ControllerBase
{
    /// <summary>
    /// <c>GET api/auth/login/{provider}?returnUrl=</c>: a top-level navigation (never a form or
    /// fetch, Boo A6) that 302s to the provider. <paramref name="provider"/> is compared ordinally
    /// against the configured list first: <c>Google</c>, <c>github</c> or anything else is the
    /// catch-all's empty 404 with no <c>Challenge</c> (an unknown scheme would be a 500, probe P8).
    /// <c>returnUrl</c> is read raw (exactly one value) and checked by <see cref="SafeReturnUrl"/> and
    /// <c>Url.IsLocalUrl</c>; anything else is <c>/</c>. This sets only the correlation cookie.
    /// </summary>
    [HttpGet("api/auth/login/{provider}")]
    [EnableRateLimiting(FireworksRateLimiting.AuthPolicy)]
    public IActionResult Login(string provider)
    {
        var match = authSetup.LoginProviders.FirstOrDefault(p => string.Equals(p.Id, provider, StringComparison.Ordinal));
        if (match is null)
        {
            // Byte-identical to the /api catch-all: an empty 404, not [ApiController]'s ProblemDetails.
            Response.StatusCode = StatusCodes.Status404NotFound;
            return new EmptyResult();
        }

        var raw = Request.Query.TryGetValue("returnUrl", out var values) && values.Count == 1 ? values[0] : null;
        var returnUrl = SafeReturnUrl.From(raw);
        if (!Url.IsLocalUrl(returnUrl))
        {
            returnUrl = SafeReturnUrl.Home;
        }

        return Challenge(new AuthenticationProperties { RedirectUri = returnUrl, IsPersistent = true }, match.Scheme);
    }

    /// <summary>
    /// <c>POST api/auth/logout</c>: always 204, idempotent, anonymous (Boo A11). Answers with a
    /// deleting <c>Set-Cookie</c> (same name, <c>Path=/</c>, <c>Secure</c> outside Development).
    /// Behind the CSRF guard like every unsafe request. <c>GET</c> is the catch-all's 404.
    /// </summary>
    [HttpPost("api/auth/logout")]
    [EnableRateLimiting(FireworksRateLimiting.AuthPolicy)]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(IdentityRegistration.CookieScheme);
        return NoContent();
    }
}

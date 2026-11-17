namespace Fireworks.Api.Services.Identity;

/// <summary>
/// The CSRF check (design §3.9 as amended by Boo A13): on <b>every</b> unsafe request (any method
/// but GET, HEAD, OPTIONS and TRACE), on every path, not only <c>/api</c>.
///
/// <list type="number">
/// <item><c>Sec-Fetch-Site</c> present: only <c>same-origin</c> passes. <c>same-site</c>,
/// <c>cross-site</c> and <c>none</c> are 403. <c>same-site</c> is the sibling-subdomain case, and
/// <c>localhost:5190</c> to <c>localhost:4200</c> reproduces it locally.</item>
/// <item>Otherwise <c>Origin</c> present: only <c>Request.Scheme://Request.Host</c> (after
/// forwarded headers; ordinal, ignoring case) passes. <c>Origin: null</c> is 403.</item>
/// <item>Both absent: pass. Non-browser clients aren't CSRF vectors, and every current engine
/// sends one of the two on an unsafe request.</item>
/// </list>
///
/// <para>
/// Placed after <c>UseAuthentication</c> (the OAuth callback completes inside it and never gets
/// here) and before <c>UseAuthorization</c> and the limiter, so a 403 here costs no database work
/// and isn't counted. Antiforgery-token triggers: Boo A17. Removing this guard or exempting a path
/// is one of them.
/// </para>
/// </summary>
public static class CrossOriginWriteGuard
{
    public const string Message = "Cross-origin requests can't change anything here.";

    public static IApplicationBuilder UseCrossOriginWriteGuard(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (IsAllowed(context.Request))
            {
                await next(context);
                return;
            }

            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = Message });
        });

    public static bool IsAllowed(HttpRequest request)
    {
        if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)
            || HttpMethods.IsOptions(request.Method) || HttpMethods.IsTrace(request.Method))
        {
            return true;
        }

        var fetchSite = request.Headers["Sec-Fetch-Site"];
        if (fetchSite.Count > 0)
        {
            return fetchSite.Count == 1 && string.Equals(fetchSite[0], "same-origin", StringComparison.Ordinal);
        }

        var origin = request.Headers.Origin;
        if (origin.Count > 0)
        {
            return origin.Count == 1
                   && string.Equals(origin[0], request.Scheme + "://" + request.Host.Value, StringComparison.OrdinalIgnoreCase);
        }

        return true;
    }
}

using System.Text.RegularExpressions;
using Microsoft.AspNetCore.StaticFiles;

namespace Fireworks.Api.Services;

/// <summary>
/// Serving the Angular build from wwwroot: static files, the SPA fallbacks, and their Cache-Control
/// (Boo P7-S4, P7-S7). Program.cs and the test harness both call this, with <b>one</b>
/// <see cref="StaticFileOptions"/> instance passed to <c>UseStaticFiles</c> and to every
/// <c>MapFallbackToFile</c>, so a file has the same caching however it was reached.
///
/// <para>
/// <b>Cache-Control by the served file's name</b>, never the request path: the fallback serves
/// <c>index.html</c> for <c>/s/&lt;code&gt;</c>, and that must be <c>no-cache</c>. Angular's hashed
/// bundles (<see cref="HashedBundle"/>) are immutable for a year; everything else served
/// (<c>index.html</c>, <c>favicon.svg</c>, <c>3rdpartylicenses.txt</c>) is <c>no-cache</c>, so it is
/// revalidated with its ETag. <c>OnPrepareResponse</c> runs only when a file is served (200 or
/// 304), so a missing <c>/chunk-AAAAAAAA.js</c> gets <see cref="ResponseHeaders"/>'s
/// <c>no-store</c>, never <c>immutable</c>.
/// </para>
/// </summary>
public static partial class SpaHosting
{
    public const string ImmutableCacheControl = "public, max-age=31536000, immutable";
    public const string RevalidateCacheControl = "no-cache";

    /// <summary>
    /// <c>main-</c>, <c>chunk-</c>, <c>styles-</c> or <c>polyfills-</c>, then the build's 8-character
    /// hash (which can itself start with <c>-</c>: <c>chunk--30TBvoS.js</c>), then <c>.js</c> or
    /// <c>.css</c>. Anchored with <c>\z</c>, not <c>$</c>.
    /// </summary>
    [GeneratedRegex(@"\A(?:main|chunk|styles|polyfills)-[A-Za-z0-9_-]{8}\.(?:js|css)\z", RegexOptions.CultureInvariant)]
    public static partial Regex HashedBundle();

    public static StaticFileOptions CreateStaticFileOptions() => new()
    {
        OnPrepareResponse = context =>
            context.Context.Response.Headers.CacheControl =
                HashedBundle().IsMatch(context.File.Name) ? ImmutableCacheControl : RevalidateCacheControl
    };

    /// <summary>Program.cs step 9: default document, then static files, before routing.</summary>
    public static WebApplication UseFireworksStaticFiles(this WebApplication app, StaticFileOptions options)
    {
        app.UseDefaultFiles();
        app.UseStaticFiles(options);
        return app;
    }

    /// <summary>
    /// Program.cs step 16, last. The default fallback's <c>{*path:nonfile}</c> skips a last segment
    /// with a dot, so <c>/s/a.b</c> and <c>/c/..%2Fme</c> got a bare 404 and a browser error page;
    /// share and working-copy links take any last segment, and the app's own not-found page answers
    /// (its share-code regex runs before any URL is built, Boo C4). Dotted paths elsewhere stay 404.
    /// </summary>
    public static WebApplication MapFireworksSpaFallback(this WebApplication app, StaticFileOptions options)
    {
        // Anonymous: under the fail-closed fallback policy every deep link would otherwise 401
        // before any HTML is served.
        app.MapFallbackToFile("/s/{**rest}", "index.html", options).AllowAnonymous();
        app.MapFallbackToFile("/c/{**rest}", "index.html", options).AllowAnonymous();
        app.MapFallbackToFile("index.html", options).AllowAnonymous();
        return app;
    }
}

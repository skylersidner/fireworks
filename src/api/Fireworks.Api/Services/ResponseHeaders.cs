using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.Features;

namespace Fireworks.Api.Services;

/// <summary>
/// The one site-wide response-header middleware (Boo, <c>boo-phase7-security-requirements.md</c>
/// P7-S1, §4). Registered at Program.cs step 6a, before the exception handler and static files, so
/// one copy covers static files, the SPA fallback, <c>/api</c>, health and error responses. The
/// headers are set in <c>OnStarting</c>, after the exception handler has cleared a failed response.
///
/// <list type="bullet">
/// <item><b>Site-wide, overwriting:</b> <see cref="SiteWide"/> (the enforced CSP, nosniff,
/// Referrer-Policy, X-Frame-Options, COOP, CORP, Permissions-Policy). <c>Server</c> is turned off in
/// <see cref="KestrelLimits"/>, the only switch that also reaches Kestrel's own 400 and 431.</item>
/// <item><b>HSTS only over HTTPS and outside Development</b> (P7-S3). <c>Request.IsHttps</c> is read
/// after the forwarded headers, so behind the edge it follows <c>X-Forwarded-Proto</c>. Not
/// <c>UseHsts()</c>: its default <c>ExcludedHosts</c> hides the header for localhost, which would make
/// a local check meaningless.</item>
/// <item><b>Cache-Control defaults to <c>no-store</c> only when nothing else set it</b> (P7-S4). The
/// only other writers are <see cref="SpaHosting"/>'s shared <c>StaticFileOptions</c> (static files
/// and the fallback), the share-code GET in <c>CreationsController</c> (200 and 304 only), the
/// health-check framework, and <c>UseExceptionHandler</c> (Program.cs step 7). Never overwrite here,
/// except the exception handler's <c>no-cache,no-store</c> (plus <c>Pragma</c> and <c>Expires</c>),
/// which becomes <c>no-store</c> with the other two removed (Boo P7 F1): a handled exception never
/// keeps a share-code value, because the handler clears the response first.</item>
/// <item><b><c>Connection: close</c> on <c>/api</c> when the body can't be drained:</b> a declared
/// <c>Content-Length</c> over the endpoint's current limit, or no declared length on a request
/// that can have a body (chunked; Boo P7-S8). Kestrel closes such a connection after an early
/// answer (403, 415, 404, 429), and without the header a pooling client's next request on it
/// fails. An under-limit chunked write is closed too; accepted, since browsers never send one.
/// <see cref="Creations.HttpCreationRequestBody"/> does the same for its own 413.</item>
/// </list>
///
/// Never add response compression or request decompression to this app (P7-S9, S2, S4).
/// </summary>
public static class ResponseHeaders
{
    /// <summary>The enforced policy (Boo §3; Skyler accepted <c>style-src 'unsafe-inline'</c>, 2026-11-15). Widening any directive needs a record with evidence.</summary>
    public const string ContentSecurityPolicy =
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; " +
        "worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

    public const string StrictTransportSecurity = "max-age=31536000";

    public const string DefaultCacheControl = "no-store";

    /// <summary>Every app-pipeline response carries exactly these values.</summary>
    public static readonly IReadOnlyList<KeyValuePair<string, string>> SiteWide =
    [
        new("Content-Security-Policy", ContentSecurityPolicy),
        new("X-Content-Type-Options", "nosniff"),
        new("Referrer-Policy", "same-origin"),
        new("X-Frame-Options", "DENY"),
        new("Cross-Origin-Opener-Policy", "same-origin"),
        new("Cross-Origin-Resource-Policy", "same-origin"),
        new("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
    ];

    /// <param name="contentSecurityPolicy">
    /// Tests only: a different policy, so a test can show the header follows the argument. Program.cs
    /// never passes it; the image always sends <see cref="ContentSecurityPolicy"/>.
    /// </param>
    public static WebApplication UseFireworksResponseHeaders(this WebApplication app, string contentSecurityPolicy = ContentSecurityPolicy)
    {
        var sendHsts = !app.Environment.IsDevelopment();
        app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                Apply(context, sendHsts, contentSecurityPolicy);
                return Task.CompletedTask;
            });

            await next();
        });
        return app;
    }

    private static void Apply(HttpContext context, bool sendHsts, string contentSecurityPolicy)
    {
        var headers = context.Response.Headers;
        foreach (var (name, value) in SiteWide)
        {
            headers[name] = value;
        }

        headers.ContentSecurityPolicy = contentSecurityPolicy;

        if (sendHsts && context.Request.IsHttps)
        {
            headers.StrictTransportSecurity = StrictTransportSecurity;
        }

        if (context.Features.Get<IExceptionHandlerFeature>() is not null)
        {
            // The fifth writer (Boo P7 F1): UseExceptionHandler's own OnStarting, registered after
            // this one and so run before it, writes "no-cache,no-store", Pragma: no-cache and
            // Expires: -1. Normalize a handled exception to the one value every other error sends.
            headers.CacheControl = DefaultCacheControl;
            headers.Remove("Pragma");
            headers.Remove("Expires");
        }
        else if (string.IsNullOrEmpty(headers.CacheControl))
        {
            headers.CacheControl = DefaultCacheControl;
        }

        if (context.Request.Path.StartsWithSegments("/api") && BodyCannotBeDrained(context))
        {
            headers.Connection = "close";
        }
    }

    private static bool BodyCannotBeDrained(HttpContext context)
    {
        if (context.Request.ContentLength is { } declared)
        {
            return context.Features.Get<IHttpMaxRequestBodySizeFeature>()?.MaxRequestBodySize is { } max && declared > max;
        }

        return context.Features.Get<IHttpRequestBodyDetectionFeature>()?.CanHaveBody == true;
    }
}

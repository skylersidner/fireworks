using Microsoft.AspNetCore.Http.Features;

namespace Fireworks.Api.Services;

/// <summary>
/// Headers on every <c>/api</c> response (Boo S16, S24 hardening):
/// <c>Cache-Control: no-store</c>, because a PUT changes what a share code returns and
/// <c>isOwner</c>/<c>remixedFrom</c> vary by user after Phase 8, so no shared cache may hold them
/// (Phase 7 may relax it for share-code GETs); and <c>X-Content-Type-Options: nosniff</c>, because
/// 400 bodies echo short pieces of user input.
///
/// <para>
/// <b><c>Connection: close</c> when the declared body is over the endpoint's limit.</b> Such a body
/// can't be drained, so Kestrel drops the connection after the response. Without the header a
/// client reuses the pooled connection and its next request fails with "response ended
/// prematurely" (measured: a 403 to a 300 KB body with writes off, then the next request on that
/// connection). The 403, 415, 404 and 429 paths never read the body, so this covers all of them;
/// <see cref="Creations.HttpCreationRequestBody"/> does the same for its own 413. A chunked body
/// has no declared length and isn't covered (browsers send <c>Content-Length</c>, Boo F2).
/// </para>
/// </summary>
public static class ApiResponseHeaders
{
    public static IApplicationBuilder UseFireworksApiResponseHeaders(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.OnStarting(() =>
                {
                    context.Response.Headers.CacheControl = "no-store";
                    context.Response.Headers.XContentTypeOptions = "nosniff";
                    if (context.Request.ContentLength is { } declared
                        && context.Features.Get<IHttpMaxRequestBodySizeFeature>()?.MaxRequestBodySize is { } max
                        && declared > max)
                    {
                        context.Response.Headers.Connection = "close";
                    }

                    return Task.CompletedTask;
                });
            }

            await next();
        });
}

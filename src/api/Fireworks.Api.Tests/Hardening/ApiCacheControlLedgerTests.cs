using System.Net;
using System.Net.Http.Headers;
using Fireworks.Api.Controllers;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Creations;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Fireworks.Api.Tests.Hardening;

/// <summary>
/// Boo P7-S5's exact ledger (Toad's rule): every <c>/api</c> endpoint and status this suite can
/// produce, with its <c>Cache-Control</c>. Only the share-code GET's 200 and 304 may be anything
/// but <c>no-store</c>. The endpoint list comes from the route table, so a new <c>/api</c>
/// endpoint fails this test until it is added here. Mutant: restore the old overwrite (no-store
/// set unconditionally on <c>/api</c>), and the two share-code rows fail. The 500 row (Boo P7 F1)
/// is the exception handler's: it must be <c>no-store</c> with no <c>Pragma</c> or <c>Expires</c>;
/// drop the normalization in <c>ResponseHeaders</c> and it reports <c>no-cache,no-store</c>.
/// </summary>
public sealed class ApiCacheControlLedgerTests
{
    private const string Code = "{shareCode:" + Fireworks.Api.Services.Creations.ShareCodeRouteConstraint.Name + "}";

    private static readonly string[] ExpectedEndpoints =
    [
        "DELETE api/creations/" + Code,
        "GET api/auth/login/{provider}",
        "GET api/client-config",
        "GET api/creations/" + Code,
        "GET api/me",
        "GET api/me/creations",
        "POST api/auth/logout",
        "POST api/creations",
        "POST api/creations/" + Code + "/remix",
        "PUT api/creations/" + Code,
        "* /api/{**rest}"
    ];

    private static IEnumerable<string> ApiEndpoints(FireworksApiHarness h) =>
        h.App.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText!.TrimStart('/').StartsWith("api", StringComparison.Ordinal))
            .SelectMany(e => e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Select(m => $"{m} {e.RoutePattern.RawText}")
                             ?? [$"* {e.RoutePattern.RawText}"]);

    private static Task<HttpResponseMessage> Json(FireworksApiHarness h, HttpMethod method, string path, string body, string? ifMatch = CreationApiHarness.AutoIfMatch) =>
        CreationApiHarness.SendJsonAsync(h.Client, method, path, body, ifMatch);

    private static Task<HttpResponseMessage> CrossSite(FireworksApiHarness h, HttpMethod method, string path, string body)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
        request.Headers.Add("Sec-Fetch-Site", "cross-site");
        return h.Client.SendAsync(request);
    }

    /// <summary>The cookie handler's own value on responses that set or delete the session (A27): contains no-store.</summary>
    private const string CookieHandlerCacheControl = "no-cache,no-store";

    private static string Shell => $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}";
    private static string Doc => $"{{\"document\":{CreationEndpointTests.Peony}}}";

    private static async Task<HttpResponseMessage> PutOversizedAsync(FireworksApiHarness h, string code, HttpContent content)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/creations/{code}") { Content = content };
        request.Headers.TryAddWithoutValidation("If-Match", await CreationApiHarness.CurrentTagAsync(h.Client, $"/api/creations/{code}"));
        return await h.Client.SendAsync(request);
    }

    [Fact]
    public async Task Only_the_share_code_GETs_200_and_304_are_not_no_store()
    {
        await using var on = await FireworksApiHarness.StartAsync(true, FireworksApiHarness.UnthrottledRateLimits);
        await using var off = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);
        await using var limited = await FireworksApiHarness.StartAsync(true, new Dictionary<string, string?>
        {
            ["RateLimits:Writes:PerMinute"] = "1",
            ["RateLimits:Writes:PerDay"] = "100",
            ["RateLimits:Reads:PerMinute"] = "1"
        });
        await using var throwing = await ResponseHeaderTests.StartAsync();

        Assert.Equal(ExpectedEndpoints.Order(StringComparer.Ordinal), ApiEndpoints(on).Order(StringComparer.Ordinal));

        var code = await ResponseHeaderTests.CreateAsync(on.Client);
        var doomed = await ResponseHeaderTests.CreateAsync(on.Client);
        var oversized = new ByteArrayContent(new byte[300 * 1024]);
        oversized.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        var oversizedPut = new ByteArrayContent(new byte[300 * 1024]);
        oversizedPut.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        using var first = await on.Client.GetAsync($"/api/creations/{code}");
        using var conditional = new HttpRequestMessage(HttpMethod.Get, $"/api/creations/{code}");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", first.Headers.ETag!.ToString());
        var logoutSession = await off.SignInAsync(Support.TestIdentity.Alice);
        await limited.Client.GetAsync("/api/creations/abcdefgh");
        await Json(limited, HttpMethod.Post, "/api/creations", "{");

        var rows = new List<(string Endpoint, int Expected, HttpResponseMessage Response)>
        {
            ("GET api/me", 200, await on.Client.GetAsync("/api/me")),
            ("GET api/me", 500, await throwing.Client.GetAsync("/api/me")),
            ("GET api/client-config", 200, await on.Client.GetAsync("/api/client-config")),
            ("GET api/me/creations", 200, await on.Client.GetAsync("/api/me/creations")),
            ("GET api/me/creations", 400, await on.Client.GetAsync("/api/me/creations?kind=x")),
            ("GET api/me/creations", 401, await off.Client.GetAsync("/api/me/creations")),
            ("POST api/creations", 201, await Json(on, HttpMethod.Post, "/api/creations", Shell)),
            ("POST api/creations", 400, await Json(on, HttpMethod.Post, "/api/creations", "{")),
            ("POST api/creations", 401, await Json(off, HttpMethod.Post, "/api/creations", Shell)),
            ("POST api/creations", 403, await CrossSite(on, HttpMethod.Post, "/api/creations", Shell)),
            ("POST api/creations", 413, await on.Client.PostAsync("/api/creations", oversized)),
            ("POST api/creations", 415, await on.Client.PostAsync("/api/creations", new StringContent(Shell))),
            ("POST api/creations", 429, await Json(limited, HttpMethod.Post, "/api/creations", Shell)),
            ("GET api/creations/" + Code, 200, await on.Client.GetAsync($"/api/creations/{code}")),
            ("GET api/creations/" + Code, 304, await on.Client.SendAsync(conditional)),
            ("GET api/creations/" + Code, 404, await on.Client.GetAsync("/api/creations/abcdefgh")),
            ("GET api/creations/" + Code, 429, await limited.Client.GetAsync("/api/creations/abcdefgh")),
            ("PUT api/creations/" + Code, 200, await Json(on, HttpMethod.Put, $"/api/creations/{code}", Doc)),
            ("PUT api/creations/" + Code, 400, await Json(on, HttpMethod.Put, $"/api/creations/{code}", "{}")),
            ("PUT api/creations/" + Code, 401, await Json(off, HttpMethod.Put, $"/api/creations/{code}", Doc, "\"x\"")),
            ("PUT api/creations/" + Code, 403, await CrossSite(on, HttpMethod.Put, $"/api/creations/{code}", Doc)),
            ("PUT api/creations/" + Code, 412, await Json(on, HttpMethod.Put, $"/api/creations/{code}", Doc, "\"1999-01-01T00:00:00+00:00\"")),
            ("PUT api/creations/" + Code, 428, await Json(on, HttpMethod.Put, $"/api/creations/{code}", Doc, null)),
            ("PUT api/creations/" + Code, 404, await Json(on, HttpMethod.Put, "/api/creations/abcdefgh", Doc)),
            ("PUT api/creations/" + Code, 413, await PutOversizedAsync(on, code, oversizedPut)),
            ("POST api/creations/" + Code + "/remix", 201, await Json(on, HttpMethod.Post, $"/api/creations/{code}/remix", Doc)),
            ("POST api/creations/" + Code + "/remix", 404, await Json(on, HttpMethod.Post, "/api/creations/abcdefgh/remix", Doc)),
            ("DELETE api/creations/" + Code, 204, await on.Client.DeleteAsync($"/api/creations/{doomed}")),
            ("DELETE api/creations/" + Code, 401, await off.Client.DeleteAsync($"/api/creations/{code}")),
            ("DELETE api/creations/" + Code, 404, await on.Client.DeleteAsync("/api/creations/abcdefgh")),
            ("* /api/{**rest}", 404, await on.Client.GetAsync("/api/nope")),
            ("* /api/{**rest}", 404, await on.Client.DeleteAsync("/api/me")),
            ("* /api/{**rest}", 429, await limited.Client.GetAsync("/api/nope")),
            ("GET api/auth/login/{provider}", 302, await off.Client.GetAsync("/api/auth/login/google")),
            ("GET api/auth/login/{provider}", 404, await off.Client.GetAsync("/api/auth/login/Google")),
            ("POST api/auth/logout", 204, await logoutSession.Http.PostAsync("/api/auth/logout", null)),
            ("POST api/auth/logout", 403, await CrossSite(on, HttpMethod.Post, "/api/auth/logout", ""))
        };

        var failures = new List<string>();
        foreach (var (endpoint, expected, response) in rows)
        {
            using (response)
            {
                var status = (int)response.StatusCode;
                var relaxed = endpoint == "GET api/creations/" + Code && status is 200 or 304;
                var setsCookie = response.Headers.NonValidated.Contains("Set-Cookie");
                // The cookie handler writes its own value (and Pragma, Expires) whenever it sets or
                // deletes the session (logout); "only if unset" keeps it. Accepted: it contains no-store (A27).
                var cookieHandler = endpoint == "POST api/auth/logout" && status == 204;
                var want = relaxed ? CreationsController.ShareCodeGetCacheControl : cookieHandler ? CookieHandlerCacheControl : "no-store";
                var got = HeaderExpectations.CacheControl(response);
                if (status != expected || got != want)
                {
                    failures.Add($"{endpoint} {expected}: got {status} '{got}', want '{want}'");
                }

                if (setsCookie && !(got ?? "").Contains("no-store", StringComparison.Ordinal))
                {
                    failures.Add($"{endpoint} {expected}: Set-Cookie without no-store ('{got}')");
                }

                foreach (var legacy in cookieHandler ? [] : new[] { "Pragma", "Expires" })
                {
                    if (response.Headers.NonValidated.Contains(legacy) || response.Content.Headers.NonValidated.Contains(legacy))
                    {
                        failures.Add($"{endpoint} {expected}: unexpected {legacy}");
                    }
                }
            }
        }

        Assert.Empty(failures);
        // Every enumerated endpoint has at least one row, so the ledger is never vacuous.
        Assert.Equal(ExpectedEndpoints.Order(StringComparer.Ordinal), rows.Select(r => r.Endpoint).Distinct().Order(StringComparer.Ordinal));
        Assert.Equal("private, no-cache", CreationsController.ShareCodeGetCacheControl);
    }
}

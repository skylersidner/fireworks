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
        "GET api/client-config",
        "GET api/creations/" + Code,
        "GET api/me",
        "GET api/me/creations",
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

    private static Task<HttpResponseMessage> Json(FireworksApiHarness h, HttpMethod method, string path, string body) =>
        CreationApiHarness.SendJsonAsync(h.Client, method, path, body);

    private static string Shell => $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}";
    private static string Doc => $"{{\"document\":{CreationEndpointTests.Peony}}}";

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
        await limited.Client.GetAsync("/api/creations/abcdefgh");
        await Json(limited, HttpMethod.Post, "/api/creations", "{");

        var rows = new List<(string Endpoint, int Expected, HttpResponseMessage Response)>
        {
            ("GET api/me", 200, await on.Client.GetAsync("/api/me")),
            ("GET api/me", 500, await throwing.Client.GetAsync("/api/me")),
            ("GET api/client-config", 200, await on.Client.GetAsync("/api/client-config")),
            ("GET api/me/creations", 200, await on.Client.GetAsync("/api/me/creations")),
            ("GET api/me/creations", 400, await on.Client.GetAsync("/api/me/creations?kind=x")),
            ("GET api/me/creations", 403, await off.Client.GetAsync("/api/me/creations")),
            ("POST api/creations", 201, await Json(on, HttpMethod.Post, "/api/creations", Shell)),
            ("POST api/creations", 400, await Json(on, HttpMethod.Post, "/api/creations", "{")),
            ("POST api/creations", 403, await Json(off, HttpMethod.Post, "/api/creations", Shell)),
            ("POST api/creations", 413, await on.Client.PostAsync("/api/creations", oversized)),
            ("POST api/creations", 415, await on.Client.PostAsync("/api/creations", new StringContent(Shell))),
            ("POST api/creations", 429, await Json(limited, HttpMethod.Post, "/api/creations", Shell)),
            ("GET api/creations/" + Code, 200, await on.Client.GetAsync($"/api/creations/{code}")),
            ("GET api/creations/" + Code, 304, await on.Client.SendAsync(conditional)),
            ("GET api/creations/" + Code, 404, await on.Client.GetAsync("/api/creations/abcdefgh")),
            ("GET api/creations/" + Code, 429, await limited.Client.GetAsync("/api/creations/abcdefgh")),
            ("PUT api/creations/" + Code, 200, await Json(on, HttpMethod.Put, $"/api/creations/{code}", Doc)),
            ("PUT api/creations/" + Code, 400, await Json(on, HttpMethod.Put, $"/api/creations/{code}", "{}")),
            ("PUT api/creations/" + Code, 403, await Json(off, HttpMethod.Put, $"/api/creations/{code}", Doc)),
            ("PUT api/creations/" + Code, 404, await Json(on, HttpMethod.Put, "/api/creations/abcdefgh", Doc)),
            ("PUT api/creations/" + Code, 413, await on.Client.PutAsync($"/api/creations/{code}", oversizedPut)),
            ("POST api/creations/" + Code + "/remix", 201, await Json(on, HttpMethod.Post, $"/api/creations/{code}/remix", Doc)),
            ("POST api/creations/" + Code + "/remix", 404, await Json(on, HttpMethod.Post, "/api/creations/abcdefgh/remix", Doc)),
            ("DELETE api/creations/" + Code, 204, await on.Client.DeleteAsync($"/api/creations/{doomed}")),
            ("DELETE api/creations/" + Code, 403, await off.Client.DeleteAsync($"/api/creations/{code}")),
            ("DELETE api/creations/" + Code, 404, await on.Client.DeleteAsync("/api/creations/abcdefgh")),
            ("* /api/{**rest}", 404, await on.Client.GetAsync("/api/nope")),
            ("* /api/{**rest}", 404, await on.Client.DeleteAsync("/api/me")),
            ("* /api/{**rest}", 429, await limited.Client.GetAsync("/api/nope"))
        };

        var failures = new List<string>();
        foreach (var (endpoint, expected, response) in rows)
        {
            using (response)
            {
                var status = (int)response.StatusCode;
                var relaxed = endpoint == "GET api/creations/" + Code && status is 200 or 304;
                var want = relaxed ? CreationsController.ShareCodeGetCacheControl : "no-store";
                var got = HeaderExpectations.CacheControl(response);
                if (status != expected || got != want)
                {
                    failures.Add($"{endpoint} {expected}: got {status} '{got}', want '{want}'");
                }

                foreach (var legacy in new[] { "Pragma", "Expires" })
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

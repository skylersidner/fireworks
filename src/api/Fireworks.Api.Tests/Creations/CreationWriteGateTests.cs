using System.Net;
using System.Text.RegularExpressions;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Support;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Fireworks.Api.Tests.Creations;

/// <summary>
/// The write gate, enumerated from the router (plan Phase 4 tests, Boo S8; Phase 8 A19, A21): every
/// endpoint with a non-GET method, plus <c>GET api/me/creations</c>, answers <b>401</b> to an
/// anonymous caller (the fallback policy, before the limiter and the service), given a VALID
/// body, and makes no repository call. The set comes from <see cref="EndpointDataSource"/>, not a
/// hand-written list, so a new write action without the gate fails here. Each target is also sent
/// every <see cref="FormBodies"/> shape, which fails if anything reads the body before the gate.
/// </summary>
public sealed class CreationWriteGateTests
{
    /// <summary>
    /// Endpoints that carry no HTTP method metadata, i.e. answer every method. Each is named with its
    /// reason, and the test fails if the set changes, so a new method-less endpoint can't slip past
    /// the gate check unexamined.
    /// </summary>
    private static readonly Dictionary<string, string> MethodlessEndpoints = new(StringComparer.Ordinal)
    {
        ["/health/live"] = "health check; never writes",
        ["/health/ready"] = "health check (one database connect); never writes",
        // app.Map maps every method. Excluded by pattern, not by method: it is the /api 404, has no
        // gate to test, and its own test asserts 404 (SkeletonEndpointTests).
        ["/api/{**rest}"] = "the /api 404 catch-all"
        // The SPA fallbacks ({*path:nonfile}, /s/{**rest}, /c/{**rest}) are not here: they carry GET/HEAD metadata.
    };

    /// <summary>Unsafe endpoints that are anonymous on purpose, each with its reason (Boo A20).</summary>
    private static readonly Dictionary<string, string> AnonymousWrites = new(StringComparer.Ordinal)
    {
        ["POST api/auth/logout"] = "always 204, idempotent (Boo A11); behind the CSRF guard"
    };

    [Fact]
    public async Task Every_write_endpoint_and_my_creations_are_401_when_anonymous_and_query_nothing()
    {
        var ledger = new CallLedger();
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits,
            services => RecordingCreationRepository.Register(services, ledger));

        var endpoints = h.App.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();

        var methodless = endpoints.Where(e => e.Metadata.GetMetadata<HttpMethodMetadata>() is null)
            .Select(e => e.RoutePattern.RawText!).Order(StringComparer.Ordinal).ToList();
        Assert.Equal(MethodlessEndpoints.Keys.Order(StringComparer.Ordinal), methodless);

        var targets = endpoints
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? [])
                .Where(m => !HttpMethods.IsGet(m) && !HttpMethods.IsHead(m))
                .Select(m => (Method: m, Pattern: e.RoutePattern.RawText!)))
            .ToList();
        Assert.Equal(AnonymousWrites.Keys, targets.Where(t => AnonymousWrites.ContainsKey($"{t.Method} {t.Pattern}")).Select(t => $"{t.Method} {t.Pattern}"));
        targets = targets.Where(t => !AnonymousWrites.ContainsKey($"{t.Method} {t.Pattern}"))
            .Append((Method: "GET", Pattern: "api/me/creations"))
            .ToList();
        Assert.Equal(5, targets.Count); // POST create, PUT, DELETE, POST remix, GET list; never vacuous

        foreach (var (method, pattern) in targets)
        {
            // Any route parameter gets a well-formed code; the gate runs before the lookup anyway.
            var path = "/" + Regex.Replace(pattern, @"\{[^}]+\}", "abcdefgh");
            var body = path == "/api/creations"
                ? $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}"
                : $"{{\"document\":{CreationEndpointTests.Peony}}}";
            ledger.Clear();

            using (var response = method == "GET" || method == "DELETE"
                ? await h.Client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path))
                : await CreationApiHarness.SendJsonAsync(h.Client, new HttpMethod(method), path, body, ifMatch: "\"x\""))
            {
                Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"{method} {path} -> {(int)response.StatusCode}");
                Assert.Empty(ledger.Calls);
            }

            // Form-typed bodies on every target, GET and DELETE included (Boo F1). MVC's form value
            // providers parsed these during model binding, before the gate, and answered 400.
            foreach (var form in FormBodies.All)
            {
                ledger.Clear();
                using var response = await CreationApiHarness.SendRawAsync(h.Client, new HttpMethod(method), path, form.Body, form.ContentType, ifMatch: "\"x\"");
                Assert.True(response.StatusCode == HttpStatusCode.Unauthorized,
                    $"{method} {path} {form.Name} -> {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
                Assert.Empty(ledger.Calls);
            }
        }
    }

    [Fact]
    public async Task Anonymous_an_invalid_body_is_401_too_because_the_policy_comes_first()
    {
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);

        using var notJson = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Post, "/api/creations", "{");
        using var wrongType = await CreationApiHarness.SendRawAsync(h.Client, HttpMethod.Post, "/api/creations", [1, 2, 3], "text/plain");
        using var oversize = await CreationApiHarness.SendRawAsync(h.Client, HttpMethod.Post, "/api/creations", new byte[300_000]);

        Assert.Equal(HttpStatusCode.Unauthorized, notJson.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrongType.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, oversize.StatusCode);
    }

    [Fact]
    public async Task Anonymous_share_code_reads_stay_public()
    {
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);
        await h.SeedLegacyUserAsync();
        await using (var db = h.NewContext())
        {
            db.Creations.Add(new Fireworks.Api.Data.Entities.Creation
            {
                Id = Guid.NewGuid(), ShareCode = "abcdefgh", Kind = Fireworks.Api.Data.Entities.CreationKind.Shell, Name = "Peony",
                SchemaVersion = 1, Palette = ["red"], Document = CreationEndpointTests.Peony, OwnerUserId = TestIdentity.LegacyDefaultUserId
            });
            await db.SaveChangesAsync();
        }

        using var response = await h.Client.GetAsync("/api/creations/abcdefgh");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}

using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Fireworks.Api.Contracts;
using Fireworks.Api.Services;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Creations;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Fireworks.Api.Tests.Hardening;

/// <summary>
/// Boo P7-S1 and P7-S2: one site-wide header set on every response class in §4's table, byte for
/// byte, and no <c>Server</c> header anywhere, Kestrel's own 400 and 431 included. Negative control:
/// the same classes on a host without <c>UseFireworksResponseHeaders</c> each report a problem.
/// </summary>
public sealed class ResponseHeaderTests
{
    internal const string HashedChunk = "chunk-AAAAAAAA.js";

    private sealed class ThrowingMeService : IMeService
    {
        public Task<Fireworks.Api.Services.ServiceResult<MeResponse>> GetCurrentUserAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("forced 500");
    }

    internal static async Task<FireworksApiHarness> StartAsync(bool registerResponseHeaders = true, int readsPerMinute = 100000)
    {
        var h = await FireworksApiHarness.StartAsync(true, new Dictionary<string, string?>
            {
                ["RateLimits:Writes:PerMinute"] = "100000",
                ["RateLimits:Writes:PerDay"] = "100000",
                ["RateLimits:Reads:PerMinute"] = readsPerMinute.ToString()
            },
            services =>
            {
                services.RemoveAll<IMeService>();
                services.AddScoped<IMeService, ThrowingMeService>();
            },
            registerResponseHeaders: registerResponseHeaders);
        await File.WriteAllTextAsync(Path.Combine(h.WebRootPath, HashedChunk), "export const x = 1;");
        await File.WriteAllTextAsync(Path.Combine(h.WebRootPath, "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
        return h;
    }

    internal static async Task<string> CreateAsync(HttpClient client)
    {
        using var created = await CreationApiHarness.SendJsonAsync(client, HttpMethod.Post, "/api/creations",
            $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var json = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("shareCode").GetString()!;
    }

    private static async Task<HttpResponseMessage> Conditional(HttpClient client, string path)
    {
        using var first = await client.GetAsync(path);
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.TryAddWithoutValidation("If-None-Match", first.Headers.ETag!.ToString());
        return await client.SendAsync(request);
    }

    /// <summary>One request per §4 row (and the error statuses P7-S1 names), with the status it must get.</summary>
    private static async Task<List<(string Name, HttpStatusCode Expected, HttpResponseMessage Response)>> EveryClassAsync(FireworksApiHarness h, FireworksApiHarness limited)
    {
        var code = await CreateAsync(h.Client);
        var oversized = new ByteArrayContent(new byte[300 * 1024]);
        oversized.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        await limited.Client.GetAsync("/api/creations/abcdefgh");

        return
        [
            ("index /", HttpStatusCode.OK, await h.Client.GetAsync("/")),
            ("index /index.html", HttpStatusCode.OK, await h.Client.GetAsync("/index.html")),
            ("index 304", HttpStatusCode.NotModified, await Conditional(h.Client, "/index.html")),
            ("deep link /s/<code>", HttpStatusCode.OK, await h.Client.GetAsync($"/s/{code}")),
            ("deep link /c/..%2Fme", HttpStatusCode.OK, await h.Client.GetAsync("/c/..%2Fme")),
            ("deep link /show", HttpStatusCode.OK, await h.Client.GetAsync("/show")),
            ("hashed bundle", HttpStatusCode.OK, await h.Client.GetAsync("/" + HashedChunk)),
            ("hashed bundle 304", HttpStatusCode.NotModified, await Conditional(h.Client, "/" + HashedChunk)),
            ("other static", HttpStatusCode.OK, await h.Client.GetAsync("/favicon.svg")),
            ("static miss", HttpStatusCode.NotFound, await h.Client.GetAsync("/nope.js")),
            ("405 on a deep link", HttpStatusCode.MethodNotAllowed, await h.Client.PostAsync("/show", new StringContent("x"))),
            ("api 200", HttpStatusCode.OK, await h.Client.GetAsync("/api/client-config")),
            ("api 404", HttpStatusCode.NotFound, await h.Client.GetAsync("/api/nope")),
            ("api 400", HttpStatusCode.BadRequest, await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Post, "/api/creations", "{")),
            ("api 413", HttpStatusCode.RequestEntityTooLarge, await h.Client.PostAsync("/api/creations", oversized)),
            ("api 500", HttpStatusCode.InternalServerError, await h.Client.GetAsync("/api/me")),
            ("share-code 200", HttpStatusCode.OK, await h.Client.GetAsync($"/api/creations/{code}")),
            ("share-code 304", HttpStatusCode.NotModified, await Conditional(h.Client, $"/api/creations/{code}")),
            ("share-code 404", HttpStatusCode.NotFound, await h.Client.GetAsync("/api/creations/abcdefgh")),
            ("share-code 429", HttpStatusCode.TooManyRequests, await limited.Client.GetAsync("/api/creations/abcdefgh")),
            ("health live", HttpStatusCode.OK, await h.Client.GetAsync("/health/live")),
            ("health ready", HttpStatusCode.OK, await h.Client.GetAsync("/health/ready"))
        ];
    }

    [Fact]
    public async Task Every_response_class_carries_exactly_the_site_wide_headers_and_no_Server()
    {
        await using var h = await StartAsync();
        await using var limited = await StartAsync(readsPerMinute: 1);

        var failures = new List<string>();
        foreach (var (name, expected, response) in await EveryClassAsync(h, limited))
        {
            using (response)
            {
                if (response.StatusCode != expected)
                {
                    failures.Add($"{name}: status {(int)response.StatusCode}, expected {(int)expected}");
                }

                failures.AddRange(HeaderExpectations.Problems(response).Select(p => $"{name}: {p}"));
            }
        }

        Assert.Empty(failures);
    }

    [Fact]
    public async Task Negative_control_without_the_middleware_every_class_reports_a_problem()
    {
        await using var h = await StartAsync(registerResponseHeaders: false);
        await using var limited = await StartAsync(registerResponseHeaders: false, readsPerMinute: 1);

        var classes = await EveryClassAsync(h, limited);
        var clean = classes.Where(c => HeaderExpectations.Problems(c.Response).Count == 0).Select(c => c.Name).ToList();
        foreach (var (_, _, response) in classes)
        {
            response.Dispose();
        }

        Assert.Equal(22, classes.Count);
        Assert.Empty(clean);
    }

    [Fact]
    public void The_app_constant_is_the_policy_Boo_specified()
    {
        Assert.Equal(HeaderExpectations.Csp, ResponseHeaders.ContentSecurityPolicy);
        Assert.DoesNotContain("unsafe-eval", ResponseHeaders.ContentSecurityPolicy);
        Assert.DoesNotContain("script-src 'self' 'unsafe-inline'", ResponseHeaders.ContentSecurityPolicy);
    }

    /// <summary>
    /// Kestrel answers these itself, before any middleware, so only <c>AddServerHeader = false</c>
    /// (<c>KestrelLimits.Apply</c>) reaches them. Mutant: remove that line, and both heads carry
    /// <c>Server: Kestrel</c>.
    /// </summary>
    [Fact]
    public async Task Kestrels_own_400_and_431_carry_no_Server_header()
    {
        await using var h = await StartAsync();
        var baseAddress = h.Client.BaseAddress!;

        var badHost = await HeaderExpectations.RawHeadAsync(baseAddress,
            Encoding.ASCII.GetBytes("GET / HTTP/1.1\r\nHost: a b\r\n\r\n"));
        var bigHeader = await HeaderExpectations.RawHeadAsync(baseAddress,
            Encoding.ASCII.GetBytes($"GET / HTTP/1.1\r\nHost: localhost\r\nX-Big: {new string('a', 40 * 1024)}\r\n\r\n"));

        Assert.StartsWith("HTTP/1.1 400", badHost);
        Assert.StartsWith("HTTP/1.1 431", bigHeader);
        Assert.Null(HeaderExpectations.RawHeader(badHost, "Server"));
        Assert.Null(HeaderExpectations.RawHeader(bigHeader, "Server"));
    }

    /// <summary>
    /// The policy follows the middleware's argument, so a test (or a scratch host) can serve a
    /// different one; the image never passes it.
    /// </summary>
    [Fact]
    public async Task The_policy_is_switchable_for_tests_only()
    {
        var builder = Microsoft.AspNetCore.Builder.WebApplication.CreateBuilder(new Microsoft.AspNetCore.Builder.WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.ConfigureKestrel(KestrelLimits.Apply);
        await using var app = builder.Build();
        app.Urls.Add("http://127.0.0.1:0");
        app.UseFireworksResponseHeaders("script-src 'none'");
        app.MapGet("/", () => "ok");
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };

        using var response = await client.GetAsync("/");

        Assert.Equal("script-src 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
    }

    /// <summary>
    /// Toad, Phase 7 C3 (mutant A6): the site-wide set overwrites (Boo §4). An endpoint, a library
    /// or a future middleware that writes a weaker value first never wins. With <c>TryAdd</c> in
    /// place of the overwrite, every pre-set header below survives and this test fails; no other
    /// test sees it, because nothing in the app writes these headers today.
    /// </summary>
    [Fact]
    public async Task The_site_wide_set_overwrites_a_weaker_value_written_earlier()
    {
        var builder = Microsoft.AspNetCore.Builder.WebApplication.CreateBuilder(new Microsoft.AspNetCore.Builder.WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.ConfigureKestrel(KestrelLimits.Apply);
        await using var app = builder.Build();
        app.Urls.Add("http://127.0.0.1:0");
        app.UseFireworksResponseHeaders();
        app.MapGet("/", (Microsoft.AspNetCore.Http.HttpResponse response) =>
        {
            response.Headers["Content-Security-Policy"] = "script-src *";
            response.Headers["X-Content-Type-Options"] = "sniff";
            response.Headers["Referrer-Policy"] = "unsafe-url";
            response.Headers["X-Frame-Options"] = "SAMEORIGIN";
            response.Headers["Cross-Origin-Opener-Policy"] = "unsafe-none";
            response.Headers["Cross-Origin-Resource-Policy"] = "cross-origin";
            response.Headers["Permissions-Policy"] = "camera=*";
            return "ok";
        });
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };

        using var got = await client.GetAsync("/");

        Assert.Empty(HeaderExpectations.Problems(got));
    }
}

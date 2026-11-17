using System.Net;
using Fireworks.Api.Services.Identity;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Creations;
using Fireworks.Api.Tests.Support;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Tests.Auth;

/// <summary>
/// Boo A13: the CSRF guard on every unsafe method and every path, with a valid signed-in jar, so a
/// 403 here is the guard and not a missing session. Negative control: the mutant set
/// <c>phase8-auth</c> (tools/mutants) removes the guard's registration; the hostile cases then
/// reach the service.
/// </summary>
public sealed class CrossOriginWriteGuardTests
{
    public static TheoryData<string, string, string> Hostile()
    {
        var data = new TheoryData<string, string, string>();
        foreach (var target in new[] { "create", "put", "delete", "remix", "logout" })
        {
            foreach (var (header, value) in new[]
                     {
                         ("Sec-Fetch-Site", "cross-site"), ("Sec-Fetch-Site", "same-site"), ("Sec-Fetch-Site", "none"),
                         ("Origin", "http://evil.example"), ("Origin", "null")
                     })
            {
                data.Add(target, header, value);
            }
        }

        return data;
    }

    private static HttpRequestMessage Build(string target, string code)
    {
        var doc = $"{{\"document\":{CreationEndpointTests.Peony}}}";
        var (method, path, body) = target switch
        {
            "create" => (HttpMethod.Post, "/api/creations", $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}"),
            "put" => (HttpMethod.Put, $"/api/creations/{code}", doc),
            "delete" => (HttpMethod.Delete, $"/api/creations/{code}", (string?)null),
            "remix" => (HttpMethod.Post, $"/api/creations/{code}/remix", doc),
            _ => (HttpMethod.Post, "/api/auth/logout", null)
        };
        var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        }

        return request;
    }

    [Theory]
    [MemberData(nameof(Hostile))]
    public async Task A_hostile_signed_in_request_is_403_and_changes_nothing(string target, string header, string value)
    {
        await using var h = await FireworksApiHarness.StartAsync(signedIn: true, configuration: FireworksApiHarness.UnthrottledRateLimits);
        var code = await Hardening.ResponseHeaderTests.CreateAsync(h.Client);
        var tag = await CreationApiHarness.CurrentTagAsync(h.Client, $"/api/creations/{code}");
        await using var before = h.NewContext();
        var state = await before.Creations.AsNoTracking().Select(c => new { c.ShareCode, c.UpdatedAt }).ToListAsync();

        using var request = Build(target, code);
        request.Headers.TryAddWithoutValidation(header, value);
        request.Headers.TryAddWithoutValidation("If-Match", tag);
        using var response = await h.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(CrossOriginWriteGuard.Message, System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("message").GetString());
        Assert.Equal("no-store", Hardening.HeaderExpectations.CacheControl(response));
        await using var after = h.NewContext();
        Assert.Equal(state.Select(s => (s.ShareCode, s.UpdatedAt)), await after.Creations.AsNoTracking().Select(c => new ValueTuple<string, DateTimeOffset>(c.ShareCode, c.UpdatedAt)).ToListAsync());
        // Logout was refused, so the session is still there.
        using var me = System.Text.Json.JsonDocument.Parse(await h.Client.GetStringAsync("/api/me"));
        Assert.True(me.RootElement.GetProperty("isAuthenticated").GetBoolean());
    }

    public static TheoryData<string, bool, bool> Friendly()
    {
        var data = new TheoryData<string, bool, bool>();
        foreach (var target in new[] { "create", "put", "delete", "remix", "logout" })
        {
            data.Add(target, true, true);  // same-origin + matching Origin (a browser on our own page)
            data.Add(target, false, true); // matching Origin only (an older browser)
            data.Add(target, false, false); // neither (curl, a script): not a CSRF vector
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Friendly))]
    public async Task Same_origin_or_header_less_requests_reach_the_next_gate(string target, bool fetchSite, bool origin)
    {
        await using var h = await FireworksApiHarness.StartAsync(signedIn: true, configuration: FireworksApiHarness.UnthrottledRateLimits);
        var code = await Hardening.ResponseHeaderTests.CreateAsync(h.Client);
        using var request = Build(target, code);
        if (fetchSite) request.Headers.Add("Sec-Fetch-Site", "same-origin");
        if (origin) request.Headers.Add("Origin", h.BaseAddress.GetLeftPart(UriPartial.Authority));
        request.Headers.TryAddWithoutValidation("If-Match", await CreationApiHarness.CurrentTagAsync(h.Client, $"/api/creations/{code}"));

        using var response = await h.Client.SendAsync(request);

        Assert.True(response.IsSuccessStatusCode, $"{target}: {(int)response.StatusCode}");
    }

    [Fact]
    public async Task The_guard_covers_every_path_not_only_api()
    {
        await using var h = await FireworksApiHarness.StartAsync(signedIn: true);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/show");
        request.Headers.Add("Sec-Fetch-Site", "cross-site");
        using var response = await h.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Safe_methods_pass_whatever_their_headers()
    {
        await using var h = await FireworksApiHarness.StartAsync(signedIn: true);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/me");
        request.Headers.Add("Sec-Fetch-Site", "cross-site");
        request.Headers.Add("Origin", "http://evil.example");
        using var response = await h.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("GET", null, null, true)]
    [InlineData("HEAD", "cross-site", null, true)]
    [InlineData("OPTIONS", "cross-site", null, true)]
    [InlineData("TRACE", "cross-site", null, true)]
    [InlineData("POST", "same-origin", null, true)]
    [InlineData("POST", "same-origin", "http://evil.example", true)] // Sec-Fetch-Site decides when present
    [InlineData("POST", "SAME-ORIGIN", null, false)]
    [InlineData("POST", "cross-site", "http://app.example", false)]
    [InlineData("PATCH", null, "http://app.example", true)]
    [InlineData("PATCH", null, "HTTP://APP.EXAMPLE", true)]
    [InlineData("PATCH", null, "https://app.example", false)]
    [InlineData("PATCH", null, "http://app.example:81", false)]
    [InlineData("DELETE", null, "null", false)]
    [InlineData("PUT", null, null, true)]
    public void IsAllowed_follows_the_A13_rules(string method, string? fetchSite, string? origin, bool allowed)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("app.example");
        if (fetchSite is not null) context.Request.Headers["Sec-Fetch-Site"] = fetchSite;
        if (origin is not null) context.Request.Headers.Origin = origin;
        Assert.Equal(allowed, CrossOriginWriteGuard.IsAllowed(context.Request));
    }

    [Fact]
    public void Two_Sec_Fetch_Site_values_are_refused()
    {
        var context = new DefaultHttpContext();
        context.Request.Method = "POST";
        context.Request.Headers["Sec-Fetch-Site"] = new Microsoft.Extensions.Primitives.StringValues(["same-origin", "cross-site"]);
        Assert.False(CrossOriginWriteGuard.IsAllowed(context.Request));
    }
}

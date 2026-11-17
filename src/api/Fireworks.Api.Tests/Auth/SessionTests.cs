using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Fireworks.Api.Services.Identity;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Creations;
using Fireworks.Api.Tests.Support;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Fireworks.Api.Tests.Auth;

/// <summary>A clock tests can move (the cookie handler reads <see cref="TimeProvider"/> from DI).</summary>
internal sealed class ManualTimeProvider : TimeProvider
{
    public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>The session after sign-in (Boo A10 sliding, A11, A12, A18, A42).</summary>
public sealed class SessionTests
{
    private static string Shell => $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}";

    private static async Task<JsonElement> MeAsync(HttpClient client)
    {
        using var doc = JsonDocument.Parse(await client.GetStringAsync("/api/me"));
        return doc.RootElement.Clone();
    }

    /// <summary>Boo A42: replaces the test-mode banner. canWrite == isAuthenticated on every path.</summary>
    private static void AssertInvariant(JsonElement me) =>
        Assert.Equal(me.GetProperty("isAuthenticated").GetBoolean(), me.GetProperty("canWrite").GetBoolean());

    [Fact]
    public async Task Anonymous_and_signed_in_api_me_hold_the_canWrite_invariant_with_the_exact_keys()
    {
        await using var h = await FireworksApiHarness.StartAsync();
        var anonymous = await MeAsync(h.AnonymousClient);
        Assert.Equal("""{"userId":null,"displayName":null,"isAuthenticated":false,"canWrite":false,"signedInWith":null}""", anonymous.GetRawText());
        AssertInvariant(anonymous);

        var alice = await h.SignInAsync(TestIdentity.Alice);
        var me = await MeAsync(alice.Http);
        Assert.Equal(["canWrite", "displayName", "isAuthenticated", "signedInWith", "userId"],
            me.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.True(me.GetProperty("isAuthenticated").GetBoolean());
        Assert.Equal(alice.UserId, me.GetProperty("userId").GetGuid());
        Assert.Equal("Stub " + TestIdentity.Alice, me.GetProperty("displayName").GetString());
        Assert.Equal("google", me.GetProperty("signedInWith").GetString());
        AssertInvariant(me);
    }

    [Fact]
    public async Task A_cookie_that_outlives_its_row_is_anonymous_on_the_same_request_and_deleted()
    {
        // Boo A12 (probe P5): not a MeService 404 and not an FK-violation 500 on save.
        await using var h = await FireworksApiHarness.StartAsync();
        var alice = await h.SignInAsync(TestIdentity.Alice);
        var jar = alice.Cookies.ToDictionary(kv => kv.Key, kv => kv.Value);
        await using (var db = h.NewContext())
        {
            await db.Users.ExecuteDeleteAsync();
        }

        using var meResponse = await alice.Http.GetAsync("/api/me");
        var deleting = alice.SetCookies.Last(c => c.Name == "__Host-fw.session");
        Assert.True(deleting.Expires < DateTimeOffset.UtcNow);
        using var me = JsonDocument.Parse(await meResponse.Content.ReadAsStringAsync());
        Assert.False(me.RootElement.GetProperty("isAuthenticated").GetBoolean());
        AssertInvariant(me.RootElement);

        foreach (var (name, value) in jar) alice.Put(name, value);
        using var post = await CreationApiHarness.SendJsonAsync(alice.Http, HttpMethod.Post, "/api/creations", Shell);
        Assert.Equal(HttpStatusCode.Unauthorized, post.StatusCode);
    }

    [Theory]
    [InlineData("x")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("")]
    public async Task A_ticket_with_an_unparseable_id_is_anonymous_everywhere_at_once(string id)
    {
        // Boo A18: the policy and ICurrentUser share one predicate, so this is 401, never the service's 403.
        await using var h = await FireworksApiHarness.StartAsync();
        var format = h.App.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(IdentityRegistration.CookieScheme).TicketDataFormat;
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, id)], IdentityRegistration.CookieScheme));
        var session = h.NewSession();
        session.Put("__Host-fw.session", format.Protect(new AuthenticationTicket(principal, IdentityRegistration.CookieScheme)));

        using var post = await CreationApiHarness.SendJsonAsync(session.Http, HttpMethod.Post, "/api/creations", Shell);
        Assert.Equal(HttpStatusCode.Unauthorized, post.StatusCode);

        session.Put("__Host-fw.session", format.Protect(new AuthenticationTicket(principal, IdentityRegistration.CookieScheme)));
        var me = await MeAsync(session.Http);
        Assert.False(me.GetProperty("isAuthenticated").GetBoolean());
        AssertInvariant(me);
    }

    [Fact]
    public async Task Logout_is_204_with_a_matching_deleting_cookie_and_anonymous_logout_is_204_too()
    {
        // Boo A11.
        await using var h = await FireworksApiHarness.StartAsync();
        var alice = await h.SignInAsync(TestIdentity.Alice);
        var stolen = alice.Cookies.ToDictionary(kv => kv.Key, kv => kv.Value);

        using var logout = await alice.Http.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        var deleting = alice.SetCookies.Last(c => c.Name == "__Host-fw.session");
        Assert.True(deleting.Expires < DateTimeOffset.UtcNow);
        Assert.True(deleting.Secure);
        Assert.Equal("/", deleting.Path.ToString());
        Assert.Contains("no-store", logout.Headers.CacheControl?.ToString() ?? "");
        Assert.False((await MeAsync(alice.Http)).GetProperty("isAuthenticated").GetBoolean());

        // The stated residual (design §3.8): a copied cookie stays valid until it expires. Pinned so
        // a future session_epoch flips this on purpose.
        var thief = h.NewSession();
        foreach (var (name, value) in stolen) thief.Put(name, value);
        Assert.True((await MeAsync(thief.Http)).GetProperty("isAuthenticated").GetBoolean());

        using var anonymous = await h.AnonymousClient.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.NoContent, anonymous.StatusCode);
        using var get = await h.AnonymousClient.GetAsync("/api/auth/logout");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task The_session_slides_past_half_life_and_ends_after_30_idle_days()
    {
        // Boo A10: renewed only past half-life (the framework's rule); 31 days idle is anonymous.
        var clock = new ManualTimeProvider();
        await using var h = await FireworksApiHarness.StartAsync(configureServices: s => s.AddSingleton<TimeProvider>(clock));
        var alice = await h.SignInAsync(TestIdentity.Alice);
        int Issued() => alice.SetCookies.Count(c => c.Name == "__Host-fw.session" && c.Expires > clock.Now);

        var afterSignIn = Issued();
        clock.Now = clock.Now.AddDays(14);
        await MeAsync(alice.Http);
        Assert.Equal(afterSignIn, Issued());

        clock.Now = clock.Now.AddDays(2); // day 16
        Assert.True((await MeAsync(alice.Http)).GetProperty("isAuthenticated").GetBoolean());
        Assert.Equal(afterSignIn + 1, Issued());

        clock.Now = clock.Now.AddDays(31);
        Assert.False((await MeAsync(alice.Http)).GetProperty("isAuthenticated").GetBoolean());
    }
}

/// <summary>Boo A16, A19, A20, A21: the fallback policy and the pinned anonymous set.</summary>
public sealed class AuthorizationTests
{
    private const string Code = "{shareCode:" + Fireworks.Api.Services.Creations.ShareCodeRouteConstraint.Name + "}";

    private static readonly string[] AnonymousEndpoints =
    [
        "* /api/{**rest}",
        "* /health/live",
        "* /health/ready",
        "GET api/auth/login/{provider}",
        "GET api/client-config",
        "GET api/creations/" + Code,
        "GET api/me",
        "GET,HEAD /c/{**rest}",
        "GET,HEAD /s/{**rest}",
        "GET,HEAD {*path:nonfile}",
        "POST api/auth/logout"
    ];

    private static readonly string[] SafeMethodEndpoints =
    [
        "* /api/{**rest}", "* /health/live", "* /health/ready", "GET api/auth/login/{provider}", "GET api/client-config",
        "GET api/creations/" + Code, "GET api/me", "GET api/me/creations", "GET,HEAD /c/{**rest}", "GET,HEAD /s/{**rest}", "GET,HEAD {*path:nonfile}"
    ];

    private static IEnumerable<(string Name, Microsoft.AspNetCore.Http.Endpoint Endpoint)> Endpoints(FireworksApiHarness h) =>
        h.App.Services.GetRequiredService<Microsoft.AspNetCore.Routing.EndpointDataSource>().Endpoints
            .OfType<Microsoft.AspNetCore.Routing.RouteEndpoint>()
            .Select(e => ((e.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>() is { } m ? string.Join(",", m.HttpMethods) : "*")
                          + " " + e.RoutePattern.RawText, (Microsoft.AspNetCore.Http.Endpoint)e));

    [Theory]
    [InlineData("Testing")]
    [InlineData("Development")]
    public async Task The_anonymous_endpoint_set_is_exactly_the_pinned_list(string environment)
    {
        // Asks the defining artifact (koopa-derive-sets...). A new endpoint is authenticated unless
        // someone edits this list. Negative control: [AllowAnonymous] on Update fails it.
        await using var h = await FireworksApiHarness.StartAsync(environmentName: environment);
        var anonymous = Endpoints(h)
            .Where(e => e.Endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Authorization.IAllowAnonymous>() is not null)
            .Select(e => e.Name).Order(StringComparer.Ordinal);
        Assert.Equal(AnonymousEndpoints, anonymous);
    }

    [Fact]
    public async Task No_GET_or_HEAD_endpoint_outside_the_known_set_exists()
    {
        // Boo A16: Lax sends the cookie on cross-site top-level GETs, so no GET may change state.
        await using var h = await FireworksApiHarness.StartAsync();
        var safe = Endpoints(h).Where(e => e.Name.StartsWith("*", StringComparison.Ordinal) || e.Name.StartsWith("GET", StringComparison.Ordinal))
            .Select(e => e.Name).Order(StringComparer.Ordinal);
        Assert.Equal(SafeMethodEndpoints, safe);
    }

    [Fact]
    public async Task Anonymous_writes_and_the_list_are_401_with_no_Location_no_cookie_no_store_and_no_stub_call()
    {
        await using var h = await FireworksApiHarness.StartAsync();
        var shell = $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}";
        var responses = new[]
        {
            await CreationApiHarness.SendJsonAsync(h.AnonymousClient, HttpMethod.Post, "/api/creations", shell),
            await CreationApiHarness.SendJsonAsync(h.AnonymousClient, HttpMethod.Put, "/api/creations/abcdefgh", shell, "\"x\""),
            await h.AnonymousClient.DeleteAsync("/api/creations/abcdefgh"),
            await CreationApiHarness.SendJsonAsync(h.AnonymousClient, HttpMethod.Post, "/api/creations/abcdefgh/remix", shell),
            await h.AnonymousClient.GetAsync("/api/me/creations")
        };

        foreach (var response in responses)
        {
            using (response)
            {
                Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
                Assert.Null(response.Headers.Location);
                Assert.False(response.Headers.Contains("Set-Cookie"));
                Assert.Equal("no-store", Hardening.HeaderExpectations.CacheControl(response));
            }
        }

        Assert.Empty(h.Stub.AuthorizeQueries);
    }

    [Theory]
    [InlineData("Testing")]
    [InlineData("Development")]
    public async Task A_cross_origin_preflight_gets_no_CORS_headers(string environment)
    {
        // Boo A14: the Development FrontendDev policy is gone.
        await using var h = await FireworksApiHarness.StartAsync(environmentName: environment);
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/creations");
        request.Headers.Add("Origin", "http://evil.example");
        request.Headers.Add("Access-Control-Request-Method", "PUT");
        using var response = await h.AnonymousClient.SendAsync(request);
        Assert.DoesNotContain(response.Headers, header => header.Key.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase));
    }
}

using System.Net;
using System.Security.Claims;
using Fireworks.Api.Services.Identity;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Support;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Fireworks.Api.Tests.Auth;

/// <summary>
/// The Google sign-in round trip through the C# stub (Boo A1–A5, A7, A9, A10, A38), on the
/// harness in <c>Testing</c>, with the manual cookie jar so the Production cookie flags are what
/// is tested. Every success here passed the stub's PKCE S256, single-use code, exact redirect URI
/// and client checks.
/// </summary>
public sealed class SignInFlowTests
{
    private static SetCookieHeaderValue? Last(SessionClient session, Func<string, bool> name) =>
        session.SetCookies.LastOrDefault(c => name(c.Name.ToString()));

    [Fact]
    public async Task Sign_in_asks_for_openid_profile_with_S256_and_lands_on_returnUrl_with_one_session_cookie()
    {
        await using var h = await FireworksApiHarness.StartAsync();
        var session = h.NewSession();

        var result = await session.SignInAsync(TestIdentity.Alice, "/c/abcdefgh?x=1");

        Assert.Equal(HttpStatusCode.Found, result.Callback.StatusCode);
        Assert.Equal("/c/abcdefgh?x=1", result.Location);
        var authorize = Assert.Single(h.Stub.AuthorizeQueries);
        Assert.Equal("openid profile", authorize["scope"]);
        Assert.Equal("S256", authorize["code_challenge_method"]);
        Assert.NotEmpty(authorize["code_challenge"]);
        Assert.Equal(h.BaseAddress + "api/auth/callback/google", authorize["redirect_uri"]);
        Assert.Equal(1, h.Stub.TokenCalls);
        Assert.Empty(h.Stub.TokenFailures);
        Assert.Equal("__Host-fw.session", session.SessionCookieName);
        Assert.NotEqual(Guid.Empty, session.UserId);
    }

    [Fact]
    public async Task The_stub_itself_rejects_a_reused_code_a_wrong_verifier_and_a_wrong_redirect_uri()
    {
        // Boo A7: the checks that make a green sign-in mean something.
        await using var stub = await StubOAuthProvider.StartAsync();
        using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false });
        const string verifier = "a-verifier-of-sufficient-length-for-pkce-0123456789";
        var challenge = Microsoft.AspNetCore.WebUtilities.Base64UrlTextEncoder.Encode(
            System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(verifier)));

        async Task<string> CodeAsync()
        {
            using var r = await http.GetAsync($"{stub.BaseUrl}/authorize?response_type=code&client_id={GoogleProviderSettings.StubClientId}" +
                                              $"&redirect_uri=http%3A%2F%2Fapp%2Fcb&code_challenge={challenge}&code_challenge_method=S256&state=s");
            return Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(r.Headers.Location!.Query)["code"].ToString();
        }

        Task<HttpResponseMessage> TokenAsync(string code, string v, string redirect = "http://app/cb") =>
            http.PostAsync($"{stub.BaseUrl}/token", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code", ["code"] = code, ["redirect_uri"] = redirect, ["code_verifier"] = v,
                ["client_id"] = GoogleProviderSettings.StubClientId, ["client_secret"] = GoogleProviderSettings.StubClientSecret
            }));

        var code = await CodeAsync();
        Assert.Equal(HttpStatusCode.OK, (await TokenAsync(code, verifier)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await TokenAsync(code, verifier)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await TokenAsync(await CodeAsync(), verifier + "x")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await TokenAsync(await CodeAsync(), verifier, "http://app/other")).StatusCode);
        Assert.Equal(["code unknown or reused", "pkce", "redirect_uri"], stub.TokenFailures);
        using var noPkce = await http.GetAsync($"{stub.BaseUrl}/authorize?response_type=code&client_id={GoogleProviderSettings.StubClientId}&redirect_uri=http%3A%2F%2Fapp%2Fcb&state=s");
        Assert.Equal(HttpStatusCode.BadRequest, noPkce.StatusCode);
    }

    public static TheoryData<string> BadCallbacks() => new() { "flipped-state", "no-correlation", "foreign-correlation", "replay" };

    /// <summary>Boo A2: every bad state or correlation lands on error=failed with no session and no back-channel call.</summary>
    [Theory]
    [MemberData(nameof(BadCallbacks))]
    public async Task A_bad_state_or_correlation_fails_with_no_session_and_no_token_call(string variant)
    {
        await using var h = await FireworksApiHarness.StartAsync();
        var session = h.NewSession();
        SignInResult result;
        switch (variant)
        {
            case "flipped-state":
                result = await session.SignInAsync(TestIdentity.Alice, "/show", editCallbackUrl: url =>
                {
                    var i = url.IndexOf("state=", StringComparison.Ordinal) + "state=".Length + 10;
                    return url[..i] + (url[i] == 'A' ? 'B' : 'A') + url[(i + 1)..];
                });
                break;
            case "no-correlation":
                result = await session.SignInAsync(TestIdentity.Alice, "/show", beforeCallback: s =>
                {
                    foreach (var (name, _) in s.CorrelationCookies) s.Remove(name);
                });
                break;
            case "foreign-correlation":
                var other = h.NewSession();
                using (await other.SendAsync(new HttpRequestMessage(HttpMethod.Get, "/api/auth/login/google"))) { }
                result = await session.SignInAsync(TestIdentity.Alice, "/show", beforeCallback: s =>
                {
                    foreach (var (name, _) in s.CorrelationCookies) s.Remove(name);
                    foreach (var (name, value) in other.CorrelationCookies) s.Put(name, value);
                });
                break;
            default:
                var first = await session.SignInAsync(TestIdentity.Alice, "/show");
                Assert.Equal("/show", first.Location);
                var replayer = h.NewSession();
                result = new SignInResult(await replayer.SendAsync(new HttpRequestMessage(HttpMethod.Get, first.CallbackUrl)), first.Login, first.CallbackUrl);
                session = replayer;
                break;
        }

        var expectedTokenCalls = variant == "replay" ? 1 : 0;
        Assert.Equal(HttpStatusCode.Found, result.Callback.StatusCode);
        Assert.Equal(variant == "flipped-state" ? "/signin?error=failed" : "/signin?error=failed&returnUrl=%2Fshow", result.Location);
        Assert.Null(session.SessionCookieName);
        Assert.Equal(expectedTokenCalls, h.Stub.TokenCalls);
        Assert.Contains("no-store", result.Callback.Headers.CacheControl?.ToString() ?? "");
    }

    [Theory]
    [InlineData("access_denied", "cancelled")]
    [InlineData("server_error", "failed")]
    [InlineData("invalid_scope", "failed")]
    public async Task A_provider_error_redirects_to_signin_with_cancelled_or_failed_and_reflects_nothing(string error, string expected)
    {
        // Boo A4 + Rosalina §9.4: access_denied is "cancelled", anything else "failed"; the stub
        // also sends error_description=<script>x</script> and an error_uri, which must not appear.
        await using var h = await FireworksApiHarness.StartAsync();
        h.Stub.AuthorizeError = error;
        var session = h.NewSession();

        var result = await session.SignInAsync(TestIdentity.Alice, "/c/abcdefgh");

        Assert.Equal(HttpStatusCode.Found, result.Callback.StatusCode);
        Assert.Equal($"/signin?error={expected}&returnUrl=%2Fc%2Fabcdefgh", result.Location);
        Assert.Null(session.SessionCookieName);
        Assert.Equal(0, h.Stub.TokenCalls);
        Assert.DoesNotContain("script", await result.Callback.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_provider_with_no_subject_is_failed_and_provisions_nobody()
    {
        await using var h = await FireworksApiHarness.StartAsync();
        h.Stub.OmitSubject = true;
        var session = h.NewSession();

        var result = await session.SignInAsync(TestIdentity.Alice);

        // A failure thrown while creating the ticket carries no properties, so returnUrl is omitted.
        Assert.Equal("/signin?error=failed", result.Location);
        Assert.Null(session.SessionCookieName);
        await using var db = h.NewContext();
        Assert.Empty(await db.Users.ToListAsync());
    }

    public static TheoryData<string, string> ReturnUrls() => new()
    {
        { "//evil.example", "/" },
        { "/\\evil.example", "/" },
        { "/\t/evil.example", "/" },
        { "/\n/evil.example", "/" },
        { "%2F%2Fevil.example", "/" },
        { "/%2Fevil.example", "/" },
        { "/%5Cevil.example", "/" },
        { "https://evil.example", "/" },
        { "javascript:alert(1)", "/" },
        { " /x", "/" },
        { "/api/auth/logout", "/" },
        { "/API/auth/login/google", "/" },
        { "/%61pi/auth/logout", "/" },
        { "/" + new string('a', 3000), "/" },
        { "", "/" },
        { "/c/abcdefgh?x=1", "/c/abcdefgh?x=1" },
        { "/show", "/show" },
        { "/mine?page=2", "/mine?page=2" },
        { "/s/abcdefgh#t", "/s/abcdefgh#t" }
    };

    /// <summary>Boo A5, through the whole stub round trip: the final Location.</summary>
    [Theory]
    [MemberData(nameof(ReturnUrls))]
    public async Task ReturnUrl_survives_only_when_it_is_a_safe_internal_path(string returnUrl, string expected)
    {
        await using var h = await FireworksApiHarness.StartAsync();
        var result = await h.NewSession().SignInAsync(TestIdentity.Alice, returnUrl);
        Assert.Equal(expected, result.Location);
    }

    [Theory]
    [InlineData("Google")]
    [InlineData("github")]
    [InlineData("x")]
    [InlineData("google ")]
    public async Task Only_the_exact_provider_id_challenges(string provider)
    {
        // Boo A9 / probe P8: an unregistered scheme would be a 500; the allowlist answers 404 first.
        await using var h = await FireworksApiHarness.StartAsync();
        using var response = await h.AnonymousClient.GetAsync("/api/auth/login/" + Uri.EscapeDataString(provider));

        using var catchAll = await h.AnonymousClient.GetAsync("/api/auth/nope");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("", await response.Content.ReadAsStringAsync());
        Assert.Equal(catchAll.Content.Headers.ContentType, response.Content.Headers.ContentType);
        Assert.False(response.Headers.Contains("Set-Cookie"));
        Assert.Empty(h.Stub.AuthorizeQueries);
    }

    [Fact]
    public async Task With_no_Google_client_the_login_route_is_404()
    {
        await using var h = await FireworksApiHarness.StartAsync(withGoogle: false);
        using var response = await h.AnonymousClient.GetAsync("/api/auth/login/google");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("Testing", true)]
    [InlineData("Development", false)]
    public async Task The_correlation_cookie_is_HttpOnly_Lax_and_Secure_outside_Development(string environment, bool secure)
    {
        // Boo A3 (probe P6: the framework default is SameSite=None; Secure).
        await using var h = await FireworksApiHarness.StartAsync(environmentName: environment);
        var session = h.NewSession();
        using var login = await session.SendAsync(new HttpRequestMessage(HttpMethod.Get, "/api/auth/login/google"));

        var correlation = Assert.Single(session.SetCookies, c => c.Name.ToString().StartsWith(".AspNetCore.Correlation.", StringComparison.Ordinal));
        Assert.True(correlation.HttpOnly);
        Assert.Equal(Microsoft.Net.Http.Headers.SameSiteMode.Lax, correlation.SameSite);
        Assert.Equal(secure, correlation.Secure);
        Assert.Contains("no-store", login.Headers.CacheControl?.ToString() ?? "");
    }

    [Fact]
    public async Task The_session_cookie_has_the_A10_attributes_and_a_one_claim_ticket()
    {
        await using var h = await FireworksApiHarness.StartAsync();
        var session = h.NewSession();
        var before = DateTimeOffset.UtcNow;
        await session.SignInAsync(TestIdentity.Alice);

        var cookie = Last(session, n => n == "__Host-fw.session")!;
        Assert.True(cookie.HttpOnly);
        Assert.True(cookie.Secure);
        Assert.Equal(Microsoft.Net.Http.Headers.SameSiteMode.Lax, cookie.SameSite);
        Assert.Equal("/", cookie.Path.ToString());
        Assert.Null(cookie.Domain.Value);
        Assert.InRange(cookie.Expires!.Value, before.AddDays(30).AddMinutes(-1), DateTimeOffset.UtcNow.AddDays(30).AddMinutes(1));

        var format = h.App.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(IdentityRegistration.CookieScheme).TicketDataFormat;
        var ticket = format.Unprotect(cookie.Value.ToString())!;
        var claim = Assert.Single(ticket.Principal.Claims);
        Assert.Equal((ClaimTypes.NameIdentifier, session.UserId.ToString()), (claim.Type, claim.Value));
        Assert.DoesNotContain(ticket.Properties.Items.Keys, k => k.StartsWith(".Token.", StringComparison.Ordinal));
        Assert.True(ticket.Properties.IsPersistent);
    }

    [Fact]
    public async Task Development_uses_fw_session_without_Secure()
    {
        await using var h = await FireworksApiHarness.StartAsync(environmentName: "Development");
        var session = h.NewSession();
        await session.SignInAsync(TestIdentity.Alice);
        var cookie = Last(session, n => n.EndsWith("fw.session", StringComparison.Ordinal))!;
        Assert.Equal("fw.session", cookie.Name.ToString());
        Assert.False(cookie.Secure);
        Assert.True(cookie.HttpOnly);
    }

    [Fact]
    public async Task Provisioning_stores_only_provider_subject_and_cleaned_name_and_signs_the_same_row_in_again()
    {
        // Boo A38: the stub's userinfo also returns email, picture, locale, given and family name.
        await using var h = await FireworksApiHarness.StartAsync();
        h.Stub.SetName(TestIdentity.Alice, "  Alice\u0007 Liddell  ");
        var first = h.NewSession();
        await first.SignInAsync(TestIdentity.Alice);

        h.Stub.SetName(TestIdentity.Alice, "Alice L.");
        var second = h.NewSession();
        await second.SignInAsync(TestIdentity.Alice);

        Assert.Equal(first.UserId, second.UserId);
        await using var db = h.NewContext();
        var row = await db.Users.SingleAsync();
        Assert.Equal(("google", TestIdentity.Alice, "Alice L."), (row.ExternalProvider, row.ExternalSubject, row.DisplayName));
        Assert.Equal(7, Guid.Parse(row.Id.ToString()).Version);

        var columns = await db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('users')").ToListAsync();
        Assert.Equal(["created_at", "display_name", "external_provider", "external_subject", "id", "updated_at"], columns.Order(StringComparer.Ordinal));
        using var me = await second.Http.GetAsync("/api/me");
        var body = await me.Content.ReadAsStringAsync();
        Assert.DoesNotContain(StubOAuthProvider.EmailFor(TestIdentity.Alice), body);
        Assert.DoesNotContain(TestIdentity.Alice, body);
        Assert.Contains("\"signedInWith\":\"google\"", body);
    }

    [Theory]
    [InlineData(null, "User")]
    [InlineData("   ", "User")]
    [InlineData("\u0001\u0002", "User")]
    [InlineData(" Ann ", "Ann")]
    public void Display_names_run_the_schema_name_pipeline_and_blank_becomes_User(string? raw, string expected) =>
        Assert.Equal(expected, UserProvisioning.CleanDisplayName(raw));

    [Fact]
    public void A_long_display_name_is_cut_at_80_code_points()
    {
        var name = string.Concat(Enumerable.Repeat("\U0001F386", 100));
        var cleaned = UserProvisioning.CleanDisplayName(name);
        Assert.Equal(80, cleaned.EnumerateRunes().Count());
    }

    [Fact]
    public async Task Two_first_sign_ins_at_once_resolve_to_one_row()
    {
        await using var h = await FireworksApiHarness.StartAsync();
        var sessions = Enumerable.Range(0, 6).Select(_ => h.NewSession()).ToList();
        await Task.WhenAll(sessions.Select(s => s.SignInAsync(TestIdentity.Bob)));
        Assert.Single(sessions.Select(s => s.UserId).Distinct());
        await using var db = h.NewContext();
        Assert.Equal(1, await db.Users.CountAsync());
    }
}

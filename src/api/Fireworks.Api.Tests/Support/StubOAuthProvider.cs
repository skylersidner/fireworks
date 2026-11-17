using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Fireworks.Api.Services.Identity;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Logging;

namespace Fireworks.Api.Tests.Support;

/// <summary>
/// A Google-shaped OAuth server for in-process tests (design §1.4, Boo A7). A test double with real
/// checks, so a green sign-in proves them end to end:
/// <list type="bullet">
/// <item>binds <c>127.0.0.1:0</c> only;</item>
/// <item><c>GET /authorize</c> requires <c>response_type=code</c>, the stub <c>client_id</c>, a
/// <c>redirect_uri</c>, and <c>code_challenge_method=S256</c> with a challenge; it records every query;
/// the subject is <c>login_hint</c> (else <see cref="DefaultSubject"/>);</item>
/// <item><c>POST /token</c> requires the exact client id and secret, the authorize step's exact
/// <c>redirect_uri</c>, a single-use code, and a <c>code_verifier</c> whose S256 equals the
/// challenge; every call is counted (<see cref="TokenCalls"/>), failed ones included;</item>
/// <item><c>GET /userinfo</c> (v3 shape, probe P7) returns <c>sub</c>, <c>name</c> and, to prove they
/// are dropped (Boo A38), <c>email</c>, <c>picture</c> and <c>locale</c>.</item>
/// </list>
/// The server-stub contract (also what <c>tools/fake-oauth/server.mjs</c> implements):
/// <see cref="Configuration"/> sets <c>Auth:Providers:Google:{ClientId, ClientSecret,
/// AuthorizationEndpoint, TokenEndpoint, UserInformationEndpoint}</c> to the stub pair and
/// <c>{base}/authorize</c>, <c>{base}/token</c>, <c>{base}/userinfo</c>.
/// </summary>
internal sealed class StubOAuthProvider : IAsyncDisposable
{
    public const string DefaultSubject = "stub-user";

    private readonly ConcurrentDictionary<string, IssuedCode> codes = new();
    private readonly ConcurrentDictionary<string, string> accessTokens = new();
    private readonly ConcurrentDictionary<string, string> names = new();
    private readonly ConcurrentQueue<IReadOnlyDictionary<string, string>> authorizeQueries = new();
    private readonly ConcurrentQueue<string> tokenFailures = new();
    private readonly ConcurrentQueue<string> issuedTokens = new();
    private WebApplication app = null!;
    private int tokenCalls;
    private int userInfoCalls;

    public string BaseUrl { get; private set; } = null!;
    public int TokenCalls => Volatile.Read(ref tokenCalls);
    public int UserInfoCalls => Volatile.Read(ref userInfoCalls);
    public IReadOnlyList<IReadOnlyDictionary<string, string>> AuthorizeQueries => authorizeQueries.ToList();

    /// <summary>Why each failed token call failed, in order (for diagnosing a red sign-in).</summary>
    public IReadOnlyList<string> TokenFailures => tokenFailures.ToList();

    /// <summary>Every access token issued (for the log-hygiene check, Boo A39).</summary>
    public IReadOnlyList<string> IssuedAccessTokens => issuedTokens.ToList();

    /// <summary>When set, <c>/authorize</c> answers with this <c>error</c> (and a hostile description) instead of a code.</summary>
    public string? AuthorizeError { get; set; }

    /// <summary>When set, <c>/userinfo</c> omits <c>sub</c> (a provider that returns no usable subject).</summary>
    public bool OmitSubject { get; set; }

    /// <summary>The display name userinfo returns for a subject; default <c>"Stub {subject}"</c>.</summary>
    public void SetName(string subject, string? name) => names[subject] = name!;

    public string NameFor(string subject) => names.TryGetValue(subject, out var name) ? name : $"Stub {subject}";

    public static string EmailFor(string subject) => $"{subject}@stub.example";

    public IReadOnlyDictionary<string, string?> Configuration => new Dictionary<string, string?>
    {
        [GoogleProviderSettings.SectionName + ":ClientId"] = GoogleProviderSettings.StubClientId,
        [GoogleProviderSettings.SectionName + ":ClientSecret"] = GoogleProviderSettings.StubClientSecret,
        [GoogleProviderSettings.SectionName + ":AuthorizationEndpoint"] = BaseUrl + "/authorize",
        [GoogleProviderSettings.SectionName + ":TokenEndpoint"] = BaseUrl + "/token",
        [GoogleProviderSettings.SectionName + ":UserInformationEndpoint"] = BaseUrl + "/userinfo"
    };

    public static async Task<StubOAuthProvider> StartAsync()
    {
        var stub = new StubOAuthProvider();
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        stub.app = builder.Build();
        stub.app.MapGet("/authorize", stub.Authorize);
        stub.app.MapPost("/token", stub.Token);
        stub.app.MapGet("/userinfo", stub.UserInfo);
        await stub.app.StartAsync();
        stub.BaseUrl = stub.app.Urls.Single();
        return stub;
    }

    private IResult Authorize(HttpRequest request)
    {
        var q = request.Query.ToDictionary(kv => kv.Key, kv => kv.Value.ToString());
        authorizeQueries.Enqueue(q);
        string Get(string key) => q.TryGetValue(key, out var v) ? v : "";

        var redirectUri = Get("redirect_uri");
        if (Get("response_type") != "code" || Get("client_id") != GoogleProviderSettings.StubClientId
            || redirectUri.Length == 0 || Get("code_challenge_method") != "S256" || Get("code_challenge").Length == 0)
        {
            return Results.BadRequest("authorize: bad request");
        }

        var state = Get("state");
        if (AuthorizeError is { } error)
        {
            return Results.Redirect(QueryHelpers.AddQueryString(redirectUri, new Dictionary<string, string?>
            {
                ["error"] = error,
                ["error_description"] = "<script>x</script>",
                ["error_uri"] = "https://evil.example/",
                ["state"] = state
            }));
        }

        var subject = Get("login_hint") is { Length: > 0 } hint ? hint : DefaultSubject;
        var code = Random();
        codes[code] = new IssuedCode(redirectUri, Get("code_challenge"), subject);
        return Results.Redirect(QueryHelpers.AddQueryString(redirectUri, new Dictionary<string, string?> { ["code"] = code, ["state"] = state }));
    }

    private async Task<IResult> Token(HttpRequest request)
    {
        Interlocked.Increment(ref tokenCalls);
        var form = await request.ReadFormAsync();
        string Get(string key) => form[key].ToString();

        IResult Fail(string why)
        {
            tokenFailures.Enqueue(why);
            return Results.BadRequest(new { error = "invalid_grant" });
        }

        if (Get("grant_type") != "authorization_code") return Fail("grant_type");
        if (Get("client_id") != GoogleProviderSettings.StubClientId || Get("client_secret") != GoogleProviderSettings.StubClientSecret) return Fail("client");
        // Single use: removed on first presentation, whatever happens next.
        if (!codes.TryRemove(Get("code"), out var issued)) return Fail("code unknown or reused");
        if (!string.Equals(Get("redirect_uri"), issued.RedirectUri, StringComparison.Ordinal)) return Fail("redirect_uri");
        var verifier = Get("code_verifier");
        if (verifier.Length == 0 || Base64UrlTextEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))) != issued.Challenge) return Fail("pkce");

        var token = Random();
        accessTokens[token] = issued.Subject;
        issuedTokens.Enqueue(token);
        return Results.Json(new { access_token = token, token_type = "Bearer", expires_in = 3600, scope = "openid profile" });
    }

    private IResult UserInfo(HttpRequest request)
    {
        Interlocked.Increment(ref userInfoCalls);
        var auth = request.Headers.Authorization.ToString();
        if (!auth.StartsWith("Bearer ", StringComparison.Ordinal) || !accessTokens.TryGetValue(auth["Bearer ".Length..], out var subject))
        {
            return Results.Unauthorized();
        }

        var body = new Dictionary<string, object?>
        {
            ["name"] = NameFor(subject),
            ["given_name"] = "Given",
            ["family_name"] = "Family",
            ["email"] = EmailFor(subject),
            ["email_verified"] = true,
            ["picture"] = "https://stub.example/picture.png",
            ["locale"] = "en"
        };
        if (!OmitSubject)
        {
            body["sub"] = subject;
        }

        return Results.Json(body);
    }

    private static string Random() => Base64UrlTextEncoder.Encode(RandomNumberGenerator.GetBytes(24));

    private sealed record IssuedCode(string RedirectUri, string Challenge, string Subject);

    public async ValueTask DisposeAsync()
    {
        await app.StopAsync();
        await app.DisposeAsync();
    }
}

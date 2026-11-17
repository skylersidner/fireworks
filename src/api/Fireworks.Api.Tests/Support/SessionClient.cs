using System.Net;
using System.Net.Http.Headers;
using Microsoft.Net.Http.Headers;
using SetCookie = Microsoft.Net.Http.Headers.SetCookieHeaderValue;

namespace Fireworks.Api.Tests.Support;

/// <summary>
/// A browser-shaped client with its <b>own</b> cookie jar (Boo A10 harness note). .NET's
/// <c>CookieContainer</c> silently drops a <c>Secure</c> cookie over <c>http://</c>, which would make
/// the regular tier quietly test the Development flags. Here every <c>Set-Cookie</c> is recorded
/// with its attributes (<see cref="SetCookies"/>, for assertions) and its <c>name=value</c> is
/// replayed in a <c>Cookie</c> header; an expired or emptied cookie leaves the jar. Redirects are
/// never followed automatically.
/// </summary>
internal sealed class SessionClient : IDisposable
{
    private readonly Dictionary<string, string> jar = new(StringComparer.Ordinal);
    private readonly List<SetCookie> setCookies = [];
    private readonly Uri baseAddress;

    public SessionClient(Uri baseAddress)
    {
        this.baseAddress = baseAddress;
        Http = new HttpClient(new JarHandler(this) { InnerHandler = new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false } })
        {
            BaseAddress = baseAddress
        };
    }

    /// <summary>An <see cref="HttpClient"/> that sends and absorbs this jar, for existing call sites.</summary>
    public HttpClient Http { get; }

    /// <summary>Set by <see cref="SignInAsync"/> from <c>GET api/me</c>.</summary>
    public Guid UserId { get; internal set; }

    /// <summary>True once the jar holds a session cookie.</summary>
    public bool HasSession => jar.Keys.Any(k => k.EndsWith("fw.session", StringComparison.Ordinal));

    public IReadOnlyDictionary<string, string> Cookies => jar;

    /// <summary>Every <c>Set-Cookie</c> this client has received, oldest first.</summary>
    public IReadOnlyList<SetCookie> SetCookies => setCookies;

    public void Clear() => jar.Clear();

    public void Put(string name, string value) => jar[name] = value;

    public void Remove(string name) => jar.Remove(name);

    /// <summary>The OAuth correlation cookies currently in the jar.</summary>
    public IReadOnlyList<KeyValuePair<string, string>> CorrelationCookies =>
        jar.Where(kv => kv.Key.StartsWith(".AspNetCore.Correlation.", StringComparison.Ordinal)).ToList();

    /// <summary>The session cookie's name in the jar, or null.</summary>
    public string? SessionCookieName => jar.Keys.FirstOrDefault(k => k.EndsWith("fw.session", StringComparison.Ordinal));

    /// <summary>
    /// Walks login → stub authorize (with <c>login_hint=subject</c>) → callback, all three hops, and
    /// returns the callback's final <c>Location</c>. Real <c>state</c>, correlation, PKCE,
    /// provisioning and cookie code run every time.
    /// </summary>
    public async Task<SignInResult> SignInAsync(
        string subject, string? returnUrl = null, Func<string, string>? editAuthorizeUrl = null,
        Func<string, string>? editCallbackUrl = null, Action<SessionClient>? beforeCallback = null)
    {
        var loginPath = "/api/auth/login/google" + (returnUrl is null ? "" : "?returnUrl=" + Uri.EscapeDataString(returnUrl));
        using var login = await SendAsync(new HttpRequestMessage(HttpMethod.Get, loginPath));
        if (login.StatusCode != HttpStatusCode.Found)
        {
            throw new InvalidOperationException($"login: {(int)login.StatusCode}");
        }

        var authorizeUrl = login.Headers.Location!.ToString() + "&login_hint=" + Uri.EscapeDataString(subject);
        if (editAuthorizeUrl is not null) authorizeUrl = editAuthorizeUrl(authorizeUrl);
        using var stubClient = new HttpClient(new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false });
        using var authorize = await stubClient.GetAsync(authorizeUrl);
        if (authorize.StatusCode != HttpStatusCode.Redirect && authorize.StatusCode != HttpStatusCode.Found)
        {
            throw new InvalidOperationException($"authorize: {(int)authorize.StatusCode} {await authorize.Content.ReadAsStringAsync()}");
        }

        var callbackUrl = authorize.Headers.Location!.ToString();
        if (editCallbackUrl is not null) callbackUrl = editCallbackUrl(callbackUrl);
        beforeCallback?.Invoke(this);
        var callback = await SendAsync(new HttpRequestMessage(HttpMethod.Get, callbackUrl));
        var result = new SignInResult(callback, login, callbackUrl);
        if (callback.StatusCode == HttpStatusCode.Found && HasSession)
        {
            using var me = await SendAsync(new HttpRequestMessage(HttpMethod.Get, "/api/me"));
            var text = await me.Content.ReadAsStringAsync();
            var json = System.Text.Json.JsonDocument.Parse(text);
            if (me.IsSuccessStatusCode && json.RootElement.TryGetProperty("userId", out var id) && id.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                UserId = json.RootElement.GetProperty("userId").GetGuid();
            }
        }

        return result;
    }

    public Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken = default) =>
        Http.SendAsync(request, cancellationToken);

    private void Apply(HttpRequestMessage request)
    {
        // Only for our API's origin: the stub is reached with a separate client.
        var target = request.RequestUri is { IsAbsoluteUri: true } absolute ? absolute : new Uri(baseAddress, request.RequestUri!);
        if (jar.Count > 0 && target.Authority == baseAddress.Authority)
        {
            request.Headers.Remove("Cookie");
            request.Headers.Add("Cookie", string.Join("; ", jar.Select(kv => $"{kv.Key}={kv.Value}")));
        }
    }

    private void Absorb(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Set-Cookie", out var values))
        {
            return;
        }

        foreach (var value in values)
        {
            var cookie = SetCookie.Parse(value);
            setCookies.Add(cookie);
            var name = cookie.Name.ToString();
            var expired = cookie.Expires is { } expires && expires <= DateTimeOffset.UtcNow
                          || cookie.MaxAge is { } maxAge && maxAge <= TimeSpan.Zero;
            if (expired || cookie.Value.Length == 0)
            {
                jar.Remove(name);
            }
            else
            {
                jar[name] = cookie.Value.ToString();
            }
        }
    }

    public void Dispose() => Http.Dispose();

    private sealed class JarHandler(SessionClient owner) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            lock (owner.jar)
            {
                owner.Apply(request);
            }

            var response = await base.SendAsync(request, cancellationToken);
            lock (owner.jar)
            {
                owner.Absorb(response);
            }

            return response;
        }
    }
}

/// <param name="Callback">The callback's response (302 on success and on every handled failure).</param>
/// <param name="Login">The login endpoint's response (302 to the stub, with the correlation cookie).</param>
/// <param name="CallbackUrl">The URL the stub redirected to (carries <c>code</c> and <c>state</c>).</param>
internal sealed record SignInResult(HttpResponseMessage Callback, HttpResponseMessage Login, string CallbackUrl)
{
    public string? Location => Callback.Headers.Location?.OriginalString;
}

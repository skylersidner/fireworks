namespace Fireworks.Api.Services.Identity;

/// <summary>One sign-in provider the client may offer (<c>client-config.loginProviders</c>).</summary>
/// <param name="Id">The route value in <c>api/auth/login/{provider}</c> and the client's key: <c>google</c>.</param>
/// <param name="Name">The button label: <c>Google</c>.</param>
/// <param name="Scheme">The authentication scheme name, which is case-sensitive (probe P8).</param>
public sealed record LoginProvider(string Id, string Name, string Scheme);

/// <summary>
/// <c>Auth:Providers:Google</c>, read and validated once at startup (Boo A32–A35). Google only
/// (Skyler, 2026-11-16).
///
/// <list type="bullet">
/// <item><c>ClientId</c> and <c>ClientSecret</c>: user-secrets in Development, environment variables
/// in Docker and Railway (<c>Auth__Providers__Google__ClientSecret</c>). Never committed, except the
/// stub sentinel pair in <c>appsettings.Development.json</c>.</item>
/// <item><c>AuthorizationEndpoint</c>, <c>TokenEndpoint</c>, <c>UserInformationEndpoint</c>: stub
/// overrides, honoured only in Development and Testing. An empty value means the handler's Google
/// default, so a user-secrets override to real Google blanks them.</item>
/// </list>
///
/// <para>
/// <b>Outside Development and Testing, startup throws</b> when the client id or secret is missing
/// or blank, when either is the stub sentinel, or when any endpoint override is non-empty. With one
/// provider, "not configured" would otherwise be a silently write-dead deploy, and a stray variable
/// could point production at a stub. Messages name keys, never values.
/// </para>
/// </summary>
public sealed record GoogleProviderSettings(
    string ClientId,
    string ClientSecret,
    string? AuthorizationEndpoint,
    string? TokenEndpoint,
    string? UserInformationEndpoint)
{
    public const string SectionName = "Auth:Providers:Google";
    public const string Scheme = "Google";
    public const string ProviderId = "google";
    public const string CallbackPath = "/api/auth/callback/google";

    /// <summary>The committed stub pair (<c>appsettings.Development.json</c>, the harness, the smoke). Never a credential.</summary>
    public const string StubClientId = "fireworks-stub-client";
    public const string StubClientSecret = "stub-secret-not-a-credential";

    public bool UsesEndpointOverrides =>
        AuthorizationEndpoint is not null || TokenEndpoint is not null || UserInformationEndpoint is not null;
}

public static class AuthProviderSettings
{
    private static readonly string[] EndpointKeys = ["AuthorizationEndpoint", "TokenEndpoint", "UserInformationEndpoint"];

    /// <summary>True where the stub may be used: <c>Development</c> and <c>Testing</c> only (Boo A33, A36).</summary>
    public static bool AllowsStub(IHostEnvironment environment) =>
        environment.IsDevelopment() || environment.IsEnvironment("Testing");

    /// <summary>
    /// The validated Google settings, or <c>null</c> when sign-in is not configured, which only
    /// Development and Testing allow. Throws <see cref="InvalidOperationException"/> naming the key.
    /// </summary>
    public static GoogleProviderSettings? ReadGoogle(IConfiguration configuration, IHostEnvironment environment)
    {
        var section = configuration.GetSection(GoogleProviderSettings.SectionName);
        var clientId = Blank(section["ClientId"]);
        var clientSecret = Blank(section["ClientSecret"]);
        var endpoints = EndpointKeys.ToDictionary(k => k, k => Blank(section[k]));
        var allowsStub = AllowsStub(environment);

        if (!allowsStub)
        {
            foreach (var (key, value) in endpoints)
            {
                if (value is not null)
                {
                    throw new InvalidOperationException(
                        $"{GoogleProviderSettings.SectionName}:{key} is a stub override and is honoured only in Development and Testing; remove it.");
                }
            }

            if (clientId is null)
            {
                throw new InvalidOperationException($"{GoogleProviderSettings.SectionName}:ClientId must be configured.");
            }

            if (clientSecret is null)
            {
                throw new InvalidOperationException($"{GoogleProviderSettings.SectionName}:ClientSecret must be configured.");
            }

            if (clientId == GoogleProviderSettings.StubClientId || clientSecret == GoogleProviderSettings.StubClientSecret)
            {
                throw new InvalidOperationException(
                    $"{GoogleProviderSettings.SectionName}:ClientId/ClientSecret are the stub placeholders; configure a real Google client.");
            }
        }

        if (clientId is null || clientSecret is null)
        {
            // Development or Testing with no client: sign-in isn't offered (loginProviders: []).
            return null;
        }

        foreach (var (key, value) in endpoints)
        {
            if (value is not null && !(Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https"))
            {
                throw new InvalidOperationException($"{GoogleProviderSettings.SectionName}:{key} must be an absolute http(s) URL.");
            }
        }

        return new GoogleProviderSettings(
            clientId,
            clientSecret,
            endpoints["AuthorizationEndpoint"],
            endpoints["TokenEndpoint"],
            endpoints["UserInformationEndpoint"]);
    }

    /// <summary>
    /// Phase 8 removed the interim default user. A forgotten <c>Identity__*</c> variable stops the
    /// process loudly (design §3.5, Boo A34) instead of doing nothing.
    /// </summary>
    public static void RejectStaleIdentityConfiguration(IConfiguration configuration)
    {
        if (configuration.GetSection("Identity").Exists())
        {
            throw new InvalidOperationException(
                "Identity:* was removed in Phase 8 (sign-in replaces the default user); delete Identity__DefaultUserId / Identity__AllowAnonymousWrites.");
        }
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}

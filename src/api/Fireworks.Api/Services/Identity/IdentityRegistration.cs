using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Repositories;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;

namespace Fireworks.Api.Services.Identity;

/// <summary>What startup decided about sign-in; read by <c>client-config</c> and the startup warning.</summary>
public sealed record FireworksAuthSetup(GoogleProviderSettings? Google, IReadOnlyList<LoginProvider> LoginProviders);

/// <summary>
/// Sign-in and the session (plan Phase 8; design <c>phase-8-auth.md</c> §3; Boo A1–A39). Program.cs
/// and the test harness both call <see cref="AddFireworksIdentity"/> and
/// <see cref="UseFireworksIdentity"/>, so a test host binds auth exactly as the app does.
///
/// <para>
/// Not named <c>IdentityServiceCollectionExtensions</c>: the shared framework already has a public
/// class by that name, which every file imports implicitly (CS0433).
/// </para>
/// </summary>
public static class IdentityRegistration
{
    public const string CookieScheme = CookieAuthenticationDefaults.AuthenticationScheme;

    /// <summary><c>__Host-</c> outside Development (Boo A10, probe P3: Chromium and Firefox store it from http://localhost and http://127.0.0.1).</summary>
    public const string SessionCookieName = "__Host-fw.session";

    /// <summary>Development serves plain http with <c>SameAsRequest</c>, so no <c>Secure</c>, so no <c>__Host-</c> prefix.</summary>
    public const string DevelopmentSessionCookieName = "fw.session";

    public static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);

    /// <summary>Where a cancelled or failed sign-in lands (Rosalina, <c>design/phase-8.md</c> §9.4).</summary>
    public const string SignInPagePath = "/signin";

    /// <summary>
    /// Reads and validates sign-in configuration <b>now</b> (eager, like the connection-string guard:
    /// a bad value stops the process before it opens a database connection), then registers the
    /// cookie session, the Google handler, the fail-closed fallback policy, DataProtection keys in
    /// Postgres, provisioning and <see cref="ICurrentUser"/>.
    /// </summary>
    public static IServiceCollection AddFireworksIdentity(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        AuthProviderSettings.RejectStaleIdentityConfiguration(configuration);
        var google = AuthProviderSettings.ReadGoogle(configuration, environment);
        var providers = google is null
            ? Array.Empty<LoginProvider>()
            : [new LoginProvider(GoogleProviderSettings.ProviderId, "Google", GoogleProviderSettings.Scheme)];
        services.AddSingleton(new FireworksAuthSetup(google, providers));

        var isDevelopment = environment.IsDevelopment();
        var securePolicy = isDevelopment ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;

        // All three defaults are the cookie scheme (Boo A19). Google is challenged only by name, from
        // the login endpoint; were it the default challenge, an anonymous POST would 302 to Google.
        var authentication = services.AddAuthentication(options =>
            {
                options.DefaultScheme = CookieScheme;
                options.DefaultChallengeScheme = CookieScheme;
                options.DefaultSignInScheme = CookieScheme;
            })
            .AddCookie(CookieScheme, options =>
            {
                options.Cookie.Name = isDevelopment ? DevelopmentSessionCookieName : SessionCookieName;
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = securePolicy;
                options.Cookie.Path = "/";
                options.Cookie.Domain = null;
                options.ExpireTimeSpan = SessionLifetime;
                options.SlidingExpiration = true;

                // Mutate options.Events, never assign a new object (the reference's rule). The
                // default answers are 302s to /Account/Login, wrong for an API.
                options.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                // There are no roles, so the only way an authenticated principal fails the fallback
                // policy is the shared id predicate: no valid identity, which is 401 (Boo A21).
                options.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = FireworksClaims.TryGetUserId(context.HttpContext.User, out _)
                        ? StatusCodes.Status403Forbidden
                        : StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };

                // A cookie that outlives its row (a database reset) reads as anonymous on the same
                // request (Boo A12). /api only: HTML never touches the database for identity. Cost:
                // one primary-key lookup per signed-in API call. An id that doesn't parse is NOT
                // handled here: the shared predicate (FireworksClaims, the fallback policy and
                // ClaimsCurrentUser) owns that case alone, so each layer has one job and Boo A18's
                // negative control (drop the policy's assertion) is observable.
                options.Events.OnValidatePrincipal = async context =>
                {
                    if (!context.Request.Path.StartsWithSegments("/api")
                        || !FireworksClaims.TryGetUserId(context.Principal, out var userId))
                    {
                        return;
                    }

                    var users = context.HttpContext.RequestServices.GetRequiredService<IUserRepository>();
                    if (!await users.ExistsAsync(userId, context.HttpContext.RequestAborted))
                    {
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(CookieScheme);
                    }
                };
            });

        if (google is not null)
        {
            authentication.AddGoogle(GoogleProviderSettings.Scheme, options =>
            {
                options.ClientId = google.ClientId;
                options.ClientSecret = google.ClientSecret;
                if (google.AuthorizationEndpoint is { } authorize) options.AuthorizationEndpoint = authorize;
                if (google.TokenEndpoint is { } token) options.TokenEndpoint = token;
                if (google.UserInformationEndpoint is { } userInfo) options.UserInformationEndpoint = userInfo;

                options.CallbackPath = GoogleProviderSettings.CallbackPath;
                options.SignInScheme = CookieScheme;
                options.SaveTokens = false;
                options.UsePkce = true; // the default (probe P6), set explicitly (Boo A1)
                options.Scope.Clear(); // the defaults include "email" (probe P6)
                options.Scope.Add("openid");
                options.Scope.Add("profile");
                options.ClaimActions.Clear(); // the principal is replaced below; nothing is mapped

                // The framework default is SameSite=None; Secure (probe P6). None without Secure is
                // dropped over the http dev loop, and the return from Google is a top-level GET,
                // which carries Lax cookies (Boo A3).
                options.CorrelationCookie.SameSite = SameSiteMode.Lax;
                options.CorrelationCookie.SecurePolicy = securePolicy;
                options.CorrelationCookie.HttpOnly = true;

                options.Events.OnCreatingTicket = async context =>
                {
                    // v3 userinfo carries the subject as "sub" (probe P7), read explicitly.
                    var subject = ReadString(context.User, "sub");
                    if (string.IsNullOrEmpty(subject) || subject.Length > Data.Entities.User.ExternalSubjectMaxLength)
                    {
                        // Becomes OnRemoteFailure (error=failed). The value is never logged (A39).
                        throw new InvalidOperationException("The provider returned no usable subject.");
                    }

                    var provisioning = context.HttpContext.RequestServices.GetRequiredService<IUserProvisioning>();
                    var userId = await provisioning.ResolveAsync(
                        GoogleProviderSettings.ProviderId, subject, ReadString(context.User, "name"), context.HttpContext.RequestAborted);

                    // Exactly one claim, our id (Boo A10): the provider's claims never reach the cookie.
                    context.Principal = FireworksClaims.PrincipalFor(userId, CookieScheme);
                    context.Properties.IsPersistent = true;
                };

                // Never reflect the provider's error, error_description or error_uri (Boo A4).
                options.Events.OnAccessDenied = context =>
                {
                    context.Response.Redirect(FailureRedirect("cancelled", context.Properties));
                    context.HandleResponse();
                    return Task.CompletedTask;
                };
                options.Events.OnRemoteFailure = context =>
                {
                    context.Response.Redirect(FailureRedirect("failed", context.Properties));
                    context.HandleResponse();
                    return Task.CompletedTask;
                };
            });
        }

        // Fail closed (the reference's fallback policy), plus the shared id predicate (Boo A18): a
        // cookie with an unparseable id fails the policy (401) instead of reaching the service.
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder(CookieScheme)
                .RequireAuthenticatedUser()
                .RequireAssertion(context => FireworksClaims.TryGetUserId(context.User, out _))
                .Build());

        // Cookies, OAuth state and the correlation cookie are DataProtection payloads; the default
        // key ring dies with the container (design §3.7). Unencrypted at rest (Boo A37).
        services.AddDataProtection()
            .PersistKeysToDbContext<FireworksDbContext>()
            .SetApplicationName("Fireworks");

        services.AddHttpContextAccessor();
        services.AddScoped<IUserProvisioning, UserProvisioning>();
        services.AddScoped<ICurrentUser, ClaimsCurrentUser>();
        return services;
    }

    /// <summary>
    /// Program.cs step 11a, after <c>UseRouting</c>: authentication (the OAuth callback completes
    /// here, before any endpoint), the CSRF guard, then authorization. The rate limiter follows, so
    /// it can partition by user. Logs one Warning whenever stub endpoints are active (Boo A35).
    /// </summary>
    public static WebApplication UseFireworksIdentity(this WebApplication app)
    {
        var setup = app.Services.GetRequiredService<FireworksAuthSetup>();
        if (setup.Google is { UsesEndpointOverrides: true } google)
        {
            var host = new Uri(google.AuthorizationEndpoint ?? google.TokenEndpoint ?? google.UserInformationEndpoint!).Authority;
            app.Logger.LogWarning("Sign-in uses stub OAuth endpoints ({StubHost}). Never in production.", host);
        }
        else if (setup.Google is null)
        {
            app.Logger.LogWarning("Sign-in is not configured (Auth:Providers:Google); saving is unavailable.");
        }

        app.UseAuthentication();
        app.UseCrossOriginWriteGuard();

        // A request no endpoint matched (a static-file miss such as /chunk-AAAAAAAA.js or /nope.js:
        // the SPA fallback skips dotted paths) would otherwise meet the fallback policy with no
        // endpoint and answer 401 to anonymous callers. It gets an anonymous empty 404 instead,
        // exactly what it got before Phase 8. Not in EndpointDataSource, so the pinned anonymous
        // set (Boo A20) is unchanged.
        app.Use((context, next) =>
        {
            if (context.GetEndpoint() is null)
            {
                context.SetEndpoint(UnmatchedEndpoint);
            }

            return next(context);
        });

        app.UseAuthorization();
        return app;
    }

    private static readonly Endpoint UnmatchedEndpoint = new(
        context =>
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        },
        new EndpointMetadataCollection(new AllowAnonymousAttribute()),
        "Unmatched request (404)");

    /// <summary>
    /// <c>/signin?error=…&amp;returnUrl=…</c> (Rosalina §9.4, schema §2.8): the return URL from the
    /// login's own properties, checked again; omitted when they can't be read (a bad state).
    /// Nothing from the provider is reflected.
    /// </summary>
    public static string FailureRedirect(string error, AuthenticationProperties? properties) =>
        properties?.RedirectUri is { } returnUrl
            ? $"{SignInPagePath}?error={error}&returnUrl={Uri.EscapeDataString(SafeReturnUrl.From(returnUrl))}"
            : $"{SignInPagePath}?error={error}";

    private static string? ReadString(JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

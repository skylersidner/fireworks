using Fireworks.Api.Controllers;
using Fireworks.Api.Data;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services;
using Fireworks.Api.Services.ClientConfig;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Services.Health;
using Fireworks.Api.Services.Identity;
using Fireworks.Api.Services.RateLimiting;
using Fireworks.Api.Tests.Support;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Fireworks.Api.Tests.Controllers;

/// <summary>
/// A real Kestrel host on a loopback port, with the real controllers, model binding, JSON options,
/// services and repositories, an in-memory SQLite database, and a temporary wwwroot holding an
/// <c>index.html</c>. For tests whose subject is the request pipeline or the exact JSON a client
/// receives.
///
/// <para>
/// <b>Not <c>Program.cs</c> itself</b> — that needs Npgsql and migrations (the real Program is
/// exercised as a child process by <c>ProgramStartupTests</c> and, on Postgres,
/// <c>ProgramOnPostgresTests</c>). This host repeats the Program.cs calls that shape a response:
/// <c>AddFireworksIdentity</c> (the cookie session, the Google handler pointed at a per-harness
/// <see cref="StubOAuthProvider"/>, the fallback policy, DataProtection keys in the SQLite database)
/// and <c>AddFireworksClientConfig</c> over configuration,
/// <c>AddProblemDetails</c>, <c>AddFireworksControllers</c> (default JSON options, no form value providers), health checks,
/// <c>AddFireworksRateLimiting</c> over configuration, <c>UseFireworksResponseHeaders</c>,
/// <c>UseExceptionHandler</c>, <c>UseFireworksStaticFiles</c> with one shared <c>StaticFileOptions</c>,
/// explicit routing, <c>UseFireworksIdentity</c>, <c>UseRateLimiter</c>, <c>MapFireworksHealthChecks</c>,
/// <c>MapFireworksApiNotFound</c> and <c>MapFireworksSpaFallback</c> — in Program.cs order. Because it re-implements the pipeline, <c>ProgramOnPostgresTests</c> repeats the
/// load-bearing checks (creations round trip, the limiter) against the real Program. Development-only and Production-only steps (CORS, HTTPS
/// redirection, Swagger, forwarded headers) are left out; none of them changes a response body.
/// </para>
///
/// <para>
/// <b>Owns a connection string, not a connection</b> (standing decision, testing §2): each
/// <c>DbContext</c> opens its own connection to a uniquely named shared-cache in-memory database,
/// and <see cref="keepAlive"/> only holds that database open for the harness's lifetime. Two
/// concurrent requests can never drive one ADO.NET connection.
/// </para>
/// </summary>
internal sealed class FireworksApiHarness : IAsyncDisposable
{
    private SqliteConnection keepAlive = null!;
    private TempWebRoot webRoot = null!;
    private WebApplication app = null!;
    private readonly List<SessionClient> sessions = [];

    public string ConnectionString { get; private set; } = null!;

    /// <summary>
    /// The default client: signed in as <see cref="TestIdentity.Owner"/> when the harness was started
    /// with <c>signedIn: true</c> (its own cookie jar, <see cref="Owner"/>), otherwise anonymous.
    /// </summary>
    public HttpClient Client { get; private set; } = null!;

    /// <summary>Always anonymous: no cookies, no redirects followed.</summary>
    public HttpClient AnonymousClient { get; private set; } = null!;

    /// <summary>The signed-in default session, or null when started anonymous.</summary>
    public SessionClient? Owner { get; private set; }

    /// <summary>The signed-in default user's id (throws when started anonymous).</summary>
    public Guid OwnerUserId => Owner?.UserId ?? throw new InvalidOperationException("The harness was started anonymous.");

    public StubOAuthProvider Stub { get; private set; } = null!;

    public Uri BaseAddress => new(app.Urls.Single());

    /// <summary>Rate limits high enough that no functional test is ever throttled by accident.</summary>
    public static readonly IReadOnlyDictionary<string, string?> UnthrottledRateLimits = new Dictionary<string, string?>
    {
        ["RateLimits:Writes:PerMinute"] = "100000",
        ["RateLimits:Writes:PerDay"] = "100000",
        ["RateLimits:Reads:PerMinute"] = "100000"
    };

    public WebApplication App => app;

    /// <summary>The temporary wwwroot; tests drop extra files (hashed bundles, a favicon) into it.</summary>
    public string WebRootPath => webRoot.Path;

    /// <summary>
    /// Test-only: a request carrying this header gets it as <c>Connection.RemoteIpAddress</c>, so
    /// rate-limit partitions can be tested from one loopback client. Set directly on the connection,
    /// never through X-Forwarded-For (Boo S18). Present only when <c>clientIpOverride</c> is on.
    /// </summary>
    public const string TestClientIpHeader = "X-Test-Client-Ip";

    /// <summary>
    /// Test-only: a request carrying this header gets it as <c>Request.Scheme</c>, standing where
    /// <c>UseForwardedHeaders</c> applies <c>X-Forwarded-Proto</c> in Program.cs. Present only when
    /// <c>schemeOverride</c> is on. The real forwarded-headers path is covered by
    /// <c>ProgramOnPostgresTests</c>.
    /// </summary>
    public const string TestSchemeHeader = "X-Test-Scheme";

    /// <param name="signedIn">Sign <see cref="Client"/> in through the stub as <see cref="TestIdentity.Owner"/>.</param>
    /// <param name="configuration">Extra configuration (rate limits); the production defaults apply to anything not given.</param>
    /// <param name="configureServices">Test-only replacements, applied after the app's registrations (e.g. a recording repository).</param>
    /// <param name="clientIpOverride">Honor <see cref="TestClientIpHeader"/>.</param>
    /// <param name="schemeOverride">Honor <see cref="TestSchemeHeader"/>.</param>
    /// <param name="environmentName">The host environment ("Testing" unless a test is about Development-only behaviour).</param>
    /// <param name="registerResponseHeaders">False only for the negative control that shows the header tests see the middleware.</param>
    /// <param name="withGoogle">False: no Google client configured (Development and Testing allow it; <c>loginProviders: []</c>).</param>
    /// <param name="loggerProvider">A capturing logger (Boo A39); otherwise no logging.</param>
    public static async Task<FireworksApiHarness> StartAsync(
        bool signedIn = false,
        IReadOnlyDictionary<string, string?>? configuration = null,
        Action<IServiceCollection>? configureServices = null,
        bool clientIpOverride = false,
        bool schemeOverride = false,
        string environmentName = "Testing",
        bool registerResponseHeaders = true,
        bool withGoogle = true,
        Microsoft.Extensions.Logging.ILoggerProvider? loggerProvider = null,
        bool registerIdentityPipeline = true)
    {
        var harness = new FireworksApiHarness();
        harness.Stub = await StubOAuthProvider.StartAsync();
        harness.ConnectionString = $"DataSource=file:{Guid.NewGuid():N}?mode=memory&cache=shared";
        harness.keepAlive = new SqliteConnection(harness.ConnectionString);
        await harness.keepAlive.OpenAsync();
        harness.webRoot = new TempWebRoot();

        // Not "Development": WebApplication adds the developer exception page there, which would
        // change what a 500 looks like. ContentRootPath is the temp wwwroot's folder, so no
        // appsettings.json is picked up and the in-memory values below are the whole config.
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = environmentName,
            ContentRootPath = harness.webRoot.Path,
            WebRootPath = harness.webRoot.Path
        });
        builder.Logging.ClearProviders();
        if (loggerProvider is not null)
        {
            builder.Logging.AddProvider(loggerProvider);
            builder.Logging.SetMinimumLevel(LogLevel.Trace);
        }

        if (withGoogle && (environmentName is "Testing" or "Development"))
        {
            builder.Configuration.AddInMemoryCollection(harness.Stub.Configuration);
        }
        else if (environmentName is not ("Testing" or "Development"))
        {
            // Production refuses the stub (Boo A33): a real-shaped client, no overrides. Nothing can sign in.
            builder.Configuration.AddInMemoryCollection(TestIdentity.ProductionGoogleEnvironment
                .ToDictionary(kv => kv.Key.Replace("__", ":"), kv => (string?)kv.Value));
        }

        if (configuration is not null)
        {
            builder.Configuration.AddInMemoryCollection(configuration);
        }

        builder.Services.AddFireworksIdentity(builder.Configuration, builder.Environment);
        builder.Services.AddFireworksClientConfig(builder.Configuration);
        builder.Services.AddFireworksHealthChecks();
        builder.Services.AddProblemDetails();
        builder.Services.AddFireworksControllers();
        builder.Services.AddDbContext<FireworksDbContext>(o => o.UseSqlite(harness.ConnectionString));
        builder.Services.AddScoped<IUserRepository, UserRepository>();
        builder.Services.AddScoped<IMeService, MeService>();
        builder.Services.AddFireworksCreations();
        builder.Services.AddFireworksRateLimiting(builder.Configuration);
        builder.WebHost.ConfigureKestrel(KestrelLimits.Apply);
        configureServices?.Invoke(builder.Services);

        harness.app = builder.Build();
        harness.app.Urls.Add("http://127.0.0.1:0");
        if (clientIpOverride)
        {
            // Stands where UseForwardedHeaders stands in Program.cs: before anything reads the address.
            harness.app.Use((context, next) =>
            {
                if (context.Request.Headers.TryGetValue(TestClientIpHeader, out var ip))
                {
                    context.Connection.RemoteIpAddress = System.Net.IPAddress.Parse(ip.ToString());
                }

                return next(context);
            });
        }

        if (schemeOverride)
        {
            harness.app.Use((context, next) =>
            {
                if (context.Request.Headers.TryGetValue(TestSchemeHeader, out var scheme))
                {
                    context.Request.Scheme = scheme.ToString();
                }

                return next(context);
            });
        }

        if (registerResponseHeaders)
        {
            harness.app.UseFireworksResponseHeaders();
        }

        harness.app.UseExceptionHandler();
        var staticFileOptions = SpaHosting.CreateStaticFileOptions();
        harness.app.UseFireworksStaticFiles(staticFileOptions);
        harness.app.UseRouting();
        if (registerIdentityPipeline)
        {
            harness.app.UseFireworksIdentity();
        }

        harness.app.UseRateLimiter();

        await using (var setup = harness.NewContext())
        {
            // No seeding since Phase 8: users are provisioned on first sign-in.
            await setup.Database.EnsureCreatedAsync();
        }

        harness.app.MapFireworksHealthChecks();
        harness.app.MapControllers();
        harness.app.MapFireworksApiNotFound();
        harness.app.MapFireworksSpaFallback(staticFileOptions);
        await harness.app.StartAsync();

        // Port 0 asks the OS for a free port; after start, Urls holds the one Kestrel bound.
        harness.AnonymousClient = new HttpClient(new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false })
        {
            BaseAddress = harness.BaseAddress
        };
        harness.Client = harness.AnonymousClient;
        if (signedIn)
        {
            harness.Owner = await harness.SignInAsync(TestIdentity.Owner);
            harness.Client = harness.Owner.Http;
        }

        return harness;
    }

    /// <summary>A fresh, anonymous browser-shaped client with its own jar.</summary>
    public SessionClient NewSession()
    {
        var session = new SessionClient(BaseAddress);
        sessions.Add(session);
        return session;
    }

    /// <summary>A new session signed in through the stub as <paramref name="subject"/>; throws unless the sign-in completed.</summary>
    public async Task<SessionClient> SignInAsync(string subject)
    {
        var session = NewSession();
        var result = await session.SignInAsync(subject);
        if (session.UserId == Guid.Empty && session.HasSession)
        {
            // A host whose api/me is replaced (a forced-500 test double): read the provisioned row.
            await using var db = NewContext();
            session.UserId = await db.Users.Where(u => u.ExternalSubject == subject).Select(u => u.Id).SingleAsync();
        }

        if (session.UserId == Guid.Empty)
        {
            throw new InvalidOperationException(
                $"Sign-in as {subject} did not complete: {(int)result.Callback.StatusCode} {result.Location}; stub token failures: {string.Join(", ", Stub.TokenFailures)}");
        }

        return session;
    }

    /// <summary>Inserts the pre-Phase 8 default user's row (no external identity), as an old local database has it.</summary>
    public async Task SeedLegacyUserAsync()
    {
        await using var db = NewContext();
        db.Users.Add(new Fireworks.Api.Data.Entities.User { Id = TestIdentity.LegacyDefaultUserId, DisplayName = "Default user" });
        await db.SaveChangesAsync();
    }

    public FireworksDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FireworksDbContext>().UseSqlite(ConnectionString).Options);

    public async ValueTask DisposeAsync()
    {
        foreach (var session in sessions)
        {
            session.Dispose();
        }

        AnonymousClient.Dispose();
        await Stub.DisposeAsync();
        await app.StopAsync();
        await app.DisposeAsync();
        await keepAlive.DisposeAsync();
        webRoot.Dispose();
    }
}

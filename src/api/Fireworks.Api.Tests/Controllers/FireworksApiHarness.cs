using Fireworks.Api.Controllers;
using Fireworks.Api.Data;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services;
using Fireworks.Api.Services.Creations;
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
/// <c>AddFireworksIdentity</c> over configuration (so identity binds exactly as the app binds it),
/// <c>AddProblemDetails</c>, <c>AddFireworksControllers</c> (default JSON options, no form value providers), health checks,
/// <c>AddFireworksRateLimiting</c> over configuration, <c>UseExceptionHandler</c>, static files,
/// explicit routing, <c>UseRateLimiter</c>, the <c>/api/{**rest}</c> 404 and the SPA fallback — in
/// Program.cs order. Because it re-implements the pipeline, <c>ProgramOnPostgresTests</c> repeats the
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

    public string ConnectionString { get; private set; } = null!;
    public HttpClient Client { get; private set; } = null!;

    /// <summary>Rate limits high enough that no functional test is ever throttled by accident.</summary>
    public static readonly IReadOnlyDictionary<string, string?> UnthrottledRateLimits = new Dictionary<string, string?>
    {
        ["RateLimits:Writes:PerMinute"] = "100000",
        ["RateLimits:Writes:PerDay"] = "100000",
        ["RateLimits:Reads:PerMinute"] = "100000"
    };

    public WebApplication App => app;

    /// <param name="allowAnonymousWrites">The interim write switch, bound through configuration exactly as the app binds it.</param>
    /// <param name="configuration">Extra configuration (rate limits); the production defaults apply to anything not given.</param>
    /// <summary>
    /// Test-only: a request carrying this header gets it as <c>Connection.RemoteIpAddress</c>, so
    /// rate-limit partitions can be tested from one loopback client. Set directly on the connection,
    /// never through X-Forwarded-For (Boo S18). Present only when <c>clientIpOverride</c> is on.
    /// </summary>
    public const string TestClientIpHeader = "X-Test-Client-Ip";

    /// <param name="allowAnonymousWrites">The interim write switch, bound through configuration exactly as the app binds it.</param>
    /// <param name="configuration">Extra configuration (rate limits); the production defaults apply to anything not given.</param>
    /// <param name="configureServices">Test-only replacements, applied after the app's registrations (e.g. a recording repository).</param>
    /// <param name="clientIpOverride">Honor <see cref="TestClientIpHeader"/>.</param>
    public static async Task<FireworksApiHarness> StartAsync(
        bool allowAnonymousWrites = false,
        IReadOnlyDictionary<string, string?>? configuration = null,
        Action<IServiceCollection>? configureServices = null,
        bool clientIpOverride = false)
    {
        var harness = new FireworksApiHarness();
        harness.ConnectionString = $"DataSource=file:{Guid.NewGuid():N}?mode=memory&cache=shared";
        harness.keepAlive = new SqliteConnection(harness.ConnectionString);
        await harness.keepAlive.OpenAsync();
        harness.webRoot = new TempWebRoot();

        // Not "Development": WebApplication adds the developer exception page there, which would
        // change what a 500 looks like. ContentRootPath is the temp wwwroot's folder, so no
        // appsettings.json is picked up and the in-memory values below are the whole config.
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Testing",
            ContentRootPath = harness.webRoot.Path,
            WebRootPath = harness.webRoot.Path
        });
        builder.Logging.ClearProviders();
        builder.Configuration.AddInMemoryCollection(TestIdentity.Configuration(allowAnonymousWrites));
        if (configuration is not null)
        {
            builder.Configuration.AddInMemoryCollection(configuration);
        }

        builder.Services.AddFireworksIdentity(builder.Configuration);
        builder.Services.AddHealthChecks();
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

        harness.app.UseFireworksApiResponseHeaders();
        harness.app.UseExceptionHandler();
        harness.app.UseDefaultFiles();
        harness.app.UseStaticFiles();
        harness.app.UseRouting();
        harness.app.UseRateLimiter();

        await using (var setup = harness.NewContext())
        {
            await setup.Database.EnsureCreatedAsync();
            // The same seeding call FireworksDbInitializer makes after MigrateAsync.
            await FireworksDbInitializer.EnsureDefaultUserExistsAsync(setup, TestIdentity.Options(allowAnonymousWrites));
        }

        harness.app.MapHealthChecks("/health/live").DisableRateLimiting();
        harness.app.MapControllers();
        harness.app.Map("/api/{**rest}", () => Results.NotFound()).RequireRateLimiting(FireworksRateLimiting.ReadPolicy);
        harness.app.MapFallbackToFile("index.html");
        await harness.app.StartAsync();

        // Port 0 asks the OS for a free port; after start, Urls holds the one Kestrel bound.
        harness.Client = new HttpClient { BaseAddress = new Uri(harness.app.Urls.Single()) };
        return harness;
    }

    public FireworksDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FireworksDbContext>().UseSqlite(ConnectionString).Options);

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await app.StopAsync();
        await app.DisposeAsync();
        await keepAlive.DisposeAsync();
        webRoot.Dispose();
    }
}

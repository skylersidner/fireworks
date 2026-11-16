using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Fireworks.Api.Data;
using Fireworks.Api.Services.Health;
using Fireworks.Api.Tests.Controllers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

namespace Fireworks.Api.Tests.Hardening;

/// <summary>
/// Boo P7-S6: <c>/health/ready</c> is the health check (text/plain, never the SPA's text/html), checks
/// the database with a timeout of 3 s or less, is 503 when the database is unreachable, and is
/// read-limited; <c>/health/live</c> stays 200 throughout. Negative control: unmap <c>/health/ready</c>
/// and the fallback answers 200 text/html, which every test here rejects. The real-Postgres version
/// (drop the database mid-run) is in <c>ProgramOnPostgresTests</c>.
/// </summary>
public sealed class HealthReadyTests
{
    /// <summary>Points the app's DbContext (and so the readiness check) at <paramref name="connectionString"/> on Npgsql.</summary>
    private static Action<IServiceCollection> NpgsqlAt(string connectionString) => services =>
    {
        foreach (var descriptor in services.Where(d =>
                     d.ServiceType == typeof(FireworksDbContext) ||
                     d.ServiceType == typeof(DbContextOptions) ||
                     (d.ServiceType.IsGenericType && d.ServiceType.GetGenericArguments().Contains(typeof(FireworksDbContext)))).ToList())
        {
            services.Remove(descriptor);
        }

        services.AddDbContext<FireworksDbContext>(o => o.UseNpgsql(connectionString));
    };

    private static void AssertPlain(HttpResponseMessage response, HttpStatusCode status, string body, string actual)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(body, actual);
    }

    [Fact]
    public async Task Ready_is_200_Healthy_text_plain_when_the_database_answers()
    {
        await using var h = await FireworksApiHarness.StartAsync();

        using var ready = await h.Client.GetAsync("/health/ready");

        AssertPlain(ready, HttpStatusCode.OK, "Healthy", await ready.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ready_is_503_Unhealthy_and_live_stays_200_when_the_database_refuses()
    {
        // Port 1 on loopback refuses at once.
        await using var h = await FireworksApiHarness.StartAsync(
            configureServices: NpgsqlAt("Host=127.0.0.1;Port=1;Database=none;Username=none;Password=none;Timeout=2"));

        using var ready = await h.Client.GetAsync("/health/ready");
        using var live = await h.Client.GetAsync("/health/live");

        var body = await ready.Content.ReadAsStringAsync();
        AssertPlain(ready, HttpStatusCode.ServiceUnavailable, "Unhealthy", body);
        AssertPlain(live, HttpStatusCode.OK, "Healthy", await live.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// A server that accepts the connection and never answers: without the timeout the check waits
    /// for Npgsql's own 30 s timeout. Mutant: drop the registration's timeout, and this takes 30 s.
    /// </summary>
    [Fact]
    public async Task Ready_gives_up_within_the_timeout_on_a_database_that_never_answers()
    {
        using var silent = new TcpListener(IPAddress.Loopback, 0);
        silent.Start();
        var accepted = new System.Collections.Concurrent.ConcurrentBag<TcpClient>();
        var acceptLoop = Task.Run(async () =>
        {
            try
            {
                while (true)
                {
                    accepted.Add(await silent.AcceptTcpClientAsync());
                }
            }
            catch (Exception)
            {
                // Listener stopped.
            }
        });
        var port = ((IPEndPoint)silent.LocalEndpoint).Port;
        await using var h = await FireworksApiHarness.StartAsync(
            configureServices: NpgsqlAt($"Host=127.0.0.1;Port={port};Database=none;Username=none;Password=none;Timeout=30"));

        var clock = Stopwatch.StartNew();
        using var ready = await h.Client.GetAsync("/health/ready");
        clock.Stop();

        AssertPlain(ready, HttpStatusCode.ServiceUnavailable, "Unhealthy", await ready.Content.ReadAsStringAsync());
        Assert.InRange(clock.Elapsed, TimeSpan.FromSeconds(2.5), TimeSpan.FromSeconds(6));
        Assert.NotEmpty(accepted);
        silent.Stop();
        foreach (var client in accepted)
        {
            client.Dispose();
        }

        await acceptLoop;
    }

    [Fact]
    public async Task The_registration_is_one_ready_tagged_database_check_with_at_most_3_seconds()
    {
        await using var h = await FireworksApiHarness.StartAsync();

        var registration = Assert.Single(h.App.Services.GetRequiredService<IOptions<HealthCheckServiceOptions>>().Value.Registrations);

        Assert.Equal("database", registration.Name);
        Assert.Equal(["ready"], registration.Tags);
        Assert.InRange(registration.Timeout, TimeSpan.FromMilliseconds(1), TimeSpan.FromSeconds(3));
        Assert.Equal(HealthStatus.Unhealthy, registration.FailureStatus);
    }

    [Fact]
    public async Task Ready_is_read_limited_and_live_is_not()
    {
        await using var h = await FireworksApiHarness.StartAsync(configuration: new Dictionary<string, string?>
        {
            ["RateLimits:Reads:PerMinute"] = "1"
        });

        using var first = await h.Client.GetAsync("/health/ready");
        using var second = await h.Client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
        for (var i = 0; i < 5; i++)
        {
            using var live = await h.Client.GetAsync("/health/live");
            Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        }
    }
}

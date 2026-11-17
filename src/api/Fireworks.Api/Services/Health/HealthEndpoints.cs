using Fireworks.Api.Data;
using Fireworks.Api.Services.RateLimiting;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Fireworks.Api.Services.Health;

/// <summary>
/// <c>/health/live</c> and <c>/health/ready</c> (Boo P7-S6). Program.cs and the test harness both
/// call these.
///
/// <list type="bullet">
/// <item><b>Liveness runs no checks.</b> Railway's probe (<c>railway.toml</c>) restarts the app when it
/// fails, so a database blip must never fail it. Exempt from rate limiting (Boo S20).</item>
/// <item><b>Readiness is one database round trip</b>, tagged <see cref="ReadyTag"/>, with a
/// <see cref="ReadyTimeout"/> timeout. It answers 503 when unhealthy (the framework's default
/// status map), with the framework's text/plain body: the status word only, no exception and no
/// connection string. Read-limited like every other read, because each request opens a
/// connection.</item>
/// <item>Both are answered by the health check, never by the SPA fallback (which would answer 200
/// text/html forever).</item>
/// </list>
/// </summary>
public static class HealthEndpoints
{
    public const string LivePath = "/health/live";
    public const string ReadyPath = "/health/ready";
    public const string ReadyTag = "ready";
    public const string DatabaseCheckName = "database";
    public static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(3);

    public static IServiceCollection AddFireworksHealthChecks(this IServiceCollection services)
    {
        services.AddHealthChecks()
            .AddCheck<DatabaseReadyHealthCheck>(DatabaseCheckName, HealthStatus.Unhealthy, [ReadyTag], ReadyTimeout);
        return services;
    }

    public static WebApplication MapFireworksHealthChecks(this WebApplication app)
    {
        app.MapHealthChecks(LivePath, new HealthCheckOptions { Predicate = _ => false })
            .AllowAnonymous()
            .DisableRateLimiting();
        app.MapHealthChecks(ReadyPath, new HealthCheckOptions { Predicate = r => r.Tags.Contains(ReadyTag) })
            .AllowAnonymous()
            .RequireRateLimiting(FireworksRateLimiting.ReadPolicy);
        return app;
    }
}

/// <summary>
/// Can the app reach its database right now? <c>CanConnectAsync</c> opens and closes one connection
/// and returns false (rather than throwing) for an unreachable server or a dropped database.
///
/// <para>
/// <b>The timeout is enforced here, not trusted to the provider.</b> Measured (2026-11-15, Npgsql 10):
/// against a server that accepts the TCP connection and never answers, <c>CanConnectAsync</c>
/// ignores the cancelled token and waits for the connection string's own <c>Timeout</c> (30 s in
/// the test, 15 s by default), so the registration's 3 s timeout alone gave a 30 s probe. The probe
/// therefore runs on its <b>own</b> short-lived context, and the check waits on the token: on
/// timeout the check returns at once and the orphaned probe finishes (and disposes its context) by
/// itself within the connection timeout. Never the request's scoped context: an abandoned
/// operation on it would outlive the scope (standing decision: one scoped DbContext is never used
/// concurrently or after disposal).
/// </para>
/// </summary>
public sealed class DatabaseReadyHealthCheck(DbContextOptions<FireworksDbContext> options) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var probe = Task.Run(async () =>
        {
            try
            {
                await using var db = new FireworksDbContext(options);
                return await db.Database.CanConnectAsync(cancellationToken);
            }
            catch (Exception)
            {
                // Never surfaced: the response writer prints the status word only.
                return false;
            }
        }, CancellationToken.None);

        // Throws OperationCanceledException on timeout, which the health-check service reports as
        // the registration's failure status.
        return await probe.WaitAsync(cancellationToken)
            ? HealthCheckResult.Healthy()
            : new HealthCheckResult(context.Registration.FailureStatus);
    }
}

using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using Fireworks.Api.Services.Identity;
using Microsoft.AspNetCore.RateLimiting;

namespace Fireworks.Api.Services.RateLimiting;

/// <summary>
/// The <c>RateLimits</c> configuration section (Boo S18): <c>RateLimits:Writes:PerMinute</c>,
/// <c>RateLimits:Writes:PerDay</c>, <c>RateLimits:Reads:PerMinute</c>. The defaults are the committed
/// limits; nothing needs configuring in production. Tests raise them so a harness that posts every
/// fixture isn't throttled, and lower them to prove the limiter works.
/// </summary>
public sealed record FireworksRateLimitOptions
{
    public const string SectionName = "RateLimits";

    public WriteLimits Writes { get; init; } = new();
    public ReadLimits Reads { get; init; } = new();
    public AuthLimits Auth { get; init; } = new();

    /// <summary>Creation writes (create, update, delete, remix) per client.</summary>
    public sealed record WriteLimits
    {
        public int PerMinute { get; init; } = 20;

        /// <summary>A fixed 24-hour window, chained with the minute window: both must grant.</summary>
        public int PerDay { get; init; } = 300;
    }

    /// <summary>API reads per client: share-code GETs, my creations, <c>api/me</c>, and the <c>/api</c> 404 catch-all.</summary>
    public sealed record ReadLimits
    {
        public int PerMinute { get; init; } = 120;
    }

    /// <summary>Sign-in starts and sign-outs per client IP (Boo A30). Always by IP: it runs before anyone has an id.</summary>
    public sealed record AuthLimits
    {
        public int PerMinute { get; init; } = 20;
    }
}

/// <summary>
/// Fixed-window limits (plan Phase 4, Phase 8). Reads and writes are keyed <c>u:&lt;userId&gt;</c>
/// when signed in (from <see cref="ICurrentUser"/>, after <c>OnValidatePrincipal</c>), otherwise
/// <c>ip:&lt;address or /64&gt;</c>; the prefixes keep the two kinds of bucket apart (Boo A30). The
/// <c>auth</c> policy (login and logout) is always by IP.
///
/// <para>
/// Residual, stated (design §3.6): free provider accounts multiply the per-user write budget.
/// Trigger: more than 100 new users a day or 10,000 in total, then chain an IP window onto writes.
/// </para>
///
/// <para>
/// <b>Opt-in per endpoint</b> (<c>[EnableRateLimiting]</c>, and <c>RequireRateLimiting</c> on the
/// <c>/api</c> catch-all), with no global limiter, so static files and the SPA fallback are never
/// limited, and <c>/health/live</c> is explicitly <c>DisableRateLimiting()</c>: Railway's probe can't
/// be throttled (Boo S19, S20). Rejections are 429 with <c>Retry-After</c>, not the framework's 503.
/// </para>
///
/// <para>
/// <b>The client IP is only as good as the forwarded-headers setup</b> (Program.cs step 6,
/// <c>ForwardLimit = 1</c>). Whether Railway's edge appends to or overwrites a client-sent
/// <c>X-Forwarded-For</c> is still unmeasured (Phase 1d deferred); until it is, treat these limits as
/// best effort.
/// </para>
/// </summary>
public static class FireworksRateLimiting
{
    public const string WritePolicy = "creation-writes";
    public const string ReadPolicy = "creation-reads";
    public const string AuthPolicy = "auth";

    /// <summary>Program.cs and the test harnesses both call this, so a test host limits exactly as the app does.</summary>
    public static IServiceCollection AddFireworksRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(FireworksRateLimitOptions.SectionName).Get<FireworksRateLimitOptions>()
                      ?? new FireworksRateLimitOptions();
        if (options.Writes.PerMinute < 1 || options.Writes.PerDay < 1 || options.Reads.PerMinute < 1 || options.Auth.PerMinute < 1)
        {
            throw new InvalidOperationException("RateLimiting limits must be positive.");
        }

        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.OnRejected = (context, _) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    context.HttpContext.Response.Headers.RetryAfter =
                        ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                }

                return ValueTask.CompletedTask;
            };

            // Both windows must grant: 20 a minute AND 300 a day.
            limiter.AddPolicy(WritePolicy, context => RateLimitPartition.Get(
                PartitionKey(context),
                _ => RateLimiter.CreateChained(
                    FixedWindow(options.Writes.PerMinute, TimeSpan.FromMinutes(1)),
                    FixedWindow(options.Writes.PerDay, TimeSpan.FromDays(1)))));

            limiter.AddPolicy(ReadPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                PartitionKey(context),
                _ => FixedWindowOptions(options.Reads.PerMinute, TimeSpan.FromMinutes(1))));

            limiter.AddPolicy(AuthPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                IpPartitionKey(context),
                _ => FixedWindowOptions(options.Auth.PerMinute, TimeSpan.FromMinutes(1))));
        });

        return services;
    }

    /// <summary><c>u:&lt;userId&gt;</c> when signed in, otherwise <see cref="IpPartitionKey"/>.</summary>
    public static string PartitionKey(HttpContext context) =>
        (context.RequestServices?.GetService(typeof(ICurrentUser)) as ICurrentUser)?.UserId is { } userId
            ? "u:" + userId.ToString("D")
            : IpPartitionKey(context);

    /// <summary>
    /// <c>ip:</c> + the client address after forwarded headers. IPv6 is keyed by its /64, the block
    /// one subscriber is normally given: keying by the full address would let one client rotate
    /// through 2^64 addresses, each with a fresh bucket. IPv4-mapped IPv6 is keyed as IPv4.
    /// </summary>
    public static string IpPartitionKey(HttpContext context) => "ip:" + AddressKey(context);

    private static string AddressKey(HttpContext context)
    {
        var address = context.Connection.RemoteIpAddress;
        if (address is null)
        {
            return "unknown";
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var bytes = address.GetAddressBytes();
            Array.Clear(bytes, 8, 8);
            return new IPAddress(bytes) + "/64";
        }

        return address.ToString();
    }

    private static FixedWindowRateLimiter FixedWindow(int permits, TimeSpan window) =>
        new(FixedWindowOptions(permits, window));

    private static FixedWindowRateLimiterOptions FixedWindowOptions(int permits, TimeSpan window) => new()
    {
        PermitLimit = permits,
        Window = window,
        QueueLimit = 0,
        AutoReplenishment = true
    };
}

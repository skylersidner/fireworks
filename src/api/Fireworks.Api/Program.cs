using Fireworks.Api.Data;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services;
using Fireworks.Api.Services.ClientConfig;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Services.Health;
using Fireworks.Api.Services.Identity;
using Fireworks.Api.Services.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// 1. Fail fast on missing configuration.
// ConnectionStrings and Cors live in appsettings.Development.json only, so these guards actually
// fire on a production deploy that forgets ConnectionStrings__Postgres, instead of silently
// resolving a committed local placeholder and dying later inside MigrateAsync() with a socket error.
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException("ConnectionStrings:Postgres must be configured.");

// Same idea for identity (plan §3.4): Identity:DefaultUserId is read and validated here, eagerly,
// so a missing or malformed id stops the process before it opens a database connection. See
// AddFireworksIdentity for why this is not ValidateOnStart().
builder.Services.AddFireworksIdentity(builder.Configuration);

// Same for the client playback knobs (ClientPlayback, served by GET api/client-config): an
// out-of-range value stops the process here with its own message, before the database. See
// AddFireworksClientConfig for why this is eager as well as ValidateOnStart().
builder.Services.AddFireworksClientConfig(builder.Configuration);

// 1a. Kestrel's global body limit is 64 KiB; the creation writes raise it per action to 256 KiB.
// No Server header, on Kestrel's own 400/431 responses too (Boo P7-S2).
// Never add request decompression (UseRequestDecompression) or response compression: today a gzip
// body is read raw and fails as not-json, so there is no zip-bomb path (Boo S2, S4, P7-S9).
builder.WebHost.ConfigureKestrel(KestrelLimits.Apply);

// 2. Health checks (liveness runs none; readiness is one database round trip, 3 s timeout),
// ProblemDetails, controllers, Swagger.
builder.Services.AddFireworksHealthChecks();
builder.Services.AddProblemDetails();
// No form value providers: they read form-typed bodies before the write gate (Boo F1). Shared with
// the test harness.
builder.Services.AddFireworksControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// 3. EF Core on Npgsql.
builder.Services.AddDbContext<FireworksDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IMeService, MeService>();
builder.Services.AddFireworksCreations();

// Per-endpoint, IP-partitioned fixed windows on the creation endpoints only (no global limiter),
// so /health/live is never throttled. See FireworksRateLimiting.
builder.Services.AddFireworksRateLimiting(builder.Configuration);

// 4. CORS is Development-only: production is single-origin and needs no cross-origin policy at all.
// Note this half uses builder.Environment (before Build()); the UseCors half below uses
// app.Environment. Guarding only one of the two leaves UseCors pointing at a policy that does not
// exist, which throws on the first request.
if (builder.Environment.IsDevelopment())
{
    var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
        ?? throw new InvalidOperationException("Cors:AllowedOrigins must be configured.");

    builder.Services.AddCors(options =>
    {
        options.AddPolicy("FrontendDev", policy =>
        {
            policy.WithOrigins(allowedOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod();
        });
    });
}

// 5. Build.
var app = builder.Build();

// 6. Forwarded headers, outside Development. Must come before anything that reads the scheme or
// the client address (rate limiting partitions on the client address from Phase 4 on).
// KnownIPNetworks/KnownProxies default to loopback only, and the middleware discards the ENTIRE
// forwarded entry — X-Forwarded-Proto included — at the first hop that is not a known proxy.
// Railway terminates TLS at a non-loopback edge, so without these two Clear() calls this block
// does nothing. Clearing both is exactly what the framework's own
// ASPNETCORE_FORWARDEDHEADERS_ENABLED shortcut does. (KnownNetworks is [Obsolete] as of .NET 10 in
// favour of KnownIPNetworks; they are the same underlying list.)
//
// Residual, stated rather than hidden: a client reaching the app directly, bypassing the proxy,
// could assert its own X-Forwarded-For / X-Forwarded-Proto. Closed by the deployment requirement
// that the app is only reachable through its proxy; tighten to a real KnownProxies entry once the
// host is fixed. Boo reviews this before Phase 4's rate limiter relies on the client address.
if (!app.Environment.IsDevelopment())
{
    var forwardedHeadersOptions = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,

        // 1 is the framework default; it is spelled out because, with both proxy lists cleared
        // below, it is the only thing keeping a client-asserted X-Forwarded-For out of
        // RemoteIpAddress. The middleware consumes exactly one entry from the right, the one the
        // edge appended, and ignores anything the client put to its left. null or >1 re-opens
        // spoofing. That reasoning assumes Railway's edge APPENDS to a client-sent
        // X-Forwarded-For; if it overwrites, the value is equally trustworthy. Verify which on the
        // first real deploy (send a forged X-Forwarded-For and log RemoteIpAddress) before Phase 4's
        // rate limiter partitions on the client address (boo-phase1-pipeline-security-review.md #4).
        ForwardLimit = 1
    };
    forwardedHeadersOptions.KnownIPNetworks.Clear();
    forwardedHeadersOptions.KnownProxies.Clear();
    app.UseForwardedHeaders(forwardedHeadersOptions);
}

// 6a. The one site-wide header middleware (Boo P7-S1): CSP, nosniff, Referrer-Policy, framing,
// COOP/CORP, Permissions-Policy, HSTS over HTTPS outside Development (after forwarded headers, so
// it follows X-Forwarded-Proto), Cache-Control: no-store wherever nothing else set it, and
// Connection: close on /api bodies that can't be drained. Before the exception handler and static
// files, so error responses and files get it too; set in OnStarting, after the handler has cleared
// a failed response.
app.UseFireworksResponseHeaders();

// 7. Exception handler (ProblemDetails body, no stack trace).
app.UseExceptionHandler();

// 8. Development only: CORS and HTTPS redirection.
if (app.Environment.IsDevelopment())
{
    app.UseCors("FrontendDev");

    // Development-only. Railway's edge is HTTPS-only and already 301s plain HTTP itself, and always
    // sets X-Forwarded-Proto: https, so this has no job in Production. Inside the container it is
    // inert anyway (Kestrel binds HTTP only, so no port is resolvable) — but only until someone sets
    // HttpsPort/ASPNETCORE_HTTPS_PORT while debugging TLS, at which point it would start redirecting
    // Railway's deploy-time healthcheck, which requires a literal 200.
    app.UseHttpsRedirection();
}

// 9. Static files (the Angular build in wwwroot) are served by middleware and short-circuit before
// routing. When Phase 8 adds UseAuthentication/UseAuthorization, they go after UseRouting below,
// so the SPA's JS/CSS stay anonymous with no configuration. One StaticFileOptions for these and the
// fallback (step 16): hashed bundles immutable, every other served file no-cache (Boo P7-S4).
var staticFileOptions = SpaHosting.CreateStaticFileOptions();
app.UseFireworksStaticFiles(staticFileOptions);

// 10. Explicit, and load-bearing. With no UseRouting() call, WebApplicationBuilder inserts routing
// at the very FRONT of the pipeline, ahead of everything above — after which UseDefaultFiles() is
// dead code (both static-file middlewares no-op once an endpoint is matched, and
// MapFallbackToFile's {*path:nonfile} matches "/").
app.UseRouting();

// 11. Swagger, Development only.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// 11a. Rate limiting. After UseRouting, because the policies are endpoint metadata
// ([EnableRateLimiting]) and the limiter can only see them once an endpoint is selected; after
// forwarded headers (step 6), because it partitions on the client address. Phase 8's
// UseAuthentication/UseAuthorization go between UseRouting and this, so it can partition by user.
app.UseRateLimiter();

// 12. Migrate on start, then make sure the default user exists. This runs before the app listens,
// so a failed migration is a failed deploy (Railway's healthcheck never goes green), not a
// half-working app.
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<FireworksDbContext>();
    var defaultUserOptions = scope.ServiceProvider.GetRequiredService<IOptions<DefaultUserOptions>>().Value;
    await FireworksDbInitializer.InitializeAsync(dbContext, defaultUserOptions);

    // Every test window shows up in the Railway logs (Boo S28): while this is on, anyone who can
    // reach the site can list, change and delete every creation.
    if (defaultUserOptions.AllowAnonymousWrites && !app.Environment.IsDevelopment())
    {
        app.Logger.LogWarning("Anonymous writes are ON (Identity:AllowAnonymousWrites=true). Anyone who can reach this site can create, change and delete every creation.");
    }
}

// 13. Liveness and readiness. Answered by the health checks as text/plain — never by the SPA
// fallback. railway.toml's healthcheckPath must be exactly /health/live; any near-miss would be
// answered by the fallback below with 200 text/html and pass forever. Liveness runs no checks and
// is exempt from rate limiting, so the probe can never be throttled (Boo S20) and a database blip
// never restarts the app. /health/ready checks the database (503 when it's down) and is
// read-limited (Boo P7-S6).
app.MapFireworksHealthChecks();

// 14. Controllers (attribute-routed).
app.MapControllers();

// 15. Unknown /api paths must NOT fall through to the SPA fallback. MapFallbackToFile registers at
// Order = int.MaxValue with a {*path:nonfile} pattern, so a misspelled API path — no file
// extension, matching no controller route — would otherwise be answered with index.html and a 200.
// Literal controller routes outrank a {**rest} catch-all, and a default-order endpoint beats the
// int.MaxValue fallback, so this sits precisely between the two.
//
// Side effect worth knowing rather than filing as a bug later: app.Map maps every HTTP method, so
// an unsupported method on a real route (DELETE /api/me) lands here as 404 rather than 405.
// Read-limited like every other /api read, so a scanner walking 404s is throttled too (Boo S19).
app.Map("/api/{**rest}", () => Results.NotFound()).RequireRateLimiting(FireworksRateLimiting.ReadPolicy);

// 16. SPA fallback, last. Deep links (/designer, /s/{code}) get index.html and Angular routes them;
// /s/{**rest} and /c/{**rest} take a dotted last segment too (/c/..%2Fme), so the app's not-found
// page answers instead of a bare 404 (Boo P7-S7). Same StaticFileOptions as step 9 (no-cache).
// When Phase 8 adds a fallback authorization policy, these endpoints need AllowAnonymous or every
// deep link 401s before any HTML is served.
app.MapFireworksSpaFallback(staticFileOptions);

app.Run();

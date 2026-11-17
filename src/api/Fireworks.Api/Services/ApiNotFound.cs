using Fireworks.Api.Services.RateLimiting;

namespace Fireworks.Api.Services;

public static class ApiNotFound
{
    /// <summary>
    /// Program.cs step 15: unknown <c>/api</c> paths are an empty 404, never the SPA fallback.
    /// Anonymous, so a scanner learns nothing from a 401 (design §3.2), and read-limited (Boo S19).
    /// Program.cs and the test harness both call this.
    /// </summary>
    public static WebApplication MapFireworksApiNotFound(this WebApplication app)
    {
        app.Map("/api/{**rest}", () => Results.NotFound())
            .AllowAnonymous()
            .RequireRateLimiting(FireworksRateLimiting.ReadPolicy);
        return app;
    }
}

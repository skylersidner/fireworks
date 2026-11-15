using Fireworks.Api.Contracts;
using Fireworks.Api.Services.ClientConfig;
using Fireworks.Api.Services.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Fireworks.Api.Controllers;

/// <summary>
/// <c>GET api/client-config</c>: the client tuning knobs the SPA reads once at page load. Anonymous
/// and read-only, with no identity data, so it needs no service or <c>ICurrentUser</c>: it only
/// projects validated configuration into the response record. Read-limited like every other
/// <c>/api</c> read; <c>no-store</c> and <c>nosniff</c> come from <c>ApiResponseHeaders</c>.
/// </summary>
[ApiController]
[AllowAnonymous]
public sealed class ClientConfigController(IOptions<ClientPlaybackOptions> playbackOptions) : ControllerBase
{
    [HttpGet("api/client-config")]
    [EnableRateLimiting(FireworksRateLimiting.ReadPolicy)]
    public ActionResult<ClientConfigResponse> Get()
    {
        var playback = playbackOptions.Value;
        return Ok(new ClientConfigResponse(new ClientPlaybackConfig(
            playback.SeekBudgetMs,
            playback.CatchingUpDelayMs,
            playback.CheckpointIntervalSeconds,
            playback.CheckpointMemoryMiB)));
    }
}

using Fireworks.Api.Contracts;
using Fireworks.Api.Services;
using Fireworks.Api.Services.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Fireworks.Api.Controllers;

[ApiController]
public sealed class MeController(IMeService meService) : ControllerBase
{
    [HttpGet("api/me")]
    [EnableRateLimiting(FireworksRateLimiting.ReadPolicy)]
    public async Task<ActionResult<MeResponse>> Get(CancellationToken cancellationToken)
    {
        var result = await meService.GetCurrentUserAsync(cancellationToken);
        return ToActionResult(result);
    }

    private ActionResult<T> ToActionResult<T>(ServiceResult<T> result) =>
        result.IsSuccess ? Ok(result.Value) : ToErrorResult(result.Error!);

    private ActionResult ToErrorResult(ServiceError error) =>
        error.Type switch
        {
            ServiceErrorType.NotFound => NotFound(),
            ServiceErrorType.Validation => BadRequest(new { message = error.Message }),
            ServiceErrorType.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = error.Message }),
            _ => BadRequest()
        };
}

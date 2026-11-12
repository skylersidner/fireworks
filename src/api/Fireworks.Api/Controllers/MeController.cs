using Fireworks.Api.Contracts;
using Fireworks.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Fireworks.Api.Controllers;

[ApiController]
public sealed class MeController(IMeService meService) : ControllerBase
{
    [HttpGet("api/me")]
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
            _ => BadRequest()
        };
}

using Fireworks.Api.Contracts;
using Fireworks.Api.Services;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Services.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Fireworks.Api.Controllers;

/// <summary>
/// Creations (plan Phase 4, schema.md §2). Status codes: POST and remix 201; GET and PUT 200;
/// DELETE 204; 400 with <c>{ message, errors, truncated }</c> (schema.md §2.4); 403 when writes are off; 404 for an unknown or
/// malformed code, or for PUT and DELETE a creation the current user doesn't own (one fixed body
/// for all of them, Boo S9); 413 over 256 KiB; 415 for a missing or non-JSON content type; 429 when
/// rate limited.
///
/// <para>
/// <b>Write actions hand the unread body to the service</b> (<see cref="HttpCreationRequestBody"/>),
/// which runs Boo's order (S8): the <c>CanWrite</c> gate (403), the content type (415), the size
/// (413), then the envelope and document walks (schema.md §2.6). No <c>[FromBody]</c>: binding
/// answers bad JSON with MVC's ProblemDetails and lets invalid UTF-8 through (measured). No
/// <c>[Consumes]</c> either: with the <c>/api/{**rest}</c> catch-all in the route table it turns a
/// wrong type into a 404, and it lets a request with no <c>Content-Type</c> through (Boo S6,
/// measured). <c>[RequestSizeLimit]</c> raises Kestrel's 64 KiB global limit for these three
/// actions only (S1, S2).
/// </para>
///
/// <para>
/// <b>No <c>[Authorize]</c> before Phase 8</b>: no authentication scheme is registered, so a failing
/// policy would have nothing to Forbid with and would throw. The service's <c>CanWrite</c> check is
/// the gate.
/// </para>
/// </summary>
[ApiController]
public sealed class CreationsController(ICreationService creationService) : ControllerBase
{
    /// <summary>
    /// <see cref="ShareCodeRouteConstraint"/>, an ordinal per-character check. Not
    /// <c>regex(...)</c>: the built-in regex constraint is case-insensitive, so <c>abcdefgl</c> and
    /// the Kelvin sign reached the action (Boo S14, measured). A code that fails it falls through to
    /// the <c>/api/{**rest}</c> 404 with no database query.
    /// </summary>
    public const string ShareCodeSegment = "{shareCode:" + ShareCodeRouteConstraint.Name + "}";

    private const string ItemRoute = "api/creations/" + ShareCodeSegment;

    [HttpPost("api/creations")]
    [RequestSizeLimit(CreationLimits.MaxRequestBytes)]
    [EnableRateLimiting(FireworksRateLimiting.WritePolicy)]
    public async Task<ActionResult<CreationResponse>> Create(CancellationToken cancellationToken)
    {
        var result = await creationService.CreateAsync(new HttpCreationRequestBody(Request), cancellationToken);
        return result.IsSuccess
            ? CreatedAtAction(nameof(Get), new { shareCode = result.Value!.ShareCode }, result.Value)
            : ToErrorResult(result.Error!);
    }

    [HttpGet(ItemRoute)]
    [EnableRateLimiting(FireworksRateLimiting.ReadPolicy)]
    public async Task<ActionResult<CreationResponse>> Get(string shareCode, CancellationToken cancellationToken)
    {
        var result = await creationService.GetAsync(shareCode, cancellationToken);
        return ToActionResult(result);
    }

    [HttpPut(ItemRoute)]
    [RequestSizeLimit(CreationLimits.MaxRequestBytes)]
    [EnableRateLimiting(FireworksRateLimiting.WritePolicy)]
    public async Task<ActionResult<CreationResponse>> Update(string shareCode, CancellationToken cancellationToken)
    {
        var result = await creationService.UpdateOwnedAsync(shareCode, new HttpCreationRequestBody(Request), cancellationToken);
        return ToActionResult(result);
    }

    [HttpDelete(ItemRoute)]
    [EnableRateLimiting(FireworksRateLimiting.WritePolicy)]
    public async Task<ActionResult> Delete(string shareCode, CancellationToken cancellationToken)
    {
        var result = await creationService.DeleteOwnedAsync(shareCode, cancellationToken);
        return result.IsSuccess ? NoContent() : ToErrorResult(result.Error!);
    }

    [HttpPost(ItemRoute + "/remix")]
    [RequestSizeLimit(CreationLimits.MaxRequestBytes)]
    [EnableRateLimiting(FireworksRateLimiting.WritePolicy)]
    public async Task<ActionResult<CreationResponse>> Remix(string shareCode, CancellationToken cancellationToken)
    {
        var result = await creationService.RemixAsync(shareCode, new HttpCreationRequestBody(Request), cancellationToken);
        return result.IsSuccess
            ? CreatedAtAction(nameof(Get), new { shareCode = result.Value!.ShareCode }, result.Value)
            : ToErrorResult(result.Error!);
    }

    /// <summary>
    /// The current user's creations (schema.md §2.2.1). <c>page</c>, <c>pageSize</c> and
    /// <c>kind</c> are read raw from <c>Request.Query</c>, never model-bound: binding turns
    /// <c>kind=</c> into null ("no filter"), binds <c>kind=shell&amp;kind=show</c> as <c>shell</c>, and
    /// answers <c>page=abc</c> with MVC's ProblemDetails instead of the §2.4 body (Yoshi, measured).
    /// </summary>
    [HttpGet("api/me/creations")]
    [EnableRateLimiting(FireworksRateLimiting.ReadPolicy)]
    public async Task<ActionResult<CreationListPage>> ListMine(CancellationToken cancellationToken)
    {
        var query = new CreationListQuery(Raw("page"), Raw("pageSize"), Raw("kind"));
        var result = await creationService.ListMineAsync(query, cancellationToken);
        return ToActionResult(result);
    }

    /// <summary>Null when the parameter is absent; otherwise every value given (an empty <c>kind=</c> is one empty value).</summary>
    private string?[]? Raw(string name) =>
        Request.Query.TryGetValue(name, out var values) ? values.ToArray() : null;

    private ActionResult<T> ToActionResult<T>(ServiceResult<T> result) =>
        result.IsSuccess ? Ok(result.Value) : ToErrorResult(result.Error!);

    private ActionResult ToErrorResult(ServiceError error) =>
        error.Type switch
        {
            // Fixed body, never the service's message: a missing row and someone else's row must be
            // byte-identical (Boo S9).
            ServiceErrorType.NotFound => NotFound(new { message = CreationService.NotFoundMessage }),
            ServiceErrorType.Validation when error.Issues is { } issues =>
                BadRequest(ValidationErrorResponse.From(error.Message, issues)),
            ServiceErrorType.Validation => BadRequest(new { message = error.Message }),
            ServiceErrorType.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = error.Message }),
            ServiceErrorType.UnsupportedMediaType => StatusCode(StatusCodes.Status415UnsupportedMediaType),
            ServiceErrorType.PayloadTooLarge => StatusCode(StatusCodes.Status413PayloadTooLarge),
            ServiceErrorType.Conflict => Conflict(new { message = error.Message }),
            _ => BadRequest()
        };
}

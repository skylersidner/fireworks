using System.Text.Json;

namespace Fireworks.Api.Contracts;

// ---------------------------------------------------------------------------------------------
// Document types (docs/fireworks-app/schema.md §3, §4). These are BUILT by
// CreationDocumentValidator's walk over a JsonElement, never deserialized from a request: STJ
// deserialization stops at the first unknown member, reports its own paths, and rejects a valid
// 120.0 for an int (schema.md §6.5). Serialized camelCase with nulls omitted, so an absent shell
// `sky` or cue `burstHeight` stays absent and a stored document never contains null (§1).
// ---------------------------------------------------------------------------------------------

public sealed record SkyDto(double Gravity, double Wind);

public sealed record BreakDto(
    string Pattern,
    int Stars,
    double Speed,
    string Color1,
    string Color2,
    double ChangeAt,
    double Burn,
    double Drag,
    double Size,
    string Trail,
    string Effect,
    double Delay);

/// <summary>A ShellDocument v1, or (with <see cref="Sky"/> null) a show's embedded shell.</summary>
public sealed record ShellDocumentDto(
    int Version,
    string Name,
    double BurstHeight,
    double AngleJitter,
    SkyDto? Sky,
    IReadOnlyList<BreakDto> Breaks);

public sealed record CueDto(string Id, double T, string Shell, double X, double? BurstHeight, int Seed);

public sealed record ShowDocumentDto(
    int Version,
    string Name,
    SkyDto Sky,
    double Duration,
    IReadOnlyDictionary<string, ShellDocumentDto> Shells,
    IReadOnlyList<CueDto> Cues);

// ---------------------------------------------------------------------------------------------
// Requests (schema.md §2.3). Built by CreationEnvelopeReader's envelope walk (§2.6) over the raw
// body, not by model binding, so these records state exactly what each endpoint accepts: POST has
// `kind` and `document`; PUT and remix have `document` only, and a `kind` there is
// (kind, unknown-property). `Document` is a self-contained clone, walked later by the validator
// for the request's (POST) or the stored (PUT, remix) kind.
// ---------------------------------------------------------------------------------------------

/// <summary><c>POST api/creations</c>: <c>{ kind, document }</c>.</summary>
public sealed record CreateCreationRequest(string Kind, JsonElement Document);

/// <summary><c>PUT api/creations/{shareCode}</c>: <c>{ document }</c>, validated against the stored kind.</summary>
public sealed record UpdateCreationRequest(JsonElement Document);

/// <summary>
/// <c>POST api/creations/{shareCode}/remix</c>: <c>{ document }</c>, the visitor's edited working
/// copy (schema.md §11.4), validated against the source's kind. Never an empty copy of the source.
/// </summary>
public sealed record RemixCreationRequest(JsonElement Document);

// ---------------------------------------------------------------------------------------------
// Responses (schema.md §2.1, §2.2, §2.2.1).
// ---------------------------------------------------------------------------------------------

/// <summary>
/// Every endpoint that returns one creation. <c>remixedFrom</c> is always present: the source's
/// share code when the current user owns this creation and the source still exists, otherwise
/// <c>null</c> (Skyler, Q3).
/// </summary>
public sealed record CreationResponse(
    string ShareCode,
    string Kind,
    string Name,
    int SchemaVersion,
    JsonElement Document,
    bool IsOwner,
    string? RemixedFrom,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>A My creations card: no document, just the stored, write-time palette (OQ14).</summary>
public sealed record CreationListItem(
    string ShareCode,
    string Kind,
    string Name,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<string> Palette);

/// <summary>
/// <c>GET api/me/creations</c>: the reference's <c>PagedSearchResultResponse</c> shape with our
/// item type. <c>page</c> and <c>pageSize</c> are the effective (clamped) values (§2.2.1).
/// </summary>
public sealed record CreationListPage(
    IReadOnlyList<CreationListItem> Items,
    int Page,
    int PageSize,
    int TotalCount);

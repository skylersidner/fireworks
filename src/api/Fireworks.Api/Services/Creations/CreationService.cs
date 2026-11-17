using System.Text.Json;
using Fireworks.Api.Contracts;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services.Identity;

namespace Fireworks.Api.Services.Creations;

public interface ICreationService
{
    /// <summary><c>POST api/creations</c>. <paramref name="body"/> is the unread request body (schema.md §2.6).</summary>
    Task<ServiceResult<CreationResponse>> CreateAsync(ICreationRequestBody body, CancellationToken cancellationToken);

    /// <summary><c>GET api/creations/{shareCode}</c>. Public: no identity needed.</summary>
    Task<ServiceResult<CreationResponse>> GetAsync(string shareCode, CancellationToken cancellationToken);

    /// <summary>
    /// <c>PUT api/creations/{shareCode}</c>: replace the document of a creation the current user
    /// owns, if it is still the version <paramref name="ifMatch"/> names (schema.md §11.4).
    /// </summary>
    Task<ServiceResult<CreationResponse>> UpdateOwnedAsync(
        string shareCode, IfMatchPrecondition ifMatch, ICreationRequestBody body, CancellationToken cancellationToken);

    /// <summary><c>DELETE api/creations/{shareCode}</c>: delete a creation the current user owns.</summary>
    Task<ServiceResult<bool>> DeleteOwnedAsync(string shareCode, CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST api/creations/{shareCode}/remix</c>: save the body's document as a NEW creation owned
    /// by the current user, with <c>remixedFrom</c> set to the source. Never changes the source.
    /// </summary>
    Task<ServiceResult<CreationResponse>> RemixAsync(string sourceShareCode, ICreationRequestBody body, CancellationToken cancellationToken);

    /// <summary><c>GET api/me/creations</c>, from the raw query (schema.md §2.2.1).</summary>
    Task<ServiceResult<CreationListPage>> ListMineAsync(CreationListQuery query, CancellationToken cancellationToken);
}

/// <summary>
/// Creations (plan Phase 4, schema.md §2, §10).
///
/// <para>
/// <b>The write gate lives here, first, on every write path and on "my creations":</b>
/// <c>CanWrite &amp;&amp; UserId != null</c>, else <see cref="ServiceErrorType.Forbidden"/> (403),
/// before the body is even parsed. Client-side hiding and controller attributes are not the gate.
/// Identity comes only from <see cref="ICurrentUser"/>; the owner is never a request field.
/// </para>
///
/// <para>
/// A creation the current user doesn't own is <see cref="ServiceErrorType.NotFound"/> for PUT and
/// DELETE (filtered on share code AND owner in one query), so a non-owner can't tell "exists" from
/// "doesn't". The envelope is checked before the lookup, which keeps that property: an envelope
/// error doesn't depend on whether the creation exists.
/// </para>
/// </summary>
public sealed class CreationService(
    ICurrentUser currentUser,
    ICreationRepository repository,
    IShareCodeGenerator shareCodeGenerator,
    ILogger<CreationService> logger) : ICreationService
{
    /// <summary>schema.md §9: up to 5 codes, then a 500. At 58^8 codes, a single retry is worth a log line.</summary>
    public const int MaxShareCodeAttempts = 5;


    private const string WritesOffMessage = "Sign in to save.";
    private const string PreconditionRequiredMessage = "If-Match is required: send the ETag you last read.";
    public const string PreconditionFailedMessage = "This creation changed since you loaded it.";
    private const string RequestInvalidMessage = "The request is invalid.";
    private const string DocumentInvalidMessage = "The document is invalid.";

    /// <summary>
    /// One message for every creation 404: unknown code, malformed code, and someone else's
    /// creation look identical (schema.md §10, Boo S9).
    /// </summary>
    public const string NotFoundMessage = "No creation has that share code.";

    public async Task<ServiceResult<CreationResponse>> CreateAsync(ICreationRequestBody body, CancellationToken cancellationToken)
    {
        if (!TryGetWriter(out var userId))
        {
            return ServiceResult<CreationResponse>.Forbidden(WritesOffMessage);
        }

        var (bytes, bodyError) = await ReadBodyAsync(body, cancellationToken);
        if (bodyError is not null)
        {
            return ServiceResult<CreationResponse>.Failure(bodyError);
        }

        var envelope = CreationEnvelopeReader.ReadCreate(bytes);
        if (!envelope.IsValid)
        {
            return ServiceResult<CreationResponse>.Validation(RequestInvalidMessage, envelope.Errors);
        }

        var kind = envelope.Request!.Kind == "shell" ? CreationKind.Shell : CreationKind.Show;
        var (content, errors) = Validate(kind, envelope.Request.Document);
        if (content is null)
        {
            return ServiceResult<CreationResponse>.Validation(DocumentInvalidMessage, errors);
        }

        // Never null: only a remix can lose its source.
        var creation = await InsertWithFreshShareCodeAsync(userId, kind, content, source: null, cancellationToken);
        return ServiceResult<CreationResponse>.Success(ToResponse(creation!, sourceShareCode: null));
    }

    public async Task<ServiceResult<CreationResponse>> GetAsync(string shareCode, CancellationToken cancellationToken)
    {
        if (!ShareCodes.IsValid(shareCode))
        {
            return ServiceResult<CreationResponse>.NotFound(NotFoundMessage);
        }

        var creation = await repository.FindByShareCodeAsync(shareCode, cancellationToken);
        return creation is null
            ? ServiceResult<CreationResponse>.NotFound(NotFoundMessage)
            : ServiceResult<CreationResponse>.Success(ToResponse(creation, creation.RemixedFrom?.ShareCode));
    }

    public async Task<ServiceResult<CreationResponse>> UpdateOwnedAsync(
        string shareCode, IfMatchPrecondition ifMatch, ICreationRequestBody body, CancellationToken cancellationToken)
    {
        if (!TryGetWriter(out var userId))
        {
            return ServiceResult<CreationResponse>.Forbidden(WritesOffMessage);
        }

        // 428 fires whether or not the row exists, so it reveals nothing (Boo A29). Header only:
        // the body is still unread.
        if (!ifMatch.Present)
        {
            return ServiceResult<CreationResponse>.Failure(
                new ServiceError(ServiceErrorType.PreconditionRequired, PreconditionRequiredMessage));
        }

        var (bytes, bodyError) = await ReadBodyAsync(body, cancellationToken);
        if (bodyError is not null)
        {
            return ServiceResult<CreationResponse>.Failure(bodyError);
        }

        var envelope = CreationEnvelopeReader.ReadUpdate(bytes);
        if (!envelope.IsValid)
        {
            return ServiceResult<CreationResponse>.Validation(RequestInvalidMessage, envelope.Errors);
        }

        // Owner-filtered: the stored kind picks the validator, and someone else's creation is a
        // plain 404 before its document is ever looked at.
        if (!ShareCodes.IsValid(shareCode))
        {
            return ServiceResult<CreationResponse>.NotFound(NotFoundMessage);
        }

        var existing = await repository.FindOwnedAsync(shareCode, userId, cancellationToken);
        if (existing is null)
        {
            return ServiceResult<CreationResponse>.NotFound(NotFoundMessage);
        }

        var (content, errors) = Validate(existing.Kind, envelope.Request!.Document);
        if (content is null)
        {
            return ServiceResult<CreationResponse>.Validation(DocumentInvalidMessage, errors);
        }

        // 412 only from here on: after the owner-filtered 404 and the document walk, so only the
        // owner can ever see it (schema.md §2.6 step 8).
        if (ifMatch.Tag is not { } expected)
        {
            return PreconditionFailed(existing.UpdatedAt);
        }

        var outcome = await repository.UpdateOwnedAsync(shareCode, userId, content, expected, cancellationToken);
        if (outcome.Updated is { } updated)
        {
            return ServiceResult<CreationResponse>.Success(ToResponse(updated, updated.RemixedFrom?.ShareCode));
        }

        return outcome.CurrentUpdatedAt is { } current
            ? PreconditionFailed(current)
            : ServiceResult<CreationResponse>.NotFound(NotFoundMessage);
    }

    private static ServiceResult<CreationResponse> PreconditionFailed(DateTimeOffset current) =>
        ServiceResult<CreationResponse>.Failure(
            new ServiceError(ServiceErrorType.PreconditionFailed, PreconditionFailedMessage, CurrentUpdatedAt: current));

    public async Task<ServiceResult<bool>> DeleteOwnedAsync(string shareCode, CancellationToken cancellationToken)
    {
        if (!TryGetWriter(out var userId))
        {
            return ServiceResult<bool>.Forbidden(WritesOffMessage);
        }

        if (!ShareCodes.IsValid(shareCode))
        {
            return ServiceResult<bool>.NotFound(NotFoundMessage);
        }

        return await repository.DeleteOwnedAsync(shareCode, userId, cancellationToken)
            ? ServiceResult<bool>.Success(true)
            : ServiceResult<bool>.NotFound(NotFoundMessage);
    }

    public async Task<ServiceResult<CreationResponse>> RemixAsync(
        string sourceShareCode, ICreationRequestBody body, CancellationToken cancellationToken)
    {
        if (!TryGetWriter(out var userId))
        {
            return ServiceResult<CreationResponse>.Forbidden(WritesOffMessage);
        }

        var (bytes, bodyError) = await ReadBodyAsync(body, cancellationToken);
        if (bodyError is not null)
        {
            return ServiceResult<CreationResponse>.Failure(bodyError);
        }

        var envelope = CreationEnvelopeReader.ReadRemix(bytes);
        if (!envelope.IsValid)
        {
            return ServiceResult<CreationResponse>.Validation(RequestInvalidMessage, envelope.Errors);
        }

        // Any owner: a remix needs CanWrite, never ownership of the source (schema.md §2.3).
        if (!ShareCodes.IsValid(sourceShareCode))
        {
            return ServiceResult<CreationResponse>.NotFound(NotFoundMessage);
        }

        var source = await repository.FindByShareCodeAsync(sourceShareCode, cancellationToken);
        if (source is null)
        {
            return ServiceResult<CreationResponse>.NotFound(NotFoundMessage);
        }

        var (content, errors) = Validate(source.Kind, envelope.Request!.Document);
        if (content is null)
        {
            return ServiceResult<CreationResponse>.Validation(DocumentInvalidMessage, errors);
        }

        // Null when the source was deleted after the lookup above (Yoshi D2): the same fixed 404 as
        // a lookup that missed, not a foreign-key 500.
        var remix = await InsertWithFreshShareCodeAsync(userId, source.Kind, content, source, cancellationToken);
        return remix is null
            ? ServiceResult<CreationResponse>.NotFound(NotFoundMessage)
            : ServiceResult<CreationResponse>.Success(ToResponse(remix, source.ShareCode));
    }

    public async Task<ServiceResult<CreationListPage>> ListMineAsync(CreationListQuery query, CancellationToken cancellationToken)
    {
        // Same gate as the writes, before any query. After Phase 8 the fallback policy's 401 comes
        // first, so this is defense in depth.
        if (!TryGetWriter(out var userId))
        {
            return ServiceResult<CreationListPage>.Forbidden("Sign in to see your creations.");
        }

        var (effectivePage, effectivePageSize, kindFilter, issues) = query.Parse();
        if (issues.Count > 0)
        {
            return ServiceResult<CreationListPage>.Validation(RequestInvalidMessage, issues);
        }

        // Clamped, not rejected, and the response echoes the effective values (§2.2.1). The offset
        // is computed in long, so page=2147483647 can't overflow into a negative OFFSET.
        var offset = (long)(effectivePage - 1) * effectivePageSize;

        var totalCount = await repository.CountOwnedAsync(userId, kindFilter, cancellationToken);
        if (offset >= totalCount)
        {
            // Past the end: an empty page with the real total, and no OFFSET query at all.
            return ServiceResult<CreationListPage>.Success(new CreationListPage([], effectivePage, effectivePageSize, totalCount));
        }

        var rows = await repository.ListOwnedPageAsync(userId, kindFilter, (int)offset, effectivePageSize, cancellationToken);
        var items = rows
            .Select(row => new CreationListItem(row.ShareCode, KindName(row.Kind), row.Name, row.UpdatedAt, row.Palette))
            .ToList();
        return ServiceResult<CreationListPage>.Success(new CreationListPage(items, effectivePage, effectivePageSize, totalCount));
    }

    // ---- internals ------------------------------------------------------------------------------

    /// <summary>Steps 1-2 of schema.md §2.6, after the gate: 415 for a non-JSON or missing type, 413 over the limit.</summary>
    private static async Task<(ReadOnlyMemory<byte> Bytes, ServiceError? Error)> ReadBodyAsync(
        ICreationRequestBody body, CancellationToken cancellationToken)
    {
        if (!body.HasJsonContentType)
        {
            return (default, new ServiceError(ServiceErrorType.UnsupportedMediaType, "The body must be application/json."));
        }

        var bytes = await body.ReadAsync(cancellationToken);
        return bytes is { } read
            ? (read, null)
            : (default, new ServiceError(ServiceErrorType.PayloadTooLarge, "The body is over the 256 KiB limit."));
    }

    private static string Echo(string raw) => CreationDocumentValidator.Echo(raw);

    /// <summary>The write gate: <c>CanWrite</c> implies a user, but both are checked (plan §3.4).</summary>
    private bool TryGetWriter(out Guid userId)
    {
        if (currentUser.CanWrite && currentUser.UserId is { } id)
        {
            userId = id;
            return true;
        }

        userId = Guid.Empty;
        return false;
    }

    /// <summary>
    /// The strict document walk for <paramref name="kind"/>, and on success everything stored:
    /// the canonical JSON and the write-time columns (schema.md §2.2, §8.1).
    /// </summary>
    private static (CreationContent? Content, IReadOnlyList<ValidationIssue> Errors) Validate(CreationKind kind, JsonElement document)
    {
        if (kind == CreationKind.Shell)
        {
            var shell = CreationDocumentValidator.ValidateShell(document);
            return shell.Document is { } dto
                ? (new CreationContent(dto.Name, dto.Version, CreationDocuments.PaletteOf(dto), CreationDocuments.Serialize(dto)), [])
                : (null, shell.Errors);
        }

        var show = CreationDocumentValidator.ValidateShow(document);
        return show.Document is { } showDto
            ? (new CreationContent(showDto.Name, showDto.Version, CreationDocuments.PaletteOf(showDto), CreationDocuments.Serialize(showDto)), [])
            : (null, show.Errors);
    }

    /// <summary>The inserted creation, or <c>null</c> when <paramref name="source"/> was deleted before the insert.</summary>
    private async Task<Creation?> InsertWithFreshShareCodeAsync(
        Guid ownerUserId, CreationKind kind, CreationContent content, Creation? source, CancellationToken cancellationToken)
    {
        for (var attempt = 1; attempt <= MaxShareCodeAttempts; attempt++)
        {
            var creation = new Creation
            {
                Id = Guid.CreateVersion7(),
                ShareCode = shareCodeGenerator.NewCode(),
                Kind = kind,
                Name = content.Name,
                SchemaVersion = content.SchemaVersion,
                Palette = content.Palette,
                Document = content.Document,
                OwnerUserId = ownerUserId,
                RemixedFromId = source?.Id
            };

            switch (await repository.TryInsertAsync(creation, cancellationToken))
            {
                case InsertOutcome.Inserted:
                    return creation;
                case InsertOutcome.RemixSourceGone:
                    return null;
            }

            logger.LogWarning("Share code collision on attempt {Attempt} of {MaxAttempts}; retrying with a new code.",
                attempt, MaxShareCodeAttempts);
        }

        throw new InvalidOperationException($"No free share code after {MaxShareCodeAttempts} attempts.");
    }

    private CreationResponse ToResponse(Creation creation, string? sourceShareCode)
    {
        var isOwner = currentUser.UserId is { } userId && userId == creation.OwnerUserId;
        return new CreationResponse(
            creation.ShareCode,
            KindName(creation.Kind),
            creation.Name,
            creation.SchemaVersion,
            // Deserialize<JsonElement> returns a self-contained element (no JsonDocument to dispose).
            JsonSerializer.Deserialize<JsonElement>(creation.Document),
            isOwner,
            // Visible only to the remix's owner (Skyler, Q3); null when not a remix or the source is gone.
            isOwner ? sourceShareCode : null,
            creation.CreatedAt,
            creation.UpdatedAt);
    }

    private static string KindName(CreationKind kind) => kind == CreationKind.Shell ? "shell" : "show";
}

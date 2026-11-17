using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Repositories;

/// <summary>The write-time columns and the canonical document, computed by the service from a validated document.</summary>
public sealed record CreationContent(string Name, int SchemaVersion, List<string> Palette, string Document);

/// <summary>One card on My creations; no document.</summary>
public sealed record CreationListRow(string ShareCode, CreationKind Kind, string Name, DateTimeOffset UpdatedAt, List<string> Palette);

/// <summary>What <see cref="ICreationRepository.TryInsertAsync"/> found true after the attempt.</summary>
public enum InsertOutcome
{
    /// <summary>The row now exists.</summary>
    Inserted,

    /// <summary>The share code was already taken; nothing was stored. The caller retries with a new code.</summary>
    ShareCodeTaken,

    /// <summary>
    /// A remix whose source was deleted after the caller looked it up; nothing was stored. The
    /// caller answers as it would have had the lookup missed (the fixed 404).
    /// </summary>
    RemixSourceGone
}

/// <summary>What <see cref="ICreationRepository.UpdateOwnedAsync"/> found true after the attempt.</summary>
/// <param name="Updated">The updated creation, when the update happened.</param>
/// <param name="CurrentUpdatedAt">When the row is present and owned but its <c>updated_at</c> wasn't the expected one: the current value (412).</param>
public sealed record UpdateOutcome(Creation? Updated, DateTimeOffset? CurrentUpdatedAt)
{
    public static readonly UpdateOutcome NotFound = new(null, null);
}

public interface ICreationRepository
{
    /// <summary>The creation with this share code, any owner, with its remix source loaded; or <c>null</c>. Not tracked.</summary>
    Task<Creation?> FindByShareCodeAsync(string shareCode, CancellationToken cancellationToken);

    /// <summary>
    /// The creation with this share code <b>and</b> this owner, in one query; <c>null</c> when it
    /// doesn't exist or belongs to someone else (the caller can't tell which). Not tracked.
    /// </summary>
    Task<Creation?> FindOwnedAsync(string shareCode, Guid ownerUserId, CancellationToken cancellationToken);

    /// <summary>
    /// Inserts <paramref name="creation"/> and reports what is true afterwards: inserted, share
    /// code taken, or (for a remix) source gone. Any other failure throws.
    /// </summary>
    Task<InsertOutcome> TryInsertAsync(Creation creation, CancellationToken cancellationToken);

    /// <summary>
    /// Replaces the content of the creation with this share code and owner (filtered together in
    /// one query) and bumps <c>updated_at</c>, <b>only if</b> its <c>updated_at</c> is still
    /// <paramref name="expectedUpdatedAt"/>: the comparison is in the UPDATE's own WHERE clause
    /// (<c>updated_at</c> is a concurrency token), never a read followed by a write (schema.md §2.6
    /// step 8). Outcomes: updated; <see cref="UpdateOutcome.NotFound"/> when there is no such row
    /// for this owner; or the current <c>updated_at</c> when the row is there but changed (412).
    /// Writes only the content columns and <c>updated_at</c>: never <c>remixed_from_id</c>, which
    /// the database may have nulled since the load (ON DELETE SET NULL).
    /// </summary>
    Task<UpdateOutcome> UpdateOwnedAsync(
        string shareCode, Guid ownerUserId, CreationContent content, DateTimeOffset expectedUpdatedAt, CancellationToken cancellationToken);

    /// <summary>Deletes the creation with this share code and owner; <c>false</c> when there was no such row for this owner.</summary>
    Task<bool> DeleteOwnedAsync(string shareCode, Guid ownerUserId, CancellationToken cancellationToken);

    /// <summary>How many creations the owner has, optionally of one kind.</summary>
    Task<int> CountOwnedAsync(Guid ownerUserId, CreationKind? kind, CancellationToken cancellationToken);

    /// <summary>
    /// One page of the owner's creations, <c>updated_at</c> descending then <c>share_code</c>
    /// ascending (ordinal: the column is <c>COLLATE "C"</c> on Postgres, BINARY on SQLite).
    /// </summary>
    Task<IReadOnlyList<CreationListRow>> ListOwnedPageAsync(
        Guid ownerUserId, CreationKind? kind, int skip, int take, CancellationToken cancellationToken);
}

/// <summary>
/// Plain LINQ only (no provider functions, no SQLSTATE filters), so the SQLite tests exercise the
/// same queries Postgres runs (<c>bowser-provider-agnostic-queries.md</c>). Every call is sequential
/// on the one scoped context.
/// </summary>
public sealed class CreationRepository(FireworksDbContext dbContext) : ICreationRepository
{
    public Task<Creation?> FindByShareCodeAsync(string shareCode, CancellationToken cancellationToken) =>
        dbContext.Creations.AsNoTracking()
            .Include(c => c.RemixedFrom)
            .SingleOrDefaultAsync(c => c.ShareCode == shareCode, cancellationToken);

    public Task<Creation?> FindOwnedAsync(string shareCode, Guid ownerUserId, CancellationToken cancellationToken) =>
        dbContext.Creations.AsNoTracking()
            .Include(c => c.RemixedFrom)
            .SingleOrDefaultAsync(c => c.ShareCode == shareCode && c.OwnerUserId == ownerUserId, cancellationToken);

    public async Task<InsertOutcome> TryInsertAsync(Creation creation, CancellationToken cancellationToken)
    {
        dbContext.Creations.Add(creation);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return InsertOutcome.Inserted;
        }
        catch (DbUpdateException)
        {
            // Race guard on the desired state, not a vendor error code (boo-race-guards-check-
            // desired-state.md): detach, then ask what is true now.
            dbContext.Entry(creation).State = EntityState.Detached;
            if (await dbContext.Creations.AnyAsync(c => c.Id == creation.Id, cancellationToken))
            {
                return InsertOutcome.Inserted;
            }

            // A remix's source deleted between the service's lookup and this insert fails the
            // remixed_from_id foreign key. Checked before the share code: a retry can't fix it.
            if (creation.RemixedFromId is { } sourceId
                && !await dbContext.Creations.AnyAsync(c => c.Id == sourceId, cancellationToken))
            {
                return InsertOutcome.RemixSourceGone;
            }

            var code = creation.ShareCode;
            if (await dbContext.Creations.AnyAsync(c => c.ShareCode == code, cancellationToken))
            {
                return InsertOutcome.ShareCodeTaken;
            }

            throw;
        }
    }

    public async Task<UpdateOutcome> UpdateOwnedAsync(
        string shareCode, Guid ownerUserId, CreationContent content, DateTimeOffset expectedUpdatedAt, CancellationToken cancellationToken)
    {
        var creation = await dbContext.Creations
            .Include(c => c.RemixedFrom)
            .SingleOrDefaultAsync(c => c.ShareCode == shareCode && c.OwnerUserId == ownerUserId, cancellationToken);
        if (creation is null)
        {
            return UpdateOutcome.NotFound;
        }

        creation.Name = content.Name;
        creation.SchemaVersion = content.SchemaVersion;
        creation.Palette = content.Palette;
        creation.Document = content.Document;

        // Only these four are written (plus updated_at, below). Not State = Modified: that writes
        // every column back, remixed_from_id included, and if the source was deleted since the load
        // the database has already nulled it, so writing the stale id fails the foreign key (Yoshi
        // D1). Marked even when byte-identical: "Update original" always refreshes updated_at
        // (schema.md §11.4), and marking a property puts the entry in the Modified state, which is
        // what ApplyTimestamps stamps.
        var entry = dbContext.Entry(creation);
        entry.Property(c => c.Name).IsModified = true;
        entry.Property(c => c.SchemaVersion).IsModified = true;
        entry.Property(c => c.Palette).IsModified = true;
        entry.Property(c => c.Document).IsModified = true;

        // If-Match: the concurrency token's ORIGINAL value is what the UPDATE's WHERE compares, so
        // it is the client's tag, not the value just loaded. Even when the two already differ, the
        // UPDATE runs and matches zero rows: one code path, decided by the database.
        entry.Property(c => c.UpdatedAt).OriginalValue = expectedUpdatedAt;

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return new UpdateOutcome(creation, null);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Zero rows: a concurrent DELETE won, or updated_at isn't the expected tag (a stale
            // client, or a concurrent PUT that won). Re-check the desired state
            // (boo-race-guards-check-desired-state.md): present and owned is 412, else 404.
            dbContext.Entry(creation).State = EntityState.Detached;
            var current = await dbContext.Creations.AsNoTracking()
                .Where(c => c.ShareCode == shareCode && c.OwnerUserId == ownerUserId)
                .Select(c => (DateTimeOffset?)c.UpdatedAt)
                .SingleOrDefaultAsync(cancellationToken);
            return current is { } updatedAt ? new UpdateOutcome(null, updatedAt) : UpdateOutcome.NotFound;
        }
    }

    public async Task<bool> DeleteOwnedAsync(string shareCode, Guid ownerUserId, CancellationToken cancellationToken) =>
        await dbContext.Creations
            .Where(c => c.ShareCode == shareCode && c.OwnerUserId == ownerUserId)
            .ExecuteDeleteAsync(cancellationToken) > 0;

    public Task<int> CountOwnedAsync(Guid ownerUserId, CreationKind? kind, CancellationToken cancellationToken) =>
        Owned(ownerUserId, kind).CountAsync(cancellationToken);

    public async Task<IReadOnlyList<CreationListRow>> ListOwnedPageAsync(
        Guid ownerUserId, CreationKind? kind, int skip, int take, CancellationToken cancellationToken) =>
        await Owned(ownerUserId, kind)
            .OrderByDescending(c => c.UpdatedAt)
            .ThenBy(c => c.ShareCode)
            .Skip(skip)
            .Take(take)
            .Select(c => new CreationListRow(c.ShareCode, c.Kind, c.Name, c.UpdatedAt, c.Palette))
            .ToListAsync(cancellationToken);

    private IQueryable<Creation> Owned(Guid ownerUserId, CreationKind? kind)
    {
        var query = dbContext.Creations.AsNoTracking().Where(c => c.OwnerUserId == ownerUserId);
        return kind is { } onlyKind ? query.Where(c => c.Kind == onlyKind) : query;
    }
}

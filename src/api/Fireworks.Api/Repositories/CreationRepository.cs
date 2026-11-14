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
    /// one query) and bumps <c>updated_at</c>; <c>null</c> when there is no such row for this owner.
    /// Writes only the content columns and <c>updated_at</c>: never <c>remixed_from_id</c>, which
    /// the database may have nulled since the load (ON DELETE SET NULL).
    /// </summary>
    Task<Creation?> UpdateOwnedAsync(string shareCode, Guid ownerUserId, CreationContent content, CancellationToken cancellationToken);

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

    public async Task<Creation?> UpdateOwnedAsync(
        string shareCode, Guid ownerUserId, CreationContent content, CancellationToken cancellationToken)
    {
        var creation = await dbContext.Creations
            .Include(c => c.RemixedFrom)
            .SingleOrDefaultAsync(c => c.ShareCode == shareCode && c.OwnerUserId == ownerUserId, cancellationToken);
        if (creation is null)
        {
            return null;
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

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return creation;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Zero rows updated: a concurrent DELETE won. If the row is really gone, that's the
            // honest answer (404), not a 500.
            dbContext.Entry(creation).State = EntityState.Detached;
            if (!await dbContext.Creations.AnyAsync(c => c.ShareCode == shareCode && c.OwnerUserId == ownerUserId, cancellationToken))
            {
                return null;
            }

            throw;
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

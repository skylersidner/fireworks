using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Services.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace Fireworks.Api.Tests.Support;

/// <summary>Every repository call, by method name, for exact-ledger assertions (testing §2).</summary>
internal sealed class CallLedger
{
    private readonly List<string> calls = [];

    public void Record(string call)
    {
        lock (calls)
        {
            calls.Add(call);
        }
    }

    public IReadOnlyList<string> Calls
    {
        get { lock (calls) { return calls.Order(StringComparer.Ordinal).ToList(); } }
    }

    public void Clear()
    {
        lock (calls)
        {
            calls.Clear();
        }
    }
}

/// <summary>The real repository, with every call recorded. For HTTP tests that assert "no query".</summary>
internal sealed class RecordingCreationRepository(ICreationRepository inner, CallLedger ledger) : ICreationRepository
{
    public static void Register(IServiceCollection services, CallLedger ledger)
    {
        services.AddSingleton(ledger);
        services.AddScoped<ICreationRepository>(sp =>
            new RecordingCreationRepository(new CreationRepository(sp.GetRequiredService<FireworksDbContext>()), ledger));
    }

    public Task<Creation?> FindByShareCodeAsync(string shareCode, CancellationToken ct) { ledger.Record(nameof(FindByShareCodeAsync)); return inner.FindByShareCodeAsync(shareCode, ct); }
    public Task<Creation?> FindOwnedAsync(string shareCode, Guid owner, CancellationToken ct) { ledger.Record(nameof(FindOwnedAsync)); return inner.FindOwnedAsync(shareCode, owner, ct); }
    public Task<InsertOutcome> TryInsertAsync(Creation creation, CancellationToken ct) { ledger.Record(nameof(TryInsertAsync)); return inner.TryInsertAsync(creation, ct); }
    public Task<Creation?> UpdateOwnedAsync(string shareCode, Guid owner, CreationContent content, CancellationToken ct) { ledger.Record(nameof(UpdateOwnedAsync)); return inner.UpdateOwnedAsync(shareCode, owner, content, ct); }
    public Task<bool> DeleteOwnedAsync(string shareCode, Guid owner, CancellationToken ct) { ledger.Record(nameof(DeleteOwnedAsync)); return inner.DeleteOwnedAsync(shareCode, owner, ct); }
    public Task<int> CountOwnedAsync(Guid owner, CreationKind? kind, CancellationToken ct) { ledger.Record(nameof(CountOwnedAsync)); return inner.CountOwnedAsync(owner, kind, ct); }
    public Task<IReadOnlyList<CreationListRow>> ListOwnedPageAsync(Guid owner, CreationKind? kind, int skip, int take, CancellationToken ct) { ledger.Record(nameof(ListOwnedPageAsync)); return inner.ListOwnedPageAsync(owner, kind, skip, take, ct); }
}

/// <summary>
/// An in-memory repository whose returns are derived from its own backing rows, never hardcoded
/// (<c>toad-fake-repositories-must-mirror-real-return-semantics.md</c>): an insert with a taken code
/// returns false and stores nothing; update and delete match on code AND owner; deleting a source
/// nulls its remixes' <c>RemixedFromId</c>, as the database's ON DELETE SET NULL does. For service
/// branch tests; the predicates themselves are tested against the real repository.
/// </summary>
internal sealed class FakeCreationRepository : ICreationRepository
{
    private readonly List<Creation> rows = [];
    private long clock = DateTimeOffset.Parse("2026-11-13T12:00:00Z").UtcTicks;

    public CallLedger Ledger { get; } = new();

    public IReadOnlyList<Creation> Rows => rows;

    public Creation Seed(Guid owner, string shareCode, CreationKind kind = CreationKind.Shell, Guid? remixedFromId = null)
    {
        var row = new Creation
        {
            Id = Guid.NewGuid(), ShareCode = shareCode, Kind = kind, Name = "Seeded", SchemaVersion = 1,
            Palette = ["red"], Document = "{\"seeded\":true}", OwnerUserId = owner, RemixedFromId = remixedFromId
        };
        Stamp(row, created: true);
        rows.Add(row);
        return row;
    }

    public Task<Creation?> FindByShareCodeAsync(string shareCode, CancellationToken ct)
    {
        Ledger.Record(nameof(FindByShareCodeAsync));
        return Task.FromResult(Copy(rows.SingleOrDefault(r => r.ShareCode == shareCode)));
    }

    public Task<Creation?> FindOwnedAsync(string shareCode, Guid owner, CancellationToken ct)
    {
        Ledger.Record(nameof(FindOwnedAsync));
        return Task.FromResult(Copy(rows.SingleOrDefault(r => r.ShareCode == shareCode && r.OwnerUserId == owner)));
    }

    public Task<InsertOutcome> TryInsertAsync(Creation creation, CancellationToken ct)
    {
        Ledger.Record(nameof(TryInsertAsync));
        if (creation.RemixedFromId is { } sourceId && !rows.Any(r => r.Id == sourceId))
        {
            return Task.FromResult(InsertOutcome.RemixSourceGone);
        }

        if (rows.Any(r => r.ShareCode == creation.ShareCode))
        {
            return Task.FromResult(InsertOutcome.ShareCodeTaken);
        }

        Stamp(creation, created: true);
        rows.Add(creation);
        return Task.FromResult(InsertOutcome.Inserted);
    }

    public Task<Creation?> UpdateOwnedAsync(string shareCode, Guid owner, CreationContent content, CancellationToken ct)
    {
        Ledger.Record(nameof(UpdateOwnedAsync));
        var row = rows.SingleOrDefault(r => r.ShareCode == shareCode && r.OwnerUserId == owner);
        if (row is null)
        {
            return Task.FromResult<Creation?>(null);
        }

        row.Name = content.Name;
        row.SchemaVersion = content.SchemaVersion;
        row.Palette = content.Palette;
        row.Document = content.Document;
        Stamp(row, created: false);
        return Task.FromResult(Copy(row));
    }

    public Task<bool> DeleteOwnedAsync(string shareCode, Guid owner, CancellationToken ct)
    {
        Ledger.Record(nameof(DeleteOwnedAsync));
        var row = rows.SingleOrDefault(r => r.ShareCode == shareCode && r.OwnerUserId == owner);
        if (row is null)
        {
            return Task.FromResult(false);
        }

        rows.Remove(row);
        for (var i = 0; i < rows.Count; i++)
        {
            if (rows[i].RemixedFromId == row.Id)
            {
                rows[i] = Clone(rows[i], remixedFromId: null);
            }
        }

        return Task.FromResult(true);
    }

    public Task<int> CountOwnedAsync(Guid owner, CreationKind? kind, CancellationToken ct)
    {
        Ledger.Record(nameof(CountOwnedAsync));
        return Task.FromResult(rows.Count(r => r.OwnerUserId == owner && (kind is null || r.Kind == kind)));
    }

    public Task<IReadOnlyList<CreationListRow>> ListOwnedPageAsync(Guid owner, CreationKind? kind, int skip, int take, CancellationToken ct)
    {
        Ledger.Record(nameof(ListOwnedPageAsync));
        IReadOnlyList<CreationListRow> page = rows
            .Where(r => r.OwnerUserId == owner && (kind is null || r.Kind == kind))
            .OrderByDescending(r => r.UpdatedAt).ThenBy(r => r.ShareCode, StringComparer.Ordinal)
            .Skip(skip).Take(take)
            .Select(r => new CreationListRow(r.ShareCode, r.Kind, r.Name, r.UpdatedAt, r.Palette))
            .ToList();
        return Task.FromResult(page);
    }

    private void Stamp(Creation row, bool created)
    {
        var now = new DateTimeOffset(clock += TimeSpan.TicksPerSecond, TimeSpan.Zero);
        if (created)
        {
            row.CreatedAt = now;
        }

        row.UpdatedAt = now;
    }

    /// <summary>A detached copy with the source loaded, like AsNoTracking + Include.</summary>
    private Creation? Copy(Creation? row) =>
        row is null ? null : Clone(row, row.RemixedFromId, rows.SingleOrDefault(r => r.Id == row.RemixedFromId));

    private static Creation Clone(Creation row, Guid? remixedFromId, Creation? source = null) => new()
    {
        Id = row.Id, ShareCode = row.ShareCode, Kind = row.Kind, Name = row.Name, SchemaVersion = row.SchemaVersion,
        Palette = [.. row.Palette], Document = row.Document, OwnerUserId = row.OwnerUserId, RemixedFromId = remixedFromId,
        RemixedFrom = source, CreatedAt = row.CreatedAt, UpdatedAt = row.UpdatedAt
    };
}

/// <summary>A settable <see cref="ICurrentUser"/>, so one test can act as two users.</summary>
internal sealed class FakeCurrentUser : ICurrentUser
{
    public Guid? UserId { get; set; }
    public bool IsAuthenticated { get; set; }
    public bool CanWrite { get; set; }
}

/// <summary>Hands out queued codes, then real random ones.</summary>
internal sealed class QueuedShareCodeGenerator(params string[] codes) : IShareCodeGenerator
{
    private readonly Queue<string> queue = new(codes);
    private readonly ShareCodeGenerator real = new();

    public int Calls { get; private set; }

    public string NewCode()
    {
        Calls++;
        return queue.Count > 0 ? queue.Dequeue() : real.NewCode();
    }
}

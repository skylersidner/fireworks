using Fireworks.Api.Data.Entities;
using Fireworks.Api.Repositories;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Tests.Repositories;

/// <summary>
/// The real repository's predicates on a real (SQLite) database, with two users
/// (<c>toad-fake-repositories-must-mirror-real-return-semantics.md</c>): swapped or missing owner
/// predicates, the unique-index race guard, ON DELETE SET NULL and CASCADE, and list ordering.
/// <c>CreationsPostgresTests</c> repeats the database-sensitive ones on Postgres.
/// </summary>
public sealed class CreationRepositoryTests
{
    private static readonly Guid A = SqliteTestDatabase.UserA;
    private static readonly Guid B = SqliteTestDatabase.UserB;

    internal static Creation NewRow(Guid owner, string code, CreationKind kind = CreationKind.Shell, Guid? remixedFromId = null) => new()
    {
        Id = Guid.CreateVersion7(), ShareCode = code, Kind = kind, Name = "Peony", SchemaVersion = 1,
        Palette = ["red", "gold"], Document = "{\"version\":1}", OwnerUserId = owner, RemixedFromId = remixedFromId
    };

    private static CreationContent Content(string name) => new(name, 1, ["blue"], "{\"version\":1,\"name\":\"" + name + "\"}");

    [Fact]
    public async Task Owner_filtered_reads_updates_and_deletes_never_touch_another_users_row()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using (var db = database.NewContext())
        {
            Assert.Equal(InsertOutcome.Inserted, await new CreationRepository(db).TryInsertAsync(NewRow(A, "AAAAAAAA"), default));
        }

        await using (var db = database.NewContext())
        {
            var repository = new CreationRepository(db);
            Assert.Null(await repository.FindOwnedAsync("AAAAAAAA", B, default));
            Assert.NotNull(await repository.FindOwnedAsync("AAAAAAAA", A, default));
            Assert.NotNull(await repository.FindByShareCodeAsync("AAAAAAAA", default));
            Assert.Null(await repository.UpdateOwnedAsync("AAAAAAAA", B, Content("Hijacked"), default));
            Assert.False(await repository.DeleteOwnedAsync("AAAAAAAA", B, default));
        }

        await using (var db = database.NewContext())
        {
            var row = await db.Creations.SingleAsync();
            Assert.Equal(("Peony", A), (row.Name, row.OwnerUserId));
        }

        await using (var db = database.NewContext())
        {
            var repository = new CreationRepository(db);
            var updated = await repository.UpdateOwnedAsync("AAAAAAAA", A, Content("Mine"), default);
            Assert.Equal("Mine", updated!.Name);
            Assert.True(updated.UpdatedAt > updated.CreatedAt);
            Assert.True(await repository.DeleteOwnedAsync("AAAAAAAA", A, default));
        }
    }

    [Fact]
    public async Task An_identical_update_still_refreshes_updated_at()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using (var db = database.NewContext())
        {
            await new CreationRepository(db).TryInsertAsync(NewRow(A, "AAAAAAAA"), default);
        }

        await using var context = database.NewContext();
        var repository = new CreationRepository(context);
        // Values captured: both calls return the same tracked instance.
        var first = (await repository.UpdateOwnedAsync("AAAAAAAA", A, Content("Same"), default))!.UpdatedAt;
        await Task.Delay(5);
        var second = (await repository.UpdateOwnedAsync("AAAAAAAA", A, Content("Same"), default))!.UpdatedAt;
        Assert.True(second > first);
    }

    [Fact]
    public async Task A_taken_share_code_returns_false_inserts_nothing_and_leaves_the_context_usable()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using (var db = database.NewContext())
        {
            await new CreationRepository(db).TryInsertAsync(NewRow(A, "AAAAAAAA"), default);
        }

        await using (var db = database.NewContext())
        {
            var repository = new CreationRepository(db);
            Assert.Equal(InsertOutcome.ShareCodeTaken, await repository.TryInsertAsync(NewRow(B, "AAAAAAAA"), default));
            Assert.Equal(InsertOutcome.Inserted, await repository.TryInsertAsync(NewRow(B, "BBBBBBBB"), default));
        }

        await using var check = database.NewContext();
        var rows = await check.Creations.OrderBy(c => c.ShareCode).ToListAsync();
        Assert.Equal([("AAAAAAAA", A), ("BBBBBBBB", B)], rows.Select(r => (r.ShareCode, r.OwnerUserId)));
    }

    [Fact]
    public async Task Another_failure_is_rethrown_not_reported_as_a_collision()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using var db = database.NewContext();
        // An owner that doesn't exist: an FK failure, not a taken code.
        await Assert.ThrowsAsync<DbUpdateException>(() => new CreationRepository(db).TryInsertAsync(NewRow(Guid.NewGuid(), "AAAAAAAA"), default));
    }

    [Fact]
    public async Task Deleting_a_source_nulls_its_remixes_and_deleting_a_user_cascades()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var source = NewRow(A, "AAAAAAAA");
        await using (var db = database.NewContext())
        {
            var repository = new CreationRepository(db);
            await repository.TryInsertAsync(source, default);
            await repository.TryInsertAsync(NewRow(B, "RRRRRRRR", remixedFromId: source.Id), default);
        }

        await using (var db = database.NewContext())
        {
            Assert.Equal("AAAAAAAA", (await new CreationRepository(db).FindByShareCodeAsync("RRRRRRRR", default))!.RemixedFrom?.ShareCode);
            Assert.True(await new CreationRepository(db).DeleteOwnedAsync("AAAAAAAA", A, default));
        }

        await using (var db = database.NewContext())
        {
            var remix = await new CreationRepository(db).FindByShareCodeAsync("RRRRRRRR", default);
            Assert.Null(remix!.RemixedFromId);
            Assert.Null(remix.RemixedFrom);
            await db.Users.Where(u => u.Id == B).ExecuteDeleteAsync();
        }

        await using var check = database.NewContext();
        Assert.Empty(await check.Creations.ToListAsync());
    }

    [Fact]
    public async Task List_is_owner_only_kind_filtered_and_ordered_with_an_ordinal_tiebreak()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        await using (var db = database.NewContext())
        {
            var repository = new CreationRepository(db);
            foreach (var code in new[] { "aaaaaaaa", "BBBBBBBB", "Zzzzzzzz" })
            {
                await repository.TryInsertAsync(NewRow(A, code), default);
            }

            await repository.TryInsertAsync(NewRow(A, "SSSSSSSS", CreationKind.Show), default);
            await repository.TryInsertAsync(NewRow(B, "XXXXXXXX"), default);
            var tie = DateTimeOffset.Parse("2030-01-01T00:00:00Z");
            await db.Creations.Where(c => c.Kind == CreationKind.Shell).ExecuteUpdateAsync(s => s.SetProperty(c => c.UpdatedAt, tie));
        }

        await using var context = database.NewContext();
        var reader = new CreationRepository(context);
        Assert.Equal(3, await reader.CountOwnedAsync(A, CreationKind.Shell, default));
        Assert.Equal(4, await reader.CountOwnedAsync(A, null, default));
        var page = await reader.ListOwnedPageAsync(A, CreationKind.Shell, 0, 10, default);
        Assert.Equal(["BBBBBBBB", "Zzzzzzzz", "aaaaaaaa"], page.Select(r => r.ShareCode));
        Assert.Equal(["Zzzzzzzz"], (await reader.ListOwnedPageAsync(A, CreationKind.Shell, 1, 1, default)).Select(r => r.ShareCode));
        Assert.Equal(["red", "gold"], page[0].Palette);
    }
}

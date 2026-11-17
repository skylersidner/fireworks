using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Tests.Repositories;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Fireworks.Api.Tests.Data;

/// <summary>
/// What only Postgres can prove (plan Phase 4 tests; Boo S9, S26): the migrated column types, the
/// "C" collation and the descending index, the unique index through the real race guard, ordinal
/// ordering under a linguistic database default, ON DELETE actions, and jsonb round trips.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class CreationsPostgresTests
{
    private static readonly Guid A = SqliteTestDatabase.UserA;
    private static readonly Guid B = SqliteTestDatabase.UserB;

    private static FireworksDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FireworksDbContext>().UseNpgsql(PostgresFactAttribute.ConnectionString).Options);

    private static async Task ResetAsync()
    {
        await using (var reset = NewContext())
        {
            await reset.Database.EnsureDeletedAsync();
        }

        await using var context = NewContext();
        await FireworksDbInitializer.InitializeAsync(context);
        context.Users.AddRange(new User { Id = A, DisplayName = "A" }, new User { Id = B, DisplayName = "B" });
        await context.SaveChangesAsync();
    }

    private static async Task<List<string>> QueryAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(PostgresFactAttribute.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<string>();
        while (await reader.ReadAsync())
        {
            rows.Add(string.Join("|", Enumerable.Range(0, reader.FieldCount).Select(i => reader.IsDBNull(i) ? "null" : reader.GetValue(i).ToString())));
        }

        return rows;
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task The_migration_creates_jsonb_text_array_C_collation_varchar_80_and_the_descending_index()
    {
        await ResetAsync();

        var columns = await QueryAsync("""
            select column_name, data_type, coalesce(character_maximum_length::text, '-'), coalesce(collation_name, '-')
            from information_schema.columns where table_name = 'creations' order by column_name
            """);
        Assert.Contains("document|jsonb|-|-", columns);
        Assert.Contains("palette|ARRAY|-|-", columns);
        Assert.Contains("share_code|character varying|12|C", columns);
        Assert.Contains("name|character varying|80|-", columns);
        Assert.Contains("kind|character varying|8|-", columns);

        var indexes = await QueryAsync("select indexname, indexdef from pg_indexes where tablename = 'creations' order by indexname");
        Assert.Contains(indexes, i => i.StartsWith("ix_creations_owner_updated_share_code|", StringComparison.Ordinal)
                                      && i.Contains("(owner_user_id, updated_at DESC, share_code)", StringComparison.Ordinal));
        Assert.Contains(indexes, i => i.StartsWith("ix_creations_share_code|CREATE UNIQUE INDEX", StringComparison.Ordinal));

        var foreignKeys = await QueryAsync("""
            select conname, confdeltype from pg_constraint where conrelid = 'creations'::regclass and contype = 'f' order by conname
            """);
        Assert.Equal(["fk_creations_creations_remixed_from_id|n", "fk_creations_users_owner_user_id|c"], foreignKeys);
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task The_unique_index_drives_the_race_guard_on_Postgres()
    {
        await ResetAsync();
        await using (var db = NewContext())
        {
            Assert.Equal(InsertOutcome.Inserted, await new CreationRepository(db).TryInsertAsync(CreationRepositoryTests.NewRow(A, "AAAAAAAA"), default));
        }

        await using (var db = NewContext())
        {
            var repository = new CreationRepository(db);
            Assert.Equal(InsertOutcome.ShareCodeTaken, await repository.TryInsertAsync(CreationRepositoryTests.NewRow(B, "AAAAAAAA"), default));
            Assert.Equal(InsertOutcome.Inserted, await repository.TryInsertAsync(CreationRepositoryTests.NewRow(B, "BBBBBBBB"), default));
        }

        await using var check = NewContext();
        Assert.Equal(A, (await check.Creations.SingleAsync(c => c.ShareCode == "AAAAAAAA")).OwnerUserId);
        // Case-sensitive: "aaaaaaaa" is a different code from "AAAAAAAA".
        await using var other = NewContext();
        Assert.Equal(InsertOutcome.Inserted, await new CreationRepository(other).TryInsertAsync(CreationRepositoryTests.NewRow(A, "aaaaaaaa"), default));
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Owner_predicates_and_ordinal_tiebreak_hold_on_Postgres()
    {
        await ResetAsync();
        var tie = DateTimeOffset.Parse("2030-01-01T00:00:00Z");
        await using (var db = NewContext())
        {
            var repository = new CreationRepository(db);
            foreach (var code in new[] { "aaaaaaaa", "BBBBBBBB", "Zzzzzzzz" })
            {
                await repository.TryInsertAsync(CreationRepositoryTests.NewRow(A, code), default);
            }

            await db.Creations.ExecuteUpdateAsync(s => s.SetProperty(c => c.UpdatedAt, tie));
        }

        await using var context = NewContext();
        var reader = new CreationRepository(context);
        // The database default is en_US.utf8 ('a' < 'B'); the column's "C" collation makes it ordinal.
        Assert.Equal(["BBBBBBBB", "Zzzzzzzz", "aaaaaaaa"], (await reader.ListOwnedPageAsync(A, null, 0, 10, default)).Select(r => r.ShareCode));
        Assert.Empty(await reader.ListOwnedPageAsync(A, null, int.MaxValue, 100, default));
        Assert.Null(await reader.FindOwnedAsync("aaaaaaaa", B, default));
        Assert.Equal(UpdateOutcome.NotFound, await reader.UpdateOwnedAsync("aaaaaaaa", B, new CreationContent("x", 1, [], "{}"), tie, default));
        Assert.False(await reader.DeleteOwnedAsync("aaaaaaaa", B, default));
        Assert.Equal(3, await reader.CountOwnedAsync(A, CreationKind.Shell, default));
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Set_null_on_source_delete_and_cascade_on_owner_delete()
    {
        await ResetAsync();
        var source = CreationRepositoryTests.NewRow(A, "AAAAAAAA");
        await using (var db = NewContext())
        {
            var repository = new CreationRepository(db);
            await repository.TryInsertAsync(source, default);
            await repository.TryInsertAsync(CreationRepositoryTests.NewRow(B, "RRRRRRRR", remixedFromId: source.Id), default);
            Assert.True(await repository.DeleteOwnedAsync("AAAAAAAA", A, default));
        }

        await using (var db = NewContext())
        {
            Assert.Null((await db.Creations.SingleAsync(c => c.ShareCode == "RRRRRRRR")).RemixedFromId);
            await db.Users.Where(u => u.Id == B).ExecuteDeleteAsync();
        }

        await using var check = NewContext();
        Assert.Empty(await check.Creations.ToListAsync());
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Every_valid_fixture_round_trips_through_jsonb_by_value_and_80_emoji_fit_the_name()
    {
        await ResetAsync();
        var names = SchemaFixtures.DocumentFixtureNames().Where(n => n.StartsWith("valid/", StringComparison.Ordinal)).ToList();
        var stored = new Dictionary<string, string>();
        await using (var db = NewContext())
        {
            var repository = new CreationRepository(db);
            var generator = new ShareCodeGenerator();
            foreach (var name in names)
            {
                var fixture = SchemaFixtures.LoadDocument(name);
                string canonical, documentName;
                if (fixture.Kind == "shell")
                {
                    var dto = CreationDocumentValidator.ValidateShell(fixture.Document).Document!;
                    (canonical, documentName) = (CreationDocuments.Serialize(dto), dto.Name);
                }
                else
                {
                    var dto = CreationDocumentValidator.ValidateShow(fixture.Document).Document!;
                    (canonical, documentName) = (CreationDocuments.Serialize(dto), dto.Name);
                }

                var row = CreationRepositoryTests.NewRow(A, generator.NewCode(), fixture.Kind == "shell" ? CreationKind.Shell : CreationKind.Show);
                row.Document = canonical;
                row.Name = documentName;
                Assert.Equal(InsertOutcome.Inserted, await repository.TryInsertAsync(row, default));
                stored[row.ShareCode] = canonical;
            }
        }

        await using var check = NewContext();
        foreach (var (code, canonical) in stored)
        {
            var row = await check.Creations.SingleAsync(c => c.ShareCode == code);
            // Postgres reorders keys, so compare values, never bytes.
            Assert.True(JsonSemantics.Equal(canonical, row.Document), code);
        }

        var astral = SchemaFixtures.LoadDocument("valid/shell/name-80-astral").Document.GetProperty("name").GetString()!;
        Assert.Contains(await check.Creations.Select(c => c.Name).ToListAsync(), n => n == astral);
    }
}

/// <summary>Not gated: the model and the committed migrations agree, so nobody forgot a migration.</summary>
public sealed class ModelSnapshotTests
{
    [Fact]
    public void The_Npgsql_model_has_no_pending_changes_against_the_migrations()
    {
        using var context = new FireworksDbContext(new DbContextOptionsBuilder<FireworksDbContext>()
            .UseNpgsql("Host=unused;Database=unused").Options);
        Assert.False(context.Database.HasPendingModelChanges());
    }
}

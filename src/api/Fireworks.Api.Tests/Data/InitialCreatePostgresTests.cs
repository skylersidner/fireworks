using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Fireworks.Api.Tests.Data;

/// <summary>
/// The only tests that run the migrations. Every SQLite test builds its schema from the model with
/// <c>EnsureCreatedAsync</c>, which would never notice a bad migration, so this is what proves the
/// migrations apply to a brand-new Postgres database, that Phase 8's <c>AddExternalIdentity</c>
/// applies over a database that already holds the legacy default user, and that its constraints
/// hold (unique pair, both-or-neither).
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class InitialCreatePostgresTests
{
    private static FireworksDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FireworksDbContext>().UseNpgsql(PostgresFactAttribute.ConnectionString).Options);

    private static async Task ResetAsync()
    {
        await using var reset = NewContext();
        await reset.Database.EnsureDeletedAsync();
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Initializer_applies_every_migration_to_a_fresh_database_and_seeds_no_user()
    {
        await ResetAsync();
        await using (var context = NewContext())
        {
            await FireworksDbInitializer.InitializeAsync(context);
        }

        await using var check = NewContext();
        Assert.Empty(await check.Database.GetPendingMigrationsAsync());
        var applied = await check.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, name => name.EndsWith("_InitialCreate", StringComparison.Ordinal));
        Assert.Contains(applied, name => name.EndsWith("_AddCreations", StringComparison.Ordinal));
        Assert.Contains(applied, name => name.EndsWith("_AddExternalIdentity", StringComparison.Ordinal));
        Assert.Empty(await check.Users.ToListAsync());
        Assert.Empty(await check.DataProtectionKeys.ToListAsync());
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task AddExternalIdentity_keeps_the_legacy_row_and_enforces_the_pair()
    {
        await ResetAsync();
        await using (var old = NewContext())
        {
            // A database as Phase 7 left it, with the seeded default user.
            await old.GetService<IMigrator>().MigrateAsync("20261113202016_AddCreations");
            await old.Database.ExecuteSqlRawAsync(
                "INSERT INTO users (id, display_name, created_at, updated_at) VALUES ({0}, 'Default user', now(), now())",
                TestIdentity.LegacyDefaultUserId);
        }

        await using (var context = NewContext())
        {
            await FireworksDbInitializer.InitializeAsync(context);
        }

        await using (var check = NewContext())
        {
            var legacy = await check.Users.SingleAsync();
            Assert.Equal((TestIdentity.LegacyDefaultUserId, (string?)null, (string?)null), (legacy.Id, legacy.ExternalProvider, legacy.ExternalSubject));
            check.Users.Add(new User { Id = Guid.CreateVersion7(), DisplayName = "A", ExternalProvider = "google", ExternalSubject = "s1" });
            check.Users.Add(new User { Id = Guid.CreateVersion7(), DisplayName = "Null pair too", ExternalProvider = null, ExternalSubject = null });
            await check.SaveChangesAsync();
        }

        await using (var duplicate = NewContext())
        {
            duplicate.Users.Add(new User { Id = Guid.CreateVersion7(), DisplayName = "B", ExternalProvider = "google", ExternalSubject = "s1" });
            await Assert.ThrowsAsync<DbUpdateException>(() => duplicate.SaveChangesAsync());
        }

        await using (var half = NewContext())
        {
            half.Users.Add(new User { Id = Guid.CreateVersion7(), DisplayName = "C", ExternalProvider = "google", ExternalSubject = null });
            await Assert.ThrowsAsync<DbUpdateException>(() => half.SaveChangesAsync());
        }
    }
}

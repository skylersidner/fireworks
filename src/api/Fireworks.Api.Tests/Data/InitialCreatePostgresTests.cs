using Fireworks.Api.Data;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Tests.Data;

/// <summary>
/// The only tests that run the migrations. Every SQLite test builds its schema from the model with
/// <c>EnsureCreatedAsync</c>, which would never notice a bad migration, so this is what proves
/// <c>InitialCreate</c> applies to a brand-new Postgres database and that
/// <see cref="FireworksDbInitializer"/> leaves the default user's row behind.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class InitialCreatePostgresTests
{
    private static FireworksDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FireworksDbContext>().UseNpgsql(PostgresFactAttribute.ConnectionString).Options);

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Initializer_applies_every_migration_to_a_fresh_database_and_seeds_the_default_user()
    {
        await using (var reset = NewContext())
        {
            // Fresh, not "already migrated": the same starting point as a brand-new deploy.
            await reset.Database.EnsureDeletedAsync();
        }

        await using (var context = NewContext())
        {
            await FireworksDbInitializer.InitializeAsync(context, TestIdentity.Options());
        }

        await using var check = NewContext();
        Assert.Empty(await check.Database.GetPendingMigrationsAsync());
        var applied = await check.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, name => name.EndsWith("_InitialCreate", StringComparison.Ordinal));
        Assert.Contains(applied, name => name.EndsWith("_AddCreations", StringComparison.Ordinal));

        // Through the model, not a raw count: catches a column the model names differently from
        // the migration, or a type the provider maps differently than the model expects.
        var user = await check.Users.SingleAsync();
        Assert.Equal(TestIdentity.UserId, user.Id);
        Assert.Equal(FireworksDbInitializer.DefaultUserDisplayName, user.DisplayName);
        Assert.NotEqual(default, user.CreatedAt);
        Assert.Equal(user.CreatedAt, user.UpdatedAt);
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Initializer_is_idempotent_and_leaves_an_existing_user_row_untouched()
    {
        await using (var reset = NewContext())
        {
            await reset.Database.EnsureDeletedAsync();
        }

        await using (var first = NewContext())
        {
            await FireworksDbInitializer.InitializeAsync(first, TestIdentity.Options());
            var user = await first.Users.SingleAsync();
            user.DisplayName = "Renamed by hand";
            await first.SaveChangesAsync();
        }

        await using (var second = NewContext())
        {
            // A restart: migrations are already applied and the row already exists.
            await FireworksDbInitializer.InitializeAsync(second, TestIdentity.Options());
        }

        await using var check = NewContext();
        var only = await check.Users.SingleAsync();
        Assert.Equal("Renamed by hand", only.DisplayName);
        Assert.True(only.UpdatedAt > only.CreatedAt);
    }
}

using Fireworks.Api.Data.Entities;
using Fireworks.Api.Services.Identity;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Data;

public static class FireworksDbInitializer
{
    public const string DefaultUserDisplayName = "Default user";

    /// <summary>
    /// Runs on every startup, before the app listens: applies any pending migrations, then makes
    /// sure the configured default user exists. A bad migration therefore fails the deploy
    /// instead of surfacing on the first request.
    /// </summary>
    public static async Task InitializeAsync(
        FireworksDbContext dbContext,
        DefaultUserOptions defaultUserOptions,
        CancellationToken cancellationToken = default)
    {
        await dbContext.Database.MigrateAsync(cancellationToken);
        await EnsureDefaultUserExistsAsync(dbContext, defaultUserOptions, cancellationToken);
    }

    /// <summary>
    /// Inserts the default user's row if it is missing; an existing row is left exactly as it is
    /// (a hand-edited display name survives a restart). Public so the SQLite test harnesses, which
    /// build their schema with <c>EnsureCreatedAsync</c> rather than migrations, seed through the
    /// same code path as the app.
    ///
    /// <para>
    /// Two instances booting at once can both see "missing" and both insert. The loser's insert
    /// fails on the primary key; it then re-checks whether the row it wanted now exists, and only
    /// rethrows if it still doesn't. That checks the desired state, not a vendor error code, so it
    /// behaves the same on SQLite and Postgres.
    /// </para>
    /// </summary>
    public static async Task EnsureDefaultUserExistsAsync(
        FireworksDbContext dbContext,
        DefaultUserOptions defaultUserOptions,
        CancellationToken cancellationToken = default)
    {
        var userId = defaultUserOptions.DefaultUserId;

        if (await dbContext.Users.AnyAsync(u => u.Id == userId, cancellationToken))
        {
            return;
        }

        var user = new User { Id = userId, DisplayName = DefaultUserDisplayName };
        dbContext.Users.Add(user);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            dbContext.Entry(user).State = EntityState.Detached;
            if (!await dbContext.Users.AnyAsync(u => u.Id == userId, cancellationToken))
            {
                throw;
            }
        }
    }
}

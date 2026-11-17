using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Data;

public static class FireworksDbInitializer
{
    /// <summary>
    /// Runs on every startup, before the app listens: applies any pending migrations, so a bad
    /// migration fails the deploy instead of surfacing on the first request. Phase 8 removed the
    /// default-user seeding: users are provisioned on first sign-in (<c>UserProvisioning</c>).
    /// </summary>
    public static Task InitializeAsync(FireworksDbContext dbContext, CancellationToken cancellationToken = default) =>
        dbContext.Database.MigrateAsync(cancellationToken);
}

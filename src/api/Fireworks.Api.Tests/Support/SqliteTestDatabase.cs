using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Tests.Support;

/// <summary>
/// A uniquely named shared-cache in-memory SQLite database holding two users, for real-repository
/// predicate tests (<c>toad-fake-repositories-must-mirror-real-return-semantics.md</c>). Owns a
/// connection string, not a connection: each context opens its own; the keep-alive only holds the
/// database open.
/// </summary>
internal sealed class SqliteTestDatabase : IAsyncDisposable
{
    public static readonly Guid UserA = Guid.Parse("aaaaaaaa-0000-4000-8000-00000000000a");
    public static readonly Guid UserB = Guid.Parse("bbbbbbbb-0000-4000-8000-00000000000b");

    private readonly SqliteConnection keepAlive;

    public string ConnectionString { get; }

    private SqliteTestDatabase(string connectionString, SqliteConnection keepAlive)
    {
        ConnectionString = connectionString;
        this.keepAlive = keepAlive;
    }

    public static async Task<SqliteTestDatabase> CreateAsync()
    {
        var connectionString = $"DataSource=file:{Guid.NewGuid():N}?mode=memory&cache=shared";
        var keepAlive = new SqliteConnection(connectionString);
        await keepAlive.OpenAsync();
        var database = new SqliteTestDatabase(connectionString, keepAlive);
        await using var context = database.NewContext();
        await context.Database.EnsureCreatedAsync();
        context.Users.AddRange(
            new User { Id = UserA, DisplayName = "User A" },
            new User { Id = UserB, DisplayName = "User B" });
        await context.SaveChangesAsync();
        return database;
    }

    public FireworksDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FireworksDbContext>().UseSqlite(ConnectionString).Options);

    public ValueTask DisposeAsync() => keepAlive.DisposeAsync();
}

using System.Data.Common;
using System.Text.RegularExpressions;
using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Repositories;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Fireworks.Api.Tests.Repositories;

/// <summary>
/// The list's <c>share_code</c> tiebreak is in the SQL, not an accident of the index (Toad, Phase 4 QA).
/// The index <c>(owner_user_id, updated_at desc, share_code)</c> already returns ties in ordinal
/// order, so every ordering test, on SQLite and on Postgres, passed with <c>.ThenBy(c => c.ShareCode)</c>
/// deleted (measured). Scan order is not a promise the database makes; the <c>ORDER BY</c> is.
/// Mutant: drop the <c>ThenBy</c> in <c>CreationRepository.ListOwnedPageAsync</c>; this test fails.
/// </summary>
public sealed class CreationListOrderSqlTests
{
    [Fact]
    public async Task The_page_query_orders_by_updated_at_desc_then_share_code()
    {
        await using var database = await SqliteTestDatabase.CreateAsync();
        var recorder = new CommandRecorder();
        await using var db = new FireworksDbContext(new DbContextOptionsBuilder<FireworksDbContext>()
            .UseSqlite(database.ConnectionString).AddInterceptors(recorder).Options);
        await new CreationRepository(db).TryInsertAsync(CreationRepositoryTests.NewRow(SqliteTestDatabase.UserA, "AAAAAAAA"), default);
        recorder.Commands.Clear();

        await new CreationRepository(db).ListOwnedPageAsync(SqliteTestDatabase.UserA, CreationKind.Shell, 0, 10, default);

        var sql = Assert.Single(recorder.Commands);
        var orderBy = Regex.Match(sql, @"ORDER BY (?<keys>.*?)\s+LIMIT", RegexOptions.Singleline);
        Assert.True(orderBy.Success, sql);
        var keys = orderBy.Groups["keys"].Value.Split(',').Select(k => Regex.Replace(k.Trim(), @"""\w+""\.", "")).ToList();
        Assert.Equal(["\"updated_at\" DESC", "\"share_code\""], keys);
    }

    private sealed class CommandRecorder : DbCommandInterceptor
    {
        public List<string> Commands { get; } = [];

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }
}

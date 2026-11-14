using System.Net;
using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Tests.Controllers;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Fireworks.Api.Tests.Creations;

/// <summary>
/// A remix source deleted while a write that references it is in flight (Yoshi, Phase 4 review D1,
/// D2), made deterministic with a <see cref="SaveChangesInterceptor"/> that deletes the source
/// through its own connection just before the write's save, as Toad's
/// <c>CreationUpdateEdgeTests</c> does for a deleted target. Real Kestrel, real repository, SQLite
/// with foreign keys enforced. Mutants, each shown to fail here:
/// <list type="bullet">
/// <item>D1: in <c>CreationRepository.UpdateOwnedAsync</c>, mark the whole entry
/// <c>EntityState.Modified</c> instead of the four content properties. The UPDATE then writes the
/// stale <c>remixed_from_id</c> back over the database's SET NULL and fails the foreign key (500).</item>
/// <item>D2: in <c>CreationRepository.TryInsertAsync</c>, drop the source-gone check. The insert's
/// foreign-key failure is rethrown (500).</item>
/// </list>
/// </summary>
public sealed class CreationSourceDeletedMidWriteTests
{
    private static readonly string Blue = CreationEndpointTests.Peony
        .Replace("\"color1\":\"red\"", "\"color1\":\"blue\"")
        .Replace("\"color2\":\"gold\"", "\"color2\":\"none\"");

    private static async Task<JsonElement> SendAsync(FireworksApiHarness h, HttpMethod method, string path, string json, HttpStatusCode expected)
    {
        using var response = await CreationApiHarness.SendJsonAsync(h.Client, method, path, json);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"{method} {path} -> {(int)response.StatusCode} {text}");
        return JsonSerializer.Deserialize<JsonElement>(text);
    }

    private static async Task<string> CreateAsync(FireworksApiHarness h) =>
        (await SendAsync(h, HttpMethod.Post, "/api/creations",
            $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}", HttpStatusCode.Created))
        .GetProperty("shareCode").GetString()!;

    [Fact]
    public async Task Updating_a_remix_whose_source_is_deleted_mid_update_succeeds_and_keeps_the_database_null()
    {
        var interceptor = new DeleteSourceBeforeSaveInterceptor(EntityState.Modified);
        await using var h = await FireworksApiHarness.StartAsync(true, FireworksApiHarness.UnthrottledRateLimits,
            services => services.ConfigureDbContext<FireworksDbContext>(o => o.AddInterceptors(interceptor)));
        var source = await CreateAsync(h);
        var remix = await SendAsync(h, HttpMethod.Post, $"/api/creations/{source}/remix",
            $"{{\"document\":{CreationEndpointTests.Peony}}}", HttpStatusCode.Created);
        var remixCode = remix.GetProperty("shareCode").GetString()!;
        var updatedBefore = remix.GetProperty("updatedAt").GetString();

        interceptor.Arm(h.ConnectionString, source);
        var put = await SendAsync(h, HttpMethod.Put, $"/api/creations/{remixCode}", $"{{\"document\":{Blue}}}", HttpStatusCode.OK);

        Assert.Equal(1, interceptor.Fired);
        Assert.NotEqual(updatedBefore, put.GetProperty("updatedAt").GetString());
        await using var db = h.NewContext();
        Assert.False(await db.Creations.AnyAsync(c => c.ShareCode == source));
        var stored = await db.Creations.AsNoTracking().SingleAsync(c => c.ShareCode == remixCode);
        Assert.Null(stored.RemixedFromId);
        Assert.Equal(["blue"], stored.Palette);
        Assert.Equal(put.GetProperty("updatedAt").GetDateTimeOffset(), stored.UpdatedAt);
    }

    [Fact]
    public async Task A_remix_whose_source_is_deleted_between_lookup_and_insert_is_the_fixed_404()
    {
        var interceptor = new DeleteSourceBeforeSaveInterceptor(EntityState.Added);
        await using var h = await FireworksApiHarness.StartAsync(true, FireworksApiHarness.UnthrottledRateLimits,
            services => services.ConfigureDbContext<FireworksDbContext>(o => o.AddInterceptors(interceptor)));
        var source = await CreateAsync(h);
        using var unknown = await h.Client.GetAsync("/api/creations/abcdefgh");
        var notFoundBytes = await unknown.Content.ReadAsByteArrayAsync();

        interceptor.Arm(h.ConnectionString, source);
        using var response = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Post, $"/api/creations/{source}/remix",
            $"{{\"document\":{CreationEndpointTests.Peony}}}");

        Assert.Equal(1, interceptor.Fired);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(notFoundBytes, await response.Content.ReadAsByteArrayAsync());
        await using var db = h.NewContext();
        Assert.False(await db.Creations.AnyAsync());
    }

    /// <summary>
    /// Once armed, deletes the source row through its own connection just before the first save
    /// that has a creation in <paramref name="trigger"/> state referencing a remix source (Modified:
    /// the PUT of a remix; Added: the remix insert).
    /// </summary>
    private sealed class DeleteSourceBeforeSaveInterceptor(EntityState trigger) : SaveChangesInterceptor
    {
        private string? connectionString;
        private string? sourceCode;

        public int Fired { get; private set; }

        public void Arm(string connection, string code) => (connectionString, sourceCode) = (connection, code);

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (sourceCode is { } code && eventData.Context!.ChangeTracker.Entries<Creation>()
                    .Any(e => e.State == trigger && e.Entity.RemixedFromId is not null))
            {
                sourceCode = null;
                Fired++;
                await using var other = new FireworksDbContext(
                    new DbContextOptionsBuilder<FireworksDbContext>().UseSqlite(connectionString).Options);
                Assert.Equal(1, await other.Creations.Where(c => c.ShareCode == code).ExecuteDeleteAsync(cancellationToken));
            }

            return result;
        }
    }
}

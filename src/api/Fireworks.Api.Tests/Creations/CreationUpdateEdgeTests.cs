using System.Net;
using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Fireworks.Api.Tests.Creations;

/// <summary>
/// PUT edges the round-trip test can't see (Toad, Phase 4 QA), through real Kestrel and the real
/// repository on SQLite. Each test was shown to fail on a named mutant:
/// <list type="bullet">
/// <item>the stored palette is recomputed on update (mutant: drop <c>creation.Palette = content.Palette</c>
/// in <c>CreationRepository.UpdateOwnedAsync</c>; the round trip passed it because it PUTs a document
/// with the same colors);</item>
/// <item>a DELETE that lands between the PUT's load and its save is a 404 with the fixed body, not a 500
/// (mutant: drop the <c>DbUpdateConcurrencyException</c> catch).</item>
/// </list>
/// </summary>
public sealed class CreationUpdateEdgeTests
{
    private static readonly string Blue = CreationEndpointTests.Peony
        .Replace("\"color1\":\"red\"", "\"color1\":\"blue\"")
        .Replace("\"color2\":\"gold\"", "\"color2\":\"none\"");

    private static async Task<string> CreateAsync(FireworksApiHarness h)
    {
        using var response = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Post, "/api/creations",
            $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("shareCode").GetString()!;
    }

    [Fact]
    public async Task Update_recomputes_the_stored_palette_and_my_creations_shows_it()
    {
        Assert.NotEqual(CreationEndpointTests.Peony, Blue);
        await using var h = await FireworksApiHarness.StartAsync(true, FireworksApiHarness.UnthrottledRateLimits);
        var code = await CreateAsync(h);

        using var put = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Put, $"/api/creations/{code}", $"{{\"document\":{Blue}}}");
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        await using (var db = h.NewContext())
        {
            Assert.Equal(["blue"], (await db.Creations.AsNoTracking().SingleAsync(c => c.ShareCode == code)).Palette);
        }

        using var list = await h.Client.GetAsync("/api/me/creations");
        using var page = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
        var item = Assert.Single(page.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal(["blue"], item.GetProperty("palette").EnumerateArray().Select(c => c.GetString()));
    }

    [Fact]
    public async Task A_delete_that_lands_between_the_PUTs_load_and_save_is_the_fixed_404()
    {
        var interceptor = new DeleteBeforeUpdateInterceptor();
        await using var h = await FireworksApiHarness.StartAsync(true, FireworksApiHarness.UnthrottledRateLimits,
            services => services.ConfigureDbContext<FireworksDbContext>(o => o.AddInterceptors(interceptor)));
        var code = await CreateAsync(h);
        using var unknown = await h.Client.GetAsync("/api/creations/abcdefgh");
        var notFoundBytes = await unknown.Content.ReadAsByteArrayAsync();

        interceptor.Arm(h.ConnectionString, code);
        using var put = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Put, $"/api/creations/{code}", $"{{\"document\":{Blue}}}");

        Assert.Equal(1, interceptor.Fired);
        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);
        Assert.Equal(notFoundBytes, await put.Content.ReadAsByteArrayAsync());
        await using var db = h.NewContext();
        Assert.False(await db.Creations.AnyAsync(c => c.ShareCode == code));
    }

    /// <summary>
    /// Once armed, deletes the row through its own connection just before the first save that
    /// modifies a creation: the deterministic form of "a concurrent DELETE won".
    /// </summary>
    private sealed class DeleteBeforeUpdateInterceptor : SaveChangesInterceptor
    {
        private string? connectionString;
        private string? shareCode;

        public int Fired { get; private set; }

        public void Arm(string connection, string code) => (connectionString, shareCode) = (connection, code);

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (shareCode is { } code && eventData.Context!.ChangeTracker.Entries<Creation>().Any(e => e.State == EntityState.Modified))
            {
                shareCode = null;
                Fired++;
                await using var other = new FireworksDbContext(
                    new DbContextOptionsBuilder<FireworksDbContext>().UseSqlite(connectionString).Options);
                Assert.Equal(1, await other.Creations.Where(c => c.ShareCode == code).ExecuteDeleteAsync(cancellationToken));
            }

            return result;
        }
    }
}

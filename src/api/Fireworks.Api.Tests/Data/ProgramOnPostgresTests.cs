using System.Net;
using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Tests.Data;

/// <summary>
/// The real Program.cs, as a child process in Production mode, against real Postgres: the same
/// checks Phase 1's "Done when" makes on Railway (migration in the startup log, liveness is
/// text/plain, <c>/api/nope</c> is 404, deep links get index.html), plus <c>api/me</c> with
/// <c>canWrite</c> following <c>Identity__AllowAnonymousWrites</c> exactly as Railway sets it.
/// The harness-based tests re-implement the pipeline; this one is what catches Program.cs drifting
/// from them.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ProgramOnPostgresTests
{
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(90);

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Real_program_migrates_on_start_and_serves_the_skeleton_contract()
    {
        await using (var reset = new FireworksDbContext(new DbContextOptionsBuilder<FireworksDbContext>()
                         .UseNpgsql(PostgresFactAttribute.ConnectionString).Options))
        {
            await reset.Database.EnsureDeletedAsync();
        }

        using var webRoot = new TempWebRoot();
        var baseUrl = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}";
        await using var api = ApiProcess.Start(new Dictionary<string, string>
        {
            ["ASPNETCORE_ENVIRONMENT"] = "Production",
            ["ASPNETCORE_URLS"] = baseUrl,
            ["ConnectionStrings__Postgres"] = PostgresFactAttribute.ConnectionString,
            ["Identity__DefaultUserId"] = TestIdentity.UserId.ToString(),
            ["Identity__AllowAnonymousWrites"] = "true"
        }, "--webroot", webRoot.Path);

        await api.WaitForOutputAsync("Now listening on", StartTimeout);
        Assert.Contains("Applying migration", api.Output);
        Assert.Contains("_InitialCreate", api.Output);

        using var client = new HttpClient { BaseAddress = new Uri(baseUrl) };

        using (var health = await client.GetAsync("/health/live"))
        {
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);
            Assert.Equal("text/plain", health.Content.Headers.ContentType?.MediaType);
            Assert.Equal("Healthy", await health.Content.ReadAsStringAsync());
        }

        using (var nope = await client.GetAsync("/api/nope"))
        {
            Assert.Equal(HttpStatusCode.NotFound, nope.StatusCode);
        }

        using (var deepLink = await client.GetAsync("/designer"))
        {
            Assert.Equal(HttpStatusCode.OK, deepLink.StatusCode);
            Assert.Contains(TempWebRoot.IndexMarker, await deepLink.Content.ReadAsStringAsync());
        }

        using (var me = await client.GetAsync("/api/me"))
        {
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var json = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(TestIdentity.UserId, json.RootElement.GetProperty("userId").GetGuid());
            Assert.False(json.RootElement.GetProperty("isAuthenticated").GetBoolean());
            Assert.True(json.RootElement.GetProperty("canWrite").GetBoolean());
        }
    }
}

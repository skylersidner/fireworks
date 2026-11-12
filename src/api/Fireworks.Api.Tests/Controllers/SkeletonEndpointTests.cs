using System.Net;
using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Tests.Support;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Tests.Controllers;

/// <summary>
/// The Phase 1 pipeline contract, through real Kestrel and model binding (plan Phase 1 "Done
/// when"): liveness is the health check, unknown API paths are 404, deep links get index.html, and
/// <c>GET api/me</c> has exactly the agreed camelCase shape.
/// </summary>
public sealed class SkeletonEndpointTests
{
    [Fact]
    public async Task Health_live_is_text_plain_Healthy_from_the_health_check()
    {
        await using var harness = await FireworksApiHarness.StartAsync();

        using var response = await harness.Client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // text/plain is what separates the health check from the SPA fallback, which would also
        // answer 200 — with text/html — if the MapHealthChecks line went missing.
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unknown_api_path_is_404_and_not_the_spa_index()
    {
        await using var harness = await FireworksApiHarness.StartAsync();

        using var response = await harness.Client.GetAsync("/api/nope");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.DoesNotContain(TempWebRoot.IndexMarker, await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/designer")]
    [InlineData("/s/abc123")]
    public async Task Non_api_paths_get_index_html_from_the_spa_fallback(string path)
    {
        // The positive control for the 404 test above: the fallback really is serving index.html
        // in this host, so a 404 on /api/nope comes from the /api guard, not from a missing file.
        await using var harness = await FireworksApiHarness.StartAsync();

        using var response = await harness.Client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains(TempWebRoot.IndexMarker, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Me_has_exactly_the_four_agreed_camelCase_fields()
    {
        await using var harness = await FireworksApiHarness.StartAsync();

        using var response = await harness.Client.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var names = json.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(["canWrite", "displayName", "isAuthenticated", "userId"], names);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Me_reports_the_configured_default_user_and_canWrite_from_config(bool allowAnonymousWrites)
    {
        await using var harness = await FireworksApiHarness.StartAsync(allowAnonymousWrites);

        using var response = await harness.Client.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        Assert.Equal(TestIdentity.UserId, root.GetProperty("userId").GetGuid());
        Assert.Equal(FireworksDbInitializer.DefaultUserDisplayName, root.GetProperty("displayName").GetString());
        Assert.False(root.GetProperty("isAuthenticated").GetBoolean());
        Assert.Equal(allowAnonymousWrites, root.GetProperty("canWrite").GetBoolean());
    }

    [Fact]
    public async Task Me_is_404_when_the_current_users_row_is_missing()
    {
        await using var harness = await FireworksApiHarness.StartAsync();
        await using (var db = harness.NewContext())
        {
            await db.Users.Where(u => u.Id == TestIdentity.UserId).ExecuteDeleteAsync();
        }

        using var response = await harness.Client.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

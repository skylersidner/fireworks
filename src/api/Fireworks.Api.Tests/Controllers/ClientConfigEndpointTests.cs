using System.Net;
using System.Text.Json;
using Fireworks.Api.Services.ClientConfig;
using Fireworks.Api.Services.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Fireworks.Api.Tests.Controllers;

/// <summary>
/// <c>GET api/client-config</c> through real Kestrel: the exact camelCase shape the SPA reads, the
/// <c>/api</c> response headers, the read rate-limit policy, and that the values come from the
/// <c>ClientPlayback</c> section rather than from literals in the controller.
/// </summary>
public sealed class ClientConfigEndpointTests
{
    private static async Task<JsonElement> GetPlaybackAsync(FireworksApiHarness harness)
    {
        using var response = await harness.Client.GetAsync("/api/client-config");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("playback").Clone();
    }

    [Fact]
    public async Task Has_exactly_the_agreed_camelCase_shape_with_the_committed_defaults()
    {
        await using var harness = await FireworksApiHarness.StartAsync();

        using var response = await harness.Client.GetAsync("/api/client-config");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        Assert.Equal(["playback", "loginProviders"], root.EnumerateObject().Select(p => p.Name).ToArray());
        // schema.md §2.8: exactly the configured provider (the harness configures the stub's Google).
        Assert.Equal("""[{"id":"google","name":"Google"}]""", root.GetProperty("loginProviders").GetRawText());
        var playback = root.GetProperty("playback");
        Assert.Equal(
            ["catchingUpDelayMs", "checkpointIntervalSeconds", "checkpointMemoryMiB", "seekBudgetMs", "warmUpDelayMs"],
            playback.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(25, playback.GetProperty("seekBudgetMs").GetInt32());
        Assert.Equal(300, playback.GetProperty("catchingUpDelayMs").GetInt32());
        Assert.Equal(10, playback.GetProperty("checkpointIntervalSeconds").GetInt32());
        Assert.Equal(64, playback.GetProperty("checkpointMemoryMiB").GetInt32());
        Assert.Equal(1000, playback.GetProperty("warmUpDelayMs").GetInt32());
    }

    [Fact]
    public async Task Gets_the_api_response_headers()
    {
        await using var harness = await FireworksApiHarness.StartAsync();

        using var response = await harness.Client.GetAsync("/api/client-config");

        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task Every_value_comes_from_the_ClientPlayback_section()
    {
        // Each value differs from its default, so a literal in the controller (or a swapped pair of
        // fields) fails here.
        await using var harness = await FireworksApiHarness.StartAsync(configuration: new Dictionary<string, string?>
        {
            ["ClientPlayback:SeekBudgetMs"] = "40",
            ["ClientPlayback:CatchingUpDelayMs"] = "1200",
            ["ClientPlayback:CheckpointIntervalSeconds"] = "20",
            ["ClientPlayback:CheckpointMemoryMiB"] = "128",
            ["ClientPlayback:WarmUpDelayMs"] = "2500"
        });

        var playback = await GetPlaybackAsync(harness);

        Assert.Equal(40, playback.GetProperty("seekBudgetMs").GetInt32());
        Assert.Equal(1200, playback.GetProperty("catchingUpDelayMs").GetInt32());
        Assert.Equal(20, playback.GetProperty("checkpointIntervalSeconds").GetInt32());
        Assert.Equal(128, playback.GetProperty("checkpointMemoryMiB").GetInt32());
        Assert.Equal(2500, playback.GetProperty("warmUpDelayMs").GetInt32());
    }

    [Fact]
    public async Task With_no_Google_client_in_Testing_loginProviders_is_empty()
    {
        await using var harness = await FireworksApiHarness.StartAsync(withGoogle: false);
        using var json = JsonDocument.Parse(await harness.Client.GetStringAsync("/api/client-config"));
        Assert.Equal("[]", json.RootElement.GetProperty("loginProviders").GetRawText());
    }

    [Fact]
    public async Task Carries_no_identity_data_even_when_signed_in()
    {
        await using var harness = await FireworksApiHarness.StartAsync(signedIn: true);

        using var response = await harness.Client.GetAsync("/api/client-config");
        var body = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(harness.OwnerUserId.ToString(), body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("canWrite", body, StringComparison.Ordinal);
        Assert.DoesNotContain("user", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Falls_under_the_read_policy_and_shares_its_bucket_with_api_me()
    {
        await using var harness = await FireworksApiHarness.StartAsync(configuration: new Dictionary<string, string?>
        {
            ["RateLimits:Reads:PerMinute"] = "3"
        });

        using (var me = await harness.Client.GetAsync("/api/me"))
        {
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        }

        for (var i = 0; i < 2; i++)
        {
            using var ok = await harness.Client.GetAsync("/api/client-config");
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }

        // The fourth read in the window, whichever endpoint spent the first: one shared policy.
        using var limited = await harness.Client.GetAsync("/api/client-config");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.True(int.Parse(limited.Headers.GetValues("Retry-After").Single()) is > 0 and <= 60);
        Assert.Equal("no-store", limited.Headers.CacheControl?.ToString());

        using var otherRead = await harness.Client.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.TooManyRequests, otherRead.StatusCode);
    }

    [Fact]
    public async Task Unsupported_methods_fall_to_the_api_404_not_the_spa()
    {
        await using var harness = await FireworksApiHarness.StartAsync();

        using var response = await harness.Client.PostAsync("/api/client-config", new StringContent("{}"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("SeekBudgetMs", "3")]
    [InlineData("SeekBudgetMs", "101")]
    [InlineData("CatchingUpDelayMs", "-1")]
    [InlineData("CatchingUpDelayMs", "5001")]
    [InlineData("CheckpointIntervalSeconds", "0")]
    [InlineData("CheckpointIntervalSeconds", "61")]
    [InlineData("CheckpointMemoryMiB", "7")]
    [InlineData("CheckpointMemoryMiB", "513")]
    [InlineData("WarmUpDelayMs", "-1")]
    [InlineData("WarmUpDelayMs", "5001")]
    public void Registration_throws_at_once_on_an_out_of_range_value(string key, string value)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [$"ClientPlayback:{key}"] = value })
            .Build();

        // At registration, not when IOptions is first resolved: that is what puts it before the
        // database in Program.cs.
        var error = Assert.Throws<OptionsValidationException>(() => new ServiceCollection().AddFireworksClientConfig(configuration));

        Assert.Contains($"ClientPlayback:{key} must be between", error.Message);
    }

    [Theory]
    [InlineData(4, 0, 1, 8, 0)]
    [InlineData(100, 5000, 60, 512, 5000)]
    public async Task Control_the_range_ends_are_accepted(int seek, int delay, int interval, int memory, int warmUp)
    {
        await using var harness = await FireworksApiHarness.StartAsync(configuration: new Dictionary<string, string?>
        {
            ["ClientPlayback:SeekBudgetMs"] = seek.ToString(),
            ["ClientPlayback:CatchingUpDelayMs"] = delay.ToString(),
            ["ClientPlayback:CheckpointIntervalSeconds"] = interval.ToString(),
            ["ClientPlayback:CheckpointMemoryMiB"] = memory.ToString(),
            ["ClientPlayback:WarmUpDelayMs"] = warmUp.ToString()
        });

        var playback = await GetPlaybackAsync(harness);

        Assert.Equal(seek, playback.GetProperty("seekBudgetMs").GetInt32());
        Assert.Equal(memory, playback.GetProperty("checkpointMemoryMiB").GetInt32());
        Assert.Equal(warmUp, playback.GetProperty("warmUpDelayMs").GetInt32());
    }

    [Fact]
    public void The_class_defaults_are_the_contract_values()
    {
        var defaults = new ClientPlaybackOptions();
        Assert.Equal((25, 300, 10, 64, 1000),
            (defaults.SeekBudgetMs, defaults.CatchingUpDelayMs, defaults.CheckpointIntervalSeconds, defaults.CheckpointMemoryMiB, defaults.WarmUpDelayMs));
    }
}

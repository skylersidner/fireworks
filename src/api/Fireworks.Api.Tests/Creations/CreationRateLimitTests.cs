using System.Net;
using Fireworks.Api.Services.RateLimiting;
using Fireworks.Api.Tests.Controllers;
using Microsoft.AspNetCore.Http;

namespace Fireworks.Api.Tests.Creations;

/// <summary>Boo S17-S20: IP partitions, 429 with Retry-After, separate write and read policies, health exempt.</summary>
public sealed class CreationRateLimitTests
{
    private static Task<FireworksApiHarness> StartAsync(bool writes, int writesPerMinute = 20, int readsPerMinute = 120) =>
        FireworksApiHarness.StartAsync(writes, new Dictionary<string, string?>
        {
            ["RateLimits:Writes:PerMinute"] = writesPerMinute.ToString(),
            ["RateLimits:Reads:PerMinute"] = readsPerMinute.ToString()
        }, clientIpOverride: true);

    private static HttpRequestMessage Request(HttpMethod method, string path, string? ip = null, string? json = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (ip is not null)
        {
            request.Headers.Add(FireworksApiHarness.TestClientIpHeader, ip);
        }

        if (json is not null)
        {
            request.Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        }

        return request;
    }

    private static string Create => $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}";

    [Theory]
    [InlineData("203.0.113.7", "203.0.113.7")]
    [InlineData("::ffff:203.0.113.7", "203.0.113.7")]
    [InlineData("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:2::1", "2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:3::1", "2001:db8:1:3::/64")]
    public void Partition_key_is_the_IPv4_address_or_the_IPv6_64(string address, string key)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(address);
        Assert.Equal(key, FireworksRateLimiting.PartitionKey(context));
    }

    [Fact]
    public void No_address_is_one_shared_unknown_bucket_never_unlimited() =>
        Assert.Equal("unknown", FireworksRateLimiting.PartitionKey(new DefaultHttpContext()));

    [Fact]
    public void The_committed_defaults_are_20_a_minute_300_a_day_and_120_reads()
    {
        var options = new FireworksRateLimitOptions();
        Assert.Equal((20, 300, 120), (options.Writes.PerMinute, options.Writes.PerDay, options.Reads.PerMinute));
    }

    [Fact]
    public async Task The_write_budget_is_shared_by_every_write_endpoint_and_rejects_with_429_and_Retry_After()
    {
        await using var h = await StartAsync(writes: true, writesPerMinute: 3);

        using var first = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        using var second = await h.Client.SendAsync(Request(HttpMethod.Delete, "/api/creations/abcdefgh"));
        Assert.Equal(HttpStatusCode.NotFound, second.StatusCode); // a 404 still spends a permit
        using var third = await h.Client.SendAsync(Request(HttpMethod.Put, "/api/creations/abcdefgh", json: "{\"document\":{}}"));
        Assert.Equal(HttpStatusCode.NotFound, third.StatusCode); // unknown code: 404 before the document walk

        using var fourth = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations/abcdefgh/remix", json: "{}"));
        Assert.Equal(HttpStatusCode.TooManyRequests, fourth.StatusCode);
        Assert.True(int.Parse(fourth.Headers.GetValues("Retry-After").Single()) is > 0 and <= 60);

        // Another client is a different partition.
        using var other = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", "198.51.100.9", Create));
        Assert.Equal(HttpStatusCode.Created, other.StatusCode);

        // Reads are a separate policy: the share-code GET still works, and so does the probe.
        var code = System.Text.Json.JsonDocument.Parse(await first.Content.ReadAsStringAsync()).RootElement.GetProperty("shareCode").GetString();
        using var read = await h.Client.GetAsync($"/api/creations/{code}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    [Fact]
    public async Task With_writes_off_403s_still_spend_the_write_budget()
    {
        await using var h = await StartAsync(writes: false, writesPerMinute: 3);

        for (var i = 0; i < 3; i++)
        {
            using var forbidden = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create));
            Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        }

        using var limited = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create));
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
    }

    [Fact]
    public async Task Reads_including_the_catch_all_and_api_me_share_120_a_minute_and_health_is_never_limited()
    {
        // The committed read default, not a lowered one.
        await using var h = await StartAsync(writes: true, writesPerMinute: 1);

        using (var write = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create)))
        {
            Assert.Equal(HttpStatusCode.Created, write.StatusCode);
        }

        using (var limitedWrite = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create)))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, limitedWrite.StatusCode);
        }

        var paths = new[] { "/api/nope", "/api/me", "/api/creations/abcdefgh", "/api/me/creations" };
        for (var i = 0; i < 120; i++)
        {
            using var response = await h.Client.GetAsync(paths[i % paths.Length]);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        }

        foreach (var path in paths)
        {
            using var limited = await h.Client.GetAsync(path);
            Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        }

        // Both policies exhausted; the probe still answers.
        for (var i = 0; i < 50; i++)
        {
            using var health = await h.Client.GetAsync("/health/live");
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);
            Assert.Equal("Healthy", await health.Content.ReadAsStringAsync());
        }

        // The SPA fallback isn't limited either.
        using var spa = await h.Client.GetAsync("/designer");
        Assert.Equal(HttpStatusCode.OK, spa.StatusCode);
    }
}

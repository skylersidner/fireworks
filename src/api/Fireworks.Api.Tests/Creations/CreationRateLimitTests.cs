using System.Net;
using Fireworks.Api.Services.RateLimiting;
using Fireworks.Api.Tests.Controllers;
using Microsoft.AspNetCore.Http;

namespace Fireworks.Api.Tests.Creations;

/// <summary>
/// Boo S17-S20, A30: user partitions when signed in and IP partitions otherwise, 429 with
/// Retry-After, separate write, read and auth policies, health exempt, and 401s before the limiter.
/// </summary>
public sealed class CreationRateLimitTests
{
    private static Task<FireworksApiHarness> StartAsync(bool writes, int writesPerMinute = 20, int readsPerMinute = 120, int authPerMinute = 20) =>
        FireworksApiHarness.StartAsync(writes, new Dictionary<string, string?>
        {
            ["RateLimits:Writes:PerMinute"] = writesPerMinute.ToString(),
            ["RateLimits:Reads:PerMinute"] = readsPerMinute.ToString(),
            ["RateLimits:Auth:PerMinute"] = authPerMinute.ToString()
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
    [InlineData("203.0.113.7", "ip:203.0.113.7")]
    [InlineData("::ffff:203.0.113.7", "ip:203.0.113.7")]
    [InlineData("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "ip:2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:2::1", "ip:2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:3::1", "ip:2001:db8:1:3::/64")]
    public void Anonymous_partition_key_is_ip_and_the_IPv4_address_or_the_IPv6_64(string address, string key)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(address);
        Assert.Equal(key, FireworksRateLimiting.PartitionKey(context));
    }

    [Fact]
    public void No_address_is_one_shared_unknown_bucket_never_unlimited() =>
        Assert.Equal("ip:unknown", FireworksRateLimiting.PartitionKey(new DefaultHttpContext()));

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
        Assert.Equal(HttpStatusCode.PreconditionRequired, third.StatusCode); // no If-Match: 428 after the limiter

        using var fourth = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations/abcdefgh/remix", json: "{}"));
        Assert.Equal(HttpStatusCode.TooManyRequests, fourth.StatusCode);
        Assert.True(int.Parse(fourth.Headers.GetValues("Retry-After").Single()) is > 0 and <= 60);

        // Signed in, the partition is the user, not the address: the same user from another address
        // is still limited, and another user from the SAME address is not (Boo A30).
        using var sameUserElsewhere = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", "198.51.100.9", Create));
        Assert.Equal(HttpStatusCode.TooManyRequests, sameUserElsewhere.StatusCode);
        var bob = await h.SignInAsync(Support.TestIdentity.Bob);
        using var other = await bob.Http.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create));
        Assert.Equal(HttpStatusCode.Created, other.StatusCode);

        // Reads are a separate policy: the share-code GET still works, and so does the probe.
        var code = System.Text.Json.JsonDocument.Parse(await first.Content.ReadAsStringAsync()).RootElement.GetProperty("shareCode").GetString();
        using var read = await h.Client.GetAsync($"/api/creations/{code}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    [Fact]
    public async Task Anonymous_401s_come_before_the_limiter_and_spend_nothing()
    {
        await using var h = await StartAsync(writes: false, writesPerMinute: 3);

        for (var i = 0; i < 6; i++)
        {
            using var unauthorized = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create));
            Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        }

        // The IP's write bucket is untouched: a user signing in from it writes three times.
        var alice = await h.SignInAsync(Support.TestIdentity.Alice);
        for (var i = 0; i < 3; i++)
        {
            using var created = await alice.Http.SendAsync(Request(HttpMethod.Post, "/api/creations", json: Create));
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        }
    }

    [Fact]
    public async Task Anonymous_reads_from_one_address_share_a_bucket_and_another_address_has_its_own()
    {
        await using var h = await StartAsync(writes: false, readsPerMinute: 3);
        for (var i = 0; i < 3; i++)
        {
            using var ok = await h.Client.SendAsync(Request(HttpMethod.Get, i % 2 == 0 ? "/api/me" : "/api/client-config", "203.0.113.1"));
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }

        using var limited = await h.Client.SendAsync(Request(HttpMethod.Get, "/api/me", "203.0.113.1"));
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        using var elsewhere = await h.Client.SendAsync(Request(HttpMethod.Get, "/api/me", "203.0.113.2"));
        Assert.Equal(HttpStatusCode.OK, elsewhere.StatusCode);
    }

    [Fact]
    public async Task The_auth_policy_limits_login_and_logout_together_per_address()
    {
        await using var h = await StartAsync(writes: false, authPerMinute: 4);
        for (var i = 0; i < 2; i++)
        {
            using var login = await h.Client.SendAsync(Request(HttpMethod.Get, "/api/auth/login/google", "203.0.113.5"));
            Assert.Equal(HttpStatusCode.Found, login.StatusCode);
            using var logout = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/auth/logout", "203.0.113.5"));
            Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        }

        using var fifth = await h.Client.SendAsync(Request(HttpMethod.Get, "/api/auth/login/google", "203.0.113.5"));
        Assert.Equal(HttpStatusCode.TooManyRequests, fifth.StatusCode);
        Assert.Empty(fifth.Headers.Where(header => header.Key == "Set-Cookie"));
        using var sixth = await h.Client.SendAsync(Request(HttpMethod.Post, "/api/auth/logout", "203.0.113.5"));
        Assert.Equal(HttpStatusCode.TooManyRequests, sixth.StatusCode);
        using var other = await h.Client.SendAsync(Request(HttpMethod.Get, "/api/auth/login/google", "203.0.113.6"));
        Assert.Equal(HttpStatusCode.Found, other.StatusCode);
    }

    [Fact]
    public void The_committed_auth_default_is_20_a_minute() =>
        Assert.Equal(20, new FireworksRateLimitOptions().Auth.PerMinute);

    [Fact]
    public async Task Reads_including_the_catch_all_api_me_and_client_config_share_120_a_minute_and_health_is_never_limited()
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

        var paths = new[] { "/api/nope", "/api/me", "/api/creations/abcdefgh", "/api/me/creations", "/api/client-config" };
        // One read was spent by the sign-in helper's api/me.
        for (var i = 0; i < 119; i++)
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

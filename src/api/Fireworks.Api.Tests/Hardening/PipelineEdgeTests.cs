using System.Net;
using System.Text;
using Fireworks.Api.Tests.Controllers;

namespace Fireworks.Api.Tests.Hardening;

/// <summary>
/// Boo P7-S8 (chunked <c>Connection: close</c>) and P7-S3 (HSTS) on the Kestrel harness. The HSTS
/// check through the real forwarded-headers middleware is in <c>ProgramOnPostgresTests</c>; through
/// Railway's edge it is [R] DEFERRED, as is the hop-by-hop <c>Connection</c> behaviour.
/// </summary>
public sealed class PipelineEdgeTests
{
    private static byte[] Chunked(int totalBytes, int chunkSize = 8192)
    {
        var body = new MemoryStream();
        var chunk = new byte[chunkSize];
        Array.Fill(chunk, (byte)' ');
        for (var sent = 0; sent < totalBytes; sent += chunkSize)
        {
            var size = Math.Min(chunkSize, totalBytes - sent);
            body.Write(Encoding.ASCII.GetBytes($"{size:x}\r\n"));
            body.Write(chunk, 0, size);
            body.Write("\r\n"u8);
        }

        body.Write("0\r\n\r\n"u8);
        return body.ToArray();
    }

    private static byte[] ChunkedHead(string path) => Encoding.ASCII.GetBytes(
        $"POST {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n");

    /// <summary>
    /// A chunked body has no declared length, so the old declared-length rule never fired. Mutant:
    /// drop the <c>CanHaveBody</c> branch in <c>ResponseHeaders</c>, and both heads lose
    /// <c>Connection: close</c> (Boo measured the pooled client's next request failing without it).
    /// </summary>
    [Theory]
    [InlineData(false, "403")]
    [InlineData(true, "413")]
    public async Task A_chunked_body_over_the_limit_is_answered_with_Connection_close(bool writes, string status)
    {
        await using var h = await FireworksApiHarness.StartAsync(writes, FireworksApiHarness.UnthrottledRateLimits);

        var head = await HeaderExpectations.RawHeadAsync(h.Client.BaseAddress!, ChunkedHead("/api/creations"), Chunked(300 * 1024));

        Assert.StartsWith($"HTTP/1.1 {status}", head);
        Assert.Equal("close", HeaderExpectations.RawHeader(head, "Connection"));
    }

    /// <summary>Accepted (Boo P7-S8): an under-limit chunked write is closed too; browsers never send one.</summary>
    [Fact]
    public async Task An_under_limit_chunked_write_is_also_closed()
    {
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);

        var head = await HeaderExpectations.RawHeadAsync(h.Client.BaseAddress!, ChunkedHead("/api/creations"), Chunked(100));

        Assert.StartsWith("HTTP/1.1 403", head);
        Assert.Equal("close", HeaderExpectations.RawHeader(head, "Connection"));
    }

    /// <summary>The control: a small declared-length write keeps its connection, so the header above means something.</summary>
    [Fact]
    public async Task A_small_declared_length_write_and_a_GET_keep_the_connection()
    {
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);

        using var post = await h.Client.PostAsync("/api/creations", new StringContent("{}", Encoding.UTF8, "application/json"));
        using var get = await h.Client.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Forbidden, post.StatusCode);
        Assert.NotEqual(true, post.Headers.ConnectionClose);
        Assert.NotEqual(true, get.Headers.ConnectionClose);
    }

    /// <summary>Outside /api nothing reads a body, and the rule doesn't apply.</summary>
    [Fact]
    public async Task The_rule_is_scoped_to_api()
    {
        await using var h = await FireworksApiHarness.StartAsync();

        var head = await HeaderExpectations.RawHeadAsync(h.Client.BaseAddress!, ChunkedHead("/show"), Chunked(100));

        Assert.StartsWith("HTTP/1.1 405", head);
        Assert.Null(HeaderExpectations.RawHeader(head, "Connection"));
    }

    [Theory]
    [InlineData("Testing", "https", true)]
    [InlineData("Production", "https", true)]
    [InlineData("Testing", "http", false)]
    [InlineData("Development", "https", false)]
    public async Task HSTS_only_over_https_and_outside_Development(string environment, string scheme, bool expected)
    {
        await using var h = await FireworksApiHarness.StartAsync(schemeOverride: true, environmentName: environment);

        foreach (var path in new[] { "/", "/api/me", "/health/live", "/nope.js" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Add(FireworksApiHarness.TestSchemeHeader, scheme);
            using var response = await h.Client.SendAsync(request);

            Assert.Empty(HeaderExpectations.Problems(response, expectHsts: expected));
        }
    }
}

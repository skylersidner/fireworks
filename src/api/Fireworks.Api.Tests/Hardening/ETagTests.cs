using System.Net;
using System.Text.Json;
using Fireworks.Api.Controllers;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Creations;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Hardening;

/// <summary>
/// schema.md §2.1.1 and Boo P7-S5: the strong <c>"&lt;updatedAt&gt;"</c> tag on every
/// <c>CreationResponse</c>, and the share-code GET's 304. Mutants recorded in the Phase 7 B1 record:
/// <c>ToString("O")</c> for the token; a weak tag; strong comparison; the 304 without
/// <c>Cache-Control</c>; the 304 before the lookup.
/// </summary>
public sealed class ETagTests
{
    private const string Private = "private, no-cache";

    private static async Task<FireworksApiHarness> StartAsync(int readsPerMinute = 100000) =>
        await FireworksApiHarness.StartAsync(true, new Dictionary<string, string?>
        {
            ["RateLimits:Writes:PerMinute"] = "100000",
            ["RateLimits:Writes:PerDay"] = "100000",
            ["RateLimits:Reads:PerMinute"] = readsPerMinute.ToString()
        });

    /// <summary>The body's <c>updatedAt</c> exactly as the JSON text carries it (decoded string value).</summary>
    private static async Task<string> BodyUpdatedAtAsync(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("updatedAt").GetString()!;
    }

    private static string ETagOf(HttpResponseMessage response) =>
        response.Headers.GetValues("ETag").Single();

    private static Task<HttpResponseMessage> GetAsync(FireworksApiHarness h, string code, string? ifNoneMatch = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"/api/creations/{code}");
        if (ifNoneMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        }

        return h.Client.SendAsync(request);
    }

    private static Task<HttpResponseMessage> PutAsync(FireworksApiHarness h, string code, string name) =>
        CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Put, $"/api/creations/{code}",
            $"{{\"document\":{CreationEndpointTests.Peony.Replace("\"Peony\"", $"\"{name}\"")}}}");

    [Fact]
    public async Task Every_creation_response_carries_the_strong_updatedAt_tag()
    {
        await using var h = await StartAsync();

        using var created = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Post, "/api/creations",
            $"{{\"kind\":\"shell\",\"document\":{CreationEndpointTests.Peony}}}");
        using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var code = createdJson.RootElement.GetProperty("shareCode").GetString()!;
        using var got = await GetAsync(h, code);
        using var put = await PutAsync(h, code, "Renamed");
        using var remix = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Post, $"/api/creations/{code}/remix",
            $"{{\"document\":{CreationEndpointTests.Peony}}}");

        foreach (var (name, response, status) in new[]
                 {
                     ("POST", created, HttpStatusCode.Created), ("GET", got, HttpStatusCode.OK),
                     ("PUT", put, HttpStatusCode.OK), ("remix", remix, HttpStatusCode.Created)
                 })
        {
            Assert.True(response.StatusCode == status, $"{name}: {(int)response.StatusCode}");
            var tag = ETagOf(response);
            Assert.Equal("\"" + await BodyUpdatedAtAsync(response) + "\"", tag);
            Assert.False(response.Headers.ETag!.IsWeak, name);
        }

        // Writes stay no-store; only the GET relaxes.
        Assert.Equal("no-store", HeaderExpectations.CacheControl(created));
        Assert.Equal("no-store", HeaderExpectations.CacheControl(put));
        Assert.Equal("no-store", HeaderExpectations.CacheControl(remix));
        Assert.Equal(Private, HeaderExpectations.CacheControl(got));
    }

    /// <summary>
    /// The token is the body's string, not <c>ToString("O")</c>. Timestamps are stored to whole
    /// microseconds, so "O" always pads a seventh digit that STJ trims: the two can never be equal,
    /// and this kills a <c>ToString("O")</c> mutant on every run.
    /// </summary>
    [Fact]
    public async Task The_token_is_not_ToString_O()
    {
        await using var h = await StartAsync();
        var code = await ResponseHeaderTests.CreateAsync(h.Client);
        using var got = await GetAsync(h, code);
        var bodyValue = await BodyUpdatedAtAsync(got);
        var parsed = DateTimeOffset.Parse(bodyValue, System.Globalization.CultureInfo.InvariantCulture);

        Assert.NotEqual("\"" + parsed.ToString("O") + "\"", ETagOf(got));
        Assert.Equal(ETagOf(got),
            CreationsController.EntityTagFor(parsed, new JsonSerializerOptions(JsonSerializerDefaults.Web)).ToString());
    }

    [Theory]
    [InlineData("{tag}")]
    [InlineData("W/{tag}")]
    [InlineData("\"other\", {tag}")]
    [InlineData("\"other\",W/{tag}")]
    [InlineData("*")]
    public async Task If_None_Match_hit_is_a_bodiless_304_with_the_same_tag_and_cache_control(string header)
    {
        await using var h = await StartAsync();
        var code = await ResponseHeaderTests.CreateAsync(h.Client);
        using var first = await GetAsync(h, code);
        var tag = ETagOf(first);

        using var response = await GetAsync(h, code, header.Replace("{tag}", tag));

        Assert.Equal(HttpStatusCode.NotModified, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(tag, ETagOf(response));
        Assert.Equal(Private, HeaderExpectations.CacheControl(response));
        Assert.Empty(HeaderExpectations.Problems(response));
    }

    [Theory]
    [InlineData("\"other\"")]
    [InlineData("garbage")]
    [InlineData("\"\"")]
    [InlineData("W/")]
    public async Task If_None_Match_miss_or_garbage_is_a_full_200(string header)
    {
        await using var h = await StartAsync();
        var code = await ResponseHeaderTests.CreateAsync(h.Client);

        using var response = await GetAsync(h, code, header);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(code, JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("shareCode").GetString());
        Assert.Equal(Private, HeaderExpectations.CacheControl(response));
    }

    [Fact]
    public async Task After_a_PUT_the_old_tag_gets_a_200_with_a_new_tag()
    {
        await using var h = await StartAsync();
        var code = await ResponseHeaderTests.CreateAsync(h.Client);
        using var first = await GetAsync(h, code);
        var oldTag = ETagOf(first);
        using (var put = await PutAsync(h, code, "Renamed"))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        }

        using var response = await GetAsync(h, code, oldTag);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEqual(oldTag, ETagOf(response));
        Assert.Equal("\"" + await BodyUpdatedAtAsync(response) + "\"", ETagOf(response));
    }

    /// <summary>The lookup comes first: <c>*</c> on an unknown code is the fixed 404, no-store, no tag.</summary>
    [Fact]
    public async Task An_unknown_code_is_404_no_store_whatever_If_None_Match_says()
    {
        await using var h = await StartAsync();

        using var response = await GetAsync(h, "abcdefgh", "*");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("no-store", HeaderExpectations.CacheControl(response));
        Assert.False(response.Headers.Contains("ETag"));
    }

    /// <summary>A conditional GET still counts toward the read limit, and its 429 is no-store.</summary>
    [Fact]
    public async Task A_conditional_GET_is_still_rate_limited()
    {
        await using var h = await StartAsync(readsPerMinute: 2);
        var code = await ResponseHeaderTests.CreateAsync(h.Client);
        using var first = await GetAsync(h, code);
        using var second = await GetAsync(h, code, ETagOf(first));
        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);

        using var third = await GetAsync(h, code, ETagOf(first));

        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        Assert.Equal("no-store", HeaderExpectations.CacheControl(third));
    }

    /// <summary>No If-Match before Phase 8 (Skyler Q7.4): a stale precondition doesn't stop the PUT.</summary>
    [Fact]
    public async Task If_Match_is_ignored()
    {
        await using var h = await StartAsync();
        var code = await ResponseHeaderTests.CreateAsync(h.Client);
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/creations/{code}")
        {
            Content = new StringContent($"{{\"document\":{CreationEndpointTests.Peony}}}", System.Text.Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("If-Match", "\"1999-01-01T00:00:00+00:00\"");

        using var response = await h.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}

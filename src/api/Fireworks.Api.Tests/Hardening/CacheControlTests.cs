using System.Net;
using Fireworks.Api.Services;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Hardening;

/// <summary>
/// Boo P7-S4 and P7-S7, the non-<c>/api</c> rows of §4: one <c>StaticFileOptions</c> for static
/// files and every fallback, keyed on the served file's name. Mutants recorded in the Phase 7 B1
/// record: drop the immutable branch (the hashed rows fail); remove the <c>/s/</c> and <c>/c/</c>
/// fallbacks (the dotted rows get 404); the fallback without the shared options (the deep-link rows
/// lose <c>no-cache</c>). Keying on the request path instead of the file name is an equivalent
/// mutant today and survives: every fallback either requires a <c>/s/</c> or <c>/c/</c> prefix or
/// skips dotted names, so no request path and served file disagree about "hashed".
/// </summary>
public sealed class CacheControlTests
{
    private const string Immutable = "public, max-age=31536000, immutable";
    private const string NoCache = "no-cache";
    private const string NoStore = "no-store";

    private static async Task<FireworksApiHarness> StartAsync()
    {
        var h = await ResponseHeaderTests.StartAsync();
        foreach (var file in new[] { "chunk--30TBvoS.js", "main-ABCD1234.js", "styles-Q1w2E3r4.css", "polyfills-abcdefgh.js", "main-abc.js", "3rdpartylicenses.txt" })
        {
            await File.WriteAllTextAsync(Path.Combine(h.WebRootPath, file), "x");
        }

        return h;
    }

    [Theory]
    [InlineData("/" + ResponseHeaderTests.HashedChunk, Immutable)]
    [InlineData("/chunk--30TBvoS.js", Immutable)]
    [InlineData("/main-ABCD1234.js", Immutable)]
    [InlineData("/styles-Q1w2E3r4.css", Immutable)]
    [InlineData("/polyfills-abcdefgh.js", Immutable)]
    // Exists, but its "hash" isn't 8 characters: an ordinary file, revalidated.
    [InlineData("/main-abc.js", NoCache)]
    [InlineData("/favicon.svg", NoCache)]
    [InlineData("/3rdpartylicenses.txt", NoCache)]
    [InlineData("/", NoCache)]
    [InlineData("/index.html", NoCache)]
    [InlineData("/s/abcdefgh", NoCache)]
    [InlineData("/c/abcdefgh", NoCache)]
    [InlineData("/show", NoCache)]
    [InlineData("/mine", NoCache)]
    [InlineData("/health/ready/x", NoCache)]
    public async Task Served_files_get_the_cache_policy_for_their_name(string path, string expected)
    {
        await using var h = await StartAsync();

        using var response = await h.Client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, HeaderExpectations.CacheControl(response));
        Assert.NotNull(response.Headers.ETag);
        Assert.NotNull(response.Content.Headers.LastModified);
    }

    [Theory]
    [InlineData("/" + ResponseHeaderTests.HashedChunk, Immutable)]
    [InlineData("/index.html", NoCache)]
    [InlineData("/s/abcdefgh", NoCache)]
    public async Task A_revalidation_304_keeps_the_same_policy(string path, string expected)
    {
        await using var h = await StartAsync();
        using var first = await h.Client.GetAsync(path);
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.IfNoneMatch.Add(first.Headers.ETag!);

        using var response = await h.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotModified, response.StatusCode);
        Assert.Equal(expected, HeaderExpectations.CacheControl(response));
    }

    /// <summary>OnPrepareResponse runs only when a file is served: a miss with a hashed-looking name is never immutable.</summary>
    [Theory]
    [InlineData("/chunk-BBBBBBBB.js")]
    [InlineData("/nope.js")]
    [InlineData("/x/a.b")]
    public async Task A_static_miss_is_404_no_store(string path)
    {
        await using var h = await StartAsync();

        using var response = await h.Client.GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(NoStore, HeaderExpectations.CacheControl(response));
    }

    /// <summary>
    /// P7-S7: a dotted last segment under /s/ and /c/ gets the app (and its not-found page), not a
    /// bare 404. Before Phase 7 these were 404 with an empty body (Boo §1, measured).
    /// </summary>
    [Theory]
    [InlineData("/c/..%2Fme")]
    [InlineData("/s/..%2Fme")]
    [InlineData("/s/a.b")]
    [InlineData("/c/a.b")]
    [InlineData("/s/abcdefgh.json")]
    public async Task Dotted_share_and_working_copy_links_get_index_html(string path)
    {
        await using var h = await StartAsync();

        using var response = await h.Client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains(TempWebRoot.IndexMarker, await response.Content.ReadAsStringAsync());
        Assert.Equal(NoCache, HeaderExpectations.CacheControl(response));
        Assert.Empty(HeaderExpectations.Problems(response));
    }

    [Fact]
    public async Task Health_keeps_the_frameworks_no_store_no_cache()
    {
        await using var h = await StartAsync();

        using var live = await h.Client.GetAsync("/health/live");
        using var ready = await h.Client.GetAsync("/health/ready");

        Assert.Equal("no-store, no-cache", HeaderExpectations.CacheControl(live));
        Assert.Equal("no-store, no-cache", HeaderExpectations.CacheControl(ready));
    }

    [Theory]
    [InlineData("chunk-C7TGCyiC.js", true)]
    [InlineData("chunk--30TBvoS.js", true)]
    [InlineData("chunk-DPd_NRye.js", true)]
    [InlineData("main-ABCDEFGH.js", true)]
    [InlineData("styles-ABCDEFGH.css", true)]
    [InlineData("polyfills-ABCDEFGH.js", true)]
    [InlineData("chunk-ABCDEFG.js", false)]
    [InlineData("chunk-ABCDEFGHI.js", false)]
    [InlineData("chunk-ABCDEFGH.js.map", false)]
    [InlineData("chunk-ABCDEFGH.js\n", false)]
    [InlineData("vendor-ABCDEFGH.js", false)]
    [InlineData("index.html", false)]
    [InlineData("favicon.svg", false)]
    [InlineData("styles-ABCDEFGH.js.css", false)]
    public void The_hashed_bundle_pattern(string name, bool hashed) =>
        Assert.Equal(hashed, SpaHosting.HashedBundle().IsMatch(name));

    /// <summary>Every hashed name the current build emits matches (so a build-naming change shows up here, not as a slow site).</summary>
    [Fact]
    public void Every_hashed_file_in_the_built_wwwroot_matches()
    {
        // wwwroot is build output (gitignored): on a clone with no SPA build there is nothing to check.
        var wwwroot = Path.Combine(RepoPaths.ApiSource, "wwwroot");
        if (!Directory.Exists(wwwroot))
        {
            return;
        }

        var names = Directory.GetFiles(wwwroot).Select(Path.GetFileName).ToList();
        var bundles = names.Where(n => n!.EndsWith(".js", StringComparison.Ordinal) || n.EndsWith(".css", StringComparison.Ordinal)).ToList();
        Assert.NotEmpty(bundles);
        Assert.All(bundles, n => Assert.True(SpaHosting.HashedBundle().IsMatch(n!), n));
    }
}

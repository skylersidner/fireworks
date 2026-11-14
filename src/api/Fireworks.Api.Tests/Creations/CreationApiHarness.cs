using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Creations;

/// <summary>
/// One shared Kestrel + SQLite host with writes on and rate limits raised, for the fixture runs
/// (about 180 POSTs). Rate limiting itself is tested in <see cref="CreationRateLimitTests"/> with the
/// real defaults or lowered ones.
/// </summary>
public sealed class CreationApiHarness : IAsyncLifetime
{
    internal FireworksApiHarness Host { get; private set; } = null!;

    public HttpClient Client => Host.Client;

    public async Task InitializeAsync() =>
        Host = await FireworksApiHarness.StartAsync(allowAnonymousWrites: true, FireworksApiHarness.UnthrottledRateLimits);

    public async Task DisposeAsync() => await Host.DisposeAsync();

    /// <summary>Sends exactly these bytes with exactly this <c>Content-Type</c> (no charset added).</summary>
    public static async Task<HttpResponseMessage> SendRawAsync(HttpClient client, HttpMethod method, string path, byte[] body, string contentType = "application/json")
    {
        var content = new ByteArrayContent(body);
        content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        using var request = new HttpRequestMessage(method, path) { Content = content };
        return await client.SendAsync(request);
    }

    public static Task<HttpResponseMessage> SendJsonAsync(HttpClient client, HttpMethod method, string path, string json) =>
        SendRawAsync(client, method, path, Encoding.UTF8.GetBytes(json));

    /// <summary>The 400 body's <c>errors</c> as <c>(path, code)</c> pairs, after checking the body's shape.</summary>
    internal static async Task<IReadOnlyList<PathCode>> ReadErrorsAsync(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(["errors", "message", "truncated"], root.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal(JsonValueKind.String, root.GetProperty("message").ValueKind);
        // No fixture comes near the 100-issue cap (the largest expects 12).
        Assert.False(root.GetProperty("truncated").GetBoolean());
        foreach (var error in root.GetProperty("errors").EnumerateArray())
        {
            Assert.Equal(["code", "message", "path"], error.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        }

        return SchemaFixtures.ReadErrors(root.GetProperty("errors"));
    }
}

/// <summary>
/// Every shared fixture over HTTP (plan Phase 4 tests; <c>schema/README.md</c> "The C# harness"):
/// valid ones are 201, invalid ones are 400 with exactly their <c>(path, code)</c> multiset, and
/// server-only ones are sent as raw bytes with their <c>contentType</c> and <c>byteMarkers</c>.
/// </summary>
public sealed class CreationFixtureHarnessTests(CreationApiHarness harness) : IClassFixture<CreationApiHarness>
{
    public static TheoryData<string> DocumentFixtures() => new(SchemaFixtures.DocumentFixtureNames());

    public static TheoryData<string> ServerOnlyFixtures() => new(SchemaFixtures.ServerOnlyFixtureNames());

    /// <summary>
    /// The one translation (schema.md §12.1): a non-object document is rejected by the envelope walk,
    /// so over HTTP it is <c>(document, not-object)</c>. Derived from the document itself, and
    /// <see cref="Translation_applies_to_exactly_the_two_root_fixtures"/> pins which files it hits.
    /// </summary>
    private static IReadOnlyList<PathCode> ExpectedOverHttp(DocumentFixture fixture) =>
        fixture.Document.ValueKind == JsonValueKind.Object ? fixture.Errors : [new PathCode("document", "not-object")];

    [Fact]
    public void Translation_applies_to_exactly_the_two_root_fixtures()
    {
        var translated = SchemaFixtures.DocumentFixtureNames()
            .Where(name => SchemaFixtures.LoadDocument(name).Document.ValueKind != JsonValueKind.Object)
            .ToList();
        Assert.Equal(["invalid/shell/root-array", "invalid/shell/root-string"], translated);
    }

    [Theory]
    [MemberData(nameof(DocumentFixtures))]
    public async Task Document_fixture_posted_as_raw_text(string name)
    {
        var fixture = SchemaFixtures.LoadDocument(name);
        // {"kind":<kind>,"document":<raw>}: the document's raw text, never re-serialized.
        var body = $"{{\"kind\":{JsonSerializer.Serialize(fixture.Kind)},\"document\":{fixture.DocumentRawText}}}";

        using var response = await CreationApiHarness.SendJsonAsync(harness.Client, HttpMethod.Post, "/api/creations", body);

        if (fixture.Group == "valid")
        {
            Assert.Equal(201, (int)response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.True(JsonSemantics.Equal(json.RootElement.GetProperty("document"), fixture.Document),
                "the stored document differs from the one sent");
        }
        else
        {
            Assert.Equal(400, (int)response.StatusCode);
            Assert.Equal(SchemaFixtures.Ledger(ExpectedOverHttp(fixture)),
                SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(response)));
        }
    }

    [Theory]
    [MemberData(nameof(ServerOnlyFixtures))]
    public async Task Server_only_fixture_posted_as_raw_bytes(string name)
    {
        var fixture = SchemaFixtures.LoadServerOnly(name);

        using var response = await CreationApiHarness.SendRawAsync(
            harness.Client, HttpMethod.Post, "/api/creations", fixture.Body, fixture.ContentType);

        Assert.Equal(fixture.Status, (int)response.StatusCode);
        if (fixture.Status == 400)
        {
            Assert.Equal(SchemaFixtures.Ledger(fixture.Errors), SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(response)));
        }
        else
        {
            // 413 and 415 carry no `errors` (schema.md §2.6 steps 1-2).
            Assert.DoesNotContain("\"errors\"", await response.Content.ReadAsStringAsync());
        }
    }

    [Fact]
    public void Server_only_fixtures_cover_every_status_the_walk_can_give()
    {
        var statuses = SchemaFixtures.ServerOnlyFixtureNames().Select(n => SchemaFixtures.LoadServerOnly(n).Status).ToHashSet();
        Assert.Equal([400, 413, 415], statuses.Order());
        Assert.True(SchemaFixtures.ServerOnlyFixtureNames().Count >= 20);
    }
}

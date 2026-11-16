using System.Net;
using System.Text;
using Fireworks.Api.Tests.Controllers;

namespace Fireworks.Api.Tests.Creations;

/// <summary>
/// Form-typed request bodies: the shapes that MVC's form value providers read during model binding,
/// before any action runs (Boo, Phase 4 verification F1). All are CORS-safelisted content types, so
/// they are also what a cross-site request would send.
/// </summary>
internal static class FormBodies
{
    public sealed record Shape(string Name, string ContentType, byte[] Body);

    public static readonly IReadOnlyList<Shape> All =
    [
        // Not multipart at all: the form reader threw "Failed to read the request form" (400).
        new("malformed multipart", "multipart/form-data; boundary=x", Encoding.UTF8.GetBytes("{\"kind\":\"shell\",\"document\":{}}")),
        new("well-formed multipart", "multipart/form-data; boundary=x",
            Encoding.ASCII.GetBytes("--x\r\nContent-Disposition: form-data; name=\"kind\"\r\n\r\nshell\r\n--x--\r\n")),
        // Over Kestrel's 64 KiB global limit and the writes' 256 KiB: the form reader hit the limit (400).
        new("300 KB urlencoded", "application/x-www-form-urlencoded", Encoding.ASCII.GetBytes("a=" + new string('b', 300_000))),
    ];
}

/// <summary>
/// Boo's proof (Phase 4 verification F1), brought into the suite. With writes off, every write and
/// the list are 403 whatever the body's content type (S8), and nothing reads the body before the
/// gate (S3). A read that binds no body (<c>GET api/me</c>) answers as if the body weren't there.
/// Mutant: restore the three form value provider factories in <c>AddFireworksControllers</c>; every
/// case here fails with MVC's 400.
/// </summary>
public sealed class FormBodyGateTests
{
    private static readonly (string Method, string Path)[] GatedTargets =
    [
        ("POST", "/api/creations"),
        ("PUT", "/api/creations/abcdefgh"),
        ("POST", "/api/creations/abcdefgh/remix"),
        ("DELETE", "/api/creations/abcdefgh"),
        ("GET", "/api/me/creations"),
    ];

    public static TheoryData<string, string, int> Cases()
    {
        var data = new TheoryData<string, string, int>();
        foreach (var (method, path) in GatedTargets)
        {
            for (var i = 0; i < FormBodies.All.Count; i++)
            {
                data.Add(method, path, i);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task With_writes_off_a_form_typed_body_is_403_not_an_MVC_400(string method, string path, int shape)
    {
        var form = FormBodies.All[shape];
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);
        using var response = await CreationApiHarness.SendRawAsync(h.Client, new HttpMethod(method), path, form.Body, form.ContentType);
        Assert.True(response.StatusCode == HttpStatusCode.Forbidden,
            $"{method} {path} {form.Name} -> {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    public async Task GET_api_me_ignores_a_form_typed_body(int shape)
    {
        var form = FormBodies.All[shape];
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);
        using var response = await CreationApiHarness.SendRawAsync(h.Client, HttpMethod.Get, "/api/me", form.Body, form.ContentType);
        Assert.True(response.StatusCode == HttpStatusCode.OK,
            $"GET /api/me {form.Name} -> {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
    }

    /// <summary>
    /// An unread body over the endpoint's limit can't be drained, so the connection ends with the
    /// response; the response says so. Mutant: drop the <c>Connection: close</c> branch in
    /// <c>ResponseHeaders</c>; this fails. The enumerated gate test may fail too, timing
    /// permitting: its next request on the pooled connection gets "response ended prematurely"
    /// (failed 6 of 6 runs in isolation, passed in the full suite).
    /// </summary>
    [Fact]
    public async Task A_403_to_a_body_over_the_limit_closes_the_connection_and_a_small_one_keeps_it()
    {
        await using var h = await FireworksApiHarness.StartAsync(false, FireworksApiHarness.UnthrottledRateLimits);
        using (var small = await CreationApiHarness.SendJsonAsync(h.Client, HttpMethod.Post, "/api/creations", "{}"))
        {
            Assert.Equal(HttpStatusCode.Forbidden, small.StatusCode);
            Assert.NotEqual(true, small.Headers.ConnectionClose);
        }

        // 200 KB: under the writes' 256 KiB, over DELETE's 64 KiB (the global limit).
        var body = Encoding.ASCII.GetBytes("a=" + new string('b', 200_000));
        using (var underWriteLimit = await CreationApiHarness.SendRawAsync(h.Client, HttpMethod.Post, "/api/creations", body, "application/x-www-form-urlencoded"))
        {
            Assert.Equal(HttpStatusCode.Forbidden, underWriteLimit.StatusCode);
            Assert.NotEqual(true, underWriteLimit.Headers.ConnectionClose);
        }

        using (var overGlobalLimit = await CreationApiHarness.SendRawAsync(h.Client, HttpMethod.Delete, "/api/creations/abcdefgh", body, "application/x-www-form-urlencoded"))
        {
            Assert.Equal(HttpStatusCode.Forbidden, overGlobalLimit.StatusCode);
            Assert.True(overGlobalLimit.Headers.ConnectionClose);
        }

        using var next = await h.Client.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
    }

    [Fact]
    public async Task With_writes_on_a_form_typed_write_is_the_contracts_415()
    {
        await using var h = await FireworksApiHarness.StartAsync(true, FireworksApiHarness.UnthrottledRateLimits);
        foreach (var form in FormBodies.All)
        {
            using var response = await CreationApiHarness.SendRawAsync(h.Client, HttpMethod.Post, "/api/creations", form.Body, form.ContentType);
            Assert.True(response.StatusCode == HttpStatusCode.UnsupportedMediaType,
                $"POST /api/creations {form.Name} -> {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        }
    }
}

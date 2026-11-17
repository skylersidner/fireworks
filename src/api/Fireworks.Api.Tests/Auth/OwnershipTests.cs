using System.Net;
using System.Text.Json;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Creations;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Auth;

/// <summary>
/// Two real accounts through the stub (Done-when 2; Boo A22, A23, A25, A26, A28): alice and bob
/// can't edit each other's creations, the legacy default user's rows are read-only for everyone,
/// and the share GET varies by viewer.
/// </summary>
public sealed class OwnershipTests
{
    private static readonly string[] CreationKeys =
        ["createdAt", "document", "isOwner", "kind", "name", "remixedFrom", "schemaVersion", "shareCode", "updatedAt"];

    private static string Doc(string name = "Peony") => $"{{\"document\":{CreationEndpointTests.Peony.Replace("\"Peony\"", $"\"{name}\"")}}}";

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    private static string[] Keys(JsonElement e) => e.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray();

    [Fact]
    public async Task Alice_and_bob_cannot_edit_each_others_creations()
    {
        var ledger = new CallLedger();
        await using var h = await FireworksApiHarness.StartAsync(configuration: FireworksApiHarness.UnthrottledRateLimits,
            configureServices: services => RecordingCreationRepository.Register(services, ledger));
        var alice = await h.SignInAsync(TestIdentity.Alice);
        var bob = await h.SignInAsync(TestIdentity.Bob);
        Assert.NotEqual(alice.UserId, bob.UserId);

        var code = await Hardening.ResponseHeaderTests.CreateAsync(alice.Http);
        var aliceTag = await CreationApiHarness.CurrentTagAsync(alice.Http, $"/api/creations/{code}");

        // PUT and DELETE: byte-identical to a code that doesn't exist (S9), and bob's PUT is one
        // owner-filtered lookup with no update (Toad's exact ledger).
        ledger.Clear();
        using var put = await CreationApiHarness.SendJsonAsync(bob.Http, HttpMethod.Put, $"/api/creations/{code}", Doc("Hijacked"), aliceTag);
        Assert.Equal(["FindOwnedAsync"], ledger.Calls);
        using var putUnknown = await CreationApiHarness.SendJsonAsync(bob.Http, HttpMethod.Put, "/api/creations/NoSuch11", Doc(), aliceTag);
        using var delete = await bob.Http.DeleteAsync($"/api/creations/{code}");
        using var deleteUnknown = await bob.Http.DeleteAsync("/api/creations/NoSuch11");
        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);
        Assert.Equal(await putUnknown.Content.ReadAsByteArrayAsync(), await put.Content.ReadAsByteArrayAsync());
        Assert.Equal(await deleteUnknown.Content.ReadAsByteArrayAsync(), await delete.Content.ReadAsByteArrayAsync());
        Assert.False(put.Headers.Contains("ETag"));

        // Bob's read: not the owner, the non-owner tag, Vary: Cookie.
        using var bobGet = await bob.Http.GetAsync($"/api/creations/{code}");
        var bobView = await Json(bobGet);
        Assert.Equal(CreationKeys, Keys(bobView));
        Assert.False(bobView.GetProperty("isOwner").GetBoolean());
        Assert.EndsWith("-p\"", bobGet.Headers.ETag!.Tag.ToString());
        Assert.Equal("Cookie", bobGet.Headers.Vary.Single());

        // Bob remixes: his own creation, and only he sees where it came from.
        using var remix = await CreationApiHarness.SendJsonAsync(bob.Http, HttpMethod.Post, $"/api/creations/{code}/remix", Doc("Bobs"));
        Assert.Equal(HttpStatusCode.Created, remix.StatusCode);
        var remixCode = (await Json(remix)).GetProperty("shareCode").GetString()!;
        using var bobsRemix = await bob.Http.GetAsync($"/api/creations/{remixCode}");
        var asBob = await Json(bobsRemix);
        Assert.True(asBob.GetProperty("isOwner").GetBoolean());
        Assert.Equal(code, asBob.GetProperty("remixedFrom").GetString());
        var asAlice = await Json(await alice.Http.GetAsync($"/api/creations/{remixCode}"));
        Assert.False(asAlice.GetProperty("isOwner").GetBoolean());
        Assert.Equal(JsonValueKind.Null, asAlice.GetProperty("remixedFrom").ValueKind);
        var asAnonymous = await Json(await h.AnonymousClient.GetAsync($"/api/creations/{remixCode}"));
        Assert.Equal(CreationKeys, Keys(asAnonymous));
        Assert.Equal(JsonValueKind.Null, asAnonymous.GetProperty("remixedFrom").ValueKind);

        // My creations is per user.
        var bobsList = await Json(await bob.Http.GetAsync("/api/me/creations"));
        Assert.Equal([remixCode], bobsList.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("shareCode").GetString()));
        var alicesList = await Json(await alice.Http.GetAsync("/api/me/creations"));
        Assert.Equal([code], alicesList.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("shareCode").GetString()));

        // Alice's own creation is untouched and still hers to change.
        var aliceView = await Json(await alice.Http.GetAsync($"/api/creations/{code}"));
        Assert.Equal("Peony", aliceView.GetProperty("name").GetString());
        using var alicePut = await CreationApiHarness.SendJsonAsync(alice.Http, HttpMethod.Put, $"/api/creations/{code}", Doc("Alices"));
        Assert.Equal(HttpStatusCode.OK, alicePut.StatusCode);

        // Anonymous: reads work, writes don't.
        Assert.Equal(HttpStatusCode.OK, (await h.AnonymousClient.GetAsync($"/api/creations/{code}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await h.AnonymousClient.DeleteAsync($"/api/creations/{code}")).StatusCode);
    }

    [Fact]
    public async Task The_legacy_default_users_creations_are_read_only_for_every_account()
    {
        // Boo A23: provisioning never resolves to the legacy row.
        await using var h = await FireworksApiHarness.StartAsync(configuration: FireworksApiHarness.UnthrottledRateLimits);
        await h.SeedLegacyUserAsync();
        await using (var db = h.NewContext())
        {
            db.Creations.Add(new Creation
            {
                Id = Guid.NewGuid(), ShareCode = "LEGACY11", Kind = CreationKind.Shell, Name = "Old", SchemaVersion = 1,
                Palette = ["red"], Document = CreationEndpointTests.Peony, OwnerUserId = TestIdentity.LegacyDefaultUserId
            });
            await db.SaveChangesAsync();
        }

        foreach (var subject in new[] { TestIdentity.Alice, TestIdentity.Bob })
        {
            var session = await h.SignInAsync(subject);
            Assert.NotEqual(TestIdentity.LegacyDefaultUserId, session.UserId);
            using var get = await session.Http.GetAsync("/api/creations/LEGACY11");
            var view = await Json(get);
            Assert.False(view.GetProperty("isOwner").GetBoolean());
            Assert.Equal(JsonValueKind.Null, view.GetProperty("remixedFrom").ValueKind);
            Assert.EndsWith("-p\"", get.Headers.ETag!.Tag.ToString());

            var plainTag = get.Headers.ETag!.Tag.ToString().Replace("-p\"", "\"");
            Assert.Equal(HttpStatusCode.NotFound, (await CreationApiHarness.SendJsonAsync(session.Http, HttpMethod.Put, "/api/creations/LEGACY11", Doc(), plainTag)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await session.Http.DeleteAsync("/api/creations/LEGACY11")).StatusCode);
            Assert.Equal(HttpStatusCode.Created, (await CreationApiHarness.SendJsonAsync(session.Http, HttpMethod.Post, "/api/creations/LEGACY11/remix", Doc())).StatusCode);
        }
    }

    [Fact]
    public async Task If_None_Match_is_compared_against_the_viewers_own_tag()
    {
        // Boo A25, A26 (schema.md §2.1.1).
        await using var h = await FireworksApiHarness.StartAsync(configuration: FireworksApiHarness.UnthrottledRateLimits);
        var alice = await h.SignInAsync(TestIdentity.Alice);
        var code = await Hardening.ResponseHeaderTests.CreateAsync(alice.Http);

        async Task<HttpResponseMessage> Get(HttpClient client, string? tag)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/creations/{code}");
            if (tag is not null) request.Headers.TryAddWithoutValidation("If-None-Match", tag);
            return await client.SendAsync(request);
        }

        var ownerTag = (await Get(alice.Http, null)).Headers.ETag!.ToString();
        var publicTag = (await Get(h.AnonymousClient, null)).Headers.ETag!.ToString();
        Assert.Equal(ownerTag[..^1] + "-p\"", publicTag);

        using var ownerTagAnonymously = await Get(h.AnonymousClient, ownerTag);
        Assert.Equal((HttpStatusCode.OK, publicTag), (ownerTagAnonymously.StatusCode, ownerTagAnonymously.Headers.ETag!.ToString()));
        using var publicTagAsOwner = await Get(alice.Http, publicTag);
        Assert.Equal((HttpStatusCode.OK, ownerTag), (publicTagAsOwner.StatusCode, publicTagAsOwner.Headers.ETag!.ToString()));

        foreach (var (client, tag) in new[] { (alice.Http, ownerTag), (h.AnonymousClient, publicTag), (alice.Http, "*"), (h.AnonymousClient, "*") })
        {
            using var notModified = await Get(client, tag);
            Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
            Assert.Equal("Cookie", notModified.Headers.Vary.Single());
            Assert.Equal("private, no-cache", Hardening.HeaderExpectations.CacheControl(notModified));
        }

        using var ok = await Get(h.AnonymousClient, null);
        Assert.Equal("Cookie", ok.Headers.Vary.Single());
    }
}

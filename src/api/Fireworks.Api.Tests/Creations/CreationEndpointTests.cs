using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Services;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Support;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Fireworks.Api.Tests.Creations;

/// <summary>
/// The creation endpoints through real Kestrel, routing and the real repository on SQLite (plan
/// Phase 4; Boo S1-S14, S16, S22-S26). The harness's default user is the "current user"; a second
/// user and their rows are inserted straight into the database, so ownership is tested with two ids.
/// </summary>
public sealed class CreationEndpointTests
{
    internal const string Peony =
        """{"version":1,"name":"Peony","burstHeight":0.65,"angleJitter":4,"breaks":[{"pattern":"peony","stars":120,"speed":220,"color1":"red","color2":"gold","changeAt":0.65,"burn":1.6,"drag":0.9,"size":1,"trail":"none","effect":"none","delay":0.6}]}""";

    internal static readonly Guid OtherUser = Guid.Parse("bbbbbbbb-0000-4000-8000-00000000000b");

    private static readonly string[] CreationKeys =
        ["createdAt", "document", "isOwner", "kind", "name", "remixedFrom", "schemaVersion", "shareCode", "updatedAt"];

    private static readonly string NotJson = new PathCode("", "not-json").ToString();

    private static readonly string[] ListItemKeys = ["kind", "name", "palette", "shareCode", "updatedAt"];

    private static Task<FireworksApiHarness> StartAsync(CallLedger? ledger = null) =>
        FireworksApiHarness.StartAsync(true, FireworksApiHarness.UnthrottledRateLimits,
            ledger is null ? null : services => RecordingCreationRepository.Register(services, ledger));

    private static Task<HttpResponseMessage> Send(FireworksApiHarness h, HttpMethod method, string path, string json) =>
        CreationApiHarness.SendJsonAsync(h.Client, method, path, json);

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    private static string[] Keys(JsonElement obj) => obj.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray();

    private static async Task<string> CreateAsync(FireworksApiHarness h, string document = Peony, string kind = "shell")
    {
        using var response = await Send(h, HttpMethod.Post, "/api/creations", $"{{\"kind\":\"{kind}\",\"document\":{document}}}");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await Json(response)).GetProperty("shareCode").GetString()!;
    }

    /// <summary>A second user's row, written directly: before Phase 8 nothing else can act as another user.</summary>
    private static async Task<Creation> SeedOtherUsersAsync(FireworksApiHarness h, string shareCode, Guid? remixedFromId = null)
    {
        await using var db = h.NewContext();
        if (!await db.Users.AnyAsync(u => u.Id == OtherUser))
        {
            db.Users.Add(new User { Id = OtherUser, DisplayName = "Other" });
        }

        var row = new Creation
        {
            Id = Guid.NewGuid(), ShareCode = shareCode, Kind = CreationKind.Shell, Name = "Theirs", SchemaVersion = 1,
            Palette = ["blue"], Document = Peony, OwnerUserId = OtherUser, RemixedFromId = remixedFromId
        };
        db.Creations.Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    private static async Task<Creation> LoadAsync(FireworksApiHarness h, string shareCode)
    {
        await using var db = h.NewContext();
        return await db.Creations.AsNoTracking().SingleAsync(c => c.ShareCode == shareCode);
    }

    // ---- round trip and shapes (S12) -----------------------------------------------------------

    [Fact]
    public async Task Create_get_update_remix_list_delete_round_trip_with_exact_shapes()
    {
        await using var h = await StartAsync();

        using var created = await Send(h, HttpMethod.Post, "/api/creations", $"{{\"kind\":\"shell\",\"document\":{Peony}}}");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await Json(created);
        Assert.Equal(CreationKeys, Keys(body));
        var code = body.GetProperty("shareCode").GetString()!;
        Assert.True(ShareCodes.IsValid(code));
        Assert.Equal($"/api/creations/{code}", created.Headers.Location?.AbsolutePath);
        Assert.Equal(("shell", "Peony", 1, true), (body.GetProperty("kind").GetString(), body.GetProperty("name").GetString(),
            body.GetProperty("schemaVersion").GetInt32(), body.GetProperty("isOwner").GetBoolean()));
        Assert.Equal(JsonValueKind.Null, body.GetProperty("remixedFrom").ValueKind);
        Assert.True(JsonSemantics.Equal(Peony, body.GetProperty("document").GetRawText()));

        using var got = await h.Client.GetAsync($"/api/creations/{code}");
        Assert.Equal(HttpStatusCode.OK, got.StatusCode);
        var gotBody = await Json(got);
        Assert.Equal(CreationKeys, Keys(gotBody));
        Assert.Equal(body.GetProperty("updatedAt").GetString(), gotBody.GetProperty("updatedAt").GetString());

        using var updated = await Send(h, HttpMethod.Put, $"/api/creations/{code}", $"{{\"document\":{Peony.Replace("\"Peony\"", "\"Renamed\"")}}}");
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var updatedBody = await Json(updated);
        Assert.Equal(CreationKeys, Keys(updatedBody));
        Assert.Equal(("Renamed", code), (updatedBody.GetProperty("name").GetString(), updatedBody.GetProperty("shareCode").GetString()));
        Assert.True(updatedBody.GetProperty("updatedAt").GetDateTimeOffset() > body.GetProperty("updatedAt").GetDateTimeOffset());

        using var remixed = await Send(h, HttpMethod.Post, $"/api/creations/{code}/remix", $"{{\"document\":{Peony}}}");
        Assert.Equal(HttpStatusCode.Created, remixed.StatusCode);
        var remixBody = await Json(remixed);
        Assert.Equal(CreationKeys, Keys(remixBody));
        var remixCode = remixBody.GetProperty("shareCode").GetString()!;
        Assert.NotEqual(code, remixCode);
        Assert.Equal(code, remixBody.GetProperty("remixedFrom").GetString());

        using var list = await h.Client.GetAsync("/api/me/creations");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var page = await Json(list);
        Assert.Equal(["items", "page", "pageSize", "totalCount"], Keys(page));
        Assert.Equal((1, 24, 2), (page.GetProperty("page").GetInt32(), page.GetProperty("pageSize").GetInt32(), page.GetProperty("totalCount").GetInt32()));
        var items = page.GetProperty("items").EnumerateArray().ToList();
        Assert.All(items, item => Assert.Equal(ListItemKeys, Keys(item)));
        Assert.Equal([remixCode, code], items.Select(i => i.GetProperty("shareCode").GetString()));
        Assert.Equal(["red", "gold"], items[1].GetProperty("palette").EnumerateArray().Select(c => c.GetString()));

        using var deleted = await h.Client.DeleteAsync($"/api/creations/{code}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        using var gone = await h.Client.GetAsync($"/api/creations/{code}");
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);

        // ON DELETE SET NULL: the remix survives and no longer reveals a source.
        var orphan = await Json(await h.Client.GetAsync($"/api/creations/{remixCode}"));
        Assert.Equal(JsonValueKind.Null, orphan.GetProperty("remixedFrom").ValueKind);
    }

    [Fact]
    public async Task Api_responses_are_no_store_and_nosniff_including_errors()
    {
        await using var h = await StartAsync();
        var code = await CreateAsync(h);
        foreach (var response in new[]
                 {
                     await h.Client.GetAsync($"/api/creations/{code}"),
                     await h.Client.GetAsync("/api/creations/zzzzzzzz"),
                     await h.Client.GetAsync("/api/nope"),
                     await Send(h, HttpMethod.Post, "/api/creations", "{")
                 })
        {
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            Assert.Equal("nosniff", string.Join(",", response.Headers.GetValues("X-Content-Type-Options")));
        }
    }

    // ---- ownership (S7, S9, S10, S13) ----------------------------------------------------------

    [Fact]
    public async Task Someone_elses_creation_is_a_byte_identical_404_on_PUT_and_DELETE_and_is_unchanged()
    {
        await using var h = await StartAsync();
        await SeedOtherUsersAsync(h, "THEMS111");
        var before = await LoadAsync(h, "THEMS111");

        using var put = await Send(h, HttpMethod.Put, "/api/creations/THEMS111", $"{{\"document\":{Peony.Replace("\"Peony\"", "\"Hijacked\"")}}}");
        using var putUnknown = await Send(h, HttpMethod.Put, "/api/creations/NoSuch11", $"{{\"document\":{Peony}}}");
        using var delete = await h.Client.DeleteAsync("/api/creations/THEMS111");
        using var deleteUnknown = await h.Client.DeleteAsync("/api/creations/NoSuch11");

        foreach (var response in new[] { put, putUnknown, delete, deleteUnknown })
        {
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        var putBytes = await put.Content.ReadAsByteArrayAsync();
        Assert.Equal(putBytes, await putUnknown.Content.ReadAsByteArrayAsync());
        Assert.Equal(putBytes, await delete.Content.ReadAsByteArrayAsync());
        Assert.Equal(putBytes, await deleteUnknown.Content.ReadAsByteArrayAsync());

        var after = await LoadAsync(h, "THEMS111");
        Assert.Equal((before.Name, before.Document, before.UpdatedAt, string.Join(",", before.Palette), before.OwnerUserId),
            (after.Name, after.Document, after.UpdatedAt, string.Join(",", after.Palette), after.OwnerUserId));
    }

    [Fact]
    public async Task A_non_owner_sees_isOwner_false_and_remixedFrom_null()
    {
        await using var h = await StartAsync();
        var mine = await CreateAsync(h);
        var source = await LoadAsync(h, mine);
        // The other user remixed my creation.
        await SeedOtherUsersAsync(h, "THEMS222", remixedFromId: source.Id);

        var theirRemix = await Json(await h.Client.GetAsync("/api/creations/THEMS222"));

        Assert.Equal(CreationKeys, Keys(theirRemix));
        Assert.False(theirRemix.GetProperty("isOwner").GetBoolean());
        Assert.Equal(JsonValueKind.Null, theirRemix.GetProperty("remixedFrom").ValueKind);
    }

    [Fact]
    public async Task Remixing_someone_elses_creation_is_a_new_row_mine_and_the_source_is_untouched()
    {
        await using var h = await StartAsync();
        await SeedOtherUsersAsync(h, "THEMS333");
        var before = await LoadAsync(h, "THEMS333");

        using var remix = await Send(h, HttpMethod.Post, "/api/creations/THEMS333/remix", $"{{\"document\":{Peony}}}");

        Assert.Equal(HttpStatusCode.Created, remix.StatusCode);
        var body = await Json(remix);
        Assert.True(body.GetProperty("isOwner").GetBoolean());
        Assert.Equal("THEMS333", body.GetProperty("remixedFrom").GetString());
        var after = await LoadAsync(h, "THEMS333");
        Assert.Equal((before.Document, before.Name, before.UpdatedAt), (after.Document, after.Name, after.UpdatedAt));
        var stored = await LoadAsync(h, body.GetProperty("shareCode").GetString()!);
        Assert.Equal(TestIdentity.UserId, stored.OwnerUserId);
    }

    [Fact]
    public async Task Kind_is_immutable_on_PUT_and_remix_validates_against_the_source_kind()
    {
        await using var h = await StartAsync();
        var code = await CreateAsync(h);

        using var putWithKind = await Send(h, HttpMethod.Put, $"/api/creations/{code}", $"{{\"kind\":\"show\",\"document\":{Peony}}}");
        Assert.Equal(["kind :: unknown-property"], SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(putWithKind)));

        using var remixWithKind = await Send(h, HttpMethod.Post, $"/api/creations/{code}/remix", $"{{\"kind\":\"shell\",\"document\":{Peony}}}");
        Assert.Equal(["kind :: unknown-property"], SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(remixWithKind)));

        // A show document as a remix of a shell: the kind-mismatch set (schema.md §12.4).
        var show = SchemaFixtures.LoadDocument("valid/show/minimal").DocumentRawText;
        using var mismatch = await Send(h, HttpMethod.Post, $"/api/creations/{code}/remix", $"{{\"document\":{show}}}");
        Assert.Equal(
            SchemaFixtures.Ledger(SchemaFixtures.LoadServerOnly("kind-mismatch").Errors),
            SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(mismatch)));
    }

    // ---- content type (S6) --------------------------------------------------------------------

    public static TheoryData<string> WriteRoutes() => new() { "POST /api/creations", "PUT /api/creations/{code}", "POST /api/creations/{code}/remix" };

    private static async Task<(HttpMethod Method, string Path, string Body)> ResolveAsync(FireworksApiHarness h, string route)
    {
        var code = await CreateAsync(h);
        var parts = route.Split(' ');
        var method = new HttpMethod(parts[0]);
        var path = parts[1].Replace("{code}", code);
        var body = path == "/api/creations" ? $"{{\"kind\":\"shell\",\"document\":{Peony}}}" : $"{{\"document\":{Peony}}}";
        return (method, path, body);
    }

    [Theory]
    [MemberData(nameof(WriteRoutes))]
    public async Task A_missing_or_non_JSON_content_type_is_415_and_a_charset_is_accepted(string route)
    {
        await using var h = await StartAsync();
        var (method, path, body) = await ResolveAsync(h, route);
        var bytes = Encoding.UTF8.GetBytes(body);

        using var textPlain = await CreationApiHarness.SendRawAsync(h.Client, method, path, bytes, "text/plain");
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, textPlain.StatusCode);

        using var untyped = new HttpRequestMessage(method, path) { Content = new ByteArrayContent(bytes) };
        Assert.Null(untyped.Content.Headers.ContentType);
        using var noType = await h.Client.SendAsync(untyped);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, noType.StatusCode);

        using var charset = await CreationApiHarness.SendRawAsync(h.Client, method, path, bytes, "application/json; charset=utf-8");
        Assert.True(charset.IsSuccessStatusCode, $"{charset.StatusCode}");
    }

    // ---- size (S1-S4) -------------------------------------------------------------------------

    /// <summary>A valid envelope padded with JSON whitespace to exactly <paramref name="size"/> bytes.</summary>
    private static byte[] Padded(string body, int size) =>
        Encoding.UTF8.GetBytes(body[..^1] + new string(' ', size - Encoding.UTF8.GetByteCount(body)) + "}");

    [Theory]
    [MemberData(nameof(WriteRoutes))]
    public async Task Exactly_256_KiB_is_accepted_one_byte_more_is_413_by_length_or_chunked(string route)
    {
        await using var h = await StartAsync();
        var (method, path, body) = await ResolveAsync(h, route);

        using var atLimit = await CreationApiHarness.SendRawAsync(h.Client, method, path, Padded(body, CreationLimits.MaxRequestBytes));
        Assert.True(atLimit.IsSuccessStatusCode, $"{atLimit.StatusCode}");

        using var over = await CreationApiHarness.SendRawAsync(h.Client, method, path, Padded(body, CreationLimits.MaxRequestBytes + 1));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, over.StatusCode);
        // The unread rest of the body means the connection can't be reused; the client must be told,
        // or its next request on the pooled connection gets a reset.
        Assert.True(over.Headers.ConnectionClose);
        using (var next = await h.Client.GetAsync("/api/me"))
        {
            Assert.Equal(HttpStatusCode.OK, next.StatusCode);
        }

        // Chunked: no Content-Length, so the limit is enforced while the body streams in.
        var chunked = new StreamContent(new MemoryStream(Padded(body, 300 * 1024)));
        chunked.Headers.ContentType = new("application/json");
        using var request = new HttpRequestMessage(method, path) { Content = chunked };
        request.Headers.TransferEncodingChunked = true;
        using var overChunked = await h.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, overChunked.StatusCode);
    }

    [Fact]
    public void Kestrels_global_body_limit_is_64_KiB()
    {
        // Raised per action by [RequestSizeLimit] for the three writes only (Boo S2).
        Assert.Equal(65_536, KestrelLimits.GlobalMaxRequestBodyBytes);
        var options = new KestrelServerOptions();
        KestrelLimits.Apply(options);
        Assert.Equal(65_536, options.Limits.MaxRequestBodySize);
    }

    [Fact]
    public async Task The_harness_host_runs_with_the_64_KiB_global_limit()
    {
        await using var h = await StartAsync();
        var options = h.App.Services.GetRequiredService<IOptions<KestrelServerOptions>>().Value;
        Assert.Equal(65_536, options.Limits.MaxRequestBodySize);
    }

    [Fact]
    public async Task A_gzip_body_is_read_raw_and_is_not_json()
    {
        await using var h = await StartAsync();
        using var compressed = new MemoryStream();
        await using (var gzip = new GZipStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
        {
            await gzip.WriteAsync(Encoding.UTF8.GetBytes($"{{\"kind\":\"shell\",\"document\":{Peony}}}"));
        }

        var content = new ByteArrayContent(compressed.ToArray());
        content.Headers.ContentType = new("application/json");
        content.Headers.ContentEncoding.Add("gzip");
        using var response = await h.Client.PostAsync("/api/creations", content);

        Assert.Equal([NotJson], SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(response)));
    }

    // ---- input (S22, S23, S25) ----------------------------------------------------------------

    [Fact]
    public async Task A_raw_NUL_byte_is_not_json_and_an_escaped_NUL_in_a_name_is_name_format()
    {
        await using var h = await StartAsync();
        var raw = Encoding.UTF8.GetBytes($"{{\"kind\":\"shell\",\"document\":{Peony.Replace("\"Peony\"", "\"a@b\"")}}}");
        raw[Array.IndexOf(raw, (byte)'@')] = 0x00;
        using var rawNul = await CreationApiHarness.SendRawAsync(h.Client, HttpMethod.Post, "/api/creations", raw);
        Assert.Equal([NotJson], SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(rawNul)));

        using var escaped = await Send(h, HttpMethod.Post, "/api/creations",
            $"{{\"kind\":\"shell\",\"document\":{Peony.Replace("\"Peony\"", "\"a\\u0000b\"")}}}");
        Assert.Equal(["name :: name-format"], SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(escaped)));
    }

    [Fact]
    public async Task Nesting_deeper_than_64_is_not_json_not_a_500()
    {
        await using var h = await StartAsync();
        var deep = "{\"kind\":\"shell\",\"document\":{\"x\":" + new string('[', 100) + new string(']', 100) + "}}";

        using var response = await Send(h, HttpMethod.Post, "/api/creations", deep);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal([NotJson], SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(response)));
    }

    [Theory]
    [InlineData(100, 100, false)]
    [InlineData(101, 100, true)]
    [InlineData(5000, 100, true)]
    public async Task The_400_body_carries_at_most_100_issues_and_says_when_it_was_truncated(int unknownKeys, int expectedCount, bool truncated)
    {
        await using var h = await StartAsync();
        var extra = string.Concat(Enumerable.Range(0, unknownKeys).Select(i => $",\"k{i}\":1"));
        var document = Peony[..^1] + extra + "}";

        using var response = await Send(h, HttpMethod.Post, "/api/creations", $"{{\"kind\":\"shell\",\"document\":{document}}}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await Json(response);
        Assert.Equal(["errors", "message", "truncated"], Keys(body));
        Assert.Equal(expectedCount, body.GetProperty("errors").GetArrayLength());
        Assert.Equal(truncated, body.GetProperty("truncated").GetBoolean());
        Assert.All(body.GetProperty("errors").EnumerateArray(), e => Assert.Equal("unknown-property", e.GetProperty("code").GetString()));
    }

    [Fact]
    public async Task Echoed_values_in_messages_are_cut_to_32_code_points()
    {
        await using var h = await StartAsync();
        var longValue = new string('x', 500);
        using var response = await Send(h, HttpMethod.Post, "/api/creations",
            $"{{\"kind\":\"shell\",\"document\":{Peony.Replace("\"pattern\":\"peony\"", $"\"pattern\":\"{longValue}\"")}}}");

        var issue = (await Json(response)).GetProperty("errors")[0];
        Assert.Equal("enum", issue.GetProperty("code").GetString());
        Assert.DoesNotContain(new string('x', 40), issue.GetProperty("message").GetString());
    }

    // ---- share-code routing (S14) -------------------------------------------------------------

    public static TheoryData<string> MalformedCodes() =>
        new() { "abcdefgl", "abcdefgI", "abcdefgO", "abcdefg0", "abcdefg%E2%84%AA", "abcdefgh%0A", "abcdefg", "abcdefghj" };

    [Theory]
    [MemberData(nameof(MalformedCodes))]
    public async Task A_malformed_code_is_404_with_zero_repository_calls_on_all_four_routes(string code)
    {
        var ledger = new CallLedger();
        await using var h = await StartAsync(ledger);
        ledger.Clear();

        var responses = new[]
        {
            await h.Client.GetAsync($"/api/creations/{code}"),
            await Send(h, HttpMethod.Put, $"/api/creations/{code}", $"{{\"document\":{Peony}}}"),
            await h.Client.DeleteAsync($"/api/creations/{code}"),
            await Send(h, HttpMethod.Post, $"/api/creations/{code}/remix", $"{{\"document\":{Peony}}}")
        };

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.NotFound, r.StatusCode));
        Assert.Empty(ledger.Calls);
    }

    [Fact]
    public async Task A_well_formed_unknown_code_is_404_after_exactly_one_lookup()
    {
        var ledger = new CallLedger();
        await using var h = await StartAsync(ledger);
        ledger.Clear();

        using var response = await h.Client.GetAsync("/api/creations/abcdefgh");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(["FindByShareCodeAsync"], ledger.Calls);
    }

    // ---- list (S26, schema.md §2.2.1) ----------------------------------------------------------

    [Fact]
    public async Task List_orders_by_updatedAt_desc_then_shareCode_ordinal_and_pages_stably()
    {
        await using var h = await StartAsync();
        var codes = new List<string>();
        for (var i = 0; i < 5; i++)
        {
            codes.Add(await CreateAsync(h));
        }

        await CreateAsync(h, SchemaFixtures.LoadDocument("valid/show/minimal").DocumentRawText, "show");

        // Give three shells the same updated_at, with codes chosen so ordinal ('B' < 'a') differs
        // from a linguistic order.
        await using (var db = h.NewContext())
        {
            var tie = DateTimeOffset.Parse("2030-01-01T00:00:00Z");
            var renames = new[] { "aaaaaaaa", "BBBBBBBB", "Zzzzzzzz" };
            for (var i = 0; i < 3; i++)
            {
                var row = await db.Creations.SingleAsync(c => c.ShareCode == codes[i]);
                db.Creations.Remove(row);
                await db.SaveChangesAsync();
                db.Creations.Add(new Creation
                {
                    Id = row.Id, ShareCode = renames[i], Kind = row.Kind, Name = row.Name, SchemaVersion = 1, Palette = row.Palette,
                    Document = row.Document, OwnerUserId = row.OwnerUserId, CreatedAt = tie
                });
                await db.SaveChangesAsync();
                await db.Creations.Where(c => c.ShareCode == renames[i]).ExecuteUpdateAsync(s => s.SetProperty(c => c.UpdatedAt, tie));
            }
        }

        var all = await Json(await h.Client.GetAsync("/api/me/creations?kind=shell&pageSize=100"));
        var order = all.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("shareCode").GetString()).ToList();
        Assert.Equal(["BBBBBBBB", "Zzzzzzzz", "aaaaaaaa"], order.Take(3));
        Assert.Equal(5, all.GetProperty("totalCount").GetInt32());

        var paged = new List<string?>();
        for (var page = 1; page <= 3; page++)
        {
            var body = await Json(await h.Client.GetAsync($"/api/me/creations?kind=shell&pageSize=2&page={page}"));
            paged.AddRange(body.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("shareCode").GetString()));
        }

        Assert.Equal(order, paged);

        var shows = await Json(await h.Client.GetAsync("/api/me/creations?kind=show"));
        Assert.Equal(1, shows.GetProperty("totalCount").GetInt32());
        Assert.Equal("show", shows.GetProperty("items")[0].GetProperty("kind").GetString());
    }

    [Theory]
    [InlineData("?page=2147483647&pageSize=100", 2147483647, 100, 0)]
    [InlineData("?page=99999999999", 2147483647, 24, 0)]
    [InlineData("?pageSize=0", 1, 1, 1)]
    [InlineData("?pageSize=1000&page=-3", 1, 100, 2)]
    [InlineData("?unknown=1", 1, 24, 2)]
    public async Task List_query_values_are_clamped_and_echoed(string query, int page, int pageSize, int items)
    {
        await using var h = await StartAsync();
        await CreateAsync(h);
        await CreateAsync(h);

        using var response = await h.Client.GetAsync("/api/me/creations" + query);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await Json(response);
        Assert.Equal((page, pageSize, 2, items),
            (body.GetProperty("page").GetInt32(), body.GetProperty("pageSize").GetInt32(), body.GetProperty("totalCount").GetInt32(),
                body.GetProperty("items").GetArrayLength()));
    }

    [Theory]
    [InlineData("?kind=Shell", "kind :: enum")]
    [InlineData("?kind=0", "kind :: enum")]
    [InlineData("?kind=", "kind :: enum")]
    [InlineData("?kind", "kind :: enum")]
    [InlineData("?kind=%20", "kind :: enum")]
    [InlineData("?kind=shell&kind=show", "kind :: enum")]
    [InlineData("?page=abc", "page :: type")]
    [InlineData("?pageSize=1.5", "pageSize :: type")]
    [InlineData("?page=1&page=2", "page :: type")]
    public async Task Bad_list_query_values_are_a_structured_400(string query, string expected)
    {
        await using var h = await StartAsync();

        using var response = await h.Client.GetAsync("/api/me/creations" + query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal([expected], SchemaFixtures.Ledger(await CreationApiHarness.ReadErrorsAsync(response)));
    }
}

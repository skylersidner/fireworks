using System.Net;
using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Tests.Support;
using Fireworks.Api.Tests.Creations;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Fireworks.Api.Tests.Hardening;

namespace Fireworks.Api.Tests.Data;

/// <summary>
/// The real Program.cs, as a child process in <c>Testing</c> (every non-Development behaviour:
/// <c>Secure</c> <c>__Host-</c> cookies, forwarded headers, HSTS logic; plus the stub allowance, Boo
/// A36) against real Postgres and an in-process <see cref="StubOAuthProvider"/>: the checks Phase
/// 1's "Done when" makes (migration in the startup log, liveness is text/plain, <c>/api/nope</c> is
/// 404, deep links get index.html), <c>api/me</c> anonymous and signed in, and sign-in surviving a
/// restart (DataProtection keys in Postgres, Boo A37).
/// The harness-based tests re-implement the pipeline; this one is what catches Program.cs drifting
/// from them.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ProgramOnPostgresTests
{
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(90);

    private static async Task<SessionClient> SignInAsync(string baseUrl, string subject = TestIdentity.Owner)
    {
        var session = new SessionClient(new Uri(baseUrl));
        var result = await session.SignInAsync(subject);
        Assert.True(session.UserId != Guid.Empty, $"sign-in failed: {(int)result.Callback.StatusCode} {result.Location}");
        return session;
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Real_program_migrates_on_start_and_serves_the_skeleton_contract()
    {
        await using (var reset = new FireworksDbContext(new DbContextOptionsBuilder<FireworksDbContext>()
                         .UseNpgsql(PostgresFactAttribute.ConnectionString).Options))
        {
            await reset.Database.EnsureDeletedAsync();
        }

        using var webRoot = new TempWebRoot();
        await using var stub = await StubOAuthProvider.StartAsync();
        var baseUrl = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}";
        await using var api = ApiProcess.Start(Environment(baseUrl, stub), "--webroot", webRoot.Path);

        await api.WaitForOutputAsync("Now listening on", StartTimeout);
        Assert.Contains("Applying migration", api.Output);
        Assert.Contains("_InitialCreate", api.Output);
        Assert.Contains("_AddExternalIdentity", api.Output);
        Assert.Contains("Sign-in uses stub OAuth endpoints", api.Output);

        using var client = new HttpClient { BaseAddress = new Uri(baseUrl) };

        using (var health = await client.GetAsync("/health/live"))
        {
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);
            Assert.Equal("text/plain", health.Content.Headers.ContentType?.MediaType);
            Assert.Equal("Healthy", await health.Content.ReadAsStringAsync());
        }

        using (var nope = await client.GetAsync("/api/nope"))
        {
            Assert.Equal(HttpStatusCode.NotFound, nope.StatusCode);
        }

        using (var deepLink = await client.GetAsync("/designer"))
        {
            Assert.Equal(HttpStatusCode.OK, deepLink.StatusCode);
            Assert.Contains(TempWebRoot.IndexMarker, await deepLink.Content.ReadAsStringAsync());
        }

        using (var me = await client.GetAsync("/api/me"))
        {
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            Assert.Equal("""{"userId":null,"displayName":null,"isAuthenticated":false,"canWrite":false,"signedInWith":null}""",
                await me.Content.ReadAsStringAsync());
        }

        using var session = await SignInAsync(baseUrl);
        using (var me = await session.Http.GetAsync("/api/me"))
        {
            using var json = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(session.UserId, json.RootElement.GetProperty("userId").GetGuid());
            Assert.True(json.RootElement.GetProperty("isAuthenticated").GetBoolean());
            Assert.True(json.RootElement.GetProperty("canWrite").GetBoolean());
            Assert.Equal("google", json.RootElement.GetProperty("signedInWith").GetString());
        }

        Assert.Contains(session.Cookies.Keys, k => k == "__Host-fw.session");
    }

    /// <summary>
    /// Boo A37: the session cookie is a DataProtection payload, and the key ring lives in Postgres,
    /// so a restart (a deploy) doesn't sign everyone out. Negative control (recorded, not
    /// automated): without <c>PersistKeysToDbContext</c> the same jar reads as anonymous after the
    /// restart.
    /// </summary>
    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task A_session_survives_a_restart_because_the_keys_are_in_Postgres()
    {
        await ResetAsync();
        using var webRoot = new TempWebRoot();
        await using var stub = await StubOAuthProvider.StartAsync();
        var baseUrl = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}";
        SessionClient session;
        await using (var first = ApiProcess.Start(Environment(baseUrl, stub), "--webroot", webRoot.Path))
        {
            await first.WaitForOutputAsync("Now listening on", StartTimeout);
            session = await SignInAsync(baseUrl);
        }

        using (session)
        {
            await using var second = ApiProcess.Start(Environment(baseUrl, stub), "--webroot", webRoot.Path);
            await second.WaitForOutputAsync("Now listening on", StartTimeout);
            using var me = await session.Http.GetAsync("/api/me");
            using var json = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.True(json.RootElement.GetProperty("isAuthenticated").GetBoolean());
            Assert.Equal(session.UserId, json.RootElement.GetProperty("userId").GetGuid());
        }

        await using var check = new FireworksDbContext(new DbContextOptionsBuilder<FireworksDbContext>()
            .UseNpgsql(PostgresFactAttribute.ConnectionString).Options);
        Assert.NotEmpty(await check.DataProtectionKeys.ToListAsync());
    }

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Real_program_serves_client_config_with_an_environment_override_over_appsettings()
    {
        // Railway sets ClientPlayback__SeekBudgetMs; the other three must still come from the
        // committed appsettings.json, which only the real Program (content root = its folder) reads.
        using var webRoot = new TempWebRoot();
        var baseUrl = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}";
        var environment = new Dictionary<string, string>
        {
            ["ASPNETCORE_ENVIRONMENT"] = "Production",
            ["ASPNETCORE_URLS"] = baseUrl,
            ["ConnectionStrings__Postgres"] = PostgresFactAttribute.ConnectionString,
            ["ClientPlayback__SeekBudgetMs"] = "40"
        };
        foreach (var (key, value) in TestIdentity.ProductionGoogleEnvironment)
        {
            environment[key] = value;
        }

        await using var api = ApiProcess.Start(environment, "--webroot", webRoot.Path);

        await api.WaitForOutputAsync("Now listening on", StartTimeout);
        using var client = new HttpClient { BaseAddress = new Uri(baseUrl) };

        using var response = await client.GetAsync("/api/client-config");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var playback = json.RootElement.GetProperty("playback");
        Assert.Equal(40, playback.GetProperty("seekBudgetMs").GetInt32());
        Assert.Equal(300, playback.GetProperty("catchingUpDelayMs").GetInt32());
        Assert.Equal(10, playback.GetProperty("checkpointIntervalSeconds").GetInt32());
        Assert.Equal(64, playback.GetProperty("checkpointMemoryMiB").GetInt32());
        // Production with a real-shaped client offers Google (schema.md §2.8: never empty there).
        Assert.Equal("""[{"id":"google","name":"Google"}]""", json.RootElement.GetProperty("loginProviders").GetRawText());
    }

    private static async Task<HttpResponseMessage> Named(string fixture, Func<Task<HttpResponseMessage>> send)
    {
        try
        {
            return await send();
        }
        catch (HttpRequestException exception)
        {
            throw new InvalidOperationException($"{fixture}: {exception.Message}", exception);
        }
    }

    private static async Task ResetAsync()
    {
        await using var reset = new FireworksDbContext(new DbContextOptionsBuilder<FireworksDbContext>()
            .UseNpgsql(PostgresFactAttribute.ConnectionString).Options);
        await reset.Database.EnsureDeletedAsync();
    }

    /// <summary>Testing plus the stub's endpoints and sentinel pair (the server-stub contract), as the smoke and the Docker stub run use.</summary>
    private static Dictionary<string, string> Environment(string baseUrl, StubOAuthProvider stub, int writesPerMinute = 100000)
    {
        var environment = new Dictionary<string, string>
        {
            ["ASPNETCORE_ENVIRONMENT"] = "Testing",
            ["ASPNETCORE_URLS"] = baseUrl,
            ["ConnectionStrings__Postgres"] = PostgresFactAttribute.ConnectionString,
            ["RateLimits__Writes__PerMinute"] = writesPerMinute.ToString(),
            ["RateLimits__Writes__PerDay"] = "100000",
            ["RateLimits__Reads__PerMinute"] = "100000"
        };
        foreach (var (key, value) in stub.Configuration)
        {
            environment[key.Replace(":", "__")] = value!;
        }

        return environment;
    }

    /// <summary>
    /// The real Program, real Postgres, every shared fixture over HTTP (Boo S22, S23): valid ones 201
    /// and readable back, invalid ones 400 with their multiset, server-only ones their status. Then a
    /// full update/remix/list/delete round trip. Catches Program.cs drifting from the harness (a
    /// missing registration, constraint, limit or header).
    /// </summary>
    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Real_program_serves_every_fixture_and_the_creation_round_trip_on_Postgres()
    {
        await ResetAsync();
        using var webRoot = new TempWebRoot();
        await using var stub = await StubOAuthProvider.StartAsync();
        var baseUrl = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}";
        await using var api = ApiProcess.Start(Environment(baseUrl, stub), "--webroot", webRoot.Path);
        await api.WaitForOutputAsync("Now listening on", StartTimeout);
        Assert.Contains("_AddCreations", api.Output);

        using var session = await SignInAsync(baseUrl);
        var client = session.Http;
        string? firstValid = null;
        foreach (var name in SchemaFixtures.DocumentFixtureNames())
        {
            var fixture = SchemaFixtures.LoadDocument(name);
            var body = $"{{\"kind\":{JsonSerializer.Serialize(fixture.Kind)},\"document\":{fixture.DocumentRawText}}}";
            using var response = await Named(name, () => Creations.CreationApiHarness.SendJsonAsync(client, HttpMethod.Post, "/api/creations", body));
            if (fixture.Group == "valid")
            {
                Assert.True(response.StatusCode == HttpStatusCode.Created, $"{name}: {(int)response.StatusCode}");
                using var created = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                var code = created.RootElement.GetProperty("shareCode").GetString()!;
                firstValid ??= code;
                using var read = JsonDocument.Parse(await client.GetStringAsync($"/api/creations/{code}"));
                Assert.True(JsonSemantics.Equal(read.RootElement.GetProperty("document"), fixture.Document), name);
            }
            else
            {
                Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{name}: {(int)response.StatusCode}");
                var expected = fixture.Document.ValueKind == JsonValueKind.Object ? fixture.Errors : [new PathCode("document", "not-object")];
                Assert.Equal(SchemaFixtures.Ledger(expected), SchemaFixtures.Ledger(await Creations.CreationApiHarness.ReadErrorsAsync(response)));
            }
        }

        foreach (var name in SchemaFixtures.ServerOnlyFixtureNames())
        {
            var fixture = SchemaFixtures.LoadServerOnly(name);
            using var response = await Named(name, () => Creations.CreationApiHarness.SendRawAsync(client, HttpMethod.Post, "/api/creations", fixture.Body, fixture.ContentType));
            Assert.True(fixture.Status == (int)response.StatusCode, $"{name}: {(int)response.StatusCode}");
        }

        var peony = SchemaFixtures.LoadDocument("valid/shell/preset-peony").DocumentRawText;
        using (var put = await Creations.CreationApiHarness.SendJsonAsync(client, HttpMethod.Put, $"/api/creations/{firstValid}", $"{{\"document\":{peony}}}"))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            Assert.Equal("no-store", put.Headers.CacheControl?.ToString());
        }

        using (var remix = await Creations.CreationApiHarness.SendJsonAsync(client, HttpMethod.Post, $"/api/creations/{firstValid}/remix", $"{{\"document\":{peony}}}"))
        {
            Assert.Equal(HttpStatusCode.Created, remix.StatusCode);
            using var json = JsonDocument.Parse(await remix.Content.ReadAsStringAsync());
            Assert.Equal(firstValid, json.RootElement.GetProperty("remixedFrom").GetString());

            // Read back from the database, not the insert's in-memory entity: catches a remix that
            // never stores remixed_from_id (Toad).
            var remixCode = json.RootElement.GetProperty("shareCode").GetString();
            using var readBack = JsonDocument.Parse(await client.GetStringAsync($"/api/creations/{remixCode}"));
            Assert.Equal(firstValid, readBack.RootElement.GetProperty("remixedFrom").GetString());
        }

        using (var list = JsonDocument.Parse(await client.GetStringAsync("/api/me/creations?page=2147483647&pageSize=100")))
        {
            Assert.Empty(list.RootElement.GetProperty("items").EnumerateArray());
            Assert.True(list.RootElement.GetProperty("totalCount").GetInt32() > 30);
        }

        using (var bad = await client.GetAsync("/api/creations/abcdefgl"))
        {
            Assert.Equal(HttpStatusCode.NotFound, bad.StatusCode);
        }

        using (var delete = await client.DeleteAsync($"/api/creations/{firstValid}"))
        {
            Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        }

        Assert.DoesNotContain("Unhandled exception", api.Output);
    }

    /// <summary>
    /// The real Program's identity, limiter and gate: anonymous writes are 401 and not counted, the
    /// signed-in user's writes are limited (429), and health is never limited.
    /// </summary>
    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Real_program_rate_limits_writes_with_429_spares_health_and_401s_anonymous_writes()
    {
        await ResetAsync();
        using var webRoot = new TempWebRoot();
        await using var stub = await StubOAuthProvider.StartAsync();
        var baseUrl = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}";
        await using (var api = ApiProcess.Start(Environment(baseUrl, stub, writesPerMinute: 2), "--webroot", webRoot.Path))
        {
            await api.WaitForOutputAsync("Now listening on", StartTimeout);
            using var anonymous = new HttpClient { BaseAddress = new Uri(baseUrl) };
            using var session = await SignInAsync(baseUrl);
            var client = session.Http;
            var body = $"{{\"kind\":\"shell\",\"document\":{SchemaFixtures.LoadDocument("valid/shell/preset-peony").DocumentRawText}}}";

            for (var i = 0; i < 3; i++)
            {
                // 401 comes before the limiter, so these spend nothing.
                using var unauthorized = await Creations.CreationApiHarness.SendJsonAsync(anonymous, HttpMethod.Post, "/api/creations", body);
                Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
            }

            for (var i = 0; i < 2; i++)
            {
                using var created = await Creations.CreationApiHarness.SendJsonAsync(client, HttpMethod.Post, "/api/creations", body);
                Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            }

            using (var limited = await Creations.CreationApiHarness.SendJsonAsync(client, HttpMethod.Post, "/api/creations", body))
            {
                Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
                Assert.True(limited.Headers.Contains("Retry-After"));
            }

            using (var list = await anonymous.GetAsync("/api/me/creations"))
            {
                Assert.Equal(HttpStatusCode.Unauthorized, list.StatusCode);
            }

            for (var i = 0; i < 20; i++)
            {
                using var health = await client.GetAsync("/health/live");
                Assert.Equal(HttpStatusCode.OK, health.StatusCode);
            }
        }
    }

    /// <summary>
    /// Phase 7 B1 on the real Program (Boo P7-S1 to S8): what the Kestrel harness can't show is
    /// Program.cs's own order and registrations, the real forwarded-headers middleware feeding HSTS,
    /// and a real database going away under <c>/health/ready</c>. Each line here fails if its
    /// Program.cs call is removed (the harness calls the same extension methods, so it can't).
    /// </summary>
    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Real_program_serves_the_phase7_headers_caching_etag_and_readiness()
    {
        await ResetAsync();
        using var webRoot = new TempWebRoot();
        await File.WriteAllTextAsync(Path.Combine(webRoot.Path, "chunk-AAAAAAAA.js"), "export const x = 1;");
        await using var stub = await StubOAuthProvider.StartAsync();
        var baseUrl = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}";
        await using var api = ApiProcess.Start(Environment(baseUrl, stub), "--webroot", webRoot.Path);
        await api.WaitForOutputAsync("Now listening on", StartTimeout);
        using var client = new HttpClient { BaseAddress = new Uri(baseUrl) };
        using var session = await SignInAsync(baseUrl);

        foreach (var (path, cache) in new[]
                 {
                     ("/", "no-cache"), ("/s/a.b", "no-cache"), ("/c/..%2Fme", "no-cache"), ("/chunk-AAAAAAAA.js", "public, max-age=31536000, immutable"),
                     ("/nope.js", "no-store"), ("/api/client-config", "no-store"), ("/api/nope", "no-store"), ("/health/live", "no-store, no-cache")
                 })
        {
            using var response = await client.GetAsync(path);
            Assert.Empty(HeaderExpectations.Problems(response).Select(p => $"{path}: {p}"));
            Assert.Equal(cache, HeaderExpectations.CacheControl(response));
        }

        // HSTS follows X-Forwarded-Proto through the real forwarded-headers middleware; a
        // non-localhost Host, so a UseHsts()-style localhost exclusion would show up here.
        foreach (var (proto, expectHsts) in new[] { ("https", true), ("http", false) })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/");
            request.Headers.Host = "fireworks.example";
            request.Headers.Add("X-Forwarded-Proto", proto);
            using var response = await client.SendAsync(request);
            Assert.Empty(HeaderExpectations.Problems(response, expectHsts));
        }

        using (var noProto = new HttpRequestMessage(HttpMethod.Get, "/"))
        {
            noProto.Headers.Host = "fireworks.example";
            using var response = await client.SendAsync(noProto);
            Assert.Empty(HeaderExpectations.Problems(response, expectHsts: false));
        }

        // ETag and 304 on the share-code GET.
        var code = await Hardening.ResponseHeaderTests.CreateAsync(session.Http);
        string tag;
        using (var got = await session.Http.GetAsync($"/api/creations/{code}"))
        {
            tag = got.Headers.GetValues("ETag").Single();
            using var json = JsonDocument.Parse(await got.Content.ReadAsStringAsync());
            Assert.Equal("\"" + json.RootElement.GetProperty("updatedAt").GetString() + "\"", tag);
            Assert.Equal("private, no-cache", HeaderExpectations.CacheControl(got));
        }

        using (var conditional = new HttpRequestMessage(HttpMethod.Get, $"/api/creations/{code}"))
        {
            conditional.Headers.TryAddWithoutValidation("If-None-Match", tag);
            using var response = await session.Http.SendAsync(conditional);
            Assert.Equal(HttpStatusCode.NotModified, response.StatusCode);
            Assert.Equal("Cookie", response.Headers.Vary.Single());
            Assert.Equal(tag, response.Headers.GetValues("ETag").Single());
            Assert.Empty(HeaderExpectations.Problems(response));
        }

        // Chunked over-limit write, signed in: answered with Connection: close.
        var chunkedHead = System.Text.Encoding.ASCII.GetBytes(
            "POST /api/creations HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n"
            + "Cookie: " + string.Join("; ", session.Cookies.Select(kv => $"{kv.Key}={kv.Value}")) + "\r\n\r\n");
        var chunk = new byte[8192];
        Array.Fill(chunk, (byte)' ');
        var chunked = new MemoryStream();
        for (var i = 0; i < 40; i++)
        {
            chunked.Write("2000\r\n"u8);
            chunked.Write(chunk);
            chunked.Write("\r\n"u8);
        }

        chunked.Write("0\r\n\r\n"u8);
        var head = await HeaderExpectations.RawHeadAsync(client.BaseAddress!, chunkedHead, chunked.ToArray());
        Assert.StartsWith("HTTP/1.1 413", head);
        Assert.Equal("close", HeaderExpectations.RawHeader(head, "Connection"));
        Assert.Null(HeaderExpectations.RawHeader(head, "Server"));

        // Readiness: 200 while the database is there; drop it under the running app and ready turns
        // 503 text/plain while live stays 200.
        using (var ready = await client.GetAsync("/health/ready"))
        {
            Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
            Assert.Equal("text/plain", ready.Content.Headers.ContentType?.MediaType);
            Assert.Equal("Healthy", await ready.Content.ReadAsStringAsync());
        }

        var target = new NpgsqlConnectionStringBuilder(PostgresFactAttribute.ConnectionString);
        var database = target.Database!;
        target.Database = "postgres";
        target.Pooling = false;
        await using (var admin = new NpgsqlConnection(target.ConnectionString))
        {
            await admin.OpenAsync();
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{database}\" WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }

        using (var ready = await client.GetAsync("/health/ready"))
        {
            Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
            Assert.Equal("text/plain", ready.Content.Headers.ContentType?.MediaType);
            var body = await ready.Content.ReadAsStringAsync();
            Assert.Equal("Unhealthy", body);
            Assert.Empty(HeaderExpectations.Problems(ready));
        }

        using (var live = await client.GetAsync("/health/live"))
        {
            Assert.Equal(HttpStatusCode.OK, live.StatusCode);
            Assert.Equal("Healthy", await live.Content.ReadAsStringAsync());
        }
    }
}

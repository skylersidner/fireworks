using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Services.Identity;
using Fireworks.Api.Tests.Controllers;
using Fireworks.Api.Tests.Creations;
using Fireworks.Api.Tests.Data;
using Fireworks.Api.Tests.Support;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;

namespace Fireworks.Api.Tests.Auth;

/// <summary>PUT's If-Match (schema.md §11.4, §2.6 step 8; Boo A29), over HTTP with two accounts.</summary>
public sealed class IfMatchTests
{
    private static string Doc(string name) => $"{{\"document\":{CreationEndpointTests.Peony.Replace("\"Peony\"", $"\"{name}\"")}}}";

    [Fact]
    public async Task The_precondition_matrix_for_owner_and_non_owner()
    {
        await using var h = await FireworksApiHarness.StartAsync(configuration: FireworksApiHarness.UnthrottledRateLimits);
        var alice = await h.SignInAsync(TestIdentity.Alice);
        var bob = await h.SignInAsync(TestIdentity.Bob);
        var code = await Hardening.ResponseHeaderTests.CreateAsync(alice.Http);
        var path = $"/api/creations/{code}";
        var current = await CreationApiHarness.CurrentTagAsync(alice.Http, path);
        var inner = current.Trim('"');

        async Task<HttpResponseMessage> Put(SessionClient who, string? tag, string body) =>
            await CreationApiHarness.SendJsonAsync(who.Http, HttpMethod.Put, path, body, tag);

        // Bob: 428 without the header (it reveals nothing: the same for any code), 404 for every tag.
        Assert.Equal(HttpStatusCode.PreconditionRequired, (await Put(bob, null, Doc("B"))).StatusCode);
        Assert.Equal(HttpStatusCode.PreconditionRequired, (await CreationApiHarness.SendJsonAsync(bob.Http, HttpMethod.Put, "/api/creations/NoSuch11", Doc("B"), null)).StatusCode);
        foreach (var tag in new[] { current, "*", "\"nope\"" })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await Put(bob, tag, Doc("B"))).StatusCode);
        }

        // Alice: 428 is a header check before the body.
        using var missing = await CreationApiHarness.SendRawAsync(alice.Http, HttpMethod.Put, path, [1, 2], "text/plain", ifMatch: null);
        Assert.Equal(HttpStatusCode.PreconditionRequired, missing.StatusCode);
        Assert.Equal("no-store", Hardening.HeaderExpectations.CacheControl(missing));

        // Unmatchable or stale: 412 with the current owner tag, nothing written.
        foreach (var tag in new[]
                 {
                     "*", $"W/{current}", $"\"{inner}-p\"", "\"not-a-date\"", $"{current}, {current}", "\"1999-01-01T00:00:00+00:00\"",
                     $"\"{inner.Replace("+00:00", "Z")}\"", "", "garbage"
                 })
        {
            using var failed = await Put(alice, tag, Doc("Stale"));
            Assert.True(failed.StatusCode == HttpStatusCode.PreconditionFailed, $"If-Match: {tag} -> {(int)failed.StatusCode}");
            Assert.Equal(current, failed.Headers.ETag!.ToString());
            Assert.Equal("no-store", Hardening.HeaderExpectations.CacheControl(failed));
        }

        // A bad document is 400 before the 412 (only a valid write can be a conflict).
        Assert.Equal(HttpStatusCode.BadRequest, (await Put(alice, "*", "{\"document\":{}}")).StatusCode);
        Assert.Equal("Peony", JsonDocument.Parse(await alice.Http.GetStringAsync(path)).RootElement.GetProperty("name").GetString());

        // The current tag: 200 and a new tag; the old one is now stale.
        using var ok = await Put(alice, current, Doc("Fresh"));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var next = ok.Headers.ETag!.ToString();
        Assert.NotEqual(current, next);
        using var stale = await Put(alice, current, Doc("Again"));
        Assert.Equal((HttpStatusCode.PreconditionFailed, next), (stale.StatusCode, stale.Headers.ETag!.ToString()));
    }

    [Fact]
    public async Task A_delete_is_unconditional()
    {
        await using var h = await FireworksApiHarness.StartAsync(signedIn: true);
        var code = await Hardening.ResponseHeaderTests.CreateAsync(h.Client);
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/api/creations/{code}");
        request.Headers.TryAddWithoutValidation("If-Match", "\"stale\"");
        Assert.Equal(HttpStatusCode.NoContent, (await h.Client.SendAsync(request)).StatusCode);
    }

    private static readonly System.Text.Json.JsonSerializerOptions Web = new(System.Text.Json.JsonSerializerDefaults.Web);

    [Theory]
    [InlineData(null, false, false)]
    [InlineData("*", true, false)]
    [InlineData("W/\"2026-11-16T10:00:00.123456+00:00\"", true, false)]
    [InlineData("\"2026-11-16T10:00:00.123456+00:00-p\"", true, false)]
    [InlineData("\"2026-11-16T10:00:00.123456+00:00\", \"x\"", true, false)]
    [InlineData("\"2026-11-16T10:00:00.123456Z\"", true, false)]
    [InlineData("\"2026-11-16T11:00:00.123456+01:00\"", true, false)]
    [InlineData("2026-11-16T10:00:00.123456+00:00", true, false)]
    [InlineData("\"\"", true, false)]
    [InlineData("\"2026-11-16T10:00:00.123456+00:00\"", true, true)]
    [InlineData("\"2026-11-16T10:00:00+00:00\"", true, true)]
    public void Parse_admits_only_the_exact_strong_owner_tag(string? header, bool present, bool matchable)
    {
        var parsed = IfMatchPrecondition.Parse(header is null ? StringValues.Empty : new StringValues(header), Web);
        Assert.Equal((present, matchable), (parsed.Present, parsed.Tag is not null));
    }

    [Fact]
    public void Two_If_Match_header_lines_are_unmatchable() =>
        Assert.Null(IfMatchPrecondition.Parse(new StringValues(["\"2026-11-16T10:00:00+00:00\"", "\"2026-11-16T10:00:00+00:00\""]), Web).Tag);
}

/// <summary>
/// The race (Boo A29, toad-api-harness-concurrency-and-measured-round-counts.md): two PUTs with the
/// same tag, on separate contexts, against real Postgres row locks. Exactly one wins every round.
/// The read-then-write mutant (<c>phase8-auth</c> R1) is what this is measured against.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class IfMatchRacePostgresTests
{
    public const int Rounds = 25;

    private static FireworksDbContext NewContext() =>
        new(new DbContextOptionsBuilder<FireworksDbContext>().UseNpgsql(PostgresFactAttribute.ConnectionString).Options);

    [PostgresFact]
    [Trait("Category", "Postgres")]
    public async Task Two_PUTs_with_the_same_tag_give_exactly_one_update()
    {
        await using (var reset = NewContext())
        {
            await reset.Database.EnsureDeletedAsync();
            await FireworksDbInitializer.InitializeAsync(reset);
        }

        var owner = Guid.CreateVersion7();
        await using (var seed = NewContext())
        {
            seed.Users.Add(new User { Id = owner, DisplayName = "Owner", ExternalProvider = "google", ExternalSubject = "race" });
            await seed.SaveChangesAsync();
            await new CreationRepository(seed).TryInsertAsync(CreationRepositoryTestsRow(owner), default);
        }

        var outcomes = new ConcurrentBag<string>();
        for (var round = 0; round < Rounds; round++)
        {
            DateTimeOffset tag;
            await using (var read = NewContext())
            {
                tag = (await read.Creations.AsNoTracking().SingleAsync()).UpdatedAt;
            }

            using var start = new SemaphoreSlim(0);
            var racers = Enumerable.Range(0, 2).Select(i => Task.Run(async () =>
            {
                await start.WaitAsync();
                await using var db = NewContext();
                var outcome = await new CreationRepository(db).UpdateOwnedAsync(
                    "RACERACE", owner, new CreationContent($"r{round}-{i}", 1, ["red"], CreationEndpointTests.Peony), tag, default);
                return outcome.Updated is not null ? "200" : outcome.CurrentUpdatedAt is not null ? "412" : "404";
            })).ToList();
            start.Release(2);
            var results = await Task.WhenAll(racers);
            Assert.Equal(["200", "412"], results.Order(StringComparer.Ordinal));
            foreach (var r in results) outcomes.Add(r);
        }

        Assert.Equal(Rounds, outcomes.Count(o => o == "200"));
    }

    private static Creation CreationRepositoryTestsRow(Guid owner) => new()
    {
        Id = Guid.CreateVersion7(), ShareCode = "RACERACE", Kind = CreationKind.Shell, Name = "Race", SchemaVersion = 1,
        Palette = ["red"], Document = CreationEndpointTests.Peony, OwnerUserId = owner
    };
}

/// <summary>Boo A5's table, unit level (the round trip is in <see cref="SignInFlowTests"/>).</summary>
public sealed class SafeReturnUrlTests
{
    [Theory]
    [InlineData(null, "/")]
    [InlineData("", "/")]
    [InlineData("/", "/")]
    [InlineData("//evil.example", "/")]
    [InlineData("/\\evil.example", "/")]
    [InlineData("/x\\y", "/")]
    [InlineData("/\t/evil.example", "/")]
    [InlineData("/a\u007f", "/")]
    [InlineData("/a\u0000", "/")]
    [InlineData("/api", "/")]
    [InlineData("/apiary", "/")]
    [InlineData("/Api/me", "/")]
    [InlineData("/%61pi/auth/logout", "/")]
    [InlineData("/%2F%2Fevil.example", "/")]
    [InlineData("/%5Cevil", "/")]
    [InlineData("/%zz", "/%zz")]
    [InlineData("https://evil.example", "/")]
    [InlineData("~/x", "/")]
    [InlineData("/c/abcdefgh?x=1", "/c/abcdefgh?x=1")]
    [InlineData("/s/abc?next=//evil", "/s/abc?next=//evil")]
    [InlineData("/show#a", "/show#a")]
    public void From_accepts_only_safe_internal_paths(string? raw, string expected) =>
        Assert.Equal(expected, SafeReturnUrl.From(raw));

    [Fact]
    public void The_length_limit_is_2048()
    {
        Assert.Equal("/" + new string('a', 2047), SafeReturnUrl.From("/" + new string('a', 2047)));
        Assert.Equal("/", SafeReturnUrl.From("/" + new string('a', 2048)));
    }
}

/// <summary>Boo A39: a capturing logger at Trace for everything during a stub sign-in.</summary>
public sealed class LogHygieneTests
{
    private sealed class CapturingProvider : ILoggerProvider, ISupportExternalScope
    {
        public ConcurrentQueue<string> Lines { get; } = new();
        private IExternalScopeProvider scopes = new LoggerExternalScopeProvider();
        public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);
        public void SetScopeProvider(IExternalScopeProvider scopeProvider) => scopes = scopeProvider;
        public void Dispose() { }

        private sealed class Logger(CapturingProvider owner, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => owner.scopes.Push(state);
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var line = $"{logLevel} {category}: {formatter(state, exception)} {exception}";
                owner.scopes.ForEachScope((scope, acc) => acc.Enqueue(line + " | scope " + scope), owner.Lines);
                owner.Lines.Enqueue(line);
            }
        }
    }

    [Fact]
    public async Task Our_code_never_logs_the_subject_name_code_state_or_token()
    {
        var capture = new CapturingProvider();
        await using var h = await FireworksApiHarness.StartAsync(loggerProvider: capture);
        h.Stub.SetName(TestIdentity.Alice, "Alice Secret-Name");
        var session = h.NewSession();
        var result = await session.SignInAsync(TestIdentity.Alice);
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(result.CallbackUrl).Query);

        var ours = capture.Lines.Where(l => System.Text.RegularExpressions.Regex.IsMatch(l, @"^\w+ Fireworks\.")).ToList();
        Assert.Contains(ours, l => l.Contains("Provisioned user " + session.UserId, StringComparison.Ordinal));
        var secrets = new[] { TestIdentity.Alice, "Alice Secret-Name", query["code"].ToString(), query["state"].ToString(), GoogleProviderSettings.StubClientSecret }
            .Concat(h.Stub.IssuedAccessTokens);
        foreach (var secret in secrets)
        {
            Assert.DoesNotContain(ours, l => l.Contains(secret, StringComparison.Ordinal));
        }

        // The framework's own Debug/Trace lines do carry some of these (that is why the committed
        // config keeps Microsoft.AspNetCore at Warning, CommittedConfigurationTests); none of them
        // is at Warning or above.
        Assert.DoesNotContain(capture.Lines, l => (l.StartsWith("Warning", StringComparison.Ordinal) || l.StartsWith("Error", StringComparison.Ordinal) || l.StartsWith("Critical", StringComparison.Ordinal))
                                                  && secrets.Any(secret => l.Contains(secret, StringComparison.Ordinal)));
    }
}

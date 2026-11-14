using System.Text;
using System.Text.Json;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Services;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Tests.Support;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Fireworks.Api.Tests.Services;

/// <summary>
/// Service branches against a fake repository and a fake <c>ICurrentUser</c> (plan Phase 4 tests):
/// the gate on every path with an empty call ledger (Boo S8), ownership with two user ids (S7, S9),
/// insert-only remix and collision retry (S10), and the <c>remixedFrom</c> rule (Skyler's ruling:
/// <c>isOwner ? source : null</c>, no <c>CanWrite</c> term).
/// </summary>
public sealed class CreationServiceTests
{
    private static readonly Guid UserA = SqliteTestDatabase.UserA;
    private static readonly Guid UserB = SqliteTestDatabase.UserB;

    private const string Peony =
        """{"version":1,"name":"Peony","burstHeight":0.65,"angleJitter":4,"breaks":[{"pattern":"peony","stars":120,"speed":220,"color1":"red","color2":"gold","changeAt":0.65,"burn":1.6,"drag":0.9,"size":1,"trail":"none","effect":"none","delay":0.6}]}""";

    private static ICreationRequestBody Body(string json, bool isJson = true) => new BytesCreationRequestBody(Encoding.UTF8.GetBytes(json), isJson);

    private static ICreationRequestBody CreateBody(string document = Peony) => Body($"{{\"kind\":\"shell\",\"document\":{document}}}");

    private static ICreationRequestBody DocumentBody(string document = Peony) => Body($"{{\"document\":{document}}}");

    private sealed class Rig
    {
        public FakeCreationRepository Repository { get; } = new();
        public FakeCurrentUser User { get; } = new() { UserId = UserA, CanWrite = true };
        public QueuedShareCodeGenerator Codes { get; }
        public ListLogger Logger { get; } = new();
        public CreationService Service { get; }

        public Rig(params string[] codes)
        {
            Codes = new QueuedShareCodeGenerator(codes);
            Service = new CreationService(User, Repository, Codes, Logger);
        }

        public Rig As(Guid? userId, bool canWrite = true)
        {
            User.UserId = userId;
            User.CanWrite = canWrite;
            return this;
        }
    }

    // ---- the gate (S8) ------------------------------------------------------------------------

    public static TheoryData<string, Guid?, bool> WritesOff() => new()
    {
        { "create", UserA, false }, { "update", UserA, false }, { "delete", UserA, false }, { "remix", UserA, false }, { "list", UserA, false },
        // CanWrite implies a user, but both are checked.
        { "create", null, true }, { "update", null, true }, { "delete", null, true }, { "remix", null, true }, { "list", null, true }
    };

    [Theory]
    [MemberData(nameof(WritesOff))]
    public async Task Every_write_path_and_the_list_are_Forbidden_before_any_repository_call(string operation, Guid? userId, bool canWrite)
    {
        var rig = new Rig().As(userId, canWrite);
        rig.Repository.Seed(UserA, "AAAAAAAA");
        rig.Repository.Ledger.Clear();
        // A body that would be 415 if the gate didn't come first.
        var body = Body("not json at all", isJson: false);

        ServiceError? error = operation switch
        {
            "create" => (await rig.Service.CreateAsync(body, default)).Error,
            "update" => (await rig.Service.UpdateOwnedAsync("AAAAAAAA", body, default)).Error,
            "delete" => (await rig.Service.DeleteOwnedAsync("AAAAAAAA", default)).Error,
            "remix" => (await rig.Service.RemixAsync("AAAAAAAA", body, default)).Error,
            _ => (await rig.Service.ListMineAsync(new CreationListQuery(["abc"], null, ["bogus"]), default)).Error
        };

        Assert.Equal(ServiceErrorType.Forbidden, error?.Type);
        Assert.Empty(rig.Repository.Ledger.Calls);
        Assert.Equal(0, rig.Codes.Calls);
    }

    [Fact]
    public async Task Public_get_needs_no_write_permission()
    {
        var rig = new Rig().As(null, canWrite: false);
        rig.Repository.Seed(UserA, "AAAAAAAA");

        var result = await rig.Service.GetAsync("AAAAAAAA", default);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.IsOwner);
    }

    // ---- body order after the gate (S6, S8) ----------------------------------------------------

    [Fact]
    public async Task After_the_gate_content_type_comes_before_size_and_parsing()
    {
        var rig = new Rig();
        Assert.Equal(ServiceErrorType.UnsupportedMediaType, (await rig.Service.CreateAsync(Body("{}", isJson: false), default)).Error?.Type);
        var huge = new BytesCreationRequestBody(new byte[CreationLimits.MaxRequestBytes + 1]);
        Assert.Equal(ServiceErrorType.PayloadTooLarge, (await rig.Service.CreateAsync(huge, default)).Error?.Type);
        Assert.Empty(rig.Repository.Ledger.Calls);
    }

    // ---- ownership (S7, S9) ---------------------------------------------------------------------

    [Fact]
    public async Task The_owner_is_always_the_current_user()
    {
        var rig = new Rig("AAAAAAAA").As(UserB);

        var result = await rig.Service.CreateAsync(CreateBody(), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(UserB, Assert.Single(rig.Repository.Rows).OwnerUserId);
        Assert.True(result.Value!.IsOwner);
        Assert.Null(result.Value.RemixedFrom);
    }

    [Fact]
    public async Task A_non_owner_gets_NotFound_on_update_and_delete_and_the_row_is_unchanged()
    {
        var rig = new Rig().As(UserB);
        var row = rig.Repository.Seed(UserA, "AAAAAAAA");
        var before = (row.Name, row.Document, row.UpdatedAt, string.Join(",", row.Palette));

        var update = await rig.Service.UpdateOwnedAsync("AAAAAAAA", DocumentBody(), default);
        var delete = await rig.Service.DeleteOwnedAsync("AAAAAAAA", default);
        var unknown = await rig.Service.UpdateOwnedAsync("BBBBBBBB", DocumentBody(), default);

        Assert.Equal(ServiceErrorType.NotFound, update.Error?.Type);
        Assert.Equal(ServiceErrorType.NotFound, delete.Error?.Type);
        // "not yours" and "doesn't exist" are the same answer.
        Assert.Equal(unknown.Error, update.Error);
        Assert.Equal(before, (row.Name, row.Document, row.UpdatedAt, string.Join(",", row.Palette)));
        Assert.Single(rig.Repository.Rows);
    }

    [Fact]
    public async Task The_owner_can_update_and_delete()
    {
        var rig = new Rig("AAAAAAAA").As(UserA);
        await rig.Service.CreateAsync(CreateBody(), default);

        var update = await rig.Service.UpdateOwnedAsync("AAAAAAAA", DocumentBody(Peony.Replace("\"Peony\"", "\"Renamed\"")), default);
        Assert.True(update.IsSuccess);
        Assert.Equal("Renamed", update.Value!.Name);

        Assert.True((await rig.Service.DeleteOwnedAsync("AAAAAAAA", default)).IsSuccess);
        Assert.Empty(rig.Repository.Rows);
    }

    [Fact]
    public async Task Update_validates_against_the_stored_kind_and_never_takes_kind_from_the_body()
    {
        var rig = new Rig().As(UserA);
        rig.Repository.Seed(UserA, "AAAAAAAA", CreationKind.Shell);

        var withKind = await rig.Service.UpdateOwnedAsync("AAAAAAAA", Body($"{{\"kind\":\"show\",\"document\":{Peony}}}"), default);
        Assert.Equal(["kind :: unknown-property"], withKind.Error!.Issues!.Select(i => $"{i.Path} :: {i.Code}"));

        var showDocument = SchemaFixtures.LoadDocument("valid/show/minimal").DocumentRawText;
        var mismatch = await rig.Service.UpdateOwnedAsync("AAAAAAAA", DocumentBody(showDocument), default);
        Assert.Contains("breaks :: break-count", mismatch.Error!.Issues!.Select(i => $"{i.Path} :: {i.Code}"));
    }

    // ---- remix (S10, S11, remixedFrom) ----------------------------------------------------------

    [Fact]
    public async Task Remix_of_someone_elses_creation_inserts_a_new_row_and_never_touches_the_source()
    {
        var rig = new Rig("RRRRRRRR").As(UserB);
        var source = rig.Repository.Seed(UserA, "AAAAAAAA");
        var before = (source.Name, source.Document, source.UpdatedAt);

        var remix = await rig.Service.RemixAsync("AAAAAAAA", DocumentBody(), default);

        Assert.True(remix.IsSuccess);
        Assert.Equal("RRRRRRRR", remix.Value!.ShareCode);
        Assert.Equal("AAAAAAAA", remix.Value.RemixedFrom);
        Assert.Equal(before, (source.Name, source.Document, source.UpdatedAt));
        var stored = rig.Repository.Rows.Single(r => r.ShareCode == "RRRRRRRR");
        Assert.Equal(UserB, stored.OwnerUserId);
        Assert.Equal(source.Id, stored.RemixedFromId);
        Assert.Equal(["FindByShareCodeAsync", "TryInsertAsync"], rig.Repository.Ledger.Calls);
    }

    [Fact]
    public async Task Remix_validates_against_the_sources_kind()
    {
        var rig = new Rig().As(UserA);
        rig.Repository.Seed(UserA, "AAAAAAAA", CreationKind.Show);

        var result = await rig.Service.RemixAsync("AAAAAAAA", DocumentBody(), default);

        Assert.Equal(ServiceErrorType.Validation, result.Error?.Type);
        Assert.Contains("cues :: cue-count", result.Error!.Issues!.Select(i => $"{i.Path} :: {i.Code}"));
    }

    [Fact]
    public async Task RemixedFrom_is_the_source_code_for_the_owner_and_null_for_anyone_else()
    {
        var rig = new Rig().As(UserB);
        var source = rig.Repository.Seed(UserA, "AAAAAAAA");
        rig.Repository.Seed(UserB, "RRRRRRRR", remixedFromId: source.Id);

        Assert.Equal("AAAAAAAA", (await rig.Service.GetAsync("RRRRRRRR", default)).Value!.RemixedFrom);

        rig.As(UserA);
        var asOther = (await rig.Service.GetAsync("RRRRRRRR", default)).Value!;
        Assert.False(asOther.IsOwner);
        Assert.Null(asOther.RemixedFrom);

        // Skyler's ruling: isOwner alone decides; CanWrite plays no part.
        rig.As(UserB, canWrite: false);
        Assert.Equal("AAAAAAAA", (await rig.Service.GetAsync("RRRRRRRR", default)).Value!.RemixedFrom);
    }

    [Fact]
    public async Task RemixedFrom_is_null_once_the_source_is_deleted()
    {
        var rig = new Rig().As(UserA);
        var source = rig.Repository.Seed(UserA, "AAAAAAAA");
        rig.Repository.Seed(UserA, "RRRRRRRR", remixedFromId: source.Id);

        await rig.Service.DeleteOwnedAsync("AAAAAAAA", default);

        Assert.Null((await rig.Service.GetAsync("RRRRRRRR", default)).Value!.RemixedFrom);
    }

    // ---- share codes (S10, S14, S15) -----------------------------------------------------------

    [Fact]
    public async Task A_taken_code_is_retried_with_a_new_one_and_the_existing_row_is_untouched()
    {
        var rig = new Rig("AAAAAAAA", "BBBBBBBB").As(UserB);
        var existing = rig.Repository.Seed(UserA, "AAAAAAAA");
        var before = (existing.Document, existing.UpdatedAt, existing.OwnerUserId);

        var result = await rig.Service.CreateAsync(CreateBody(), default);

        Assert.Equal("BBBBBBBB", result.Value!.ShareCode);
        Assert.Equal(before, (existing.Document, existing.UpdatedAt, existing.OwnerUserId));
        Assert.Equal(["TryInsertAsync", "TryInsertAsync"], rig.Repository.Ledger.Calls);
        Assert.Single(rig.Logger.Warnings);
    }

    [Fact]
    public async Task Five_collisions_throw_and_leave_the_existing_row_alone()
    {
        var rig = new Rig("AAAAAAAA", "AAAAAAAA", "AAAAAAAA", "AAAAAAAA", "AAAAAAAA", "BBBBBBBB");
        var existing = rig.Repository.Seed(UserA, "AAAAAAAA");

        await Assert.ThrowsAsync<InvalidOperationException>(() => rig.Service.CreateAsync(CreateBody(), default));

        Assert.Equal(CreationService.MaxShareCodeAttempts, rig.Codes.Calls);
        Assert.Same(existing, Assert.Single(rig.Repository.Rows));
        Assert.Equal(CreationService.MaxShareCodeAttempts, rig.Logger.Warnings.Count);
    }

    [Theory]
    [InlineData("abcdefgl")]
    [InlineData("abcdefgI")]
    [InlineData("abcdefgO")]
    [InlineData("abcdefg0")]
    [InlineData("abcdefgh\n")]
    [InlineData("abcdefg")]
    [InlineData("abcdefghj")]
    public async Task A_malformed_code_is_NotFound_without_a_query_on_every_path(string code)
    {
        var rig = new Rig();
        var kelvin = "abcdefg" + (char)0x212A;
        foreach (var bad in new[] { code, kelvin })
        {
            Assert.Equal(ServiceErrorType.NotFound, (await rig.Service.GetAsync(bad, default)).Error?.Type);
            Assert.Equal(ServiceErrorType.NotFound, (await rig.Service.UpdateOwnedAsync(bad, DocumentBody(), default)).Error?.Type);
            Assert.Equal(ServiceErrorType.NotFound, (await rig.Service.DeleteOwnedAsync(bad, default)).Error?.Type);
            Assert.Equal(ServiceErrorType.NotFound, (await rig.Service.RemixAsync(bad, DocumentBody(), default)).Error?.Type);
        }

        Assert.Empty(rig.Repository.Ledger.Calls);
    }

    [Fact]
    public void Generated_codes_use_exactly_the_section_9_alphabet()
    {
        Assert.Equal("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", ShareCodeGenerator.Alphabet);
        Assert.Equal(58, ShareCodeGenerator.Alphabet.Distinct().Count());
        Assert.DoesNotContain(ShareCodeGenerator.Alphabet, c => c is '0' or 'O' or 'I' or 'l');
        var generator = new ShareCodeGenerator();
        var codes = Enumerable.Range(0, 2000).Select(_ => generator.NewCode()).ToList();
        Assert.All(codes, code => Assert.True(ShareCodes.IsValid(code), code));
        Assert.All(codes, code => Assert.Matches(ShareCodeGenerator.Pattern, code));
        // 2000 draws over 58 symbols reach every one with overwhelming probability.
        Assert.Equal(58, codes.SelectMany(c => c).Distinct().Count());
    }

    // ---- list (S26, schema.md §2.2.1) --------------------------------------------------------

    private static CreationListQuery Query(string? page = null, string? pageSize = null, string?[]? kind = null) =>
        new(page is null ? null : [page], pageSize is null ? null : [pageSize], kind);

    [Theory]
    [InlineData("Shell")]
    [InlineData("SHELL")]
    [InlineData("0")]
    [InlineData("1")]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("shell,show")]
    public async Task Kind_is_compared_ordinally_and_anything_else_is_kind_enum(string kind)
    {
        var rig = new Rig();
        var result = await rig.Service.ListMineAsync(Query(kind: [kind]), default);
        Assert.Equal(["kind :: enum"], result.Error!.Issues!.Select(i => $"{i.Path} :: {i.Code}"));
        Assert.Empty(rig.Repository.Ledger.Calls);
    }

    [Fact]
    public async Task Kind_given_twice_is_kind_enum_even_when_both_are_valid()
    {
        var rig = new Rig();
        var result = await rig.Service.ListMineAsync(Query(kind: ["shell", "show"]), default);
        Assert.Equal(["kind :: enum"], result.Error!.Issues!.Select(i => $"{i.Path} :: {i.Code}"));
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData("1.5")]
    [InlineData("+1")]
    [InlineData("1e2")]
    [InlineData("5\n")]
    public async Task A_non_integer_page_or_pageSize_is_type_and_all_issues_come_together(string text)
    {
        var rig = new Rig();
        var result = await rig.Service.ListMineAsync(Query(text, text, ["Shell"]), default);
        Assert.Equal(["kind :: enum", "page :: type", "pageSize :: type"],
            result.Error!.Issues!.Select(i => $"{i.Path} :: {i.Code}").Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Page_given_twice_is_type()
    {
        var rig = new Rig();
        var result = await rig.Service.ListMineAsync(new CreationListQuery(["1", "2"], null, null), default);
        Assert.Equal(["page :: type"], result.Error!.Issues!.Select(i => $"{i.Path} :: {i.Code}"));
    }

    [Theory]
    [InlineData("2147483647", "100", 2147483647, 100)]
    [InlineData("99999999999", "24", 2147483647, 24)]
    [InlineData("99999999999999999999999", "99999999999999999999999", 2147483647, 100)]
    [InlineData("-99999999999999999999999", "-5", 1, 1)]
    [InlineData("0", "0", 1, 1)]
    [InlineData("-5", "1000", 1, 100)]
    [InlineData(null, null, 1, 24)]
    public async Task Paging_is_clamped_and_past_the_end_issues_no_page_query(string? page, string? pageSize, int expectedPage, int expectedSize)
    {
        var rig = new Rig().As(UserA);
        rig.Repository.Seed(UserA, "AAAAAAAA");

        var result = (await rig.Service.ListMineAsync(Query(page, pageSize), default)).Value!;

        Assert.Equal((expectedPage, expectedSize, 1), (result.Page, result.PageSize, result.TotalCount));
        if (expectedPage > 1)
        {
            Assert.Empty(result.Items);
            Assert.Equal(["CountOwnedAsync"], rig.Repository.Ledger.Calls);
        }
        else
        {
            Assert.Single(result.Items);
        }
    }

    [Fact]
    public async Task List_shows_only_the_current_users_creations()
    {
        var rig = new Rig().As(UserB);
        rig.Repository.Seed(UserA, "AAAAAAAA");
        rig.Repository.Seed(UserB, "BBBBBBBB");

        var result = (await rig.Service.ListMineAsync(Query(), default)).Value!;

        Assert.Equal(["BBBBBBBB"], result.Items.Select(i => i.ShareCode));
        Assert.Equal(1, result.TotalCount);
    }

    internal sealed class ListLogger : ILogger<CreationService>
    {
        public List<string> Warnings { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Warning)
            {
                Warnings.Add(formatter(state, exception));
            }
        }
    }
}

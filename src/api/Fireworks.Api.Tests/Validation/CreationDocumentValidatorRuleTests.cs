using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Validation;

/// <summary>
/// Rules the shared fixtures can't pin by themselves: the rule 11 path builder against the TS
/// parity list (<c>normalize.spec.ts</c>, "property names in paths"), the name pipeline's C# traps
/// (§6.4), the surrogate-safe reads (§6.5), and the palette rule (§2.2). Non-ASCII test data is
/// built from code points so the source stays ASCII.
/// </summary>
public sealed class CreationDocumentValidatorRuleTests
{
    private static readonly string LoneHigh = ((char)0xD800).ToString();
    private static readonly string LoneLow = ((char)0xDC00).ToString();
    private static readonly string Fffd = ((char)0xFFFD).ToString();
    private static readonly string Firework = char.ConvertFromUtf32(0x1F386);

    // ---- schema.md §6.2 rule 11, the same cases as normalize.spec.ts -------------------------

    [Theory]
    [InlineData("", "stars", "stars")]
    [InlineData("breaks[0]", "_x-1", "breaks[0]._x-1")]
    [InlineData("", "a.b", "[\"a.b\"]")]
    [InlineData("", "", "[\"\"]")]
    [InlineData("", "1a", "[\"1a\"]")]
    [InlineData("", "a b", "[\"a b\"]")]
    [InlineData("", "a[0]", "[\"a[0]\"]")]
    [InlineData("", "a\n", "[\"a\n\"]")]
    [InlineData("breaks[0]", "a\"b", "breaks[0][\"a\\\"b\"]")]
    [InlineData("sky", "a\\b", "sky[\"a\\\\b\"]")]
    public void ChildPath_matches_the_TS_parity_list(string parent, string name, string expected) =>
        Assert.Equal(expected, JsonWalk.ChildPath(parent, name));

    [Fact]
    public void ChildPath_brackets_non_ASCII_keeps_pairs_and_writes_lone_surrogates_as_FFFD()
    {
        var eAcute = ((char)0xE9).ToString();
        Assert.Equal($"[\"{eAcute}\"]", JsonWalk.ChildPath("", eAcute));
        Assert.Equal($"[\"st{Fffd}ars\"]", JsonWalk.ChildPath("", $"st{LoneHigh}ars"));
        Assert.Equal($"[\"{Fffd}{Fffd}\"]", JsonWalk.ChildPath("", LoneLow + LoneHigh));
        Assert.Equal($"[\"a{Fffd}\"]", JsonWalk.ChildPath("", "a" + LoneHigh));
        Assert.Equal($"[\"{Firework}\"]", JsonWalk.ChildPath("", Firework));
    }

    [Fact]
    public void Dropped_keys_use_rule_11_at_every_level()
    {
        // normalize.spec.ts "dropped keys use it at every level", as raw JSON.
        var json = """
            {"version":1,"name":"Peony","burstHeight":0.65,"angleJitter":4,"a.b":1,"":2,
             "sky":{"gravity":160,"wind":0,"x y":3},
             "breaks":[{"pattern":"peony","stars":120,"speed":220,"color1":"red","color2":"gold","changeAt":0.6,
                        "burn":1.6,"drag":0.9,"size":1,"trail":"none","effect":"none","delay":0.6,
                        "a\"b":4,"st\ud800ars":5}]}
            """;
        using var document = JsonDocument.Parse(json);

        var result = CreationDocumentValidator.ValidateShell(document.RootElement);

        Assert.Equal(
            new[] { "[\"a.b\"]", "[\"\"]", "sky[\"x y\"]", "breaks[0][\"a\\\"b\"]", $"breaks[0][\"st{Fffd}ars\"]" }.Order(StringComparer.Ordinal),
            result.Errors.Where(e => e.Code == "unknown-property").Select(e => e.Path).Order(StringComparer.Ordinal));
        Assert.All(result.Errors, e => Assert.Equal("unknown-property", e.Code));
    }

    // ---- regex anchors (§6.5) -----------------------------------------------------------------

    [Theory]
    [InlineData("s1", true)]
    [InlineData("s1\n", false)]   // passes with $ in .NET
    [InlineData("abcdefghijkl", true)]
    [InlineData("abcdefghijklm", false)]
    [InlineData("1s", false)]
    [InlineData("_s", false)]
    public void Key_pattern_is_anchored_with_backslash_z(string key, bool matches) =>
        Assert.Equal(matches, JsonWalk.KeyPattern.IsMatch(key));

    [Fact]
    public void Key_pattern_does_not_match_the_Kelvin_sign()
    {
        Assert.DoesNotMatch(JsonWalk.KeyPattern, ((char)0x212A).ToString() + "1");
    }

    // ---- names (§6.4) -------------------------------------------------------------------------

    [Theory]
    [InlineData(0xFEFF, true)]   // string.Trim() misses it; JS trims it
    [InlineData(0x0085, true)]   // string.Trim() trims it as whitespace; here it is Cc, removed by cleaning
    [InlineData(0x3000, true)]
    [InlineData(0x00A0, true)]
    [InlineData(0x180E, false)]  // Mongolian vowel separator: not in JS's trim set, not Cc
    public void CleanName_trims_exactly_the_JS_set_and_removes_Cc(int codePoint, bool removedAtEdges)
    {
        var edge = ((char)codePoint).ToString();
        var cleaned = CreationDocumentValidator.CleanName(edge + "Peony" + edge);
        Assert.Equal(removedAtEdges ? "Peony" : edge + "Peony" + edge, cleaned);
    }

    [Fact]
    public void CleanName_keeps_interior_whitespace_and_pairs_and_drops_lone_surrogates()
    {
        Assert.Equal("Big  Red", CreationDocumentValidator.CleanName("Big  Red"));
        Assert.Equal("Peony", CreationDocumentValidator.CleanName("Pe" + LoneHigh + "ony"));
        Assert.Equal(Firework, CreationDocumentValidator.CleanName(Firework));
        Assert.Equal("", CreationDocumentValidator.CleanName(LoneLow + LoneHigh));
    }

    [Fact]
    public void Name_length_counts_code_points_not_UTF16_units()
    {
        var eighty = string.Concat(Enumerable.Repeat(Firework, 80));
        Assert.Equal(160, eighty.Length);
        Assert.Equal(80, CreationDocumentValidator.CountCodePoints(eighty));
        Assert.Empty(ValidateName(Quote(eighty)));
        Assert.Equal(["name :: too-long"], ValidateName(Quote(eighty + Firework)));
    }

    [Theory]
    [InlineData("\"Pe\\ud800ony\"", "name :: name-format")]   // GetString throws; the raw fallback keeps the surrogate
    [InlineData("\"\\ud800\"", "name :: missing")]           // blank after cleaning
    [InlineData("\"\\udc00\\ud800\"", "name :: missing")]    // ValueEquals/GetString both throw on this one
    [InlineData("\" Peony\"", "name :: name-format")]
    [InlineData("\"Peony\\u0000\"", "name :: name-format")]  // jsonb would reject \u0000 with a 500
    [InlineData("\"\\u0085Peony\"", "name :: name-format")]
    [InlineData("5", "name :: type")]
    [InlineData("null", "name :: missing")]
    public void Name_pipeline_reports_one_issue_with_the_doc_precedence(string nameJson, string expected) =>
        Assert.Equal([expected], ValidateName(nameJson));

    [Fact]
    public void Lone_surrogate_enum_values_are_enum_errors_not_exceptions()
    {
        var json = Peony.Replace("\"pattern\":\"peony\"", "\"pattern\":\"\\udc00\\ud800\"");
        using var document = JsonDocument.Parse(json);
        var result = CreationDocumentValidator.ValidateShell(document.RootElement);
        Assert.Equal(["breaks[0].pattern :: enum"], result.Errors.Select(e => $"{e.Path} :: {e.Code}"));
    }

    [Fact]
    public void Messages_quoting_user_strings_are_well_formed_unicode()
    {
        // A cue id with a lone surrogate gets key-format, and its message quotes the id: it must
        // still serialize into the 400 body.
        var minimal = SchemaFixtures.LoadDocument("valid/show/minimal").DocumentRawText;
        var show = Regex.Replace(minimal, "\"id\":\\s*\"c1\"", "\"id\":\"c\\ud800\"");
        Assert.NotEqual(minimal, show); // the splice must have happened, or this tests nothing
        using var document = JsonDocument.Parse(show);
        var result = CreationDocumentValidator.ValidateShow(document.RootElement);

        var issue = Assert.Single(result.Errors);
        Assert.Equal(("cues[0].id", "key-format"), (issue.Path, issue.Code));
        Assert.DoesNotContain(issue.Message, char.IsSurrogate);
        Assert.Contains("key-format", JsonSerializer.Serialize(result.Errors));
    }

    // ---- numbers (§6.5) -----------------------------------------------------------------------

    [Theory]
    [InlineData("1e400", "breaks[0].stars :: type")]
    [InlineData("-1e400", "breaks[0].stars :: type")]
    [InlineData("400.4", "breaks[0].stars :: out-of-range")]   // range before integrality
    [InlineData("120.5", "breaks[0].stars :: not-integer")]
    [InlineData("1.2e2", null)]
    [InlineData("120.0", null)]
    public void Integer_fields_are_tested_by_value(string stars, string? expected)
    {
        using var document = JsonDocument.Parse(Peony.Replace("\"stars\":120", $"\"stars\":{stars}"));
        var result = CreationDocumentValidator.ValidateShell(document.RootElement);
        Assert.Equal(expected is null ? [] : [expected], result.Errors.Select(e => $"{e.Path} :: {e.Code}"));
    }

    [Fact]
    public void Range_is_tested_on_the_raw_double()
    {
        using var document = JsonDocument.Parse(Peony.Replace("\"burstHeight\":0.65", "\"burstHeight\":0.8500000000000001"));
        Assert.Equal(["burstHeight :: out-of-range"],
            CreationDocumentValidator.ValidateShell(document.RootElement).Errors.Select(e => $"{e.Path} :: {e.Code}"));
    }

    // ---- palette (§2.2) -----------------------------------------------------------------------

    [Fact]
    public void Shell_palette_is_color1_then_color2_distinct_without_none_with_rainbow()
    {
        var shell = Shell(("rainbow", "none"), ("blue", "rainbow"), ("gold", "blue"));
        Assert.Equal(["rainbow", "blue", "gold"], CreationDocuments.PaletteOf(shell));
    }

    [Fact]
    public void Show_palette_walks_every_embedded_shell_in_ordinal_key_order_and_stops_at_8()
    {
        var show = new Fireworks.Api.Contracts.ShowDocumentDto(1, "Finale", new(160, 0), 10,
            new Dictionary<string, Fireworks.Api.Contracts.ShellDocumentDto>
            {
                // Ordinal: "B" < "a". Insertion order deliberately differs.
                ["a"] = Shell(("red", "orange"), ("gold", "green")),
                ["B"] = Shell(("cyan", "blue"), ("purple", "pink")),
                ["c"] = Shell(("white", "silver"), ("rainbow", "none"))
            },
            []);
        Assert.Equal(["cyan", "blue", "purple", "pink", "red", "orange", "gold", "green"], CreationDocuments.PaletteOf(show));
    }

    // ---- helpers ------------------------------------------------------------------------------

    private const string Peony =
        """{"version":1,"name":"Peony","burstHeight":0.65,"angleJitter":4,"breaks":[{"pattern":"peony","stars":120,"speed":220,"color1":"red","color2":"gold","changeAt":0.65,"burn":1.6,"drag":0.9,"size":1,"trail":"none","effect":"none","delay":0.6}]}""";

    private static string Quote(string value) => JsonSerializer.Serialize(value);

    private static List<string> ValidateName(string nameJson)
    {
        using var document = JsonDocument.Parse(Peony.Replace("\"name\":\"Peony\"", $"\"name\":{nameJson}"));
        return CreationDocumentValidator.ValidateShell(document.RootElement).Errors.Select(e => $"{e.Path} :: {e.Code}").ToList();
    }

    private static Fireworks.Api.Contracts.ShellDocumentDto Shell(params (string Color1, string Color2)[] breaks) =>
        new(1, "s", 0.65, 4, null,
            breaks.Select(b => new Fireworks.Api.Contracts.BreakDto("peony", 120, 220, b.Color1, b.Color2, 0.6, 1.6, 0.9, 1, "none", "none", 0.6)).ToList());
}

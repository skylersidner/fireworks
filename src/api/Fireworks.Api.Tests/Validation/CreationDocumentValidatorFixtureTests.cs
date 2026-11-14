using System.Text.Json;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Validation;

/// <summary>
/// The C# walker against every shared fixture (schema.md §12), with no translation: the validator
/// itself must say <c>("", not-object)</c> for the two root fixtures, as the TS validator does
/// (<c>schema-fixtures.spec.ts</c>). The HTTP harness checks the same set through the envelope.
/// </summary>
public sealed class CreationDocumentValidatorFixtureTests
{
    public static TheoryData<string> DocumentFixtures() => new(SchemaFixtures.DocumentFixtureNames());

    [Fact]
    public void The_fixture_set_is_not_vacuous()
    {
        // A runner that finds nothing passes everything. Each group and kind must be present.
        var names = SchemaFixtures.DocumentFixtureNames();
        foreach (var folder in new[] { "valid/shell/", "valid/show/", "invalid/shell/", "invalid/show/" })
        {
            Assert.Contains(names, name => name.StartsWith(folder, StringComparison.Ordinal));
        }

        Assert.True(names.Count >= 150, $"only {names.Count} document fixtures found");
    }

    [Theory]
    [MemberData(nameof(DocumentFixtures))]
    public void Strict_walk_produces_exactly_the_fixture_multiset(string name)
    {
        var fixture = SchemaFixtures.LoadDocument(name);
        Assert.Equal(name.Split('/')[1], fixture.Kind);

        var actual = Validate(fixture.Kind, fixture.Document, out var canonical);

        Assert.Equal(SchemaFixtures.Ledger(fixture.Errors), SchemaFixtures.Ledger(actual));
        if (fixture.Group == "valid")
        {
            Assert.Empty(fixture.Errors);
            Assert.NotNull(canonical);
            // Valid means no adjustments, so what's stored equals what was sent, as JSON values
            // (`1.0` is `1`); a dropped or renamed field would show up here.
            Assert.True(JsonSemantics.Equal(fixture.DocumentRawText, canonical), $"canonical form differs:\n{canonical}");

            // And the canonical form is itself valid and a fixed point.
            using var again = JsonDocument.Parse(canonical!);
            Assert.Empty(Validate(fixture.Kind, again.RootElement, out var canonicalAgain));
            Assert.Equal(canonical, canonicalAgain);
        }
        else
        {
            Assert.NotEmpty(fixture.Errors);
            Assert.Null(canonical);
        }
    }

    [Fact]
    public void Canonical_output_never_contains_null_and_omits_absent_optionals()
    {
        var minimal = SchemaFixtures.LoadDocument("valid/show/minimal");
        Validate("show", minimal.Document, out var show);
        Assert.DoesNotContain("null", show);
        Assert.DoesNotContain("burstHeight\":null", show);

        var preset = SchemaFixtures.LoadDocument("valid/shell/preset-peony");
        Validate("shell", preset.Document, out var shell);
        Assert.DoesNotContain("\"sky\"", shell);
        Assert.DoesNotContain("null", shell);
    }

    internal static IReadOnlyList<PathCode> Validate(string kind, JsonElement document, out string? canonical)
    {
        if (kind == "shell")
        {
            var shell = CreationDocumentValidator.ValidateShell(document);
            canonical = shell.Document is null ? null : CreationDocuments.Serialize(shell.Document);
            return shell.Errors.Select(e => new PathCode(e.Path, e.Code)).ToList();
        }

        var show = CreationDocumentValidator.ValidateShow(document);
        canonical = show.Document is null ? null : CreationDocuments.Serialize(show.Document);
        return show.Errors.Select(e => new PathCode(e.Path, e.Code)).ToList();
    }
}

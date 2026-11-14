using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Startup;

/// <summary>
/// Rules that live in what the source doesn't contain (plan §3.4; Boo S4, S6, S14, S15, S20, S22),
/// checked over the API's own .cs files. Comments count too, deliberately: these words have no
/// business appearing in code. Comment lines are skipped, because several files explain in prose
/// why a construct is absent.
/// </summary>
public sealed class SourceGuardTests
{
    private static IEnumerable<(string Relative, string Text)> ApiSources() =>
        Directory.GetFiles(RepoPaths.ApiSource, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}"))
            .Select(f => (Path.GetRelativePath(RepoPaths.ApiSource, f).Replace('\\', '/'),
                string.Join('\n', File.ReadAllLines(f).Where(line => !line.TrimStart().StartsWith("//", StringComparison.Ordinal)))));

    [Fact]
    public void Only_the_identity_module_references_the_default_user_options_type()
    {
        var allowed = new[]
        {
            "Program.cs", "Data/FireworksDbInitializer.cs",
            "Services/Identity/DefaultUserOptions.cs", "Services/Identity/DefaultUserCurrentUser.cs",
            "Services/Identity/IdentityRegistration.cs", "Services/Identity/ICurrentUser.cs"
        };
        var offenders = ApiSources().Where(s => s.Text.Contains("DefaultUserOptions") && !allowed.Contains(s.Relative)).Select(s => s.Relative).ToList();
        Assert.Empty(offenders);
        // Positive control: the scan really sees the files that do use it.
        Assert.Contains(ApiSources(), s => s.Relative == "Program.cs" && s.Text.Contains("DefaultUserOptions"));
    }

    [Fact]
    public void Share_codes_come_from_the_CSPRNG_only()
    {
        var generator = ApiSources().Single(s => s.Relative == "Services/Creations/ShareCodeGenerator.cs").Text;
        Assert.Contains("RandomNumberGenerator.GetItems", generator);
        Assert.DoesNotContain("new Random", generator);
        Assert.DoesNotContain("Random.Shared", generator);
        Assert.DoesNotContain("Guid", generator);
    }

    [Theory]
    [InlineData("[Consumes(", "S6: turns a wrong type into 404 behind the catch-all, and admits a missing type")]
    [InlineData(":regex(", "S14: the regex route constraint is case-insensitive")]
    [InlineData("[FromBody]", "S22: the envelope walk is the only parser")]
    [InlineData("UseRequestDecompression", "S4: no zip-bomb path")]
    [InlineData("EnableBuffering", "S3: a body read before MVC disables [RequestSizeLimit]")]
    [InlineData("GlobalLimiter", "S20: a global limiter could catch the health probe")]
    public void Forbidden_constructs_are_absent(string construct, string reason)
    {
        var offenders = ApiSources().Where(s => s.Text.Contains(construct, StringComparison.Ordinal)).Select(s => s.Relative).ToList();
        Assert.True(offenders.Count == 0, $"{construct} in {string.Join(", ", offenders)}: {reason}");
    }
}

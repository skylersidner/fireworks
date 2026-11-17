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

    [Theory]
    [InlineData("DefaultUserId")]
    [InlineData("AllowAnonymousWrites")]
    [InlineData("DefaultUserCurrentUser")]
    [InlineData("DefaultUserOptions")]
    [InlineData("EnsureDefaultUserExists")]
    public void The_interim_default_user_code_path_is_gone(string name)
    {
        // Design §3.5 / Done-when 3. The stale-config guard's message names the old variables on purpose.
        var offenders = ApiSources()
            .Where(s => s.Text.Contains(name, StringComparison.Ordinal) && s.Relative != "Services/Identity/AuthProviderSettings.cs")
            .Select(s => s.Relative).ToList();
        Assert.Empty(offenders);
    }

    [Theory]
    [InlineData("Identity__AllowAnonymousWrites")]
    [InlineData("Identity__DefaultUserId")]
    public void Tools_and_railway_toml_no_longer_set_the_interim_switch(string variable)
    {
        // Boo A34: a stale variable would now stop startup.
        var files = Directory.GetFiles(Path.Combine(RepoPaths.Root, "tools"), "*.*", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}node_modules{Path.DirectorySeparatorChar}") && (f.EndsWith(".mjs") || f.EndsWith(".py") || f.EndsWith(".sh") || f.EndsWith(".json")))
            .Append(Path.Combine(RepoPaths.Root, "railway.toml"))
            .Append(Path.Combine(RepoPaths.Root, "docker-compose.yml"))
            .Where(File.Exists)
            .ToList();
        var offenders = files.Where(f => File.ReadAllText(f).Contains(variable, StringComparison.Ordinal))
            .Select(f => Path.GetRelativePath(RepoPaths.Root, f)).ToList();
        Assert.Empty(offenders);
        Assert.Contains(files, f => f.EndsWith("lib.mjs", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("AddCors")]
    [InlineData("UseCors")]
    public void There_is_no_CORS_policy_in_any_environment(string construct)
    {
        // Boo A14, A17: a CORS policy next to a cookie session is an antiforgery-token trigger.
        Assert.Empty(ApiSources().Where(s => s.Text.Contains(construct, StringComparison.Ordinal)).Select(s => s.Relative));
    }

    [Fact]
    public void The_legacy_default_user_id_appears_only_in_migrations_tests_and_the_README()
    {
        // Boo A24: never in configuration or startup code.
        const string legacy = "6933f933-a9e9-443b-b7c7-6e3e01901a34";
        Assert.Empty(ApiSources().Where(s => s.Text.Contains(legacy, StringComparison.Ordinal)).Select(s => s.Relative));
        foreach (var file in new[] { "appsettings.json", "appsettings.Development.json" })
        {
            Assert.DoesNotContain(legacy, File.ReadAllText(Path.Combine(RepoPaths.ApiSource, file)));
        }
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

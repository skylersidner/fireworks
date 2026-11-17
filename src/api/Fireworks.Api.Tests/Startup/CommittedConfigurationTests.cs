using Fireworks.Api.Services.ClientConfig;
using Fireworks.Api.Services.Identity;
using Microsoft.Extensions.Configuration;

namespace Fireworks.Api.Tests.Startup;

/// <summary>
/// The committed appsettings files are checked as data: no <c>Identity</c> section (Phase 8), no
/// Google client in appsettings.json and only the stub sentinel in Development (Boo A32), no CORS
/// (A14), and appsettings.json carries no connection string, which is what lets Program.cs's
/// <c>?? throw</c> guard fire on a misconfigured deploy. The API project copies both files into
/// this test project's output, so these read the same bytes the app ships.
/// </summary>
public sealed class CommittedConfigurationTests
{
    private static IConfiguration Load(params string[] files)
    {
        var builder = new ConfigurationBuilder().SetBasePath(AppContext.BaseDirectory);
        foreach (var file in files)
        {
            builder.AddJsonFile(file, optional: false);
        }

        return builder.Build();
    }

    [Fact]
    public void Neither_file_has_an_Identity_section_any_more()
    {
        // Program.cs throws on any Identity:* key (Boo A34), so a committed one would brick startup.
        Assert.False(Load("appsettings.json").GetSection("Identity").Exists());
        Assert.False(Load("appsettings.Development.json").GetSection("Identity").Exists());
    }

    [Fact]
    public void Production_appsettings_carry_no_connection_string_no_cors_and_no_Google_client()
    {
        var configuration = Load("appsettings.json");

        Assert.Null(configuration.GetConnectionString("Postgres"));
        Assert.False(configuration.GetSection("Cors").Exists());
        // Boo A32: the client comes from user-secrets or the environment, never this file.
        Assert.False(configuration.GetSection("Auth").Exists());
    }

    [Fact]
    public void Development_appsettings_have_no_cors_and_only_the_stub_sentinel_pair()
    {
        var configuration = Load("appsettings.Development.json");
        var google = configuration.GetSection(GoogleProviderSettings.SectionName);

        Assert.False(configuration.GetSection("Cors").Exists()); // Boo A14
        Assert.Equal(GoogleProviderSettings.StubClientId, google["ClientId"]);
        Assert.Equal(GoogleProviderSettings.StubClientSecret, google["ClientSecret"]);
        Assert.All(new[] { "AuthorizationEndpoint", "TokenEndpoint", "UserInformationEndpoint" },
            key => Assert.StartsWith("http://127.0.0.1:5190/", google[key]));
    }

    [Theory]
    [InlineData("appsettings.json")]
    [InlineData("appsettings.Development.json")]
    public void Microsoft_AspNetCore_logs_at_Warning_or_above(string file)
    {
        // Boo A39: keeps the hosting request line, with the callback's ?code=...&state=..., out of the logs.
        var level = Load(file)["Logging:LogLevel:Microsoft.AspNetCore"];
        Assert.Contains(level, new[] { "Warning", "Error", "Critical", "None" });
    }

    [Fact]
    public void Production_appsettings_carry_all_four_ClientPlayback_values_equal_to_the_class_defaults()
    {
        var section = Load("appsettings.json").GetSection(ClientPlaybackOptions.SectionName);
        var defaults = new ClientPlaybackOptions();

        Assert.Equal(
            ["CatchingUpDelayMs", "CheckpointIntervalSeconds", "CheckpointMemoryMiB", "SeekBudgetMs"],
            section.GetChildren().Select(c => c.Key).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(defaults.SeekBudgetMs.ToString(), section["SeekBudgetMs"]);
        Assert.Equal(defaults.CatchingUpDelayMs.ToString(), section["CatchingUpDelayMs"]);
        Assert.Equal(defaults.CheckpointIntervalSeconds.ToString(), section["CheckpointIntervalSeconds"]);
        Assert.Equal(defaults.CheckpointMemoryMiB.ToString(), section["CheckpointMemoryMiB"]);
    }

    [Fact]
    public void Development_appsettings_do_not_override_ClientPlayback()
    {
        // Brief: the dev values are the production values, so the section lives in one file only.
        Assert.False(Load("appsettings.Development.json").GetSection(ClientPlaybackOptions.SectionName).Exists());
    }
}

/// <summary>
/// Boo A32: no Google client secret is committed anywhere. Google's secrets start with a fixed
/// six-letter prefix and a hyphen (assembled below); this scans every text file under <c>src/</c>, <c>tools/</c> and the repository
/// root, skipping <c>node_modules</c>, <c>bin</c>, <c>obj</c> and build output.
/// </summary>
public sealed class SecretScanTests
{
    private static readonly string[] SkippedDirectories = ["node_modules", "bin", "obj", ".angular", "dist", "wwwroot", "test-results", ".git"];
    private static readonly string[] TextExtensions = [".cs", ".json", ".mjs", ".js", ".ts", ".md", ".toml", ".yml", ".yaml", ".http", ".py", ".sh", ".env", ".html", ".csproj", ".slnx", ""];

    private static IEnumerable<string> Files(string directory, bool recurse)
    {
        foreach (var file in Directory.EnumerateFiles(directory))
        {
            if (TextExtensions.Contains(Path.GetExtension(file)))
            {
                yield return file;
            }
        }

        if (!recurse)
        {
            yield break;
        }

        foreach (var sub in Directory.EnumerateDirectories(directory))
        {
            if (!SkippedDirectories.Contains(Path.GetFileName(sub)))
            {
                foreach (var file in Files(sub, true))
                {
                    yield return file;
                }
            }
        }
    }

    [Fact]
    public void No_Google_client_secret_is_committed()
    {
        // Assembled, so this file doesn't match itself.
        var prefix = "GOCSPX" + "-";
        var scanned = Files(Support.RepoPaths.Root, false)
            .Concat(Files(Path.Combine(Support.RepoPaths.Root, "src"), true))
            .Concat(Files(Path.Combine(Support.RepoPaths.Root, "tools"), true))
            .ToList();

        var offenders = scanned.Where(f => File.ReadAllText(f).Contains(prefix, StringComparison.Ordinal))
            .Select(f => Path.GetRelativePath(Support.RepoPaths.Root, f)).ToList();

        Assert.True(offenders.Count == 0, "Google client secret prefix in: " + string.Join(", ", offenders));
        // Positive control: the scan sees the files that matter.
        Assert.Contains(scanned, f => f.EndsWith("appsettings.Development.json", StringComparison.Ordinal));
        Assert.Contains(scanned, f => f.EndsWith("railway.toml", StringComparison.Ordinal));
        Assert.True(scanned.Count > 200, $"only {scanned.Count} files scanned");
    }
}

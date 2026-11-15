using Fireworks.Api.Services.ClientConfig;
using Fireworks.Api.Services.Identity;
using Microsoft.Extensions.Configuration;

namespace Fireworks.Api.Tests.Startup;

/// <summary>
/// The committed appsettings files are part of two standing decisions, so they are checked as
/// data: production writes are off and Development writes are on (plan §5 OQ20), and
/// appsettings.json carries no connection string or CORS origins, which is what lets Program.cs's
/// <c>?? throw</c> guards fire on a misconfigured deploy. The API project copies both files into
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
    public void Production_appsettings_turn_anonymous_writes_off_and_name_a_valid_default_user()
    {
        var options = IdentityRegistration.ReadDefaultUserOptions(Load("appsettings.json"));

        Assert.False(options.AllowAnonymousWrites);
        Assert.NotEqual(Guid.Empty, options.DefaultUserId);
    }

    [Fact]
    public void Development_appsettings_turn_anonymous_writes_on_for_the_same_default_user()
    {
        var production = IdentityRegistration.ReadDefaultUserOptions(Load("appsettings.json"));
        var development = IdentityRegistration.ReadDefaultUserOptions(
            Load("appsettings.json", "appsettings.Development.json"));

        Assert.True(development.AllowAnonymousWrites);
        Assert.Equal(production.DefaultUserId, development.DefaultUserId);
    }

    [Fact]
    public void Production_appsettings_carry_no_connection_string_or_cors_origins()
    {
        var configuration = Load("appsettings.json");

        Assert.Null(configuration.GetConnectionString("Postgres"));
        Assert.False(configuration.GetSection("Cors").Exists());
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

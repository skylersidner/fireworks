using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Startup;

/// <summary>
/// The real Program.cs refuses to start on an out-of-range <c>ClientPlayback</c> value set the way
/// Railway sets it (an environment variable), and refuses <b>before the database</b>: the
/// connection string points at a closed port, so seeing the ClientPlayback message and no Npgsql
/// means the check ran first. The control sets in-range overrides and the same process gets past
/// the check to the database.
/// </summary>
public sealed class ClientConfigStartupTests
{
    private static readonly TimeSpan ExitTimeout = TimeSpan.FromSeconds(60);

    private const string UnreachablePostgres = "Host=127.0.0.1;Port=1;Database=none;Username=none;Password=none;Timeout=2";

    private static Dictionary<string, string> Environment(params (string Key, string Value)[] playback)
    {
        var environment = new Dictionary<string, string>
        {
            ["ASPNETCORE_ENVIRONMENT"] = "Production",
            ["ASPNETCORE_URLS"] = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}",
            ["ConnectionStrings__Postgres"] = UnreachablePostgres
        };
        foreach (var (key, value) in TestIdentity.ProductionGoogleEnvironment)
        {
            environment[key] = value;
        }

        foreach (var (key, value) in playback)
        {
            environment[$"ClientPlayback__{key}"] = value;
        }

        return environment;
    }

    [Theory]
    [InlineData("SeekBudgetMs", "200")]
    [InlineData("SeekBudgetMs", "0")]
    [InlineData("CatchingUpDelayMs", "6000")]
    [InlineData("CheckpointIntervalSeconds", "0")]
    [InlineData("CheckpointMemoryMiB", "1024")]
    public async Task Startup_fails_fast_on_an_out_of_range_value_from_the_environment(string key, string value)
    {
        await using var api = ApiProcess.Start(Environment((key, value)));

        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.Contains($"ClientPlayback:{key} must be between", api.Output);
        Assert.DoesNotContain("Npgsql", api.Output);
    }

    [Fact]
    public async Task Startup_fails_fast_on_a_non_integer_value_naming_the_key()
    {
        await using var api = ApiProcess.Start(Environment(("SeekBudgetMs", "fast")));

        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.Contains("ClientPlayback:SeekBudgetMs", api.Output);
        Assert.DoesNotContain("Npgsql", api.Output);
    }

    [Fact]
    public async Task Control_in_range_overrides_get_past_the_check_and_fail_on_the_database()
    {
        await using var api = ApiProcess.Start(Environment(
            ("SeekBudgetMs", "100"), ("CatchingUpDelayMs", "0"), ("CheckpointIntervalSeconds", "60"), ("CheckpointMemoryMiB", "8")));

        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.DoesNotContain("ClientPlayback", api.Output);
        Assert.Contains("Npgsql", api.Output);
    }
}

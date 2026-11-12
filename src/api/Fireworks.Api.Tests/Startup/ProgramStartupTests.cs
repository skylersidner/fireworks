using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Startup;

/// <summary>
/// The real Program.cs refuses to start on a missing or invalid <c>Identity:DefaultUserId</c>, and
/// refuses <b>before touching the database</b> (plan Phase 1a). The connection string points at a
/// closed loopback port, so the only way to reach the identity message is for the identity guard
/// to run first; the control test shows what the same process prints when identity is valid and
/// the database is what fails.
/// </summary>
public sealed class ProgramStartupTests
{
    private static readonly TimeSpan ExitTimeout = TimeSpan.FromSeconds(60);

    // Port 1 on loopback: nothing listens there, so a connection attempt is refused at once.
    private const string UnreachablePostgres = "Host=127.0.0.1;Port=1;Database=none;Username=none;Password=none;Timeout=2";

    private static Dictionary<string, string> Environment(string? defaultUserId) => new()
    {
        ["ASPNETCORE_ENVIRONMENT"] = "Production",
        ["ASPNETCORE_URLS"] = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}",
        ["ConnectionStrings__Postgres"] = UnreachablePostgres,
        // An empty value overrides the id committed in appsettings.json, which is how "missing" is
        // expressed through the environment (Railway included).
        ["Identity__DefaultUserId"] = defaultUserId ?? ""
    };

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task Startup_fails_fast_on_a_missing_or_invalid_DefaultUserId(string? defaultUserId)
    {
        await using var api = ApiProcess.Start(Environment(defaultUserId));

        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.Contains("Identity:DefaultUserId", api.Output);
        // Never got as far as the database.
        Assert.DoesNotContain("Npgsql", api.Output);
    }

    [Fact]
    public async Task Control_with_a_valid_DefaultUserId_startup_gets_past_identity_and_fails_on_the_database()
    {
        await using var api = ApiProcess.Start(Environment(TestIdentity.UserId.ToString()));

        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.DoesNotContain("Identity:DefaultUserId", api.Output);
        Assert.Contains("Npgsql", api.Output);
    }

    [Fact]
    public async Task Startup_fails_fast_when_the_connection_string_is_missing()
    {
        var environment = Environment(TestIdentity.UserId.ToString());
        environment.Remove("ConnectionStrings__Postgres");
        await using var api = ApiProcess.Start(environment);

        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.Contains("ConnectionStrings:Postgres must be configured.", api.Output);
    }
}

using Fireworks.Api.Services.Identity;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Startup;

/// <summary>
/// The real Program.cs refuses to start on bad sign-in configuration, and refuses <b>before the
/// database</b> (Boo A32–A35): the connection string points at a closed loopback port, so seeing
/// the auth message and no Npgsql means the auth guard ran first. The controls show what the same
/// process prints when the auth configuration is acceptable and the database is what fails.
/// </summary>
public sealed class ProgramStartupTests
{
    private static readonly TimeSpan ExitTimeout = TimeSpan.FromSeconds(60);

    // Port 1 on loopback: nothing listens there, so a connection attempt is refused at once.
    private const string UnreachablePostgres = "Host=127.0.0.1;Port=1;Database=none;Username=none;Password=none;Timeout=2";

    private const string Secret = "a-secret-value-that-must-never-be-printed";

    private static Dictionary<string, string> Environment(string environment = "Production", bool google = true)
    {
        var values = new Dictionary<string, string>
        {
            ["ASPNETCORE_ENVIRONMENT"] = environment,
            ["ASPNETCORE_URLS"] = $"http://127.0.0.1:{ApiProcess.FreeLoopbackPort()}",
            ["ConnectionStrings__Postgres"] = UnreachablePostgres
        };
        if (google)
        {
            values["Auth__Providers__Google__ClientId"] = "test-client.apps.googleusercontent.example";
            values["Auth__Providers__Google__ClientSecret"] = Secret;
        }

        return values;
    }

    private static async Task<ApiProcess> RunToExitAsync(Dictionary<string, string> environment)
    {
        var api = ApiProcess.Start(environment);
        await api.WaitForExitAsync(ExitTimeout);
        return api;
    }

    private static async Task AssertRefusedBeforeDatabase(Dictionary<string, string> environment, string expected)
    {
        await using var api = ApiProcess.Start(environment);
        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.Contains(expected, api.Output);
        Assert.DoesNotContain("Npgsql", api.Output);
        // Keys are named, values never (Boo A32).
        Assert.DoesNotContain(Secret, api.Output);
    }

    private static async Task AssertGetsToTheDatabase(Dictionary<string, string> environment)
    {
        await using var api = ApiProcess.Start(environment);
        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.DoesNotContain("Auth:Providers", api.Output);
        Assert.Contains("Npgsql", api.Output);
        Assert.DoesNotContain(Secret, api.Output);
    }

    [Theory]
    [InlineData("AuthorizationEndpoint")]
    [InlineData("TokenEndpoint")]
    [InlineData("UserInformationEndpoint")]
    public async Task Production_refuses_any_stub_endpoint_override(string key)
    {
        var environment = Environment();
        environment[$"Auth__Providers__Google__{key}"] = "http://127.0.0.1:5190/x";
        await AssertRefusedBeforeDatabase(environment, $"Auth:Providers:Google:{key} is a stub override");
    }

    [Fact]
    public async Task Production_refuses_a_missing_client_id_or_secret()
    {
        await AssertRefusedBeforeDatabase(Environment(google: false), "Auth:Providers:Google:ClientId must be configured.");

        var noSecret = Environment();
        noSecret["Auth__Providers__Google__ClientSecret"] = " ";
        await AssertRefusedBeforeDatabase(noSecret, "Auth:Providers:Google:ClientSecret must be configured.");
    }

    [Theory]
    [InlineData("ClientId", GoogleProviderSettings.StubClientId)]
    [InlineData("ClientSecret", GoogleProviderSettings.StubClientSecret)]
    public async Task Production_refuses_the_stub_placeholders(string key, string value)
    {
        var environment = Environment();
        environment[$"Auth__Providers__Google__{key}"] = value;
        await AssertRefusedBeforeDatabase(environment, "are the stub placeholders");
    }

    [Fact]
    public async Task Control_production_with_a_non_placeholder_client_gets_past_auth_to_the_database() =>
        await AssertGetsToTheDatabase(Environment());

    [Fact]
    public async Task Control_testing_honours_stub_overrides_and_logs_the_stub_warning()
    {
        var environment = Environment("Testing");
        environment["Auth__Providers__Google__ClientId"] = GoogleProviderSettings.StubClientId;
        environment["Auth__Providers__Google__ClientSecret"] = GoogleProviderSettings.StubClientSecret;
        environment["Auth__Providers__Google__AuthorizationEndpoint"] = "http://127.0.0.1:5190/authorize";
        await using var api = await RunToExitAsync(environment);

        Assert.Contains("Sign-in uses stub OAuth endpoints (127.0.0.1:5190)", api.Output);
        Assert.Contains("Npgsql", api.Output);
    }

    [Fact]
    public async Task Control_without_overrides_there_is_no_stub_warning()
    {
        await using var api = await RunToExitAsync(Environment("Testing"));
        Assert.DoesNotContain("stub OAuth endpoints", api.Output);
        Assert.Contains("Npgsql", api.Output);
    }

    [Theory]
    [InlineData("Identity__DefaultUserId", "6933f933-a9e9-443b-b7c7-6e3e01901a34")]
    [InlineData("Identity__AllowAnonymousWrites", "true")]
    [InlineData("Identity__AllowAnonymousWrites", "")]
    public async Task Any_leftover_Identity_key_stops_startup(string key, string value)
    {
        var environment = Environment();
        environment[key] = value;
        await AssertRefusedBeforeDatabase(environment, "Identity:* was removed in Phase 8");
    }

    [Fact]
    public async Task Startup_fails_fast_when_the_connection_string_is_missing()
    {
        var environment = Environment();
        environment.Remove("ConnectionStrings__Postgres");
        await using var api = ApiProcess.Start(environment);

        var exitCode = await api.WaitForExitAsync(ExitTimeout);

        Assert.NotEqual(0, exitCode);
        Assert.Contains("ConnectionStrings:Postgres must be configured.", api.Output);
    }
}

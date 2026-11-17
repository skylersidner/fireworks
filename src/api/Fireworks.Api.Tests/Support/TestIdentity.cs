namespace Fireworks.Api.Tests.Support;

internal static class TestIdentity
{
    /// <summary>The stub subjects the two-account suites sign in as (Boo A22).</summary>
    public const string Alice = "alice-sub-1001";
    public const string Bob = "bob-sub-2002";

    /// <summary>The subject the harness's default signed-in <c>Client</c> uses.</summary>
    public const string Owner = "owner-sub-0001";

    /// <summary>
    /// The pre-Phase 8 default user's id, committed until Phase 8 and still the owner of legacy rows in
    /// local databases (design §4). Seeded only by tests; no code path resolves to it (Boo A23).
    /// </summary>
    public static readonly Guid LegacyDefaultUserId = Guid.Parse("6933f933-a9e9-443b-b7c7-6e3e01901a34");

    /// <summary>
    /// A non-sentinel Google client for real-Program child processes in Production (Boo A33: the
    /// stub pair and a missing client both refuse to start). Not a credential.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> ProductionGoogleEnvironment = new Dictionary<string, string>
    {
        ["Auth__Providers__Google__ClientId"] = "test-client.apps.googleusercontent.example",
        ["Auth__Providers__Google__ClientSecret"] = "test-secret-not-a-real-one"
    };
}

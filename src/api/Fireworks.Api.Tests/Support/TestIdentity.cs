using Fireworks.Api.Services.Identity;

namespace Fireworks.Api.Tests.Support;

internal static class TestIdentity
{
    /// <summary>Deliberately NOT the id committed in appsettings.json, so a test that passes
    /// cannot be reading the committed value by accident.</summary>
    public static readonly Guid UserId = Guid.Parse("0b6c1f0e-3d7a-4c55-9a51-2f8e7d4c9a10");

    public static DefaultUserOptions Options(bool allowAnonymousWrites = false) =>
        new() { DefaultUserId = UserId, AllowAnonymousWrites = allowAnonymousWrites };

    public static Dictionary<string, string?> Configuration(bool allowAnonymousWrites = false) => new()
    {
        ["Identity:DefaultUserId"] = UserId.ToString(),
        ["Identity:AllowAnonymousWrites"] = allowAnonymousWrites ? "true" : "false"
    };
}

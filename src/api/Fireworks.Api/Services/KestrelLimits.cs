using Microsoft.AspNetCore.Server.Kestrel.Core;

namespace Fireworks.Api.Services;

/// <summary>
/// Kestrel's global request-body limit: 64 KiB instead of the 30 MB default (Boo S2). No endpoint
/// but the three creation writes reads a body, and those raise it to 256 KiB with
/// <c>[RequestSizeLimit]</c>, so this is defense in depth for every future endpoint. 64 KiB still
/// fits a Phase 8 OIDC <c>form_post</c> callback. Program.cs and the harnesses both call this.
/// </summary>
public static class KestrelLimits
{
    public const long GlobalMaxRequestBodyBytes = 65_536;

    public static void Apply(KestrelServerOptions options) =>
        options.Limits.MaxRequestBodySize = GlobalMaxRequestBodyBytes;
}

using Microsoft.Extensions.Options;

namespace Fireworks.Api.Services.Identity;

/// <summary>
/// The interim <see cref="ICurrentUser"/>: every request acts as the configured default user, and
/// may write only when <see cref="DefaultUserOptions.AllowAnonymousWrites"/> is on.
/// </summary>
public sealed class DefaultUserCurrentUser(IOptions<DefaultUserOptions> options) : ICurrentUser
{
    private readonly DefaultUserOptions defaultUserOptions = options.Value;

    public Guid? UserId => defaultUserOptions.DefaultUserId;

    public bool IsAuthenticated => false;

    public bool CanWrite => defaultUserOptions.AllowAnonymousWrites;
}

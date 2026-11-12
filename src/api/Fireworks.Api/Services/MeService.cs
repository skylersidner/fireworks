using Fireworks.Api.Contracts;
using Fireworks.Api.Repositories;
using Fireworks.Api.Services.Identity;

namespace Fireworks.Api.Services;

public interface IMeService
{
    Task<ServiceResult<MeResponse>> GetCurrentUserAsync(CancellationToken cancellationToken);
}

public sealed class MeService(ICurrentUser currentUser, IUserRepository userRepository) : IMeService
{
    public async Task<ServiceResult<MeResponse>> GetCurrentUserAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            // Nobody signed in. Unreachable until Phase 8, but already a valid answer, not an error.
            return ServiceResult<MeResponse>.Success(
                new MeResponse(null, null, currentUser.IsAuthenticated, currentUser.CanWrite));
        }

        var user = await userRepository.FindByIdAsync(userId, cancellationToken);
        if (user is null)
        {
            // The initializer inserts the default user before the app listens, so this means the
            // row was deleted underneath a running app (or, after Phase 8, a claim names a user
            // with no row). Report it rather than invent a display name.
            return ServiceResult<MeResponse>.NotFound($"User {userId} does not exist.");
        }

        return ServiceResult<MeResponse>.Success(
            new MeResponse(user.Id, user.DisplayName, currentUser.IsAuthenticated, currentUser.CanWrite));
    }
}

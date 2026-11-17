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
    /// <summary>Always 200. Anonymous is a valid answer, not an error (schema.md §2.8).</summary>
    public async Task<ServiceResult<MeResponse>> GetCurrentUserAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return ServiceResult<MeResponse>.Success(MeResponse.Anonymous);
        }

        // OnValidatePrincipal already turned a cookie without a row into anonymous (Boo A12); a row
        // deleted between that check and this read answers the same way, never a 404.
        var user = await userRepository.FindByIdAsync(userId, cancellationToken);
        return ServiceResult<MeResponse>.Success(user is null
            ? MeResponse.Anonymous
            : new MeResponse(user.Id, user.DisplayName, currentUser.IsAuthenticated, currentUser.CanWrite, user.ExternalProvider));
    }
}

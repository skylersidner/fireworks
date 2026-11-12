using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Repositories;

public interface IUserRepository
{
    /// <summary>The user with this id, or <c>null</c> when there is no such row. Read-only (not tracked).</summary>
    Task<User?> FindByIdAsync(Guid id, CancellationToken cancellationToken);
}

public sealed class UserRepository(FireworksDbContext dbContext) : IUserRepository
{
    public Task<User?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        dbContext.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == id, cancellationToken);
}

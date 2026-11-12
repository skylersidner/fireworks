namespace Fireworks.Api.Data.Entities;

/// <summary>
/// Rows whose <c>created_at</c> / <c>updated_at</c> are stamped by
/// <see cref="FireworksDbContext"/>'s <c>SaveChanges</c> overrides. Nothing else writes them.
/// </summary>
public interface ITimestamped
{
    DateTimeOffset CreatedAt { get; set; }
    DateTimeOffset UpdatedAt { get; set; }
}

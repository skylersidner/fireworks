namespace Fireworks.Api.Data.Entities;

/// <summary>
/// The owner of persisted data (plan §3.4). Until the Phase 8 auth pass there is exactly one row,
/// the configured default user, inserted by <see cref="FireworksDbInitializer"/>.
///
/// <para>
/// Phase 8 adds <c>external_provider</c> / <c>external_subject</c> columns here (nullable, with a
/// unique index over the pair) in its own migration. Nothing in this table is keyed on them yet,
/// so adding them changes no existing row or foreign key.
/// </para>
/// </summary>
public sealed class User : ITimestamped
{
    public const int DisplayNameMaxLength = 80;

    public Guid Id { get; init; }
    public required string DisplayName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

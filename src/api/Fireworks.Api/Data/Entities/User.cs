namespace Fireworks.Api.Data.Entities;

/// <summary>
/// The owner of persisted data (plan §3.4). From Phase 8 a row is provisioned on a user's first
/// Google sign-in (<c>UserProvisioning</c>) and found again by <c>(external_provider,
/// external_subject)</c>, which are unique together and both set or both null (a check
/// constraint). The pre-Phase 8 default user's row, where it exists, has neither, so no sign-in can
/// ever resolve to it: its creations are read-only legacy (design §4).
///
/// <para>
/// Only these columns are stored (Boo A38): no email, picture, locale or tokens.
/// </para>
/// </summary>
public sealed class User : ITimestamped
{
    public const int DisplayNameMaxLength = 80;
    public const int ExternalProviderMaxLength = 32;
    public const int ExternalSubjectMaxLength = 255;

    public Guid Id { get; init; }
    public required string DisplayName { get; set; }

    /// <summary><c>"google"</c> for every provisioned row; null only on the legacy default user's row.</summary>
    public string? ExternalProvider { get; init; }

    /// <summary>The provider's stable subject (Google's <c>sub</c>, probe P7). Never logged (A39).</summary>
    public string? ExternalSubject { get; init; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

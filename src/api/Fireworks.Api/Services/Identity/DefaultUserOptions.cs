namespace Fireworks.Api.Services.Identity;

/// <summary>
/// The <c>Identity</c> configuration section (plan §3.4). Read and validated once, at startup, by
/// <see cref="IdentityRegistration.AddFireworksIdentity"/>; a missing or invalid
/// value stops the app before it touches the database.
///
/// <para>
/// Only <see cref="ICurrentUser"/> implementations read this. Controllers and services ask
/// <see cref="ICurrentUser"/> and never see configuration (plan §3.4).
/// </para>
///
/// <para>
/// Named for what it configures, the interim default user, rather than <c>IdentityOptions</c>,
/// which would shadow <c>Microsoft.AspNetCore.Identity.IdentityOptions</c>. Both members exist only
/// for the pre-auth identity, so Phase 8 deletes this type whole. The config section stays
/// <c>Identity</c>, so the env var names (<c>Identity__DefaultUserId</c>,
/// <c>Identity__AllowAnonymousWrites</c>) are unchanged.
/// </para>
/// </summary>
public sealed record DefaultUserOptions
{
    public const string SectionName = "Identity";

    /// <summary>The user every request acts as until the Phase 8 auth pass. Never <see cref="Guid.Empty"/>.</summary>
    public required Guid DefaultUserId { get; init; }

    /// <summary>
    /// Whether the interim default user may write. <c>false</c> in appsettings.json (production),
    /// <c>true</c> in appsettings.Development.json, and switched on in Railway only while testing
    /// via <c>Identity__AllowAnonymousWrites=true</c> (decided, plan §5 OQ20).
    /// </summary>
    public bool AllowAnonymousWrites { get; init; }
}

using Fireworks.Api.Data;
using Fireworks.Api.Data.Entities;
using Fireworks.Api.Services.Creations;
using Microsoft.EntityFrameworkCore;

namespace Fireworks.Api.Services.Identity;

public interface IUserProvisioning
{
    /// <summary>
    /// The <c>users.id</c> for this external identity: found by <c>(provider, subject)</c>, or
    /// inserted on first sign-in. Refreshes the stored display name when the provider's changed.
    /// </summary>
    Task<Guid> ResolveAsync(string provider, string subject, string? displayName, CancellationToken cancellationToken);
}

/// <summary>
/// Maps an external identity to a row (design §3.3). Called from the Google handler's
/// <c>OnCreatingTicket</c>, before the session cookie exists.
///
/// <list type="bullet">
/// <item><b>Only by <c>(provider, subject)</c>, both non-null</b> (Boo A23): never a display-name
/// match, the first row or a configured id, so the legacy default user's row (neither column set)
/// is unreachable by construction.</item>
/// <item><b>Stores only provider, subject and display name</b> (Boo A38).</item>
/// <item><b>Race:</b> two first sign-ins at once both miss and both insert; the loser's insert fails
/// on the unique index, and it re-checks the desired state (the row now exists) rather than a
/// vendor error code (<c>boo-race-guards-check-desired-state.md</c>).</item>
/// <item><b>Logs <c>users.id</c> only</b> (Boo A39), never the subject or the name.</item>
/// </list>
/// </summary>
public sealed class UserProvisioning(FireworksDbContext dbContext, ILogger<UserProvisioning> logger) : IUserProvisioning
{
    /// <summary>A provider name that cleans to nothing (schema.md §6.4 pipeline) is stored as this.</summary>
    public const string BlankDisplayName = "User";

    public async Task<Guid> ResolveAsync(string provider, string subject, string? displayName, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(provider);
        ArgumentException.ThrowIfNullOrEmpty(subject);
        var name = CleanDisplayName(displayName);

        var existing = await dbContext.Users
            .SingleOrDefaultAsync(u => u.ExternalProvider == provider && u.ExternalSubject == subject, cancellationToken);
        if (existing is not null)
        {
            if (!string.Equals(existing.DisplayName, name, StringComparison.Ordinal))
            {
                existing.DisplayName = name;
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            return existing.Id;
        }

        var user = new User
        {
            Id = Guid.CreateVersion7(),
            DisplayName = name,
            ExternalProvider = provider,
            ExternalSubject = subject
        };
        dbContext.Users.Add(user);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Provisioned user {UserId} on first sign-in.", user.Id);
            return user.Id;
        }
        catch (DbUpdateException)
        {
            dbContext.Entry(user).State = EntityState.Detached;
            var winner = await dbContext.Users.AsNoTracking()
                .Where(u => u.ExternalProvider == provider && u.ExternalSubject == subject)
                .Select(u => (Guid?)u.Id)
                .SingleOrDefaultAsync(cancellationToken);
            return winner ?? throw new InvalidOperationException("Provisioning failed and no row exists for this identity.");
        }
    }

    /// <summary>
    /// schema.md §6.4's name pipeline (strip Cc and lone surrogates, trim), cut at
    /// <see cref="User.DisplayNameMaxLength"/> code points; blank becomes <see cref="BlankDisplayName"/>.
    /// </summary>
    public static string CleanDisplayName(string? raw)
    {
        var cleaned = CreationDocumentValidator.CleanName(raw ?? "");
        if (CreationDocumentValidator.CountCodePoints(cleaned) > User.DisplayNameMaxLength)
        {
            cleaned = string.Concat(cleaned.EnumerateRunes().Take(User.DisplayNameMaxLength).Select(r => r.ToString()))
                .TrimEnd();
        }

        return cleaned.Length == 0 ? BlankDisplayName : cleaned;
    }
}

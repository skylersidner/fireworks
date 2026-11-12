using Microsoft.Extensions.Options;

namespace Fireworks.Api.Services.Identity;

/// <summary>
/// Not named <c>IdentityServiceCollectionExtensions</c>: the shared framework already has a public
/// class by that name in <c>Microsoft.Extensions.DependencyInjection</c>, which every file imports
/// implicitly, so a bare reference to ours would be ambiguous (CS0433).
/// </summary>
public static class IdentityRegistration
{
    /// <summary>
    /// Reads and validates the <c>Identity</c> section <b>now</b>, while the host is being built,
    /// and registers it plus the interim <see cref="ICurrentUser"/>.
    ///
    /// <para>
    /// Eager on purpose. <c>ValidateOnStart()</c> would only fire inside <c>app.Run()</c>, after
    /// <c>FireworksDbInitializer</c> has already migrated the database and seeded a user from a
    /// value nobody checked. Throwing here stops the process before it opens a connection, the same
    /// way the <c>ConnectionStrings:Postgres ?? throw</c> guard does.
    /// </para>
    ///
    /// <para>
    /// Program.cs and the test harnesses both call this, so a test host binds identity exactly the
    /// way the app does.
    /// </para>
    /// </summary>
    public static IServiceCollection AddFireworksIdentity(this IServiceCollection services, IConfiguration configuration)
    {
        var defaultUserOptions = ReadDefaultUserOptions(configuration);

        services.AddSingleton(Options.Create(defaultUserOptions));
        services.AddScoped<ICurrentUser, DefaultUserCurrentUser>();
        return services;
    }

    /// <summary>
    /// Throws <see cref="InvalidOperationException"/> naming the offending key when
    /// <c>Identity:DefaultUserId</c> is missing, blank, not a GUID, or the empty GUID, or when
    /// <c>Identity:AllowAnonymousWrites</c> is present but not a boolean. A missing
    /// <c>AllowAnonymousWrites</c> means <c>false</c>: writes fail closed.
    /// </summary>
    public static DefaultUserOptions ReadDefaultUserOptions(IConfiguration configuration)
    {
        var section = configuration.GetSection(DefaultUserOptions.SectionName);

        var rawUserId = section["DefaultUserId"];
        if (string.IsNullOrWhiteSpace(rawUserId))
        {
            throw new InvalidOperationException("Identity:DefaultUserId must be configured.");
        }

        if (!Guid.TryParse(rawUserId, out var defaultUserId) || defaultUserId == Guid.Empty)
        {
            throw new InvalidOperationException(
                $"Identity:DefaultUserId must be a non-empty GUID; got '{rawUserId}'.");
        }

        var rawAllowWrites = section["AllowAnonymousWrites"];
        var allowAnonymousWrites = false;
        if (!string.IsNullOrWhiteSpace(rawAllowWrites) && !bool.TryParse(rawAllowWrites, out allowAnonymousWrites))
        {
            throw new InvalidOperationException(
                $"Identity:AllowAnonymousWrites must be true or false; got '{rawAllowWrites}'.");
        }

        return new DefaultUserOptions
        {
            DefaultUserId = defaultUserId,
            AllowAnonymousWrites = allowAnonymousWrites
        };
    }
}

using Microsoft.Extensions.Options;

namespace Fireworks.Api.Services.ClientConfig;

public static class ClientConfigRegistration
{
    /// <summary>
    /// Binds <c>ClientPlayback</c> as <see cref="IOptions{TOptions}"/> with data-annotation
    /// validation and <c>ValidateOnStart()</c>, and also runs that same validation <b>now</b>,
    /// while the host is being built.
    ///
    /// <para>
    /// Both, on purpose. <c>ValidateOnStart()</c> alone fires inside <c>app.Run()</c>, after
    /// Program.cs step 12 has migrated the database, so a typo in a tuning knob would surface as a
    /// migration (or, with the database down, an Npgsql error) instead of its own message. The
    /// eager check is the same <see cref="DataAnnotationValidateOptions{TOptions}"/> the options
    /// pipeline uses, so the two cannot disagree; it throws the same
    /// <see cref="OptionsValidationException"/>. This is the Identity section's "fail before the
    /// database" rule (<c>AddFireworksIdentity</c>), kept with the annotation-based validator.
    /// </para>
    ///
    /// <para>Program.cs and the test harness both call this.</para>
    /// </summary>
    public static IServiceCollection AddFireworksClientConfig(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(ClientPlaybackOptions.SectionName);

        // A non-integer value ("abc") throws here from the binder, naming the key.
        var eager = section.Get<ClientPlaybackOptions>() ?? new ClientPlaybackOptions();
        var result = new DataAnnotationValidateOptions<ClientPlaybackOptions>(Options.DefaultName)
            .Validate(Options.DefaultName, eager);
        if (result.Failed)
        {
            throw new OptionsValidationException(Options.DefaultName, typeof(ClientPlaybackOptions), result.Failures);
        }

        services.AddOptions<ClientPlaybackOptions>()
            .Bind(section)
            .ValidateDataAnnotations()
            .ValidateOnStart();
        return services;
    }
}

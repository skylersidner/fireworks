using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Fireworks.Api.Services;

/// <summary>
/// MVC for the API, registered once. Program.cs and the test harness both call this, so a test
/// host binds exactly what the app binds.
///
/// <para>
/// <b>No form value providers</b> (Boo, Phase 4 verification F1). MVC's form, form-file and jQuery
/// form providers read and parse a <c>multipart/form-data</c> or urlencoded body during model
/// binding, before the action runs, and so before the service's <c>CanWrite</c> gate. With them, a
/// form-typed body got MVC's 400 ("Failed to read the request form", or "Request body too large"
/// over 64 KiB) where the contract says 403 (writes off) or 415 (S3, S6, S8), on every action that
/// binds a parameter, <c>GET api/me</c> included. No action binds from a form. A future endpoint
/// that needs one opts in on that endpoint alone, with its own gate test.
/// </para>
/// </summary>
public static class ControllersRegistration
{
    public static IMvcBuilder AddFireworksControllers(this IServiceCollection services) =>
        services
            .AddControllers(options =>
            {
                options.ValueProviderFactories.RemoveType<FormValueProviderFactory>();
                options.ValueProviderFactories.RemoveType<FormFileValueProviderFactory>();
                options.ValueProviderFactories.RemoveType<JQueryFormValueProviderFactory>();
            })
            // The controllers live in this assembly. Program.cs finds it as the entry assembly; a
            // test host's entry assembly is the test runner, so it is added here, once.
            .ConfigureApplicationPartManager(manager =>
            {
                var api = typeof(ControllersRegistration).Assembly;
                if (!manager.ApplicationParts.OfType<AssemblyPart>().Any(p => p.Assembly == api))
                {
                    manager.ApplicationParts.Add(new AssemblyPart(api));
                }
            });
}

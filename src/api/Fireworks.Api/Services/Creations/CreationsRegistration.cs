using Fireworks.Api.Repositories;

namespace Fireworks.Api.Services.Creations;

/// <summary>
/// Everything the creation endpoints need, registered once. Program.cs and the test harnesses both
/// call this, so a test host binds exactly what the app binds (the route constraint included:
/// without it, <c>{shareCode:sharecode}</c> throws at startup).
/// </summary>
public static class CreationsRegistration
{
    public static IServiceCollection AddFireworksCreations(this IServiceCollection services)
    {
        services.AddScoped<ICreationRepository, CreationRepository>();
        services.AddScoped<ICreationService, CreationService>();
        services.AddSingleton<IShareCodeGenerator, ShareCodeGenerator>();
        services.Configure<RouteOptions>(options =>
            options.SetParameterPolicy<ShareCodeRouteConstraint>(ShareCodeRouteConstraint.Name));
        return services;
    }
}

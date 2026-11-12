using Fireworks.Api.Services.Identity;
using Fireworks.Api.Tests.Support;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Fireworks.Api.Tests.Services;

/// <summary>
/// Plan Phase 1a: "the service resolves the configured ID, and startup fails fast if
/// DefaultUserId is missing or invalid". The fail-fast half is also proven against the real
/// Program.cs in <c>ProgramStartupTests</c>; these pin the rules themselves.
/// </summary>
public sealed class IdentityConfigurationTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [Fact]
    public void ICurrentUser_resolves_the_configured_default_user_id()
    {
        var services = new ServiceCollection();
        services.AddFireworksIdentity(Config(TestIdentity.Configuration(allowAnonymousWrites: true)));
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });

        using var scope = provider.CreateScope();
        var currentUser = scope.ServiceProvider.GetRequiredService<ICurrentUser>();

        Assert.IsType<DefaultUserCurrentUser>(currentUser);
        Assert.Equal(TestIdentity.UserId, currentUser.UserId);
        Assert.False(currentUser.IsAuthenticated);
        Assert.True(currentUser.CanWrite);
    }

    [Fact]
    public void ICurrentUser_is_scoped_one_instance_per_request()
    {
        var services = new ServiceCollection();
        services.AddFireworksIdentity(Config(TestIdentity.Configuration()));
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });

        using var first = provider.CreateScope();
        using var second = provider.CreateScope();

        Assert.Same(first.ServiceProvider.GetRequiredService<ICurrentUser>(), first.ServiceProvider.GetRequiredService<ICurrentUser>());
        Assert.NotSame(first.ServiceProvider.GetRequiredService<ICurrentUser>(), second.ServiceProvider.GetRequiredService<ICurrentUser>());
        // Resolving a scoped service from the root throws under ValidateScopes, which is what
        // proves the registration is Scoped rather than Singleton or Transient.
        Assert.Throws<InvalidOperationException>(() => provider.GetRequiredService<ICurrentUser>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void A_missing_or_invalid_DefaultUserId_throws_naming_the_key(string? value)
    {
        var values = new Dictionary<string, string?> { ["Identity:AllowAnonymousWrites"] = "false" };
        if (value is not null)
        {
            values["Identity:DefaultUserId"] = value;
        }

        var services = new ServiceCollection();
        var exception = Assert.Throws<InvalidOperationException>(() => services.AddFireworksIdentity(Config(values)));

        Assert.Contains("Identity:DefaultUserId", exception.Message);
        // Thrown while registering, i.e. before anything could be resolved or a database opened.
        Assert.Empty(services);
    }

    [Fact]
    public void A_missing_AllowAnonymousWrites_means_writes_are_off()
    {
        var options = IdentityRegistration.ReadDefaultUserOptions(Config(new()
        {
            ["Identity:DefaultUserId"] = TestIdentity.UserId.ToString()
        }));

        Assert.False(options.AllowAnonymousWrites);
    }

    [Fact]
    public void A_non_boolean_AllowAnonymousWrites_throws_rather_than_guessing()
    {
        var exception = Assert.Throws<InvalidOperationException>(() =>
            IdentityRegistration.ReadDefaultUserOptions(Config(new()
            {
                ["Identity:DefaultUserId"] = TestIdentity.UserId.ToString(),
                ["Identity:AllowAnonymousWrites"] = "yes"
            })));

        Assert.Contains("Identity:AllowAnonymousWrites", exception.Message);
    }
}

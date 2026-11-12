using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Fireworks.Api.Data;

/// <summary>
/// Used only by <c>dotnet ef</c> (migrations add / database update). It reads the same
/// appsettings files the app does, so run the tool from the project directory; the connection
/// string comes from appsettings.Development.json or <c>ConnectionStrings__Postgres</c>.
/// </summary>
public sealed class FireworksDbContextFactory : IDesignTimeDbContextFactory<FireworksDbContext>
{
    public FireworksDbContext CreateDbContext(string[] args)
    {
        var environmentName = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development";
        var basePath = Directory.GetCurrentDirectory();

        var configuration = new ConfigurationBuilder()
            .SetBasePath(basePath)
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile($"appsettings.{environmentName}.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString = configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("ConnectionStrings:Postgres must be configured.");

        var optionsBuilder = new DbContextOptionsBuilder<FireworksDbContext>();
        optionsBuilder.UseNpgsql(connectionString);

        return new FireworksDbContext(optionsBuilder.Options);
    }
}

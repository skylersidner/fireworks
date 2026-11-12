namespace Fireworks.Api.Tests.Data;

/// <summary>
/// Every <see cref="PostgresFactAttribute"/>-gated test points at the one database
/// <c>FIREWORKS_TEST_POSTGRES</c> names, and each test drops and recreates it. xunit runs test
/// classes in parallel by default, so two Postgres-gated classes racing their own
/// <c>EnsureDeletedAsync</c>/<c>MigrateAsync</c> pairs would corrupt each other's schema. Every
/// such class joins this collection, which xunit runs sequentially.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class PostgresCollection
{
    public const string Name = "Postgres tests";
}

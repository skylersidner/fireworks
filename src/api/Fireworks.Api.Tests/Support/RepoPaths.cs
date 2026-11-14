namespace Fireworks.Api.Tests.Support;

/// <summary>
/// The repository root, found by walking up from the test output folder to the directory that
/// holds <c>Fireworks.slnx</c>. The shared schema fixtures (<c>schema/</c>) are read from there, in
/// place, never copied into the output: a copy could go stale against the source of truth.
/// </summary>
internal static class RepoPaths
{
    public static string Root { get; } = FindRoot();

    public static string Schema => Path.Combine(Root, "schema");

    public static string Fixtures => Path.Combine(Schema, "fixtures");

    public static string ApiSource => Path.Combine(Root, "src", "api", "Fireworks.Api");

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Fireworks.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException($"No Fireworks.slnx above {AppContext.BaseDirectory}.");
    }
}

namespace Fireworks.Api.Tests.Support;

/// <summary>
/// A throwaway wwwroot holding an <c>index.html</c> with a known marker. Without it the SPA
/// fallback has no file to serve and answers 404 itself, which would make "/api/nope is 404"
/// pass even with the <c>/api/{**rest}</c> guard deleted.
/// </summary>
internal sealed class TempWebRoot : IDisposable
{
    public const string IndexMarker = "<!-- fireworks-test-index -->";

    public string Path { get; }

    public TempWebRoot()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "fireworks-webroot-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
        File.WriteAllText(System.IO.Path.Combine(Path, "index.html"),
            $"<!doctype html><html><body>{IndexMarker}</body></html>");
    }

    public void Dispose()
    {
        try { Directory.Delete(Path, recursive: true); } catch (IOException) { }
    }
}

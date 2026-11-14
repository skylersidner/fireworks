using System.Text;
using System.Text.Json;

namespace Fireworks.Api.Tests.Support;

/// <summary>One <c>(path, code)</c> pair, the contract part of an issue (schema.md §2.4).</summary>
internal readonly record struct PathCode(string Path, string Code)
{
    public override string ToString() => $"{Path} :: {Code}";
}

/// <summary>A <c>valid/</c> or <c>invalid/</c> fixture: <c>{ description, kind, document, errors? }</c>.</summary>
internal sealed record DocumentFixture(string Name, string Group, string Kind, JsonElement Document, string DocumentRawText, IReadOnlyList<PathCode> Errors);

/// <summary>A <c>server-only/</c> fixture: <c>{ description, body, status, errors?, contentType?, byteMarkers? }</c>.</summary>
internal sealed record ServerOnlyFixture(string Name, byte[] Body, string ContentType, int Status, IReadOnlyList<PathCode> Errors);

/// <summary>
/// Reads <c>schema/fixtures/**</c> as <c>schema/README.md</c> ("The C# harness (Phase 4)") says:
/// documents are taken as their raw text (<c>GetRawText()</c>, never re-serialized, which would lose
/// <c>1.0</c>, <c>1e2</c>, <c>1e400</c> and the own <c>__proto__</c> key); server-only bodies are
/// sent as their bytes, with <c>byteMarkers</c> replaced by raw bytes.
/// </summary>
internal static class SchemaFixtures
{
    /// <summary>Every document fixture name, e.g. <c>invalid/shell/stars-401</c>, from the folders themselves.</summary>
    public static IReadOnlyList<string> DocumentFixtureNames() =>
        new[] { "valid/shell", "valid/show", "invalid/shell", "invalid/show" }
            .SelectMany(folder => Directory.GetFiles(Path.Combine(RepoPaths.Fixtures, folder), "*.json")
                .Select(file => $"{folder}/{Path.GetFileNameWithoutExtension(file)}"))
            .Order(StringComparer.Ordinal)
            .ToList();

    public static IReadOnlyList<string> ServerOnlyFixtureNames() =>
        Directory.GetFiles(Path.Combine(RepoPaths.Fixtures, "server-only"), "*.json")
            .Select(Path.GetFileNameWithoutExtension)
            .Order(StringComparer.Ordinal)
            .ToList()!;

    public static DocumentFixture LoadDocument(string name)
    {
        using var file = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RepoPaths.Fixtures, name + ".json")));
        var root = file.RootElement;
        var document = root.GetProperty("document");
        var errors = root.TryGetProperty("errors", out var rawErrors) ? ReadErrors(rawErrors) : [];
        return new DocumentFixture(
            name,
            name.StartsWith("valid/", StringComparison.Ordinal) ? "valid" : "invalid",
            root.GetProperty("kind").GetString()!,
            document.Clone(),
            document.GetRawText(),
            errors);
    }

    public static ServerOnlyFixture LoadServerOnly(string name)
    {
        using var file = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RepoPaths.Fixtures, "server-only", name + ".json")));
        var root = file.RootElement;
        var body = Encoding.UTF8.GetBytes(root.GetProperty("body").GetString()!);
        if (root.TryGetProperty("byteMarkers", out var markers))
        {
            foreach (var marker in markers.EnumerateObject())
            {
                body = Replace(body, Encoding.UTF8.GetBytes(marker.Name), Convert.FromHexString(marker.Value.GetString()!));
            }
        }

        var contentType = root.TryGetProperty("contentType", out var type) ? type.GetString()! : "application/json";
        var errors = root.TryGetProperty("errors", out var rawErrors) ? ReadErrors(rawErrors) : [];
        return new ServerOnlyFixture(name, body, contentType, root.GetProperty("status").GetInt32(), errors);
    }

    public static IReadOnlyList<PathCode> ReadErrors(JsonElement errors) =>
        errors.EnumerateArray()
            .Select(e => new PathCode(e.GetProperty("path").GetString()!, e.GetProperty("code").GetString()!))
            .ToList();

    /// <summary>The complete multiset as a sorted list, for an exact comparison (nothing missing, nothing extra).</summary>
    public static IReadOnlyList<string> Ledger(IEnumerable<PathCode> issues) =>
        issues.Select(i => i.ToString()).Order(StringComparer.Ordinal).ToList();

    private static byte[] Replace(byte[] source, byte[] marker, byte[] replacement)
    {
        var index = source.AsSpan().IndexOf(marker);
        if (index < 0 || source.AsSpan(index + marker.Length).IndexOf(marker) >= 0)
        {
            throw new InvalidOperationException("A byte marker must occur exactly once in its body.");
        }

        return [.. source.AsSpan(0, index), .. replacement, .. source.AsSpan(index + marker.Length)];
    }
}

using System.Text.Json;

namespace Fireworks.Api.Tests.Support;

/// <summary>
/// JSON equality as values, not bytes (schema.md §1): key order means nothing (Postgres jsonb
/// reorders keys, SQLite TEXT doesn't), numbers compare by double value (<c>1.0</c> equals <c>1</c>),
/// array order matters.
/// </summary>
internal static class JsonSemantics
{
    public static bool Equal(JsonElement a, JsonElement b)
    {
        if (a.ValueKind != b.ValueKind)
        {
            return false;
        }

        switch (a.ValueKind)
        {
            case JsonValueKind.Object:
                var left = a.EnumerateObject().ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal);
                var right = b.EnumerateObject().ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal);
                return left.Count == right.Count
                       && left.All(entry => right.TryGetValue(entry.Key, out var other) && Equal(entry.Value, other));
            case JsonValueKind.Array:
                return a.GetArrayLength() == b.GetArrayLength()
                       && a.EnumerateArray().Zip(b.EnumerateArray()).All(pair => Equal(pair.First, pair.Second));
            case JsonValueKind.Number:
                return a.GetDouble() == b.GetDouble();
            case JsonValueKind.String:
                return string.Equals(a.GetString(), b.GetString(), StringComparison.Ordinal);
            default:
                return true; // true, false, null
        }
    }

    public static bool Equal(string a, string b)
    {
        using var left = JsonDocument.Parse(a);
        using var right = JsonDocument.Parse(b);
        return Equal(left.RootElement, right.RootElement);
    }
}

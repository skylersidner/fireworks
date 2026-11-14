using System.Text.Json;
using System.Text.Json.Serialization;
using Fireworks.Api.Contracts;

namespace Fireworks.Api.Services.Creations;

/// <summary>
/// What the server stores and derives from a validated document (schema.md §2.2, §6.5): the
/// canonical JSON, and the write-time columns.
/// </summary>
public static class CreationDocuments
{
    /// <summary>
    /// camelCase, nulls omitted (an absent shell <c>sky</c> or cue <c>burstHeight</c> stays absent;
    /// a stored document never contains null). Dictionary keys (<c>shells</c>) are written as given.
    /// Doubles are written in shortest round-trip form. STJ's default escaping of non-ASCII and of
    /// <c>&lt;</c> is accepted by <c>jsonb</c> (measured).
    /// </summary>
    private static readonly JsonSerializerOptions CanonicalOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static string Serialize(ShellDocumentDto shell) => JsonSerializer.Serialize(shell, CanonicalOptions);

    public static string Serialize(ShowDocumentDto show) => JsonSerializer.Serialize(show, CanonicalOptions);

    /// <summary>
    /// The swatch colors for <c>CreationListItem</c>: breaks in order, <c>color1</c> then
    /// <c>color2</c>, distinct, first occurrence wins, <c>none</c> excluded, <c>rainbow</c> kept,
    /// at most 8 (schema.md §2.2).
    /// </summary>
    public static List<string> PaletteOf(ShellDocumentDto shell) => PaletteOf([shell]);

    /// <summary>The same rule over every embedded shell, used or not, in ordinal key order.</summary>
    public static List<string> PaletteOf(ShowDocumentDto show) =>
        PaletteOf(show.Shells.OrderBy(entry => entry.Key, StringComparer.Ordinal).Select(entry => entry.Value));

    private static List<string> PaletteOf(IEnumerable<ShellDocumentDto> shells)
    {
        var palette = new List<string>(CreationLimits.MaxPaletteEntries);
        foreach (var shellBreak in shells.SelectMany(shell => shell.Breaks))
        {
            foreach (var color in (ReadOnlySpan<string>)[shellBreak.Color1, shellBreak.Color2])
            {
                if (palette.Count == CreationLimits.MaxPaletteEntries)
                {
                    return palette;
                }

                if (color != "none" && !palette.Contains(color))
                {
                    palette.Add(color);
                }
            }
        }

        return palette;
    }
}

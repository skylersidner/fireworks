namespace Fireworks.Api.Services.Creations;

/// <summary>A numeric range; <see cref="Integer"/> fields are tested for integrality by value.</summary>
public sealed record NumericLimit(double Min, double Max, bool Integer = false);

/// <summary>
/// The C# copy of the schema.md §5.1 table. <c>limits.ts</c> is the source of truth; this file,
/// the doc table and <c>schema/limits.json</c> are mirrors, and <c>CreationLimitsTests</c> checks
/// that <see cref="Table"/> deep-equals <c>limits.json</c> (§5.2). Changing a limit is a schema
/// change: update all four together.
///
/// <para>
/// Nothing at runtime reads <c>limits.json</c>: these constants are compiled in, which is why the
/// Docker build context can exclude <c>schema/</c> (§6.6).
/// </para>
/// </summary>
public static class CreationLimits
{
    public static readonly NumericLimit ShellBurstHeight = new(0.3, 0.85);
    public static readonly NumericLimit ShellAngleJitter = new(0, 20);
    public static readonly NumericLimit BreakStars = new(4, 400, Integer: true);
    public static readonly NumericLimit BreakSpeed = new(60, 400);
    public static readonly NumericLimit BreakChangeAt = new(0.1, 0.95);
    public static readonly NumericLimit BreakBurn = new(0.3, 5);
    public static readonly NumericLimit BreakDrag = new(0, 4);
    public static readonly NumericLimit BreakSize = new(0.4, 3);
    public static readonly NumericLimit BreakDelay = new(0.1, 2.5);
    public static readonly NumericLimit SkyGravity = new(40, 400);
    public static readonly NumericLimit SkyWind = new(-80, 80);
    public static readonly NumericLimit ShellNameCodePoints = new(1, 80, Integer: true);
    public static readonly NumericLimit ShellBreaksCount = new(1, 4, Integer: true);
    public static readonly NumericLimit ShowDuration = new(1, 600);
    public static readonly NumericLimit ShowShellsCount = new(0, 32, Integer: true);
    public static readonly NumericLimit ShowCuesCount = new(1, 1000, Integer: true);

    /// <summary>
    /// <c>cue.t</c>'s maximum is the show's own <c>duration</c> when that is valid, otherwise
    /// <see cref="ShowDuration"/>'s maximum (schema.md §6.2 rule 8). <see cref="CueT"/> carries
    /// that fallback; <c>limits.json</c> writes the max as the string below.
    /// </summary>
    public static readonly NumericLimit CueT = new(0, ShowDuration.Max);
    public const string CueTMaxReference = "show.duration";

    public static readonly NumericLimit CueX = new(0, 1);
    public static readonly NumericLimit CueBurstHeight = new(0.3, 0.85);
    public static readonly NumericLimit CueSeed = new(int.MinValue, int.MaxValue, Integer: true);

    /// <summary>
    /// The rows of schema.md §5.1 under their <c>limits.json</c> keys, for the drift test. A row
    /// whose max is a reference rather than a number has <c>MaxReference</c> set.
    /// </summary>
    public static IReadOnlyDictionary<string, (NumericLimit Limit, string? MaxReference)> Table { get; } =
        new Dictionary<string, (NumericLimit, string?)>(StringComparer.Ordinal)
        {
            ["shell.burstHeight"] = (ShellBurstHeight, null),
            ["shell.angleJitter"] = (ShellAngleJitter, null),
            ["break.stars"] = (BreakStars, null),
            ["break.speed"] = (BreakSpeed, null),
            ["break.changeAt"] = (BreakChangeAt, null),
            ["break.burn"] = (BreakBurn, null),
            ["break.drag"] = (BreakDrag, null),
            ["break.size"] = (BreakSize, null),
            ["break.delay"] = (BreakDelay, null),
            ["sky.gravity"] = (SkyGravity, null),
            ["sky.wind"] = (SkyWind, null),
            ["shell.name.codePoints"] = (ShellNameCodePoints, null),
            ["shell.breaks.count"] = (ShellBreaksCount, null),
            ["show.duration"] = (ShowDuration, null),
            ["show.shells.count"] = (ShowShellsCount, null),
            ["show.cues.count"] = (ShowCuesCount, null),
            ["cue.t"] = (CueT, CueTMaxReference),
            ["cue.x"] = (CueX, null),
            ["cue.burstHeight"] = (CueBurstHeight, null),
            ["cue.seed"] = (CueSeed, null)
        };

    /// <summary>The supported document version of each kind (schema.md §8.1).</summary>
    public const int ShellVersion = 1;
    public const int ShowVersion = 1;

    /// <summary>A blank name saves as this (schema.md §6.4, Skyler Q5). Clients send it; the server only checks.</summary>
    public const string FallbackName = "Custom";

    /// <summary>The 256 KiB request limit on creation writes (schema.md §2.5).</summary>
    public const int MaxRequestBytes = 262_144;

    /// <summary>At most this many swatch colors per list card (schema.md §2.2).</summary>
    public const int MaxPaletteEntries = 8;
}

using System.Globalization;
using System.Text;
using System.Text.Json;
using Fireworks.Api.Contracts;

namespace Fireworks.Api.Services.Creations;

/// <summary>
/// The outcome of a strict walk: every issue (never only the first), and the canonical DTO only
/// when there are none.
/// </summary>
public sealed record CreationValidationResult<T>(IReadOnlyList<ValidationIssue> Errors, T? Document) where T : class
{
    public bool IsValid => Errors.Count == 0;
}

/// <summary>
/// Strict validation of ShellDocument v1 and ShowDocument v1 over a <see cref="JsonElement"/>
/// (schema.md §6). It must produce exactly the same <c>(path, code)</c> multiset as the TS
/// <c>validateShell</c>/<c>validateShow</c> (<c>engine/model/validate.ts</c>, which is the lenient
/// <c>normalize.ts</c> walk plus "zero adjustments") for every shared fixture, so the walk order and
/// the skip rules mirror <c>normalize.ts</c> one for one (§6.2), plus the two server-only checks:
/// duplicate keys (rule 12) and the surrogate-safe reads (§6.5).
///
/// <para>
/// <b>No lenient mode, and no rounding anywhere.</b> The server never adjusts a document, so C#'s
/// banker's <c>Math.Round</c> can never disagree with JS <c>Math.round</c>. If anyone ever adds a
/// lenient mode here, that is the first trap.
/// </para>
///
/// <para>
/// Source kept ASCII on purpose (the trim set is built from code points).
/// </para>
/// </summary>
public static class CreationDocumentValidator
{
    private static readonly string[] Patterns = ["peony", "ring", "palm", "heart"];
    private static readonly string[] PaletteColors = ["red", "orange", "gold", "green", "cyan", "blue", "purple", "pink", "white", "silver"];
    private static readonly string[] Color1Options = [.. PaletteColors, "rainbow"];
    private static readonly string[] Color2Options = ["none", .. PaletteColors];
    private static readonly string[] Trails = ["none", "tail", "glitter"];
    private static readonly string[] Effects = ["none", "crackle", "crossette", "strobe"];

    private static readonly string[] ShellKeys = ["version", "name", "burstHeight", "angleJitter", "sky", "breaks"];
    /// <summary>An embedded shell has no <c>sky</c> (§4.1): one there is an unknown property, and its value isn't walked.</summary>
    private static readonly string[] EmbeddedShellKeys = ["version", "name", "burstHeight", "angleJitter", "breaks"];
    private static readonly string[] SkyKeys = ["gravity", "wind"];
    private static readonly string[] BreakKeys = ["pattern", "stars", "speed", "color1", "color2", "changeAt", "burn", "drag", "size", "trail", "effect", "delay"];
    private static readonly string[] ShowKeys = ["version", "name", "sky", "duration", "shells", "cues"];
    private static readonly string[] CueKeys = ["id", "t", "shell", "x", "burstHeight", "seed"];

    /// <summary>
    /// JS <c>String.prototype.trim</c>'s set, exactly (schema.md §6.4): U+0009-000D, U+0020, U+00A0,
    /// U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Not <c>string.Trim()</c>,
    /// which misses U+FEFF and adds U+0085.
    /// </summary>
    private static readonly char[] JsTrimSet = new[]
    {
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
        0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF
    }.Select(code => (char)code).ToArray();

    public static CreationValidationResult<ShellDocumentDto> ValidateShell(JsonElement root)
    {
        var issues = new IssueList();
        var shell = WalkShell(root, "", ShellKeys, issues);
        return new(issues.Items, issues.Count == 0 ? shell : null);
    }

    public static CreationValidationResult<ShowDocumentDto> ValidateShow(JsonElement root)
    {
        var issues = new IssueList();
        var show = WalkShow(root, issues);
        return new(issues.Items, issues.Count == 0 ? show : null);
    }

    // ---- show (normalizeShow) -----------------------------------------------------------------

    private static ShowDocumentDto? WalkShow(JsonElement root, IssueList issues)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            issues.Add("", "not-object", "the show must be a JSON object.");
            return null;
        }

        var o = JsonWalk.ReadObject(root, "", ShowKeys, issues);
        ReadVersion(o, "", CreationLimits.ShowVersion, issues);
        var name = ReadName(o, "", issues);

        SkyDto? sky = null;
        if (IsAbsent(o, "sky", out var rawSky))
        {
            issues.Add("sky", "missing", "required in a show.");
        }
        else if (rawSky.ValueKind != JsonValueKind.Object)
        {
            issues.Add("sky", "not-object", "must be an object.");
        }
        else
        {
            sky = WalkSky(rawSky, "sky", issues);
        }

        var duration = ReadNumber(o, "duration", "", CreationLimits.ShowDuration, issues);

        // Rule 7. `shellKeys` is the set of keys that passed key-format, whether or not their
        // embedded shell is valid or even an object (rule 8); null when `shells` wasn't walked,
        // and then no cue is checked for unknown-shell.
        HashSet<string>? shellKeys = null;
        var shells = new Dictionary<string, ShellDocumentDto>(StringComparer.Ordinal);
        if (IsAbsent(o, "shells", out var rawShells))
        {
            issues.Add("shells", "missing", "required in a show.");
        }
        else if (rawShells.ValueKind != JsonValueKind.Object)
        {
            issues.Add("shells", "not-object", "must be an object.");
        }
        else
        {
            // Distinct keys, as Object.keys(JSON.parse(...)) counts them. A shells with shell-count
            // isn't read, so its duplicates aren't reported either (rule 12).
            var count = JsonWalk.DistinctNameCount(rawShells);
            if (count > CreationLimits.ShowShellsCount.Max)
            {
                issues.Add("shells", "shell-count", $"at most {CreationLimits.ShowShellsCount.Max} shells (got {count}).");
            }
            else
            {
                shellKeys = new HashSet<string>(StringComparer.Ordinal);
                foreach (var (key, rawShell) in JsonWalk.ReadObject(rawShells, "shells", known: null, issues))
                {
                    if (!JsonWalk.KeyPattern.IsMatch(key))
                    {
                        issues.Add("shells", "key-format", $"bad key {Quote(key)}.");
                        continue;
                    }

                    shellKeys.Add(key);
                    var shell = WalkShell(rawShell, JsonWalk.ChildPath("shells", key), EmbeddedShellKeys, issues);
                    if (shell is not null)
                    {
                        shells[key] = shell;
                    }
                }
            }
        }

        var cues = new List<CueDto>();
        if (!o.TryGetValue("cues", out var rawCues)
            || rawCues.ValueKind != JsonValueKind.Array
            || rawCues.GetArrayLength() < CreationLimits.ShowCuesCount.Min
            || rawCues.GetArrayLength() > CreationLimits.ShowCuesCount.Max)
        {
            // Absent, null, not an array, empty or too long: one cue-count, no cue walked (rule 7).
            issues.Add("cues", "cue-count",
                $"needs an array of {CreationLimits.ShowCuesCount.Min} to {CreationLimits.ShowCuesCount.Max} cues.");
        }
        else
        {
            // Rule 8: t's upper bound is duration only when duration itself is valid.
            var tLimit = CreationLimits.CueT with { Max = duration ?? CreationLimits.CueT.Max };
            var seenIds = new HashSet<string>(StringComparer.Ordinal);
            var index = 0;
            foreach (var rawCue in rawCues.EnumerateArray())
            {
                var cue = WalkCue(rawCue, JsonWalk.IndexPath("cues", index++), tLimit, shellKeys, seenIds, issues);
                if (cue is not null)
                {
                    cues.Add(cue);
                }
            }
        }

        if (issues.Count > 0 || name is null || sky is null || duration is null)
        {
            return null;
        }

        return new ShowDocumentDto(CreationLimits.ShowVersion, name, sky, duration.Value, shells, cues);
    }

    private static CueDto? WalkCue(
        JsonElement raw,
        string path,
        NumericLimit tLimit,
        HashSet<string>? shellKeys,
        HashSet<string> seenIds,
        IssueList issues)
    {
        if (raw.ValueKind != JsonValueKind.Object)
        {
            issues.Add(path, "not-object", "must be an object.");
            return null;
        }

        var c = JsonWalk.ReadObject(raw, path, CueKeys, issues);

        // id: missing, type, key-format, then duplicate-id at the second and later occurrences. An
        // id that failed any of the first three joins no set (rule 8).
        var id = ReadRequiredString(c, "id", path, issues);
        if (id is not null)
        {
            var idPath = JsonWalk.ChildPath(path, "id");
            if (!JsonWalk.KeyPattern.IsMatch(id))
            {
                issues.Add(idPath, "key-format", $"bad id {Quote(id)}.");
                id = null;
            }
            else if (!seenIds.Add(id))
            {
                issues.Add(idPath, "duplicate-id", $"{Quote(id)} is already used by an earlier cue.");
            }
        }

        var t = ReadNumber(c, "t", path, tLimit, issues);

        // shell: membership is the only test; no key-format of its own (rule 8).
        var shell = ReadRequiredString(c, "shell", path, issues);
        if (shell is not null && shellKeys is not null && !shellKeys.Contains(shell))
        {
            issues.Add(JsonWalk.ChildPath(path, "shell"), "unknown-shell", $"{Quote(shell)} isn't a key of shells.");
        }

        var x = ReadNumber(c, "x", path, CreationLimits.CueX, issues);

        // Optional: absent stays absent; null is `missing` (rule 13, the one null rule).
        double? burstHeight = null;
        if (c.TryGetValue("burstHeight", out var rawBurst))
        {
            burstHeight = rawBurst.ValueKind == JsonValueKind.Null
                ? Missing(JsonWalk.ChildPath(path, "burstHeight"), "null is never stored; omit burstHeight instead.", issues)
                : ReadNumber(c, "burstHeight", path, CreationLimits.CueBurstHeight, issues);
        }

        // int32, never adjusted; same order as any number: missing, type, out-of-range, not-integer.
        var seed = ReadNumber(c, "seed", path, CreationLimits.CueSeed, issues);

        return id is null || t is null || shell is null || x is null || seed is null
            ? null
            : new CueDto(id, t.Value, shell, x.Value, burstHeight, (int)seed.Value);
    }

    // ---- shell (walkShell) --------------------------------------------------------------------

    /// <summary>
    /// The shell walk, for a shell document (root, <c>""</c>, with <c>sky</c>) and for a show's
    /// embedded shell (<c>shells.&lt;key&gt;</c>, without <c>sky</c>).
    /// </summary>
    private static ShellDocumentDto? WalkShell(JsonElement raw, string path, string[] keys, IssueList issues)
    {
        if (raw.ValueKind != JsonValueKind.Object)
        {
            issues.Add(path, "not-object", path.Length == 0 ? "the shell must be a JSON object." : "must be an object.");
            return null;
        }

        var o = JsonWalk.ReadObject(raw, path, keys, issues);
        ReadVersion(o, path, CreationLimits.ShellVersion, issues);
        var name = ReadName(o, path, issues);
        var burstHeight = ReadNumber(o, "burstHeight", path, CreationLimits.ShellBurstHeight, issues);
        var angleJitter = ReadNumber(o, "angleJitter", path, CreationLimits.ShellAngleJitter, issues);

        SkyDto? sky = null;
        if (keys.Contains("sky") && o.TryGetValue("sky", out var rawSky))
        {
            var skyPath = JsonWalk.ChildPath(path, "sky");
            if (rawSky.ValueKind == JsonValueKind.Null)
            {
                // Optional, so absent is valid; null reads as absent, but a stored document never
                // holds null, so strict mode reports it (rule 13).
                issues.Add(skyPath, "missing", "null is never stored; omit sky instead.");
            }
            else if (rawSky.ValueKind != JsonValueKind.Object)
            {
                issues.Add(skyPath, "not-object", "must be an object.");
            }
            else
            {
                sky = WalkSky(rawSky, skyPath, issues);
            }
        }

        // Rule 4: missing, null, not an array, empty or more than 4: one break-count, no break walked.
        var breaksPath = JsonWalk.ChildPath(path, "breaks");
        if (!o.TryGetValue("breaks", out var rawBreaks)
            || rawBreaks.ValueKind != JsonValueKind.Array
            || rawBreaks.GetArrayLength() < CreationLimits.ShellBreaksCount.Min
            || rawBreaks.GetArrayLength() > CreationLimits.ShellBreaksCount.Max)
        {
            issues.Add(breaksPath, "break-count",
                $"needs an array of {CreationLimits.ShellBreaksCount.Min} to {CreationLimits.ShellBreaksCount.Max} breaks.");
            return null;
        }

        var breaks = new List<BreakDto>();
        var index = 0;
        foreach (var rawBreak in rawBreaks.EnumerateArray())
        {
            var breakPath = JsonWalk.IndexPath(breaksPath, index++);
            if (rawBreak.ValueKind != JsonValueKind.Object)
            {
                issues.Add(breakPath, "not-object", "must be an object.");
                continue;
            }

            var b = JsonWalk.ReadObject(rawBreak, breakPath, BreakKeys, issues);
            var pattern = ReadEnum(b, "pattern", breakPath, Patterns, issues);
            var stars = ReadNumber(b, "stars", breakPath, CreationLimits.BreakStars, issues);
            var speed = ReadNumber(b, "speed", breakPath, CreationLimits.BreakSpeed, issues);
            var color1 = ReadEnum(b, "color1", breakPath, Color1Options, issues);
            var color2 = ReadEnum(b, "color2", breakPath, Color2Options, issues);
            var changeAt = ReadNumber(b, "changeAt", breakPath, CreationLimits.BreakChangeAt, issues);
            var burn = ReadNumber(b, "burn", breakPath, CreationLimits.BreakBurn, issues);
            var drag = ReadNumber(b, "drag", breakPath, CreationLimits.BreakDrag, issues);
            var size = ReadNumber(b, "size", breakPath, CreationLimits.BreakSize, issues);
            var trail = ReadEnum(b, "trail", breakPath, Trails, issues);
            var effect = ReadEnum(b, "effect", breakPath, Effects, issues);
            var delay = ReadNumber(b, "delay", breakPath, CreationLimits.BreakDelay, issues);

            if (pattern is not null && stars is not null && speed is not null && color1 is not null
                && color2 is not null && changeAt is not null && burn is not null && drag is not null
                && size is not null && trail is not null && effect is not null && delay is not null)
            {
                breaks.Add(new BreakDto(pattern, (int)stars.Value, speed.Value, color1, color2, changeAt.Value,
                    burn.Value, drag.Value, size.Value, trail, effect, delay.Value));
            }
        }

        return name is null || burstHeight is null || angleJitter is null
            ? null
            : new ShellDocumentDto(CreationLimits.ShellVersion, name, burstHeight.Value, angleJitter.Value, sky, breaks);
    }

    private static SkyDto? WalkSky(JsonElement raw, string path, IssueList issues)
    {
        var o = JsonWalk.ReadObject(raw, path, SkyKeys, issues);
        var gravity = ReadNumber(o, "gravity", path, CreationLimits.SkyGravity, issues);
        var wind = ReadNumber(o, "wind", path, CreationLimits.SkyWind, issues);
        return gravity is null || wind is null ? null : new SkyDto(gravity.Value, wind.Value);
    }

    // ---- fields -------------------------------------------------------------------------------

    /// <summary>Absent or null is <c>missing</c>; anything other than the number 1 is <c>version</c> (rule 3, §8.1).</summary>
    private static void ReadVersion(Dictionary<string, JsonElement> o, string path, int current, IssueList issues)
    {
        var versionPath = JsonWalk.ChildPath(path, "version");
        if (IsAbsent(o, "version", out var value))
        {
            issues.Add(versionPath, "missing", "required.");
            return;
        }

        // By value: 1, 1.0 and 1e0 are version 1; "1", true and 1.5 are not.
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && number == current)
        {
            return;
        }

        issues.Add(versionPath, "version", $"unsupported version {Echo(value.GetRawText())} (expected {current}).");
    }

    /// <summary>
    /// One issue at most, in this order: <c>missing</c>, <c>type</c> (including non-finite),
    /// <c>out-of-range</c> (on the raw value), <c>not-integer</c>. Returns the value only when it
    /// passed.
    /// </summary>
    private static double? ReadNumber(Dictionary<string, JsonElement> o, string key, string path, NumericLimit limit, IssueList issues)
    {
        var fieldPath = JsonWalk.ChildPath(path, key);
        if (IsAbsent(o, key, out var value))
        {
            return Missing(fieldPath, "required.", issues);
        }

        // TryGetDouble returns TRUE with +Infinity for 1e400 on .NET 11 (measured), so finiteness
        // is checked separately. Never TryGetInt32: it rejects 1.0, 1e2 and 1293847.0.
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number))
        {
            issues.Add(fieldPath, "type", limit.Integer ? "must be an integer." : "must be a finite number.");
            return null;
        }

        if (number < limit.Min || number > limit.Max)
        {
            issues.Add(fieldPath, "out-of-range",
                $"{Echo(value.GetRawText())} is outside {Format(limit.Min)}..{Format(limit.Max)}.");
            return null;
        }

        if (limit.Integer && number != Math.Floor(number))
        {
            issues.Add(fieldPath, "not-integer", $"{Echo(value.GetRawText())} isn't an integer.");
            return null;
        }

        return number;
    }

    private static string? ReadEnum(Dictionary<string, JsonElement> o, string key, string path, string[] options, IssueList issues)
    {
        var fieldPath = JsonWalk.ChildPath(path, key);
        if (IsAbsent(o, key, out var value))
        {
            Missing(fieldPath, "required.", issues);
            return null;
        }

        if (value.ValueKind == JsonValueKind.String)
        {
            foreach (var option in options)
            {
                if (JsonWalk.SafeValueEquals(value, option))
                {
                    return option;
                }
            }
        }

        // A non-string is `enum` too, not `type` (normalize.ts oneOf).
        issues.Add(fieldPath, "enum", $"unknown value {Echo(value.GetRawText())} (expected one of {string.Join(", ", options)}).");
        return null;
    }

    private static string? ReadRequiredString(Dictionary<string, JsonElement> o, string key, string path, IssueList issues)
    {
        var fieldPath = JsonWalk.ChildPath(path, key);
        if (IsAbsent(o, key, out var value))
        {
            Missing(fieldPath, "required.", issues);
            return null;
        }

        if (value.ValueKind != JsonValueKind.String)
        {
            issues.Add(fieldPath, "type", "must be a string.");
            return null;
        }

        // A lone surrogate can't match the ASCII key pattern or any valid shell key, so the
        // lenient read is enough to fail it the way JS does.
        return JsonWalk.StringLenient(value);
    }

    /// <summary>
    /// schema.md §6.4. One issue at most, with precedence <c>type</c> &gt; <c>missing</c> &gt;
    /// <c>too-long</c> &gt; <c>name-format</c>. Returns the name only when it is already canonical.
    /// </summary>
    private static string? ReadName(Dictionary<string, JsonElement> o, string path, IssueList issues)
    {
        var namePath = JsonWalk.ChildPath(path, "name");
        if (IsAbsent(o, "name", out var value))
        {
            Missing(namePath, "required.", issues);
            return null;
        }

        if (value.ValueKind != JsonValueKind.String)
        {
            issues.Add(namePath, "type", "must be a string.");
            return null;
        }

        var raw = JsonWalk.StringLenient(value);
        var cleaned = CleanName(raw);
        if (cleaned.Length == 0)
        {
            Missing(namePath, "blank after removing control characters and edge whitespace.", issues);
            return null;
        }

        if (CountCodePoints(cleaned) > CreationLimits.ShellNameCodePoints.Max)
        {
            issues.Add(namePath, "too-long", $"longer than {Format(CreationLimits.ShellNameCodePoints.Max)} code points.");
            return null;
        }

        if (!string.Equals(cleaned, raw, StringComparison.Ordinal))
        {
            issues.Add(namePath, "name-format", "has control characters, unpaired surrogates or edge whitespace.");
            return null;
        }

        return cleaned;
    }

    /// <summary>
    /// schema.md §6.4 step 2, identical to <c>cleanName</c> in <c>normalize.ts</c>: remove every Cc
    /// code point (U+0000-001F, U+007F-009F) and every unpaired surrogate, then trim the JS set at
    /// both edges. Interior whitespace is kept.
    /// </summary>
    public static string CleanName(string raw)
    {
        var sb = new StringBuilder(raw.Length);
        for (var i = 0; i < raw.Length; i++)
        {
            var c = raw[i];
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 < raw.Length && char.IsLowSurrogate(raw[i + 1]))
                {
                    sb.Append(c).Append(raw[i + 1]);
                    i++;
                }

                continue;
            }

            if (char.IsLowSurrogate(c) || char.GetUnicodeCategory(c) == UnicodeCategory.Control)
            {
                continue;
            }

            sb.Append(c);
        }

        return sb.ToString().Trim(JsTrimSet);
    }

    /// <summary>Code points, by runes. Correct only after <see cref="CleanName"/>: a lone surrogate counts as one U+FFFD rune.</summary>
    public static int CountCodePoints(string cleaned) => cleaned.EnumerateRunes().Count();

    // ---- helpers ------------------------------------------------------------------------------

    /// <summary>The one null rule: <c>null</c> reads exactly like an absent key.</summary>
    private static bool IsAbsent(Dictionary<string, JsonElement> o, string key, out JsonElement value) =>
        !o.TryGetValue(key, out value) || value.ValueKind == JsonValueKind.Null;

    private static double? Missing(string path, string detail, IssueList issues)
    {
        issues.Add(path, "missing", detail);
        return null;
    }

    private static string Format(double value) => value.ToString("R", CultureInfo.InvariantCulture);

    /// <summary>
    /// For messages only; never for paths (rule 11 builds those). Lone surrogates become U+FFFD so
    /// the 400 body is always well-formed Unicode.
    /// </summary>
    private static string Quote(string value) => Echo("\"" + JsonWalk.WellFormed(value) + "\"");

    /// <summary>
    /// A user-supplied value as it appears in a developer message: at most 32 code points, then an
    /// ellipsis (Boo S24). Never used for a name's text, which no message echoes.
    /// </summary>
    public static string Echo(string text)
    {
        const int max = 32;
        var wellFormed = JsonWalk.WellFormed(text);
        var runes = wellFormed.EnumerateRunes().Take(max + 1).ToList();
        return runes.Count <= max ? wellFormed : string.Concat(runes.Take(max).Select(r => r.ToString())) + "...";
    }
}

using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Fireworks.Api.Contracts;

namespace Fireworks.Api.Services.Creations;

/// <summary>
/// The pieces of the walk shared by <see cref="CreationEnvelopeReader"/> (the request envelope) and
/// <see cref="CreationDocumentValidator"/> (the document): reading an object the way
/// <c>JSON.parse</c> would (last value wins) while reporting what it hides (duplicate names), path
/// building (schema.md §6.2 rule 11), and the .NET 11 traps around unpaired surrogates
/// (§6.5, <c>bowser-phase3-validator-feasibility.md</c>).
///
/// <para>Source kept ASCII on purpose: non-ASCII characters are built from code points.</para>
/// </summary>
internal static class JsonWalk
{
    private static readonly char Replacement = (char)0xFFFD;

    // schema.md §6.2 rule 11. \z, never $: .NET's $ also matches before a final "\n".
    private static readonly Regex PlainName = new(@"^[A-Za-z_][A-Za-z0-9_-]*\z", RegexOptions.CultureInvariant);

    /// <summary>
    /// The shell-key and cue-id pattern (schema.md §4). <c>\z</c>, not <c>$</c> (with <c>$</c>,
    /// <c>"s1\n"</c> passes), and no <c>IgnoreCase</c> (it lets <c>[A-Za-z]</c> match the Kelvin
    /// sign U+212A).
    /// </summary>
    public static readonly Regex KeyPattern = new(@"^[A-Za-z][A-Za-z0-9_-]{0,11}\z", RegexOptions.CultureInvariant);

    /// <summary>
    /// The path of property <paramref name="name"/> under <paramref name="parent"/> (<c>""</c> is
    /// the root), exactly as <c>childPath</c> in <c>normalize.ts</c> builds it: <c>parent.name</c>
    /// for a plain name, else <c>parent["name"]</c> with only <c>\</c> and <c>"</c> escaped and
    /// each unpaired surrogate written as U+FFFD. Deliberately not a JSON serializer.
    /// </summary>
    public static string ChildPath(string parent, string name)
    {
        if (PlainName.IsMatch(name))
        {
            return parent.Length == 0 ? name : $"{parent}.{name}";
        }

        var quoted = new StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 < name.Length && char.IsLowSurrogate(name[i + 1]))
                {
                    quoted.Append(c).Append(name[i + 1]);
                    i++;
                }
                else
                {
                    quoted.Append(Replacement);
                }
            }
            else if (char.IsLowSurrogate(c))
            {
                quoted.Append(Replacement);
            }
            else if (c is '\\' or '"')
            {
                quoted.Append('\\').Append(c);
            }
            else
            {
                quoted.Append(c);
            }
        }

        return $"{parent}[\"{quoted}\"]";
    }

    /// <summary>The string with every unpaired surrogate replaced by U+FFFD; pairs are kept.</summary>
    public static string WellFormed(string value)
    {
        var sb = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
            {
                sb.Append(c).Append(value[++i]);
            }
            else
            {
                sb.Append(char.IsSurrogate(c) ? Replacement : c);
            }
        }

        return sb.ToString();
    }

    public static string IndexPath(string parent, int index) => $"{parent}[{index}]";

    /// <summary>
    /// Every property of <paramref name="obj"/>, last value per name (what <c>JSON.parse</c> gives
    /// the TS walker). Reports one <c>duplicate-key</c> per repeated name (schema.md §6.2 rule 12)
    /// when <paramref name="reportDuplicates"/> is set, and one <c>unknown-property</c> per name not
    /// in <paramref name="known"/> (rule 2); <paramref name="known"/> null means "a map, any key".
    /// Names are compared after unescaping, ordinally.
    /// </summary>
    public static Dictionary<string, JsonElement> ReadObject(
        JsonElement obj,
        string path,
        IReadOnlyCollection<string>? known,
        IssueList issues,
        bool reportDuplicates = true)
    {
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        HashSet<string>? reported = null;
        foreach (var property in obj.EnumerateObject())
        {
            var name = PropertyName(property);
            if (result.ContainsKey(name))
            {
                if (reportDuplicates && (reported ??= new HashSet<string>(StringComparer.Ordinal)).Add(name))
                {
                    issues.Add(ChildPath(path, name), "duplicate-key", "appears more than once in this object.");
                }
            }
            else if (known is not null && !known.Contains(name))
            {
                issues.Add(ChildPath(path, name), "unknown-property", "unknown property.");
            }

            result[name] = property.Value;
        }

        return result;
    }

    /// <summary>The number of distinct names in an object, as <c>Object.keys(JSON.parse(...))</c> counts them.</summary>
    public static int DistinctNameCount(JsonElement obj)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in obj.EnumerateObject())
        {
            names.Add(PropertyName(property));
        }

        return names.Count;
    }

    /// <summary>
    /// A property name, unescaped. <see cref="JsonProperty.Name"/> throws
    /// <see cref="InvalidOperationException"/> on an unpaired-surrogate escape (measured, .NET 11);
    /// then the raw UTF-8 name is unescaped by hand, keeping the lone surrogate, as JS would.
    /// </summary>
    public static string PropertyName(JsonProperty property)
    {
        try
        {
            return property.Name;
        }
        catch (InvalidOperationException)
        {
            return UnescapeLenient(Encoding.UTF8.GetString(JsonMarshal.GetRawUtf8PropertyName(property)));
        }
    }

    /// <summary>
    /// A string value, unescaped. <see cref="JsonElement.GetString"/> throws on an unpaired
    /// surrogate escape; then the raw token is unescaped by hand, keeping lone surrogates so the
    /// name pipeline (schema.md §6.4) can see and remove them. Invalid raw UTF-8 never gets here:
    /// <see cref="CreationEnvelopeReader"/> gates the body with <c>Utf8.IsValid</c> first.
    /// </summary>
    public static string StringLenient(JsonElement value)
    {
        try
        {
            return value.GetString()!;
        }
        catch (InvalidOperationException)
        {
            var raw = value.GetRawText();
            return UnescapeLenient(raw[1..^1]);
        }
    }

    /// <summary>
    /// <see cref="JsonElement.ValueEquals(string)"/> throws on some invalid UTF-16 escapes
    /// (<c>"\udc00\ud800"</c>, measured). A throw means "no match".
    /// </summary>
    public static bool SafeValueEquals(JsonElement value, string expected)
    {
        try
        {
            return value.ValueEquals(expected);
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    /// <summary>JSON string unescaping that keeps unpaired surrogates as chars. Input has no quotes.</summary>
    internal static string UnescapeLenient(string inner)
    {
        var sb = new StringBuilder(inner.Length);
        for (var i = 0; i < inner.Length; i++)
        {
            var c = inner[i];
            if (c != '\\' || i + 1 >= inner.Length)
            {
                sb.Append(c);
                continue;
            }

            var escape = inner[++i];
            switch (escape)
            {
                // The token already parsed as JSON, so four hex digits always follow.
                case 'u' when i + 4 < inner.Length:
                    sb.Append((char)Convert.ToUInt16(inner.Substring(i + 1, 4), 16));
                    i += 4;
                    break;
                case 'b': sb.Append('\b'); break;
                case 'f': sb.Append('\f'); break;
                case 'n': sb.Append('\n'); break;
                case 'r': sb.Append('\r'); break;
                case 't': sb.Append('\t'); break;
                default: sb.Append(escape); break; // \" \\ \/
            }
        }

        return sb.ToString();
    }
}

/// <summary>The walk's issue collector: every issue, never stopping at the first (schema.md §6.2).</summary>
internal sealed class IssueList
{
    private readonly List<ValidationIssue> issues = [];

    public int Count => issues.Count;

    public IReadOnlyList<ValidationIssue> Items => issues;

    public void Add(string path, string code, string detail) =>
        issues.Add(new ValidationIssue(path, code, $"{(path.Length == 0 ? "(root)" : path)}: {detail}"));
}

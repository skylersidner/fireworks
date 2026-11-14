using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Fireworks.Api.Contracts;
using Fireworks.Api.Data.Entities;

namespace Fireworks.Api.Services.Creations;

/// <summary>
/// The raw <c>GET api/me/creations</c> query: each parameter is null when absent, else every value
/// it was given. Parsed by <see cref="Parse"/>, never by model binding (schema.md §2.2.1).
/// </summary>
public sealed record CreationListQuery(string?[]? Page, string?[]? PageSize, string?[]? Kind)
{
    public const int DefaultPageSize = 24;
    public const int MaxPageSize = 100;

    // \z, not $: "5\n" must not pass.
    private static readonly Regex IntegerLiteral = new(@"^-?[0-9]+\z", RegexOptions.CultureInvariant);

    /// <summary>The effective values, or every query issue together.</summary>
    public (int Page, int PageSize, CreationKind? Kind, IReadOnlyList<ValidationIssue> Issues) Parse()
    {
        var issues = new IssueList();
        var page = ReadClamped(Page, "page", 1, 1, int.MaxValue, issues);
        var pageSize = ReadClamped(PageSize, "pageSize", DefaultPageSize, 1, MaxPageSize, issues);

        CreationKind? kind = null;
        if (Kind is not null)
        {
            // Exactly one value, ordinally "shell" or "show". Never an enum bind ("Shell", "0").
            if (Kind is ["shell"])
            {
                kind = CreationKind.Shell;
            }
            else if (Kind is ["show"])
            {
                kind = CreationKind.Show;
            }
            else
            {
                var given = Kind.Length == 1 ? JsonSerializer.Serialize(Kind[0]) : $"{Kind.Length} values";
                issues.Add("kind", "enum", $"unknown value {CreationDocumentValidator.Echo(given)} (expected exactly one of shell, show).");
            }
        }

        return (page, pageSize, kind, issues.Items);
    }

    /// <summary>
    /// Absent: the default. One ASCII integer literal: clamped to the range, and a literal past
    /// <c>long</c> clamps to the bound on its side, so no number ever fails. Anything else
    /// (empty, <c>abc</c>, <c>1.5</c>, <c>+1</c>, given twice): <c>type</c>.
    /// </summary>
    private static int ReadClamped(string?[]? values, string name, int fallback, int min, int max, IssueList issues)
    {
        if (values is null)
        {
            return fallback;
        }

        if (values is not [{ } text] || !IntegerLiteral.IsMatch(text))
        {
            issues.Add(name, "type", "must be one integer.");
            return fallback;
        }

        if (!long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var number))
        {
            return text.StartsWith('-') ? min : max;
        }

        return (int)Math.Clamp(number, min, max);
    }
}

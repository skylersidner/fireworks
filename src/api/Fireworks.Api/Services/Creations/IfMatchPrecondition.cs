using System.Text.Json;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Fireworks.Api.Services.Creations;

/// <summary>
/// A PUT's <c>If-Match</c> (schema.md §11.4, Boo A29). Three states: absent (428), present with
/// the one tag that can match (the strong <c>"&lt;updatedAt&gt;"</c> the owner was served), or
/// present and unmatchable (412 after the owner-filtered 404).
/// </summary>
/// <param name="Present">Whether the header was sent at all.</param>
/// <param name="Tag">The <c>updatedAt</c> the client edited from; <c>null</c> when the header can never match.</param>
public sealed record IfMatchPrecondition(bool Present, DateTimeOffset? Tag)
{
    public static readonly IfMatchPrecondition Missing = new(false, null);
    public static readonly IfMatchPrecondition Unmatchable = new(true, null);

    /// <summary>
    /// Unmatchable, deliberately: <c>*</c> (a deviation from RFC 9110, so Overwrite stays a
    /// deliberate GET-then-PUT), a list, a weak tag, a <c>-p</c> tag, and anything that isn't
    /// exactly the body's own serialization of an instant (<paramref name="options"/>, the
    /// converter the ETag is built with). A tag that doesn't parse is a 412, never a 400.
    /// </summary>
    public static IfMatchPrecondition Parse(StringValues header, JsonSerializerOptions options)
    {
        if (header.Count == 0)
        {
            return Missing;
        }

        if (header.Count != 1 || !EntityTagHeaderValue.TryParseStrictList(header, out var tags) || tags.Count != 1)
        {
            return Unmatchable;
        }

        var tag = tags[0];
        if (tag.IsWeak || tag.Equals(EntityTagHeaderValue.Any))
        {
            return Unmatchable;
        }

        var inner = tag.Tag.ToString();
        if (inner.Length < 3)
        {
            return Unmatchable;
        }

        var text = inner[1..^1];
        try
        {
            var instant = JsonSerializer.Deserialize<DateTimeOffset>(JsonSerializer.Serialize(text), options);
            // Byte-equal round trip, and UTC only (every tag the API sends is +00:00): a strong
            // comparison, so "+01:00" for the same instant is not a match even though SQL would say equal.
            return instant.Offset == TimeSpan.Zero && JsonSerializer.SerializeToElement(instant, options).GetString() == text
                ? new IfMatchPrecondition(true, instant)
                : Unmatchable;
        }
        catch (JsonException)
        {
            return Unmatchable;
        }
    }
}

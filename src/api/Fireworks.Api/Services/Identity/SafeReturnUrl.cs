namespace Fireworks.Api.Services.Identity;

/// <summary>
/// Where a sign-in may send the browser afterwards (Boo A5). The server is the authority: the
/// login endpoint and the failure redirect both pass every value through <see cref="From"/>, and
/// anything it doesn't accept becomes <c>/</c>.
/// </summary>
public static class SafeReturnUrl
{
    public const string Home = "/";
    public const int MaxLength = 2048;

    /// <summary>
    /// <paramref name="raw"/> when all of these hold, else <see cref="Home"/>: not null or empty and at
    /// most <see cref="MaxLength"/> chars; starts with <c>/</c> and the second char is neither
    /// <c>/</c> nor <c>\</c>; no <c>\</c> anywhere and no char below U+0020 or equal to U+007F
    /// (browsers strip tab and newline, so <c>/\t/evil</c> would become <c>//evil</c>); and the path,
    /// raw or percent-decoded, doesn't start with <c>/api</c> (no bouncing into the auth endpoints).
    /// These rules imply <c>Url.IsLocalUrl</c>, which the login endpoint checks as well.
    /// </summary>
    public static string From(string? raw)
    {
        if (string.IsNullOrEmpty(raw) || raw.Length > MaxLength || raw[0] != '/')
        {
            return Home;
        }

        if (raw.Length > 1 && raw[1] is '/' or '\\')
        {
            return Home;
        }

        foreach (var c in raw)
        {
            if (c < '\u0020' || c == '\u007f' || c == '\\')
            {
                return Home;
            }
        }

        var end = raw.IndexOfAny(['?', '#']);
        var path = end < 0 ? raw : raw[..end];
        string decoded;
        try
        {
            decoded = Uri.UnescapeDataString(path);
        }
        catch (UriFormatException)
        {
            return Home;
        }

        if (IsApiPath(path) || IsApiPath(decoded) || (decoded.Length > 1 && decoded[1] is '/' or '\\'))
        {
            return Home;
        }

        return raw;
    }

    private static bool IsApiPath(string path) => path.StartsWith("/api", StringComparison.OrdinalIgnoreCase);
}

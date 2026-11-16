using System.Net.Sockets;
using System.Text;

namespace Fireworks.Api.Tests.Hardening;

/// <summary>
/// Boo's §4 site-wide header set, spelled out as literals (<c>boo-phase7-security-requirements.md</c>),
/// never read from <c>ResponseHeaders</c>: a test that compares the app's constant with itself can't
/// see the constant drift.
/// </summary>
internal static class HeaderExpectations
{
    public const string Csp =
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; " +
        "worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

    public static readonly IReadOnlyDictionary<string, string> SiteWide = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["Content-Security-Policy"] = Csp,
        ["X-Content-Type-Options"] = "nosniff",
        ["Referrer-Policy"] = "same-origin",
        ["X-Frame-Options"] = "DENY",
        ["Cross-Origin-Opener-Policy"] = "same-origin",
        ["Cross-Origin-Resource-Policy"] = "same-origin",
        ["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    };

    /// <summary>
    /// Every mismatch with the site-wide set: a missing or repeated header, a value that differs by a
    /// byte, a <c>Server</c> header, and HSTS on a response that shouldn't have it. Empty means pass.
    /// </summary>
    public static IReadOnlyList<string> Problems(HttpResponseMessage response, bool expectHsts = false)
    {
        // NonValidated: the bytes as sent. The typed accessors re-serialize (Cache-Control comes back
        // reordered as "no-cache, private").
        var all = response.Headers.NonValidated.Concat(response.Content.Headers.NonValidated)
            .GroupBy(h => h.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.SelectMany(h => h.Value).ToList(), StringComparer.OrdinalIgnoreCase);
        var problems = new List<string>();
        foreach (var (name, expected) in SiteWide)
        {
            if (!all.TryGetValue(name, out var values))
            {
                problems.Add($"{name} missing");
            }
            else if (values.Count != 1 || !string.Equals(values[0], expected, StringComparison.Ordinal))
            {
                problems.Add($"{name}: [{string.Join(" | ", values)}]");
            }
        }

        if (all.ContainsKey("Server"))
        {
            problems.Add("Server present");
        }

        var hsts = all.TryGetValue("Strict-Transport-Security", out var h) ? string.Join(" | ", h) : null;
        if (expectHsts ? hsts != "max-age=31536000" : hsts is not null)
        {
            problems.Add($"Strict-Transport-Security: {hsts ?? "missing"}");
        }

        return problems;
    }

    /// <summary>The raw Cache-Control value as sent (one header line expected), or null.</summary>
    public static string? CacheControl(HttpResponseMessage response) =>
        response.Headers.NonValidated.TryGetValues("Cache-Control", out var values) ? string.Join(" | ", values) : null;

    /// <summary>
    /// Sends raw bytes on a fresh socket and returns the response head (status line and headers) as
    /// text, for requests HttpClient can't make (a 40 KB header, a bad Host, chunked framing written
    /// by hand). <paramref name="body"/> is written concurrently, so a server that answers early and
    /// stops reading can't deadlock the test.
    /// </summary>
    public static async Task<string> RawHeadAsync(Uri baseAddress, byte[] head, byte[]? body = null)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(baseAddress.Host, baseAddress.Port);
        var stream = client.GetStream();
        await stream.WriteAsync(head);
        var writer = body is null
            ? Task.CompletedTask
            : Task.Run(async () =>
            {
                try
                {
                    await stream.WriteAsync(body);
                }
                catch (IOException)
                {
                    // The server answered and closed before taking the whole body: expected.
                }
            });

        var received = new MemoryStream();
        var buffer = new byte[8192];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (true)
        {
            int read;
            try
            {
                read = await stream.ReadAsync(buffer, timeout.Token);
            }
            catch (IOException)
            {
                break;
            }

            if (read == 0)
            {
                break;
            }

            received.Write(buffer, 0, read);
            var text = Encoding.Latin1.GetString(received.ToArray());
            var end = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end >= 0)
            {
                await Task.WhenAny(writer, Task.Delay(2000));
                return text[..end];
            }
        }

        return Encoding.Latin1.GetString(received.ToArray());
    }

    /// <summary>The value of one header in a raw response head, or null.</summary>
    public static string? RawHeader(string head, string name) =>
        head.Split("\r\n").Skip(1)
            .Select(line => line.Split(':', 2))
            .Where(parts => parts.Length == 2 && string.Equals(parts[0].Trim(), name, StringComparison.OrdinalIgnoreCase))
            .Select(parts => parts[1].Trim())
            .FirstOrDefault();
}

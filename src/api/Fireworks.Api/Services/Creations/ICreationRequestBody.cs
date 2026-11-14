namespace Fireworks.Api.Services.Creations;

/// <summary>
/// A write request's body, handed to the service unread, so the service can run the steps in
/// Boo's order (S8): the <c>CanWrite</c> gate first, then content type (415), then size (413),
/// then the §2.6 parse and walks. With writes off, nothing is read at all.
/// </summary>
public interface ICreationRequestBody
{
    /// <summary>Whether <c>Content-Type</c> is JSON. A missing <c>Content-Type</c> is not (Boo S6).</summary>
    bool HasJsonContentType { get; }

    /// <summary>The whole body, or <c>null</c> when it is over <see cref="CreationLimits.MaxRequestBytes"/>.</summary>
    Task<ReadOnlyMemory<byte>?> ReadAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The HTTP body. Reads at most the limit plus one byte itself, so the cap holds even on a host
/// that doesn't enforce <c>[RequestSizeLimit]</c> (Boo S3); on Kestrel, the attribute's 413 surfaces
/// as a <see cref="BadHttpRequestException"/> and is mapped to <c>null</c> here, so an expected
/// client error isn't logged as an unhandled exception.
/// </summary>
public sealed class HttpCreationRequestBody(HttpRequest request) : ICreationRequestBody
{
    public bool HasJsonContentType => request.HasJsonContentType();

    public async Task<ReadOnlyMemory<byte>?> ReadAsync(CancellationToken cancellationToken)
    {
        var body = await ReadCappedAsync(cancellationToken);
        if (body is null)
        {
            // The rest of the body is never read, so Kestrel can't reuse the connection and closes
            // it after the response. Say so: without this header a client reuses the pooled
            // connection for its next request and gets a reset (measured against the real Program:
            // the request after a 413 failed with "response ended prematurely").
            request.HttpContext.Response.Headers.Connection = "close";
        }

        return body;
    }

    private async Task<ReadOnlyMemory<byte>?> ReadCappedAsync(CancellationToken cancellationToken)
    {
        const int limit = CreationLimits.MaxRequestBytes;
        if (request.ContentLength > limit)
        {
            return null;
        }

        var buffer = new byte[Math.Min(limit + 1, (int)(request.ContentLength ?? 16_384) + 1)];
        var total = 0;
        try
        {
            while (true)
            {
                if (total == buffer.Length)
                {
                    if (buffer.Length > limit)
                    {
                        return null;
                    }

                    Array.Resize(ref buffer, Math.Min(limit + 1, buffer.Length * 2));
                }

                var read = await request.Body.ReadAsync(buffer.AsMemory(total), cancellationToken);
                if (read == 0)
                {
                    break;
                }

                total += read;
                if (total > limit)
                {
                    return null;
                }
            }
        }
        catch (BadHttpRequestException exception) when (exception.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return null;
        }

        return buffer.AsMemory(0, total);
    }
}

/// <summary>An in-memory body, for service tests and any non-HTTP caller.</summary>
public sealed class BytesCreationRequestBody(byte[] bytes, bool hasJsonContentType = true) : ICreationRequestBody
{
    public bool HasJsonContentType => hasJsonContentType;

    public Task<ReadOnlyMemory<byte>?> ReadAsync(CancellationToken cancellationToken) =>
        // Typed explicitly: `cond ? null : bytes` would be a null byte[], which converts to an EMPTY
        // memory, not to null.
        Task.FromResult(bytes.Length > CreationLimits.MaxRequestBytes ? (ReadOnlyMemory<byte>?)null : bytes);
}

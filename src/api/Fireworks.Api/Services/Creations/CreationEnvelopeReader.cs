using System.Text.Json;
using System.Text.Unicode;
using Fireworks.Api.Contracts;

namespace Fireworks.Api.Services.Creations;

/// <summary>The envelope walk's outcome: the request record, or every envelope issue.</summary>
public sealed record EnvelopeResult<T>(T? Request, IReadOnlyList<ValidationIssue> Errors) where T : class
{
    public bool IsValid => Errors.Count == 0;
}

/// <summary>
/// schema.md §2.6 steps 3-5, over the raw request body. Steps 1 and 2 (415, 413) run in the service,
/// after the write gate: an explicit <c>HasJsonContentType</c> check (no <c>[Consumes]</c>, Boo S6)
/// and the buffered read under <c>[RequestSizeLimit]</c>. Step 6 is the owner-filtered or source
/// lookup (PUT and remix). Step 7, the document walk, runs only when this reports no issues at all,
/// so envelope and document issues never share a response.
///
/// <list type="number">
/// <item>Empty, not valid UTF-8 (<c>Utf8.IsValid</c>: <c>JsonDocument.Parse</c> accepts a raw
/// <c>0xFF</c> and only throws later), or unparseable: <c>("", not-json)</c>.</item>
/// <item>Root not an object: <c>("", not-object)</c>.</item>
/// <item>The envelope object, read like any walked object (unknown names, duplicate names), then
/// <c>kind</c> (POST only; elsewhere it is unknown) and <c>document</c>.</item>
/// </list>
///
/// <para>
/// Parsed with the default <see cref="JsonDocumentOptions"/> on purpose: duplicates are kept so
/// the walk can report them with a path (<c>AllowDuplicateProperties = false</c> throws without
/// one), and the default depth limit of 64 turns a pathologically nested body into
/// <c>not-json</c> rather than a stack problem.
/// </para>
/// </summary>
public static class CreationEnvelopeReader
{
    private static readonly string[] CreateKeys = ["kind", "document"];
    private static readonly string[] DocumentOnlyKeys = ["document"];

    public static EnvelopeResult<CreateCreationRequest> ReadCreate(ReadOnlyMemory<byte> body) =>
        Read(body, CreateKeys, (kind, document) => new CreateCreationRequest(kind!, document));

    public static EnvelopeResult<UpdateCreationRequest> ReadUpdate(ReadOnlyMemory<byte> body) =>
        Read(body, DocumentOnlyKeys, (_, document) => new UpdateCreationRequest(document));

    public static EnvelopeResult<RemixCreationRequest> ReadRemix(ReadOnlyMemory<byte> body) =>
        Read(body, DocumentOnlyKeys, (_, document) => new RemixCreationRequest(document));

    private static EnvelopeResult<T> Read<T>(
        ReadOnlyMemory<byte> body,
        string[] keys,
        Func<string?, JsonElement, T> build) where T : class
    {
        var issues = new IssueList();
        if (body.IsEmpty || !Utf8.IsValid(body.Span))
        {
            issues.Add("", "not-json", "the body must be non-empty UTF-8 JSON.");
            return new(null, issues.Items);
        }

        JsonDocument parsed;
        try
        {
            parsed = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            issues.Add("", "not-json", "the body is not valid JSON.");
            return new(null, issues.Items);
        }

        using (parsed)
        {
            var root = parsed.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                issues.Add("", "not-object", "the body must be a JSON object.");
                return new(null, issues.Items);
            }

            var envelope = JsonWalk.ReadObject(root, "", keys, issues);

            string? kind = null;
            if (keys.Contains("kind"))
            {
                if (!envelope.TryGetValue("kind", out var rawKind) || rawKind.ValueKind == JsonValueKind.Null)
                {
                    issues.Add("kind", "missing", "required: \"shell\" or \"show\".");
                }
                else if (rawKind.ValueKind == JsonValueKind.String && JsonWalk.SafeValueEquals(rawKind, "shell"))
                {
                    kind = "shell";
                }
                else if (rawKind.ValueKind == JsonValueKind.String && JsonWalk.SafeValueEquals(rawKind, "show"))
                {
                    kind = "show";
                }
                else
                {
                    issues.Add("kind", "enum", $"unknown kind {CreationDocumentValidator.Echo(rawKind.GetRawText())} (expected one of shell, show).");
                }
            }

            JsonElement document = default;
            if (!envelope.TryGetValue("document", out var rawDocument) || rawDocument.ValueKind == JsonValueKind.Null)
            {
                issues.Add("document", "missing", "required.");
            }
            else if (rawDocument.ValueKind != JsonValueKind.Object)
            {
                issues.Add("document", "not-object", "must be an object.");
            }
            else
            {
                // Clone copies the element's raw bytes, so duplicate names and escapes survive for
                // the document walk, and the result outlives `parsed`.
                document = rawDocument.Clone();
            }

            return issues.Count > 0 ? new(null, issues.Items) : new(build(kind, document), issues.Items);
        }
    }
}

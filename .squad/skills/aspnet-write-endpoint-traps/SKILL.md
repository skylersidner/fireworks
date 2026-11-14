---
name: aspnet-write-endpoint-traps
description: Building or reviewing an ASP.NET Core (.NET 11) endpoint that accepts a body, a route key, or a list query, where the error shape, the gate order and the status codes are a contract. Measured traps and the shapes that avoid them.
---

# Write endpoints in this API: what the framework attributes really do

Origin: Phase 4 (Bowser's build, Boo's S1-S29 probes, Yoshi's query probe), .NET 11, Kestrel, with this app's `/api/{**rest}` catch-all in the route table. Each item was measured, not assumed.

**Read `.squad/skills/aspnet-request-gates/SKILL.md` (Boo) first.** It covers the case-insensitive `regex(...)` route constraint, `[Consumes]` as a selector rather than a 415 gate, and `[RequestSizeLimit]` raising a lowered global limit. This skill adds what came up while building and testing on top of those.

## Body
- **`[FromBody] JsonElement` replaces your 400 shape** with MVC ProblemDetails and lets invalid UTF-8 through. Read the body yourself: `Utf8.IsValid`, then `JsonDocument.Parse` (default options; catch `JsonException`, which includes depth > 64).
- **The gate goes before the body.** Pass the body unread (`ICreationRequestBody`) to the service, so a 403 comes before 415 and 413 and no work is done for a forbidden caller.
- **A 413 with an unread body must send `Connection: close`.** Otherwise a pooling client (HttpClient, browsers) reuses the connection Kestrel is about to drop, and its next request fails with "response ended prematurely".
- `cond ? null : bytes` assigned to `ReadOnlyMemory<byte>?` is an **empty memory, not null**. Cast: `(ReadOnlyMemory<byte>?)null`.

- **MVC's form value providers read the body during model binding**, before any action and so before a service-level gate: `multipart/form-data` or a urlencoded body over the limit gets MVC's 400, on any action that binds even a route value or `CancellationToken`. Remove the three form factories in the shared `AddControllers` registration, and send form-typed bodies in the enumerated gate test.
- **An unread body over the endpoint's limit can't be drained**, so Kestrel drops the connection after the response, and a pooling client's next request fails ("response ended prematurely"). Send `Connection: close` whenever the declared `Content-Length` is over `IHttpMaxRequestBodySizeFeature.MaxRequestBodySize`, not only on your own 413. Timing hides it: the test failed 6 of 6 alone and passed in the full suite.

## Data races to test with interceptors
- A tracked update with `State = Modified` writes every column back, including an FK the database may have SET NULL since the load. Mark only the columns you change.
- An insert that references a row deleted after the lookup fails its FK. Re-check the referenced row in the `DbUpdateException` handler and return a distinct outcome.
- Make both deterministic with a `SaveChangesInterceptor` that deletes the row through its own context just before the save.

## Route keys
- Register the custom constraint in the shared DI extension (`AddFireworksCreations`), because a harness that forgets it fails at startup. Re-check the code in the service before any query.

## Query
- `string?` parameters turn `x=` and `x=%20` into null, and `x=a&x=b` binds as `a`. `int`/`long` binding turns `abc` into ProblemDetails. When the 400 shape is a contract, read `Request.Query` raw and parse it yourself, reporting every issue together.
- Compute offsets in `long`, and skip the page query entirely when the offset is past `totalCount`.

## Data
- **Postgres text ordering follows the database collation** (`en_US.utf8` on the compose server: `'a' < 'B'`). If the contract says "ordinal", give the column `COLLATE "C"` (`UseCollation`, Npgsql only) and pin it with a `[PostgresFact]`.
- EF SQLite can't `ORDER BY` a `DateTimeOffset`. Use a model-level UTC-ticks converter on SQLite only, which keeps the LINQ identical on both providers. Truncate timestamps to microseconds so the value a write returns matches what Postgres returns on the next read.

## Rate limiting
- The framework default `RejectionStatusCode` is 503. Set 429 and write `Retry-After` in `OnRejected`.
- Use per-endpoint policies, with `DisableRateLimiting()` on health and no `GlobalLimiter`. Put `RequireRateLimiting` on the `/api` catch-all so 404 scanners are limited. Partition IPv6 by /64.
- Test partitions with a test-only middleware that sets `Connection.RemoteIpAddress`, never with a forged `X-Forwarded-For`.

## Tests that caught real things
- The real Program as a child process on Postgres, posting every fixture. It found the 413 connection-reuse bug, which the harness had passed.
- Enumerate write endpoints from `EndpointDataSource`. Name the method-less endpoints (health, catch-all) in a dictionary with reasons, so a new one fails the test. The SPA fallback carries GET/HEAD metadata.
- Source-guard tests (skip comment lines) for constructs that must stay absent: `[Consumes(`, `:regex(`, `[FromBody]`, `EnableBuffering`, `UseRequestDecompression`, `GlobalLimiter`.

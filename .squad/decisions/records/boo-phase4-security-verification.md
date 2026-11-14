# Phase 4 security verification: no body reader before the gate, including MVC's form providers

**By:** Boo · 2026-11-13 · Phase 4 security verification after Bowser's build (`bowser-phase4-creations-persistence.md`)
**Status:** proposed

## What
1. **No API endpoint may have MVC's form value providers.** Remove `FormValueProviderFactory`, `FormFileValueProviderFactory` and `JQueryFormValueProviderFactory` from `MvcOptions.ValueProviderFactories`. Do it in one registration that Program.cs and every test harness call (today the harness calls its own `AddControllers()` at `FireworksApiHarness.cs:109`).
2. **The S8 gate test sends form-typed bodies too**: `multipart/form-data` (malformed and well-formed) and a urlencoded body over 64 KiB, on every enumerated target. All must get 403 with writes off.
3. A source-guard entry for `FormValueProviderFactory` isn't needed. The gate test with form bodies is the guard, because it fails if anything reads the body early.

## Why
Measured on the real Program (Production, Kestrel, Postgres), writes off:
- `POST /api/creations` with `Content-Type: multipart/form-data; boundary=x` returns **400** MVC ProblemDetails ("Failed to read the request form"), not 403.
- The same happens on PUT, DELETE, remix, `GET api/me/creations` and `GET api/me`.
- `DELETE` with a 300 KB urlencoded body also returns 400 ("Request body too large… 65536").

MVC reads and parses the body during model binding, before the action and so before the `CanWrite` gate. That breaks S3 (the body is read only in the action), S6 (a non-JSON type is 415) and S8 (403 whatever the body). Both content types are CORS-safelisted, so this is also the request shape a Phase 8 CSRF attempt uses. With the providers removed (verified in a scratch copy), all six cases return 403 and the suite stays green.

## Boundary
Binds every API endpoint. If a future endpoint really needs form binding (none is planned; Phase 8's OIDC `form_post` callback is handled by the authentication middleware, not MVC), it opts in on that endpoint alone, with its own gate test.

## Addendum, 2026-11-13: re-verification after Bowser's fix round

Measured on a clean Release publish (scratch copy), Production, Postgres, port 5197; a mutant on 5196.

1. **F1 fix: PASS.** `AddFireworksControllers` (Program.cs:35 and `FireworksApiHarness.cs:109`) removes the three form factories. Writes off: malformed multipart, well-formed multipart and a 300 KB urlencoded body each got **403 with 0 DbCommands** on POST, PUT, remix, DELETE and `GET api/me/creations`; `GET api/me` with a form body is 200. Writes on: all three shapes are **415, 0 queries**, on POST, PUT and remix. Gate tests from a scratch copy: 27 passed, 1 skipped (Postgres). S3, S6, S8 hold.
2. **`Connection: close` on a declared body over `MaxRequestBodySize` (`ApiResponseHeaders.cs`): PASS.**
   - *Need:* the mutant without the branch made Python `http.client` fail the next pooled request 3 of 3 times (`ConnectionResetError` / `RemoteDisconnected`). curl recovers by reconnecting. Kestrel closes either way; the header only tells the client.
   - *Churn or amplification:* none. The value is a constant, it applies to the requester's own connection, and it's decided by the requester's own `Content-Length`, which Kestrel would close for anyway. `Content-Length: 10^12` with no body sent gets 403 and an immediate close (no wait).
   - *429 and catch-all 404:* consistent with Kestrel's real drain decision. A 429 on a write with 200 KB keeps the connection and the next request works (the 256 KiB limit is already applied); 300 KB closes. A catch-all 404 with 300 KB closes.
   - *Chunked, or a short body under its `Content-Length`:* safe. A chunked over-limit body gets the right status and Kestrel closes without the header (client robustness only). A short body makes the client's next bytes part of its own body (its own framing). `Content-Length` and `Transfer-Encoding` together: Kestrel closes itself.
   - *Header injection:* none. Literal value, no request data.
   - *Outside `/api`:* `POST /` (405) and `POST /health/live` with 300 KB also drop without the header. No legitimate client sends bodies there. Not required.
   - *Behind Railway:* `Connection` is hop-by-hop, so the edge strips it. What it protects is the edge's upstream pool. Hardening (Bowser's call): also close when `ContentLength is null` and `IHttpRequestBodyDetectionFeature.CanHaveBody` is true (this covers chunked).
3. **Bowser's finding 2 (stale `remixedFrom` on one PUT racing the source's delete): acceptable.** It reaches only `isOwner && CanWrite` callers, who saw that code in `remixedFrom` before. It names a code that now 404s, and the next GET is null. No integrity effect: the stored FK is null.

# Phase 4 security requirements (backend persistence)

> Superseded in part by `yoshi-phase3-creation-schema.md` (addendum 3, point 1) on 2026-11-13: S13's `&& CanWrite` term is overruled by Skyler's ruling, so `remixedFrom` is `isOwner` alone. S13's finding (interim exposure) still stands and is accepted. S1–S12 and S14–S29 are unchanged.

**By:** Boo (Web Security Specialist) · 2026-11-13 · Phase 4 security-review ceremony, run before and alongside Bowser's build
**Status:** proposed. S1–S29 bind Phase 4 for Bowser (build) and Toad (tests) once the coordinator forwards them. Promotion to the index is Skyler's call.
**Read:** plan Phase 4 and §3.4; `docs/fireworks-app/schema.md` §1, §2 (incl. §2.6), §6.3–6.5, §9–§11, §12.4; `schema/README.md`; `boo-phase1-pipeline-security-review.md`; `bowser-phase3-validator-feasibility.md`; `boo-race-guards-check-desired-state.md`; code at cb0f0ff: `Program.cs`, `appsettings*.json`, `Services/Identity/*`, `Services/ServiceResults.cs`, `Controllers/MeController.cs`, `Dockerfile`, `.dockerignore`, `src/web/.../core/http-error-interceptor.ts`, `app.html`, `designer-copy.ts`, `engine/model/validate.ts`.
**Measured** (scratch probe on .NET 11, Kestrel, Production environment, the real app's `/api/{**rest}` catch-all reproduced; probe in the session scratchpad, not kept):

| Probe | Result |
|---|---|
| Route `{shareCode:regex(^[[1-9A-HJ-NP-Za-km-z]]{{8}}\z)}` with `abcdefgl`, `abcdefgI`, `abcdefgO` | **200, action reached.** The route regex constraint is case-insensitive (ASP.NET builds it with `IgnoreCase`). |
| Same route with `abcdefg%E2%84%AA` (Kelvin sign U+212A) | **200, action reached**, route value is 8 chars with the non-ASCII byte sequence `e2 84 aa`. |
| `abcdefgh%0A`, `abcdefg0` | 404 (the `\z` fix holds). |
| `[Consumes("application/json")]` POST with `text/plain`, catch-all present | **404, not 415.** The catch-all is another candidate, so the consumes policy picks it. |
| Same, catch-all removed | 415. (This is the shape Bowser measured.) |
| Same, **no `Content-Type` header** | **200: the action ran.** `[Consumes]` doesn't reject a missing type. |
| Kestrel global `MaxRequestBodySize = 65536` plus `[RequestSizeLimit(262144)]` on the action | 200,000 B accepted (both `Content-Length` and chunked); 300,000 B gets 413 ProblemDetails (both). Another action without the attribute gets 413 at 70,000 B. The attribute raises the global limit. |
| `Content-Encoding: gzip` | Ignored: the body is read raw (no decompression middleware), so it fails as `not-json`. |
| `application/json; charset=utf-16` | Accepted by `[Consumes]`; the `Utf8.IsValid` + parse gate then decides. Harmless. |
| `at-maximums.json` as a body | 189,359 B compact UTF-8, 210,479 B `\u`-escaped, 290,126 B pretty-printed. Largest expected `errors` count in any fixture: 12. |

---

## What

Each item is **must-have** (Phase 4 doesn't pass the gate without it) or **hardening** (recommended; Phase 4 may ship without it if the reason is stated). "Test" is the check Toad writes; every one needs its negative control (`toad-verify-the-verifier.md`).

### Size limits

**S1 (must-have). Keep `[RequestSizeLimit(262144)]` (256 KiB) on `POST api/creations`, `PUT api/creations/{code}` and `POST api/creations/{code}/remix`.** The worst case is 210,479 B escaped, which leaves 1.25× headroom; the next power of two down (128 KiB) rejects valid shows. A pretty-printed worst case (290 KB) would be rejected, so the Phase 5 client must send compact `JSON.stringify` output (Luigi; note it in the Phase 5 brief).
- Test (Kestrel harness): `at-maximums` returns 201; a valid shell padded with whitespace to exactly 262,144 B returns 201 and to 262,145 B returns 413; 300 KiB chunked returns 413; `oversize.json` returns 413, on all three endpoints. Negative control: remove the attribute and `at-maximums` must get 413 (from S2's global limit), which proves the attribute is what admits it.

**S2 (must-have). Lower Kestrel's global `MaxRequestBodySize` from 30 MB to 65,536 B (64 KiB)** in `ConfigureKestrel`. No other endpoint reads a body today, so this is defense in depth for every future endpoint; 64 KiB still fits a Phase 8 OIDC `form_post` callback. Measured: the per-action attribute raises it for the three write actions.
- Test: a startup test that reads `KestrelServerOptions.Limits.MaxRequestBodySize` from the built host and asserts 65,536. A config-only test is acceptable here because the S1 negative control already exercises the limit end to end.

**S3 (must-have). The body is read only inside the action, after the MVC filter has set the limit.** No middleware may read or buffer `Request.Body` before MVC (no `EnableBuffering`, no body-logging middleware). Once the body has been read, the size feature is read-only and `[RequestSizeLimit]` silently does nothing. The size test must run on real Kestrel, because TestServer doesn't enforce `MaxRequestBodySize`.
- Hardening on top: `CreationEnvelopeReader` also enforces the cap itself (reads at most limit + 1 bytes and returns 413), so the limit doesn't depend on the host.

**S4 (must-have). Never add request decompression** (`UseRequestDecompression`). Measured: today a `Content-Encoding: gzip` body is read raw and fails as `not-json`, so there's no zip-bomb path.
- Test: a gzip-encoded valid body returns 400 `("", not-json)`.

**S5 (must-have, at deploy). Verify 413 through Railway's edge.** Kestrel raises 413 only when the body is read, and S8 puts the gate before the read. With writes off, an oversized body gets **403**, so this check runs in the first test window (the Phase 5 Railway round trip at the latest). With writes off, the first Phase 4 deploy can still check the edge's own limit: a 200 KiB body must reach the app and get 403, not an edge 413. In the window: `curl -sv -H 'Content-Type: application/json' --data-binary @300k.json https://<host>/api/creations`, with and without `-H 'Transfer-Encoding: chunked'`. Record the status the client sees (413 with a ProblemDetails body, an edge-generated 413/502, or a reset), confirm that a 200 KiB `at-maximums` body gets 201 (no lower edge limit), and record whether the response arrives before the whole upload finishes. If the client sees a reset (Angular reports status 0), the Phase 5 Save-failure copy for 413 must also cover status 0 on an oversized save (Rosalina/Luigi, F10).

### Content type (finding, measured)

**S6 (must-have). Return 415 from the reader, not from `[Consumes]`.** Remove `[Consumes("application/json")]` from the write actions and make §2.6 step 1 an explicit check, `Request.HasJsonContentType()`, which returns 415 when the type is missing or isn't JSON. In the real pipeline, `[Consumes]` turns a wrong type into **404** (the `/api/{**rest}` catch-all wins candidate selection), so `wrong-content-type.json` would fail. It also lets a request with **no `Content-Type`** through. That is a CSRF hole for Phase 8: a cross-site `fetch` with an untyped `Blob` body sends no `Content-Type`, so it's a simple request with no preflight. Before Phase 8 nothing is ambient, so it isn't exploitable today.
- Test: on POST, PUT and remix, `text/plain` returns 415, no `Content-Type` returns 415, `application/json; charset=utf-8` is accepted, and `wrong-content-type.json` returns 415. Negative control: put `[Consumes]` back in place of the check and the wrong-type case must come back 404.
- Doc follow-up (Yoshi): schema.md §2.6 step 1 and §6.5 say `[Consumes]`; change them to the explicit check.

### Ownership and IDOR

**S7 (must-have). The owner is always `ICurrentUser.UserId`.** No request field and no DTO property feeds `owner_user_id`. The envelope walk rejects every extra property (`envelope-unknown.json`: `owner` gives `unknown-property`).
- Test: a two-user service test where user A creates and the stored row's owner is A. `envelope-unknown.json` returns 400.

**S8 (must-have). The write gate lives in the service and runs first:** create, update, delete, remix and `GET api/me/creations` check `CanWrite && UserId != null` **before** the body is walked and before any repository call. With writes off, every body gets 403, whatever its content type, size or validity, and no CPU is spent on the walk. The full order is: gate (403), content type (415, S6), size (413, S1), then the §2.6 parse and walks. §2.6 still describes the request read; the gate simply comes before it, as §2.2.1 already says for the list ("403 … before any query").
- Test: the enumerated gate test. Build the set from `EndpointDataSource`: every `RouteEndpoint` whose `HttpMethodMetadata` has a non-GET method, plus `GET api/me/creations`. Send each a **valid** body with writes off, assert 403, and assert an **empty** repository call ledger. Two traps for Toad:
  - The `/api/{**rest}` catch-all has **no** `HttpMethodMetadata` (it maps every method) and must be excluded by its route pattern, with the reason written in the test. Its own test asserts 404.
  - The test must fail if the enumerated set comes back empty.
  - Negative controls: delete the check from one service method and the test fails; add a new POST action without the check and the test fails.

**S9 (must-have). PUT and DELETE resolve the row with `share_code = @code AND owner_user_id = @user` in one predicate.** A missing row and someone else's row give **byte-identical** 404 responses (same status, same body, no message that says "not yours").
- Test: two-user service tests. A creates; B's PUT and DELETE return 404; A's row is unchanged: `document`, `name`, `palette` and `updated_at` compare equal after B's attempts. The response bodies for "B on A's code" and "anyone on an unknown code" compare byte-equal. A `[PostgresFact]` runs the same predicate on the real database (`toad-fake-repositories-must-mirror-real-return-semantics.md`).

**S10 (must-have). No path lets a non-owner change what someone else's link plays.** I checked the full Save model:

| Path | Why it can't change someone else's link |
|---|---|
| PUT | Owner filter (S9) |
| DELETE | Owner filter (S9) |
| Remix | Inserts a new row with a new code and never writes the source. Don't add a "remix count" or "last remixed" column on the source. |
| Create / remix share-code collision | Insert-only. Never an upsert, `ON CONFLICT DO UPDATE` or `Attach`/`Update` of an existing row. The retry re-checks the desired state (`boo-race-guards-check-desired-state.md`): code taken, so generate another. |
| Client "Update original" (shown only when `isOwner`) | Not a control. The server decides (S9). |
| A row deleted between load and save | 404, never 500. If `SaveChanges` throws a concurrency error, re-check whether the row still exists for this owner. Prefer `ExecuteUpdateAsync`/`ExecuteDeleteAsync` with the S9 predicate, where 0 rows means 404. If you go that way, `updated_at` must be set explicitly, because `ExecuteUpdate` bypasses the `ITimestamped` hook. |

- Test: after B remixes A's code, A's source row is unchanged (including `updated_at`). Stub the generator to return an existing code first: the new row gets the second code and the existing row is untouched. With the stub returning the taken code all 5 times, the request gets 500, the existing row is untouched, and a retry is logged.

**S11 (must-have). `kind` is immutable.** PUT validates against the stored kind, and `kind` in a PUT or remix body is `unknown-property` (§2.3, §2.6). Remix validates against the source's kind.
- Test: a PUT with `{kind, document}` returns `(kind, unknown-property)`. A remix of a shell with a show document gets the kind-mismatch issue set.

### Public GET by share code

**S12 (must-have). `CreationResponse` has exactly the keys `shareCode, kind, name, schemaVersion, document, isOwner, remixedFrom, createdAt, updatedAt`.** It has no `id`, no owner id, no `remixedFromId` and no user data. List items have exactly `shareCode, kind, name, updatedAt, palette`.
- Test: assert the **exact** key set on the parsed response as owner and as non-owner, for every endpoint that returns a creation (`GET`, `201` from POST, `200` from PUT, `201` from remix) and for list items. Never assert with a "contains" check. Non-owner GET of a remix has `remixedFrom: null` (two-user test).

**S13 (must-have; changes the schema.md §2.1 rule, so it needs Yoshi's doc change and Skyler's nod). Before Phase 8, reveal `remixedFrom` only when `isOwner && CanWrite`.** *[Superseded in part, 2026-11-13: the `&& CanWrite` term is overruled; see the note at the top.]* Finding: with production writes off, every visitor resolves to the default user (`DefaultUserCurrentUser.UserId` is always set), so `isOwner` is true for every saved creation and **every visitor of a remix's share link gets the original's unlisted code**. That is exactly what Skyler's Q3 ruling forbids. Adding `&& CanWrite` narrows the exposure to test windows, where §3.4 already accepts it. After Phase 8 `CanWrite == IsAuthenticated`, so the condition reduces to the ruling as written, with no Phase 8 change. `isOwner` itself may stay ungated: a true flag with writes off reveals nothing, and the client hides Save anyway.
- Test: a fake `ICurrentUser` who owns the remix: `CanWrite` false gives `remixedFrom: null`, true gives the source code. Negative control: drop `&& CanWrite` and the first case fails.

**S14 (must-have; finding, measured). Use a custom ordinal route constraint, not `regex(...)`.** The built-in regex constraint is case-insensitive, so `l`, `I`, `O` and the Kelvin sign (`%E2%84%AA`, which matches `k`) all reach the action, and "a bad code makes no database query" (§9) fails. Write `ShareCodeRouteConstraint : IRouteConstraint` that checks length 8 and each `char` against the 58-char alphabet ordinally (or a static `Regex` with `\z` and **no** `IgnoreCase`). Register it as `{shareCode:sharecode}` on GET, PUT, DELETE and remix. The service re-checks with the same function before querying (defense in depth for any caller that isn't the route).
- Test: `abcdefgl`, `abcdefgI`, `abcdefgO`, `abcdefg0`, `abcdefg%E2%84%AA`, `abcdefgh%0A`, a 7-char code and a 9-char code each return 404 with **zero** repository calls, on all four routes. A valid-alphabet unknown code returns 404 with exactly one lookup. Negative control: put `regex(...)` back and `abcdefgl` must make a repository call.

**S15 (must-have). Share codes come from `RandomNumberGenerator.GetItems<char>(alphabet, 8)`** with the exact 58-char alphabet from §9. Never `System.Random` or `Guid` slices.
- Test: the alphabet constant equals the §9 string (length 58, no `0OIl`). A grep/reflection test that `ShareCodeGenerator` doesn't reference `System.Random`.
- **Enumeration assessment (no extra control needed):** with N stored codes, each guess hits with probability N / 58⁸ (58⁸ ≈ 1.28 × 10¹⁴). At N = 10,000 that's 7.8 × 10⁻¹¹ per guess. Under the S19 read limit (120/min per IP), one IP makes about 1.7 × 10⁵ guesses a day, for about 1.3 × 10⁻⁵ expected hits; 1,000 IPs find about one creation every 75 days. A hit reveals one unlisted fireworks shell. That's acceptable for unlisted content. **Timing doesn't matter:** a hit and a miss already differ by status code. A malformed code (route 404, no DB) and a well-formed miss (DB 404) differ in timing, but that only reveals the public §9 regex. No constant-time work is needed.

**S16 (hardening; Phase 7 caching is Bowser's). `Cache-Control: no-store` on all `/api` responses now.** A PUT changes what a code returns, and `isOwner`/`remixedFrom` vary by user after Phase 8, so no shared cache may hold them. Phase 7 can relax it for share-code GETs with `private` plus validators if it wants. **Superseded in part by `boo-phase7-security-requirements.md` (§3 and §4, P7-S4) on 2026-11-15:** the share-code GET is `private, no-cache` with an ETag; every other `/api` response stays `no-store`.

### Rate limiting

> Superseded in part by boo-phase8-security-requirements.md (A30) on 2026-11-16: the partition is `u:<id>` when signed in, otherwise by IP.

**S17 (must-have). Partitioning: client IP only, before Phase 8** (my Phase 1 record, item 3). The key comes from `HttpContext.Connection.RemoteIpAddress` after `UseForwardedHeaders`:
- IPv4: the full address.
- IPv4-mapped IPv6: map it to IPv4 first.
- IPv6: the **/64 prefix**, because one subscriber holds a whole /64 and can rotate through it for free.
- `null`: one shared `"unknown"` bucket. Never skip limiting.

Set `RejectionStatusCode = 429` (the framework default is **503**) and write `Retry-After` in `OnRejected`.
- Test: unit tests of the key function (two addresses in one /64 share a key, different /64s don't, `::ffff:1.2.3.4` equals `1.2.3.4`, `null` gives `"unknown"`). The harness asserts 429 plus `Retry-After` on a rejection.

**S18 (must-have). Write policy: 20 per minute and 300 per day per partition, chained** (`PartitionedRateLimiter.CreateChained`, or two fixed-window limiters), on POST create, PUT, DELETE and remix. Read the limits from configuration (`RateLimits:Writes:*`) so tests can set small values; the committed defaults are 20 and 300.
- Test (harness, limits set to 3/min): the 4th write returns 429, the 403 path still counts (writes off doesn't bypass the limiter), and a different partition key isn't affected (use the key function or a test-only `RemoteIpAddress` override, never a forged header). Negative control: remove the policy from DELETE and its 4th call isn't 429.

**S19 (must-have). Read policy: 120 per minute per partition** on `GET api/creations/{code}`, `GET api/me/creations`, `GET api/me`, and the `/api/{**rest}` catch-all, so a scanner hitting 404s is limited too. Reads need a limit for cost and DoS reasons, not because of the enumeration math (S15). Static files short-circuit before routing and are never limited. The SPA fallback (`MapFallbackToFile`) gets no policy.
- Test: 121 GETs return 429. A share-code GET after the write limit is exhausted still returns 200 (the policies are separate).

**S20 (must-have). Pipeline placement and the health exclusion.** `UseRateLimiter()` goes after `UseRouting()` (endpoint policies need endpoint metadata) and is downstream of `UseForwardedHeaders` (already first). Phase 8 puts it after `UseAuthentication`. `MapHealthChecks("/health/live").DisableRateLimiting()`, and use no `GlobalLimiter` that could catch the probe.
- Test: after exhausting both policies, `/health/live` returns 200 `text/plain` `Healthy`. Negative control: add a `GlobalLimiter` and it fails.

**S21 (must-have, at deploy; closes Phase 1 condition 4). Verify the client IP on Railway with the read policy, black-box,** so no test window and no IP-echo endpoint are needed:
- (a) From one machine, send 121 `GET /api/creations/<valid-alphabet unknown code>`, each with a different forged `X-Forwarded-For: 203.0.113.N`. The 121st must be 429, which shows the forged header doesn't change the partition (spoof-resistant).
- (b) Right after that, from a second network (a phone hotspot), one GET must be 404, not 429, which shows the partition isn't one global bucket. If Railway adds an inner hop, ForwardLimit = 1 would pick that hop's IP for everyone.

If (a) fails, ForwardLimit or the edge behavior is wrong and the limiter is spoofable. If (b) fails, the limiter is a global kill switch. Either way, stop and raise it to Skyler. The fix is likely a `KnownProxies`/`KnownIPNetworks` entry for Railway's edge plus ForwardLimit 2. Note for the runbook: the limiter is in memory, per replica, and resets on every deploy.

### Input

**S22 (must-have). The §2.6 gate order is the only parser:**
1. Content type (S6).
2. Size (S1).
3. `Utf8.IsValid` on the whole buffer.
4. `JsonDocument.Parse` with default options.
5. The envelope walk.
6. The document walk.

No `[FromBody]`, no `JsonSerializer.Deserialize` of request input anywhere. A NUL in a name is `name-format` and never reaches Postgres. A raw `0x00` byte in the body fails the parse. Duplicate keys are caught by the walker (§12.4 fixtures). `UnmappedMemberHandling.Disallow` is superseded by the walker's `unknown-property` and needn't be configured.
- Test: every §12.4 fixture, plus two new harness cases: a raw `0x00` byte inside a string value returns `("", not-json)`, and the name `"a\u0000b"` returns `(name, name-format)`. A `[PostgresFact]` saves `valid/shell/*` and the name-cleaning fixtures, with no 500.

**S23 (must-have). No request input can produce a 500.** Catch the `JsonException` from `JsonDocument.Parse` (including the **depth > 64** case) and return `("", not-json)`. Also catch the other measured throwers (`GetString`, `JsonProperty.Name`, `ValueEquals`) as §6.5 says.
- Test: `{"kind":"shell","document":{"x":` + 100 nested `[` … `]` + `}}` returns 400 `("", not-json)`. Every fixture in `schema/fixtures/` returns 201, 400, 413 or 415, never 500. Negative control: remove the catch and the depth case returns 500.

**S24 (must-have, with hardening on top). The 400 body is `{ message, errors: [{ path, code, message }] }` as `application/json`, and nothing else is echoed.** No `value`/`options` fields, and no raw request text beyond the path and the value in the developer message.
- **XSS assessment of reflected values** (for example `Pattern "spiral" isn't one of …`): **not exploitable, info only.**
  - The body is `application/json`.
  - A cross-origin page can't send `application/json` without a preflight, and production has no CORS policy. After S6, every other content type gets 415 before the walk.
  - The client renders every string through interpolation: `app.html` `{{ notification.message }}`; `http-error-interceptor.ts` shows a fixed generic message; `designer-copy.ts` builds plain strings.
  - `designer-structure.spec.ts` already bans `innerHTML` in the designer.
- Hardening:
  - Truncate echoed values in server messages to 32 code points, JSON-escaped.
  - Never echo a name's text (the TS `strictMessage` already doesn't).
  - Add `X-Content-Type-Options: nosniff` now rather than in Phase 7.
- Phase 5 (Luigi; my share-link review checks it): widen the `innerHTML` ban to the whole app (player overlay, My creations, toasts, `/c/:code`), and never render a creation name with Pixi `HTMLText`, which parses markup. Pixi `Text` and `BitmapText` are safe.

**S25 (hardening; a contract change, so Yoshi decides). Cap the 400 `errors` list at 100 issues, with `"truncated": true`.** Today a 256 KiB body of unique 2-char unknown keys produces about 37,000 issues, a ~3 MB response (about 11× amplification). The S18 write limit bounds that to about 60 MB/min per IP, which is acceptable for now. The largest fixture expects 12 issues, so a cap of 100 changes no fixture.

**S26 (must-have). Make the list query input unable to cause a 500 or a wrong filter.**
- Bind `page` and `pageSize` so that out-of-`int` values clamp instead of failing binding or overflowing. Bind them as `long?` (or strings), clamp, then compute the offset in `long`.
- When `(page - 1) * pageSize >= totalCount`, return the empty page without issuing an `OFFSET` query.
- Bind `kind` as a **string** and compare it ordinally with `"shell"`/`"show"`. Enum binding would accept `Shell`, `SHELL`, `0` and `1`, which breaks the §2.2.1 400 rule.
- Test (writes on): `page=2147483647&pageSize=100` returns 200 with empty items and the real `totalCount`. `page=99999999999` returns 200 clamped (not a 500, not a ModelState 400). `pageSize=0` returns `pageSize: 1`. `kind=Shell`, `kind=0` and `kind=` return 400 `(kind, enum)`. Negative control: compute the offset in `int` and the first case returns 500 on Postgres. That's a `[PostgresFact]`, because SQLite may not reject a negative OFFSET the same way.

**S27 (hardening). Logging.** Never log a request body, document, name or issue message at Information or above. Log the issue codes and count, the share code and the outcome. Names are free text (log injection, and the only user-authored content).

### Interim exposure (plan §3.4, OQ20)

> Superseded in part by boo-phase8-security-requirements.md (A42) on 2026-11-16: the blast-radius text is retired with the test windows.

**S28 (must-have; Bowser writes the runbook, Mario checks the README at the gate). State the blast radius wherever the URL is shared.** With `Identity__AllowAnonymousWrites=true`, **anyone who reaches the site**, not only people Skyler gives the URL to, can:
- list every creation saved during any test window (`/mine` shows the default user's whole library);
- **overwrite what any existing share link plays** (PUT), including links already sent to people, and change its name to any 80-character text, which shows in the player overlay and the page title;
- delete every creation (DELETE). There are no backups until Phase 7;
- create up to 300 rows a day per IP (or per IPv6 /64), each up to 256 KiB.

Assume the hostname is public: certificate-transparency logs publish new `*.up.railway.app` hostnames within minutes, and scanners follow them.
- **README text (required):** "Until sign-in exists (Phase 8), the deployed site has no accounts. Saving is normally off. When it is switched on for testing, anyone who can reach the site can see, change and delete every saved creation, and a share link can be changed to play something else. Don't save anything there you'd mind losing or having changed."
- **Runbook steps (required):**
  1. Before enabling, `pg_dump` the database.
  2. Set `Identity__AllowAnonymousWrites=true`, test, then remove the variable and redeploy.
  3. Confirm `GET /api/me` reports `canWrite: false` and `GET /api/me/creations` returns 403.
  4. Compare the row count and `max(updated_at)` with what the test window should have produced, and restore from the dump if they differ.
  5. Never post the URL publicly during a window.
- Hardening:
  - Log a Warning at startup when `CanWrite` is on outside Development ("Anonymous writes are ON"), so Railway logs show every window.
  - A Phase 5 test-mode banner when `canWrite && !isAuthenticated` (Rosalina's copy, Luigi's build).
- Phase 8: creations saved as the default user are public and mutable until reassigned. The reassignment plan belongs to the Phase 8 review (schema.md §10).

### Docker context

**S29 (info). Adding `schema/` to `.dockerignore` has no security effect.** It's committed, public test data with no secrets, and the `Dockerfile` copies only `src/web/fireworks-web/` and `src/api/`. Add it for build-context hygiene. Keep `CreationLimits.cs` compile-time, checked against `limits.json` by a test, rather than reading `limits.json` at runtime. Then the image carries no schema files and there's no runtime file read to secure.

---

## Why

- S6 and S14 are measured gaps between what the framework attribute appears to do and what it does in this app's pipeline. Both would pass a probe that lacks the catch-all, or that uses only lowercase codes.
- S13 follows from the interim identity: every visitor is the owner, so any rule keyed on `isOwner` alone is a rule for everyone until Phase 8.
- S8's ordering (gate before walk) and S17's /64 partition are cheap now and expensive to retrofit after Phase 5 ships against them.
- The size numbers come from the fixtures (`at-maximums`), not from estimates.

## Boundary

- Binds Phase 4: Bowser builds S1–S4, S6–S20, S22–S24, S26 and the S28 runbook; Toad writes the tests named here; S5 and S21 run on the first Phase 4 deploy, and Mario's gate checks they were recorded.
- Needs a doc change, Yoshi's: schema.md §2.6 step 1 and §6.5 (S6), §2.1 `remixedFrom` (S13, which also needs Skyler's agreement because it refines his Q3 ruling), §9 (S14: a custom constraint, not `regex()`), and S25 if adopted.
- Not decided here: Phase 5 rendering (S24's last bullet is a condition I'll check in the share-link review), Phase 7 headers and caching beyond S16, and Phase 8 CSRF and auth (S6 is a precondition for them, not their design).

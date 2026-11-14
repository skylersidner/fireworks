# Boo — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Security review of the Phase 1 pipeline, Phase 4 (ownership, rate limits, validation, size limits), Phase 5 (share-link exposure), Phase 7 (CSP and headers), and Phase 8 (authentication). Note: unlike the reference app, this one has per-user ownership (`owner_user_id`), so IDOR findings are real findings here.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- Production writes are off until Phase 8 (OQ20). This is what makes OQ3 (share links show the latest edit, so a link can be rewritten) and OQ13 (owner-based deletion, which is effectively anyone's deletion under the interim identity) acceptable in the interim. Restate both as conditions in the Phase 4 and 5 security reviews.

### 2026-11-12 — Phase 1 security-review (pipeline)
- **Probe a clean publish, not the repo's build output.** Copy `src/api/Fireworks.Api` (minus bin/obj/wwwroot) to the scratchpad, `dotnet publish -c Release`, run it with `ASPNETCORE_ENVIRONMENT=Production`, `ASPNETCORE_URLS=http://127.0.0.1:5199`, `DOTNET_ROLL_FORWARD=Major` (only the .NET 11 runtime is installed here) and `--webroot` the real `wwwroot`. Skill: `.squad/skills/probe-the-published-build/SKILL.md`.
- **Other agents run mutants on the shared tree.** My first Release publish caught a Program.cs mutant in flight (MapHealthChecks deleted, Program.cs mtime 15:40:12 vs my dll 15:40:00), and `/health/live` served index.html. A clean republish was correct. Before reporting a pipeline regression, compare the source mtime with the dll and rebuild from a copy.
- Verified clean in the running Production build: `/health/live` and `/health/live/` give text/plain; `/api`, `/API/x`, `/api/nope.js`, `POST /api/me` give 404; Swagger 404s; no CORS headers for any Origin; a forced 500 (database dropped under the running app) returns bare ProblemDetails with no detail.
- **The Pkcs pin is correct but only for restore.** `System.Security.Cryptography.Pkcs` IS in `Microsoft.AspNetCore.App` (10.0.15 in the aspnet:10.0 image), so the runtime binds the framework copy and the package never ships. The negative control (pin removed) brings back both GHSA warnings.
- **EF Design's `PrivateAssets=all` keeps the Design dll out, but `BuildHost-net472/` and `BuildHost-netcore/` (about 4 MB of Roslyn MSBuild host) still land in the publish** through contentfiles/buildtransitive.
- `aspnet:10.0` runs as root (`User=[]`, `APP_UID=1654` available). The publish includes `appsettings.Development.json`, so setting `ASPNETCORE_ENVIRONMENT=Development` alone turns on writes, CORS, Swagger and the developer exception page.
- Phase 4 conditions I set (record `boo-phase1-pipeline-security-review.md`): `CanWrite` is checked in the service with an endpoint-enumerating 403 test; before Phase 8 the rate limiter partitions by IP, because every visitor has the same UserId; ForwardLimit stays 1; "My creations" in production is a public gallery of every share code while reads are ungated (question for Skyler).
- Phase 7 note: the prod `index.html` has an inline beasties `<script>` and an inline `<style>`, so a CSP needs hashes or `inlineCritical: false`.

### 2026-11-12 — Phase 1 cross-agent update (Scribe)
- The "aspnet:10.0 runs as root" entry above is stale. The fix round added `USER $APP_UID`, and the image is `aspnet:11.0` after the net11 retarget. Development settings are no longer published.
- Condition 4 of your Phase 1 review (verify `X-Forwarded-For` on Railway) is open while Railway is deferred. Phase 4's limiter waits on it.
- Yoshi's "My creations" ruling (`GET api/me/creations` returns 403 when `CanWrite` is false) puts a GET endpoint under the write gate. Include it in your Phase 4 review and in the enumerated gate test.

### 2026-11-13 — Phase 2 cross-agent update (Scribe)
- Phase 2 had no security review (not in the phase map). The draft is client-only localStorage. The JSON paste runs through normalize, which clamps and rejects.
- For Phase 4: the server's shell rule is Phase 3's strict validator (normalize plus zero adjustments, Yoshi). Review the server validator against that rule: a document the client would adjust must be rejected by the server, not stored.

### 2026-11-13 — Phase 4 security-review (persistence requirements)
- Record: `.squad/decisions/records/boo-phase4-security-requirements.md` (S1–S29). Bowser builds, Toad tests; S5 (413 via Railway) and S21 (XFF black-box via the read limit) run at deploy.
- **Measured traps (scratch Kestrel probe that reproduces the real `/api/{**rest}` catch-all):** the `regex(...)` route constraint is case-insensitive (`l`, `I`, `O` and the Kelvin sign `%E2%84%AA` reach the action), so the share-code route needs a custom ordinal `IRouteConstraint`. With the catch-all present, `[Consumes]` gives 404 rather than 415 for a wrong type, and it lets a missing `Content-Type` through (a Phase 8 CSRF precondition), so check `HasJsonContentType()` in the reader. `[RequestSizeLimit]` does raise a lowered global Kestrel limit (global 64 KiB decided). Bowser's Phase 3 415 measurement had no catch-all. Skill: `.squad/skills/aspnet-request-gates/SKILL.md`.
- **Interim identity makes every `isOwner` rule a rule for everyone:** with writes off, `remixedFrom` would leak to every visitor. I asked for `isOwner && CanWrite` (S13), which needs Yoshi's §2.1 edit and Skyler's nod. Any future owner-only field needs the same check.
- The gate runs before the body read, so with writes off an oversized body gets 403, not 413. The 413-through-edge check needs a test window.
- Worst-case size is from the fixtures: `at-maximums` is 189,359 B compact and 210,479 B escaped; 256 KiB stays. Largest expected issue count is 12 (a cap of 100 is safe if Yoshi adopts S25).
- A share-code enumeration assessment is in S15; the conclusion is that no timing work is needed. The README/runbook blast-radius text for test windows is in S28 (certificate-transparency logs make the hostname public).

### 2026-11-13 — Phase 4 security verification (after Bowser's build)
- Verified S1–S29 against the code and three real instances on a scratch Postgres database: writes off, writes on as user A, and writes on as user B. Same database, different `Identity__DefaultUserId`. That's a cheap, genuine two-user IDOR rig before Phase 8: run the built dll with `ASPNETCORE_ENVIRONMENT=Production` and env overrides from the scratchpad, never the repo's bin. Start instances **sequentially**, because two hosts migrating the same empty database at once race (`42P07 relation already exists`).
- To count queries per request, start the host with the env `Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command=Information` and count `Executed DbCommand`. zsh can't `export` a dotted name, so use `env "K=V" dotnet …`. zsh also doesn't word-split `$var` or `${x:+-H "$h"}`: write probe loops as `bash` scripts.
- **Real finding (S3/S6/S8):** MVC's form value providers read `multipart/form-data` and `x-www-form-urlencoded` bodies before the action, on every action that has any parameter. With writes off, a malformed multipart or a >64 KiB urlencoded body gets an MVC 400 instead of 403, on all four writes, `GET api/me/creations` and `GET api/me`. Bowser's gate test only sends JSON bodies, so it missed this. Proof test and fix verified in a scratch copy (`RemoveType` of the three form factories). Skill trap 8.
- Kestrel counts chunked framing toward the body limit (skill trap 9). Info only.
- Locally, `X-Forwarded-For` picks the rate-limit partition (rightmost entry; Production has `KnownProxies` cleared). That's expected for a direct client. Spoof resistance depends entirely on Railway appending, which S21 checks at deploy.
- Postgres `[PostgresFact]`s are skipped unless `FIREWORKS_TEST_POSTGRES` is set. Point it at a throwaway database name, because the suite drops it.

### 2026-11-13 — Phase 4 re-verification (F1 fix and `Connection: close`)
- F1 fix holds on a clean publish: form-typed bodies get 403 with writes off and 415 with writes on, with 0 queries. Addendum in `boo-phase4-security-verification.md`.
- **Kestrel drops an HTTP/1.1 connection whose unread body is over the current `MaxRequestBodySize`.** `ApiResponseHeaders` announces it for a declared `Content-Length`. Repro tool: Python `http.client` on one connection (no retry) fails the next request. curl hides it by reconnecting, so curl `--next` is not a valid repro. Chunked is the remaining uncovered shape. Behind Railway the header is hop-by-hop and protects the edge's upstream pool, not the browser.
- Raw-socket probes need the parser to handle chunked responses: ProblemDetails 403s are chunked, and leftover `0\r\n\r\n` looks like a bogus next response.
- At 429 time the write endpoint's 256 KiB limit is already in effect (200 KB keeps the connection alive).

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

### Folded from Phase 0 to 2 (summarized 2026-11-14)

- **Phase 0 ruling:** production writes are off until Phase 8 (OQ20). That makes OQ3 (a share link shows the latest edit, so it can be rewritten) and OQ13 (owner-based deletion, which is anyone's deletion under the interim identity) acceptable in the interim. Restate both as conditions in each security review.
- **Probe a clean publish, not the repo's build output** (skill `.squad/skills/probe-the-published-build/SKILL.md`). Copy `src/api/Fireworks.Api` (minus bin/obj/wwwroot) to the scratchpad, `dotnet publish -c Release`, run with `ASPNETCORE_ENVIRONMENT=Production`, a scratch port (5199), `DOTNET_ROLL_FORWARD=Major` where needed, and the real `wwwroot`. Other agents run mutants on the shared tree: before reporting a pipeline regression, compare the source mtime with the dll and rebuild from a copy.
- **Phase 1 pipeline, verified clean in Production:** `/health/live` and `/health/live/` are text/plain; `/api`, `/API/x`, `/api/nope.js` and `POST /api/me` are 404; Swagger 404s; no CORS headers for any Origin; a forced 500 returns bare ProblemDetails with no detail. The `Pkcs` pin is for restore and audit only (the framework copy binds at runtime). EF Design's `PrivateAssets=all` keeps the Design dll out, but `BuildHost-*` (about 4 MB) still lands in publish. The publish used to include `appsettings.Development.json`, so `ASPNETCORE_ENVIRONMENT=Development` alone switched on writes, CORS, Swagger and the developer page (fixed: Development settings are no longer published).
- **Phase 1 conditions (record `boo-phase1-pipeline-security-review.md`):** `CanWrite` is checked in the service with an endpoint-enumerating 403 test; before Phase 8 the limiter partitions by IP; ForwardLimit stays 1; `GET api/me/creations` sits under the write gate and belongs in the enumerated gate test. Railway's `X-Forwarded-For` check (Phase 1 condition 4) stays open until Railway is live.
- **Phase 7 note:** the prod `index.html` has an inline beasties `<script>` and `<style>`, so a CSP needs hashes or `inlineCritical: false`.
- **Phase 2 had no security review.** The draft is client-only localStorage; the JSON paste runs through normalize, which clamps and rejects. The server rule (Phase 3 strict validator = normalize plus zero adjustments) means a document the client would adjust must be rejected by the server, not stored.

### Folded from Phase 4 (summarized 2026-11-14)

- **Requirements:** `boo-phase4-security-requirements.md` (S1–S29). S13 is overruled by Skyler: `remixedFrom` depends on `isOwner` alone (interim exposure accepted; the record is marked in place). Any owner-only field must be checked against the interim identity, because every visitor is the owner before Phase 8.
- **Route and gate traps** (skill `.squad/skills/aspnet-request-gates/SKILL.md`): the `regex(...)` route constraint is case-insensitive (the Kelvin sign reaches the action), so the share code uses a custom ordinal `IRouteConstraint`. With the `/api/{**rest}` catch-all, `[Consumes]` gives 404 and lets a missing `Content-Type` through, so use `HasJsonContentType()`. `[RequestSizeLimit]` raises a lowered global Kestrel limit. The gate runs before the body read, so writes off gives 403, not 413.
- **Sizes:** worst case 189,359 B compact and 210,479 B escaped. The 256 KiB limit stays.
- **Form bodies (F1, fixed):** MVC form value providers read multipart and urlencoded bodies before the gate. The fix is in `AddFireworksControllers`. Test with a form-typed body too, not only JSON.
- **`Connection: close`:** Kestrel drops a connection whose unread body is over the current limit, and `ApiResponseHeaders` sends the header. Chunked bodies are not covered (Phase 7, Bowser's call). Reproduce with one `http.client` connection; curl reconnects and hides the failure.
- **Verification rig:** three instances on a scratch Postgres (writes off, user A, user B), started one at a time (two migrating at once race on `42P07`). Count queries with `Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command=Information`. zsh needs `env "K=V"` for dotted names, and loops belong in bash. `FIREWORKS_TEST_POSTGRES` must name a throwaway database.
- **Deploy checks:** S5 (a 200 KiB body must reach the app through Railway's edge) and S21 (the real client IP). One replica until migrations take a lock (Bowser F5).

## Learnings


### 2026-11-14 — Phase 5 security-review (client: share links, untrusted creation data)
- Record: `.squad/decisions/records/boo-phase5-security-requirements.md` (C1–C20). Luigi builds, Toad verifies. C18 (S5/S21 plus the S28 runbook) runs at the Phase 5 Railway round trip, which is the first test window.
- **Client-side path traversal is real here:** the WHATWG URL parser resolves `/api/creations/../me` and `/api/creations/%2e%2e/me` to `/api/me` (measured with node `new URL`), and the router decodes `/s/..%2Fme` into `../me`. So the §9 regex must run before every URL build, and `source.shareCode` comes from the response, never from the route param (C4).
- No existence oracle in the API: never-existed and deleted codes take the same `FindByShareCodeAsync` → fixed `NotFoundMessage` path, and delete is a hard `ExecuteDeleteAsync`. Side effect: schema §9's "never reused" is only probabilistic (info for Yoshi).
- The existing innerHTML ban (`designer-structure.spec.ts:64`) covers only `features/designer` and `app/shared`. Phase 5 surfaces need an app-wide spec (C1). §6.4 keeps Cf characters (U+202E), so bidi isolation of names is hardening (C3).
- **The accepted interim exposures are API-level. Don't let the UI widen them:** don't render `remixedFrom` (C10). Gate write controls on `canWrite`, never `isOwner`, which is true for every interim visitor (C9).
- I don't edit `.squad/decisions/README.md` even when a brief asks for an index line. I hand the proposed line to the coordinator, because promotion is Skyler's call.

### 2026-11-14 — Phase 5 security verification (after Luigi's batch 2)
- Record: `.squad/decisions/records/boo-phase5-security-verification.md`. Everything passes except C18, which is deferred to deploy. C3 partial isolation is accepted (low): every action is its own element, and bidi reordering can't cross elements. The cheap close is FSI/PDI (U+2068/U+2069) inside `quoted()` and the inline name sites.
- **Verifier gap F1:** Angular remaps `[innerHtml]` to `innerHTML` (`DOM_PROPERTY_REMAPPING` in `@angular/compiler`), so a case-sensitive `innerHTML` ban misses it. Interpolated `href="{{ name }}"` also slipped past the C2 regex. Always mutation-test sink bans with alternate Angular spellings. Skill: `.squad/skills/angular-unsafe-sink-ban/SKILL.md`.
- Tooling: the default `node` is v21, and Angular CLI 22 needs v22 or later. Use `PATH=~/.nvm/versions/node/v26.5.0/bin:$PATH`. Run a single spec with `npx ng test --watch=false --include <path>`.
- Toad mutates product files while running tests, so a full-suite run concurrent with Toad gives false failures. Check file mtimes before trusting a red run.
- Running-app rig: the ng dev server on 4200 proxies `/api` to the API on 5180. Playwright lives in the scratchpad `pw/` with `channel: 'chrome'`. Stub `navigator.clipboard` in `addInitScript`, and pre-set `fireworks.flashNotice.v1`. Delete the probe rows afterwards. `/s/%2e%2e` is normalized to `/` by the browser before the router sees it.

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **F1 closed:** Toad hardened `unsafe-sinks.spec.ts` (9 of 9: case-insensitive sinks, URL-attribute names in three spellings). **F3 closed:** `readSource(value, expected)` rejects a show `source` in the shell draft.
- **C3 closed:** Luigi's FSI/PDI isolation (`app/shared/bidi.ts` `isolate()`) in the review-fix round.
- **C17 re-check pending:** the final copy is in place (`TEST_MODE_TEXT`). Record the re-check result; your verification leaves it open.
- **C18 open at Railway:** S5, S21 and S28. Bowser runs them; you check the output.
- **Call for you or Yoshi:** Toad's C2 "name"-only heuristic.

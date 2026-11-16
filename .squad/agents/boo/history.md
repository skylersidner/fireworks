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

### Folded from Phase 0 to 2 (summarized 2026-11-14, compacted 2026-11-15)

- **Phase 0 ruling:** production writes are off until Phase 8 (OQ20). That makes OQ3 (a share link shows the latest edit) and OQ13 (owner-based deletion) acceptable in the interim. Restate both as conditions in each review.
- **Probe a clean publish, not the repo's build output** (skill `.squad/skills/probe-the-published-build/SKILL.md`): copy `src/api/Fireworks.Api` minus bin, obj and wwwroot to the scratchpad, `dotnet publish -c Release`, run Production on a scratch port (5199) with the real `wwwroot`. Before reporting a regression, compare the source mtime with the dll and rebuild from a copy.
- **Phase 1 pipeline:** Development settings are no longer published (they once switched on writes, CORS, Swagger and the developer page). `BuildHost-*` still lands in publish.
- **Phase 1 conditions** (`boo-phase1-pipeline-security-review.md`): `CanWrite` is checked in the service with an endpoint-enumerating 403 test; the limiter partitions by IP before Phase 8; ForwardLimit stays 1; `GET api/me/creations` sits under the write gate.
- **Phase 2:** no security review. The draft is client-only, and the server's strict validator (normalize with zero adjustments) rejects any document the client would adjust.

### Folded from Phase 4 (summarized 2026-11-14)

- **Requirements:** `boo-phase4-security-requirements.md` (S1–S29). S13 is overruled by Skyler: `remixedFrom` depends on `isOwner` alone (interim exposure accepted; the record is marked in place). Any owner-only field must be checked against the interim identity, because every visitor is the owner before Phase 8.
- **Route and gate traps** (skill `.squad/skills/aspnet-request-gates/SKILL.md`): the `regex(...)` route constraint is case-insensitive (the Kelvin sign reaches the action), so the share code uses a custom ordinal `IRouteConstraint`. With the `/api/{**rest}` catch-all, `[Consumes]` gives 404 and lets a missing `Content-Type` through, so use `HasJsonContentType()`. `[RequestSizeLimit]` raises a lowered global Kestrel limit. The gate runs before the body read, so writes off gives 403, not 413.
- **Sizes:** worst case 189,359 B compact and 210,479 B escaped. The 256 KiB limit stays.
- **Form bodies (F1, fixed):** MVC form value providers read multipart and urlencoded bodies before the gate. The fix is in `AddFireworksControllers`. Test with a form-typed body too, not only JSON.
- **`Connection: close`:** Kestrel drops a connection whose unread body is over the current limit, and `ApiResponseHeaders` sends the header. Chunked bodies are not covered (Phase 7, Bowser's call). Reproduce with one `http.client` connection; curl reconnects and hides the failure.
- **Verification rig:** three instances on a scratch Postgres (writes off, user A, user B), started one at a time (two migrating at once race on `42P07`). Count queries with `Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command=Information`. zsh needs `env "K=V"` for dotted names, and loops belong in bash. `FIREWORKS_TEST_POSTGRES` must name a throwaway database.
- **Deploy checks:** S5 (a 200 KiB body must reach the app through Railway's edge) and S21 (the real client IP). One replica until migrations take a lock (Bowser F5).

### Folded from Phase 5 and Phase 6 (summarized 2026-11-15)

- **Phase 5 (`boo-phase5-security-requirements.md` C1–C20):** client-side traversal is real. `new URL` resolves `/api/creations/../me` and `%2e%2e`, and the router decodes `/s/..%2Fme`. Run the §9 share-code regex before every URL build, and take `source.shareCode` from the response (C4). No existence oracle (delete is `ExecuteDeleteAsync`), so "never reused" is probabilistic (info for Yoshi). Don't render `remixedFrom` (C10). Gate write controls on `canWrite`, never `isOwner` (C9). Hand index lines to the coordinator.
- **Sink bans:** Angular remaps `[innerHtml]` to `innerHTML` (`DOM_PROPERTY_REMAPPING`), and interpolated `href="{{ name }}"` slipped past C2. Mutation-test sink bans with alternate Angular spellings (skill `.squad/skills/angular-unsafe-sink-ban/SKILL.md`). Names are isolated with `app/shared/bidi.ts` (C3).
- **Phase 6 (`boo-phase6-security-verification.md`):** C1–C17 PASS on shows. F2 (C2 and C14 verifier gap) and F5 were closed by Toad's rules 11–12 (`toad-phase6-show-review.md`). F3 (info): `normalizeShow`'s null prototype is lost by spreads and `structuredClone`; probe `constructor`, `toString` and `valueOf`. F4 (info): `<option>` labels aren't isolated, accepted under C3.
- **Client config:** `GET api/client-config` is four integers with `no-store` and `nosniff`; F1 (seek freeze) PASS on the running app (p99 frame 83 ms). Skyler declined Boo's tighter ranges (`SeekBudgetMs` 50, `CheckpointMemoryMiB` 128); the ranges stay as built.
- **Rig:** the 4200 dev server proxies `/api` to 5180. Stub `api/me` with `page.route` for C9. Pace real writes 3.2 s or more apart and delete probe rows. Measure input with Event Timing and `page.mouse.click`, since `locator.click` includes actionability waits.
- **Phase 5 close-outs:** F1, F3 (a show `source` is rejected in the shell draft) and C3 closed. C18 (S5, S21, S28) was carried to the Railway window, which Skyler deferred on 2026-11-15.
- **Tooling:** Node 26 via `PATH=~/.nvm/versions/node/v26.5.0/bin:$PATH`. Single spec: `npx ng test --watch=false --include <path>`. zsh has no `timeout`; long runs go to the background. Check mtimes before trusting a red run.
- **Memory probes:** read `driver.checkpointBytes` (typed-array buffers are invisible to `Runtime.getHeapUsage`); `schema/fixtures/valid/show/at-maximums.json` works as a draft; `JSON.parse('1e999')` is Infinity.

### Folded from Phase 7 A1, C1 and the post-gate update (summarized 2026-11-16)

- **CSP (`boo-phase7-security-requirements.md`, P7-S1 to S18):** `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`. `style-src 'unsafe-inline'` is an accepted residual (Skyler, 2026-11-15). Pixi's `pixi.js/unsafe-eval` no-ops both probes and costs +1.6 KB gzip. A bundle grep is never a valid CSP check; only runtime `securitypolicyviolation` is. Beasties' inline media-swap needs `inlineCritical: false`.
- **Cache-Control:** the share-code GET is `private, no-cache` with an ETag; everything else under `/api` is `no-store`. `ResponseHeaders` (replacing `ApiResponseHeaders`) normalizes a handled exception to `no-store` (the F1 ledger row, fixed by Bowser). Phase 8 needs `Vary: Cookie` on that GET (S18). Run a baseline before any mutant: `CacheControlTests.Every_hashed_file_in_the_built_wwwroot_matches` fails on a copy as well.
- **Findings:** F2 (info, closed): the `javascript:` and `ping` bypasses are blocked while `script-src` and `connect-src` stay `'self'`; reopen if either widens. F3 (info, closed by Luigi's `embeddedShell()`): the re-check is still open with Boo.
- **Probing:** probe a clean publish (skill `probe-the-published-build`). Use `curl -I` (`-X HEAD` hangs). Kestrel answers 400 and 431 itself, so only `AddServerHeader=false` reaches them. Hung-DB rig: a Python TCP proxy in front of 5433 with a `hang` flag (`scratchpad/boo-c1/proxy.py`); watch sockets with `lsof -p <pid> -a -i tcp:<port>`.
- **Traps:** zsh refuses a function named `g`. A single Playwright page across many paths stalled, so use one page per path, with timeouts.
- **Requirements:** S13 is narrowed (Skyler, 2026-11-15): gates run in Chromium; Firefox and WebKit moved to the daily run. S18 and the [R] items (S3, S8, C18, C20) stay open.

## Learnings

### 2026-11-16 — Interlude T2 fingerprint exception check

- Yoshi's F5 caller-pin exception (`engine/loop/golden/show-fingerprint.ts`) is safe: the module itself calls `openShow`. Its importers are only specs and `tools/`. Production `wwwroot` is clean (grep for `inputDigest` and `populationDigest`; `traceDigest` is legitimately in the driver). New F6 (low): "test-only" for `app/testing/` and `engine/*/golden/` is comment-only, so Toad should add an import ban with a negative control. `fingerprints.mjs` bundles in memory into `about:blank`; `tools/` is dockerignored. Addendum is in `boo-phase7-security-verification.md`.

### 2026-11-16 — Interlude cross-agent update (Scribe)

- **F6 is fixed; your re-check is open.** Toad added an import rule to `engine-boundary.spec.ts`: no shipped file outside `app/testing/`, `engine/*/golden/` and `engine/*/testing/` may import into those folders, type-only included. It has a synthetic-graph control and a positive check on the real tree. A mutant (`open-link-page.ts` importing `app/testing/show-fixtures`) was caught and reverted (`toad-interlude-final-tier.md`). Please re-check it against your F6 wording.
- **Daily carries the Firefox and WebKit CSP gates** (`toad-interlude-tooling-batch1.md` point 6): `gate-csp` in each engine fails the daily run if a page does not load clean and the stage does not run. The daily run is manual, and a gate needs a green daily under 24 h old.

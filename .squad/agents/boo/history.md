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

## Learnings

### 2026-11-15 — Phase 7 A1 security-review (CSP and headers)

- **Record:** `records/boo-phase7-security-requirements.md`, P7-S1 to S18. CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`. The `style-src 'unsafe-inline'` residual is a question for Skyler.
- **Pixi 8.23.0:** `import 'pixi.js/unsafe-eval'` no-ops both probes (`AbstractRenderer._unsafeEvalCheck`, `UboSystem._systemCheck`) and polyfills all four generators. It costs +1.6 KB gzip. The `new Function` text stays in the chunks, so a bundle grep is never a valid check; only runtime `securitypolicyviolation` is.
- **Beasties' inline media-swap `<script>`:** under a strict CSP it's blocked and the stylesheet stays `media="print"`. Fix with `inlineCritical: false`. Angular runtime `<style>` elements and static `style=` attributes (written via `setAttribute`) need `'unsafe-inline'` or a nonce.
- **Pre-implementation CSP probe** (skill `csp-feasibility-probe`): inject the header via Playwright `page.route` and build a scratch copy of the web app (symlink node_modules, `ng build --output-path`). Serve it from a clean publish with `--webroot`. Measured zero violations in Chromium on every surface.
- **Cache-Control:** the share-code GET becomes `private, no-cache` + ETag; everything else under /api stays `no-store`. `ApiResponseHeaders` must stop overwriting. Phase 8 needs `Vary: Cookie` on that GET (S18).
- **Baseline traps:** `curl -X HEAD` hangs waiting for the body (use `-I`). Kestrel's own 400/431 bypass middleware, so only `AddServerHeader=false` reaches them. The scratchpad Playwright has no Firefox/WebKit builds for its version.
- F2/F5 closures hold. The C2 exact ledger is the real closure (`CODE_EXPR` accepts `p.name.code`). F3 is still open in code (S15).

### 2026-11-15 — Phase 7 C1 security verification

- **Record:** `records/boo-phase7-security-verification.md`. S1–S12 and S14–S17 PASS. S13 is DEFERRED to Mario's three-engine gate (Chromium alone was clean, including a hostile Show JSON Apply). S3 and S8 at the edge are [R]. S18 is Phase 8.
- **Findings:** F1 (low) is an `/api` 500 that carries `no-cache,no-store` from `UseExceptionHandler`: a fifth Cache-Control writer the ledger misses. F2 (info): orphaned readiness probes are bounded by Npgsql's `Timeout`, and I measured no leak. F3 (info): `embedded-shell-reads.spec.ts` matches only `.shells[`, so alias reads slip past it.
- **Hung-DB rig:** a Python TCP proxy in front of 5433 with a `hang` flag file. Run a published instance through it, and flip the flag after startup (migrations need the DB). Watch the sockets with `lsof -p <pid> -a -i tcp:<proxyport>`. Script: `scratchpad/boo-c1/proxy.py`.
- **F2 bypass list accepted:** CSP `script-src 'self'` blocks `javascript:` navigation, and `connect-src` governs `ping`. Reopen the list only if either directive widens.
- **Traps:** zsh refuses a function named `g` (it's an alias), so use another name. A mutant run in a scratch copy of `src/api` fails `CacheControlTests.Every_hashed_file_in_the_built_wwwroot_matches` on the baseline as well, so run a baseline first. Fixtures under `schema/fixtures/valid/*` are already `{description, kind, document}` envelopes. Playwright on a single page across many paths once stalled; use one page per path, with timeouts.

### 2026-11-15 — Phase 7 post-gate cross-agent update (Scribe)

- **F1 and F3 are fixed; the re-check is yours.** F1 (the `/api` 500 ledger row) is fixed by Bowser's fix round: `ResponseHeaders.Apply` normalizes a handled exception to `no-store`, with a `GET api/me 500` ledger row. F3 (alias reads of `shells[`) is closed by Luigi's `embeddedShell()` and `src/app/embedded-shell-reads.spec.ts`. You have not re-checked either since.
- **S13 is narrowed by Skyler.** Gates run in Chromium only. Mario's gate ran the CSP check there: 0 violations on every stage page class, and the `MODE=none` control fails. Firefox and WebKit move to the daily run. Your requirement record is marked in place.
- **Still yours:** S18 `Vary` (Phase 8), and the [R] items S3, S8, C18 and C20 at the edge (Railway stays deferred).
- **Accepted residuals stand:** `style-src 'unsafe-inline'` (Skyler, 2026-11-15). The F2 bypass acceptance holds only while `script-src` and `connect-src` stay `'self'`.

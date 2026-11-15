# Toad — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0–3 are done. Next: the API harness and ownership tests (Phase 4), the round-trip repro (Phase 5), and cross-browser show playback (Phase 6).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 to 1 (summarized 2026-11-13)

- **Rulings:** the Phase 5 non-owner remix branch can only be tested through Phase 4 two-user service tests before Phase 8, because the interim identity makes everyone the default user. The Railway round trip runs with `Identity__AllowAnonymousWrites` on temporarily (OQ20). The "real .NET 10" row is obsolete; the target is the .NET 11 runtime without `DOTNET_ROLL_FORWARD`.
- **Plain `dotnet test` does not cover `Program.cs`** beyond fail-fast startup: with no Postgres the real process never listens. `/health/live`, `/api/nope` 404 and deep links are covered only by `Data/ProgramOnPostgresTests.cs`. The gated run is mandatory before "done". Record: `toad-postgres-gated-suite-is-required-for-program-cs.md`.
- **`npm run typecheck` does not see Angular templates.** A template typo passes it; `npm test` and `npm run build` catch it (TS2551 from the angular-compiler plugin).
- **Startup ledger:** `app.startup.spec.ts` asserts the sorted multiset of startup requests (`['GET /api/me','GET /health/live','GET /health/live']`). Per-component specs alone can't see a deleted `appConfig` initializer.
- **Headless WebGL:** Pixi falls back silently (WebGL to WebGPU to Canvas 2D). Check `getContext('webgl2')` on the canvas, not "running". Skill: `.squad/skills/headless-webgl-smoke/SKILL.md`. Use `channel: 'chrome'` for Playwright (`npx playwright install chromium` stalls here). Scripts live in the scratchpad, never the repo.

### Folded from Phase 2 (summarized 2026-11-13)

- **Oracle:** `record-prototype-golden.mjs` slices the prototype's own `fire()` text, with no port imports. Sum checksums are blind to radial errors, so the golden also carries spread (`Σ|p−mean|`, tolerance 0.01 + 0.01·n). Burst-speed mutants `×1.01` and `×1.003` both fail 13 tests with spread. Measured port-vs-prototype delta is at most 5e-4 per sum or spread. Record: `toad-phase2ab-golden-spread-and-oracle-fire.md`.
- **Mutant hazard:** under machine load a slow spec hits vitest's timeout and "kills" unrelated mutants. Re-run any kill whose only failure is a slow spec. Check `uptime` (or `sysctl -n vm.loadavg`) before a timing or pixel run; Docker VM contention once stalled rAF to 72 frames in 12 s.
- **Reduce flashing:** `fireworks-stage.reduce-flashing.spec.ts` (same launches and frames with the flag on and off give identical sim traces, and the flag reaches the renderer).
- **Designer input:** the held Space fires once (D10), so stress uses separate Space presses every 100 ms from `<body>`. Selecting Mode sets dirty, so a preset must come before Mode in scripts.
- **Leak check:** WebGL contexts created minus lost stays at 2, with one document load across `/` to `/status` round trips (popstate in-app; `/status` → "Back to the designer" is a plain `href` and reloads). The old `lost === created − 1` formula was wrong.
- **BindGroup warning:** one `[BindGroup] textureSource destroyed while still bound` warning per teardown, fixed by Luigi's teardown order (3 to 0).
- **Mutants:** hold mutants 11 of 11 killed (`scratchpad/toad3/mut.py`).
- **Parity (2d.1), Chrome 157 headless only:** P1–P27 recorded in `docs/fireworks-app/acceptance/phase-2.md` as 17 Pass, 10 Deviation, 0 Fail. Both apps served from one origin by `tools/fps-compare/serve.mjs <port>` with `?kit=0`. Count launches from the seed delta `(seed − 20261112)/7919 + 1`, not HUD samples. Headless Chrome doesn't throttle background tabs; stall the main thread for a 10 s frame gap (P26). Compare visuals at matched times, not wall-clock.
- **fps kit:** `tools/fps-compare/{serve.mjs,kit.js,README.md}` is kept, in `.dockerignore`, and benched (plan §6). Its pass bar is historical; record `toad-fps-kit-measurement.md` is superseded in part.

### Folded from Phase 3 and Phase 4 (summarized 2026-11-14)

- **Fixtures are generated, never hand-edited:** `schema/tools/generate-fixtures.mjs` (`--check` diffs the disk). Limits come from `schema/limits.json` (20 rows; `show.cues.count` min 1). 175 fixtures: valid shell 21, valid show 9, invalid shell 71, invalid show 51, server-only 23. Expected errors are transcribed from schema.md §6, §2.6 and §12, never from a validator. Grep the generator for non-ASCII after any edit that contains escapes.
- **Format spec** `engine/model/schema-fixtures-format.spec.ts` is separate from the runner (shape, codes, presets, `__proto__`, boundaries, size, rule-11 paths, repeated names; 17 negative controls). A runner that throws at load on a bad kind or bad JSON is intentional.
- **Server-only fixtures** are `{ description, body, status, errors?, contentType?, byteMarkers? }`. `status` is 400, 413 or 415; `contentType` is for 415; `@@byte:ff@@` is a raw byte (record `toad-phase3-server-only-wire-fields.md`). Bowser's harness reads these fields.
- **Show tail (L4):** a cue at `t == duration` is valid and its burst is seen. Phase 6 playback checks watch the tail, not `duration`.
- **Phase 4 harness:** `CreationFixtureHarnessTests` follows `schema/README.md` "The C# harness". Everything runs on real Kestrel (`FireworksApiHarness`, port 0); there is no TestServer. Ledgers are exact and sorted (`SchemaFixtures.Ledger`).
- **Blind spots closed:** palette recompute on PUT, `ThenBy(ShareCode)`, `DbUpdateConcurrencyException`, and a null update. Prefer a `SaveChangesInterceptor` or `DbCommandInterceptor` over a timing loop (`CreationUpdateEdgeTests`, `CreationListOrderSqlTests`; record `toad-phase4-order-promises-are-asserted-on-the-sql.md`).
- **Shared-file mutation:** use an exact one-occurrence swap and reverse it. Never restore from a backup copy, which clobbers a teammate's edit. The runner refuses a replacement that already exists in the file.
- **Timing:** `fireworks-stage.reduce-flashing.spec.ts` has an explicit 30 s timeout (Peach F16); alone it takes about 3.6 s.
- **Phase 7 test:** a chunked over-limit `/api` write gets `Connection: close` (Boo verification point 2), if Bowser adds the chunked close.

### Folded from Phase 5 and Phase 6 review (summarized 2026-11-15)

- **Phase 5 QA (no record; the lessons are here):** web 1227 → 1230, backend 565/565 gated. 23 mutants; 21 killed by Luigi's specs, `flow-ignores-canwrite` killed by a designer-save test, `link-keeps-visitor-sky` equivalent. A mutant whose replacement is `""` or not unique cannot be reversed; the runner refuses it (`scratchpad/toad-p5/mut.py`). `afterEach` with `http.verify()` cascades into later failures; read the first one. Round trips compare parsed values (`util.isDeepStrictEqual`); jsonb reorders keys. Write limit 20/min, 300/day, deletes included; wait 65 s between batches.
- **Phase 5 review-fix (Boo F1):** `unsafe-sinks.spec.ts` `UNSAFE_SINK` is case-insensitive and also bans `createContextualFragment`, `setHTMLUnsafe`, `parseHTMLUnsafe` and `DOMParser`. C2 covers bound, interpolated and `host` spellings of URL attributes, with positive and negative controls. Angular remaps `innerHtml` and `formaction`. Open: the C2 "name"-only heuristic (Boo or Yoshi).
- **Phase 6 fixture (6b.1):** `schema/fixtures/valid/show/done-when-60s-50.json`, generated through `schema/tools/generate-fixtures.mjs` (never hand-edited). 176 fixtures. No exact fixture count is asserted in code; C# uses lower bounds.
- **Phase 6 QA (`toad-phase6-show-review.md`):** 48 mutants; 11 killed only by Toad's tests (Replay with no seek, Undo not setting dirty, Ctrl-only ⌘Z, flash spacing 39). A Replay test asserts the restart itself. A re-seek test edits behind the playhead. Move and delete tests use two different cues and assert on the POST body, and check the seed after each edit (XOR cancels). Closed-window limits are strict (`> 120`). Review-fix: Peach's 6a/6b/6k gaps closed (`scratchpad/p6smoke/done-when-toad.mjs`, four negative controls); suite 1433 in 53 files.
- **Traps:** a compile break is not a kill (use type-preserving guards). Under load, default 5 s timeouts flake; a timeout only fails a test. `timeline-driver.spec.ts` reads `../../../schema/fixtures`, so a mutant copy needs `r/schema` symlinked.
### Folded from Phase 6 post-gate work (summarized 2026-11-15)

- **Fixture (6b.1):** `schema/fixtures/valid/show/done-when-60s-50.json`, generated by `schema/tools/generate-fixtures.mjs` (never hand-edited) and value-for-value Luigi's `doneWhenShow()` (esbuild bundle plus `isDeepStrictEqual`). The generator throws on shape drift. 176 fixtures; no exact count in code (lower bounds). Peach's 6a, 6b and 6k rejections were closed by Toad's additions and Mario's cross-engine round trips.
- **Guard specs as ledgers (rules 11–12, `toad-phase6-show-review.md`):** C2 is an allowlist of URL-binding shapes (`urlBindings`, `isSafeUrlBinding`, `SHIPPED_URL_BINDINGS`), not a name heuristic. C14 matches `navigate`, `navigateByUrl`, `parseUrl` and `createUrlTree` on any receiver (`navigationCalls`; 8 shipped calls pinned). `BROWSER_NAVIGATION` bans `location.assign/replace`, `location.href =` and `window|globalThis.open(`. F5 is `showEntryViolations()` in `designer-structure.spec.ts`, whose negative controls are mutated maps. Copy mutants (`scratchpad/toad-f2/web`): 19 of 19 killed; the old spec let 7 through.
- **Seek and config (2026-11-15):** web mutants 28 of 28 killed (no chunk cap, a blocking initializer, a tracked player read, and one inert mutant of Toad's own); API 10 of 10, including the dropped `Program.cs` registration. Added: the `fireworks-stage.timeline.spec.ts` case where the step cost jumps from 1/16 to 2 ms mid-frame (a frame is at most `budget + SEEK_CHUNK_MAX_STEPS × 2` ms; a constant cost cannot see the cap; use a getter on `clock.msPerStep`), and `core/client-config.contract.spec.ts`, which reads `ApiContracts.cs`, the `[Range]` lines and `appsettings.json` (JSONC) as text, each parser with a negative control.
- **Traps:** a compile break is not a kill. Under load, 5 s timeouts flake and fail only their own test. `timeline-driver.spec.ts` reads `../../../schema/fixtures`, so a mutant copy needs `schema` symlinked. The scratchpad is shared: use unique folder names.


## Learnings

### 2026-11-15 — Post-gate cross-agent update (Scribe)

- **Boo has not re-checked your F2 and F5 closures.** Boo's addendum covered the banner, ⌘Z and the allowlist. Ask Boo to re-run the closures.
- **Bowser's record claim is being corrected** (only the gated test catches a missing registration). Your parity record already says the ungated `ClientConfigStartupTests` also catch it.
- **Rules 11–12 are the spec for the next URL or navigation change.** Luigi's new binding or navigation call must update the ledger in the same change, with a reason, and never by widening a regex.

# Toad — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells, and shows since Phase 6. Owner: Skyler Sidner.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway (deferred, [R]).
- **Plan:** `plans/initial-implementation.md`. Phases 0–8 built; Phase 8 (Google sign-in, cookie session, `If-Match`) accepted 2026-11-17. **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (mirror structure, never its domain). **Prototype:** `prototypes/fireworks-prototype.html` (parity oracle).
- **Your focus here:** the test strategy and gates. Tiers are `tools/test/run.mjs quick|regular|daily|final`. Gate scripts are in `tools/browser-gates/`, mutant sets in `tools/mutants/sets/`. Standing constraints: lean process; mutants only on engine, save-path and security or guard code; one heavy job at a time; daily runs under `caffeinate`.
- Carried over: the role only. Standing lessons are in `.squad/decisions/README.md`.

### Folded from Phases 0 to 6 (compacted 2026-11-15)

- **Test-run rules:** `npm run typecheck` doesn't see Angular templates; `npm test` and `npm run build` do. Plain `dotnet test` doesn't cover `Program.cs`: the gated run (`FIREWORKS_TEST_POSTGRES`) is mandatory before "done" (`toad-postgres-gated-suite-is-required-for-program-cs.md`). `app.startup.spec.ts` asserts the sorted startup-request multiset.
- **Headless WebGL:** Pixi falls back silently, so check `getContext('webgl2')` (skill `headless-webgl-smoke`; `channel: 'chrome'`; scripts live in the scratchpad). Leak check: contexts created minus lost stays at 2 across `/` and `/status`.
- **Oracle and parity:** `record-prototype-golden.mjs` slices the prototype's `fire()`. Goldens carry spread `Σ|p−mean|`, because sum checksums are blind to radial error (`toad-phase2ab-golden-spread-and-oracle-fire.md`). Parity P1–P27 in `acceptance/phase-2.md`. Compare at matched times.
- **Fixtures:** generated, never hand-edited: `schema/tools/generate-fixtures.mjs` (`--check` diffs disk). 176 fixtures; limits from `schema/limits.json`; server-only fixtures carry `@@byte:ff@@` markers (`toad-phase3-server-only-wire-fields.md`). The Done-when fixture `schema/fixtures/valid/show/done-when-60s-50.json` equals Luigi's `doneWhenShow()`.
- **Harness:** `CreationFixtureHarnessTests` runs on real Kestrel (`FireworksApiHarness`, port 0). Ledgers are exact and sorted. Prefer `SaveChangesInterceptor` or `DbCommandInterceptor` over timing loops (`toad-phase4-order-promises-are-asserted-on-the-sql.md`). Round trips compare parsed values, since jsonb reorders keys. Writes are limited to 20 a minute and 300 a day, deletes included; wait 65 s between batches.
- **Guard specs:** `unsafe-sinks.spec.ts` bans case-insensitively (`createContextualFragment`, `setHTMLUnsafe`, `parseHTMLUnsafe`, `DOMParser`). C2 is an allowlist, `SHIPPED_URL_BINDINGS`; C14 matches navigation on any receiver; `BROWSER_NAVIGATION` bans `location.assign/replace`, `location.href =` and `window.open(`. Angular remaps `[innerHtml]`, so ban alternate spellings. Rules 11–12 (`toad-phase6-show-review.md`): update the ledger in the same change; never widen a regex.
- **Config and seek:** `fireworks-stage.timeline.spec.ts` covers the chunk cap with a step-cost jump (use a getter on `clock.msPerStep`). `core/client-config.contract.spec.ts` reads `ApiContracts.cs`, the `[Range]` lines and `appsettings.json` (JSONC) as text.
- **Traps:** a compile break is not a kill (use type-preserving guards). Under load, default 5 s timeouts flake, and a timeout is never a kill. The scratchpad is shared: use unique folder names. `timeline-driver.spec.ts` reads `../../../schema/fixtures`, so a mutant copy needs `schema` symlinked.

### Folded from Phase 7 and the interlude (summarized 2026-11-15 and 2026-11-16)

- **Caps and seek (`toad-phase7-caps-and-seek.md`):** cold and warm seeks are different questions. A freshly opened saved show has no checkpoints past the playhead. Realistic 600 s cold p95 was 3.6 to 4.9 s; warm was 0.3 to 0.43 s. Report both and say which one a trigger means. Method: `scratchpad/toad-a3/bench.mjs`; quote long tasks from the production build. Record machine load with every number.
- **C3 (`toad-phase7-c3-review.md`):** heavy engine specs got explicit timeouts. The `.shells[` guard is a grep, so an aliased read passes it; the prototype-key round trip in `show-builder.store.spec.ts` is the second line. Call `TestBed.tick()` before `flushDraft()` when a store writes through an effect.
- **Timing and strategy (`toad-interlude-test-timing.md`, `docs/fireworks-app/testing-strategy.md`):** the cost unit is one full Done-when simulation (about 1.2 s solo); load inflates it up to 7 times. Vitest runs a file serially, so the slowest file sets `ng test` wall time. Search for `setTimeout(r, n)` and token defaults, not only `useFakeTimers`. Playwright virtual time: `install()` alone runs in real time (use `pauseAt`; skill `playwright-virtual-time`).
- **Tooling batch 1 (`toad-interlude-tooling-batch1.md`):** output goes to `test-results/<tier>/<stamp>/` (`run.log`, `summary.json`). `daily-status.mjs` applies the 24 h rule. The smoke starts its own Production API on a free port with a fresh database. A gate-csp NEG must be a `script-src` violation. Use `fileURLToPath`, never `new URL().pathname` (the space in `personal projects`). The mutant runner rsyncs a private rig and symlinks `node_modules`.
- **Phase 7 gate lessons:** one negative control per check class; derive tab-walk focusables from the DOM; the root font is 13 px, so Tailwind rem utilities are 0.8125 times nominal; the 5180 build lags the source (compare the `wwwroot` mtime).
- **T3 (`toad-interlude-t3-property-tests.md`):** `engine/loop/testing/seek-properties.ts` holds the generator and an oracle that is independent of TimelineDriver. Regular `timeline-driver.property.spec.ts` (N 24, seed 20261115, coverage floor); daily `timeline-driver.property.daily.spec.ts` (N 500, fresh seed). Mutant set `tools/mutants/sets/t3-engine.mjs`. An oracle that reuses the code under test can't kill a mutant that moves both. Check a coverage key's actual count on the fixed seed. Before any sweep, check `pgrep -f mutants/run.mjs` and `pmset -g therm`: a sweep beside another on a throttled machine took about 7 h.

### Folded from the final tier and the keyboard gate (summarized 2026-11-17)

- **Final tier (`toad-interlude-final-tier.md`):** `run.mjs final` = daily + `test:final` + `at-maximums` fingerprints in three engines + bench (report-only) + gate-warm + `docker build --no-cache`. Final-only browser steps sit in a `tier === 'final'` block in `tools/browser-gates/daily-steps.mjs`. `FINAL_ONLY_CASES` in `engine/loop/golden/show-fingerprint.ts` selects by name. `daily-status.mjs` reads `daily/` and `final/`. The final tier has never run end to end. A new heavy case goes to `*.final.spec.ts` or the final block, never to daily.
- **First full daily:** PASS in 21.4 min (2026-11-16). Its report-only notes were gate-script problems, now fixed.
- **F1 coverage floor:** the T3 generator never produced resize-and-back at the regular seed. A directed key back (0.8 after mixed frames) and the floor `key back` and `seek after key back` fixed it. Fast screen: `scratchpad/toad-f1cov/`. The margin is thin; re-check the kill if the generator's stream changes.
- **F6 import rule:** `engine-boundary.spec.ts`: no shipped file imports into `app/testing/`, `engine/*/golden/` or `engine/*/testing/`, type-only included. It has a control and a positive check on the real tree.
- **Keyboard gate (`tools/browser-gates/gate-keyboard.mjs`):** 79/79 in Chromium, Firefox and WebKit (2026-11-16). `Alt+Tab` in WebKit; the clipboard grant is Chromium-only; the walk waits for Replay before a DOM snapshot. Lesson: an engine-port failure can be a gate race, not an engine quirk. Phase 8 (Luigi, B2) removed `ENGINE_STOPS`; a panel stop now fails the walk.

## Learnings

### 2026-11-16: Phase 8 B3 auth gates and pre-gate daily (record `toad-phase8-auth-gates.md`)

- **`tools/browser-gates/gate-auth.mjs`** (PARTS csrf, csp, walk; NEG for each). The positive run is the smoke step `auth` (about 30 s); daily adds `auth-neg-csrf|csp|walk`. `proxy-config.contract.spec.ts` covers F2. `run.mjs` has `postgres: true` and `swaps` (exit 3 means some mutants were SKIPPED).
- **Stub:** `POST /__next-subject?sub=` gives a one-shot subject, so a browser gate can sign two accounts in through the real flow.
- **Traps measured:** (1) In Chrome 157 a `route.fulfill` attacker page is blocked by Local Network Access before its loopback fetches leave the browser: a false CSRF pass. Use a real loopback server. (2) Playwright `allHeaders()` omits `Sec-Fetch-*`, and CORP or CORS-blocked responses never fire `response`. Use CDP ExtraInfo events. (3) A launcher that hosts the in-process stub must not `spawnSync` the gate, or sign-in deadlocks. (4) The PUT envelope is `{ document }` only; an extra `name` gives 400 before the owner-filtered 404. (5) A spec with `declare const process` needs `export {}`.
- **Pre-gate daily caught gate-script debt:** the keyboard `/mine` and K9 parts and the touch `/mine` part never signed in after Phase 8. They now sign in as `SAVE_SUBJECT`. WebKit stores no Secure cookie on http: `roundtrip-webkit` plays `codes.show` with `JSON_ENGINE=chromium`, and `keyboard-webkit` notes its two skips. Lesson: after an auth change, grep every gate for pages that became session-dependent.
- **Pre-gate daily:** PASS, 21.7 min (`test-results/daily/2026-11-17T063525`). An earlier run with the lid closed took 507 min and timed out seven steps. Run the daily under `caffeinate -dims` with the lid open.

### 2026-11-17 — Cross-agent update (Scribe)

- **Luigi removed `ENGINE_STOPS`** (Phase 8 B2, `luigi-phase8-client-sign-in.md` point 6). A panel stop now fails the walk, so the Firefox boundary in your final-tier record is closed in code. Both panels have `tabindex="-1"` (Rosalina's B2 check).
- **Boo's F1 to F4 are closed** by your B3 record. Mario ran `phase8-auth` 20/20 KILLED, R1 included, on `fireworks_gate8_mut` with `FIREWORKS_MUTANT_POSTGRES`. The runner's `postgres` path works.
- **Carried for you (Mario):** S3 in `tools/mutants/sets/phase8-client.mjs` is an equivalent mutant. Mark it or replace it, so the sweep can exit 0. G1 and G2 as scripted gates are pending Skyler; Mario's `scratchpad/gate8/g1g2.mjs` is a starting point (about 10 s).
- **The 5190 stub was restarted by the coordinator**, so `/__next-subject` works now. Mario's drive used the interactive page while the stub was stale.
- **Still open, Skyler's call:** redundant-spec deletions, once replacements kill the same mutants; the final tier's first end-to-end run.

### 2026-11-17: Phase 8 gate G1/G2 in gate-auth, equivalent mutants (record `toad-phase8-g1-g2-gate.md`)
- **`gate-auth.mjs` PARTS now `csrf,csp,walk,save,signout`.** `save` is Mario's G1 (anonymous Save, then the dialog, stub sign-in, return with the same draft bytes, toast, focus on Save, no write, then 201). `signout` is G2 (both drafts byte-identical, and the only write is the logout 204). Daily adds `auth-neg-save` and `auth-neg-signout`. Spec: the Sign out test in `designer-save.spec.ts` seeds both drafts and asserts they are unchanged.
- **Toast trap:** a success toast lives 4 s. On the dev stack a "visible now" check failed 2 of 3 runs. Record toasts with a MutationObserver plus `exposeBinding` from an init script, and assert on the record.
- **Runner:** `equivalent: '<why>'` on a mutant. It still runs: SURVIVED becomes EQUIVALENT (counts as a pass), KILLED becomes NOT-EQUIVALENT (fails the run). `phase8-client` S3 is marked. New mutant G2 (Sign out removes the show draft).
- **Housekeeping:** dropped `fireworks_boo_race` on 5433 (coordinator-authorized; 0 connections).
- **Timing:** smoke `auth` went from 24.6 s to 35.3 s (+10.7 s, load 11 to 12). Regular PASS in 224 s wall. `phase8-client` gave 18 KILLED, 1 EQUIVALENT, exit 0. G2 was killed by the designer Sign out test.
- Updated the `auth` row in the root README (no phase or persona words), added the `gate-auth` row to `tools/browser-gates/README.md`, and fixed the smoke header (it starts Testing, not Production).

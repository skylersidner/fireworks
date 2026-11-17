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

### Folded from Phase 8 auth gates (summarized 2026-11-17)

- **`tools/browser-gates/gate-auth.mjs`:** PARTS `csrf,csp,walk,save,signout`, each with a negative control (daily adds `auth-neg-*`). `save` is G1 (anonymous Save, sign-in, same draft bytes, no write before the 201); `signout` is G2 (both drafts byte-identical, the only write is the logout 204). `proxy-config.contract.spec.ts` covers F2. `run.mjs` has `postgres: true` and `swaps`; exit 3 means some mutants were SKIPPED. Mutant `equivalent: '<why>'` marks an equivalent: SURVIVED becomes EQUIVALENT, KILLED becomes NOT-EQUIVALENT (fails the run). `phase8-client` S3 is marked.
- **Stub:** `POST /__next-subject?sub=` gives a one-shot subject, so a gate can sign two accounts in through the real flow.
- **Traps measured:** (1) Chrome 157 blocks a `route.fulfill` attacker page through Local Network Access, a false CSRF pass; use a real loopback server. (2) Playwright `allHeaders()` omits `Sec-Fetch-*`, and CORP or CORS-blocked responses never fire `response`; use CDP ExtraInfo. (3) A launcher hosting the in-process stub must not `spawnSync` the gate, or sign-in deadlocks. (4) The PUT envelope is `{ document }` only. (5) A spec with `declare const process` needs `export {}`. (6) A success toast lives 4 s; record toasts with a MutationObserver plus `exposeBinding`, and assert on the record.
- **Gate-script debt:** after an auth change, grep every gate for pages that became session-dependent (`/mine` parts signed in as `SAVE_SUBJECT`). WebKit stores no Secure cookie on http: `roundtrip-webkit` uses `JSON_ENGINE=chromium`.
- **Daily runs:** under `caffeinate -dims` with the lid open. A lid-closed run took 507 min and timed out seven steps.

## Learnings

### 2026-11-17: redundant timeline-driver specs deleted (record `toad-redundant-spec-deletion.md`)
- **The first clean official `t3-engine` run:** 30 KILLED, 11 SURVIVED. T23 survives the property spec alone (the screen's single kill didn't hold) and every regular engine spec.
- **Proof set `tools/mutants/sets/t3-redundancy.mjs`** (62 mutants): the engine mutants from every set, plus K1/K2 (seek clamp and floor) and X1 (cross-run leak). `MUTANT_TIER=daily|all`. For per-test attribution, read the rig's `<id>.vitest.json`.
- **Deleted 19 tests:**
  - 9 in checkpoints;
  - 6 in timeline-driver: the seek block except clamp, and the digest "equal across runs";
  - 4 daily "same twice" cases;
  - also the `referenceRun` helper.
- **Kept and strengthened** "seek clamps and floors": K1/K2 survived all 1778 regular tests, because `advance` re-clamps and only the return value changes.
- **Regular:** 1778 to 1763 tests; unit-web 34.9 to 29.7 s; timeline-driver.spec 26.1 to 16.4 s.
- **Mutants after:** regular, 0 went from killed to survived. In the daily files alone T07 went from killed to survived; it is still killed by the regular property spec (thin: T07 now has one killer).
- **Lesson:** a sweep finishes in about 40–60 s per mutant at load 5–12; each 62-mutant sweep took 15–45 min. Before calling a run-twice test "kills nothing", add a non-deterministic mutant.

### 2026-11-17 — Cross-agent note (Scribe)

- **T21 and T23 gap, open:** both survive every regular engine spec, a gap that predates the cleanup. Luigi or Yoshi decides whether it is a spec or an equivalent. If asked, you write the test and prove it with `t3-redundancy` or a set like it.

### 2026-11-17: first end-to-end final tier (record `toad-final-tier-run.md`)
- **`run.mjs final`: PASS, complete, 75/75, 32.4 min wall** (`test-results/final/2026-11-17T105956`), with the uncommitted redundant-spec deletion. `daily-status` is OK on it. Big items: `test:final` 112 s; at-maximums fingerprints 128, 147 and 96 s (Chromium, Firefox, WebKit); docker no-cache 94 s; benchmarks 83 s.
- **Trap: Node version.** An agent shell resolves nvm's v21.5.0, and `ng` exits 3 in 1 s. `final`/`daily` keep going, so the browser steps then test a stale `wwwroot`. Prefix `PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"` (`.nvmrc` is 26.5.0). `engines` isn't enforced, so I recommended a preflight in `run.mjs`.
- **Cleanup after killing a run:** its Testing API is orphaned (ppid 1, `ASPNETCORE_ENVIRONMENT=Testing` on a random port). Kill it and drop `fireworks_{test,smoke}_final_<pid>`. Use `psql -U fireworks_app`; there is no `postgres` role. A killed run's folder has no `summary.json`, so `daily-status` ignores it.
- **Node cold seek p95** (bench, no warm-up): done-when-60 0.70 s and realistic-600 2.85 s, both lower than Phase 7. Browser after warm-up: 231 and 496 ms. These are the CPU-review inputs.
- The 4200 dev web server was down. The final tier doesn't need it (it starts its own API with the built `wwwroot`), so I left it down to keep the load low.

### 2026-11-17: end-review follow-ups (record `toad-end-review-followups.md`)
- **Node check `tools/test/node-version.mjs`:** the one source is `engines.node` in the web `package.json`; `.nvmrc` must fall inside that range. Strict parser with `--selftest`. `requireNode(label)` exits 2 in `run.mjs` (before `--list` too), `browser-gates/daily.mjs` and web sets of `mutants/run.mjs`. It isn't in the leaf gates, which inherit `process.execPath`. NEG: v21.5.0 gives exit 2 on all of them and creates no result folder. Trap: `lib.mjs` `baseEnv()` puts `dirname(process.execPath)` first on PATH, so a v21 runner handed v21 to every `ng` child. Its `NODE26` entry never helped.
- **`testing-strategy.md` §2.3** now holds measured times (final 32.4 min). The doc says `bench-seek-node` has no baseline (compared by hand), and that the round-trip NEGs run in Chromium only. §5.4's drift flag was never built. README final row: 32.4 min. The README stays phase-free (grep count 0).
- **T21** is killed by the new checkpoints test "from a finer grid, adds and counts only…", which asserts the return value. A later filter hides the mutated one, so only the count moves. **T23** is marked equivalent in `t3-engine.mjs`: F1 nulls the run key in `beforeStep`, the private method's only caller, right before the call. Its last kill predated F1. Targeted proof: `t3-redundancy-2026-11-17T18-40-51` (KILLED 1, EQUIVALENT 1).
- **T27 and T40:** T27 is equivalent in the app (one capacity per sim, and the shadow sim copies it) but killable at the API with two capacities. T40 is real: the snapshot has no sky, and the stage writes `sim.sky` itself. Proposed tests are in the record; the owner decides.
- **Lesson:** before writing a test for an old survivor, compare the date of its last kill with fixes to its callers. A fix upstream can turn a killable mutant equivalent.

### 2026-11-17: end-review step 4, fix-batch verification and governor trigger (record `toad-end-review-verification.md`)
- **Trigger does not fire:** realistic-600 in the player at DPR 2: p95 16.7 ms, main mean 7.9% (worst 30.1%, finale); stress at the cap at DPR 2: p95 33 to 16.8 ms, main 99.9 to 95%. True idle: 1.6% main, 1.3% GPU process. Load 3.4–8 (a Steam game was running): note load on every cell.
- **`gate-warm.mjs`:** done-when-60 is `skipped` at the shipped threshold, so `after`/`early` route-patch `` `WARM_UP_SKIP_COLD_RUN_MS`,{factory:()=>1e3} `` to 0 (exactly one hit) and require `finished`; a cold done-when-60 still passes its 1039 ms bar, so the bar alone can't certify warmth. New `natural` mode and `bench-warm-natural` (final). The 1 s delay had silently made `nowarm-check`'s "off at 1 s" true: both sides now wait 3 s for warm-up to leave `off`.
- **Browser checks of rendering:** count WebGL draws by wrapping `drawElements`/`drawArrays`; hide all DOM overlays (`*{visibility:hidden} canvas{visible}`) before a canvas screenshot, or the HUD reads as residue. Pixi's ParticleBuffer regrows ×1.5 and rewrites every static slot at each regrowth, so a stale-upload NEG must land in the slack; under `page.clock` a seek is one frame, which makes it deterministic (done-when-60: 3.5 s, 9.5 s, then 17.5 s; oracle via 27 s).
- **Findings for others:** option B's 15% trigger is borderline (15.4% / 16.4%); skipped done-when-60 seeks cold at p95 947–995 ms against the 1 s trigger; `reduced-motion-chromium` flaked once (4/4 in isolation), so the test-side wait is mine to add.
- Scripts: `scratchpad/toad-er/{render-checks,player-cpu,side,serve}.mjs`. `serve.mjs` runs as `node serve.mjs`: kill it by pid, since a `pkill -f` on the path misses.

### 2026-11-17: last verification batch (addendum to `toad-end-review-verification.md`)
- **`gate-warm.mjs` `SKIP_ON` is now a regex** over the numeric literal. It still needs exactly one hit and records `skipFrom`. after/early/natural all PASS at 700. The 14:03 `wwwroot` still had `1e3`; check the bundle string before you trust the brief's "the build now contains".
- **The skip probe under-predicts about 4×:** done-when-60 is predicted at about 250 ms (real cold run about 1.1 s), and realistic-600 at 1.4–1.8 s (real about 6.7 s). So done-when-60 is still `skipped` at 700 (cold p95 912, warm 263). Measure a prediction by route-patching the minified comparison to stash it on `window` (`scratchpad/toad-er/probe-pred.mjs`). Finding for Luigi and Yoshi.
- **Reduced-motion 7h.1 reads a settled switch** (stage running plus 450 ms stable, or 1.5 s stable) and logs a first sight that differed. A load repro with a self-terminating worker-thread burner (`scratchpad/toad-er/burn.mjs`, 14 threads, load up to 50) caught the designer switch unchecked on first sight once in 3 runs. The old read fails there; the new one passes, and the NEG still holds 12/12.
- **Regular:** PASS, 204.6 s.
- **Trap:** a `until ! pgrep -f "run.mjs final"` wait loop matches its own command line and never exits. Three of these from an earlier session are still sleeping, and the auto-mode classifier refused my kill.

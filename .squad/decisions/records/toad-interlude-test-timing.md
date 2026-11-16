# Toad: post-Phase-7 interlude, step 1. Where the test time goes

**Date:** 2026-11-15 (measured 19:17 to 19:26). **Tree:** Phase 7 commit 8eb99c7, no edits.
**Machine:** 12 cores. **The machine was not idle**, and I could not make it idle: VS Code renderers, the Docker VM and WindowServer used about 4 cores throughout. Load averages (1/5/15 min) were 20.8/9.1/6.4 at the start, 19–20 during the full `ng test`, 14 to 11 during the solo spec runs, and 6 to 10 during the .NET runs. Under this load every frontend number below is inflated, and parallel numbers more than solo ones. The solo runs give the uncontended figure.

Raw outputs are in the scratchpad: `/private/tmp/claude-501/-Users-skylerasidner-personal-projects-fireworks/f6e2093c-b754-4740-b772-e3141de720dd/scratchpad/toad-timing/` (`ngtest.json`, `solo-*.json`, `trx/plain.trx`, `trx/pg.trx`).

Classification key: **R** = fast, stays in the regular suite. **S** = slow but splittable or shrinkable, so it can stay regular after work. **D** = daily-only (also runs at the end of all phases).

## Headline

| Check | Wall (s) | Load | Class |
|---|---|---|---|
| `ng test` (68 files, 1,640 tests) | **124.4** (build 16.6 + vitest 103.6 + exit) | 20 | R overall; 4 files S |
| `npm run typecheck` | 10.0 | 10 | R |
| `prettier --check` | 6.5 | 9 | R |
| `ng build` (writes `src/api/Fireworks.Api/wwwroot`) | 10.1 | 9 | R |
| `dotnet build` (no-op / after touching `Program.cs`) | 15.3 / 3.3 | 8 / 6 | R |
| `dotnet test` plain, `--no-build` (661 pass, 12 skip) | 14.9 (xunit 10) | 8 | R |
| `dotnet test` plain, with build | 17.8 | 7 | R |
| `dotnet test` + `FIREWORKS_TEST_POSTGRES` (673 pass), `--no-build` | **41.8** (xunit 37) | 9 | R (mandatory: `toad-postgres-gated-suite-is-required-for-program-cs.md`) |
| `generate-fixtures.mjs --check` (176 fixtures) | 0.3 | 9 | R (**not wired into any suite today**) |
| `docker build` (fully cached, 11 cached steps) | 1.7 | 9 | D (uncached time not measured; that's the real cost) |
| Phase 7 browser gate, `scratchpad/gate7/` (Chromium only) | **≈ 1,160 s of logs, 21 min elapsed** 18:21 to 18:42 | 4.5–6 | D, with a possible small R subset (below) |

**Serial regular-suite total today** (ng test + typecheck + prettier + ng build + dotnet build + Postgres-gated dotnet test + fixtures): **about 205 s (3.4 min) at load 8 to 20.** The in-repo suite already meets the 5-minute target. Everything over the target is the browser gate and the real-time plays, and those are not in the repo.

## 1. Frontend `ng test`

The vitest summary: tests 58%, environment 29%, setup 10%, transform 2%, import 1% of aggregate worker time. The 1,640 test bodies sum to 377 s across workers. 1,338 tests run under 0.1 s, 233 under 1 s, 33 take 1–3 s and 36 take ≥ 3 s. **The 69 tests at ≥ 1 s account for 286 s (76%) of all test-body time.**

**The wall is set by one file.** Vitest runs a file serially in one worker, so the run can't finish before `timeline-driver.spec.ts` (101 s under load) does. The other 67 files finish inside its shadow. Splitting that file, or making its long runs cheaper, is the only change that moves `ng test` wall time much. The next ceiling is `fireworks-stage.phase7.spec.ts` at 58 s.

No unit test waits on a real clock. Frames are synthetic (`frame(dt)` calls), and the only `setTimeout`s are 0 ms microtask flushes. Fake timers appear in 4 files (`app.spec`, `notifications`, `shell-designer.store`, `announcer`). **All the slow time is simulated steps**: full Done-when show runs (`runToEnd`), long seeks and checkpoint fills.

### Slowest 15 files

| File | Full run, load 20 (s) | Solo, load 11–14 (s) | Tests | Class | Why slow |
|---|---|---|---|---|---|
| `engine/loop/timeline-driver.spec.ts` | 100.9 | 39.5 (45.9 wall) | 51 | **S** | 67 `.seek(` and 9 `runToEnd`; nearly every test runs the Done-when show or a long seek. Critical path. |
| `app/shared/fireworks-stage/fireworks-stage.phase7.spec.ts` | 58.5 | 28.6 (37.1 wall) | 37 | **S** | end-clamp runs at 10/60 fps to `endStep`; warm-up fills |
| `app/features/show/pages/show-builder-page/show-builder.store.spec.ts` | 55.0 | 14.1 (21.1 wall) | 28 | **S** | two ledger-diff tests make 10 full Done-when runs (below) |
| `app/shared/fireworks-stage/fireworks-stage.timeline.spec.ts` | 22.1 | – | 16 | S | real-time-shaped frame runs compared with the offline ledger, seeks |
| `app/features/designer/pages/designer-page/designer-page.spec.ts` | 16.5 | – | 53 | R | TestBed page; ~0.3 s/test |
| `engine/sim/simulation.spec.ts` | 15.8 | – | 36 | R (one S test) | the 40k sustained-load test is 11.4 s |
| `app/features/designer/pages/designer-page/designer-save.spec.ts` | 13.9 | – | 39 | R | TestBed |
| `app/features/designer/pages/open-link-page/open-link-page.spec.ts` | 11.8 | – | 26 | R | TestBed |
| `engine/sim/lifetime.spec.ts` | 9.9 | – | 25 | R | |
| `app/features/show/pages/show-builder-page/show-builder-page.spec.ts` | 9.9 | – | 9 | R | first test 5.5 s (lazy route plus first stage) |
| `engine/sim/golden/prototype-golden.spec.ts` | 9.6 | – | 17 | R | |
| `app/features/player/pages/player-page/player-page.show.spec.ts` | 8.2 | – | 12 | R | Replay test runs the show to its end (3.5 s) |
| `app/features/show/pages/show-builder-page/show-builder-page.phase7.spec.ts` | 8.1 | – | 30 | R | |
| `app/features/player/pages/player-page/player-page.spec.ts` | 4.8 | – | 29 | R | |
| `app/features/show/pages/show-builder-page/show-builder-page.a11y.spec.ts` | 3.8 | – | 9 | R | |

The other 53 files: under 3.6 s each. Class R.

### Slowest 30 tests (full run, load 20; solo figure where measured)

| s | File | Test | Kind |
|---|---|---|---|
| 36.55 (solo 5.1) | show-builder.store | ledger diffs: moving cue A in t and x changes only A's row (6c.3) | 4 full Done-when runs |
| 15.41 (solo 7.4) | show-builder.store | ledger diffs: deleting cue A (6c.4) | 6 full Done-when runs |
| 12.25 (solo 2.9) | stage.phase7 | end clamp: an edit after the end re-seeks to the end | long seek |
| 11.41 | simulation | sustained load never exceeds 40,000 | cap run |
| 11.18 (solo 2.7) | stage.phase7 | end clamp at 10 fps stops at endStep exactly | run to end |
| 8.75 | timeline-driver | checkpoints every 1200 steps; a seek from one equals a straight run at the cap | full run ×2 |
| 8.09 | stage.phase7 | end clamp at 60 fps stops at endStep exactly | run to end |
| 7.27 | timeline-driver | a seek lands within one checkpoint spacing of work | seeks |
| 6.96 | timeline-driver | 60, 144 and 24 fps frames equal a straight run | 3 full runs |
| 6.11 (solo 3.4) | timeline-driver | trace digest equal across runs, loop or offline, after a seek | full runs |
| 5.48 | show-builder-page | /show lazy route, one live stage, paused at 0:00 | first-test TestBed cost |
| 5.40 | timeline-driver | same show, same ledger, trace and final state twice | 2 full runs |
| 5.38 (solo 3.0) | timeline-driver | refuses checkpoints across traceDigest settings | full runs |
| 4.56 (solo 2.9) | timeline-driver | negative control: one seed changed by 1 changes the digest | 2 full runs |
| 4.47 | timeline-driver | a width change drops checkpoints | seeks |
| 4.42 (solo 4.5) | stage.phase7 | an edit restarts warm-up from the edit point | warm-up fill |
| 4.37 | prototype-golden | two fresh sims give identical integer state | 2 sims |
| 4.35 | stage.phase7 | warm-up finishes and says so on the host | warm-up fill |
| 4.21 | stage.timeline | real-time frames, a pause and odd frame sizes give the offline ledger | full run ×2 |
| 4.12 | timeline-driver | Done-when show ends within its bound, same step twice | 2 full runs |
| 3.98 | timeline-driver | keeps checkpoints before the first changed cue; re-seek exact | seeks |
| 3.97 | stage.timeline | Reduce flashing changes nothing in ledger, count digest or end | 2 full runs |
| 3.93 | timeline-driver | over the memory cap the spacing doubles | checkpoint fill |
| 3.91 | timeline-driver | shadow-sim checkpoints are exact on the visible one | warm-up fill |
| 3.88 | timeline-driver | the worst shell at the limits ends ~21 s after launch | long run |
| 3.82 | timeline-driver | twin: only checkpoints before the first differing step | fills |
| 3.65 | timeline-driver | a twin runs on its own sim | fills |
| 3.60 | stage.timeline | edit behind the playhead re-seeks from a kept checkpoint | seek |
| 3.60 | timeline-driver | refuses another sky; keeps the memory cap | fills |
| 3.57 | timeline-driver | seek to k equals a straight run, forward and backward | seeks |

**Load inflation is large and uneven:** the 6c.3 test is 5.1 s solo and 36.6 s in the full run (7×). Under parallel load the heavy sim tests share cores with each other. That is also why the 5 s default timeouts flake under load (C3), and why 21 tests carry explicit 20 to 60 s timeouts.

**Cost unit:** one full Done-when (60 s, 50 cues) simulation costs about **1.2 s solo** at load 11–14 (6c.4: 7.4 s for 6 runs). The suite runs it, or an equivalent long seek, dozens of times. This is the unit Yoshi's engine proposal should make cheaper (shorter fixture shows, shared precomputed ledgers, or headless step batching).

## 2. Backend `dotnet test`

| Run | Wall (s) | xunit duration (s) | Sum of test durations (s) | Tests |
|---|---|---|---|---|
| plain, `--no-build` | 14.9 | 10 | 82.9 | 661 pass, 12 skip |
| plain, with build | 17.8 | 9 | – | same |
| Postgres-gated, `--no-build` | 41.8 | 37 | 116.4 | 673 pass |

Fixed overhead: about 5 s of `vstest` host start and discovery per run (wall minus xunit duration).

### Slowest classes (Postgres-gated run)

| s | Tests | Class | Kind | Class |
|---|---|---|---|---|
| 23.8 | 5 | `ProgramOnPostgresTests` | real Program as a child process (`ApiProcess`) on Postgres; migrate, all fixtures, phase7 headers, rate limit | R (mandatory) |
| 9.8 | 45 | `CreationEndpointTests` | in-process host | R |
| 7.6 | 15 | `ETagTests` | | R |
| 7.5 | 5 | `ProgramStartupTests` | `ApiProcess` fail-fast startups | R |
| 6.6 | 20 | `FormBodyGateTests` | | R |
| 6.4 | 7 | `ClientConfigStartupTests` | `ApiProcess` | R |
| 6.1 | 10 | `CreationRateLimitTests` | | R |
| 5.5 | 6 | `ResponseHeaderTests` | | R |
| 3.8 | 178 | `CreationFixtureHarnessTests` | real Kestrel, all fixtures: 21 ms per fixture | R |

### Slowest tests

| Plain (s) | PG (s) | Test |
|---|---|---|
| – | 7.23 | `ProgramOnPostgresTests.Real_program_serves_every_fixture_and_the_creation_round_trip…` |
| – | 5.69 | `ProgramOnPostgresTests.Real_program_serves_the_phase7_headers_caching_etag…` |
| 1.59 | 5.37 | `CreationRateLimitTests.Reads_including_the_catch_all_api_me_and_client_config…` |
| 3.62 | 5.19 | `ProgramStartupTests.Control_with_a_valid_DefaultUserId…` (process) |
| 4.39 | 4.94 | `ApiCacheControlLedgerTests.Only_the_share_code_GETs_200_and_304…` |
| – | 3.79 / 3.59 / 3.46 | `ProgramOnPostgresTests` migrate / rate-limit 429 / client-config override |
| 3.49 | – | `CreationUpdateEdgeTests.A_delete_that_lands_between_the_PUTs_load_and_save…` |
| 3.42 | 2.89 | `CreationSourceDeletedMidWriteTests.A_remix_whose_source_is_deleted…` |
| 3.20 | 3.12 | `HealthReadyTests.Ready_gives_up_within_the_timeout…` (a real timeout) |

**Race tests:** none use round counts or timing loops. The mid-write races are driven by interceptors (`toad-phase4-order-promises-are-asserted-on-the-sql.md`), so they cost one host start each (about 3 s), not rounds. The only `Task.Delay`s are a 5 ms one (`CreationRepositoryTests`), a 2 s guard in `HeaderExpectations`, and the 50 ms readiness poll in `ApiProcess`.

**Harness overhead:** the 2 to 4 s at the top of the plain list are mostly the first test in each class paying for host start and JIT, not the test bodies. The 17 real-process tests (`ApiProcess`) cost about 37 s of the 116 s PG test-time sum, but xunit runs them in parallel collections, so wall is 37 s. **There is no Postgres container start in the suite**: it uses the already running `fireworks-postgres` on 5433 and drops and recreates the named database.

## 3. Browser scripts (scratchpad only), from the Phase 7 gate logs

Durations are log birth time to last write (`stat -f %B` / `%m`), from Mario's gate run in `scratchpad/gate7/` at load 4.5–6. The `toad-c3/gate/` logs were appended by re-runs, so their spans are unreliable (keyboard: 1,388 s), and I used gate7 instead.

| Script / log | s | What makes it long | Class |
|---|---|---|---|
| `gate-csp.mjs` NEG (`csp-none.log`) | **488** | each stage page waits its full 30 s `running` timeout, which never arrives with scripts blocked (plus 2.5 s fixed waits) | D (or R if the NEG timeout drops to ~3 s: ≈ 60 s) |
| `gate-roundtrip.mjs` (`rt.log`) | 93 | real-time player run to the end of a 66 s show | D (`SKIP_PLAY=1` run is 13–14 s: candidate R) |
| `gate-keyboard.mjs` NEG focus / walk / real | 94 / 35 / 34 | tab walks across pages | D |
| `gate-csp.mjs` real | 63 | fixed 2.5 s + 2 s waits per page | D |
| `gate-warm.mjs` early / after | 55 / 32 | p95 seek measurement (realistic 600 s show) | D (measurement, never regular) |
| `notfound.mjs` | 32 | | D |
| `gate-follow.mjs` real / NEG | 25 / 25 | contains a fixed 10 s real-time wait each | D |
| `gate-touch.mjs` real / NEG | 17 / 18 | | D |
| `gate-reduced-motion.mjs` real / NEG | 17 / 17 | | D |
| `rt-tamper` | 14 | | D |
| `headers.py` (`main.log`, 287 checks) | 1 | | R candidate (already duplicated in C#, below) |
| **Total** | **≈ 1,160** | 21 min elapsed including DB restore and startup | |

The daily run multiplies these by three engines (`ENGINES=chromium,firefox,webkit`), so it lands at about 60 min before any trimming. Earlier smoke scripts (Phase 6 `p6smoke/`, e.g. `final-chromium.log`: 82 s for a real-time Done-when play; `cross.log` 163 s for three engines) have the same real-time shape.

## 4. Duplication across layers

| Behavior | Where it's tested | Note |
|---|---|---|
| Done-when show runs to the same end and ledger | `timeline-driver.spec` (40 refs), `show-builder.store.spec` (10 full runs), `fireworks-stage.timeline.spec`, `fireworks-stage.phase7.spec`, `player-page.show.spec` (Replay to end), `gate-roundtrip` (real-time 93 s), `p6smoke/done-when*.mjs` | The same 60 s simulation runs at five or more layers. The engine layer is the oracle, and the upper layers mostly need "the host calls the driver", not another full run. |
| Determinism | `prototype-golden.spec`, `timeline-driver` determinism and digest, `stage.timeline` real-time vs offline, `cross-browser-determinism-oracle` scratch runs | |
| Cache-Control, ETag and security headers | `CacheControlTests` (42), `ETagTests`, `ResponseHeaderTests`, `ApiCacheControlLedgerTests`, `ProgramOnPostgresTests` phase7 headers, `gate7/headers.py` (287 checks) | The C# real-Program test and the ledger appear to cover most of what `headers.py` checks. `headers.py` adds the published build's real hashed asset names. I haven't mapped them line by line; that's a step-2 item. |
| CSP | `ResponseHeaderTests` / Program test (header value), `gate-csp.mjs` (browser enforcement) | The browser part is the only proof the policy doesn't break the app: keep it, but daily. |
| Fixtures | `CreationFixtureHarnessTests` (178), `ProgramOnPostgresTests` every fixture, `schema-fixtures.spec.ts`, `schema-fixtures-format.spec.ts`, `generate-fixtures --check` | Intended: C# and TS parity is the point. `--check` is the only unwired one. |
| Rate limits | `CreationRateLimitTests` (harness), `Real_program_rate_limits_writes…` (real Program) | Intended: the README shows the plain run passes a deleted `UseRateLimiter()`. |
| Reduce flashing / reduced motion | `fireworks-stage.reduce-flashing.spec`, `stage.timeline` 6a.6, `gate-reduced-motion.mjs` (CSS) | Different properties; not real duplication. |
| Keyboard | `show-builder-page.a11y.spec`, `focus-never-drops` specs, `gate-keyboard.mjs` | The browser walk checks real Tab order, which jsdom can't. |

## 5. Harness overhead vs test bodies

| Suite | Startup | Bodies |
|---|---|---|
| `ng test` | Angular build 16.6 s (2.7–4.8 s on the cache, with one file); jsdom environment 29% and setup (TestBed and polyfills) 10% of worker time, about 2.8 s and 1 s per file at load 20 | 58% of worker time, and 76% of that is the 69 tests at ≥ 1 s |
| `dotnet test` plain | build 3–15 s; vstest about 5 s; first test per class about 2–3 s of host start | most of the 661 tests are milliseconds |
| `dotnet test` PG | the same, plus 17 child-process Program starts (about 2–7 s each); no container start | |
| Browser gate | the API and the published build must already be running on 5180 or a port, plus a DB restore | most time is fixed waits and timeouts, not checks |

## 6. Where tests live today

**In the repo and run by a suite:**
- `npm test` (`ng test`): 68 `*.spec.ts` files under `src/web/fireworks-web/src`, including guard specs (`unsafe-sinks`, `designer-structure`, the `client-config` contract), the prototype golden and the fixture specs.
- `dotnet test`: `src/api/Fireworks.Api.Tests` (673 tests; 12 run only with `FIREWORKS_TEST_POSTGRES`).
- `npm run typecheck`, `ng build`, and prettier (only as `npm run format`, a write; **there's no `format:check` script**).

**In the repo but run by no suite:**
- `schema/tools/generate-fixtures.mjs --check`.
- `src/web/fireworks-web/src/engine/sim/golden/record-prototype-golden.mjs` (regenerates the golden).
- `tools/fps-compare/` (benched).
- The README negative-control table: a record, not runnable.
- **There is no CI** (no `.github/workflows`), so "the suite" is whatever someone runs by hand.

**Only in the session scratchpad (`/private/tmp/...`), not reproducible from the repo. This is a risk:**
- **The whole browser gate:** `toad-c3/gate/gate-{csp,follow,keyboard,reduced-motion,roundtrip,touch,warm}.mjs`, `gate7/headers.py`, `headers-neg.py` and `notfound.mjs`. These carry 7b, 7g, 7h, 7i, 7j and 7l acceptance and their negative controls.
- Phase 6 smoke and cross-browser scripts (`p6smoke/*.mjs`), `pw/*.mjs` (CSP probes, Boo's hostile-input probes, context-leak checks), and the Phase 2 leak and fps scripts.
- **The mutant runners** `toad-c3/mut.py`, `apimut.py` and `apimut2.py`, and the earlier `toad-p6` runners. The mutant kill record exists only as prose.
- The seek benchmark `toad-a3/bench.mjs` (+ `bench-entry.ts`), the source of the 7l.5 bar and the caps decision.

The scratchpad lives under `/private/tmp` and is session-scoped. One cleanup loses every gate check that isn't a spec. The daily suite can't exist until these move into the repo (for example `tools/browser-gate/`, with `ENGINES` and `BASE` env vars), so this is a step-2 prerequisite, not an option.

## 7. First-pass classification summary

- **Regular (R), already under budget:** all of `dotnet test` (plain and PG), typecheck, prettier `--check`, `ng build`, `--check` on the fixtures (once wired in), and 64 of 68 spec files.
- **Slow but splittable (S):** `timeline-driver.spec.ts` (sets the `ng test` wall on its own; split into 3–4 files, or cheaper show fixtures), `fireworks-stage.phase7.spec.ts`, `fireworks-stage.timeline.spec.ts`, `show-builder.store.spec.ts`. For that last one: compute the ledger-diff tests' baseline ledger once, or move the full-show variants to daily and keep a short-show variant regular. The 40k sustained-load test in `simulation.spec.ts` is similar.
- **Daily-only (D):** the browser gate on all three engines, real-time plays (`gate-roundtrip` without `SKIP_PLAY`, `gate-follow`'s 10 s waits, `p6smoke`), the seek measurements (`gate-warm`, `bench.mjs`), the uncached `docker build`, mutant runs.
- **R candidates from the gate** (step 2 to confirm): a Chromium-only subset that needs the published build up: `headers.py`, `gate-roundtrip SKIP_PLAY=1` (about 14 s), and `gate-csp` real with the NEG timeout cut. About 1.5 min total. Whether a running server belongs in the regular suite is a step-2 question.

## Boundary

This is measurement only. Nothing was restructured. These numbers came from one loaded run per suite. Before any split is judged by its gain, repeat the `ng test` measurement at load ≤ 4 and compare like with like (same load, same machine). I ran `ng build`, which rewrote `src/api/Fireworks.Api/wwwroot` to the current source. That is the build's normal output, not a source edit. I dropped my leftover `fireworks_test_toad_c3` database and this run's `fireworks_test_toad_timing` from the shared Postgres.

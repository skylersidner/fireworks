# Yoshi: fast show testing, engine side (post-Phase-7 interlude)

> Superseded in part by `toad-interlude-final-tier.md` on 2026-11-16. The daily row (`at-maximums`, the bench) moved to the final tier, and daily is about 25–30 min (Skyler, 2026-11-16). The T2 and T3 designs stand as built (`yoshi-interlude-t2-fingerprints.md`, `toad-interlude-t3-property-tests.md`).

**Status:** proposal (2026-11-15). Toad merges it with his timing inventory into one proposal for Skyler. Nothing here is adopted, and no code was changed.
**Plan:** `plans/initial-implementation.md`, "Interlude after Phase 7". Target: the regular suite under 5 min; anything longer goes to the daily suite.
**Timings:** "alone" numbers come from comments in the specs and from records (Toad C3, my Phase 6 measurements). Everything marked *est.* is my estimate from step counts at 0.12 ms/step (Done-when density) and 1.6 ms/step (40k cap). Toad's inventory supersedes my numbers wherever they disagree.

## What

Six techniques, in priority order. Each one names the checks it replaces, what it keeps, and the confidence it loses.

### T1. Exactness lives in the engine; the stage and pages prove delegation on a short show

**Rule:** a long show through jsdom or a browser proves nothing that a long show in a Node engine spec doesn't, except long-run resource behavior, which goes to the daily run (T4). The stage specs already follow this rule in part: `fireworks-stage.timeline.spec.ts` `shortShow()` (3 s, 12 cues) is the 6a.5 oracle. Extend it to:

| Spec | Today | Change | Saves (alone, *est.*) | Keeps / loses |
|---|---|---|---|---|
| `fireworks-stage.phase7.spec.ts` "end clamp" (60 and 10 fps), "an edit after the end…" | Done-when to its end through jsdom frames, 3 runs (up to 20,000 frames each, 60 s timeouts) | `shortShow()` (move it to `app/testing/show-fixtures.ts`) | 3–5 s → under 0.5 s | Keeps: the clamp is "reported step == endStep", which doesn't depend on length. Loses nothing; the Done-when end is pinned in the engine (T2). |
| `fireworks-stage.phase7.spec.ts` warm-up block | `show30()` (30 s, about 4,800 steps per warm-up) with default 1,200-step checkpoints, about 10 tests | A 4 s show with `checkpointSteps: 120` passed to `new TimelineDriver` | about 10× fewer shadow steps | Keeps: handoff, run key, edit restart and budget assertions. The expected grids change from `[1200, 2400, 3600]` to `[120, …]`. One existing engine spec still pins the 1,200 default (`timeline-driver.spec.ts` "are taken every 1200 steps…"). |
| `show-builder.store.spec.ts` 6c.3 and 6c.4 | 10 full Done-when runs, only to read `ledger` (4.7 s + 6.6 s alone, 24.8 s under load) | `scheduledLedger(show, width)` test helper (below) | about 11 s → under 0.2 s | Keeps: every row compared. See the proof obligation below. |
| `player-page.show.spec.ts` `offlineLedger` | full runs for ledger and end | ledger from the helper; `end` from the T2 golden for the fixture | *est.* 1–2 s | Keeps: exact ledger and end. |
| Builder page specs (`show-builder-page*.spec.ts`, `show-save.spec.ts`) | No `STAGE_CLOCK` (0 of 5 files inject it), so every fake frame spends up to `WARM_UP_IDLE_MS` (12 ms) of **real** clock warming the Done-when show (`show-builder-page.spec.ts:122` comment), and seeks run on a real 25 ms budget | `provideStepClock()` in `app/testing` (T5) | *est.* 1–2 s per mounted spec, and the specs become deterministic | Keeps all page behavior. It removes a real flake source: today steps per frame depend on machine load. |

**Why the ledger needs no sim (code-settled, `engine/loop/timeline-driver.ts` `beforeStep`):** a row is `{ step: k, id, shell, seed, x, tx: x * worldWidth(), ty }`, written when `fireStep <= k`. Nothing in it reads particle state. So `scheduledLedger` = `advance(loop, lastFireStep + 1)` on `new FireworksSim({ capacity: 1 })`; only the shells in flight are stepped. **Proof obligation:** one engine spec pins `scheduledLedger(doneWhenShow()) toEqual` the full-run ledger, plus a negative control (a mutant that makes `tx` read `sim.particles.n` must fail it). I recommend a test helper rather than a product API, because no product code needs it.

### T2. Committed show fingerprints (integer goldens), recorded once and compared in one run

- **Recorder** `engine/loop/golden/record-show-golden.mjs`, which mirrors `engine/sim/golden/record-prototype-golden.mjs`: esbuild-bundle the engine, run each fixture show to its end in Node, and write `show-golden.ts` (`as const`, Prettier, byte-identical on re-run).
- **Per show and per run key** (width 1280, budget 1, cap 40k; plus one row at capacity 2500): `endStep`, `lastFireStep`, an FNV hash of the ledger, the existing `traceDigest` (per-kind counts after every step), and `kindCounts` plus `n` and `shellCount` every 600 steps.
- **Integer only.** No position or velocity hash. Deaths are `age >= life` only (`cross-browser-determinism-oracle` skill), so counts, ledger and end are exact across JS engines and Node upgrades, while floats from `sin`/`cos`/`exp` are not. Full-store exactness stays a run-vs-run comparison inside one process, where it belongs.
- **Fixtures:** every `schema/fixtures/valid/show/*.json` except `at-maximums` in the regular suite. That set is the short shows plus `done-when-60s-50`, which costs one run (about 1.1 s). `at-maximums` (600 s, 1,000 cues) is daily only (*est.* 1–3 min at the cap).
- **Replaces:** tests that run a show twice to prove "same twice": `timeline-driver.spec.ts` "the Done-when show… ends… on the same step twice", the first half of "trace digest… equal across runs", and `TimelineDriver determinism` "same show gives the same ledger…". They become one run compared with the golden. The 2a.9 "two sims interleaved in one process" spec stays; it is the only check for module-global leakage.
- **Confidence:** stronger than run-vs-run. A sim change that shifts every run the same way passes today's self-consistency checks and fails a golden. The cost is that a golden records the port, not an oracle (the prototype has no shows). Self-consistency properties (T3) stay to say the behavior is *right*; the golden says it hasn't *moved*.
- **Update policy (confirmation, not a question):** schema.md §8.1, standing: "prototype goldens are regression guards updated by reviewed change". Show goldens follow the same rule. A re-record is a reviewed diff with a sentence saying why.
- **Cross-browser use (daily):** run the same bundle in Firefox and WebKit via `page.evaluate` (the method in the `prototype-oracle-golden` skill) and compare with the goldens. That gives cross-engine agreement on a 60 s show in seconds, with no production readout (the skill warns that a readout is real cost). It is report-only, because cross-browser means "it runs" (standing, Skyler 2026-11-14). A mismatch is a finding, not a gate failure, unless Skyler asks for it to fail the run.

### T3. Seeded property tests on small bounded shows for seek exactness

- **Generator** (mulberry32, no new dependency): 2–6 cues, `t` in [0, 3] s with forced same-step ties, shells from a fixed subset (crossette, crackle, a 4-break, glitter), capacity in {800, 2500}, so the cap is hit, `checkpointSteps` in {37, 60, 120} (odd intervals expose modulo bugs), and width in {1000, 1280}.
- **Actions:** random sequences of `seek(target, maxSteps)`, loop frames at {1000/24, 1000/60, 1000/144}, an edit with `{ from }` (move, delete last, delete all, add), and `twin()` plus `adoptCheckpoints`.
- **Oracle:** one straight run per case records snapshots at every target the case will visit, so each case costs one oracle pass. Assert the exact store, ledger and `endStep`.
- **Budget:** regular N = 25 with a fixed seed (*est.* 2 s alone). Daily N = 500 with a fresh seed that is printed on failure for repro.
- **Replaces:** the long Done-when seek cases in `timeline-driver.spec.ts` "checkpoints", "warm-up handoff" and "inherited after an edit", which today seek to 4,000–7,000 steps of the 60 s show. The same equivalences hold at 120-step spacing in a 3 s show.
- **Keeps as named cases:** D1 (strict-prefix receiver, `endStep` 1113), M8 (off-interval pin), the `<=` firing rule, tie order, the seek reset, the 1,200 default, and the memory-cap doubling (`checkpointBytes` option). Each is cheap and documents a past defect.
- **Proof obligation (standing, `toad-verify-the-verifier`):** before a fixed-case spec is deleted, the property test must kill every mutant that spec killed (N1–N5, M8, and the Phase 6 controls in `yoshi-phase6-timeline-driver.md`). This runs once, serially, with the machine otherwise idle (my lesson from D1).
- **Confidence:** wider path coverage (random target sequences and budgets) than the fixed cases. What it loses: realistic density (about 5k live particles). That stays covered by the one Done-when golden run (T2) and the daily N = 500.

### T4. Virtual time in the browser (Playwright `page.clock`) on short fixtures

- **Feasibility (code-read; probe required).** Playwright 1.65 (`scratchpad/smoke/node_modules/playwright-core`) fakes `requestAnimationFrame` and `performance.now`. The Pixi ticker (`engine/render/pixi-renderer.ts` `start`) runs on both, and its `deltaMS` caps at 100 ms (`minFPS` 10). `EngineLoop` clamps to 0.1 s (12 steps). So `clock.fastForward(100)` in a loop gives one real rendered frame per 0.1 s of show. A 60 s show plus its tail is about 700 rendered frames instead of 4,000+ real frames.
- **Trap (code-settled, `fireworks-stage.ts` `runSlice`):** under a frozen clock, `left = budget - (now - start)` never reaches 0. A seek therefore lands in one frame, and **warm-up runs the whole show in the first idle frame**. That is fine for a short builder fixture. It is minutes for a 600 s builder show, and it makes "Catching up…" unobservable. So virtual-time browser runs never open long shows in `/show`, and budget and catching-up behavior stay in the jsdom specs (`fireworks-stage.timeline.spec.ts` "seek budget is time, not steps", `phase7` 7l.6), which already use a per-step fake clock.
- **Probe P1 (a hypothesis until it runs, per my Phase 3 lesson):** on the production image with the real CSP, `page.clock.install()`, then `/s/<8 s fixture>`, fast-forward, and check that `player-ended` appears, Replay works and there are no console errors. Also check that the init-script clock survives `script-src` without `unsafe-eval`; if it doesn't, use the measurement context (`bypassCSP`) as the gates already do. **Owner: Toad.** It can't run now (Toad is timing on an idle machine).
- **Regular `gate-roundtrip` (Chromium):** the builder part as today (13 s wall in `rt-chromium.log`), but "Play 3 s" and the four `draftNow` 700 ms sleeps become `clock.runFor` or polling (−5 s). The player part plays an **8 s fixture to its end under virtual time** (*est.* 3–6 s) instead of the 66 s show in real time (about 70 s). Total *est.* 70–85 s → 15–20 s.
- **What only the real-time 66 s play proves:** long-run resource behavior (GPU texture and trail-buffer growth, pool growth, no late `console.error`) under real rAF pacing. It moves to the **daily** run, in Chromium, Firefox and WebKit (that is where cross-browser "it runs" lives, standing 2026-11-15), with the existing negative controls (`TOAD_INJECT_ERROR`, `TOAD_HIDE_ENDED`). Confidence lost in the regular run: a leak that shows only after about 10 s of real play is caught a day later, not at commit.

### T5. One step-driven test clock, shared

`app/testing/stage-clock.ts` `provideStepClock({ liveMsPerStep = 1/16, shadowMsPerStep = 6 })`. It packages the pattern already in `fireworks-stage.phase7.spec.ts:137–149` (a spy on `FireworksSim.prototype.step` advancing a fake `STAGE_CLOCK`), restored in `afterEach`.

- Charging shadow steps at 6 ms gives 2 warm-up steps per idle frame (a slice runs one step, sees 6 ms used, runs one more, and is out of budget). Warm-up becomes nearly free in specs that aren't about warm-up.
- Live seeks stay at 400 steps per frame against the 25 ms default.
- The warm-up specs keep their own clock, with the exact per-frame budget assertions.
- Every stage-mounting spec then has load-independent steps per frame. Toad's "12 ms of real clock per idle frame" disappears from page specs, and the remaining cost is sim work only.
- This is a test seam over the existing `STAGE_CLOCK` token, with no product change.

### T6. Performance measurements move to an opt-in benchmark job with baselines

- **What moves:** `gate-warm.mjs` (all modes), seek p95 and cold/warm, warm-up time from load, paused frame times, long tasks, and the caps runs from `toad-phase7-caps-and-seek.md`.
- **Baselines:** each run writes JSON (it already does) and compares with a committed `baselines/<machine>-chromium.json`.
- **Drift thresholds (numeric, not "revisit"):**
  - Flag when a p95 is above 1.25× its baseline in 2 consecutive daily runs. The two-run rule absorbs the ±20 % load noise recorded in `seek-cost-measurement` step 6.
  - Always flag the standing triggers: p95 seek above 1 s on a saved show (Show Builder v1 row), the 7l.5 early bar (p95 ≤ 4,330 ms or ≤ 1.2× its paired no-warm-up baseline), and `CheckpointMemoryMiB` above 128 (the coarse-pointer clamp).
  - Invalidate any run whose recorded load average is above 6 (the comment in `gate-warm.mjs`).
  - Keep the `nowarm-check` control with the bench.
- **Report-only:** the bench never fails the daily run. Performance is benched until the end of the project, and no gate checks fps (standing). The exactness parts of `gate-warm` ("missed" seeks) are already covered in jsdom (7l.7 specs) and stay in the bench at no extra cost.

### T7. Smaller items

1. **"One run, many assertions" within a file:** a memoized `referenceRun(show, key, targets)` in `beforeAll` that returns deep-frozen snapshots, never a live sim. The ~15 `straight(doneWhenShow(), k)` oracle runs in `timeline-driver.spec.ts` and the stage specs collapse into one pass per show. Oracle targets must be recorded steps: restoring a recorded snapshot to reach a nearby target would test `restore` with itself.
2. **Don't cache checkpoint grids across spec files.** Vitest isolates workers, and an on-disk cache brings invalidation risk. T2 goldens are the cross-file cache that is safe to commit.
3. **40k sustained-load spec** (`simulation.spec.ts`, 1,200 steps at the cap, 1–2 s alone): the property ("never exceeds capacity; every live index has age < life") doesn't depend on capacity. Run it at `capacity: 2500`, pin `CAP === 40000` separately, and keep the 40k run in the daily suite.
4. **Worst-shell tail spec** (`timeline-driver.spec.ts` "ends about 21 s after launch"): keep it regular, because it is the only check that the §13 bound is tight. It needs the worst shell, not the 600 s offset. A cue at `t = 0` gives the same tail and skips 72,000 empty steps (*est.* −0.2 s).
5. **Real sleeps outside the engine:** `show-save.spec.ts:186,208` (600 ms ×2) and `designer-save.spec.ts:118,537,543` (350 ms ×3), about 2.3 s, should use fake timers or the injected timers. Owner: Luigi or Toad.
6. **Gate scripts out of the scratchpad.** All `gate-*.mjs` live in `/private/tmp/…/scratchpad/toad-c3/gate/` and import Playwright from another scratch folder, so no pipeline can run them. Move them to `tools/browser-gates/` with their own `package.json`, mirroring the reference's `tools/<name>/package.json` (`/Users/skylerasidner/personal projects/monster-of-the-week-net-angular/tools/fal-image-gen/package.json`). Every gate must exit non-zero on its own (it mostly does today).

### Tiers, as the engine side sees them

| Tier | Contents (engine-side) | *est.* wall time added |
|---|---|---|
| Regular (< 5 min total; Toad owns the sum) | All unit, engine and jsdom specs after T1, T3 (N = 25), T5 and T7; T2 goldens for the short fixtures plus Done-when; `gate-roundtrip` with T4 (Chromium) | engine and stage specs *est.* 15–25 s alone (today about 45–60 s alone, 2–5 min under load); browser smoke 15–20 s |
| Daily | T2 `at-maximums`; T3 N = 500 with a fresh seed; the 40k sustained load; real-time 66 s play in 3 engines; T2 cross-engine goldens in Firefox and WebKit; T6 bench | 10–20 min, dominated by `gate-warm` and the real-time plays |
| End of all phases (final review) | Daily, plus the end-of-project CPU review (standing) | — |

## Why

- Skyler's wording settles the browser question: "find a way to test shows that doesn't depend on playing them in real time or seeking through them in a browser". So T4 removes real-time play from the regular tier; it is not offered as an option.
- The engine is the only place where exactness can be checked cheaply. It is pure, runs in Node and is deterministic (my Phase 2a boundaries). Every long run outside the engine re-proves an engine property at 5–50× the cost.
- Committed integer fingerprints are the one technique that makes a long show cheap *and* cross-engine. They also catch the regression class that self-consistency misses.
- The trap in T4 (frozen clock means unbounded budgets) is why budget semantics can't move to the browser tier. The jsdom step clock is already the right tool for budgets.

## Boundary

- **Proposal only.** Nothing binds until Skyler adopts it through Toad's merged proposal.
- **Implementation owners if adopted:**
  - Luigi: the T1 spec changes, the T5 helper, `scheduledLedger`, `referenceRun`.
  - Toad: the T3 generator and its mutant proof, T4 probe P1 and the gate move, T6 baselines.
  - Yoshi (or Toad): the T2 recorder. I review boundary compliance; recorders sit beside the sim, as the prototype recorder does.
- **Deletion rule:** no existing spec is deleted until its replacement has killed the same mutants (T3 proof obligation). Long-show specs move to the daily tier; they are not dropped.
- **No product change** is required by T1–T7. `scheduledLedger` and `provideStepClock` are test helpers.
- **Open for Skyler** (it touches a standing decision, so I'm not inventing an answer): plan §5 says "No CI", but Skyler wants this to "scale to deployment pipelines". This proposal makes every tier pipeline-ready (exit codes, no scratchpad paths, no real-time waits, recorded seeds). Whether and when a pipeline actually runs it is Skyler's call.

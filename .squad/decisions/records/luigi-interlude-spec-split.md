# Luigi: testing interlude, batch 1 (spec side). Daily split, scheduledLedger, step clock, fake timers

**Date:** 2026-11-15. **Plan:** "Interlude after Phase 7"; `docs/fireworks-app/testing-strategy.md` §3 items 1, 2, 3, 6, 7 and 9 (adopted by Skyler). **Commits:** none (not authorized).

## What

1. **Daily files hold the long cases, unchanged.** Moved verbatim (same titles and bodies) from the Phase 7 tree (`8eb99c7`):
   - `engine/loop/timeline-driver.daily.spec.ts`: 15 Done-when cases (determinism twice and at 3 frame sizes; checkpoints at 1200 spacing at the cap, one-spacing seek, width change, memory cap, shadow sim; the 4 warm-up handoff cases; inherit "keeps checkpoints before the first changed cue"; trace digest across runs and its NEG; "ends within its bound twice").
   - `app/shared/fireworks-stage/fireworks-stage.phase7.daily.spec.ts`: 11 cases (end clamp at 60 and 10 fps, edit after the end, and the 8 warm-up cases that warm `show30()` to its end).
   - `app/features/show/pages/show-builder-page/show-builder.store.daily.spec.ts`: 6c.3 and 6c.4 over 10 full Done-when runs.
   - `engine/sim/simulation.daily.spec.ts`: the 40k sustained-load run (T7.3).
   Regular is `ng test --exclude="**/*.daily.spec.ts"`, daily `--include="**/*.daily.spec.ts"` (Toad's `test:regular`/`test:daily` use the same globs). No `angular.json` change was needed.
2. **Regular equivalents prove the same property smaller.** `engine/loop/testing/timeline-spec-helpers.ts` (`smallShow()` 12 cues in 3.3 s, `SMALL_CP` 120, `SMALL_CAP` 2500, `straight`, `referenceRun`). `timeline-driver.spec.ts` is split: checkpoints, handoff and inherit go to `timeline-driver.checkpoints.spec.ts`. Stage end clamp runs on `shortShow()` (moved to `app/testing/show-fixtures.ts`); warm-up-to-the-end cases run on `show4()` at 120-step spacing. Sustained load runs at capacity 2500 with `CAP === 40000` pinned.
3. **`app/testing/scheduled-ledger.ts` `scheduledLedger(show, width)`**: capacity-1 sim, stop one step after the last cue. Store 6c.3/6c.4 use it. `scheduled-ledger.spec.ts` pins it against full runs at widths 1280 and 1000, plus a stop-step control.
4. **`app/testing/stage-clock.ts` `provideStepClock()`** (T5): `STAGE_CLOCK` advances per `TimelineDriver.beforeStep`, 1/16 ms live and 6 ms for `twin()` shadows. It's installed on first inject and restored by TestBed teardown. It's used in `fireworks-stage.spec`, `fireworks-stage.reduce-flashing.spec`, `show-builder-page{,.a11y,.phase7}.spec` and `player-page{,.show}.spec`. `stage-clock.spec.ts` pins 2 shadow steps per idle frame, 400 seek steps per frame and the restore.
5. **Fake timers** (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`) in `designer-save`, `open-link-page`, `show-save` and the store spec. Waits are `advanceTimersByTimeAsync(exact debounce)`. The store spec has an explicit edge (−1 ms nothing, +1 ms written), and `show-save` asserts that the baseline draft exists before its byte-identical check.
6. **`referenceRun`** serves the regular seek block's oracles from one straight run, with checkpoints off and recorded steps only.
7. `fireworks-stage.timeline.spec.ts` gets `testTimeout: 30_000`. It already runs on a per-step fake clock; 6a.5 timed out at 5 s under load (coordinator report).

## Mutant proof (copied trees with `schema`, `docs` and `src/api` symlinked; `scratchpad/luigi-int/mut/`)

Runner: `mut.py` (exact swap with md5 restore; timeouts classified separately, and none occurred). Old = the Phase 7 tree; reg = the new regular files; daily = the new daily files.

- **Timeline driver, 40 mutants.** Regular kills 33: T01–T21, T24–T31, T33, T34, T37, T39, T40, including N1–N5, M8, M9, W1–W7 and td-inherit-none. T07 (restore wrong digest) survived the first small digest case. The case now restores two 120-step checkpoints, and T07 is killed.
  - Regular survivors: T22 adopt min spacing, T23 checkpoint ignores the run key, T32 twin without `from`, T35 checkpoint forgets `endStep`, T36 inherit keeps its own spacing, T38 digest skips step 1.
  - The daily files, run on every mutant the regular set first missed or that had to be rerun (T07, T22, T23, T30, T32, T35, T36, T38, T40), kill only T07, which regular now kills too. No moved test kills a mutant the regular set misses. The six regular survivors are gaps in both sets, listed under Boundary.
- **Old seek block** (modified in place to use `referenceRun`; old run filtered to `TimelineDriver seek`): every mutant it killed is killed by regular.
- **Stage, 9 mutants** (W8/M10, W9, no hand-back, no take, warmed key ignores width, warm-up past the end, end clamp off, edit re-seeks to 0, budget swap): all killed by the regular `fireworks-stage.phase7.spec.ts`.
- **Store edits, 5 mutants** (move-same-step-too, move-reseeds, delete-same-step-too, move keeps x, and the NEG "ledger row reads the sim"): killed by old and by regular. The NEG is killed by `scheduled-ledger.spec.ts` as well as the store spec.
- **Draft debounce, 5 mutants.**
  - The +1 ms mutants (designer and show) survive old, because a real 350/550/600 ms sleep covers them. Regular kills them.
  - Designer 400 ms: killed by old and by regular.
  - Show "no debounce": killed by regular.
  - Designer "no debounce": survives both (none of these 4 files checks that the designer's draft is absent inside the window; `shell-designer.store.spec.ts` owns that).
- **Sim:**
  - P01 (spawn past the cap): killed by old and regular.
  - P02 (death at `age > life`): survives old and regular (float equality is never hit).
  - P03 (ParticleStore default capacity): equivalent, because `FireworksSim` always passes `capacity ?? CAP`.
- **Helper NEGs:** C01 (a twin not marked as a shadow) and C02 (clock never restored) are both killed by `stage-clock.spec.ts`.

## Why

- `timeline-driver.spec.ts` alone set the `ng test` wall time (77–110 s under load). Particle-steps, not show length, set the cost: compressing the 60 s show into 6 s costs the same. So the regular cases cut cues and capacity, not seconds.
- Moving tests verbatim makes the daily kill set exactly the old tests' kill set, so the proof reduces to "regular kills what daily kills".

## Boundary

- **Counts.** Before: 1,640 tests in 68 files. After: 1,647 regular in 71 files, plus 29 daily in 4 files, for 1,676. That is the 1,640, plus 29 regular equivalents, 1 `CAP` pin and 6 new helper specs (3 for `scheduledLedger`, 3 for `provideStepClock`). Nothing was deleted.
- **Wall time** (`ng test`, this machine, 12 cores, shared with other agents): before 90 s at load 15–17 (126 s at 11–22). After: regular 53 s at load 7→23, slowest file `timeline-driver.spec.ts` 37.6 s; daily alone 61 s at load 22→12. Compare only at equal load (Toad's §7 step 8 measures at load ≤ 4).
- **Gaps in both the old and the new sets, not introduced here:** T22, T23, T32, T35, T36, T38, P02. They belong to Toad's T3 property tests or Yoshi's driver specs, not this batch.
- Specs that test budgets or warm-up keep their explicit clocks (`fireworks-stage.phase7.spec.ts`, `fireworks-stage.timeline.spec.ts`).
- No product code changed.

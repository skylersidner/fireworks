---
name: daily-spec-split
description: Moving a slow spec to the daily tier (`*.daily.spec.ts`) without losing a kill, and making the regular equivalent cheap (small shows, scheduledLedger, provideStepClock, fake timers, reference runs). Use when a spec file sets the `ng test` wall time, or before replacing a long test.
---

# Splitting slow specs into regular and daily

**Domain:** frontend specs (engine, stage, pages) · **Confidence:** high (Luigi, testing interlude batch 1, 2026-11-15; mutant-proved)

## Rules
1. **Move, never delete.** The long case goes to `<name>.daily.spec.ts` verbatim (same title, same body). Regular runs `ng test --exclude="**/*.daily.spec.ts"`; daily runs `--include="**/*.daily.spec.ts"`. No `angular.json` change is needed: `@angular/build:unit-test` takes both flags. **Final tier (2026-11-16):** a case too heavy even for daily (the `at-maximums`/extreme-show runs) goes to `<name>.final.spec.ts`, run only by `run.mjs final` (`npm run test:final`); `test:regular` and the quick tier exclude both suffixes. A golden whose recorded `case` carries its tier stays byte-identical: select the final-only cases by name (`FINAL_ONLY_CASES` in `show-fingerprint.ts`), and pin the names in a regular spec so a typo can't drop a case from both tiers.
2. **The regular equivalent proves the same property at a smaller size,** not a weaker one: same assertions, a shorter show, a finer checkpoint grid (`SMALL_CP` 120 instead of 1200), a capacity other than the default (`SMALL_CAP` 2500, so run keys are tested off-default). Scale every step constant (4371 → a cue on 360; 3600 + 517 → 840 + 51).
3. **Cost is particle-steps, not show length.** Compressing the Done-when cues into 6 s costs as much as the 60 s show (same stars × lifetimes). Cut cues or capacity instead: 12 cues at cap 2500 is about a tenth.
4. **Mutant proof before the old test leaves regular** (`exact-swap-mutants`): run each mutant against the old file in a copy of the old tree, the new regular files and the daily file in a copy of the new tree (both with `schema`, `docs` and `src/api` symlinked). Every mutant an old test killed must be killed by the new regular set; note any killed only by daily.
5. **One spec file is one worker.** Split a long file by topic (`timeline-driver.spec.ts`, `.checkpoints.spec.ts`) so its halves run in parallel.

## Helpers
- `app/testing/scheduled-ledger.ts` `scheduledLedger(show, width)`: the ledger from the schedule alone (capacity-1 sim, stop one step after the last cue). Pinned by `scheduled-ledger.spec.ts` against a full run; its NEG is a row that reads the sim.
- `app/testing/stage-clock.ts` `provideStepClock()`: a `STAGE_CLOCK` that advances per `TimelineDriver.beforeStep` (1/16 ms live, 6 ms for `twin()` shadows), installed on first inject and removed on TestBed teardown. Use it in every spec that mounts a stage but isn't about budgets or warm-up.
- `engine/loop/testing/timeline-spec-helpers.ts`: `smallShow()`, `doneWhenShow()`, `straight()`, `referenceRun(doc, targets)` (one straight run recording frozen snapshots at recorded steps).
- `app/testing/show-fixtures.ts` `shortShow()`: the 3 s, 12-cue stage fixture.

## Fake timers in TestBed page specs
- `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` in `beforeEach`, `vi.useRealTimers()` in the `afterEach` `finally`. `fixture.whenStable()` and `RouterTestingHarness` still settle (only `setTimeout` is faked).
- Replace `new Promise(r => setTimeout(r, ms))` with `vi.advanceTimersByTimeAsync(ms)`. Advance by exactly the debounce constant: the `+1 ms` product mutant then fails, which a real 350 ms sleep never could. Add an explicit edge case (`DEBOUNCE - 1`: nothing; `+1`: written).
- A "draft is byte-identical" check is vacuous if the draft was never written: assert the baseline is non-null first.

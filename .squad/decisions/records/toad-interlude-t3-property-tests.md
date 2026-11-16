# Toad: testing interlude batch 2, T3 seeded property tests for seek exactness

**Date:** 2026-11-16. **Plan:** testing strategy §3 item 5, §7 steps 5–6; Yoshi's T3 (`yoshi-interlude-show-testing.md`). **Commits:** none (not authorized).

## What

1. **Property tests** (spec and helper code only):
   - `src/web/fireworks-web/src/engine/loop/testing/seek-properties.ts`: the generator (mulberry32; 2–6 cues in 0–3 s with forced same-step ties; crossette, crackle, a 4-break, glitter; capacity 800 or 2500; spacing 37, 60 or 120; memory cap of 1, 2 or 4 snapshots in half the cases; width 1000 or 1280). Actions: budgeted seeks with a moving target and targets on held checkpoints, loop frames at 24/60/144 fps, resize, a starBudget quality change, edits through `{ from }` (move, re-seed, add, delete last (D1), delete all, extend past the end), and a twin warmed toward its end with `adoptCheckpoints` both ways.
   - The oracle is independent of TimelineDriver: its own schedule, firing driver, FNV digest and end detection. One straight pass per (document, run key) compares the store, the shells in flight, the ledger, `endStep` and the digest.
   - The model checks the bookkeeping: twin = its source; inherit = `from`'s spacing and exactly its checkpoints at or before the documented divergence step (with D1); adopt interval ≥ the wider spacing, on the merged grid; no checkpoint taken while the run key differs; the grid and memory cap hold; each seek runs exactly `target − base` steps, capped by its budget.
   - `timeline-driver.property.spec.ts` (regular): fixed run seed 20261115, N = 24, plus a coverage floor (cap reached, restore past the end, D1 shape, adopt across spacings, edit after the end, key changes and more).
   - `timeline-driver.property.daily.spec.ts`: N = 500 on a fresh printed seed.
   - Replay: `T3_CASE_SEED=<n>` (one case) or `T3_SEED=<n>` (a run). `T3_VERBOSE=1` with `--reporters=verbose` prints the coverage.
   - `timeline-driver.run-key.spec.ts`: finding F1 pinned as two `it.fails` tests plus a control.
2. **Mutant sets:** `tools/mutants/sets/t3-engine.mjs` holds Luigi's T01–T40, run against the property file **alone**, plus F03 against `shell-designer.store.spec.ts`. The 9 stale `p6-web` mutants are re-taken from current source: `node tools/mutants/run.mjs --check p6-web` reports 65 applying and 0 stale. They have not been run.

## Proof status (fast screen, not yet the official runner)

The fast screen is `scratchpad/toad-t3/screen.mjs`: esbuild bundles the regular seed set (N = 24) against a mutated copy of `src/engine` and runs it in Node. The baseline survived (green). Log: `scratchpad/toad-t3/screen-reg2.log`, about 4 s per mutant on 2026-11-16 at 07:15.

- **The six targets are all KILLED by the property test alone:**
  - T22 adopt takes the narrower spacing (5 cases);
  - T23 checkpoint ignores the run key (1 case: thin; daily N = 500 widens it);
  - T32 twin without `from` (14);
  - T35 checkpoint forgets `endStep` (7);
  - T36 inherit keeps its own spacing (14);
  - T38 digest skips step 1 (24).

  An earlier official `run.mjs` sweep, run on an older generator at load 11, also killed T23, T32, T35, T36 and T38, and then T22.
- **Also killed:** T01–T13, T15, T17, T24–T26, T28, T31, T33, T34, T37, T39. That includes T05 (W3) and T09 (memory cap keeps two), after the generator gained "extend" edits and a 1-snapshot cap.
- **Survive the property test alone:** T14 (N4), T16 (M8), T18–T20 (compatible ignores digest, gravity or wind), T21 (adopt ignores the grid), T27 (run key ignores capacity), T29 (diverge ignores x), T30 (diverge ignores the shell) and T40 (restore keeps the sim sky). The generator never varies the sky, the digest flag or capacity between drivers, and its edits never change only x or only the shell. These stay covered by the named fixed-case specs. T27 is equivalent in the app, because the stage's capacity is fixed.
- **Unproven:** F03 (designer "no debounce" against `shell-designer.store.spec.ts`) was not run. In the official full sweep, T18–T20 were TIMEOUT (the 1200 s limit at load 183–280). That sweep was stopped and is not evidence.

## Redundancy candidates (do not delete; Skyler's review after an official serial proof)

The rule is strict: a regular test is a candidate only when every mutant it killed in Luigi's `results-new-reg.jsonl` is also killed by the property test. Yoshi's named keeps (D1, M8, `<=`, tie order, the seek reset, the 1,200 default, memory-cap doubling, the worst-shell tail) stay regardless.

- `timeline-driver.checkpoints.spec.ts`:
  - "a seek lands within one checkpoint spacing of work";
  - "a starBudget change drops them";
  - "a width change drops them, and the next seek is a straight run";
  - "are taken every SMALL_CP steps on the way…";
  - "checkpoints filled on a shadow sim (idle warm-up) are exact";
  - inherit "a checkpoint taken…" (T02, T05, T15, T33, T37);
  - inherit "keeps checkpoints before the first changed cue";
  - warm-up handoff "a twin…" and "takes…".
  - "are taken during live playback too" kills T02 and T08, but it also pins the 1200 default, so it stays.
- `timeline-driver.spec.ts`: the seek block ("seek to k equals a straight run…", "a backward seek at the particle cap…", "seek after playing through the loop…", "seek back past the end clears done", "a budgeted seek arrives in slices…"; "seek clamps and floors" documents the clamp and is borderline) and "trace digest … is equal across runs…".
- **Not candidates** (they kill a survivor): inherit "a checkpoint on the…" (T29), "adding, removing or…" (T19), "an embedded shell e…" (T30), "built from a driver…" (T16, M8), "deleting every cue" and "deleting the last cue" (T14), both "refuses…" handoff cases (T18, T19, T20), and every `fireworks-stage.phase7.spec.ts` case (stage-level, T29 and T40).

## Findings

- **F1 (engine defect; owner Yoshi or Luigi):** the run key is compared only with the key at the last reset or restore. A resize, or a starBudget change, and back during live play leaves a run that fired cues under two keys. `seek` then runs on from it, and `takeCheckpoint` stores checkpoints of it under the original key, so a later seek is inexact.
  - Repro: `timeline-driver.run-key.spec.ts`. One cue at step 60: seek to 30, 30 frames at width 1000, back to 1280. The forward seek to 200 differs from a straight run, and a checkpoint at 120 is taken.
  - Found by the daily screen: case 111722943 on an earlier generator.
  - The stage doesn't re-seek on a resize (`fireworks-stage.ts`).
  - Fix idea: mark the run stale when `beforeStep` sees a different key.
  - When F1 is fixed, drop `.fails` and turn on `CaseOptions.resizeBack`.
- **F2 (doc comment):** at step k, `traceDigest` covers the counts after steps 0..k − 2, not 0..k − 1 as its comment says. The behavior is consistent across runs; the comment is wrong. The oracle mirrors the code.
- **F3 (minor):** `reset` keeps `sim.simTime`, so a seek that re-runs from 0 ends with a later `simTime` than a straight run. Only Reduce-flashing spacing reads it, through differences. The property test doesn't compare `simTime`.
- **F4 (record accuracy):** `luigi-interlude-spec-split.md` counts T21 and T27 as killed by regular, but his `results-new-reg.jsonl` shows both SURVIVED (88/88).

## Boundary

- Proposal-level until Skyler reviews. No product code changed. No spec was deleted.
- The official proof still owed is `node tools/mutants/run.mjs t3-engine`, serial, with **no other sweep running**, plus F03 and the p6-web run.
- The regular-tier wall time was **not measured** in this batch: the machine was throttled (`pmset` `CPU_Speed_Limit` 22) and shared with another sweep.

# Toad: deleting the redundant timeline-driver specs (mutant-proved)

**Date:** 2026-11-17. **Brief:** Skyler approved deleting the old tests that the T3 property tests and T2 fingerprints made redundant; testing strategy §7 still requires a per-test proof. **Commits:** none (not authorized).

## What

1. **Official `t3-engine` run** (serial, alone, load 4–13): 30 KILLED, 11 SURVIVED (T14, T16, T18–T21, T23, T27, T29, T30, T40). F03 KILLED. Log: `test-results/mutants/t3-engine-2026-11-17T14-01-56/mutants.log`. Unlike the fast screen, **T23 survives the property spec alone**. Its only killer was a thin single case, and it now survives every regular engine spec.
2. **Proof set** `tools/mutants/sets/t3-redundancy.mjs` (62 mutants). It holds every engine mutant from the other sets (t3-engine T01–T40, c3-web W1–W7 and F1, p6-web `td-inherit-none`, f1-fix F1a/F1b, the T2 fingerprint swaps), plus three new ones:
   - **K1 and K2**: `seek` doesn't clamp or doesn't floor its target.
   - **X1**: state leaks across runs. A module-level counter flips the seed of every cue after the 50th fired in the process. Every other pooled mutant is deterministic within a run, so a "same show twice" case could never kill one.

   It runs against the regular engine-loop specs (default), the daily engine specs (`MUTANT_TIER=daily`) or every regular spec (`MUTANT_TIER=all`). Per-test attribution comes from each mutant's `<id>.vitest.json` in the rig.
3. **The rule applied:** a candidate is deleted only if, for every mutant it failed on, some test that stays in its tier also failed. For a daily candidate, its tier includes the regular unit-web step that the daily tier runs.
4. **Deleted (19 tests):**

   | Spec | Deleted cases | What they killed (all also killed by kept tests) |
   |---|---|---|
   | `timeline-driver.checkpoints.spec.ts` (9) | grid every SMALL_CP; lands within one spacing; width drops; starBudget drops; shadow sim; twin; adopt "takes only…"; inherit "keeps checkpoints before…"; inherit "after the old show ended" | T02–T06, T08, T15, T17, T24–T26, T28, T31, T33, T34, T37, T39, W3, W4, td-inherit-none |
   | `timeline-driver.spec.ts` (6) | seek to k; backward at the cap; after the loop; back past the end; budgeted slices; digest "equal across runs" | T07, T08, T33, T39, FP-F7 |
   | `timeline-driver.daily.spec.ts` (4) | two runs; three frame sizes; digest "equal across runs"; end twice | T07, T08, FP-F7 (digest case only). The other three killed nothing in the pool. X1 is killed by the kept regular and daily specs. |

   Also removed: the now-unused `referenceRun` and `ReferencePoint` helpers (`testing/timeline-spec-helpers.ts`), and the emptied daily `describe` blocks.
5. **Kept and strengthened: "seek clamps and floors its target".**
   - `advance` floors and clamps its own step count, so K1 and K2 change only `seek`'s arrival result. A host that loops until `seek` returns true would never arrive.
   - With the test as written, **K1 and K2 survived all 1778 regular tests**. The test now asserts `seek(…) === true` for 10.9 and −5, and it kills both.
6. **Kept** (sole killers within the regular engine specs, or named regressions):
   - "a checkpoint on the…" (T29);
   - "adding, removing or moving…" (T19);
   - "an embedded shell edit…" (T30);
   - "built from a driver…" (T16, M8);
   - "deleting every cue" and "deleting the last cue" (T14, D1);
   - both handoff "refuses…" cases (T18–T20, M9);
   - "are taken during live playback too" (the 1200 default);
   - memory-cap doubling;
   - "turned off".
   - Every daily checkpoint case and the 2a.9 interleaved-sims spec are untouched (Yoshi's keep list).

## Results

| | Before | After |
|---|---|---|
| Regular tier (`run.mjs regular`) | PASS, wall 198.8 s, unit-web 34.9 s, load 7.9–11.4 | PASS, wall 190.1 s, unit-web 29.7 s, load 8.6–8.7 |
| Web tests in the regular tier | 1778 in 79 files | 1763 in 79 files |
| Slowest file (`timeline-driver.spec.ts`) | 26.1 s | 16.4 s |
| `test:daily` (web) | 31 tests (before-time not measured) | PASS, 27 tests, 98 s |
| `t3-redundancy`, regular engine specs | 55 KILLED + X1; K1, K2, T21, T23, T27, T40 SURVIVED | 58 KILLED; T21, T23, T27, T40 SURVIVED. No mutant went from killed to survived; K1 and K2 became killed |
| `t3-redundancy`, daily engine specs | 29 KILLED + X1 | 29 KILLED. T07 went from killed to survived in the daily files alone; it is still killed in the daily tier by the regular property spec |

The build-dotnet step went from 9.9 s to 3.5 s (incremental), so compare on unit-web rather than on the wall. Logs:
- before: `test-results/mutants/t3-redundancy-2026-11-17T14-11-58` (regular), `…T14-26-32` (daily), `…T15-00-59` and `…T15-02-07` (K and X), `…T15-03-29` (K1/K2 vs all 79 specs);
- after: `…T15-07-09` (regular), `…T15-20-27` (daily).

## Why

- Each deleted case pinned a bookkeeping property that T3's independent oracle and model check on every generated case. The named regressions stay because they guard shapes the generator never varies (the sky, the digest flag, x-only and shell-only edits, the off/on spacing).
- X1 keeps the run-twice deletions honest. Without a cross-run mutant, "kills nothing" would be vacuous. X1 is killed by 14 kept regular tests (the fingerprint goldens among them) and by 2 kept daily cases.

## Boundary

- **Thin kills, worth knowing.** After the deletion, T07 (restore with the wrong digest) is killed only by `timeline-driver.property.spec.ts`. If the generator's stream changes, re-run `t3-redundancy T07` first.
- **Still open, not caused by this change** (owner Luigi or Yoshi; I write the test, they decide):
  - T21 (adopt ignores the grid) and T23 (checkpoint ignores the run key) survive every regular engine spec;
  - T40 is covered only at stage level;
  - T27 is equivalent in the app.
- The deletion rule from here on: run `t3-redundancy` (or a set like it) before and after, and attribute per test from the rig's JSON. A spec-level verdict can't say which test killed what.

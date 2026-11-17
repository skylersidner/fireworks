---
name: checkpoint-warm-up
description: Warming TimelineDriver checkpoints in the background on a shadow sim and handing them to the visible driver exactly, inside the frame's seek budget. Use when changing the stage's warm-up, the driver's twin/adoptCheckpoints, or measuring cold seeks.
---

# Checkpoint warm-up on a shadow sim

**Domain:** engine loop + stage host · **Confidence:** medium (Luigi, Phase 7 B2, 2026-11-15; specs and mutants in jsdom, measured on the production build in Chrome)

## Shape
1. `shadow = live.twin()`: same document and options, holding the live driver's checkpoints. Run it on its own `FireworksSim({ capacity })` and `EngineLoop` with **the same width provider** and star budget as the live loop, or its checkpoints carry another run key and `seek` drops them.
2. Every frame: `shadow.adoptCheckpoints(live)` (jump ahead to whatever the visible driver already has), run `shadow.seek(loop, endBoundStep + 1, chunk)` chunks until the budget is spent or `shadow.done`, then `live.adoptCheckpoints(shadow)`.
3. `adoptCheckpoints` takes only checkpoints at or before the first step where the two schedules differ (`divergeStep`, the same rule as `{ from }`), so it is exact even against a different show. It never touches the receiver's run; only the start point of a later seek changes.
4. Foreground first: no warm-up in a frame whose seek hasn't landed; the warm-up budget is what the seek budget leaves, and a small cap (6 ms) while playing.
5. Restart on a new driver (it inherits the checkpoints before an edit, so warm-up resumes there) and on a run-key change (width, star budget, capacity). Report transitions only (`data-warm-up`), never per frame.
6. **Wait for quiet** (2026-11-17): warm-up runs only after `playback.warmUpDelayMs` (served, default 1000) of frame time since the last seek frame. An edit always seeks, so it restarts the wait. Count frame time, not wall time, so specs drive it with `renderer.frame(16)`.
7. **Probe, then maybe skip:** the first unfinished slice of a warm run measures ms per step; × `endBoundStep + 1` ≤ `WARM_UP_SKIP_COLD_RUN_MS` (200 since 2026-11-17; 1000, then 700, the same day) → `skipped`, decided once per run. Specs about warm-up itself provide 0 for the token and `warmUpDelayMs: 0`.
   - **The probe under-predicts about 4×.** Its slice is the show's opening, usually the sparsest part. Toad measured done-when-60 predicted at 237–253 ms against a real cold run of about 1.1 s, and realistic-600 at 1.4–1.8 s against about 6.7 s. So set the threshold against the *prediction*, not the seek bar: 1000 and 700 both let done-when-60 skip and seek cold at a p95 of 912–995 ms. At 200, a skipped show's real cold run is about 0.8 s at most. Measure the prediction against a real cold run (`probe-pred.mjs` in Toad's scratchpad) before moving the threshold.
   - **Possible later improvement, not done:** a density-aware prediction (weight the probe by the show's cue density after the slice) would let the threshold sit nearer the bar.
   - A browser gate that forces warm-up patches the compiled default; `gate-warm.mjs` `SKIP_ON` matches any numeric literal (`()=>200`), with an exactly-one-hit check.
   - Spec trap: compute the fixture's real prediction (`endBoundStep + 1`, 1336 for the 4 s Done-when slice) before choosing a spec-local step cost. The old "532 ms" comment was 668 ms.

## Traps
- **Mutants in a copied tree need the repo layout.** Specs read `../../../schema/fixtures` from the workspace cwd. Copy to `<scratch>/mutroot/src/web/fireworks-web` and symlink `<scratch>/mutroot/schema`, and run an unchanged baseline first: an ENOENT "kill" is not a kill.
- **Playwright `waitForFunction` breaks under the app's CSP** (it evaluates a string). Use `bypassCSP: true` for measurement contexts; verify the CSP itself in a separate run without it.
- A WebGL canvas's `toDataURL()` is blank (`preserveDrawingBuffer` false): compare element screenshots to prove it draws.
- `sim.restore` sets `simTime` from the snapshot, so a shadow checkpoint moves the visible sim's `simTime` back. Only rendering reads it (FlashSpacing resets on a backward jump, as on any seek).

- **A prefix schedule ends early.** If the receiver's cues are a strict prefix of the source's, a checkpoint past the receiver's last fire can't tell when the receiver ended (`endStep`). `divergeStep` must cap at the receiver's last `fireStep` (yoshi-phase7-architecture-rulings.md addendum 1, D1). A twin never hits this; `{ from }` after deleting the last cue does.
- Shadow `starBudget` or capacity left unsynced is exact (the run key refuses it) but silently useless. Pin it with a spec at a non-default star budget.

## Measuring
`scratchpad/pw/luigi-warm.mjs <base> <codes.json> after|early|cold|frames`: Toad's A3 seeded 20 scrubs, waiting on `data-warm-up="finished"` for `after`. Compare against a same-load `cold` run on a build without warm-up; load swings the numbers ±20 %.

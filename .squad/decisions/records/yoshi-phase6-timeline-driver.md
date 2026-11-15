# Yoshi: Phase 6 TimelineDriver (as built)

**Date:** 2026-11-14 · **Status:** proposed · **Code:** `src/web/fireworks-web/src/engine/loop/timeline-driver.ts`, `engine/sim/lifetime.ts`, the seams in `engine/loop/playback-driver.ts` and `engine-loop.ts`, and `snapshot`/`restore` in `engine/sim/simulation.ts` and `particle-store.ts`. **Contract:** schema.md §4.4, §4.5, §13 (edited in place).

Supersedes in part `yoshi-phase2a-engine-boundaries.md` point 8 (the loop-owned step counter).

## What
1. **Seams.** `PlaybackDriver.beforeStep?(ctx)` is called by `EngineLoop.frame` immediately before every `sim.step(STEP)`, with no step argument. `PlaybackContext.fireSeeded(def, tx, ty, seed)` launches without consuming the launch counter and sets `lastLaunch` (the HUD seed). `effectiveSky(shell, showSky?)` returns the show sky when it's given.
2. **The driver owns the show clock.** `step` counts `beforeStep` calls since the last `reset` or restore. The 2a plan had the loop own the counter; that's wrong because the show clock starts at show start and resets on seek, and the loop knows neither. Firing still happens inside the fixed-step loop, which was the point of the 2a seam.
3. **Firing (§4.4):** schedule = `orderCues(show.cues)`, resolved once (def clone, `ty`, `fireStep`). Before step `k`, fire while `schedule[next].fireStep <= k`. The ledger row is `{ step, id, shell, seed, x, tx, ty }`, with `tx = x × ctx.worldWidth()` read at fire time. `duration` is never read for firing.
4. **End (§4.5):** `endStep` is the first `k` where every cue has fired and `shellCount === 0 && particles.n === 0`. It's checked in `beforeStep` and after `advance`. `done` latches until a seek before it.
5. **Seek is exact.** `seek(ctx, k, maxSteps?)` restores the latest checkpoint ≤ `k` (or keeps going if the current step is later), otherwise resets, then runs on. **Checkpoints** are full world copies (every particle field to `n`, shells with their RNG state, `simTime`, plus the driver's `next`, ledger, digest and end). They're taken as step `c` begins, every 1200 steps (10 s). Each is keyed by `(worldWidth, starBudget, capacity)` and dropped on mismatch. A run whose key changed since its reset takes none. Over 64 MiB the spacing doubles. `maxSteps` lets the host spread a seek over frames; it returns true on arrival.
6. **Edits keep checkpoints:** `new TimelineDriver(edited, { from: old })` keeps the old checkpoints at steps ≤ the first step where the two ordered schedules differ (fireStep, id, shell key, x, seed, ty, embedded def). A checkpoint exactly on that step is still exact, because it was taken before that step's cues fired. A sky change keeps none.
7. **RNG made snapshot-able:** the shell RNG is `mulberry32Stateful` (the state in an `Int32Array` slot, through `mulberry32Step`). It's bit-identical to `mulberry32`: the prototype goldens pass unchanged, and a 1000-draw spec checks it.
8. **Lifetimes:** `shellLifetimeBound` (a hard bound per cue) and `MAX_SHELL_LIFETIME` = 21.03 s at the limits; measured worst 20.88 s. `cueTimes` and `estimateShowEnd` implement Rosalina's phase-6.md §7.1 and §7.3, with one change: the §7.3 estimate is capped at the hard bound. Her formula adds the longest burn to the last burst, which overshoots the bound when an early break burns longest; a spec caught it. They live in `engine/sim/lifetime.ts`, not `model/show.ts`, because they need `GROUND` and model may not import sim.
9. **Readout:** `traceDigest` (opt-in, FNV-1a over `countByKind()` after every step) plus `ledger`, `step` and `endStep` are what Peach's 6a.8 readout exposes. Exposing them in the built image (for example as `data-*` on the stage host) is Luigi's.

## Why
- The plan's "re-run from t = 0" is the invariant (Rosalina §5.3, Peach 6i.1–6i.2). A pure re-run measured 0.97 s to the end of the Done-when show and 19.9 s for a 600 s, 1000-cue show (Node 26, V8), against Rosalina's Y1 budget of about 1 s. Exact checkpoints are a cache of that same run, so they keep the invariant and bound the cost by one spacing.
- "Fast-forward from T − 21 s" is inexact at the 40k cap (schema.md §13 caveat; Peach 6i.2), so it was rejected.
- A step argument from the loop would need an offset per show start and per seek. Counting inside the driver gives one source of truth, and the equivalence specs (frame sizes 24/60/144 fps vs offline, seek vs straight) guard it.

## Measured
See schema.md §13 for the table. In short:

- **Done-when show:** seeks in 82 ms median, 173 ms max.
- **600 s, 1000 preset cues:** 141 ms median and 292 ms p95. The first far seek into an unplayed show is still a full run (19.5 s), so a host should warm checkpoints up on a shadow sim and hand them over with `{ from }`, which a spec pins as exact.
- **Pathological worst case** (40k cap for 10 minutes): a 3.6 s median. The 64 MiB cap widened the spacing to 40 s there. The cross-engine check gave the same per-step count hash, ledger, end step and x sums in V8 and JavaScriptCore for the Done-when show.

## Negative controls (all killed)
Each was an exact-swap mutant against `timeline-driver.spec.ts`, `engine-loop.spec.ts`, `lifetime.spec.ts` and `simulation.spec.ts`, with every target's md5 restored afterward:

- **Firing:** `<=`→`<`; ties in array order; `ctx.fire` in place of `fireSeeded`; the loop skipping `beforeStep`.
- **Seek and reset:** seek never resetting backward; reset keeping the sim; reset keeping the fired pointer; reset keeping the sim's sky; seek ignoring its budget.
- **End and lifetime bound:** end ignoring shells in flight; `STAR_AFTERLIFE` 2.2→1.0; `STAR_LIFE_FACTOR` 1.12→0.9.
- **Checkpoints** (M18 first survived; its only "kill" was an unrelated failing test, so a dedicated spec was added):
  restore with the wrong RNG state; inheriting one spacing too many; inheritance ignoring `seed`; seek ignoring the run key; restore skipping the `emit` field; restore keeping an inherited `endStep`.

## Boundary
- Engine only: no Angular, no Pixi (`engine-boundary.spec.ts` green). How the builder, the player and the stage use the driver (a driver input or timeline mode on `app-fireworks-stage`, `clickToFire` off in the player, the catch-up UI, the 6a.8 readout) is Luigi's, against the API above.
- Determinism holds at equal `starBudget`, world width and capacity. A resize mid-show moves later cues; a seek re-fires every cue at the current width.
- **Checkpoint trigger, numeric:** revisit the spacing or the memory cap if a seek's p95 in Chrome exceeds 1 s on a show a user saved, or if checkpoint memory exceeds 64 MiB on one (the cap thins them, so cost rises instead of memory).

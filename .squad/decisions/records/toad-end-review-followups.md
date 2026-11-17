# Toad: end-of-project review follow-ups (2026-11-17)

**Brief:** three items Skyler approved on 2026-11-17: a Node version check, a refresh of the testing strategy, and the T21/T23 checkpoint gaps. **Commits:** none (not authorized). Load was kept light while Bowser ran a dotnet job. I didn't run the full regular tier; the coordinator runs it at the end of the batch.

## What

### 1. Node version check (`tools/test/node-version.mjs`)
- **The one source is `engines.node` in `src/web/fireworks-web/package.json` (`>=26.5.0 <27`).** That range is the requirement. `.nvmrc` (26.5.0) is only what `nvm use` picks; the check refuses to run if `.nvmrc` falls outside the range, so its hint never points at a Node it would refuse.
- **The parser is small and strict.** It reads space-separated `>= > <= < =` or bare versions. Anything else (`||`, `^`, `~`, `x`, an empty string) throws, so an `engines` edit it can't read fails loudly instead of passing every Node. `--selftest` holds 12 cases and 5 refused ranges.
- **Where it runs, always before any step, with exit 2:**
  - `tools/test/run.mjs`, every tier, right after the usage check. It runs before `--list` too, so a dry run shows the refusal. A refused run creates no `test-results` folder.
  - `tools/browser-gates/daily.mjs`, the hand re-run of the browser steps.
  - `tools/mutants/run.mjs`, **web sets only**, after `--list` and `--check`, which run no tests. Under v21 a web set's baseline would come back BROKEN with a misleading message. API sets only spawn `dotnet`, so they don't need Node 26.
  - **Not in the individual `gate-*.mjs` scripts.** The runners spawn them with `process.execPath`, which is the Node that already passed the check. They build nothing, so they can't test a stale bundle.
- **Proof** (commands run from the repo root):

  | Run | Result |
  |---|---|
  | v21.5.0 `run.mjs quick\|regular\|daily\|final --list` | exit 2: `run.mjs <tier>: refusing to start: node v21.5.0 does not satisfy engines.node ">=26.5.0 <27" (src/web/fireworks-web/package.json). Run `nvm use` (.nvmrc: 26.5.0) …` |
  | v21.5.0 `run.mjs regular` (no `--list`) | exit 2; no new `test-results/regular/` folder |
  | v21.5.0 `mutants/run.mjs t3-redundancy T21` | exit 2, before the rig is copied |
  | v21.5.0 `browser-gates/daily.mjs` | exit 2, before `ensureSession` |
  | v21.5.0 `mutants/run.mjs --check t3-redundancy T21` | exit 0 (it runs no tests, so it isn't gated) |
  | v26.5.0 `run.mjs regular --list` and `final --list` | the step lists (final: 69 lines) |
  | v26.5.0 `node-version.mjs --selftest` | `ok (12 cases, 5 refused ranges)` |

### 2. `docs/fireworks-app/testing-strategy.md` refreshed
- §2.3 now has measured times from `test-results/final/2026-11-17T105956`, and the final total of **32.4 min**.
- `bench-seek-node` is described as it is: no stored baseline and no drift check; a person compares it by hand with the last record. `gate-warm` is described as checking fixed bars.
- The `TOAD_INJECT_ERROR` and `TOAD_HIDE_ENDED` NEGs are stated to run in Chromium only. WebKit's round trip uses `JSON_ENGINE=chromium`.
- The Node 26.5 requirement and the check are documented.
- §5.4 and §3 item 16 now say the baseline file and the drift flag were never built.
- The status line no longer says "nothing here is adopted".
- `README.md` was updated too, and stays phase-free (`grep -ci phase` is 0 before and after):
  - the final row now gives the measured 32.4 min instead of the estimate;
  - it describes the Node check;
  - exit 2 now lists the wrong Node version among its causes.

### 3. T21 and T23
- **T21 (adopt ignores the grid): a new regular test kills it.** `timeline-driver.checkpoints.spec.ts`, "from a finer grid, adds and counts only checkpoints on the wider spacing":
  - a driver at `SMALL_CP` (120) seeks to 490 and holds `[120, 240, 360, 480]`;
  - a fresh driver at 240 adopts them, and must return 2 and hold `[240, 480]`.

  Mutated, the off-grid checkpoints are still filtered out on the next line (`.filter((c) => c.step % this.cpSteps === 0)`), so only the documented return value changes. The stage ignores that return value (`fireworks-stage.ts` `warmUpSlice`), so **T21 is equivalent in the app, but not at the driver's API**. The test pins the documented contract ("Returns the number added").
- **T23 (checkpoint ignores the run key) is equivalent, and now marked** `equivalent: '…'` in `tools/mutants/sets/t3-engine.mjs`; `t3-redundancy` inherits the mark. The reasoning:
  - `takeCheckpoint` is private, and its only caller is `beforeStep`.
  - Since the F1 fix (2026-11-16, `f1-fix.mjs`), `beforeStep` sets `runKey` to null whenever width, `starBudget` or capacity differs from `ctx`. It does that just before the call, with no write in between.
  - So a non-null `runKey` at that point always equals `keyOf(ctx)`, and `sameKey` there is always true.
  - Breaking that would take a `worldWidth()` that returns different values on two back-to-back synchronous reads, which no real host does: `EngineLoop` calls the stage's renderer width provider.
  - Its last kill (`test-results/mutants/t3-engine-2026-11-16T02-29-18`) came before F1. That one-case kill was the kill that "didn't hold".
- **Targeted proof** (`node tools/mutants/run.mjs t3-redundancy T21 T23`, only those two, against the 6 regular engine-loop specs; load 7.3 at the start and 14.6 at the end, with Bowser's dotnet job running). Log: `test-results/mutants/t3-redundancy-2026-11-17T18-40-51/mutants.log`.
  ```
  baseline 1/1 (6 specs): green 77/77 passed
  T21 KILLED   adopt ignores the grid | 76/77 passed; 1 failed, 0 timed out
      … from a finer grid, adds and counts only checkpoints on the wider spacing :: AssertionError: expected 4 to be 2
  T23 EQUIVALENT checkpoint ignores the run key | 77/77 passed; marked equivalent: …
  summary t3-redundancy: KILLED 1, EQUIVALENT 1
  ```
  The new test is T21's only killer.
- **Area specs in the real tree:** `ng test --include 'src/engine/loop/**/*.spec.ts'` (daily and final excluded) gives 6 files and 77/77 passed. Prettier is clean on the changed spec.

### T27 and T40: analysis only (no tests or marks added)
- **T27 (run key ignores capacity): equivalent in the app, but a real gap at the driver's API.**
  - `FireworksSim.particles` is `readonly`, and the stage's sim keeps one capacity for its whole life.
  - The warm-up shadow sim is built with `capacity: this.sim.particles.capacity` (`fireworks-stage.ts` `warmUpSlice`), so in the app no checkpoint is ever held under another capacity.
  - The driver itself accepts any `ctx`, though, and F1 already treats capacity as part of the key. A spec that runs one driver on two loops with different capacities (for example 2500, then 1500) and seeks back would kill T27: the mutant keeps and restores the other capacity's checkpoints.
  - I didn't mark it equivalent, because the mark means "changes no behavior", and at the API it does.
  - Owner's call (Luigi or Yoshi): add that test, or accept the gap as "app-equivalent".
- **T40 (restore keeps the sim's sky): not equivalent; a real gap in the engine specs.**
  - `SimSnapshot` holds no sky (`simulation.ts`), so the `ctx.sim.sky = { ...this.sky }` line in `restore` is the only thing that restores the show's sky on a checkpoint path.
  - The app writes `sim.sky` outside the driver: a stage effect, `this.sim.sky = normalizeSky(this.sky() ?? this.shell().sky)`, and `fireNow`.
  - The record `toad-redundant-spec-deletion.md` says a stage spec covers it. I didn't re-verify that here (it would need a run against the stage specs).
  - Proposed smallest engine test: seek `smallShow()` to 500 at `SMALL_CP`; set `s.sim.sky = { gravity: 300, wind: 4 }`; seek to 250; expect `snapshot(s.sim)` to equal `straight(smallShow(), 250, SMALL_CAP)`. It wasn't written or proved, as the brief said.

## Why
- On a v21 shell, the final tier's keep-going behavior turned a one-second `ng` failure into 30 minutes of browser steps against a stale bundle (`toad-final-tier-run.md`). A preflight with exit 2 costs nothing.
- A test that can't fail on its mutant is worse than none. For T23 the honest result is "equivalent, with the reason", not a test built on a context no host produces.

## Boundary
- **Don't add the check to the leaf `gate-*.mjs` scripts.** Any new **entry point** that spawns `npm`, `npx` or `ng` should call `requireNode(label)` before its first step.
- **Range syntax:** if `engines.node` ever needs `||` or `^`, extend `satisfies` and its selftest. Don't loosen the throw.
- **Keep the T23 mark only while `beforeStep`'s F1 check comes directly before `takeCheckpoint`.** If either moves, or `takeCheckpoint` gains a caller, the runner re-checks the mark on every run: a KILLED result becomes NOT-EQUIVALENT and fails the run.
- **No product code was changed.** The `sameKey` check in `takeCheckpoint` is now dead defensive code. Removing it or keeping it is Luigi's or Yoshi's call, and it doesn't affect any test.

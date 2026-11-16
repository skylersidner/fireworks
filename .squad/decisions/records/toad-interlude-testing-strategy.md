# Toad: post-Phase-7 interlude, step 2. Testing strategy proposal

> Superseded in part by `toad-interlude-final-tier.md` on 2026-11-16. The daily tier no longer carries the benchmark, `at-maximums` or the uncached Docker build, and runs in about 25–30 min (Skyler, 2026-11-16), not the ~50–65 min estimated here. The §8 open questions are answered in the plan's "Interlude after Phase 7" section. The tiers, the regular target and the daily gate rule stand.

**Date:** 2026-11-15. **Status:** proposal. Nothing binds until Skyler adopts it. The full proposal is `docs/fireworks-app/testing-strategy.md`.

## What

- **Three tiers, one entry point.** `node tools/test/run.mjs quick|regular|daily`.
  - **quick:** dev only, about 15–30 s. Watch mode, or an impact-map `--include`.
  - **regular:** format check, fixtures `--check`, typecheck, `ng test` without `*.daily.spec.ts`, `ng build`, `dotnet build`, the Postgres-gated `dotnet test` and a Chromium smoke of about 1 min. Expected 3.0–3.9 min serial at low load.
  - **daily:** regular, plus `*.daily.spec.ts`, the full gate on three engines, real-time plays, T2 cross-engine fingerprints, the report-only bench and an uncached Docker build. About 50–65 min (estimate).
- **Slow tests move to `*.daily.spec.ts`; nothing is deleted.** An old test leaves the regular tier only after its replacement kills every mutant it killed, in a serial run on an idle machine.
- **Every virtual-time browser check uses `clock.install()` plus `pauseAt()`, steps with `fastForward`, never `runFor`, clicks through the DOM, and carries a frozen-clock NEG.** Virtual time runs only on short fixtures (10 s).
- **The `gate-csp` NEG uses positive evidence of blocking** (a `securitypolicyviolation` event or the console "Refused" line), not a 30 s absence timeout.
- **The gate scripts, mutant runners and bench move into the repo** (`tools/browser-gates/` with its own `package.json`, `tools/mutants/`) before any daily run exists.

## Why

- Measured in step 1 (`toad-interlude-test-timing.md`): the in-repo regular suite is already about 205 s. One file, `timeline-driver.spec.ts`, sets the `ng test` wall time. All the over-budget time is in the scratchpad gate: the 488 s of NEG timeouts and the 93 s real-time play.
- Probe P1 (`scratchpad/toad-interlude2/p1-clock.mjs`, Chromium, real CSP on 5180):
  - `page.clock` works under `script-src 'self'`.
  - `install()` alone keeps real time running. The NEG caught this: the show ended after 16 s with the clock never advanced. `pauseAt` fixes it.
  - `runFor(100)` fires every 16 ms frame and runs slower than real time: the Done-when show hadn't ended after 180 s.
  - `fastForward(100)` plays a 10 s show in about 1 s, but the 66 s Done-when show still takes 62.6 s at load 15–20, because each frame is CPU-bound in software WebGL.
  - `page.click` stalled 3.7–22 s while the clock was paused.
- Corrections to step 1 (code-settled):
  - About 10–11 s of real `setTimeout` sleeps exist in 4 specs (`designer-save`, `open-link-page`, `show-save`, `show-builder.store`).
  - 7 of the 9 stage-mounting specs budget warm-up and seeks on the real `performance.now()`, because `STAGE_CLOCK` is not injected. Yoshi's T5 claim is right.

## Boundary

- Proposal only. No spec, script or config was changed.
- One probe show was created on the 5180 dev database (`wtJbvvGv`, from the `cue-at-duration` fixture).
- Open for Skyler, per the proposal's §8:
  - the daily trigger (recommended: launchd, not CI, since "No CI" stands);
  - a browser smoke in regular;
  - whether a red daily blocks gates;
  - whether cross-engine fingerprints are report-only;
  - the pre-commit hook;
  - the quarantine policy;
  - mutant cadence;
  - parallel lanes.
- This record doesn't contradict any standing decision. If §6 option B (GitHub Actions) is chosen, it reverses plan §5 OQ11 "No CI", and that is Skyler's call.

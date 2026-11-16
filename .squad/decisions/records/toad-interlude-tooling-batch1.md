# Toad — Testing interlude, batch 1: the tier tooling in the repo

> Superseded in part by `toad-interlude-final-tier.md` on 2026-11-16. Point 2: `daily-status.mjs` also reads `final/`. Point 6: the uncached `docker build`, `gate-warm` and the Node bench now run in the final tier only, not daily. The "T2 fingerprints, which aren't built yet" note is superseded by `yoshi-interlude-t2-fingerprints.md` (built 2026-11-16). The rest stands.

**Date:** 2026-11-15. **Brief:** the plan's "Interlude after Phase 7", implementation batch 1 (tooling), following Skyler's adoption of `docs/fireworks-app/testing-strategy.md` on 2026-11-16. **Commits:** not authorized; nothing was committed.

## What

1. **Nothing depends on the scratchpad any more.**
   - `tools/browser-gates/`, with its own `package.json` pinning `playwright` 1.65.0, holds:
     - every Phase 7 gate script: csp, keyboard, touch, reduced-motion, follow, roundtrip and warm;
     - `notfound.mjs`;
     - `headers.py`, kept in Python because it uses only the standard library and its raw-socket and chunked checks are proven;
     - the new `player-virtual-time.mjs`;
     - `smoke.mjs` and `daily-steps.mjs` / `daily.mjs`.
   - `tools/mutants/` holds the runner plus four sets: `c3-web`, `c3-api`, `p6-web` and `p6cfg-api`.
   - `tools/bench/` holds the Node seek bench.
   - Share codes come from `CODES=SAVE`, which posts `lib/common.mjs` `SAVE_SET` (gate shells A and B, the Done-when show and the 10 s show), or from `CODES` / `CODES_FILE`. No script reads a hand-made `codes.json`.
2. **Output location:** `test-results/` at the repo root, gitignored.
   - The daily result is `test-results/daily/<stamp>/summary.json`.
   - `tools/test/daily-status.mjs` reads the **newest** run, so a later red or partial run is never hidden behind an older green one. It exits 0 only when that run is green, complete (no `--only` / `--skip`) and less than 24 h old.
3. **The browser steps run against their own API.**
   - The API is the built `Fireworks.Api.dll`, in **Production** (the real headers), with `Identity__AllowAnonymousWrites=true`.
   - It has its own database, `fireworks_smoke_<tier>_<pid>`, and listens on a free 127.0.0.1 port.
   - It is stopped and its database dropped at the end. The dev API on 5180 and `ng serve` on 4200 are never touched.
   - The Postgres `dotnet test` gets its own database too, `fireworks_test_<tier>_<pid>`, also dropped at the end.
   - `SMOKE_BASE` overrides all of this with a server that is already running. That server must be in Production with writes on.
4. **The gate-csp negative control needs positive evidence.**
   - A page counts as caught only on a `securitypolicyviolation` event whose directive is `script-src` (or a console "Refused to load/execute … script" line), and only if the stage is not `running` after a 1.5 s settle.
   - The control's own control is `NEG_SELFTEST=1`. It skips the injection, and the control must then exit 1 with NOT CAUGHT. That run showed why the directive matters: `default-src 'none'` also blocks the favicon (`img-src`), and that violation alone proves nothing.
   - The real-header pass polls for a ready signal instead of fixed sleeps.
   - Timing on 9 pages: NEG 488 s → 16 s; real pass 47 s → 19–35 s, depending on load.
5. **The frozen-clock control in the virtual-time smoke watches the readout for 3 s.** It no longer waits out the whole show.
   - With `pauseAt`, the time readout stays `0:00` and the show doesn't end.
   - Without `pauseAt` (`PAUSE=0`), the readout reads `0:03` after 3 s and the control fails, as it must.
   - The positive run also checks that each play took at least 10 s of virtual time (14.4 s and 14.0 s measured). An "ended" state that arrives early can't pass it.
6. **Daily cross-browser classification:**
   - **Fail the run:**
     - every Chromium gate and its negative control;
     - Firefox and WebKit `gate-csp` (each page loads clean and the stage runs);
     - Firefox and WebKit `gate-roundtrip`: save, share, Show JSON, and the real-time play to the end;
     - the uncached `docker build`.
   - **Report only:**
     - the Firefox and WebKit keyboard, reduced-motion and follow walks;
     - `gate-warm` and the Node bench;
     - the T2 fingerprints, which aren't built yet.
   - A negative control that expects exit 1 must also print its catch (`mustSay`), so a crash can't pass as a caught control.
7. **Mutants run on a private copy of the repo** (`test-results/mutants/<set>-<stamp>/repo`, made with rsync without `.git`, `node_modules`, `bin` or `obj`; the web app's `node_modules` is symlinked).
   - A baseline must pass before any mutant runs.
   - Verdicts are KILLED, TIMEOUT, SURVIVED, BROKEN or STALE. **A failure made only of timeouts is TIMEOUT, never KILLED** (`classify.mjs`, which has its own self-check and its own mutant).
   - `--check <set>` reports staleness without running anything.
   - Restoring from the copy's own original is allowed **inside the private copy only**. The skill rule "never restore from a backup" still binds on the shared tree, where no runner now mutates anything.
8. **Tier behavior:**
   - `regular` and `quick` stop at the first failing step. `daily` runs every step.
   - Within the smoke, every sub-step runs, and any failure fails the smoke.
   - Exit codes: 0 pass, 1 a gating step failed, 2 a usage or setup error.
   - There are no retries anywhere.
9. **Where the bench lives:** `tools/bench/`, as the brief says. Strategy §3 item 13 said `tools/browser-gates/bench/`; the brief wins.

## Why

- Strategy §5.6 (the daily suite rots) and §3 item 12: one scratchpad cleanup would have lost every browser check.
- "Every check has a recorded negative control" (standing). Every new step has one, recorded in the README table: `format:check`, `fixtures:check`, the runner's exit code, `daily-status`, `headers`, both virtual-time checks, `csp-neg` and its self-test, the Show JSON tamper, and `classify`.
- The 24 h rule is checkable only if the file it reads can't be gamed by a partial run (point 2).
- In Production, the smoke API sends exactly the headers the image sends, and `headers.py` checks exactly those. The dev API on 5180 is Development, and its rate limiter is shared with whoever else is working.

## Boundary

- These are tooling choices. They don't change any rule in `testing-strategy.md`. Points 2, 6 and 7 add detail where the strategy was silent. **Point 6's report-only list for Firefox and WebKit is my reading of "fingerprint mismatches are report-only; crashes and failed loads fail it"**, extended to the fidelity walks. Skyler may want keyboard or follow in Firefox and WebKit to fail the run instead. That is a one-word change in `daily-steps.mjs` (`gate: 'report'` → `'fail'`).
- The full daily run hasn't been run yet. Its first run, before the first gate under the new rules, is also the first real run from the repo of `gate-keyboard`, `gate-touch`, `gate-reduced-motion`, `gate-follow`, `gate-warm` and the full real-time `gate-roundtrip`. So far those scripts only had their imports and codes rewritten, plus a `node --check`.
- `p6-web` has 9 STALE mutants (Phase 7 moved their code). Refresh them from the current source before the §7 step 6 proof uses that set. Never widen the old text to make one apply.
- I didn't edit any `*.spec.ts` under `src/` (Luigi's, in parallel). I added only the four npm scripts to `src/web/fireworks-web/package.json`.

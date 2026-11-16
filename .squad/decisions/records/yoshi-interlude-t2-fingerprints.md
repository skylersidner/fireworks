# Yoshi — Testing interlude, batch 2: T2 committed show fingerprints

> Superseded in part by `toad-interlude-final-tier.md` on 2026-11-16: `at-maximums` (point 4, the daily case) now runs only in the final tier, selected by name in `FINAL_ONLY_CASES`, and its browser runs are final-only. `realistic-600` stays daily. The rest of this record stands.

**Date:** 2026-11-15. **Brief:** plan "Interlude after Phase 7" (adopted 2026-11-16), `docs/fireworks-app/testing-strategy.md` §3 item 4, my design `yoshi-interlude-show-testing.md` T2. **Commits:** not authorized; nothing committed.

## What

1. **One source for the fingerprint.** `src/web/fireworks-web/src/engine/loop/golden/show-fingerprint.ts` (pure engine code: model, sim and loop imports only) holds `fingerprintShow`, the case list `FINGERPRINT_CASES`, `diffFingerprint`, `inputDigest` and `realisticShow`. The regular and daily specs, the recorder and the browser harness all run this file, so nothing is retyped.
2. **Fields, integer only** (Skyler's ruling): `endStep`, `lastFireStep`, `launches`, `ledgerHash`, `traceDigest` (the driver's own per-kind digest), `populationDigest` (`n` and shells after every step, independent of the driver's digest), `peakN`, `peakStep`, and `samples` every 600 steps (`n`, shells, six kind counts). Hashes are uint32 FNV-1a. The ledger hash folds `tx` and `ty` by their float64 bits. Each of those is one correctly rounded operation (`x * width`, `760 − h * 760`), so the bits are the same in every engine. That was measured: all three engines agree. Each golden also stores the case's run key and an `inputDigest` of the document, so "the input moved" is reported apart from "the sim moved".
3. **Goldens** live at `src/web/fireworks-web/src/engine/loop/golden/fingerprints/<case>.json`. That puts them beside the code they guard, as `engine/sim/golden/` does. They are Prettier-formatted, so `format:check` covers them, and the quick tier's `src/engine/` impact entry picks up the spec. They are not under `schema/`: they describe sim behavior, not document shape (schema.md §4.4 treats a behavior change as a reviewed sim change, not a version bump).
4. **Cases.**
   - Regular (11): every valid show fixture except `at-maximums`; `done-when-60s-50` once more at capacity 2,500 (the at-cap case, about 0.7 s); and `realistic-60`, the bench's realistic preset show at 60 s.
   - Daily (2): `at-maximums` (600 s, 1,000 cues, about 160 s in Node) and `realistic-600` (about 9 s).
   - A regular test fails when a valid show fixture has no case, or a golden has no case.
5. **Recorder** `tools/fingerprints/record.mjs`.
   - Without `--reason` (10 or more characters) it writes nothing and exits 2.
   - It writes only the cases whose case, input or fingerprint changed, and appends `{date, reason, node, changed: first diffs}` to that file's `header.history`. An unchanged golden stays byte-identical.
   - `--check` writes nothing and exits 1 on any difference.
   - It refuses to run if `realisticShow` has drifted from `tools/bench/shows.mjs` `realistic`.
6. **Browser harness** `tools/browser-gates/fingerprints.mjs`. It injects the same esbuild bundle into **about:blank** in each engine. Wired into `daily-steps.mjs` as:
   - `fingerprints-run-<engine>`, which fails the run on a crash, a failed launch or a timeout (all three engines);
   - `fingerprints-match-<engine>`, which **fails the run in Chromium** and is **report-only in Firefox and WebKit**;
   - controls `fingerprints-neg-mismatch` (`FP_NEG=bump`, must print the `ledgerHash` difference) and `fingerprints-neg-crash` (`FP_NEG=crash`, must print CRASH).
   - `run.mjs`'s `pending` note for T2 is now empty.
7. **Proof sets:** `tools/mutants/sets/t2-fingerprint.mjs` and `t2-today.mjs`. Both run the same eight swaps from `tools/fingerprints/mutants.mjs`: one against the fingerprint spec alone, one against the other 72 regular specs.
8. **One guard edited:** `designer-structure.spec.ts` pins the `openShow` callers (Boo Phase 6 F5). I added `engine/loop/golden/show-fingerprint.ts` as a test-only caller, beside the existing `app/testing/show-fixtures.ts` precedent, with a comment.

## Why

- **Why a blank page and not the production app under its CSP.** This check is about JS-engine arithmetic on the engine code, and that needs no DOM, renderer or server. The production build has no fingerprint readout. Adding one would ship test code, and the cross-browser skill counts a readout as a real cost. The production CSP is already `gate-csp`'s job in all three engines, and that step fails the run. about:blank has no CSP, so the bundle runs as it is, with no `bypassCSP` and no test build of the app. The bundle is built by the same esbuild that `ng build` uses.
- **Why the Chromium compare step fails the run.** Chromium runs V8, the engine of the Node that recorded the goldens. A Chromium mismatch therefore means the harness is broken (the bundle, the fixture passing, the diff), and then the Firefox and WebKit verdicts mean nothing. This doesn't widen Skyler's ruling, which named Firefox and WebKit.
- **Why `populationDigest` as well as `traceDigest`.** If the driver's digest is broken, for example by skipping step 1 (Luigi's T38), the golden still has an independent count trace, and the `traceDigest` field itself turns the T38 survivor into a kill.
- **Why at-maximums isn't in the browser run by default.** It takes about 160 s in Node, and longer in Firefox. The at-cap case `done-when-60s-50.cap2500` covers order at the cap in each engine within seconds. `FP_CASES=all` adds it.

## Boundary

- **Blind spot, by design.** Integer fingerprints can't see a change that moves particles without changing a count, a launch or the end. Mutant F6 (the show's wind dropped) is the measured example. Positions stay covered by the run-vs-run store comparisons and the prototype golden's position sums. Adding a position hash would break the integer-only ruling.
- **Nothing was deleted or moved.** What the proof supports replacing later is listed in the proof section below. Replacing anything is a separate, reviewed step under `toad-verify-the-verifier`.
- **Re-recording is a reviewed change** (schema.md §8.1). A failing fingerprint spec is never fixed by re-recording without a reason that says why the new numbers are right.
- Toad's T3 property specs (`*.property*.spec.ts`) were left out of `t2-today` while he builds them, because the baseline must be green. His T3 proof covers them.

## Proof (mutants, `tools/mutants/run.mjs`, serial)

| Mutant | `t2-today` (72 other regular specs) | `t2-fingerprint` (the fingerprint spec alone) |
|---|---|---|
| F1 death at `age > life` (Luigi's P02) | **SURVIVED** | **KILLED** (Done-when, cap 2500, realistic-60: death equality is hit in dense shows) |
| F2 a cue's `burstHeight` override ignored | KILLED | KILLED |
| F3 launch `tx` rounded to a whole unit | **SURVIVED** | **KILLED** (`ledgerHash` only) |
| F4 trace digest skips step 1 (Luigi's T38) | **SURVIVED** | **KILLED** (`traceDigest`) |
| F5 cue seed perturbed at fire | KILLED | KILLED |
| F6 show wind dropped | KILLED (`plays under the show sky`, twin refuses another sky) | SURVIVED: the documented blind spot |
| F7 end one step late (calibration) | KILLED | KILLED |
| F8 same-step ties in array order (calibration) | KILLED | KILLED |

- **Conditions.** `t2-fingerprint` ran at load 17–26. `t2-today`'s first run left F4–F8 as TIMEOUT at load 60–255, while other agents' mutant rigs were running; a timeout is never counted as a kill. F4–F8 were rerun alone with `MUTANT_TIMEOUT_S=1800`, at load 13–23, and all of them got a verdict. Logs: `test-results/mutants/t2-fingerprint-2026-11-16T02-31-53`, `t2-today-2026-11-16T02-33-58` (F1–F3) and `t2-today-2026-11-16T12-13-15` (F4–F8).
- **Controls.** The regular spec bumps each of the 30 numeric fields of `cue-at-duration` by +1 and by −1. Every bump fails with exactly one difference, naming that field. Missing fields, extra fields and dropped samples fail too. In the browser, `fingerprints-neg-mismatch` and `fingerprints-neg-crash` are both caught through `tools/test/run.mjs daily --only …`. Without `--reason`, the recorder exits 2 and writes nothing.
- **What this supports replacing later (nothing was deleted).** The fingerprint suite kills every mutant in this set except F6. So the "same twice" determinism runs on the Done-when show can become a single golden comparison: the cases in `timeline-driver.daily.spec.ts` (determinism twice, at three frame sizes, the trace digest across runs, "ends within its bound twice"). The 2a.9 interleaved-sims spec and every store-exact seek and checkpoint equivalence must stay, because the fingerprint runs with checkpoints off and sees no positions. Each replacement still needs its own before/after proof run on the mutants the replaced test killed.
- **Measured in each engine** (`fingerprints.mjs`, 11 regular cases plus `realistic-600`): Chromium 157 took 15 s, Firefox 159 took 19 s and WebKit 27.2 took 11 s. **Every case matched the Node goldens exactly** in all three. `at-maximums` was not run in a browser (`FP_CASES=all`).

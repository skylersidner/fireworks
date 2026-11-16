# Toad: the `final` tier, the F1 coverage floor, Boo F6, and the first full daily (2026-11-16)

## What
- **`node tools/test/run.mjs final`** = every daily step, plus `test:final` (`*.final.spec.ts`), the `at-maximums` fingerprint in Chromium, Firefox and WebKit (`FP_CASES=at-maximums`, `FP_TAG=final`; the run steps fail on a crash, the compare fails in Chromium only), `gate-warm` and `tools/bench/bench.mjs` (report-only), and `docker build --no-cache`. Output: `test-results/final/<stamp>/`. Daily no longer has the benchmarks, `at-maximums` or the uncached build.
- **`at-maximums` is selected by name** (`FINAL_ONLY_CASES` in `engine/loop/golden/show-fingerprint.ts`), not by a third `tier` value: each golden's `case` records its tier, so a new value would mean a re-record. A regular spec pins every final-only name to a `daily` case, so a typo can't drop it from both tiers. `test:regular` and the quick tier exclude `*.final.spec.ts` as well as `*.daily.spec.ts`.
- **`daily-status.mjs` reads `daily/` and `final/`.** The newest stamp across both wins, and a complete green final run counts as a daily because it runs every daily step.
- **F1 coverage:** the T3 generator never produced resize-and-back at the regular seed (N 24: 0 times; N 500: about 3). With that generator, F1a and F1b (`tools/mutants/sets/f1-fix.mjs`) survived `timeline-driver.property.spec.ts`; only `run-key.spec.ts` killed them. Now, after frames run under another key, the next action is a directed key back with probability 0.8. The regular floor adds `key back` and `seek after key back`. The esbuild fast screen kills both F1a and F1b at the regular seed, and `T3_RESIZE_BACK=0` fails the floor.
- **Boo F6:** `engine-boundary.spec.ts` rule: no shipped file (not a spec, not under `app/testing/`, `engine/*/golden/` or `engine/*/testing/`) imports into those folders in any form, type-only included. Its control is a synthetic graph, plus a positive check on the real tree. A mutant (`open-link-page.ts` importing `app/testing/show-fixtures`) was caught and then reverted.

## Why
- Skyler's ruling (plan, "Daily trimmed"): daily runs once per phase in about 25–30 min, and the heavy items wait for the end-of-project review. The first full daily took 21.4 min and was green.
- A floor on a key the generator never hits is a test that can't fail on the bug it names.

## Boundary
- A new heavy case goes to `*.final.spec.ts` or a `tier === 'final'` block in `daily-steps.mjs`, never into daily. Moving a fingerprint case between tiers is a name-list edit; changing its recorded `tier` is a reviewed re-record.
- The F1 floor holds at the fixed regular seed only; the margin is thin (2 key backs, 1 failing case per F1 mutant). If the generator's stream changes, re-check the kill with the fast screen.
- Open: `keyboard-firefox` and `keyboard-webkit` are report-only notes because of gate-script problems (see the history entry). They are not product defects.

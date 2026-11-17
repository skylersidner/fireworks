# Toad: the first end-to-end `final` tier run (2026-11-17)

## What
- **`caffeinate -dims node tools/test/run.mjs final`: PASS, complete, 75/75 steps, wall 1946 s (32.4 min).** Run `test-results/final/2026-11-17T105956`, commit `f7f21de` plus 18 uncommitted paths (the redundant-spec deletion, K1/K2, `t3-redundancy.mjs`, and Scribe's docs). Node v26.5.0. Load 4.05 at start and 3.49 / 3.92 / 5.15 at the end. Nothing else heavy was running; the Development API on 5180 and VS Code were idle.
- **`daily-status.mjs` reports OK** (`latest final/2026-11-17T105956`), so the freshness rule sees this run.
- **Steps match `toad-interlude-final-tier.md`:** every daily step, plus `unit-web-final`, `fingerprints-max-{run,match}-{chromium,firefox,webkit}`, `bench-warm-after`, `bench-seek-node` and `docker-build-nocache`.
- **Measured times:**

  | Group | Steps | Time |
  |---|---|---|
  | Regular steps | `format` 4.6, `fixtures` 0.4, `typecheck` 6.8, `unit-web` 31.4 (1763 tests in 79 files), `build-web` 7.8, `build-dotnet` 1.2, `test-dotnet-pg` 57.2 (862 tests) | ≈ 110 s |
  | Tiered unit specs | `unit-web-daily` 110.6 (27 tests), `unit-web-final` 112.2 (1 test) | 223 s |
  | Chromium gates and controls | | ≈ 12.4 min |
  | Firefox and WebKit gates | | ≈ 5.6 min |
  | Regular and daily fingerprints, three engines, plus 2 NEGs | | 44 s |
  | at-maximums fingerprints | Chromium 127.6, Firefox 147.4, WebKit 95.6 | 371 s |
  | Benchmarks | `gate-warm` 32.1, Node seek 50.9 | 83 s |
  | Uncached docker build | | 93.9 s |

- **Benchmarks (report-only, within their bars):**
  - Browser after warm-up: done-when-60 p95 231 ms (bar 1039); realistic-600 p95 496 ms (bar 1000); 0 missed seeks.
  - Node cold p95 (no warm-up): done-when-60 696 ms; realistic-600 2846 ms. Both are lower than the Phase 7 numbers (0.84–1.13 s and 3.5–3.8 s in `toad-phase7-caps-and-seek.md`). These are the inputs for the CPU-cost review.
- **A first attempt was aborted.** The shell resolved nvm's Node v21.5.0, so every `ng` step exited 3 in about 1 s ("Angular CLI requires … v22.22.3"). Because `final` keeps going, the browser steps then ran against the old `wwwroot`. I killed it, killed its orphan Testing API (ppid 1), and dropped `fireworks_{test,smoke}_final_93790`. Its folder is `test-results/final/aborted-2026-11-17T105724-node21`. It has no `summary.json`, so `daily-status` ignores it.

## Why
- Skyler approved the full final tier with "no shortening" for the end-of-project review. It had never run end to end, and a final run that is green and complete also satisfies the daily gate rule.

## Boundary
- **Run the long tiers with Node from `.nvmrc` (26.5.0).** `package.json` `engines` (`>=26.5.0 <27`) isn't enforced, and `run.mjs` doesn't check it. Recommendation for Toad: add a preflight in `run.mjs` that exits 2 when `process.version` doesn't satisfy `engines`. With keep-going, a failed `build-web` otherwise leaves the browser steps testing a stale bundle. The summary is still red, but the 30 minutes are wasted.
- **Drift in `docs/fireworks-app/testing-strategy.md` §2.3** (documentation only; nothing runs differently):
  - The final rows are still estimates. Measured: `test:final` 112 s (estimate 2.5–3 min); at-maximums 96–147 s per engine ("several minutes"); docker 94 s ("not measured, 3–6 min"); benchmarks 83 s ("about 2 min"); Firefox and WebKit gates about 6 min ("20–25 min").
  - There's no final total. It is now 32.4 min.
  - The T6 row says "compared with baselines". `gate-warm` checks fixed bars, but `bench-seek-node` prints numbers with no stored baseline or drift check. A person compares them by hand against the Phase 7 record.
  - The real-time play row lists the `TOAD_INJECT_ERROR` and `TOAD_HIDE_ENDED` NEGs as in all three engines. They run in Chromium only. Firefox and WebKit run only the positive round trip, and WebKit uses `JSON_ENGINE=chromium`.
- Report-only steps were all green. `keyboard-webkit` has its two known skips (K9 My shells and `/mine`: no Secure cookie on http).
- Slow-test warnings (never failures):
  - `timeline-driver.property.spec.ts`: 11.8 s.
  - `realistic-60` golden: 9.5 s.
  - Worst shell at the limits: 8.9 s.
  - `scheduled-ledger` at width 1000: 5.0 s.
  - The slowest file is `timeline-driver.spec.ts` at 18.0 s.

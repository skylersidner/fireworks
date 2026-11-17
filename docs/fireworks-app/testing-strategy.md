# Testing strategy proposal: regular and daily suites

**Status:** proposed 2026-11-15; adopted by Skyler 2026-11-16 with the amendments marked below. Tables marked "proposal" keep their original estimates; §2.3 carries measured times (refreshed 2026-11-17 from the first full final run).
**Authors:** Toad (test strategy, timings), merging Yoshi's engine techniques T1–T7 (`.squad/decisions/records/yoshi-interlude-show-testing.md`).
**Brief:** plan, "Interlude after Phase 7". The regular suite runs in under 5 minutes. Anything longer moves to a daily suite, which also runs at the end of all phases as a final review. Development must not slow down. Regular runs and phase gates use Chromium only; Firefox and WebKit move to the daily run.
**Evidence:** `.squad/decisions/records/toad-interlude-test-timing.md` (measurements, step 1) and the probes in this step (`scratchpad/toad-interlude2/`, described in §2.4).

### Words used here

- **Spec file:** one `*.spec.ts` test file. Vitest runs the tests inside one file one after another, on one worker, so the slowest file sets the minimum time for the whole run.
- **Wall time:** clock time from start to finish, as you'd measure it with a stopwatch.
- **Load:** the machine's load average (`uptime`). The machine has 12 cores. At load 20, everything waits for CPU, and the heavy tests ran up to 7× slower than they do alone.
- **Negative control (NEG):** a deliberate break that a check must catch. It proves that the check can fail (standing decision `toad-verify-the-verifier.md`).
- **Mutant:** a small deliberate bug in product code, used to prove that a test catches it. A test "kills" a mutant if it fails on it.
- **Golden / fingerprint:** a committed file of expected numbers (for example, particle counts at fixed steps). A test compares a fresh run against it.
- **Virtual time:** the browser's clock is faked by Playwright (`page.clock`), so a 60 s show can be stepped through without waiting 60 s.
- **Gate scripts:** the Playwright browser checks used at phase gates (`gate-csp`, `gate-roundtrip` and others). They live in `tools/browser-gates/` (they started in a scratchpad folder).

---

## 1. Where the time goes today

From step 1 (Phase 7 commit `8eb99c7`). These were measured at load 8–20, not on an idle machine, so frontend numbers are inflated. Where a solo figure exists, it was measured with only that file running.

| Check | Wall time | Notes |
|---|---|---|
| `ng test` (68 files, 1,640 tests) | **124 s** (load 20) | Build 17 s plus vitest 104 s. **One file sets the wall:** `timeline-driver.spec.ts` took 101 s (39.5 s solo). The other 67 files finish while it runs. |
| `fireworks-stage.phase7.spec.ts` | 58 s (28.6 s solo) | Next ceiling after timeline-driver. |
| `show-builder.store.spec.ts` | 55 s (14.1 s solo) | Two tests make 10 full 60 s show runs only to read the launch ledger. |
| `npm run typecheck` | 10 s | |
| `prettier --check` | 6.5 s | There's no `format:check` script; `npm run format` writes. |
| `ng build` | 10 s | |
| `dotnet build` | 3–15 s | |
| `dotnet test` with Postgres (673 tests) | **42 s** | Mandatory, because the plain run doesn't cover `Program.cs` (`toad-postgres-gated-suite-is-required-for-program-cs.md`). |
| `generate-fixtures.mjs --check` | 0.3 s | Not wired into any suite. |
| **In-repo regular total, serial** | **≈ 205 s (3.4 min)** | Already under 5 min, even under load. |
| Browser gate (scratchpad, Chromium only) | **≈ 1,160 s (19–21 min)** | `gate-csp` NEG alone is 488 s of 30 s timeouts. `gate-roundtrip` is 93 s, mostly a 66 s show played in real time. |
| The same gate on three engines | ≈ 60 min (estimated) | |

**The cost unit** is one full simulation of the 60 s Done-when show: about 1.2 s solo. Specs run it, or an equally long seek, dozens of times.

**Two corrections to step 1, settled from the code:**

1. **Real sleeps do exist.** Step 1 said the only `setTimeout`s were 0 ms flushes. That was wrong: my search missed timers with a delay argument. There are four files with real waits:
   - `designer-save.spec.ts`: `settleDraft` and inline waits of 350 ms. There are 5 call sites, and one table-driven test (`it.each`, 4 rows) waits twice per row. That is about 13 waits, or about 4.6 s.
   - `open-link-page.spec.ts`: `tick(350)`, a real `setTimeout`, at 11 call sites (about 3.9 s or more).
   - `show-save.spec.ts`: 2 × 600 ms.
   - `show-builder.store.spec.ts`: 2 × 550 ms (the draft debounce plus 50 ms).

   Together that is roughly **10–11 s of sleeping** (my estimate from call sites). Yoshi counted 2.3 s in two files. Today none of it is on the critical path, because it finishes in timeline-driver's shadow. Once that file is split, it will start to matter.
2. **Yoshi is right that the builder and player page specs spend real clock.** I said no spec used a real clock. That was true only in the sense that none *waits* on one. The stage's clock token `STAGE_CLOCK` defaults to `performance.now()` (`fireworks-stage.ts:114–115`). Only 2 of the 9 stage-mounting spec files (`fireworks-stage.phase7` and `fireworks-stage.timeline`) replace it. In the other 7, warm-up and seeks are budgeted against the real clock, so each fake frame can do up to 12 ms of real simulation work (`WARM_UP_IDLE_MS`). Example: the first `show-builder-page` test runs 120 frames, which is up to 1.4 s of CPU. The number of steps per frame then depends on machine load, which is a flake source. Yoshi's T5 fixes this.

**Where Yoshi's estimates and my measurements disagree, and how each is settled:**

| Claim | Yoshi | Toad (step 1) | Settled by | Result |
|---|---|---|---|---|
| Builder page specs burn real clock | Yes (12 ms per idle frame) | "No spec uses a real clock" | `STAGE_CLOCK` default and injection sites (above) | **Yoshi is right about the mechanism.** My wording was wrong: there are no waits, but the work is budgeted by the real clock in 7 files. |
| Real sleeps | 2.3 s in 2 files | none | search for timers with a delay | **Both were low.** About 10–11 s in 4 files (above). |
| A 60 s show under browser virtual time | about 700 rendered frames instead of 4,000+, so much faster | not measured | probe P1, §2.4 | **Frame count drops, but wall time doesn't:** 62.6 s for the 66 s show. Short fixtures only. `runFor` is slower than real time. |
| Regular `gate-roundtrip` with T4 | 15–20 s | 13–14 s for `SKIP_PLAY` | P1 on the 10 s show | **Agree:** about 15 s, with the player part on a 10 s fixture. |
| Cost of one Done-when run | about 1.1 s | about 1.2 s solo | – | Agree. |
| 40k sustained-load test | 1–2 s alone | 11.4 s at load 20 | 7× load inflation measured in step 1 | Consistent: about 1.6 s alone. |
| Engine and stage specs after T1–T7 | 15–25 s alone | – | not yet measurable | Accepted as an estimate. §7 step 8 measures it at load ≤ 4 before the target is called met. |

---

## 2. Proposed tiers

### 2.1 Fast inner loop (dev, under 30 s, not a gate)

This is for the edit–test cycle, and it's optional to use.

- `npm run test:watch`: `ng test` in watch mode, which re-runs on save. Use `--include` for the file you're working on.
- `node tools/test/run.mjs quick`:
  - `prettier --check` on changed files;
  - `npm run typecheck` (10 s);
  - `ng test --include` on the spec files mapped to the changed source files (the test-impact map, §4.5);
  - for a C# change, `dotnet test --filter` on the matching test class.

  Expected time: about 15–30 s. A single cached spec file builds in 2.7–4.8 s (measured in step 1).

### 2.2 Regular (under 5 min; every change, and every phase gate)

**Invocation:** `node tools/test/run.mjs regular`. It runs the steps below in order, stops at the first failure, and prints one timing line per step. Each step is also runnable on its own.

| # | Step | Command | Expected time | Basis |
|---|---|---|---|---|
| 1 | Format | `npm run format:check` (new: `prettier --check "src/**/*.{ts,html,scss,css,json}"`) | 6.5 s | measured |
| 2 | Fixtures current | `node schema/tools/generate-fixtures.mjs --check` | 0.3 s | measured |
| 3 | Typecheck | `npm run typecheck` | 10 s | measured |
| 4 | Frontend unit, engine and jsdom specs | `npm run test:regular` (new: `ng test --no-watch --exclude="**/*.daily.spec.ts"`) | **60–75 s** after the §3 changes (124 s today at load 20) | estimate: build 17 s plus the new longest file (about 25–35 s at low load), plus margin for load |
| 5 | Production build | `ng build` (writes `wwwroot` for step 8) | 10 s | measured |
| 6 | .NET build | `dotnet build` | 3–15 s | measured |
| 7 | .NET tests with Postgres | `FIREWORKS_TEST_POSTGRES=… dotnet test --no-build` | 42 s | measured |
| 8 | Chromium smoke (new; needs the API on a test port serving step 5's build) | `npm --prefix tools/browser-gates run smoke` | **50–70 s** including API start | see below |
| | **Total, serial** | | **≈ 3.0–3.9 min** | |

**What the Chromium smoke contains** (Chromium only, real production CSP, no `bypassCSP` except where a check needs it):

- `headers` (1 s; 287 header checks).
- `gate-roundtrip` with `SKIP_PLAY=1`: builder edit, save, share and open (13–14 s measured). Its 700 ms sleeps become polling (about −3 s, estimate).
- **Player under virtual time:** a 10 s show (the `cue-at-duration` fixture) plays to its end, then Replay plays it to its end again, with no console errors (probe P1 in §2.4). It takes about 2 s of play, and about 8 s with browser start.
- `gate-csp` real-CSP pass with its fixed 2.5 s and 2 s waits replaced by polling for a ready signal, plus a NEG that looks for the CSP violation report instead of waiting out a 30 s timeout (§3, item 8). Estimate: 20–30 s.

**Why a browser step belongs in the regular tier:** jsdom (the fake browser that unit tests run in) can't load the production CSP, real WebGL or the real router. Without step 8, a change that breaks the app in a real browser would wait a day to be caught. It's a canary, not the full gate.

**What leaves the regular tier:** every long show run outside the engine, the 40k sustained-load test, `at-maximums`, real-time plays, Firefox and WebKit, seek benchmarks and the full keyboard, touch, follow and reduced-motion walks. All of these go to the daily tier, and none is dropped. (Since 2026-11-16, `at-maximums` and the seek benchmarks go one step further, to the `final` tier; §2.3.)

**Phase gates** run the regular tier, plus any phase-specific gate scripts in Chromium, plus a check that the latest daily run is green and less than 24 h old (§6).

### 2.3 Daily, and the final tier

> **Amended 2026-11-16 (Skyler, "daily trimmed"):** benchmarks, the `at-maximums`/extreme-show runs and the uncached Docker build moved out of daily into a new **`final` tier** (`node tools/test/run.mjs final`), which runs daily plus those items, only at the end-of-project review. Daily is now about 25–30 min and runs once per phase, before its gate. The table below is the original proposal; the "Tier" column says where each row lives now. Daily steps are listed in `tools/browser-gates/daily-steps.mjs` (`--list` prints both tiers). `at-maximums` moved to `show-fingerprint.final.spec.ts` (`FINAL_ONLY_CASES` in `show-fingerprint.ts`; the goldens are unchanged), regular and quick exclude `*.final.spec.ts`, and `daily-status.mjs` accepts a complete green final run as a daily. Measured first full daily (2026-11-16, load 3.9 → 5.1): **21.4 min**, green; regular-tier steps 77 s, `test:daily` 105 s, Chromium browser gates and controls about 11 min, Firefox and WebKit about 6.4 min, fingerprints in three engines 62 s.

> **Refreshed 2026-11-17 (Toad, `toad-final-tier-run.md`, `toad-end-review-followups.md`):** the times below are measured, from the first end-to-end `final` run (`test-results/final/2026-11-17T105956`, 75/75 steps, green, Node v26.5.0, load 3.5–5.2), except where a row says "estimate". **The final tier took 32.4 min wall.**

**Invocation:** `node tools/test/run.mjs daily` (or `final`). It writes `test-results/<tier>/<stamp>/summary.json` and one log per step, and exits non-zero if any step that is allowed to fail the run fails.

**Node 26.5 is required.** `run.mjs` (every tier, `--list` included), `tools/browser-gates/daily.mjs` and web runs of `tools/mutants/run.mjs` exit 2 before any step when `process.version` doesn't satisfy `engines.node` in `src/web/fireworks-web/package.json` (`>=26.5.0 <27`), the one source the check reads (`tools/test/node-version.mjs`). `.nvmrc` (26.5.0) is what `nvm use` picks, and the check refuses to run if it falls outside that range. The reason: under nvm's default v21.5.0 every `ng` step exits 3 in about a second, and because daily and final keep going, the browser steps then test a stale `wwwroot`.

| Step | Tier | Fails the run? | Measured time (2026-11-17 final run) |
|---|---|---|---|
| Everything in the regular tier (daily and final leave out the smoke: the browser steps cover it) | daily | yes | about 110 s: `format` 4.6, `fixtures` 0.4, `typecheck` 6.8, `unit-web` 31.4 (1763 tests in 79 files), `build-web` 7.8, `build-dotnet` 1.2, `test-dotnet-pg` 57.2 (862 tests) |
| `npm run test:daily` (`ng test --include="**/*.daily.spec.ts"`): the long-show variants moved out of regular; T2 `realistic-600`; T3 property tests with N = 500 and a fresh, printed seed; the 40k sustained-load run | daily | yes | 110.6 s (27 tests) |
| `npm run test:final` (`*.final.spec.ts`): the T2 `at-maximums` golden | **final** | yes | 112.2 s (1 test) |
| Browser gate, all scripts, **Chromium** (CSP, keyboard, touch, follow, reduced motion, `gate-auth`, round trip with the real-time play, not-found, tamper), each with its negative controls | daily | yes | about 12.4 min |
| CSP, round trip and the fidelity walks on **Firefox and WebKit** | daily | CSP and round trip: yes; the keyboard, reduced-motion and follow walks are report-only (standing: cross-browser means it runs) | about 5.6 min |
| T2 fingerprints (regular cases and `realistic-600`) in all three engines, plus 2 NEGs | daily | a crash fails it; the compare fails in Chromium, report-only in Firefox and WebKit | 44 s |
| T2 `at-maximums` fingerprint in all three engines (`FP_CASES=at-maximums`) | **final** | as above | 127.6 s Chromium, 147.4 s Firefox, 95.6 s WebKit (371 s) |
| Real-time 66 s play in all three engines. **The `TOAD_INJECT_ERROR` and `TOAD_HIDE_ENDED` NEGs run in Chromium only** (`roundtrip-neg-error`, `roundtrip-neg-ended`); Firefox and WebKit run only the positive round trip, and WebKit's uses `JSON_ENGINE=chromium` (no Secure cookie on http, so it can't save) | daily | yes | included in the browser rows above |
| `bench-warm-after` (`gate-warm.mjs`): browser seeks after warm-up, against **fixed bars** (realistic-600 p95 < 1000 ms, done-when-60 p95 ≤ 1039 ms, no missed seeks) | **final** | **never** fails the run (report-only); it prints ok or FAIL per bar | 32.1 s |
| `bench-warm-natural` (`gate-warm.mjs natural`, added 2026-11-17, `toad-end-review-verification.md`): the shipped warm-up skip. It reports the state each show reaches (`finished` or `skipped`) and holds the skip's promise: p95 < 1000 ms either way, no missed seeks, realistic-600 never skipped. `bench-warm-after` and the `early` mode patch the skip threshold to 0 in the bundle (exactly one hit, or the run fails), so their bars still measure a warmed show: done-when-60's cold run (about 1.1 s) sits on the 1 s skip threshold and is skipped at the shipped value | **final** | **never** (report-only) | about 35 s |
| `bench-seek-node` (`tools/bench/bench.mjs`): Node cold and warm seek p95 with no render. **It has no stored baseline and no drift check**: it prints numbers, and a person compares them by hand with the last record (`toad-final-tier-run.md`: done-when-60 cold p95 696 ms, realistic-600 2846 ms; `toad-phase7-caps-and-seek.md` before that) | **final** | **never** fails the run | 50.9 s |
| Uncached `docker build --no-cache` | **final** | yes | 93.9 s |
| Mutant sweep | neither (see below) | – | – |
| **Total** | | | **daily** 21.4 min (2026-11-16); **final 32.4 min** (2026-11-17). The 2026-11-15 proposal estimated 50–65 min |

**Mutant sweeps:** I recommend *not* running them daily. Three reasons:

- Mutation testing is limited to engine, save-path and guard code (standing).
- Runs are serial, and a sweep of about 50 mutants takes 20–40 min.
- A mutant result changes only when the tests or the mutated code change.

Instead, move the runners from the scratchpad to `tools/mutants/` and run them in three cases:

- before any test is deleted or replaced (§7);
- at the final review;
- at a phase gate whose phase touched that code.

### 2.4 Probe P1: Playwright virtual time under the production CSP (done, Chromium)

Yoshi's T4 depends on this probe. Script: `scratchpad/toad-interlude2/p1-clock.mjs` (and `p1-ff.mjs`). It runs against the running API on 5180 with the real CSP header (`script-src 'self'`, no `unsafe-eval`), on a 10 s show (`cue-at-duration` fixture, code `wtJbvvGv`).

- **It works under the real CSP.** `page.clock.install()` is accepted with no `bypassCSP`. The WebGL renderer runs, the show reaches "has ended", Replay restarts it from 0:00 and it ends again. There were no console errors.
- **Trap 1: `install()` alone doesn't freeze time.** My first negative control (never advance the clock, wait 16 s of real time) found the show had *ended anyway*: the installed clock keeps running at real speed. So my first "pass" was partly real-time play. With `pauseAt(…)` right after `install()`, the NEG passes (still 0:00 after 16 s), and the positive run ends after exactly 14.2 s of virtual time, which matches the show's length plus its fade. **Every virtual-time check needs this NEG.**
- **Trap 2: use `fastForward`, not `runFor`.** `runFor(100)` fires every 16 ms animation frame inside the 100 ms, so it renders 60 frames per show second in software WebGL. That is *slower* than real time: the 60 s Done-when show had not ended after 180 s, and I stopped it. `fastForward(100)` fires one frame per call, which is Yoshi's design. On the 10 s show, `fastForward` took 1.3 s for the first play and 0.9 s for Replay, at load 15–19.
- **Virtual time doesn't make a dense show fast.** With `fastForward(100)`, the 66 s Done-when show took **62.6 s** of real time at load 15–20: about the same as playing it in real time. Each virtual frame carries 12 simulation steps at about 5k live particles, plus a software-WebGL render, so the browser is bound by CPU, not by waiting. (My Replay loop then stopped at its 400-call cap, short of the show's end. That cap was in the probe, not a defect.) **So in the browser, virtual time pays only on short, sparse fixtures (a 10 s show in about 1 s).** Long or dense shows stay in Node, through T2 goldens, where the 60 s show costs about 1.2 s with no render.
- **Trap 3: Playwright's `page.click` can stall while the clock is paused.** Its "element is stable" check waits on animation frames. One Replay click took 3.7 s, another 22 s. A DOM click through `page.evaluate` takes 2–5 ms.
- **Trap 4 (Yoshi's, confirmed by the code, not probed):** under a frozen clock, seek and warm-up budgets never run out, so a seek finishes in one frame. Virtual-time runs must therefore stay on short shows, and budget behavior stays in the jsdom specs.

---

## 3. Changes to reach the tiers

Effort: S = under half a day, M = about a day, L = several days. Savings are wall time of the regular tier at low load unless marked.

| # | Change | Owner | Effort | Saves | Notes |
|---|---|---|---|---|---|
| 1 | **Split `timeline-driver.spec.ts`** into 3–4 files by topic (determinism, checkpoints, seeks, edits and twins). Long-show cases go to `timeline-driver.daily.spec.ts`. | Yoshi (engine spec) with Luigi | S | ≈ 40–60 s at load 20 (it sets the wall today) | No test changes meaning. The cheapest big win, and it can land first. |
| 2 | **Split `fireworks-stage.phase7.spec.ts`** (warm-up / end clamp / other) and apply T1 (`shortShow()` for the end clamp, a 4 s show with `checkpointSteps: 120` for warm-up) | Luigi | M | ≈ 20–25 s solo → under 5 s | Expected grids change from `[1200, …]` to `[120, …]`. The engine spec keeps pinning the 1,200 default. |
| 3 | **T1 `scheduledLedger(show, width)`** test helper; `show-builder.store` 6c.3 and 6c.4 and `player-page.show` use it | Luigi (helper), Toad (proof) | S | ≈ 12 s solo (25–50 s under load) | Proof first: one engine spec pins `scheduledLedger(doneWhenShow())` equal to the full-run ledger, with a NEG mutant (`tx` reads `sim.particles.n`). |
| 4 | **T2 integer show fingerprints**: recorder `engine/loop/golden/record-show-golden.mjs`, committed `show-golden.ts` | Yoshi (recorder), Toad (spec and NEG) | M | ≈ 10–15 s (the "run it twice" tests become one run compared with a golden) | Integer-only: counts, ledger hash, `endStep`, `traceDigest`. No float hashes. `at-maximums` is daily only. Re-records are reviewed diffs (schema.md §8.1 rule). |
| 5 | **T3 seeded property tests** on 2–6-cue shows (N = 25 regular, N = 500 daily) | Toad | M–L | ≈ 15–25 s solo, once the long Done-when seek cases move to daily | Old cases are not deleted until T3 kills the same mutants (§7). Named regression cases (D1, M8, ties, the 1,200 default, memory-cap doubling) stay. Done 2026-11-17: the cases T3 made redundant are deleted (§7 safety rules). |
| 6 | **T5 `provideStepClock()`** in `app/testing/stage-clock.ts`, used by the 7 stage-mounting specs that use the real clock today | Luigi | S | ≈ 2–5 s; the main gain is load-independent steps per frame, which removes a flake source | No product change; it's a test seam over `STAGE_CLOCK`. |
| 7 | **T7 small items:** `referenceRun` memoized oracle per file; 40k sustained load at capacity 2,500 in regular, with 40k in daily; worst-shell tail at `t = 0` | Luigi, Yoshi | S each | ≈ 10 s under load (40k test alone was 11.4 s at load 20) | Oracle targets must be recorded steps (Yoshi's warning: restoring a snapshot to reach a target tests `restore` against itself). |
| 8 | **Shorten the `gate-csp` NEG.** Replace "wait 30 s for `running`, expect a timeout" with "wait for the first `securitypolicyviolation` event or the console 'Refused to execute' line, then check `running` is still absent after a short settle (2 s)". | Toad | S | ≈ 400 s of gate time (488 s → about 60 s) | A shorter timeout on its own would be weaker: a page that is merely slow would look "blocked". Positive evidence of blocking keeps the NEG honest. |
| 9 | **Fake timers for the real sleeps** in `designer-save`, `open-link-page`, `show-save` and `show-builder.store` (`vi.useFakeTimers` plus `advanceTimersByTimeAsync`, or the injected debounce timer) | Luigi (owns the specs), Toad (review) | S | ≈ 10 s of CPU-idle wall across 4 files (it matters only after item 1) | Check that each wait still covers the debounce (500 ms show, 300 ms designer). Prove it with a NEG: an advance shorter than the debounce must make the test fail. |
| 10 | **`format:check` script** in `fireworks-web/package.json` | Luigi | S (one line) | – (adds 6.5 s, already counted) | NEG: a local edit with bad spacing must fail it. |
| 11 | **Fixtures `--check` in the regular tier** | Toad | S | – (0.3 s) | NEG: change one byte in a generated fixture; `--check` must exit non-zero. |
| 12 | **Move the gate scripts into the repo:** `tools/browser-gates/` with its own `package.json` (Playwright pinned at 1.65.0), `BASE` and `ENGINES` env vars, a `smoke` script (regular step 8) and a `daily` script | Toad | M | none directly; it makes the daily run possible at all | **Prerequisite for everything daily.** Today one scratchpad cleanup loses every browser check. This mirrors the reference's `tools/<name>/package.json` layout. |
| 13 | **Move the mutant runners and seek bench into the repo:** `tools/mutants/` and `tools/browser-gates/bench/` | Toad | M | – | Same reproducibility risk as item 12. |
| 14 | **`tools/test/run.mjs`**, the single entry point (`quick`, `regular`, `daily`), printing one timing line per step and writing `summary.json` | Toad | S–M | – | No new dependencies; Node only. |
| 15 | **T4 virtual-time player smoke** (regular step 8) and the real-time play moved to daily | Toad | S | ≈ 75 s of gate time (93 s → about 15 s) | Uses the P1 rules: `pauseAt`, `fastForward`, DOM clicks, a frozen-clock NEG. Use a 10 s fixture only: P1 showed the 60 s show gains nothing under virtual time. |
| 16 | **T6 benchmark with baselines** (`baselines/<machine>-chromium.json`), report-only. *Not built as proposed: the benchmarks run report-only in the final tier with no baseline file (§2.3, §5.4).* | Toad | M | ≈ 90 s of gate time moves out of gates | Drift rule in §5.4. |

**Regular tier after items 1–11, 14 and 15:** an estimated 3.0–3.9 min serial at low load. Items 1, 3 and 10–11 alone keep the in-repo part under 3 min. Items 12 and 15 add the browser smoke.

---

## 4. Other ideas for smoother dev testing

| # | Idea | Recommendation | Needs Skyler? |
|---|---|---|---|
| 4.1 | **More vitest workers or sharding.** `ng test` (the Angular `unit-test` builder) doesn't expose `--shard` or `--maxWorkers` as flags, but takes a `runnerConfig` file. | **Not yet.** The wall is one file, not worker count, and on a loaded 12-core machine more workers mostly inflate each other (7× seen). Revisit after the splits, with measurements at load ≤ 4. | No |
| 4.2 | **Affected-only runs (`--changed`).** Vitest's `--changed` isn't exposed through `ng test` either. | Use `--include` driven by the test-impact map (4.5) in the `quick` tier, and watch mode, which already re-runs only what the change touches. Never use it for the regular tier or gates. | No |
| 4.3 | **A pre-commit hook** running only `format:check` on staged files, plus typecheck (about 15 s) | **Opt-in**: a `tools/test/install-hook.sh` that you run if you want it. It is not installed by default, and it never runs `ng test` (too slow for a commit). | **Yes.** It changes your commit flow. |
| 4.4 | **A flake quarantine policy.** A test that fails and then passes on an unchanged tree is logged in `tools/test/quarantine.json` (test, owner, date, cause). Quarantined tests still run in the daily tier. They are fixed or deleted within one phase. There are no automatic retries in regular. | **Adopt.** The Phase 7 flakes (C3) were load-driven 5 s timeouts, and T5 removes the main cause. Retries hide real races. | **Yes.** It is a standing testing rule. |
| 4.5 | **A test-impact map:** `tools/test/impact.json`, mapping source folders to spec globs (for example `engine/loop/**` → `engine/loop/**/*.spec.ts` plus the stage specs). It is used only by `quick`. | **Adopt**, kept small (folder level, not file level). Derive it from imports later if it drifts. | No |
| 4.6 | **One shared Postgres database name per run** (`fireworks_test_<tier>_<pid>`), dropped at the end. This prevents the leftover databases Mario found at the Phase 7 gate. | Adopt, in `run.mjs`. | No |
| 4.7 | **Record the load** (`uptime`) in every `summary.json`. Mark timings at load > 6 as "not comparable". | Adopt. Load explains most of the variance seen so far. | No |
| 4.8 | **Slow-test budget check:** `run.mjs regular` prints any spec file over 30 s and any test over 5 s (from vitest's JSON reporter). It warns; it doesn't fail. | Adopt. It catches the next `timeline-driver` before it grows. | No |

---

## 5. Risk evaluation

"Undetected for" is the worst case: how long a regression can hide before something catches it. "Up to a day" assumes the daily run is automated (§6). Without automation, it means **until the end-of-phase review**.

| Move | What could regress undetected | For how long | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| **5.1 Firefox and WebKit move to daily** | Something that runs in Chromium but breaks in Firefox or WebKit: a WebGL feature, a CSS feature, `structuredClone` or a timing difference | Up to a day | Low–medium. Phases 2–7 found a few engine-specific issues, all caught by the cross-browser scripts. | Medium. The site loads but a page fails on Safari or Firefox. | Daily three-engine gate. A daily failure blocks the next phase gate. T2 fingerprints in all three engines catch simulation drift in seconds. |
| **5.2 Long-show tests replaced by short-show or property tests** | A bug that appears only at realistic density (about 5k live particles), at long offsets (checkpoint spacing doubling past the memory cap) or after many checkpoints | Up to a day (the long variants run daily) | Low, if the mutant proof holds | High. Wrong seeks in saved shows. | No old test is deleted until its replacement kills the same mutants (§7). The Done-when golden (one full run) stays regular. Named past-defect cases stay. The long variants move to `*.daily.spec.ts`; they aren't dropped. |
| **5.3 Virtual time hides real-clock bugs** | Behavior that depends on real frame pacing: seek budget overruns, "Catching up…" timing, resource growth over a long real play, a late `console.error`, rAF throttling | Up to a day | Medium. Virtual time freezes `performance.now()` inside a frame, so budgets never run out (trap 4). | Medium. Stutter or a stuck "Catching up…" indicator. | Budget behavior stays in the jsdom step-clock specs (7l.6, "seek budget is time, not steps"). The real-time 66 s play runs daily in three engines with its NEGs. Every virtual-time check carries the frozen-clock NEG from P1. |
| **5.4 Benchmark drift goes unnoticed** | Seek p95 or warm-up time slowly creeping up, since the bench never fails a run | Weeks, if nobody reads the report | Medium | Low–medium. Performance is benched until the end of the project (standing), but the 1 s p95 trigger matters. | Proposed: `summary.json` flags drift when p95 is over 1.25× baseline on 2 consecutive daily runs, plus the standing absolute triggers (p95 > 1 s, the 7l.5 bar, checkpoint memory > 128 MiB); runs at load > 6 are marked invalid. **As built (2026-11-17): no baseline file and no drift flag exist.** The benchmarks run only in the final tier; `gate-warm` checks its fixed bars, and `bench-seek-node` is compared by hand with the last record (§2.3). |
| **5.5 Golden fingerprints go stale or get rubber-stamped** | A real simulation bug "fixed" by re-recording the golden | Until a human notices, possibly never | Medium. Re-recording is one command. | High. The golden then protects the bug. | Re-records are reviewed diffs with a sentence saying why (schema.md §8.1). The recorder refuses to write unless `--reason "…"` is given, and puts the reason in the file header. Self-consistency and property tests (T3) still say the behavior is *right*; the golden only says it hasn't *moved*. A spec checks that the golden file was produced by the recorder (byte-identical re-run). |
| **5.6 The daily suite rots** | Gate scripts break (selector drift, a Playwright upgrade) and nobody notices because nothing runs them | Until the end of all phases, which is the worst case of the whole proposal | **High**, if nothing runs it automatically | High. The final review then finds a pile of broken checks at once. | Automate the trigger (§6). Each phase gate requires a green daily run less than 24 h old. `summary.json` records the last-green date per step. The Chromium smoke in regular exercises the same harness code every change, so the shared code can't rot unseen. |
| **5.7 The smoke canary is too thin** | A browser-only break outside the smoke's paths (keyboard order, touch, reduced motion) | Up to a day | Medium | Medium | These walks are all daily. Phase gates for phases that touch those surfaces run the relevant scripts in Chromium. |
| **5.8 Moving files breaks negative controls** | The README NEG table points at old commands; a new step (`format:check`, fixtures `--check`, `run.mjs` exit codes) has no NEG | Until an audit | Medium | Medium. A check that can't fail. | Each new step lands with its NEG recorded in the README in the same change (items 10, 11, 14). `run.mjs` NEG: a step that exits 1 must make the tier exit 1. |
| **5.9 Fake timers mask a real debounce bug** | The draft save fires too early or too late in a real browser | Up to a day | Low | Low–medium | Advance by exactly the debounce, and test both sides of the edge (debounce − 1 ms: not saved; + 1 ms: saved). That is the drop-edge rule (`toad-a-baseline-and-its-draft-share-one-lifecycle.md`). |

**Top three risks:**

1. **The daily suite rots (5.6).** The mitigation depends on your §6 decision.
2. **Goldens get rubber-stamped (5.5).** The mitigation is the `--reason` rule and review.
3. **Virtual time hides real-clock behavior (5.3).** The mitigation is keeping budgets in jsdom and the real-time play in daily.

---

## 6. What runs the daily suite

Plan §5 says "No CI" (OQ11, standing), and nothing runs automatically today.

| Option | What it needs | For | Against |
|---|---|---|---|
| **A. launchd job on your Mac** (`~/Library/LaunchAgents/…fireworks-daily.plist`, for example at 03:00, wrapped in `caffeinate`) | Docker and `fireworks-postgres` running; the machine on (asleep is fine; it wakes); the repo at a known path; logs to `test-results/daily/` | No CI, no credentials, no push. The machine is idle at night, so benchmarks get credible baselines (load ≤ 6). Same hardware as dev. | It runs whatever is checked out, possibly mid-edit. It misses nights the laptop is off. It's only on one machine. |
| **B. GitHub Actions scheduled workflow** | Reverses OQ11 ("No CI"); needs the repo pushed with Actions enabled, a Postgres service container, Chrome and the Playwright browsers on the runner, and possibly secrets | Runs every night regardless of your laptop. A clean checkout. History in the GitHub UI. It is the route to the "deployment pipeline" you mentioned. | Overturns a standing decision. Runner hardware differs, so benchmarks need their own baselines. Swiftshader WebGL on Linux runners is slower. It adds a push-and-credentials surface. |
| **C. Manual runs at phase ends only** | Nothing new | Zero setup | Exactly the rot risk in 5.6. A cross-browser break can hide for a whole phase. |

**Recommendation: A (launchd), with two guards:**

- `run.mjs daily` runs in a separate `git worktree` checked out at `HEAD`, so it tests the last commit, not your working edits.
- Each phase gate checks for a green `summary.json` less than 24 h old for that commit or its parent. If the night was missed, the gate runs the daily first (about an hour).

Move to B when you decide the project needs a pipeline (Yoshi notes the tiers are pipeline-ready: exit codes, no scratchpad paths, recorded seeds). This is your decision.

---

## 7. Migration order and safety rules

**Order.** Each step leaves both tiers green, and the regular tier never gets slower along the way.

1. **Move the gate scripts, mutant runners and bench into the repo** (items 12–13). Nothing changes behavior. Re-run each gate once in Chromium and compare its log with the scratchpad log.
2. **Add `format:check`, fixtures `--check` and `run.mjs`** (items 10, 11, 14), each with its README NEG.
3. **Split the slow spec files with no test changes** (items 1 and 2's split part). Prove nothing was lost: the test count and names are identical before and after (`--listTests` plus the JSON reporter).
4. **Add `provideStepClock` and fake timers** (items 6 and 9). Each file's tests still pass, and each fake-timer change has its edge NEG.
5. **Add the replacements next to the old tests:**
   - `scheduledLedger` and its proof;
   - T2 goldens;
   - T3 property tests;
   - the virtual-time smoke.

   The old tests keep running. Both sets must pass.
6. **Mutant proof**, serial, on an otherwise idle machine. For each old test that's going to move or go, run the mutants it killed (from `tools/mutants/`, for example the Phase 6 timeline-driver set, N1–N5 and M8) against the new tests only. **An old test leaves the regular tier only when its replacement kills every mutant it killed.** A surviving mutant means the old test stays, or the replacement is fixed first.
7. **Move the old long-show tests to `*.daily.spec.ts`.** They aren't deleted: they become the daily long-density coverage.
8. **Measure the regular tier at load ≤ 4** and record it in the README. Only then is the 5-minute target "met".
9. **Turn on the daily trigger** (§6), then hold the first phase gate under the new rules.

**Safety rules:**

- A test is deleted only after its replacement is proven to kill every mutant it killed (Skyler approved deletions on 2026-11-17; before that, nothing was deleted). Long tests move to daily, and only after a replacement has been mutant-proved.
- **Deleted on 2026-11-17** (proof: `tools/mutants/sets/t3-redundancy.mjs`, record `toad-redundant-spec-deletion.md`). For each one, the tests that stay killed every mutant it killed, in its own tier:
  - `timeline-driver.checkpoints.spec.ts`: "are taken every SMALL_CP steps…", "a seek lands within one checkpoint spacing…", "a width change drops them…", "a starBudget change drops them", "checkpoints filled on a shadow sim…", handoff "a twin runs on its own sim…" and "takes only checkpoints before…", inherit "keeps checkpoints before the first changed cue…" and "a checkpoint taken after the old show ended…".
  - `timeline-driver.spec.ts`: the seek block's "seek to k equals…", "a backward seek at the particle cap…", "seek after playing through the loop…", "seek back past the end clears done" and "a budgeted seek arrives in slices…", and the trace digest's "is equal across runs…".
  - `timeline-driver.daily.spec.ts`: "the same show gives the same ledger…", "frame size never matters…", the trace digest's "is equal across runs…" and "the Done-when show … ends within its bound, on the same step twice".
  - **Kept:** "seek clamps and floors its target" (now asserts that `seek` reports arrival, so it kills K1 and K2, which every regular spec let survive), and every named regression and mutant-only killer listed in the record.
- Every new check lands with a recorded negative control.
- A golden is re-recorded only by reviewed change with a stated reason.
- A red daily run blocks the next phase gate until it is fixed or explicitly accepted by you.
- Timings are compared only at the same load (±2) on the same machine.
- Heavy runs stay serial, with at most two agents at once (standing).

---

## 8. Questions for Skyler

| # | Question | Recommendation |
|---|---|---|
| Q1 | **What runs the daily suite?** launchd on your Mac, GitHub Actions (reverses "No CI"), or manual at phase ends? | **launchd** at 03:00 in a separate worktree, with phase gates requiring a green daily less than 24 h old (§6). |
| Q2 | **Should a Chromium browser smoke (about 1 min, needs the API and Postgres) be part of the regular tier?** | **Yes.** It's the only regular check of the real CSP, real WebGL and the production build. Without it, a browser-only break waits a day. |
| Q3 | **Does a red daily run block the next phase gate?** | **Yes**, unless you accept the specific failure in writing (for example, a known WebKit fidelity difference). |
| Q4 | **Do Firefox and WebKit fingerprint mismatches fail the daily run, or are they report-only?** | **Report-only**, matching "cross-browser means it runs". A crash or a page that doesn't load *does* fail it. |
| Q5 | **Pre-commit hook: none, opt-in, or installed by default?** | **Opt-in** (format plus typecheck, about 15 s). |
| Q6 | **Adopt the flake quarantine policy (no automatic retries; quarantined tests run daily; fixed within a phase)?** | **Yes.** |
| Q7 | **Mutant sweeps: daily, or on test replacement, phase gates and the final review only?** | **The latter.** They are serial and slow, and their result only changes when tests or the mutated code change. |
| Q8 | **May the regular tier run the frontend and .NET lanes in parallel** (about 2.5 min instead of 3.5)? It touches "heavy runs serial". | **No, for now.** The serial total fits in 5 min, and parallel lanes inflate each other on a loaded machine. Revisit after the low-load measurement. |

# Toad: end-of-project review, step 4: fix-batch verification and the governor trigger (2026-11-17)

**Brief:** verify Bowser's `WarmUpDelayMs`, Luigi's render-on-change, lean upload, warm-up delay and short-show skip (`luigi-end-review-cpu-fixes.md`), my follow-ups and the redundant-spec deletion; fix `gate-warm.mjs`; measure the trigger set in `yoshi-end-review-cpu-cost.md`. **Commits:** none (not authorized). No product code changed. **Machine:** the 2019 MacBook Pro, headless Chrome 157 on the real GPU (`ANGLE Metal Renderer: Intel(R) UHD Graphics 630`), Node 26.5.0, under `caffeinate -dims`. **Load:** 3.4–8 during the runs, higher than Yoshi's 2.2–4.5. A game (Peglin, 45–83% CPU) and VS Code were running throughout, so every number is a conservative one.

## Verdict

**The governor trigger does not fire.** Realistic-600, played in full in the player at DPR 2, has p95 16.7 ms and a mean main thread of 7.9%; the worst window (the finale) is 30.1% / 16.8 ms. The stress case at DPR 2 is now p95 16.8 ms (it was 33 ms). Every bar is under its 20 ms / 70% line with a wide margin.

## What

### 1. `gate-warm.mjs` (test code, fixed)
- **The defect was real:** at the shipped threshold, done-when-60 reaches `data-warm-up="skipped"` about 1.5 s after load (measured three times). The old `after` mode waited only for `finished`, so it would have sat out its 300 s timeout.
- **`after` and `early` now patch the skip threshold to 0** in the bundle (`` `WARM_UP_SKIP_COLD_RUN_MS`,{factory:()=>1e3} `` becomes `()=>0`), using the same route-patch mechanism as the no-warm-up baseline, which must hit exactly once. The wait accepts `finished` or `skipped` and reports which it reached (`warmUpReached`). The `after` verdict needs `finished` with the patch applied once.
  - **Why patch rather than swap shows:** the 7l.3 bars are defined on done-when-60 and realistic-600, and a cold done-when-60 still passes its own 1039 ms bar (898 ms measured with the patch broken). The bar alone can't tell a warm show from a cold one, so the gate has to force warm-up and then check that it happened.
  - **Negative control:** with the patch string broken, `after` fails in 34 s, not 300 s, with "warm-up reached skipped … (skip patch hits 0), FAIL".
- **New `natural` mode** (and final-tier step `bench-warm-natural`, report-only) runs the shipped skip. It reports the state each show reaches and holds the skip's promise: p95 < 1000 ms whichever state is reached, no missed seeks, and realistic-600 never skipped.
- **`early` and `nowarm-check` had a second, hidden break.** The 1 s warm-up delay made "off at 1 s" true for the unpatched page, so `nowarm-check` FAILED. Worse, the no-warm-up baseline's "stays off" proof passed by itself. Both runs now wait up to 3 s more for warm-up to leave `off`: the baseline must still be `off` after that window, and the early run seeks only once warm-up is `running`. After the fix, `nowarm-check` passes (done-when-60 unpatched reaches `skipped`, realistic-600 `running`).
- The client-config stub now serves `warmUpDelayMs: 1000`, the served shape.
- Docs: a `testing-strategy.md` §2.3 row for `bench-warm-natural`, and the `tools/browser-gates/README.md` row.

| Run (Chromium) | realistic-600 | done-when-60 |
|---|---|---|
| `after` (forced warm), my API | p95 513 ms, finished at 12.4 s, ok | p95 230 ms, finished at 3.4 s, ok |
| `after`, final-tier step | p95 529 ms, ok | p95 265 ms, ok |
| `natural` (shipped skip), my API | finished at 12.2 s, p95 597 ms, ok | **skipped** at 1.6 s, p95 947 ms, ok |
| `natural`, final-tier step | finished at 11.9 s, p95 514 ms, ok | **skipped** at 1.5 s, **p95 995 ms**, ok |
| `early` (7l.5, paired) | 3697 vs baseline 3699 ms, ok | 898 vs 879 ms, ok |
| `nowarm-check` | baseline off for 4 s; unpatched running, ok | baseline off for 4 s; unpatched skipped, ok |

### 2. Regular tier
`node tools/test/run.mjs regular`: **PASS** in 204.8 s (`test-results/regular/2026-11-17T140259`). That was 1,794 web tests in 83 files, plus format, fixtures, typecheck, both builds, `test-dotnet-pg` (67.5 s) and the smoke (75.6 s). Load 3.2 at start, 8.3 at end.

### 3. Render-on-change in Chromium (`scratchpad/toad-er/render-checks.mjs`)
The check counts WebGL draw calls (by wrapping `drawElements` and `drawArrays`) to see when the stage presents. It snapshots the canvas with every DOM overlay hidden (the HUD text otherwise reads as residue) and decodes it in the page. **15/15 pass:**
- **Idle, then fire:** the stage goes quiet about 2 s after load (0 draws per 500 ms), then a Space burst draws within 300 ms.
- **Trails fade fully:** at persistence 0.92 the stage went quiet 7.1 s after the burst, and the last presented frame equals the empty sky (maxDiff 0, 0 pixels over 2). The rgba16float trail converges fully, with no 8-bit ghosting.
- **Resize while quiet** redraws at the new size and settles (maxDiff 0); a burst after the resize draws.
- **Reduce flashing toggle:** in the designer while quiet, 0 draws, then 30 after the toggle. In the builder, paused with particles, 0 draws, then 45, with 19.7k pixels changed.
- **Builder seeks:** a seek from quiet at 0 to 20 s draws; the paused sky then stops drawing but keeps its picture; a seek back to 0 redraws the empty sky exactly.
- **Particles above the high-water mark (the upload fix), deterministic under `page.clock`:** under virtual time a seek lands in one frame (skill rule 7), so there are no intermediate renders. In done-when-60, 3.5 s has 1121 particles (Pixi sizes its buffer), 9.5 s has 1191 (it regrows to 1681 and writes 1191 static slots), and 17.5 s has 1640, inside the slack. The oracle is the same 17.5 s frame after a visit to 27 s (10,018 particles; Pixi rewrites every slot). Real build: maxDiff 1, 0 pixels over 2. **NEG, dropping the high-water `update()` (bundle route-patch, one hit): maxDiff 251 on 1,636 pixels, killed** in all 3 runs, byte-identical each time.
  - A live-designer version (lit pixels while the count climbs, timed by HUD polls) flaked both ways and was dropped. Pixi's own ×1.5 regrowth re-uploads every slot at each regrowth, so the stale window is only the slack, and wall-clock timing can't hit it reliably.
- **Bundle NEGs for the browser checks themselves:**
  - Settle 90 → 5 frames: killed by the trail check (residue up to 17 on 3,908 pixels).
  - Dropping the seek dirty flag (Luigi's R4): **survives in the browser** (patch applied once). It is visually equivalent: a seek that changes anything visible also changes the particle count, or `simTime` with particles alive. Only Luigi's render-count spec sees it. That is not a defect.
- **Side by side with the prototype** (`scratchpad/toad-er/side-by-side.png`): the default shell, Manual, one Space, frames at 1.8, 2.4, 3.2 and 4.4 s. Both show seed 20269031. The rising comet, the red burst's shape, size and colours, the skyline and the empty sky at 4.4 s match.

### 4. At-risk gates (`run.mjs final --only …`, Chromium, `test-results/final/2026-11-17T143142`)
- `unit-web-daily` ok (112 s; T2 realistic-600 goldens, T3 property tests, 40k sustained load).
- `fingerprints-run-chromium` ok and `fingerprints-match-chromium` ok: every case matches its golden (minimal, seed-extremes, unreferenced-shell, realistic-600). `fingerprints-neg-mismatch` was caught.
- `bench-warm-after` and `bench-warm-natural` ok (table above).
- `bench-seek-node`: done-when-60 cold p95 711 ms, warm 148 ms (1100 ms to the end). Realistic-600 cold 2901 ms, warm 308 ms (6743 ms to the end; peak 20,331). These are in line with `toad-final-tier-run.md`.
- csp, keyboard, touch, follow and its NEG, reduced-motion-neg, player-vt and its frozen NEG, roundtrip-chromium (the real-time 66 s play) and roundtrip-neg-ended: all ok.
- **`reduced-motion-chromium` FAILED once:** "7h.1 /show: Reduce flashing switch is on under reduce", read as `checked:false` at load 10.9. It passed **4 of 4** in isolation, the last at load 9.8. The gate reads the switch the moment it exists (`until` returns the first non-null). The switch is DOM state, which the render changes don't touch. I class it as a flake (see Findings).

### 5. CPU, before (Yoshi) and after
Method: `.squad/skills/stage-cpu-cost/SKILL.md`, with Yoshi's `cpu/stage-cpu.mjs`, `stage-prof.mjs` and `builder-cpu.mjs` unmodified, against the production build on 5180 (its `wwwroot` rebuilt by the regular tier at 14:03). The player run used my own Testing API on the same `wwwroot`, because it needs a saved realistic-600. One run per cell; ±20%.

| Cell | DPR | Before: main / renderer / GPU, p95 | After: main / renderer / GPU, p95 |
|---|---|---|---|
| Idle Manual (Yoshi's cell; the dense load burst is still in the window, avg ≈1.77k) | 2 | 7.4 / 12.3 / 13.0%, 16.8 | **5.6 / 8.6 / 5.6%**, 16.7 |
| same | 1 | 7.1 / 11.5 / 11.9% | 5.4 / 8.2 / 5.3% |
| **True idle** (20 s ramp, sky empty for the whole window) | 2 | — (it rendered every frame before; the GPU process was ≈13%) | **1.6 / 4.1 / 1.3%** |
| same | 1 | — | 1.7 / 4.2 / 1.3% |
| Out-of-box Peony loop (particles always alive) | 2 | 3.9 / 9.0 / 13% | 3.6 / 8.3 / 11.9% |
| **Stress at the 40k cap** | 2 | **99.9 / 104 / 15%, p95 33.3 ms** (555 frames) | **95.5 / 101 / 16%, p95 16.8 ms** (597); repeat 94.8%, 16.8 ms (591) |
| Stress | 1 | 80 / 83 / 14%, 16.7 | 70.6 / 74.5 / 11.9%, 16.8 |
| Builder realistic-600, paused, warming | 2 | 84 / 91 / 9.5% | 82.5 / 85.2 / 1.5% |
| Builder, same, warmed | 2 | 2.9 / 7.2 / 11.7% | **1.7 / 3.4 / 1.4%** (finished at 12.6 s) |
| **Player, realistic-600 playing, whole show** (61 × 10 s windows) | 2 | never measured | **p95 16.7 ms overall; main mean 7.9%, worst 30.1% (finale, 9:42, 4 frames over 25 ms); worst-window p95 16.8 ms** |

**Upload at the cap (DPR 2, 5 s CDP profile):**
- Before: the five attribute passes were **33.3%** of self time (aUV 6.8 and aRotation 4.3 among them).
- After: **15.4%** (aVertex 7.5, aPosition 4.4, aColor 3.5), and aUV and aRotation are gone. `bufferSubData` fell from 2.3 to 1.6%.
- That is about 2.7 ms per frame of profiled time (0.154 × 5208 ms ÷ about 300 frames).
- The rest of the profile: step 31.3%, `particleVisual` 22.0%, sync 13.8%.

## Findings
1. **Option B's trigger is borderline.** Yoshi set the fused upload's trigger at "upload passes exceed 15% of main-thread self time at the cap". It measures **15.4% of all samples, or 16.4% of non-idle self time**, from one profile (±20%), at higher load than Yoshi's. By the letter of the record it fires. By its spirit (frame p95 is now 16.8 ms at the cap) it buys nothing visible. That is Skyler's call; Yoshi owns the option and Luigi would build it. My recommendation: don't build it unless a second, quiet-machine profile also shows over 15%.
2. **The short-show skip leaves done-when-60's cold seeks right at the 1 s trigger.** Natural-mode browser p95 was 947 and 995 ms (and 898 ms with the patch broken), against the 1,000 ms trigger (`yoshi-end-review-cpu-cost.md` Q3 C and the Phase 6/7 seek trigger), at load 3.5–9.
   - The skip predicts the cold *run* at ≤ 1 s, but a seek p95 adds frame and DOM latency on top of the run, so a show predicted just under 1 s seeks just under or over 1 s.
   - Under heavier load or on a slower device, a skipped show can cross the trigger, which is exactly what warm-up exists to prevent.
   - Suggested: Luigi (implementation) and Yoshi (design), with Skyler's ruling. Lower `WARM_UP_SKIP_COLD_RUN_MS` to about 700 ms, or keep 1 s and accept. Not a regression of any written bar: `bench-warm-natural` passes, at 5 ms of margin.
3. **`reduced-motion-chromium` flaked once** (it passed 4/4 in isolation). The likely cause is the gate reading `#reduce-flashing` on first sight under load 10.9. The fix is test-side, so it's mine to make: wait until the switch is checked or the stage is running before reading it. I haven't made it yet, because I couldn't reproduce the failure to prove the wait. A product transient (the builder briefly rendering the switch unchecked under reduce) isn't ruled out, but the builder opens paused under reduce, so nothing would flash.
4. **Luigi's R4 (the seek dirty flag) is visually equivalent in the browser.** Not a defect. The flag is defensive, and only the render-count spec kills it.

## Boundary
- **Warm-up benches must force warm-up and check that it happened.** A bar a cold show also passes can't certify a warmed show. Any new bench on a short show patches `WARM_UP_SKIP_COLD_RUN_MS` and asserts `finished`.
- **After a timing change to warm-up (delay, skip), re-check every "off/on at N s" assertion.** The delay made the baseline-validity check pass by itself.
- **A browser check of the static upload needs one-frame seeks** (virtual time), and must sit in Pixi's ×1.5 regrowth slack. At a regrowth, Pixi itself rewrites every slot.
- The render-checks script lives in my scratchpad, not the repo. Promoting the virtual-time upload check into the regular smoke is a proposal for Skyler: it costs about 10 s, but its NEG depends on minified strings, which drift with every build.

## Addendum (2026-11-17, last verification batch): skip patch at 700 ms, the reduced-motion wait, regular tier

**Brief:** fix `gate-warm.mjs` for Luigi's `WARM_UP_SKIP_COLD_RUN_MS` 700 (see the addendum to `luigi-end-review-cpu-fixes.md`), fix finding 3 (`reduced-motion-chromium`), then run the regular tier. Test code only; no commits. Node 26.5.0, under `caffeinate -dims`. Load 3.4–8.6 without my burner (VS Code and Peglin were running again).

### What
1. **`gate-warm.mjs` `SKIP_ON` is now a regex**, `` /`WARM_UP_SKIP_COLD_RUN_MS`,\{factory:\(\)=>(\d[\d.e+]*)\}/g ``, so it matches any numeric literal (`700`, `1e3`). Each match is replaced with `()=>0`. The exactly-one-hit check is unchanged (`skipPatched.skip === 1` in `after` and `early`). The literal it patched is now recorded (`skipFrom`) and printed (`from ()=>700`). A regex self-test matched `700`, `1e3` and `0`, and didn't match `()=>a`. The header comment and line-53 comment now describe 700. The `wwwroot` from 14:03 still had `()=>1e3`, so I rebuilt it (`npm run build`) before the runs.

   | Mode (my Testing API, Chromium) | realistic-600 | done-when-60 |
   |---|---|---|
   | `after` | finished at 11.1 s, p95 481 ms, ok (patch 1 hit, from 700) | finished at 3.5 s, p95 263 ms, ok (1 hit, from 700) |
   | `early` | 4164 vs baseline 3814 ms, ok (1 hit) | 896 vs 929 ms, ok (1 hit) |
   | `natural` | finished at 11.1 s, p95 497 ms, ok | **still `skipped`** at 1.5 s, cold p95 912 ms, ok |

   All three PASS. done-when-60 has a cold p95 of 912 ms (natural, skipped) and a warm p95 of 263 ms (`after`).

2. **Why done-when-60 is still skipped at 700 (scratch probe `scratchpad/toad-er/probe-pred.mjs`).** A route patch exposes the probe's prediction (1 hit). done-when-60 is predicted at **237, 253 and 253 ms** (probe slice of 399–436 steps out of 8195). realistic-600 is predicted at **1433–1822 ms** against a real cold run to the end of about 6.7 s (`bench-seek-node`). The probe under-predicts by about 4 to 4.5 times: the first slice covers the sparse opening, as its own comment warns. Measured, done-when-60's real cold run is about 1.1 s, but its prediction sits far under any threshold above about 250 ms. Lowering the threshold to 700 changes nothing for this show. See Findings.

3. **`gate-reduced-motion.mjs` 7h.1 now reads a settled switch** (`settledSwitch`). It waits until the stage is `running` and the switch has held one state for 450 ms, or until the switch has held one state for 1.5 s; the timeout is 20 s, as before. It also returns the first sight. When the first sight differs from the settled value, the gate prints a `note` line and adds it to the check's detail. That note isn't counted, because under reduce the builder and designer open paused or in Manual, so nothing flashes during the window.
   - **Unloaded:** 5/5 PASS (14/14 each), load 3.4–8.6, no transient seen.
   - **Under a CPU burner** (`scratchpad/toad-er/burn.mjs`, 14 spinning threads, self-terminating, killed afterwards; load 13.6 to 50): 3/3 PASS. **Run 2 reproduced the old failure's cause:** on `/`, the first sight was `{"checked":false,"id":"reduce-flashing"}`, and it flipped once to `checked:true` before settling. The old first-sight read would have FAILED that check; the new wait passed it. (The original flake was on `/show`; this repro is on `/`, the same `reduce-flashing` switch in the designer.)
   - **NEG under load:** 12/12 reduce checks failed as they should, 0 baselines failed, exit 0. The wait doesn't mask the control.

4. **Regular tier:** `node tools/test/run.mjs regular` **PASS** in **204.6 s** wall (`test-results/regular/2026-11-17T155514`). It ran 1,794 web tests in 83 files, plus format, fixtures, typecheck, both builds, `test-dotnet-pg` (59.9 s) and the smoke (78.3 s). The load averages read about 37 at the start: the 1-minute average was still decaying after the burner, which I had killed before the run. They read 12.1 at the end. The 4200, 5180 and 5190 servers kept the same pids throughout.

### Findings
- **Luigi's 700 threshold doesn't achieve its stated aim** (product, owner **Luigi**; design **Yoshi**; Skyler rules). The record says that "700 leaves about 30% margin", but the skip probe under-predicts by about 4 times. done-when-60 is predicted at about 250 ms, so it is still skipped and still seeks cold at p95 912 ms (88 ms under the 1 s bar, not 30%). Options for the owner: scale the probe (for example, by measured density, or by probing a slice from the middle as well as the opening), compare against a threshold calibrated to the probe (about 200 ms would warm done-when-60), or accept. No written bar fails: `natural` passes.
- **The designer's Reduce flashing switch renders unchecked for a moment under reduce when the machine is loaded** (product, owner **Luigi**, low). Seen once in 3 loaded runs, at load about 43, on `/`. The stores compute `reduceFlashing` synchronously from `matchMedia`, so the window probably comes from the `QualityFields` input default (`input(false)`) being visible for a render before the parent binding lands. I haven't proven that. Nothing flashes, because the designer opens in Manual under reduce. Luigi should check whether the stage's own `reduceFlashing` input has the same first-frame default.
- The gate's flake (finding 3 above) is fixed on the test side.

### Boundary
- A gate that patches a compiled constant matches the literal with a regex, records what it replaced, and keeps an exact hit count.
- A gate reads DOM state only once it has settled, and logs a first sight that differed, so a product transient stays visible instead of being hidden by the wait.

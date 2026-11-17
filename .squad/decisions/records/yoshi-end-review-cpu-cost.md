# Yoshi: end-of-project CPU-cost review (2026-11-17)

> Superseded in part by `luigi-end-review-cpu-fixes.md` on 2026-11-17: option C's skip threshold is 200 ms (Skyler's verification rulings; 1 s, then 700 ms). Option B and the render and upload rules stand.

**Status:** proposed. It is analysis and design only; nothing in product code changed. Skyler rules on the items in "Rulings needed" below. Fixes then go to their owners.

**Inputs:**
- Plan: the Phase 7 Q7.2 answer ("automatic quality moves to the end-of-project review framed around CPU cost; manual control and `starBudget` 1 for shows stay; the DPR cap ships") and the status line on line 4.
- Records: `boo-phase7-security-requirements.md` (the polyfill cost was "not measured … a line item" for this review), `luigi-phase7-client-hardening.md` and `mario-phase7-gate.md` (warm-up numbers; the 7l.5 margin is "thin") and `toad-final-tier-run.md`.
- Code: `app/shared/fireworks-stage/fireworks-stage.ts` (`timelineFrame`, `runSlice`, `warmUpSlice`, `WARM_UP_*_MS`), `core/client-config.ts` and appsettings `ClientPlayback`, `core/browser.ts` (`canvasResolution`), `engine/render/pixi-renderer.ts`, `engine/render/trail-buffer.ts`, `engine/loop/engine-loop.ts`, `engine/loop/timeline-driver.ts` (the run key), and the pinned Pixi 8.23.0 sources under `node_modules/pixi.js/lib/unsafe-eval/` and `scene/particle-container/shared/`.
- The CSP is in `Services/ResponseHeaders.cs:41`: `script-src 'self'` and `worker-src 'none'`.

## Method (all runs serial, one agent, nothing else heavy running)

- **Machine:** 2019 MacBook Pro with an i7-9750H (12 threads), Intel UHD 630 and Radeon 555X, Retina 2880×1800. Load average 2.2–4.5 during the runs. Node 26.5.0.
- **Browser:** Playwright with `channel: 'chrome'`, headless Chrome 157. **It uses the real GPU** (`ANGLE Metal Renderer: Intel(R) UHD Graphics 630`), not SwiftShader.
- **Build and viewport:** the production build served by the 5180 API, whose `wwwroot` is newer than every source file. Viewport 1440×900 CSS px, `deviceScaleFactor` 1, 1.5 or 2, with `bypassCSP` (measurement only).
- **Per cell:** a 6 s ramp, then a 10 s window, measured three ways:
  - main-thread busy % from CDP `Performance.getMetrics` (Δ`TaskDuration` ÷ wall);
  - per-process CPU % from `SystemInfo.getProcessInfo` (renderer and GPU process);
  - the rAF interval median and p95.
- **One run per cell, ±20% (load).** Scripts in my scratchpad: `cpu/stage-cpu.mjs`, `cpu/stage-prof.mjs`, `cpu/builder-cpu.mjs`, `cpu/pbench.mjs` and `cpu/fused.mjs`. The method is written up as skill `stage-cpu-cost`.
- **Stress input:** a designer draft with one 400-star glitter peony, and Space pressed 10 times a second. This holds the 40k cap (avg 39,960). It is a synthetic worst case. Realistic shows peak at 10k (done-when-60) and 20k (realistic-600) particles (`66-bench-seek-node.log`).

### What one stage costs today

| Case (designer unless noted) | DPR | Particles (avg) | Main thread busy | Renderer process | GPU process | Frame p95 |
|---|---|---|---|---|---|---|
| Stress at the cap | 2 | 39,960 | **99.9%** | 104% | 15% | **33 ms** (555 of 600 frames) |
| Stress at the cap | 1.5 | 39,950 | 83% | 88% | 14% | 16.8 ms |
| Stress at the cap | 1 | 39,999 | 80% | 83% | 14% | 16.7 ms |
| Stress, `starBudget` 0.5 / 0.25 | 2 | 39,9xx | 99.9% | 104% | 15% | 33 ms (still at the cap) |
| Out-of-box (Peony, Preview loop) | 2 | 74 | 3.9% | 9.0% | 13% | 16.7 ms |
| Manual, sky empty | 2 / 1 | ≈0 after the load burst | 7.4 / 7.1% | 12 / 11.5% | 13 / 12% | 16.8 ms |
| **Builder** `/show`, realistic-600, paused, **warming** | 2 | — | **84%** | 91% | 9.5% | 16.7 ms |
| Builder, same, **warmed** (finished at 12.8 s) | 2 | — | 2.9% | 7.2% | 11.7% | 16.7 ms |

**Profile at the cap** (DPR 2, 5 s CDP sampling profile, self time):

| Area | Share |
|---|---|
| `FireworksSim.step` | 29.5% |
| `particleVisual` (`O` in the chunk) | 16.1% |
| `PixiRenderer.sync` | 10.4% |
| Pixi upload passes from the polyfill: `aVertex` 9.7, `aPosition` 9.2, **`aUV` 6.8, `aRotation` 4.3**, `aColor` 3.3 | **33.3%** |
| `bufferSubData` | 2.3% |
| Every uniform, UBO or shader-sync function, GC, `drawElements` | each < 0.2% |

**What the table says:**
- At the cap, **render-side JavaScript (sync, visual and upload) is about 60% of the main thread, and the simulation about 31%.**
- An idle stage still costs about **20–25% of one core** (renderer plus GPU process) at 60 fps, because it renders every frame whether or not anything changed.
- `starBudget` does nothing once the input saturates the cap. Below the cap it scales particle count, and so render cost, linearly.

## Q1. Automatic quality

### Findings: the levers that exist today
- **DPR cap:** `canvasResolution` gives `min(dpr, coarse ? 1.5 : 2)`. It is fixed at renderer creation (`fireworks-stage.ts:430` passes it to the factory). The trail `RenderTexture` takes `renderer.resolution` at construction (`trail-buffer.ts:54`), so changing resolution at runtime means resizing the renderer and recreating or resizing the trail. A rebuild through the factory already exists for context restore.
- **Star budget:** manual, designer only (0.25–1, step 0.05). Shows always use 1 (builder store l.170, player). It is a **sim input** (`simulation.ts:273`) and part of the TimelineDriver **run key** (`timeline-driver.ts:94`).
- **Particle capacity:** a fixed 40k (`CAP`). Also part of the run key.
- **Glow and filters:** **none exist.** The glow is a 64 px canvas texture (`glow-texture.ts`), with no Pixi filters. There is nothing to lower.
- **Motion blur (`persistence`):** a manual visual setting. The trail costs one full-screen fade and one composite per frame at any value.
- **Configurable knobs:** only `ClientPlayback` (seek budget, catching-up delay, checkpoint interval and memory). There is no render knob and no governor. `engine-loop.ts` keeps `fpsAvg`, but only the HUD reads it.

### Cost and benefit of each lever

| Lever | CPU benefit (measured) | Visual cost | Determinism |
|---|---|---|---|
| **Render only when the frame changes** (new) | Idle: removes most of the 20–25% of a core. Builder warmed and paused: 2.9% main plus about 12% GPU process, almost all of it presenting identical frames. | None, if the trail has converged: at the maximum persistence 0.92 the fade is below 1/1024 after ⌈ln(1/1024)/ln 0.92⌉ = 83 frames. | None. The sim, loop and driver still run every frame. |
| **Lean particle upload** (Q2) | About 11% of the main thread at the cap (`aUV` plus `aRotation`); bench 2.5 → 1.27 ms per frame at 40k. | None | None |
| **Resolution 2 → 1** | At the cap: main thread 99.9 → 80%, frame p95 33 → 16.7 ms. The cap at DPR 2 is GPU fill and back-pressure that lands on the main thread. Idle: about 1 point. | Softer on Retina | None (render only) |
| **Render at half rate** (sim stays at 120 Hz) | Halves the ≈60% render-side share at the cap (estimated, not measured) | 30 fps motion. The trail fade must be compensated (`α = 1 − persistence²` per rendered frame). | None (render only) |
| **Star budget** | Linear below the cap; zero at the cap | Fewer stars | **A sim input.** For a show it changes the run key, so `seek` drops every checkpoint and re-runs from 0, at the moment CPU is already short: about 6.4 s CPU at the end of realistic-600 (`seekToEnd.totalMs` 6370). It also diverges from the saved and shared show. In the designer it changes what Replay last produces. |
| **Capacity** | Only at the cap | Drops stars | **A sim input and part of the run key**, with the same problems as star budget. |

### Recommended policy: a render-only quality governor

1. **The governor never touches simulation inputs.** It controls resolution and render cadence only. `sim.starBudget`, capacity, the step rate (120 Hz, `MAX_STEPS_PER_FRAME`), the driver and the run key are out of its reach. So the 2a goldens, the T2 show fingerprints, run keys and checkpoints, and the standing rule "`starBudget` 1 for shows" are untouched **by construction**. Manual Star budget stays as it is. I don't argue for an automatic star budget: its only benefit is below the cap, where the render-only levers already cover it, and for shows it costs a full re-run.
2. **Always on, not a quality level:** render only when something changed. Skip `stage.render` and Pixi's present when no step ran this frame, no seek or warm-up handoff moved the visible sim, nothing was resized, restored or changed in settings (persistence, reduce flashing), and at least **K = 90** frames have passed since the last change (trail convergence at persistence 0.92, with margin). `frame()`, driver timers (Auto show, Loop), the frame hook and stats keep running. This needs Pixi's auto-render off (`app.ticker` drives `onFrame`; the renderer calls `app.render()` only when dirty).
3. **Tiers** (the visible stage only; the timeline canvases keep their own rule):
   - T0 Full: `canvasResolution` as today, rendering every frame.
   - T1 Light: resolution 1.
   - T2 Lighter: resolution 1, and render every second frame with the fade compensated.
4. **Signal:** render-side work per frame `R` = wall time of `stage.render` plus the playback steps in `loop.frame`. It **excludes** `runSlice` (seek) and `warmUpSlice`, which spend their budget by design; counting them would trip the governor on every scrub. Use an EMA with α = 1/30 (about 0.5 s). The second signal is the share of rAF intervals over 25 ms in the last 2 s.
5. **Thresholds and hysteresis:**
   - **Down one tier** when `R_ema > 8 ms` **or** dropped frames exceed 10%, sustained for **2 s**.
   - **Up one tier** when `R_ema < 3 ms` and dropped frames are 0%, sustained for **10 s**, and at least **20 s** after the last change.
   - **Anti-flap:** after 3 changes within 60 s, the tier stays at the lower of the two for the rest of the page's life.
   - **No change while** a seek is pending, `data-warm-up` is running, the stage is `lost` or `failed`, or the tab is hidden (rAF stops anyway).
   - At the measured numbers this down-steps the stress case at DPR 2 (where `R` ≈ 60% of 33 ms) and never the out-of-box designer.
6. **User override:** a device-wide preference "Rendering: Auto (default) / Full / Light", like Motion blur and Reduce flashing (`localStorage` key `fireworks.renderQuality.v1`; never in a creation document; schema.md §"never persisted" gains a line). Full pins T0 and Light pins T2. Rosalina owns copy and placement. A tier change shows no notice; the HUD may show the tier.
7. **Surfaces:** the designer, player and builder stages. They are render-only, so shows are safe.
8. **Where it lives:**
   - a pure `QualityGovernor` class (inputs: samples and override; output: tier) in `engine/render/quality-governor.ts`, with **no** `pixi.js` import and no `matchMedia` or `localStorage`, so it stays inside my 2a boundary rules;
   - the host feeds it;
   - `StageRenderer` gains `setResolution(r)` and `renderEvery(n)`, or one `setQuality(tier)`.

**Recommended staging:**
- Build items 1 and 2 (render-on-change) and the lean upload (Q2) **now**. They are free wins with no visual change.
- Build the tiers and the governor (items 3 to 8) **only if** Toad measures, after those land, either of these on this machine at DPR 2:
  - realistic-600 playing in the player at frame p95 > 20 ms or main thread > 70%;
  - the stress case still at frame p95 > 20 ms.

  The realistic-600 playback number is **not measured** yet. Today's worst-case evidence is the synthetic stress at the cap.

**Owners:**
- Luigi: render-on-change, lean upload, and the governor plus the renderer API if triggered.
- Rosalina: override copy and placement. She also checks T2 against photosensitivity: half-rate rendering keeps a 7 Hz strobe toggling at about 7 Hz, but each on-time lasts longer.
- Toad: tests and the trigger measurement.

**Test impact:**
- No golden or fingerprint changes. Add a stage spec that forces tier flips mid-show and asserts that `showFingerprint` equals the golden and `sim.starBudget` is unchanged. A mutant that writes `starBudget` from the governor must die.
- `QualityGovernor` unit specs cover thresholds, dwell, anti-flap, exclusions and the override, with exact-swap mutants at the four thresholds.
- The fake renderer counts render calls. Render-on-change specs cover the dirty sources: step, seek landing, warm-up handoff, resize, context restore, persistence and reduce-flashing changes, and K-frame convergence. Their negative control renders nothing after a step.
- `player-vt` and `gate-follow` still pass, because the frame hook still runs every frame.
- The smoke's "canvas draws" element screenshot stays.

## Q2. The `pixi.js/unsafe-eval` polyfill

### Findings
- `unsafe-eval/init.mjs` replaces five generators: uniform-group sync, UBO sync (STD40 and WGSL), shader sync, and `ParticleBuffer.generateParticleUpdate`. It also stubs the two probe checks.
- **Only the particle upload matters.** Uniform, UBO and shader sync run once per draw or bind, and we issue about 4 draws per frame (fade, particles, composite, skyline). In the profile they are each < 0.2%. I measured this rather than assuming it.
- **The particle path:** Pixi's generated function is one fused loop per particle. The polyfill makes **one pass per attribute**, so 5 passes over 40k objects and a reload of `ps[i]` and `texture` per pass.
- **We make it worse:**
  - `pixi-renderer.ts:80` marks all five properties dynamic, including `uvs` and `rotation`, which never change (one texture, no rotation).
  - `sync` calls `pc.update()` every frame, which sets `_childrenDirty` and so re-uploads the static buffer too.

### Measurements: Node 26.5, the pinned Pixi 8.23.0 functions, 300 frames each, two repeats, median ms per frame

| Configuration | 5k | 20k | 40k |
|---|---|---|---|
| Today (5 dynamic), generated `new Function` | 0.15–0.16 | 0.61–0.64 | 1.29–1.32 |
| **Today (5 dynamic), polyfill** | 0.18–0.19 | 0.76–0.78 | **2.36–2.59** |
| Lean (`uvs`, `rotation` static), generated | 0.10–0.12 | 0.42 | 0.89–0.90 |
| **Lean, polyfill** | 0.10 | 0.42 | **1.27–1.28** |
| Lean, hand-fused CSP-safe loop | 0.10 | 0.36 | 0.80 |

- **The polyfill's cost:** about +20% at ≤ 20k particles (≤ 0.15 ms per frame, negligible), and **about 2× at the 40k cap (+1.1–1.3 ms per frame in Node)**.
- In the browser profile at the cap the five passes are 33% of the main thread.
- **Lean properties with the polyfill (1.27 ms) cost the same as the generated path does today (1.3 ms).** The fix that removes the polyfill's cost doesn't need eval.

### Options
- **A (recommended): keep the polyfill and strict CSP, and make the upload lean.**
  - Set `dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false }`. This is a public API.
  - Call `pc.update()` only when `P.n` grows past the static high-water mark. `ParticleBuffer.update` forces the static upload on growth past its `_size` anyway, but slots between the last high-water mark and `_size` need the explicit `update()`.
  - Owner: Luigi. No CSP or Boo change.
- **B: also add a fused update.** Override `ParticleBuffer.prototype.generateParticleUpdate` the same way the polyfill does, for our exact property key, and fall back to the polyfill for any other key. A further −0.47 ms per frame at 40k. It relies on an `@internal` Pixi API (pinned 8.23.0, guarded by a structure spec). **Not now.** Trigger: build it if, after A, the upload passes exceed 15% of main-thread self time at the cap in the stage profile.
- **C: allow `'unsafe-eval'`.** Saves about 0.4 ms per frame at 40k beyond A. Rejected: it contradicts the standing CSP decision ("scripts strict, no `unsafe-eval`", Boo P7) for a saving that A already captures.
- **Not viable:**
  - `'trusted-types-eval'`: Chromium only, and it needs Pixi to pass a `TrustedScript` to `new Function`, which it doesn't.
  - Hash-allowed eval: CSP has no such source.
  - The WebGPU renderer: it uses the same `ParticleBuffer` and the same polyfill.
  - Moving the sim to a worker (plan §6): it would need `worker-src 'self'` and doesn't touch the upload.

**Test impact for A:**
- `engine-boundary.spec.ts`: the polyfill-first assertion is unchanged.
- A new structure assertion pins `rotation: false, uvs: false`.
- A browser check that particles still draw after the count grows (screenshot before and after a burst) catches a stale static buffer. Toad, in the Chromium smoke. Its negative control is to drop the high-water `update()`.
- `gate-csp` reruns unchanged.

## Q3. Warm-up

### Findings
- Warm-up runs on the **builder only** (`show-builder-page.html:536`; the player passes no `warmUp`). It runs after the foreground seek, with the frame's leftover budget, capped at 12 ms idle and 6 ms while playing.
- It restarts on every new driver (each edit), resuming from the inherited checkpoint before the edit point.
- **What it costs:** warming spends the same total steps as one seek to the end:
  - about **1.1 s of CPU for done-when-60 and 6.4 s for realistic-600** (`seekToEnd.totalMs`);
  - spread over 2.3 s and 10.9–12.8 s of wall time;
  - measured in the browser at **84% main thread (91% of the renderer process)** while it runs, then 2.9% once finished.
  - The caps set only the *rate*, not the total. Lowering 12 ms to 8 ms spends the same CPU over about 1.5× the time.
- **What it buys:** cold p95 falls from 0.70 to 0.23 s (done-when-60) and from 2.85 to 0.50 s (realistic-600), with 0 missed seeks (`65-` and `66-` logs). **The early-scrub benefit is small:** realistic early p95 was 3,608 ms against a 3,698 ms baseline at the Phase 7 gate.
- **Where it is wasted:** during continuous editing, every edit restarts warm-up from the edit point. A session of edits near the start of a 600 s show keeps the CPU at about 84% for as long as editing continues, warming checkpoints the next edit throws away. A short show whose cold p95 is already under the 1 s trigger (done-when-60, 0.70 s) still spends a second of CPU to make it 0.23 s.

### Options

| Option | CPU effect | Seek effect |
|---|---|---|
| A. Keep as is | — | — |
| **B. Debounce: start or restart warm-up only after 1,000 ms with no edit and no foreground seek** | Removes warm-up during edit bursts (the waste above). After load it delays the same total by 1 s. | Seeks during an edit burst are cold, but they nearly were already, because the restart had just begun. Seeks after a 1 s pause are unchanged. |
| C. Skip warm-up when the predicted cold run is ≤ 1 s: the measured ms per step of the first foreground steps × `endBoundStep` ≤ 1,000 ms *(Superseded in part by `luigi-end-review-cpu-fixes.md` on 2026-11-17: the threshold is 200 ms.)* | Saves about 1 s of CPU per short-show load or edit | Short-show cold p95 stays under the 1 s trigger (0.70 s measured) |
| D. Lower the caps (12 → 8 idle, 6 → 4 playing) | Same total CPU; a lower peak rate and longer warming | Seeks during warming stay cold for longer |
| E. Halve the checkpoint interval (10 → 5 s) | Small (more snapshots) | Warm p95 about 311 → 150 ms. Not needed: already under 0.5 s. |

**Recommendation:**
- **B**, with the delay served as an optional `ClientPlayback.WarmUpDelayMs` (0–5000, default 1000; Bowser on the server and the README, Luigi on the client clamp and the stage). This follows the pattern of the other knobs, and an older server that lacks the field takes the default.
- **Keep the caps (12 ms and 6 ms) and the 10 s interval.** They control smoothness, not total spend, and Luigi's 17 ms paused p95 shows 12 ms is the right ceiling.
- **C is optional** (Skyler's call). It saves CPU only on short shows and adds a prediction path.

**Test impact for B:**
- Stage specs on the fake clock (`testing/stage-clock.ts`): no warm-up slice within `WarmUpDelayMs` of an edit or seek, and one after it. Exact-swap mutants at the delay compare and at the reset-on-edit.
- `toad-phase6-client-config-contract-parity` gains the field (C# record, TS interface, `PLAYBACK_LIMITS`, appsettings and the README).
- `gate-warm` waits on `data-warm-up="finished"` and so absorbs the 1 s delay. Its bars are unchanged.
- The 7l.5 early-seek baseline comparison still applies.

## Rulings needed (Skyler)

1. **Automatic quality:**
   - (a) Build render-on-change and the lean upload now, and the render-only governor only if the stated trigger fires after them **(recommended)**.
   - (b) Build the governor now as well.
   - (c) No automatic quality at all; manual Star budget stays the only control.

   In every option, the governor never changes star budget or capacity.
2. **If a governor is built:** expose the "Rendering: Auto / Full / Light" device preference (recommended), or Auto with no override.
3. **Polyfill:** keep `pixi.js/unsafe-eval` with strict CSP, and take Option A (lean upload). Recommended. The fused patch (B) waits for its trigger, and `'unsafe-eval'` stays forbidden.
4. **Warm-up:**
   - Adopt the 1 s debounce as `ClientPlayback.WarmUpDelayMs` (recommended), keeping the 12 ms and 6 ms caps and the 10 s interval.
   - Separately: also skip warm-up for shows whose predicted cold run is ≤ 1 s, yes or no.

## Boundary

- **Render quality is not a creation setting.** It is never in a ShellDocument or ShowDocument and never served by the API, like `persistence` and mode.
- **No automatic mechanism may write a simulation input** (`starBudget`, capacity, step rate, sky). Any such proposal must show the run-key and fingerprint impact first.
- **This record measured headless Chrome on one machine.** Firefox and Safari numbers aren't claimed here.

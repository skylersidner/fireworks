# Luigi: end-review CPU fixes, client side (2026-11-17)

**Status:** built, specced, negative-controlled in jsdom. Not yet measured in a browser (that is the gate's job). **Inputs:** Skyler's rulings on `yoshi-end-review-cpu-cost.md` (Q1 a, Q2 A, Q3 B and C), `bowser-end-review-warmup-delay.md`.

## What

1. **Render only when the frame changed** (`app/shared/fireworks-stage/fireworks-stage.ts` `shouldRender`, `RENDER_SETTLE_FRAMES = 90`).
   - A frame changed when any of these holds: a new renderer is mounted (first start, or the rebuild after a context restore); the renderer reports a resize; `DEVICE_PIXEL_RATIO` differs; a `quality` input changed (motion blur, Reduce flashing; star budget too, harmlessly); a seek ran this frame; the particle count changed; or particles are alive and `simTime` moved.
   - After the last change the stage still draws 90 frames (the trail at persistence 0.92 needs ⌈ln(1/1024)/ln 0.92⌉ = **84**, not the 83 the review record states), then presents nothing until the next change.
   - The sim, loop, drivers, frame hook (playhead) and stats run every frame regardless.
   - The warm-up handoff is not a change: it never moves the visible sim (only a later seek does, and the seek is a change).
   - A paused sky with particles stops drawing too: visuals are a pure function of the particle store (`visual-rules.ts`), so the trail converges to a fixed image.
   - Renderer side (`engine/render/pixi-renderer.ts`): `app.ticker.remove(app.render, app)` removes Pixi's per-tick present, `render()` now presents (`this.app.render()`) after the trail draw, and `start`'s callback gets `(deltaMS, resized)`. The contract is in `stage-renderer.ts`; `FakeStageRenderer.resize()` drives it in specs.
2. **Lean particle upload** (`engine/render/particle-upload.ts`): `PARTICLE_DYNAMIC_PROPERTIES` makes `uvs` and `rotation` static, and `StaticUploadMark.grows(n)` gates `pc.update()` to counts above every earlier count. The polyfill stays first and the CSP is untouched. There is no fused upload (option B waits for its trigger).
3. **Warm-up delay** (`ClientPlayback.WarmUpDelayMs` → `playback.warmUpDelayMs`, client clamp 0–5000, default 1000, `PLAYBACK_LIMITS` row).
   - `quietMs` counts frame time on non-seek frames and resets to 0 on every seek frame. An edit always seeks (the new-driver path requests one, or one is already pending), so edits reset it too.
   - Warm-up runs only when `quietMs >= warmUpDelayMs`. At 0 it behaves as before: warm-up runs in the frame the seek lands.
   - A seek in the middle of a warm-up keeps the shadow and resumes after the delay. An edit drops the shadow (as before) and starts again after the delay.
   - The 12 ms and 6 ms caps and the 10 s interval are unchanged.
4. **Skip short shows** (`WARM_UP_SKIP_COLD_RUN_MS`, an injection token, default 200: 1000 at first, 700 in the first addendum, 200 in the second).
   - **Prediction:** the first unfinished warm-up slice of each new warm run is a probe. The predicted cold run is its measured ms per step (from `STAGE_CLOCK`, with steps counted by `runSlice`) × `endBoundStep + 1`.
   - At or under the threshold (200 ms) the run is dropped, `warmedFor` is set, and `data-warm-up` is `skipped`. It is decided once per warm run. An edit or a run-key change probes again.
   - The probe costs at most one slice (12 ms idle, 6 ms playing), spent on steps the warm-up would have run anyway.
   - **Known bias:** the probe covers the show's opening, often its sparsest part, so it can under-predict a show that gets denser later. Skipping wrongly costs cold seeks on a show the probe thought was short. Warming wrongly costs at most about 1 s of CPU.
   - `WarmUpState` gains `'skipped'`.

## Why
- The rulings, plus the mechanics confirmed in the stage code. The stage already owned every dirty source (inputs, seeks, renderer lifecycle), so the decision lives in the host and the renderer only reports a resize.
- The probe follows Yoshi's option C: no static cost model. Device speed varies too much (a phone is several times slower than the 2019 MacBook Pro), and a constant per show-second would skip shows that take 3 s on a phone.
- A token for the threshold, not a served knob: the ruling names the threshold (1 s, lowered to 700 ms, then 200 ms), and the server shouldn't grow a knob nobody asked for. Specs about warm-up itself provide 0.

## Boundary
- Simulation inputs are untouched: no `starBudget`, capacity or step change. The goldens and fingerprints are unaffected by construction.
- **Anything that changes what the canvas shows must make `shouldRender` true.** That means a new renderer-visible setting, an overlay drawn into the Pixi stage, or anything that moves the visible sim outside `loop.frame` or a seek. Either set `frameDirty` or extend the list. Otherwise the stage freezes on the old picture.
- `pc.update()` runs only under `StaticUploadMark`. A future per-particle static property (rotation, or more than one texture) makes the mark wrong. Mark that property dynamic, or reset the mark whenever it changes.
- Browser tools that wait for `data-warm-up="finished"` must also accept `skipped` (Toad: `tools/browser-gates/gate-warm.mjs` `after` mode).

## Negative controls (each applied alone, run against its spec, then restored; all 23 killed)

| Mutant | Kills |
|---|---|
| R1 never skip a frame | 8 render-on-change specs |
| R2 drop `resized` | draws the frame after a resize |
| R3 drop the new-renderer check | the first frame after a context restore draws |
| R4 drop the seek dirty flag | a seek draws the frame it runs in |
| R5 drop the DPR check | DPR change draws |
| R6 drop the settings dirty flag | motion blur / Reduce flashing change draws |
| R7 settle 60 | the settle covers convergence (≥ 84) |
| R8 drop the count check | trail fades exactly 90 frames after the sky empties |
| R9 drop live stepping | a paused sky stops drawing (it drew nothing on unpause) |
| R10 settle `>` | the idle and fade counts |
| W1 no delay | 4 delay specs |
| W2 delay `>` | the exact-edge spec, plus 7 others |
| W3 seek frames don't reset the delay | a seek holds warm-up; an edit restarts the wait |
| S1 never skip | 3 skip specs |
| S2 skip `<` | at-threshold is skipped |
| S3 probe every slice | the decision is made once |
| U1 no static re-upload | GPU mirror against Pixi's `ParticleBuffer` |
| U2 high-water `<` | the mark ledger and the GPU mirror |
| U3 `rotation: true` | only position, vertex and color are dynamic |
| U4 `pc.update()` every frame | renderer structure spec |
| U5 keep Pixi's per-tick present | renderer structure spec |
| C1 client range 0–4000 | contract parity plus the clamp spec |
| C2 client default 500 | contract parity, appsettings and defaults |

The contract spec's own control is its state before this change: it failed on the missing `warmUpDelayMs` (Bowser's record).

## Not measured here
- The idle CPU saving, the 40k upload saving and the visual check side by side with the prototype are browser runs. Per the throughput rules they belong to the gate (Toad).
- The Chromium smoke check from Yoshi's Q2 test impact is not built: particles still draw after the count grows, shown by a screenshot before and after a burst. Its negative control is to drop the high-water `update()`.

## Addendum (2026-11-17): skip threshold 700 ms, dead run-key check removed

Skyler's verification rulings (plan status line), from findings in `toad-end-review-verification.md` (finding 2) and `toad-end-review-followups.md`.

- **What:** `WARM_UP_SKIP_COLD_RUN_MS` defaults to **700** (was 1000). The default spec now expects 700, and the spec-local thresholds in the skip specs moved to 700. The predictions there, 532 ms (skip) and about 2.1 s (warm), sit on the same sides of 700. **Correction (second addendum):** the 4 s fixture's end bound is step 1335, not 1063, so those predictions were 668 ms and 2.7 s; 668 still skipped at 700, by 32 ms. The at-threshold and 1-ms-over boundary specs derive `skipMs` from `endBoundStep`, so they are threshold-independent and unchanged.
- **Why:** at 1000, done-when-60 was skipped and its cold seek p95 measured 947–995 ms, a few ms under the 1 s bar it promises. ~~700 leaves about 30 % margin for device and load variance.~~ **Wrong (second addendum):** the margin was computed as if the probe predicted the real cold run. It under-predicts about 4×, so at 700 done-when-60 still skipped and seeked cold at p95 912 ms.
- **Gate string (Toad):** `tools/browser-gates/gate-warm.mjs` `SKIP_ON` matches `` `WARM_UP_SKIP_COLD_RUN_MS`,{factory:()=>1e3} ``. The compiled default is now `` `WARM_UP_SKIP_COLD_RUN_MS`,{factory:()=>700} ``. esbuild prints 700 as `700`, not `7e2`. Until `SKIP_ON` is updated, the patch's exactly-one-hit check fails. I did not edit the gate.
- **Dead check:** `TimelineDriver.takeCheckpoint` was `if (!this.runKey || !sameKey(this.runKey, key)) return;`, and is now `if (!this.runKey) return;`. Its one caller is `beforeStep`, which nulls `runKey` (F1) when the width, star budget or capacity differs from `ctx` and calls `takeCheckpoint` right after, with no write in between. `keyOf` reads the same three values, so a non-null `runKey` there always equals the key. The null half stays live: it is how F1 suppresses checkpoints. Mutant T23, which made exactly this change, was removed from `tools/mutants/sets/t3-engine.mjs`. It was not listed in `t3-redundancy.mjs`.
- **Boundary:** if `takeCheckpoint` ever gains a second caller, or `beforeStep` does anything between the F1 null-out and the call, the `sameKey` guard has to come back.
- **Verified:** `run.mjs --check t3-engine` shows 40 apply, 0 stale; `f1-fix` and `t3-redundancy` are also 0 stale. A full serial `t3-engine` run (`test-results/mutants/t3-engine-2026-11-17T20-34-36`) gave KILLED 30, SURVIVED 10. It has the same IDs and verdicts as `t3-engine-2026-11-17T14-01-56` minus T23, and the survivors are T14, T16, T18–T21, T27, T29, T30 and T40. The load was 7–11, not idle. The engine-loop and stage specs pass (17 files, 206 tests), as do the typecheck and Prettier.

## Addendum (2026-11-17, second): skip threshold 200 ms; Reduce flashing first render

Skyler's rulings, 2026-11-17 (one agent, no review chain). Commits not authorized.

### Skip threshold 200 ms
- **What:** `WARM_UP_SKIP_COLD_RUN_MS` defaults to **200** (was 700). The default spec expects 200. The spec-local thresholds are 200. The "cheap" step cost is now 0.1 ms (134 ms predicted). At 0.15 ms the prediction was 200.4 ms, which is over the threshold. The 4 s Done-when fixture's end bound is step 1335, not 1063 as its comment said, so the first addendum's "532 ms" was really 668 ms. The at-threshold and 1-ms-over boundary specs (the negative control) derive `skipMs` from `endBoundStep` and are unchanged. The compiled default is `` `WARM_UP_SKIP_COLD_RUN_MS`,{factory:()=>200} ``. `gate-warm.mjs` matches any number, so it needs no edit.
- **Why:** Toad measured the probe (`toad-end-review-verification.md`, addendum; `probe-pred.mjs`). It **under-predicts about 4×**, because the slice covers the show's sparse opening: done-when-60 was predicted at 237–253 ms against a real cold run of about 1.1 s, and realistic-600 at 1.4–1.8 s against about 6.7 s. At 700, done-when-60 still skipped and seeked cold at p95 912 ms. The first addendum's "about 30 % margin" compared a prediction with the bar as if the two were the same quantity. That was wrong. At 200, a skipped show's real cold run is about 0.8 s at most.
- **Measured** (`gate-warm.mjs <base> SAVE natural`, shipped threshold, no patch; Chrome on Metal; load 3.9–4.7): done-when-60 **reached `finished`** 3.46 s after load, with seek p95 **247 ms** (max 247, 0 over 1 s, 0 missed). realistic-600 reached `finished` 12.0 s after load, with p95 514 ms. PASS. Result file: `scratchpad/luigi-warm/gate-warm-natural-1794951942970.json`.
- **Not done:** a density-aware prediction, which would weight the probe by the cue density after the slice. It would let the threshold sit nearer the bar. It's a possible later improvement.
- **Harness trap:** `tools/test/lib.mjs` `startApi` runs the OAuth stub inside the calling process. A wrapper that runs the gate with `spawnSync` freezes the stub, and sign-in hangs (`UND_ERR_HEADERS_TIMEOUT`). Use async `spawn`.

### Reduce flashing first render (Toad's finding, owner Luigi)
- **Cause (proven; the `input(false)` hypothesis is refuted):** `RouterOutlet.activateWith` (Angular 22.2.6) calls `createComponent` and only `markForCheck`. The routed page's template has run in creation mode, so its static elements are in the document, but its bindings land on the next zoneless tick, a macrotask later. A `<input role="switch" [checked]>` created in creation mode reads unchecked for that gap. A loaded machine makes the gap visible to the gate. Flipping the input default to `input(true)` left the new spec failing, so the default plays no part: inputs are set before the first update either way. The builder's switch (`[checked]="store.reduceFlashing()"`, no input) has the same gap, which matches Toad's original `/show` flake.
- **What:** the designer's switch row (`quality-fields.ts`) and the builder's switch label (`show-builder-page.html`) are wrapped in `@if (true) { … }`. Control-flow content is created in update mode, together with its bindings, so the switch never exists without its `[checked]`. Each wrap carries a comment saying why.
- **Not changed:** the player's two switches are already inside `@if` blocks, so they're safe. The stage's `quality` input is consumed by an effect, and the renderer starts in `afterNextRender`. The mode effect builds a Random driver with the field default first, but the quality effect sets `driver.reduceFlashing` in the same flush, before any frame.
- **Specs:** `features/designer/shared/quality-fields/quality-fields.spec.ts` is an outlet that does exactly what `activateWith` does. Before the first tick there is no switch; after it, the switch is checked under reduce and unchecked off. `app/reduce-flashing-first-render.spec.ts` uses the real router on `/` and `/show`, with reduce on and empty storage. Its `(activate)` hook reads every switch at activation: none may be unchecked, and the settled switch is checked. It also asserts that the hook fired.
- **Negative controls:** removing the designer wrap fails both quality-fields cases and the `/` case. Removing the builder wrap fails the `/show` case. The old code fails both.
- **Boundary:** any element whose first-sight state matters (a switch, checkbox or `aria-*` read by a gate) in a routed page's top-level template must sit in a control-flow block, or be treated as absent until the first tick.

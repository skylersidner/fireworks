# Phase 2a/2b: engine port and fireworks-stage host

**Author:** Luigi · **Date:** 2026-11-12 · **Status:** proposed (for Skyler to promote, or not)

## What
1. **Golden values come from the prototype, by a checked-in script.** `src/web/fireworks-web/src/engine/sim/golden/record-prototype-golden.mjs` slices `prototypes/fireworks-prototype.html` from `const COLORS = {` to the Renderer banner, plus `shellDuration`, unchanged, and runs it headless in Node. It writes `prototype-golden.ts`, which holds the per-kind counts and position checksums at steps 60/240/360/450/600 for each preset at seed 20261112, a 10-launch sequence through the 7919 stride, a sky scenario, a star-budget scenario, `shellDuration`, and the prototype's own `PRESETS`/defaults/`COLORS`. The port's specs compare against that file. Re-run the recorder only when the prototype changes, never to make a port spec pass. Steps 360 and 450 were added because 60/240 fall before the first burst (rise takes about 300 steps) and 600 is after most presets have burnt out.
2. **The canary is deleted, not moved.** `app-fireworks-stage` takes over its lifecycle pattern and its specs. A canary under `engine/render` would be a second Pixi scene with no product use, kept only for its own sake.
3. **Pixi still loads through an injection token.** `STAGE_RENDERER_FACTORY` dynamic-imports `engine/render/pixi-renderer.ts`. The `StageRenderer` interface lives in `engine/render/stage-renderer.ts` with no Pixi import, so Angular code and the spec fake (`app/testing/fake-stage-renderer.ts`) depend only on the contract.
4. **The stage owns the sim and the loop; only the renderer is lazy.** `FireworksSim` and `EngineLoop` are created in the component and are public (`stage.sim`, `stage.loop`), so the host page and specs can see them. The renderer drives frames through `start(onFrame)` on Pixi's ticker. `onFrame` writes no signals. `stats` emits on accumulated frame time every 250 ms (about 4 Hz).
5. **`sky` precedence in the stage:** the `sky` input, else `shell.sky`, else `DEFAULT_SKY`. `normalizeShell` leaves an absent `sky` absent, so presets round-trip (acceptance 2a.6(a)). `effectiveSky(shell)` resolves it (2a.6(f)).
6. **`normalize` policy:**
   - a missing field gets its default;
   - an out-of-range number is clamped, and `stars` is rounded;
   - a name over 80 characters is cut to 80 code points; a missing or blank name becomes `Custom`;
   - unknown keys are dropped;
   - these are rejected, with every error listed by path: an unknown enum, a non-number in a number field, `version` other than 1, and `breaks` outside 1..4.
7. **Trail format is decided before the texture exists:**
   - WebGPU gets `rgba16float`;
   - WebGL2 gets it only with `EXT_color_buffer_float` or `EXT_color_buffer_half_float`;
   - everything else gets `rgba8unorm`.
   The result is exposed as `[data-trail-format]`. `StageRendererOptions.forceTrailFormat` is the dev switch for the fallback check in 2d.5.
8. **Loop timing knobs exist only for tests.** `EngineLoop` takes `maxFrameDt` (default 0.1) and `maxStepsPerFrame` (default 24). With the default clamp the 24-step cap can't be reached (Peach F2), so the cap spec raises the clamp.
9. **Engine specs run without a DOM.** Each spec under `engine/{model,sim,loop}` starts with `// @vitest-environment node`; the Angular unit-test builder honors it. The boundary spec enforces the docblock. A runtime assertion in `simulation.spec.ts` proves the docblock takes effect, and its negative control (docblock removed, so the file runs under jsdom) fails.

## Why
- Point 1: a snapshot of the port's own output would only freeze whatever the port does (Peach 2a.7). With the prototype as the oracle, a pass means the port matches the prototype.
- Points 3 and 4: the plan requires one sim, loop and renderer per instance (2b.1), Pixi in a lazy chunk, and no per-frame signal writes.
- Point 7: the prototype's `try/catch` around `RenderTexture.create` never throws. An unsupported float target fails at render time (Peach F3).

## Boundary
- The `prototype-golden.ts` fixture is generated. Never hand-edit it.
- New engine specs under model/sim/loop need the docblock, or the boundary spec fails.
- Nothing outside `engine/render` imports `pixi.js`, type-only imports included. The boundary spec has no allow-list.
- Specs and the 2c page read `stage.sim` and `stage.loop`; nothing outside the stage's own host page should mutate them.
- Deviations from the prototype, all non-visual:
  - a `ResizeObserver` on the host calls `app.queueResize()`, because Pixi's `resizeTo` only listens to window resize and an Angular layout can resize the host without one;
  - `normalize` clamps values and rejects more than 4 breaks, where the prototype's Apply accepted anything;
  - stats are throttled to about 4 Hz.

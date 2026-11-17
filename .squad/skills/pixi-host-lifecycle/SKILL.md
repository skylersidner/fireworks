# Skill: Pixi host lifecycle in an Angular component

**Domain:** Hosting a Pixi 8 Application inside a zoneless Angular 22 component
**Applies to:** `app-fireworks-stage` (`app/shared/fireworks-stage/`, moved from `features/designer/shared/` in Phase 5; Phase 2b; the Phase 1 canary was deleted in 2a), player (Phase 5), Show Builder preview (Phase 6)
**Confidence:** medium-high. Proven with specs and mutants in Phase 1 (canary) and Phase 2b (stage), and in headless Chrome against the built wwwroot. Not yet on a real GPU in the deployed image.

## Shape
1. **Scene module** (`*-scene.ts`, or `engine/render` later): the only file that imports `pixi.js`. It exports `async start(): Promise<Handle>`, and `Handle` has `canvas` plus an idempotent `destroy()`.
2. **InjectionToken factory** whose default is `() => import('./x-scene').then(m => m.start())`. The dynamic import puts Pixi in its own lazy chunk, and specs provide a fake.
3. **Component:**
   - Call `start()` inside `afterNextRender`, never in the constructor.
   - Set a `destroyed` flag in `DestroyRef.onDestroy`. Destroy the handle if it exists.
   - After `await start()`, **if `destroyed` is set, destroy the handle and return.** Never destroy a Pixi Application whose `init()` is still pending.
   - Append the canvas only after that check.
   - Catch init rejection (no WebGL) and show a failure state.
4. **Destroy:** `app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true })`. The renderer's GlContextSystem calls `WEBGL_lose_context.loseContext()`, which frees the context.
5. **Animation** runs on Pixi's ticker. Never write an Angular signal per frame.

## Specs that must exist (each with a mutant that fails it)
- It mounts after render and starts exactly once across repeated change detection.
- It destroys exactly once on component destroy, and the canvas is removed.
- **Destroyed while init is pending:** the handle is destroyed when init resolves and is never mounted. Mutant: delete the `if (destroyed)` check, and this spec fails.
- Destroyed before first render: `start()` is never called.
- An init failure shows the failure state.
- N mount/destroy cycles leave every handle with exactly one destroy call.

Fake: `src/web/fireworks-web/src/app/testing/fake-stage-renderer.ts`, a deferred per factory call that the spec resolves (with a renderer name and trail format) or rejects by hand. Each fake renderer is driven frame by frame with `frame(deltaMS, count)`.

## Stage shape (Phase 2b)
- The contract is `engine/render/stage-renderer.ts` (`StageRenderer`, `StageRendererFactory`), with no Pixi import. The real implementation is `engine/render/pixi-renderer.ts`, behind the `STAGE_RENDERER_FACTORY` dynamic import.
- The factory takes the host element (for `resizeTo`) but does **not** attach the canvas. The component appends it after the `destroyed` check.
- The component owns `FireworksSim` and `EngineLoop`. Inputs flow into plain engine fields through `effect()`. `renderer.start(onFrame)` runs `loop.frame` and `renderer.render` on Pixi's ticker. Throttle `stats` on accumulated frame time (250 ms), not wall clock, so specs can drive it.
- Destroy order inside the renderer: the off-stage containers (`worldRoot`, trail fade root) and the glow texture first, while the renderer is still alive; then `app.destroy({ removeView: true }, { children, texture, textureSource })`. Pixi never destroys off-stage containers for you.
- Specs that must fail on a mutant: those listed above, plus "stats emitted every frame" (600 frames at 60 fps gives at most 51 emissions) and "inputs never recreate the renderer".

## Sizing the host (Phase 2c)
- `app-fireworks-stage` has `:host { display: block; position: relative }`. A parent class `absolute inset-0` on the element **loses**: both selectors have the same specificity, and component styles load later. The stage renders 0 px tall and the canvas (absolute inside it) is invisible. Size it with `h-full w-full` (or a wrapper div), and check its size in the real-browser smoke. Specs in jsdom can't see this.
- **Synchronous fire after a load.** Inputs reach the engine through `effect()`, which runs at the next change detection. A page that loads a shell and must fire it in the same handler calls `stage.fireNow(shell, sky)`, which sets `loop.shell` and `sim.sky` first. Otherwise the launch fires the previous shell.
- **Viewer flags on a live driver.** Flip them on the running driver (`RandomShowDriver.reduceFlashing`), not by `setDriver(createDriver(...))`. A new driver starts its timer at 0 and fires immediately.

## Context loss (Phase 7 ruling, `yoshi-phase7-architecture-rulings.md` point 1)
- Pixi 8.23 `GlContextSystem` already calls `preventDefault()` on `webglcontextlost`, restores in place on `webglcontextrestored`, keeps the ticker running on a lost context, and auto-restores only its own `forceContextLoss()`. A test calling `WEBGL_lose_context.loseContext()` must call `restoreContext()` itself.
- **Detect in the renderer, decide in the host.** The renderer reports `'lost' | 'restored'` through `StageRenderer.onContextChange` and stops its ticker on loss. The host keeps the old renderer until `restored`, then destroys it and mounts a new one through the factory (same guard as first start, plus a generation counter). After the 10 s timeout (phase-7.md §11) or a rebuild the factory rejects, it destroys the renderer and shows the loss failure block; a later restore is ignored (coordinator ruling N1). Built in Phase 7 B2: `fireworks-stage.ts` `onContextChange`, specs in `fireworks-stage.phase7.spec.ts`, fake `loseContext()`/`restoreContext()` on `FakeStageRenderer`.
- **Trap:** `app.destroy()` calls `loseContext()`, which fires `webglcontextlost` on the dying canvas. Remove your listeners before destroying, or every navigation starts a rebuild.
- State that must outlive a rebuild belongs to the host, not the renderer: the sim, the loop, drivers, the last world width, and `FlashSpacing` (passed in through options). While the renderer is down, treat the stage as paused.

## Render only on change (end review, 2026-11-17)
- Pixi's `TickerPlugin` registers `app.render` at LOW priority. Remove it with `app.ticker.remove(app.render, app)` (same function and context), and present from the renderer's `render()`. A frame with no present keeps the last picture, even with `preserveDrawingBuffer` false.
- The host decides when to draw. The renderer only reports `resized` (a resize clears the trail). Dirty sources: a new renderer, resize, DPR, a settings change, a seek, a count change, and live particles stepping. Then 90 settle frames while the trail fades (84 needed at persistence 0.92).
- The sim, drivers, frame hook and stats still run every frame. Spec the skip with `FakeStageRenderer.renderCalls` over N frames, with one spec and one mutant per dirty source.

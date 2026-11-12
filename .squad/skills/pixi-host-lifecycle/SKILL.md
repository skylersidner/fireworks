# Skill: Pixi host lifecycle in an Angular component

**Domain:** Hosting a Pixi 8 Application inside a zoneless Angular 22 component
**Applies to:** the Phase 1 canary (`pages/home/pixi-canary/`), `app-fireworks-stage` (Phase 2), player (Phase 5), Show Builder preview (Phase 6)
**Confidence:** medium. Proven with specs and mutants in Phase 1, but not yet on a real GPU in the deployed image.

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

Fake: `src/web/fireworks-web/src/app/testing/fake-canary-scene.ts`, a deferred per `start()` that the spec resolves by hand.

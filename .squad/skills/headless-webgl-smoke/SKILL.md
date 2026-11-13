# Skill: Headless real-browser smoke for the Pixi stage

**Domain:** Running-app checks (the stage since Phase 2b; parity and WebGL-leak checks)
**Confidence:** medium. Used once in the Phase 1 review (2026-11-12).

## Setup
- Keep Playwright in the scratchpad (`npm i playwright` there), never in `src/web/fireworks-web/package.json`.
- `npx playwright install chromium` stalled on this machine (600 KB after 8 minutes). Use the installed Chrome instead: `chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`. The renderer reports `ANGLE (… SwiftShader driver)`.

## Assert the renderer, not just "it drew"
Pixi 8 with `preference: 'webgl'` **falls back** silently. With `--disable-webgl --disable-webgl2 --disable-3d-apis` it ran on WebGPU, and with WebGPU and the GPU also disabled it ran on Canvas 2D. Every run reported `data-status="running"` and drew pixels. To prove WebGL, check `canvas.getContext('webgl2')` on the stage canvas: it returns the existing context only if WebGL2 owns it.
- Since the Phase 1 fix round, the canary also reports the renderer Pixi picked: `.canary[data-renderer]` is `webgl`, `webgpu` or `canvas`, and the visible `[data-testid="canary-renderer"]` line names it. Measured 2026-11-12 (Luigi) with the same three flag sets: `webgl` (and webgl2 owns the canvas), `webgpu`, `canvas`. Assert `data-renderer="webgl"` and keep the webgl2 check as the independent oracle.

## Pixel check
- Read pixels from an **element screenshot**, not from `toDataURL` (WebGL's `preserveDrawingBuffer` is false). Decode the PNG in the page: `Image` → 2D canvas → `getImageData`.
- Count against the stage background `#04060c`. Healthy canary: about 3,300 of 40,200 pixels with max channel > 60, max channel 255, and about 310 distinct 5-bit colors.
- **Negative control:** set the canvas to `opacity: 0` and re-run. Measured: 372 pixels "bright" (the box border, max channel 64) and 8 distinct colors. So threshold on max channel > 200 or on distinct colors, not on "max > 60".

## Request ledger in the browser
Record `page.on('request')` for `/api` and `/health`, then sort. Phase 1 cold start: `GET /api/me` ×1 and `GET /health/live` ×2 (App probe and home page), matching `app.startup.spec.ts`.

## Stage (Phase 2b, measured 2026-11-12, Luigi)
- The stage host `app-fireworks-stage` carries `data-status`, `data-renderer` and `data-trail-format`. Assert `running`, `webgl`, and `rgba16float` or `rgba8unorm`, and keep the `getContext('webgl2')` oracle on its canvas.
- **Stub the API as healthy.** If the static server returns 503 for `/health/live`, the app's full-screen "API unavailable" modal covers the stage, and an element screenshot measures the modal instead (a constant 2774 bright pixels across samples). Answer `/health/live` with 200 `Healthy` and `/api/me` with `{"userId":null,"displayName":null,"isAuthenticated":false,"canWrite":false}`.
- Pixel check on the home-page stage (Peony loop, 440×418) in SwiftShader: 13–116 pixels with max channel > 200, max channel 255, and 83–205 distinct 5-bit colors, sampled at 2–8 s. Negative control (canvas `opacity: 0`): 0 bright pixels, max 64, 9 colors. Threshold on max channel > 200 **and** distinct colors > 40.
- SwiftShader runs at about 20–30 fps. Screenshots take 1–2 s each, so log real elapsed time with each sample.

## 2d.3 leak check (Toad, 2026-11-12)
- Script pattern: `addInitScript` wraps `HTMLCanvasElement.prototype.getContext` to count WebGL contexts created and `webglcontextlost` events (Pixi's GL destroy calls `loseContext`). Pixi creates 3 contexts and loses 1 at first mount (support probes); after that every mount/unmount cycle must add exactly +1 created and +1 lost. "Created − lost stays 2" is the leak oracle; `destroy = init − 1` can't be read from a prod build.
- Detect accidental reloads: set `window.__marker` in the init script and count `page.on('load')`. A plain `<a href="/">` reloads the document and silently resets every counter, so a "router link" run can look green while testing nothing.
- In-app navigation without a routerLink: `history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate', {state: {}}))` makes the Angular router navigate with no reload.
- Wait for the stage with `state: 'attached'`: `app-fireworks-stage` is an unstyled custom element and Playwright calls it hidden.
- The designer shows a first-visit flashing notice that **holds playback** (2026-11-13). Dismiss it with `[data-testid="flash-continue"]` (or `flash-turn-on`) before pixel checks; the old `flash-dismiss` id is gone. While it shows, the HUD reads `0 particles … seed —`. The notice card lies inside the stage element's screenshot clip, so judge the hold by the HUD, not by bright pixels (measured: 8352 bright pixels while held, all from the card). On load, focus is on the notice's first button, so the first Space answers the notice; it doesn't launch.
- Check `uptime` first. At load average 50–90 (another agent's Docker VM) a canvas screenshot took 8–1000 s; timing and pixel results from such a run are void.

## Designer at `/` (Phase 2c, measured 2026-11-12, Luigi)
- Script: `scratchpad/smoke/luigi-2c-smoke.mjs <wwwroot> [control]`. It covers cold start, interaction, the narrow layout, API down and `/status`.
- **The HUD and hint now sit over the stage**, so an element screenshot of `app-fireworks-stage` always contains text. Negative control (canvas `opacity: 0`): 0 pixels with max channel > 200, max 168, and a flat 59 distinct colors. Live Peony loop at 940×800: 83–92 bright, max 255, 219–242 colors during a burst. Between bursts it drops to 0 bright and 86–126 colors. **Threshold:** at least one sample with bright > 0, *and* colors > 100 in that sample. The old `colors > 40` no longer separates live from control.
- **Wait on state, never a fixed sleep.** In SwiftShader the HUD (4 Hz) lagged a Space launch by more than 600 ms. Wait until the HUD's seed changes (`waitForFunction`).
- Assert size, not only `data-status`. A stage that is `running` can be 0 px tall (the host-sizing gotcha in `pixi-host-lifecycle`); a 0-size element screenshot just times out.
- Ledger: `/` and `/status` each issue exactly `GET /api/me` and `GET /health/live`.
- API down (503): one `[data-testid="api-banner"]`, no toast, no `dialog[open]`/`aria-modal`, no `/api` or `/health` text, and the stage still `running`. There are 4 console errors: the browser's two resource 503s, plus the interceptor's two console log lines, which are by design.
- Escape on a `showModal()` dialog in headless Chrome closed it **without** a `cancel` event. Assert the dialog is gone and the state unchanged; don't assert on the event.

## Designer fix round (2026-11-13, Luigi)
- Script: `scratchpad/smoke/luigi-2c-fix-smoke.mjs <wwwroot>`. It adds four checks to the 2c script.
  - **The hold:** wait 4 s plus a sky click, and the HUD still reads `seed —`. Launch is disabled with its title.
  - **Dirty in the draft:** a name edit gives `dirty: true`; a confirmed preset followed by a reload gives `false`; an edit, a reload and a preset click opens the dialog.
  - **`/status` back link:** count `page.on('load')` and keep `window.__marker`. Clicking "Back to the designer" must give 0 loads with the marker kept.
- Read focus moves after a wait, not right after `page.click`. `afterNextRender` focus lands a tick later.

## Stress and fps runs (Toad, 2026-11-13)
- **Set up in the order preset, then Mode.** Changing Mode sets the designer's dirty flag (display settings are a dirty source), so a preset clicked afterwards opens "Load Willow?". Space is ignored while that dialog is open, so the HUD stays at 0 forever. This, not an engine defect, is why the port "never reached the cap" in the 2026-11-12 run.
- Drive both apps with the repo kit `tools/fps-compare/` (`serve.mjs` plus the `kit.js` overlay: A starts auto-Space, R records 10 s of rAF intervals). One origin, local Pixi, and the same synthetic Space on `<body>` for both. The headless driver is `scratchpad/toad3/kitfps.mjs`.
- The kit ignores A and R while a `select` has focus, which is where a Mode change leaves focus. Click the panel `h1` first.
- SwiftShader at the cap is CPU-bound, around 6–9 fps for both apps, and the headless run raises the load average by 3–6 on its own. Headless numbers are only a parity ratio, never the 30 fps floor.
- Teardown logs one Pixi warning per destroy: `[BindGroup] a 'textureSource' was destroyed while still bound to a shader`. It was already present in the 2026-11-12 build. It isn't a context leak (created − lost stays 2), so don't count it as a regression.

## Counting change detection headlessly (2d.2, Mario, 2026-11-13)
- A prod build exposes no `ng` global. Build dev into the scratchpad: `npx ng build --configuration development --output-path <scratch>/devbuild` (the override keeps `wwwroot` untouched), and serve `<scratch>/devbuild/browser` with the API stub.
- In the page, `window.ng.ɵsetProfiler((ev) => { if (ev === 12) cd++; })` counts `ProfilerEvent.ChangeDetectionStart` (12, from `@angular/core` `_debug_node-chunk.mjs`); count rAF frames beside it, and pass `null` to remove the hook.
- SwiftShader runs at about 15 fps, so judge the ratio, not the absolute 50: measured 36 passes over 150 frames in 10 s of idle Preview loop.
- **Negative control in the same page:** a rAF loop calling `ng.applyChanges(ng.getComponent(document.querySelector('app-root')))` each frame gave 144 passes over 144 frames, so the counter sees per-frame passes. Script: `scratchpad/smoke/mario-cd2.mjs <devbuild/browser>`.

## Timing-based parity checks (added 2026-11-13, Toad)
- Count launches from the HUD seed delta, `(seed − 20261112)/7919 + 1`, not by sampling HUD changes. The port's HUD updates about 4 times a second, so allow at least 900 ms before deciding that "nothing fired".
- Headless Chrome doesn't throttle background tabs, and CDP `Page.setWebLifecycleState: frozen` doesn't stop rAF. To test the 0.1 s dt clamp, stall the main thread instead: `page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 10000) {} })`.
- To compare visuals between the prototype and the port, use matched sim times, not equal wall-clock times. From a fresh page, the port runs about 0.4 s ahead.
- Check `uptime` first. SwiftShader runs at about 13 fps here, and a load average above about 8 stretches every timing.

# Skill: Headless real-browser smoke for the Pixi stage

**Domain:** Running-app checks (canary now; stage, parity and WebGL-leak checks from Phase 2)
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

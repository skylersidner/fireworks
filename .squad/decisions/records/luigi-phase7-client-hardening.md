# Phase 7 B2: client hardening (Luigi)

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7, batch B2 (plan §Phase 7 7.3) · **Inputs:** `boo-phase7-security-requirements.md` (P7-S10–S15), `yoshi-phase7-architecture-rulings.md` (all), `docs/fireworks-app/design/phase-7.md` §5.1, §10, §11, `toad-phase7-caps-and-seek.md`, `docs/fireworks-app/acceptance/phase-7.md` (7b, 7e, 7f, 7l, 7m), and the coordinator's rulings N1, N3, N4, 7l.4 and the pass bars (2026-11-15).

## What

1. **CSP in the bundle (P7-S10, S11).** `import 'pixi.js/unsafe-eval'` is the first import of `engine/render/pixi-renderer.ts`, pinned by `engine-boundary.spec.ts` ("imports the CSP-safe polyfill first", with source-text negative controls). `angular.json` production sets `optimization.styles.inlineCritical: false`; the built `index.html` has no inline `<script>`, no `<style>`, no `data-beasties` and a plain stylesheet link. Show JSON Apply (B3) must go through `openShow`; the `showEntryViolations` ledger gains that caller in B3.

2. **Context loss (Y§1, phase-7.md §11, coordinator N1).**
   - `StageRenderer.onContextChange(listener)`. `PixiRenderer` listens on its own canvas only when `name === 'webgl'`, stops its ticker on loss, and removes both listeners before `app.destroy()`.
   - The host (`FireworksStageComponent`) sets `data-status="lost"`, shows `Graphics paused by the browser…` (`role="status"`) after 1 s, and after 10 s destroys the renderer and shows the failure block (`role="alert"`, per-surface line, `Reload page`). A restore in time destroys the old renderer and mounts a new one through `STAGE_RENDERER_FACTORY`, guarded by a generation counter. A restore after the failure is ignored (N1: the renderer is gone). A rebuild the factory rejects fails with the loss copy, never the raw error.
   - Loss is a hold: `launch()` null, `replay()` false, `fireNow` only sets shell and sky, clicks ignored. The loop's width provider returns the last real width while no renderer is mounted. `FlashSpacing` is host-owned and passed in through `StageRendererOptions.flashSpacing`.
   - New stage input `surface` (`designer | builder | player`) picks the startup and loss copy (phase-7.md §10, 7e.12). Copy lives in `app/shared/fireworks-stage/stage-copy.ts`. Timers and Reload are tokens (`STAGE_TIMERS`, `PAGE_RELOAD`).
   - The timeline's 2D canvases redraw on `contextrestored`. The builder's draft already flushed on `pagehide`; a spec now pins it (7e.6).

3. **DPR (phase-7.md §5.1).** `core/browser.ts`: `canvasResolution(dpr, coarse) = min(dpr, coarse ? 1.5 : 2)` and the `CANVAS_RESOLUTION` token (reads `DEVICE_PIXEL_RATIO` and `(pointer: coarse)` per call). The stage passes `resolution` into the factory on every create (a rebuild re-reads it); the timeline reads it on every draw. The engine never calls matchMedia.

4. **End clamp (Y§2).** `currentStep()` is `seekTarget ?? playbackEndStep ?? driver.step`. `playbackEndStep` is set after a playback frame that reached the end and cleared by a seek or a driver change; the driver-change effect re-seeks to `currentStep()`. `TimelineDriver.inherit` documents why a late checkpoint interval applies only to a driver built without `from`.

5. **Background warm-up (Skyler: cold seeks count; every device).**
   - Driver API: `TimelineDriver.twin()` (same document and options, holding this driver's checkpoints) and `adoptCheckpoints(from)` (merges `from`'s checkpoints taken before the first step where the schedules differ; wider spacing wins; the memory cap applies; this driver's run is untouched). `inherit` and `adoptCheckpoints` share `divergeStep`, so the exactness rule is one function.
   - Stage: input `warmUp` (the builder sets it; the player doesn't). Each frame, after the foreground seek or playback, the shadow (a twin on its own `FireworksSim` and `EngineLoop`, same width provider, star budget and capacity) first adopts the visible driver's checkpoints, runs toward the end with the frame's remaining seek budget, capped at `WARM_UP_PLAYING_MS` = 6 ms while the show plays and `WARM_UP_IDLE_MS` = 12 ms otherwise (the full 25 ms held a paused builder at 30 fps; 12 ms keeps it at 60 fps for the same warm-up time), and hands its checkpoints back. Nothing runs in a frame whose foreground seek hasn't landed. It restarts for every new driver, so it starts after a `/c/` load, a draft restore, a Show JSON Apply (no extra hook needed) and resumes from the edit point after an edit, because the new driver inherits the checkpoints before the edit. A width, star budget or capacity change restarts it.
   - Hook: `data-warm-up="off | running | finished"` on `app-fireworks-stage` (7l.4). Written on transitions only.
   - In-frame, not `requestIdleCallback`: 7l.6 asks for the seek budget and foreground-first in one frame, and Safari has no `requestIdleCallback`.

6. **Shared-component move (Y§3).** `save-bar`, `save-status`, `hud`, `api-banner`, `save-copy` (+ spec) and `formats.ts` are in `app/shared`. `reasonOf` is now a required parameter of `invalidStatus`, `saveFailureStatus` and `reasons` (it moved ahead of the defaulted ones). New rule in `designer-structure.spec.ts`: no non-spec file in `app/shared` value-imports `features/`, and `features/show` may value-import only `designer-draft` and `designer-copy` from the designer, with negative controls. **It found one crossing Yoshi's list missed:** `show-save.ts` imported `MAX_BODY_BYTES` from `designer-save.ts`. The constant moved to `core/creation-save.ts`.

7. **F3 (Y§5, N4).** `embeddedShell(show, key)` in `engine/model/show.ts`; every read moved to it (page, store, template through a `selectedShell` computed, player, timeline layout, `lifetime.ts`, `timeline-driver.ts`, and `show-edit.ts`'s two reads). `src/app/embedded-shell-reads.spec.ts` allows `.shells[` only in `normalize.ts`, `show.ts`, `show-edit.ts` and `sim/simulation.ts`, bans `in`/`for…in` over shells, and checks `constructor`, `toString`, `valueOf`, `hasOwnProperty` and `__proto__` against the helper with a bare-lookup negative control.

8. **Cleanups.** `PlaybackClientConfig` → `ClientPlaybackConfig` (doc comment fixed). `doneWhenShow()` reads `schema/fixtures/valid/show/done-when-60s-50.json` through `openShow`; the `showEntryViolations` ledger lists `app/testing/show-fixtures.ts` as a test-only caller.

## Why
- Point 2 follows Yoshi's split (detect in the renderer, decide in the host) with Rosalina's numbers and the coordinator's N1.
- Point 5: Toad's A3 cold p95 was 3.6–4.9 s because the first far seek re-runs from 0. The shadow pays that once in the background, and because a checkpoint is an exact snapshot of a straight run of the same schedule, handing it over can't change a result.
- Point 6's crossing shows why the rule is worth a spec and not only a list.

## Evidence
- **CSP (P7-S13):** production build served by a clean publish of the current API source (Bowser's real header, no injection). Chromium (Chrome channel), Firefox and WebKit (Playwright 1.65), on `/`, `/show` (with a far scrub), `/c/<show>`, `/s/<shell>`, `/s/<show>`, `/mine`, `/status`, `/s/ZZZZZZZZ`, `/nope/page`: **0 violations in all three engines**, 0 page errors, a stage canvas with `data-status="running"` on every stage page. The only console errors are the app's expected 404 for `/s/ZZZZZZZZ`. Negative controls (Chromium): `script-src 'none'` injected gives 72 violations and errors; a build without the polyfill (copied tree, real header) gives `script-src eval` from the Pixi chunk and `data-status="failed"` on every stage page. Built `wwwroot/index.html`: no `<style`, no `beasties`. Scripts: `scratchpad/pw/luigi-csp.mjs` (+ logs `luigi-csp-*.log`).
- **Warm-up, production build, Chrome headless (Metal), i7-9750H.** Script `scratchpad/pw/luigi-warm.mjs` (Toad's A3 seeds). "Pre-B2" is the old `wwwroot` on 5180 run back to back at the same load.
  | Show | Run | p95 (p50) | > 1 s | Notes |
  |---|---|---|---|---|
  | Realistic 600 s | after warm-up | **490 ms** (64), 633 ms (69) | 0 | warm-up 10.3 s and 10.0 s from load; 1–2 long tasks ≤ 67 ms |
  | | early (1 s after load) | 3604, 4230, 4299, 4683, 5356 ms | 2 each | paired pre-B2 cold: 3698, 3799, 4673, 4654 ms (the 5356 run had 13 long tasks from contention and no valid pair) |
  | Done-when | after warm-up | 264 ms, 271 ms | 0 | warm-up 2.3 s |
  | | early | 237, 311 ms | 0 | pre-B2: 894, 922 ms |
  - **Pass bars:** after warm-up < 1000 ms: met. Early ≤ 4330 ms: met in 3 of 5 runs; in every paired run early was at or below the same-load cold baseline, so warm-up never made an early scrub worse. At load 5–7 the baseline itself exceeds 4330.
  - Paused frame times during warm-up: 17 ms p95 (with the 12 ms idle cap; 33 ms with the full budget).
- **Context loss, real browser (Chromium, SwiftShader, prod build):** `/`, `/show`, `/s/<shell>`, `/s/<show>`: a 300 ms loss shows nothing and returns to `running` on WebGL; the canvas draws again after restore (element screenshots differ; the builder opens paused, so it is the exception); a long loss shows the status line at 1.3 s and the per-surface failure block at 10.8 s; no console errors. Script `scratchpad/pw/luigi-ctx.mjs`.
- **Mutants (copied tree `scratchpad/mutroot`, with an unchanged baseline first):** 24 killed with an assertion: FlashSpacing per renderer, 1280 fallback, loss not a hold, no end clamp, `previous.step` re-seek, stale renderer event, 5000 ms timeout, no notice delay, coarse branch dropped, stage ignoring the rule, timeline raw DPR, no playing cap, warm-up ignoring the budget, adopt ignoring divergence, no handback, helper without `hasOwn`, shared importing a feature, a bare `shells[` read, no `pagehide` flush, no `contextrestored` redraw, warm key without width, polyfill removed, the loss branch showing startup copy, the fixture replaced. Two are equivalent and recorded as such: removing the "no warm-up during a pending seek" check (the remaining budget is already ≤ 0 in that frame), and the stage-level divergence filter (a twin always has the same schedule; the driver spec kills it).

## Boundary
- **Yoshi** reviews `twin` and `adoptCheckpoints` (driver API added under his point 6 handoff idea) and the shared `divergeStep`.
- **Toad** re-runs 7l.3 and 7l.5 on the image; `pw/luigi-warm.mjs` waits on `data-warm-up="finished"`.
- **Rosalina:** the stage now renders the loss line itself (bottom left), and the builder hides `Catching up…` while it shows. Warm-up takes about 10 s on a realistic 600 s show and keeps the builder at 60 fps (12 ms idle cap, 6 ms while playing).
- **B3** adds the Show JSON `openShow` caller to `showEntryViolations` and the overview canvas to `CANVAS_RESOLUTION`.

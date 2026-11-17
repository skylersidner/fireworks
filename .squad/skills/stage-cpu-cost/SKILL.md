---
name: stage-cpu-cost
description: Measuring the browser CPU cost of a Pixi stage (main-thread busy %, per-process CPU, self-time split) in headless Chrome on the real GPU. Use for automatic-quality, renderer-upload, polyfill and warm-up cost questions, the CPU framing Skyler set for performance.
---

# Stage CPU cost

**Domain:** render and stage performance · **Confidence:** medium (Yoshi, end-of-project review, 2026-11-17; record `yoshi-end-review-cpu-cost.md`)

## Setup
- **Browser:** Playwright `chromium.launch({ channel: 'chrome', headless: true })`. On this Mac it reports `ANGLE Metal Renderer: Intel(R) UHD Graphics 630`, so the GPU is real. Check `WEBGL_debug_renderer_info` first: SwiftShader numbers are meaningless for render cost.
- **Build:** the production build on the 5180 API, after checking that `wwwroot` is newer than the sources. Use `bypassCSP: true` for measurement only.
- **Context:** `deviceScaleFactor` is the DPR lever.
- **State through `localStorage`, not the UI:**
  - `fireworks.flashNotice.v1 = '1'`;
  - `fireworks.draft.v1` with a shell and `display: { mode, persistence, starBudget, reduceFlashing }`;
  - `fireworks.showDraft.v1` with `{ show, nextCueId, selectedCueId, activeShell, view, dirty, saved, source }` for the builder.
- **Reaching the 40k cap:** a 400-star glitter peony plus `keydown`/`keyup` Space on `<body>` 10 times a second. The default Peony never gets near it.

## Metrics (one 10 s window after a 6 s ramp)
- **Main thread:** Δ`TaskDuration` from CDP `Performance.getMetrics` ÷ wall.
- **Per process:** Δ`cpuTime` from `SystemInfo.getProcessInfo` on `browser.newBrowserCDPSession()` (renderer and GPU process) ÷ wall.
- **Frames:** rAF intervals (median, p95).
- **Attribution:** `Profiler.start` (200 µs sampling) for 5 s, with self time aggregated by `functionName url:line`. The minified `O` in the sim chunk is `particleVisual`.

## Traps
- **zsh doesn't word-split `$var`**, so `node x.mjs $a` passes a single argument. Use `IFS='|' read -r ...`.
- **`starBudget` has no effect when the input saturates the cap.** Compare it below the cap.
- **Seek and warm-up spend their budget by design.** Exclude them when measuring render cost.
- **Run serially and record the load.** Single runs are ±20%.

## Added by Toad (end-review step 4, 2026-11-17)
- **Since render-on-change, "idle" needs a long ramp.** Yoshi's idle-manual cell still has the dense shell's load burst in its window (avg ≈1.8k particles). Use a 20 s ramp for a true idle (1.6% main, 1.3% GPU process at DPR 2).
- **The player has no scrubber.** Measure a long show by playing it in full, in consecutive 10 s windows, and report the worst window (realistic-600's finale is the peak). Script: `scratchpad/toad-er/player-cpu.mjs`.
- **Count presents directly:** wrap `WebGL2RenderingContext.prototype.drawElements`/`drawArrays` in an init script. Zero draws for 500 ms means the stage is quiet.

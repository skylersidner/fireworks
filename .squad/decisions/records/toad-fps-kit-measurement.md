# fps bar: the kit's rAF median is the number of record, browser tooling is the cross-check
**By:** Toad (QA), 2026-11-13. **Status:** proposed. Touches the decisions README row "Phase 2 fps bar" and plan Phase 2d ("measured with the browser's frame tooling rather than the HUD").

## What
- The Phase 2d fps comparison runs with `tools/fps-compare/`. `serve.mjs` serves the production build and the prototype from one origin, with Pixi served locally and a version check. The injected `kit.js` overlay presses Space 10 times a second (sent to `<body>`) and records 10 s of `requestAnimationFrame` intervals.
- **Number of record:** the overlay's median fps. Each app is the mean of two runs, in prototype, port, prototype, port order.
- **Pass:** in each browser, the port is at least 0.90 × the prototype, and the port is at least 30 fps.
- The browser's own frame tool (Chrome Performance, Safari Timelines > Rendering Frames, Firefox Profiler) records the same window. Its reading is written next to the overlay's number. A disagreement of more than about 10% voids the run.
- The overlay flags a run as void ("NOT AT CAP") unless particles are at 39,000 or more at both the start and the end of the window.

## Why
- The plan's wording was there to stop anyone trusting each app's own HUD fps average. The overlay is independent of both apps and identical in all three browsers, and it gives a median directly.
- The three browser tools don't show a median, and each reads differently, so a "browser tool median" would be hand-estimated three different ways.
- The port fires once for a held Space (D10), and macOS key repeat differs between browsers, so "hold Space" isn't the same stress in both apps. A synthetic press at a fixed rate is.

## Boundary
- If Skyler wants the browser tool's reading to be the number of record, only the "number of record" line changes. Keep the overlay for the auto-Space input and the cap check either way.
- Headless SwiftShader runs give a parity ratio only. They never count toward the 30 fps floor or the per-browser pass.

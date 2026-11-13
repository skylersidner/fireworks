# fps-compare: port vs prototype at the 40k cap

This kit was built for the Phase 2d performance check in `plans/initial-implementation.md`. That check is **benched**: Skyler benched fps requirements and tests until the end-of-project re-evaluation (2026-11-13, plan §6), where the concern to re-evaluate is browser CPU load, not visual frame rate. No gate uses this kit. The bar it was built for (the port's median fps at least 90% of the prototype's, and never below 30, in Chrome, Firefox and Safari) is **historical**, not a requirement. The kit is kept for reference and for that re-evaluation.

`serve.mjs` serves both apps from one origin on `127.0.0.1`:
- the port's **production build** at `/`;
- `prototypes/fireworks-prototype.html` at `/prototype.html`.

Both get the same locally installed `pixi.js` (the server refuses to start if the versions differ). It also injects a small overlay, `kit.js`, into both pages. The overlay does two things:
- **A** turns auto-Space on or off. It presses Space 10 times a second, sent to the page body the same way in both apps. This is needed because the port fires only once for a held Space (by design), and macOS key repeat isn't a fixed rate.
- **R** records 10 seconds of frame intervals and shows the median fps, the 95th-percentile frame time and the particle count.

The overlay ignores A and R while a text field or select has focus. It needs only Node (26, per `.nvmrc`) and no packages beyond the app's own `npm ci`. `tools/` is excluded from the Docker image.

## Start it

From the repo root:

```sh
cd "/Users/skylerasidner/personal projects/fireworks"
nvm use                                        # Node 26.5.0 from .nvmrc
npm --prefix src/web/fireworks-web run build   # production build into src/api/Fireworks.Api/wwwroot
node tools/fps-compare/serve.mjs               # prints the two URLs; Ctrl+C to stop
```

If the build is older than the source, the server prints a warning. Rebuild before you measure. To use a different port, run `node tools/fps-compare/serve.mjs 4311`.

## Before you measure (once per session)

1. Plug in the power adapter, and turn Low Power Mode off.
2. Quit Docker Desktop, any builds or test watchers, and other heavy apps. In Terminal, `uptime` should show a 1-minute load average below about 4. Note the value.
3. Turn macOS **Reduce motion** off (System Settings > Accessibility > Display). When it's on, the port turns Reduce flashing on and opens in Manual by itself, and the prototype has neither, so the comparison wouldn't be like for like.
4. Use one display for every run. If the display is a 120 Hz ProMotion screen, write that down, because fps can then go above 60.

## The procedure (per browser)

Use a **fresh private window** for each run:
- Chrome: ⇧⌘N
- Firefox: ⇧⌘P
- Safari: ⇧⌘N

A fresh window resets the port's saved draft and its first-visit notice. Don't use full screen. The overlay in the bottom-right corner shows `width×height @dpr`. Make the window about **1440×900** and keep it at **exactly the same size** for the prototype and the port in that browser. Check the overlay before each recording.

Run order: prototype, port, prototype, port (two runs of each).

### Prototype run: `http://127.0.0.1:4310/prototype.html`
1. Set **Mode** to "Manual (click sky / Space)".
2. Click the **Willow** preset.
3. Leave Motion blur at 78% and Star budget at 100% (the defaults).
4. Click once on an empty part of the left panel, so no control has focus. Then press **A**. The overlay shows `auto-Space ON (10/s)`.
5. Wait until the HUD (top right) reads **at least 39,000 particles**. This takes a few seconds.
6. Start the browser's frame recording (see the next section). Then press **R** and don't touch anything for 10 seconds.
7. When the overlay shows the result line `#N median …`, stop the frame recording. Press **A** to stop auto-Space.

### Port run: `http://127.0.0.1:4310/`
1. The flashing notice appears and holds playback. Click **Continue**, not "Turn on Reduce flashing", because Reduce flashing changes what's drawn.
2. Click the **Willow** preset **first**, then set **Mode** to Manual. If you change the mode first, the designer counts it as an edit, and Willow asks "Load Willow?". Choose **Load Willow** in that case.
3. Under Display, check that Motion blur is 78%, Star budget is 100% and Reduce flashing is Off.
4. Do steps 4–7 from the prototype run.

If the HUD stays at 0 particles after you press A, the notice or the "Load Willow?" dialog is still open. If a result line says **NOT AT CAP: discard**, the particles weren't at 39,000 or more for the whole window. Discard that result and record again.

## Frame tooling (record during the overlay's 10 s window)

**Open the developer tools in a separate window** (undocked) before you load the page. A docked panel changes the viewport size.

- **Chrome:** DevTools (⌥⌘I) > **Performance**. Press Record (⌘E), press R in the page, and stop when the overlay shows the result. Read the frame rate from the **Frames** track over the 10 s window.
- **Safari:** enable Settings > Advanced > "Show features for web developers". Then open Web Inspector (⌥⌘I) > **Timelines** and turn on **Rendering Frames**. Record, press R, and stop after the result. Read the frame durations.
- **Firefox:** start the **Firefox Profiler** with ⌃⇧1, press R, and capture with ⌃⇧2 after the result. Read the frame rate from the profile's frame (refresh/composite) markers over the window.

Recording a profile costs a little fps in both apps alike. If the browser tool's reading and the overlay's median disagree by more than about 10%, note it and run again.

## What to write down

Write one row per run:

| Browser + version | Display Hz | Viewport (overlay) | Load (`uptime`) | App | Run | Overlay median fps | p95 ms | Particles start→end | Browser tool reading |
|---|---|---|---|---|---|---|---|---|---|

The overlay also logs each result as one JSON line (`[fps-compare] {...}`) in the console. You can paste those lines instead.

## Pass bar (per browser, historical)

This is the benched 2d bar, kept for reference only (see the top of this file). It isn't a requirement.


- **Prototype** = the mean of its two run medians. **Port** = the mean of its two run medians.
- **Pass** if Port ≥ 0.90 × Prototype **and** Port ≥ 30 fps.
- If one app's two runs differ by more than 10%, the machine is noisy. Close whatever is running and repeat the pair.
- If both apps sit at the display's refresh rate (60, or 120 on ProMotion), the port passes, but note "at vsync" in your results.

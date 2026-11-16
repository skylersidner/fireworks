# Skill: Playwright virtual time (`page.clock`) for fireworks playback checks

Use this when a browser check needs a show to play to its end without waiting in real time. Proven by probe P1 (2026-11-15, Chromium, real production CSP; `scratchpad/toad-interlude2/p1-clock.mjs`).

1. **It works under the real CSP.** `page.clock.install()` is accepted with `script-src 'self'` and no `unsafe-eval`, so no `bypassCSP` is needed. Poll with `page.evaluate`, not `waitForFunction`, because the latter is blocked by that CSP.
2. **`install()` does not freeze time.** The installed clock keeps running at real speed. Call `page.clock.pauseAt(t)` right after `install({ time: T0 })`. **NEG (mandatory):** never advance the clock, wait longer than the show in real time, and assert the show has *not* ended. Without `pauseAt`, this NEG fails: the show ends on its own.
3. **Step with `fastForward(100)`, not `runFor(100)`.**
   - `runFor` fires every 16 ms animation frame inside the interval. In software WebGL that is slower than real time: the 60 s Done-when show had not ended after 180 s.
   - `fastForward` fires one frame per call. `EngineLoop` clamps to 0.1 s, which is 12 steps per frame.
4. **Virtual time only pays on short, sparse shows.**
   - A 10 s fixture (`cue-at-duration`) plays in about 1 s.
   - The dense 66 s Done-when show took 62.6 s at load 15–20, because each frame is CPU-bound (sim plus render).
   - Long or dense shows belong in Node goldens, not the browser.
5. **Click through the DOM** (`page.evaluate(() => el.click())`) while the clock is paused. Playwright's `page.click` waits for "element is stable", which uses animation frames, and stalled 3.7–22 s.
6. **Count virtual steps, not real seconds.** Loop at most N `fastForward` calls, checking the end state each time. A real-time `until(…, 60000)` loop with sleeps mixes the two clocks. Make N cover the show's full length: my first Replay loop stopped at 400 calls, short of a 66 s show.
7. **Frozen budgets (Yoshi T4, code-settled).** Inside a frame `performance.now()` doesn't move, so seek and warm-up budgets never run out. Budget and "Catching up…" behavior can't be tested under virtual time; keep those in the jsdom step-clock specs.

## Added in the interlude tooling batch (2026-11-15)
- **The repo script is `tools/browser-gates/player-virtual-time.mjs`** (the regular smoke step `player-vt`). Copy its `open()` / `stepUntil()` / `domClick()` shape for any new virtual-time check.
- **A cheaper frozen-clock NEG:** right after the stage runs, read the time readout, wait 3 s of real time, then read it again. With `pauseAt`, the readout stays `0:00` and the show doesn't end. Without it (`PAUSE=0`), the readout is `0:03`. This catches the same defect as waiting out the whole show, but in 3 s instead of more than 16 s. Re-verify it with `PAUSE=0` whenever the script changes.
- **Give the positive run a lower bound on virtual time**: the 10 s show took ≥ 10 s of `fastForward` time (14.4 s measured). An "ended" state that shows up early can't pass. Pair that with an end-state NEG (`NEG_HIDE_ENDED=1`, which removes `player-ended` as it appears).

# Toad: Phase 7 A3, caps and seek cost (measured)

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7 (plan §7.3 A3, Done-when 10; answers the numbers behind Q7.5 and the Q7.3 warm-up trigger)

## What
1. **Keep both caps: the 40,000-particle cap and the 600 s maximum duration.** Lowering either one doesn't help a realistic show. It cuts the worst case by only 1.4–3.5×, which leaves seeks at minutes, not seconds. A 20k cap also visibly drops stars in a realistic dense finale.
2. **The >1 s p95 trigger is tripped by cold seeks, and only by them.**
   - **Cold** means a saved show freshly opened from `/c/`, followed by 20 random scrubs. On a realistic 600 s show the Chrome p95 was 3.6–4.9 s on every surface (production build, dev headed, dev headless).
   - **Warm** means after one pass through the show. The p95 was 0.30–0.43 s.
   - The Done-when show sits at the line, with a cold p95 of 0.87–1.03 s.
   - The cold cost comes from the first far-forward seek past the played region, which is a full run with no checkpoints yet. That is exactly what background checkpoint warm-up removes. **Recommendation: count the trigger as tripped and build warm-up (Q7.3).** Yoshi's §13 p95 (292 ms) is a warm number, and so is the warm row below. If Skyler reads the trigger as warm-only, it is not tripped, and this needs his ruling.
3. **The worst case stays a UX cost, not a freeze** (F1 holds). `at-maximums` seeks to the end in 154 s on the production build, with 1 long task (73 ms). Real-time playback at the cap holds 60 fps (p95 frame 17 ms with about 40k live particles).

## Numbers
Machine: i7-9750H (2019, 6 cores, 12 threads), 32 GB, macOS 15 (Darwin 24.6), Chrome stable via Playwright `channel: 'chrome'`, viewport 1280×720 (world width 1620.7). Node 26.5 for the model. **Load average was 4–11 throughout**, because teammates were running in parallel, so treat every figure as roughly ±20 %. Seek budget 25 ms (default `ClientPlayback`), `starBudget` 1, checkpoints every 10 s, 64 MiB cap.

### Chrome, current tree, saved shows
Each show was saved with `POST /api/creations` and opened at `/c/<code>`. Times are wall time from the scrub `input` event to arrival. "Cold" and "warm" are 20 seeks each with the same seeded targets.

| Show | Surface | Seek to end | Long tasks (to end) | Warm 20: p50 / p95 | Cold 20: p50 / p95 (seeks > 1 s) |
|---|---|---|---|---|---|
| Done-when (60 s, 50 cues) | prod headless | 1.37 s | 0 | 109 / 351 ms | 109 / 866 ms (0) |
| | dev headed | 1.44 s | 0 | 107 / 202 ms | 107 / 900 ms (0) |
| | dev headless | 1.62 s | 1 (53 ms) | 121 / 257 ms | 126 / 1033 ms (1) |
| Realistic 600 s (337 preset cues) | prod headless | 7.8 s | 0 | 48 / 296 ms | 61 / **3605** ms (3) |
| | dev headed | 8.4 s | 0 | 22 / 411 ms | 59 / **3801** ms (3) |
| | dev headless | 9.9 s | 2 (max 74) | 23 / 432 ms | 71 / **4904** ms (3) |
| `at-maximums` (600 s, 1000 cues, worst case) | prod headless | **154 s** | 1 (73 ms) | 6.6 / 10.8 s | not run |
| | dev headless | 219 s | 133 (max 221, Σ 11 s) | 6.8 / 14.7 s | not run |

- **Step cost at the 40k cap** (Chrome dev, `at-maximums`, 600 synchronous steps after the store fills at 6.2 s): p50 1.90 ms, p95 2.20 ms, mean 1.74 ms per step. Node: 1.55 / 1.75 ms. During a seek, frames run about 31 ms (prod; 25 ms of sim plus render).
- **Playback at the cap:** 5 s of Play at 60 s into `at-maximums` (39,983 live) gave 300 frames, p50 and p95 both 17 ms. Prod showed one 100 ms frame and one 61 ms long task; dev showed none.
- **Checkpoints:** realistic 600 s holds 62 checkpoints at 7 MiB. `at-maximums` holds 15 at 35.6 MiB, because the cap thinned the spacing to 40 s, which is why its warm seeks stay at 4–15 s.
- **Errors:** none on any page.

### Cap alternatives (node model, `FireworksSim({ capacity })`, no product change)
"Seek to end" is one uncapped `seek` call from a fresh driver; Chrome measured 1.0–1.3× this. Drops are counted by wrapping `particles.spawn` on the instance, in a separate untimed pass. A drop is a spawn refused because the store is full.

| Show | Cap | Peak live | Particles dropped (max in one step) | ms/step at cap | Seek to end (node) | Est. Chrome |
|---|---|---|---|---|---|---|
| `at-maximums`, 600 s | 40k | 40,000 | 19.7 M (2,389) | 1.55 | 121 s | 154 s (measured) |
| | 30k | 30,000 | 17.9 M (2,176) | 1.16 | 89 s | ~115 s |
| | 20k | 20,000 | 14.8 M (2,038) | 0.78 | 58 s | ~75 s |
| `at-maximums` squeezed to 300 s | 40k | 40,000 | 13.1 M (2,790) | 1.87 | 67 s | ~85 s |
| | 30k | 30,000 | 10.4 M (2,256) | 1.37 | 53 s | ~68 s |
| | 20k | 20,000 | 7.8 M (1,769) | 0.92 | 34 s | ~44 s |
| Realistic 600 s (337 cues) | 40k / 30k / 20k | 20,331 / 20,331 / 19,976 | 0 / 0 / **410** (104 at 603 s, the finale) | — | 7.2–9.2 s | 7.8 s (measured) |
| Realistic 300 s (211 cues, 30 s finale) | 40k / 30k | 27,913 | 0 / 0 | — | 4.3–4.4 s | ~5 s |
| | 20k | 20,000 | **21,421** (435 at 290.5 s) | 0.87 | 4.4 s | ~5 s |
| Done-when | any | 10,041 | 0 | — | 1.2–1.6 s | 1.4–1.6 s (measured) |
| 1000 preset cues, 600 s (Yoshi's shape) | 40k | 10,552 | 0 | — | 28 s | — |

- **Cold 20-seek p95 in node, all caps:** Done-when 0.84–1.13 s; realistic 300 s 2.1–2.4 s; realistic 600 s 3.5–3.8 s; 1000 preset cues 11.5–15.6 s. Lowering the cap leaves each of these the same within noise. A 300 s maximum removes the far half of a realistic show, so its cold worst roughly halves (about 2 s), which is still over 1 s.
- **Uncapped demand:** a realistic show needs 10–28k particles, so it never touches 40k or 30k. `at-maximums` squeezed into 300 s still filled a 600k store. The worst case is cap-bound at any cap.

### Reconciliation with earlier numbers
- **Yoshi, §13 (Node, warm):**
  - Done-when first pass 1.06 s; this run 1.2–1.6 s.
  - `at-maximums` first pass 112 s; this run 121 s.
  - Warm `at-maximums` 3.6 / 7.2 s; this run 4.0 / 7.5 s.
  - 1000 preset cues 19.5 s; this run 28 s. My cue set and timing differ from Yoshi's (unknown seeds) at 0.39 ms/step against his 0.28.
  - All of these are within the load noise except the preset show.
- **Boo, F1 addendum (Chrome, after the fix):** max show to the end 183.8 s, longest task 214 ms. This run: dev 219 s (higher load) and prod 154 s. The dev build's 133 long tasks (max 221 ms) against prod's 1 match Boo's note that dev overstates the cost. The 100–220 ms tasks are render and GC on the dev build, not the seek.

### Newer machine (estimate, not measured)
The sim is single-threaded typed-array JS, so the cost scales with single-core speed. A 2022–2025 laptop or desktop (Apple M2–M4, Zen 4/5, Raptor Lake) runs single-thread JS benchmarks about 2–3× faster than an i7-9750H. Add about 1.2× for running without contention. **Expect about 2.5× faster, with a plausible range of 1.8–4×:**

| | This machine | Newer machine (range) |
|---|---|---|
| Realistic cold p95 | 3.6–4.9 s | ~1.5 s (0.9–2.7 s), likely still over 1 s |
| Done-when cold p95 | ~0.9 s | ~0.35 s |
| `at-maximums` to the end | 154 s | ~60 s (40–85 s) |

Phones and low-end Chromebooks can be 1–2× slower than this machine. Nothing here was measured on such a device.

## Why
- **Cost is steps × live particles.** Step cost is linear in particles (about 0.04 ms per 1k at the cap). Seek cost is linear in the steps re-run since the latest checkpoint.
  - A cap can only cheapen steps that sit at the cap, and realistic shows never do.
  - A shorter maximum only shortens the longest re-run.
  - Neither touches the cold first-pass problem. That problem is the missing checkpoints, which warm-up fixes for every show size.
- **A lower cap is a visible quality cost.** At 20k, the realistic 300 s show's finale loses 21k stars (435 refused in one step), and the 600 s show's last burst loses 410. At 30k nothing realistic drops. So 30k is "free" for realistic shows, but it only takes the worst case from 154 s to about 115 s: no user-visible gain, and it adds a show-only cap to schema.md, both validators and the fixtures (B4).
- **The worst case is already contained:** the frame-budgeted seek (F1 closed), 1 long task on prod, real-time playback at 60 fps at the cap, and 35.6 MiB of checkpoints under the 64 MiB cap. What remains is the time a crafted or extreme show takes to catch up, and "Catching up…" covers it.

## Method (reproducible, scratchpad only, no product code touched)
- **Node:** `scratchpad/toad-a3/bench.mjs` (with `shows.mjs` and `bench-entry.ts`).
  - The engine is bundled with the repo's esbuild.
  - Each case builds `FireworksSim({ capacity, starBudget: 1 })`, `TimelineDriver` and `EngineLoop` with `worldWidth = 1422`.
  - The realistic shows come from the product `PRESETS`, seeded: a cue every 1–4 s, then a finale at one cue per 0.3 s for the last 30 s.
  - The 300 s worst case is `at-maximums` with every `t` scaled by 0.5.
  - Logs: `node-bench.log`, `node-bench-atmax.log`. The run is lean for `at-maximums`, with warm seeks only at 40k and no demand pass.
- **Chrome:** `scratchpad/pw/toad-a3.mjs` (`<base> <headless|headed> <codes.json>`).
  - `page.route` stubs `GET api/client-config` with the defaults, except `catchingUpDelayMs: 0`. On the production build (`http://localhost:5180`, `wwwroot` built 10:30 and newer than every non-spec source file), "Catching up…" then marks every multi-frame seek, and arrival is its removal (±1 frame).
  - On dev (4200), arrival is `ng.getComponent(stage).seeking()` polled each rAF.
  - Long tasks come from a `PerformanceObserver('longtask')`.
  - Logs: `toad-a3-dev-headless.log`, `toad-a3-headed-and-prod.log`, plus the JSON outputs.
- **Writes:** 3 POSTs (`xCj5u8X8` Done-when, `VA5SYWiN` realistic 600 s, `8cCu3vXX` `at-maximums`) and 3 DELETEs, spaced 4 s apart. Each code returns 404 afterward.

## Boundary
- These are measurements and a recommendation. Q7.5 (caps) and the reading of the Q7.3 trigger (cold or warm) are Skyler's calls.
- If warm-up is built (Luigi on the stage, Yoshi on the `{ from }` handoff), the acceptance check is this record's cold row re-run on the production build: realistic 600 s cold p95 under 1 s once warm-up has had idle time to finish. Also measure what happens when the user scrubs before warm-up is done.
- If a cap is lowered anyway, it goes through B4 (schema.md first, then both validators and the fixtures).
- No fps requirement is implied (Q7.2). Every number above is wall time.

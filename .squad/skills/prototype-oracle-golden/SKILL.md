# Skill: Golden values from the prototype oracle

**Domain:** Engine parity tests (Phase 2 now; the TimelineDriver and show playback in Phase 6)
**Confidence:** high. In Phase 2a all 10 presets plus 4 scenarios matched the prototype on the first port run, and the seed-stride and prand mutants failed it. The crossette gen-guard mutant did not, because the guard is unreachable in prototype playback (children spawn with effect `none`). Only a unit spec that spawns a gen-1 crossette star by hand catches it.

## Pattern
1. **Never snapshot the port.** Run the prototype's own code to produce the expected values.
2. The recorder is `src/web/fireworks-web/src/engine/sim/golden/record-prototype-golden.mjs`. It slices the prototype by **text markers**, not line numbers: from `const COLORS = {` to the `Renderer` banner, plus `function shellDuration` up to `function tick`. It writes the slice and a harness into a temp `.mjs` and `import()`s it in Node. Prototype globals (`P`, `shells`, `world`, `simTime`) are reset by the harness between scenarios.
3. The output goes to a generated `.ts` file (`prototype-golden.ts`, `as const`), so the spec needs no JSON import or fs access. Run Prettier on it after generating.
4. Record **integer state** (count per kind, `n`, shells in flight) for exact comparison, and **position sums** for comparison within a tolerance (plan §3.2 item 4). The current tolerance is 0.01 + 0.5 world units per live particle on each axis sum.
5. Pick checkpoints that land in the interesting phase. Shells rise for about 300 steps, so 60 and 240 only cover the rise. Add 360 and 450, during the burst.
6. Include a scenario that goes through every seed-deriving path (the launch sequence with `launchSeed(n)`). Otherwise a seed-stride mutant survives, because a single launch at n = 0 never uses the stride.
7. Record the prototype's own data too (`PRESETS`, `newShell()`/`newBreak()` defaults, `COLORS`), so preset parity is also checked against the oracle and not against a hand transcription.

## Run
`node src/engine/sim/golden/record-prototype-golden.mjs` from `src/web/fireworks-web` (Node 26). Re-run it only when the prototype changes.

## Hardening (Toad, 2026-11-12 Phase 2a/2b QA)
- **Sums alone are blind to radial errors.** A symmetric burst's x and y sums don't move when every star flies 1% (or 0.3%) faster, so `burst speed ×1.01` passed every golden. The snapshot now also records the **spread** per axis, `Σ|p − mean|`, which can't cancel. Tolerance 0.01 + 0.01 units per particle. Measured port-vs-prototype delta is ≤ 5e-4 units per sum or spread (the fixture's 3-decimal rounding) in Node 26, headless Chrome 157 and macOS JavaScriptCore (`/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`, with a `structuredClone` shim), so the tolerance is ~100x the noise per particle.
- **Slice every seed-deriving function from the prototype; don't retype it in the harness.** The recorder now slices `let acc = 0, launchCount = 0` … `function worldWidth()` (the prototype's `fire`) and the sequence scenario calls `fire()`. A stride or base-seed change in the prototype now changes the fixture; before, it didn't.
- **Recorder formats its own output** with the project's Prettier config, so a re-run is byte-identical with no manual step.
- **Prove the oracle moves:** mutate the prototype slice in a scratch copy, re-run the recorder, diff the fixture. Then restore and confirm byte-identical.
- **Cross-engine check without browsers:** bundle the golden comparison with the project's esbuild (`node_modules/.bin/esbuild entry.ts --bundle --format=iife`) and run it in Node, `jsc`, and Chrome via `page.evaluate`. Firefox headless from the sandbox never fetched the page (also with the sandbox off); use Skyler's machine.

## Show determinism (Yoshi, Phase 6 TimelineDriver)
The prototype has no shows, so there is no oracle. The check is **self-consistency plus cross-engine**:
- **Compare the whole store exactly**, not sums: `Array.from(field).slice(0, n)` for x, y, vx, vy, age, kind, seed, plus `n` and `shellCount`, with `toEqual`. Seek, checkpoint restore and frame size must give a bit-identical store in one engine.
- **Equivalences to pin:** straight `advance(k)` = loop frames at 24/60/144 fps reaching `k` = `seek(k)` forward = `seek(k)` backward = `seek(k)` from a checkpoint = `seek(k)` from an inherited checkpoint after an edit. Run each at a small `capacity` (2500–3000) as well, so the cap is reached; the cap is where order and history start to matter.
- **Array-order mutants need same-step cues.** A show without ties can't tell "ordered by `(fireStep, id)`" from "array order". Put three cues on one step, with different shells.
- **Cross-engine without browsers:** bundle a script with esbuild (`--format=iife`) that runs the show to its end and prints the end step, an FNV hash of `particles.n` per step, the ledger and an x sum. Run it in Node and in `jsc` with a `structuredClone` JSON shim. The Done-when show was identical in both.
- **Timing benches** go in a scratch esbuild bundle run in Node, never in a spec (performance is benched, standing decision). Don't run mutants while a bench runs; they share the CPU.

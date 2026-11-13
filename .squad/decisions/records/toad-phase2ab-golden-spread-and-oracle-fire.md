# Golden snapshots record spread, and the recorder slices the prototype's fire()

**Author:** Toad · **Date:** 2026-11-12 · **Status:** proposed (Skyler decides on promotion)

## What
1. Each golden snapshot (`src/web/fireworks-web/src/engine/sim/golden/`) records, besides per-kind counts and the x/y position sums, the **spread** per axis: `devX = Σ|x − mean x|`, `devY = Σ|y − mean y|`. The port spec compares spread within `0.01 + 0.01·n` world units. The sum tolerance (`0.01 + 0.5·n`) is unchanged.
2. `record-prototype-golden.mjs` slices the prototype's own `fire()` (from `let acc = 0, launchCount = 0` to `function worldWidth()`), and the sequence scenario fires through it. The harness no longer retypes `baseSeed` or the 7919 stride.
3. The recorder runs Prettier on its output, so a re-run gives a byte-identical file with no manual step.

## Why
- Sums cancel for symmetric bursts. Mutants `burst speed ×1.01` and `×1.003` passed all 193 specs with the sums only. With spread they fail 13 tests each.
- The measured port-vs-prototype delta is at most 5e-4 units per sum or spread, which is the fixture's 3-decimal rounding. That holds in Node 26 (V8), headless Chrome 157 and macOS JavaScriptCore (Safari's engine, which uses the system libm). So the spread tolerance is about 100 times the noise per particle.
- With the stride typed into the harness, the oracle for 2a.15 was a transcription. Changing `7919` or `baseSeed` in the prototype left the fixture unchanged. Now both change it.

## Boundary
- The existing fields came out byte-identical when regenerated. The only difference in the fixture is the new `devX`/`devY` fields.
- Firefox wasn't measured (headless Firefox wouldn't load a page from this sandbox). If Firefox's numbers drift past `0.01·n`, widen the tolerance using a measured value. Don't drop the spread check.
- This doesn't change Luigi's rule: re-run the recorder only when the prototype or the recorder changes, never to make a port spec pass.

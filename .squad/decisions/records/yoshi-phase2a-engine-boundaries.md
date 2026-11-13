# Phase 2a engine boundaries, normalize contract and the Phase 6 seams

**Author:** Yoshi · **Date:** 2026-11-12 · **Status:** proposed (for Skyler to promote, or not)
**Reviewed code:** `src/web/fireworks-web/src/engine/**`, `src/app/features/designer/shared/fireworks-stage/fireworks-stage.ts`, Luigi's `luigi-phase2ab-engine-and-stage.md`.

## What

1. **Layer direction is part of the boundary, not only package names.** Allowed edges inside `engine/`: `model` imports nothing outside `model`; `sim` imports `model`; `loop` imports `model` and `sim`; `render` imports `model` and `sim`. `model`, `sim` and `loop` never import `render` (any form, type-only included) and import no bare specifier at all (relative paths only). No file under `engine/` imports `@angular/*`.
2. **Pixi reach is checked transitively.** Outside `engine/render`, no file may reach `pixi.js` (or `@pixi/*`) through a chain of static value imports. A dynamic `import()` of a render file is the one legal edge, because that is the lazy chunk. Type-only imports of Pixi-free render files (`stage-renderer.ts`) stay legal.
3. **The specifier parser treats an unparseable import as an offense.** In `engine/`, a dynamic `import(...)` or `require(...)` whose argument isn't a plain quoted literal fails the spec, and template-literal and options-bag forms (`` import(`x`) ``, `import('x', { with })`) are parsed. Still no allow-list.
4. **`normalizeShell` reports what it changed.** Shape:
   ```ts
   export type AdjustmentKind = 'defaulted' | 'clamped' | 'rounded' | 'truncated' | 'dropped';
   export interface ShellAdjustment { readonly path: string; readonly kind: AdjustmentKind; readonly from?: unknown; readonly to?: unknown; }
   export interface ShellIssue { readonly path: string; readonly message: string; }
   export type NormalizeResult =
     | { readonly ok: true; readonly shell: ShellDocument; readonly adjustments: readonly ShellAdjustment[] }
     | { readonly ok: false; readonly errors: readonly ShellIssue[] };
   ```
   Paths use the shipped form (`breaks[1].color1`, `sky.wind`, `name`, `version`). A missing `version` is a `defaulted` adjustment, not silent. An absent `sky` is not an adjustment.
5. **Phase 3's strict validator is normalize plus "zero adjustments".** `validateShell(x)` is valid exactly when `normalizeShell(x).ok` and `adjustments` is empty; every adjustment becomes an error at the same path. One walker, two modes, so the strict and lenient rules can't drift.
6. **`sky` absent stays absent.** `normalize` never adds or strips a `sky` block; `effectiveSky()` is the only place the 160/0 default is applied to a shell. A shell with no `sky` and one with `{160,0}` play the same but are different documents.
7. **The crossette `gen === 0` guard stays** (prototype l.313, l.318), and its only control is the unit spec that spawns a dying gen-1 crossette star (`simulation.spec.ts` l.136).
8. **Phase 6 seams, added when TimelineDriver is built (not before):**
   - `PlaybackDriver` gets an optional `beforeStep?(ctx, step: number)` that `EngineLoop.frame` calls inside the fixed-step loop, with an integer step counter the loop owns. Cues fire on the first step whose index is at least `Math.round(cue.t / STEP)`, never at a frame boundary.
   - `PlaybackContext` gets `fireSeeded(def, tx, ty, seed)`, which doesn't consume the loop's launch counter (cues carry their own seed).
   - `effectiveSky(shell, showSky?)`: when a show sky is given, it wins (plan Phase 3 recommendation).
9. **The worker-thread seam is a type, not a move.** `StageRenderer.render` should take a read-only particle view (`n` plus the typed arrays the renderer reads), which `ParticleStore` satisfies structurally, and `colorAt` becomes a free function over that view. Moving the sim to a worker happens only when the 2d fps bar fails in some browser **and** a profile shows `sim.step` taking more than half the frame at the 40k cap. Otherwise it doesn't happen.

## Why
- Points 1 to 3: the shipped spec (`engine-boundary.spec.ts` l.78–92) checks only direct package specifiers. `sim/x.ts` importing `../render/pixi-renderer` passes today, and so does `app/` importing it statically, which would put Pixi in the main bundle. The parser misses `` import(`pixi.js`) `` and `import('pixi.js', {...})` (checked against a copy of `importSpecifiers`).
- Points 4 and 5: 2c's "applied with N values adjusted" and Phase 3's strict validator need the same fact, "what would normalize change". Computing it in the engine model keeps the store and the validator thin, and the C# validator can mirror one documented walk.
- Point 6: acceptance 2a.6(a) requires presets (which have no `sky`) to round-trip unchanged; plan §3.3 says "optional; defaults applied on load". Only absent-stays-absent satisfies both.
- Point 8: a per-frame tick quantizes cue times to the frame rate, so a 30 fps device and a 144 Hz device fire the same cue on different steps. Under the 40k cap, spawn order then changes counts, which breaks plan §3.2 item 5.

## Boundary
- Points 1 to 5 bind Phase 2 (Luigi implements; Toad records the mutants). Points 8 and 9 are design notes for Phase 6, not 2c work.
- Steps in `limits.ts` are a UI concern. Stored values need not lie on a step, and neither normalize nor the validator snaps them.
- Name length is counted in code points on both sides. The C# validator must count runes, not UTF-16 units.

# Rosalina: Phase 6 post-implementation design review (Show Builder)

**Date:** 2026-11-14 · **Status:** proposed · **Phase:** 6 · **Inputs:** `docs/fireworks-app/design/phase-6.md` (now §19), `records/luigi-phase6-show-builder.md`, `features/show/**`, `features/player/pages/player-page/*`, `shared/link-copy.ts`, `features/mine/**`, `engine/render/visual-rules.ts`.

## What
1. Luigi's deviations are triaged in phase-6.md §19.1. Library drag, pinch zoom, `+k` badge zoom and the scrub overview move to Phase 7. Re-seek on every edit, Undo/Redo buttons, end-label relocation, same-step flash grouping and reuse of the designer's save bar/status/HUD are accepted.
2. Three must-fix-now defects (§19.2): B1 the builder has no API banner (copy given); B2 Undo/Redo `disabled` drops focus; B3 the builder notice doesn't take focus from `body`.
3. phase-6.md is updated for Skyler's rulings: Show JSON → Phase 7, Motion blur device-wide (`fireworks.motionBlur.v1`), native controls on the builder, Undo session-only 50 steps with field-native ⌘Z in text fields, no in-place shell editing.

## Why
- An editor that hides Save without saying why when the API is down reads as "saving doesn't exist" (B1).
- A button that disables under focus is the Phase 5 lesson (phase-5.md §12.1); Undo emptying its history is the common path, not an edge (B2).

## Boundary
- B4–B7 are Phase 7 accessibility-pass items, not gate blockers.
- Moving the shared save bar, status and HUD out of `features/designer/shared` is Yoshi's and Luigi's call; design only requires that both surfaces use the same component.

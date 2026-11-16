# Rosalina: Phase 7 design-review (accessibility, reduced motion, touch)

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7 (batch A2) · **Spec:** `docs/fireworks-app/design/phase-7.md` · **Inputs read in code:** every `features/**/pages` and `pages/` component, `fireworks-stage.*`, `pixi-renderer.ts`, `visual-rules.ts`, `drivers.ts`, `browser.ts`, `device-preferences.ts`, `api-banner.ts`, `break-tabs.ts`, `json-panel.ts`, `timeline.ts`, `show-copy.ts`, `labels.ts`, `normalize.ts`, `app.html`, `styles.css`, `index.html`.

## What
1. **Mobile for the DPR cap means `(pointer: coarse)`**, not width. Resolution = `min(dpr, coarse ? 1.5 : 2)` from one shared function, for the Pixi stage and the timeline's 2D canvases. The timeline now follows the cap; today it uses the raw DPR.
2. **Touch-friendly**, under `(pointer: coarse)` only:
   - 44×44 minimum targets on every `.btn`, field, switch row, header link and toast ×;
   - 16px field text (iOS focus zoom);
   - `touch-action: manipulation` on buttons;
   - 8px gaps;
   - a 44px hit area on the stage marker;
   - a 12px cue hit radius for touch.
3. **Builder at 760px and narrower:** a two-line transport (a line-break element, never CSS `order`), the toolbar `Add cue · Edit cue · Delete · Undo · Redo`, and the status as an always-present wrapping line. On touch, a one-finger drag pans the lane unless it starts on the selected cue. Landscape phones are a known limitation.
4. **Ctrl/⌘+S saves** on `/` and `/show` while the save bar renders:
   - It works in text fields, and the builder commits the focused field first.
   - With two choices it focuses `Update original` and sends nothing.
   - With no save bar it isn't intercepted.
5. **`aria-disabled` looks unavailable by default** (opacity 45%, `not-allowed`). In-flight buttons add `.btn-busy` to keep their look. This changes phase-5.md §2.2's styling, not its behavior.
6. **Focus never drops to `body`.** Named targets for K1–K8: Add break at the 4th, JSON Revert, the inspector after undo, Library Remove, toolbar Duplicate/Delete (→ `aria-disabled`), the `/mine` list Try again, the toast ×, and a builder skip link.
7. **Reduced motion: verified, pass.** The only addition is `motion-reduce:transition-none` on the switch knob. New view changes (pinch, badge zoom, drag) never ease.
8. **Specs for the moved builder items:**
   - Library drag: fine pointer only, clamped to the window, the item becomes active, focus goes to the timeline.
   - Badge zoom: at least one zoom step; at 200 px/s it selects the first hidden cue.
   - Scrub overview: the view box is drawn but not draggable; a seek outside the view scrolls the lane.
   - Proportional trackpad pinch, plus Safari `gesturechange`.
   - The end label tries ruler → lane foot → not drawn, and badges always win.
9. **Show JSON:**
   - a closed `<details>`, rendered only while open;
   - Copy copies the document exactly;
   - Apply notes use `showFieldLabel`, never bare `fieldLabel`;
   - at most 5 reasons;
   - a shell-pasted-here note;
   - the confirm action reads `Apply JSON`.

   `CUE_FIELDS` moves into `labels.ts` as `CUE_FIELD_LABELS`.
10. **B4–B7 and Try again:**
    - an `announce()` helper that clears, then sets;
    - visible notes re-announce without blinking;
    - focus survives Undo/Redo;
    - the 32-shell note sits under the active item;
    - Duration and Launch time notes for every rejected entry;
    - Try again is `aria-disabled` + `.btn-busy`, and focus goes to the `h1` when the banner unmounts.

    The stage failure copy becomes per-surface (it says "shell" on the builder and the player today).
11. **Context loss UX:**
    - playback holds (same sim time);
    - a status line after 1 s;
    - a failure block with `Reload page` after 10 s without a restore;
    - nothing extra on restore;
    - the builder flushes its draft on `pagehide`.

## Why
- **Coarse pointer** identifies a phone or tablet GPU; width identifies a window. One cap across both canvases is one test.
- Every Phase 5 and 6 focus fix was found after the build. An inventory with a named target per vanishing control lets Toad's tab-walk check them all at once.
- The two-choice ⌘S rule keeps the standing "owner chooses with two visible buttons" decision.
- A native range can't also host a draggable box without breaking touch and assistive-tech operation of the scrub.

## Boundary
- Where context loss is handled, and where the resolution function lives, are Yoshi's (A4). This record fixes only what the visitor sees, and that the engine doesn't call `matchMedia`.
- Open for Skyler:
  - Q1: Is Show JSON Apply an Undo step? Recommended yes.
  - Q2: ⌘S with two choices. Recommended: focus `Update original`.
- Doesn't change the dense-flash, multi-select or fps-quality exclusions.
- Doesn't edit `.squad/decisions/README.md`.

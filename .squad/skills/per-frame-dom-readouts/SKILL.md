# Skill: Per-frame readouts without signals (playhead, time, progress)

**Domain:** Angular hosts of the Pixi stage that show live playback state (the Show Builder transport and timeline, the show player). **Confidence:** medium. Used in Phase 6 (2026-11-14, Luigi).

## Rule
Never write a signal on every frame. Anything that moves every frame (a playhead line, a time readout, a progress bar, a scrub `value`) is written through an element ref from a plain callback the stage calls in its frame loop.

## Pattern
- The stage takes a `frameHook` input `(step, driver) => void` and calls it from its Pixi ticker callback, outside change detection, reading it with `untracked`. Don't use an `output()` for this: a template listener marks the view dirty, which runs change detection on every frame.
- In the hook:
  - Write `el.style.transform` (the playhead's `translateX`, the progress bar's `scaleX`).
  - Write `textContent` only when the shown value changes (a new tenth or a new second).
  - Set `input.value` and `aria-valuetext`, but not while the user is dragging that input.
- A signal write from the hook is allowed only as a one-off transition, guarded by a plain field: the exact end recorded once per driver, or a view-range change at most 4 Hz.

## Traps
- **A hook-written element must have no Angular binding inside it.** `el.textContent = …` replaces Angular's text node, and later bindings then update a detached node. The visible text silently freezes. In Phase 6 the builder kept showing the previous show's "about 0:07" after a link load. Keep the element empty in the template and write it from one method, which both the hook and an `effect` (for the paused state) call.
- **A presentational component's inputs lag its own outputs within one task.** Keys pressed faster than change detection (End then ←, three `=` presses) read the stale input. Remember the last emitted value until the input catches up (clear it in an `effect` on the input). Have the parent compute from the store's signal, not from the child's input.
- In jsdom, `canvas.getContext('2d')` returns null, so guard every draw. Schedule redraws with `requestAnimationFrame` from an `effect`, at most once per frame.
- Headless smoke: wait before reading DOM after a click or key. Reading at once returned the previous status in 2 of 6 probes.

## Where
`shared/fireworks-stage/fireworks-stage.ts` (`frameHook`, `TimelineFrameHook`), `features/show/pages/show-builder-page/show-builder-page.ts` (`frameHook`, `writeTime`), `features/show/shared/timeline/timeline.ts` (`setPlayhead`, `emittedSelection`), `features/player/pages/player-page/player-page.ts` (`frameHook`).

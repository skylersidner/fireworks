# Phase 7 B3: UX and accessibility (Luigi)

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7, batch B3 (plan §Phase 7 7.3) · **Inputs:** `docs/fireworks-app/design/phase-7.md` (all of §3, §5–§10), `docs/fireworks-app/acceptance/phase-7.md` (7g, 7h, 7i, 7j, 7k), `luigi-phase7-client-hardening.md`, Skyler's rulings in plan 7.5 (Apply is one Undo step; ⌘S with two choices focuses Update original; no dense-flash warning, no multi-select).

## What

1. **Shared helpers.**
   - `app/shared/announcer.ts`: `announcement()` is the one sr-only polite region helper (builder, designer, player, `/mine`). `liveNote()` is for visible live notes (Duration, Launch time, Show JSON), rendered in a keyed `@for (track seq)` so a repeat replaces the text node.
   - `app/shared/save-shortcut.ts`: `saveShortcut(state)` is §3.3's table as one pure function.
   - `core/browser.ts`: `isApplePlatform()` (the two page copies are removed) and `isSaveShortcut(event)`.
2. **R4.** `.btn[aria-disabled='true']` dims (not-allowed, 45%). `.btn.btn-busy[aria-disabled='true']` keeps the full look with the progress cursor. `.btn-busy` is on the save bar while saving, on `/mine` Delete while deleting, and on Try again while checking. The switch knob has `motion-reduce:transition-none`.
3. **Focus (K1–K8, B5).**
   - K1 is in `break-tabs` `onAdd`. K2 is json-panel Revert, which focuses the textarea.
   - K4 targets the next row, else the previous row, else `lib-preset-0`, also after the `Remove…` dialog.
   - K5: toolbar Duplicate and Delete are `aria-disabled`.
   - K6: `/mine` retry focuses the h1.
   - K7: `App` hands focus from a removed toast × (dismissed, or timed out while focused) to the next ×, else to `h1[tabindex]`. The player and `/status` h1s got `tabindex="-1"`.
   - K8 is the builder skip link: `href="#transport"`, and its click focuses Play or Back to start with `preventScroll`.
   - B5: `historyStep()` runs for every undo and redo (keys and buttons). Focus goes from the inspector or toolbar to the timeline, and from anywhere else to the h1, but only when it was left on body, a disabled control or a removed node.
   - Try again: `BannerFocus` in `api-banner.ts` moves focus to the panel h1 when the banner unmounts with focus inside it.
4. **⌘S.** It's handled in each page's `(document:keydown)`, before ⌘Z. In the builder, while the bar shows, it first runs the focused field's own commit: `commitDuration`, `commitLaunch`, or `endCoalesce` for Name. The single-choice Save has `aria-keyshortcuts`.
5. **B6, B7.**
   - B6: `capNoteFor(ref)` puts `#lib-cap-note` under the active item and sets the item's `aria-describedby`.
   - B7: Duration with cues and a value below the last launch shows the blocked note. Otherwise a blank, non-number, below-1 or above-600 value shows `DURATION_RANGE_NOTE`. Both fields have `aria-describedby` and `aria-live` on the note.
6. **Touch (§5.2, §5.4).**
   - The `@media (pointer: coarse)` block in `styles.css` is unlayered. It has to beat utilities (`min-w-0`, `text-caption`), and the first Chromium check found both overriding it. A spec pins it at brace depth 0.
   - Header links use `.touch-link`, switch rows `.touch-row`, and toast × uses `pointer-coarse:size-11`. **Superseded in part by the `bowser-phase7-review-fixes.md` addendum on 2026-11-15:** coarse sizes are raw px (`size-[44px]`, `min-h-[44px]`, `gap-[8px]`), not rem-based classes, under the 13px root. The stage marker has a 44 px transparent hit area around the 14 px ring.
   - Narrow builder dock: the DOM order is unchanged, and an empty `basis-full h-0` break puts the scrub and zoom group on line 2. Edit cue shows only while a cue is selected. Duplicate and the shell name are hidden. A `status-line` is added, and the timeline is fixed at 96 px.
7. **Timeline (`timeline.ts`, `timeline-layout.ts`).**
   - New `manualView` output: pinch, pan, trackpad zoom and badge zoom all stop Follow.
   - Touch: tap selects, or seeks and deselects (on release). A drag on the selected cue moves it. Any other drag pans; nothing happens at Fit. The touch hit radius is 12 px.
   - A second finger cancels the one-finger gesture: a cue drag reverts, a scrub ends where it was. After a pinch, nothing counts until all fingers are up.
   - Zoom: Ctrl+wheel is `exp(−dy·0.01)`, clamped to one ×1.5 step per event, with lines ×16. Safari `gesture*` events are prevented and zoom by the scale ratio. Zoom is instant, with no easing.
   - Badges carry `t0`, `t1`, `firstHiddenId` and a ≥24×24 `box`, and they win the hit test. A badge click zooms to its span (at least one step); at 200 px/s it selects the first hidden cue.
   - `labelPlacement()` places the end label in §8's order. Badges and the pad always win; the window label applies in the ruler.
   - `revealView(t)` implements the seek-scroll rule for scrub-bar seeks and Back to start. `dropAt` and `showDrop` serve the library drag.
8. **Scrub overview** (`timeline/scrub-overview.ts`). An `aria-hidden` 12 px canvas behind a `.scrub-range` input. It redraws through rAF only on input changes, uses `CANVAS_RESOLUTION`, and redraws on `contextrestored`.
9. **Library drag.** Fine pointers only, with a 4 px threshold. Listeners are on `window`; Escape cancels and so does a release off the box. A drop makes the item active, then adds through the page's `addCue(t, 0.5, snap=false)`, then focuses the timeline. A blocked drop shows the short label while dragging and announces the full sentence.
10. **Show JSON.**
    - `features/show/shared/show-json.ts` is the only new show entry: one `JSON.parse(text)`, then `openShow(parsed)`. The ledger pins both calls, plus `parseShowJson`'s single caller, with four new negative controls.
    - The text is `saveDocumentOf(sent)`. It was extracted from `ShowSaveFlow.save`, and the pinned `normalizeShow(sent.show)` is unchanged.
    - `ShowBuilderStore.applyJson` asks over a dirty show (`pending.kind 'json'`). `applyShow` is one `edit()`, which pushes onto Undo and clears Redo. It resets `nextCueId`, selection and Fit, falls back the active shell, and clears `dirty` and `saved`. It never writes `source`.
    - Notes use `showFieldLabel`, cap at 5 reasons, and drop the embedded `sky` with its own sentence. `CUE_FIELD_LABELS` moved to `engine/model/labels.ts`. A spec bans a bare `fieldLabel` import under `features/show`, except in `show-copy.ts`.
11. **Coordinator add-on.** `fireworks-stage.ts` `fail()` sets `warmUpState` to `off`.

## Deviations (for Rosalina and Peach)
- **B4 on sr-only regions:** a *different* message is set at once. Only an identical repeat goes `''`, then the text after 100 ms. Screen readers announce any text change, so this re-announces exactly the repeats and keeps every existing announcement spec immediate.
- **Show JSON Copy copies the document** even when the textarea holds unapplied edits. **Superseded in part by Rosalina's ruling 2 (rejected) on 2026-11-15, fixed in `bowser-phase7-review-fixes.md`:** Copy writes `jsonValue()`, the textarea text, edits included. §9.1 says "Copy copies the document". When the clipboard is blocked, the textarea is selected.
- **Closing the disclosure drops unapplied edits and the note**, because its text exists only while it's open.
- **Wheel *scroll*** (not zoom) still doesn't stop Follow, as before. A one-finger pan does. **Superseded in part by Rosalina's ruling 3 (rejected) on 2026-11-15, fixed in `bowser-phase7-review-fixes.md`:** a plain wheel scroll goes through `emitManual` and stops Follow.
- **The designer's Shell JSON Copy-twice** isn't re-announced. B4 lists only Show JSON. That's a carry for C2 to decide. **Superseded in part by Rosalina's ruling 4 (rejected) on 2026-11-15, fixed in `bowser-phase7-review-fixes.md`:** the designer's Shell JSON note is keyed by `seq` and re-announces.
- **The badge hit box** uses a text-width estimate (0.62 em per character), not `measureText`, so the layout stays pure. It's still at least 24×24.

## Why
Each item follows phase-7.md. Where it says "Luigi decides" (re-announce mechanism, skip-link mechanics), the choice is the smallest one that keeps the DOM order and the existing specs.

## Evidence
- Suite: **1615 tests** (1526 at start, 89 new). In the full run, 3 failed by timeout at load average 17 (6c.3 again, plus the 5 s Done-when route spec and one `timeline-driver` checkpoint spec, which Yoshi is editing). All 84 in those files pass on rerun. Typecheck: 0 errors. `ng build` is clean. Prettier is clean. The built `index.html` has no `<style>`.
- **Mutants** (copied tree `scratchpad/mutroot`, repo layout with `schema`, unchanged baseline first; scope per the coordinator: the Show JSON entry, guards, save and source; script `scratchpad/luigi-b3-mutate.py`, log `luigi-b3-mut.log`). 14 killed:
  - Show JSON skips upgrade; casts the paste; shell paste not detected; reasons uncapped.
  - Apply clears history; Apply leaves dirty; Apply writes `source`; Apply over dirty never asks.
  - Text not the save document. This first **survived**, because the spec used `saveDocumentOf` as its own oracle. It now compares against `normalizeShow` directly.
  - Two choices save anyway; no save bar still prevented; ⌘S skips the field commit; failed stage keeps warm-up state.
  - Two first attempts didn't compile and weren't counted.
- **UI items** have normal specs, each with one in-spec negative control. Those cover the R4 rule, the unlayered coarse block, the label placement against the pre-Phase-7 rule, the bare `fieldLabel` ban, and a plain signal repeat.
- **Touch sanity** (one Chromium run on 4200, 390×844, isMobile, hasTouch, DPR 3; `scratchpad/pw/luigi-touch.mjs`):
  - Every visible `.btn` is at least 44×44 with `manipulation`, and fields are 16 px with min-height 44, on `/` and `/show`. This passed after the unlayering fix; before it, Library buttons computed `min-width: 0` and the designer textarea was 11 px.
  - The stage, lane and overview canvases are at 1.5.
  - Play and time are on line 1; scrub and zoom on line 2. The status line is visible and Duplicate is hidden.
  - A CDP two-finger spread changed `view.pxPerSecond`. No page errors.
- **CSP re-check with the real header: not run**, per the coordinator (Mario runs it at the gate). The new surfaces add no inline script and no HTML sink: `unsafe-sinks.spec.ts` is green with no new allowance, and the textarea binds `[value]`.

## Boundary
- **Rosalina (C2):** the deviations above; the narrow dock and touch sizes; the overview look.
- **Toad (C3):** the two-engine Show JSON round trip (the in-spec half is `show-builder-page.phase7.spec.ts` 7k.3); the tab-walk; WebKit `gesturechange`.
- **Mario (gate):** the three-engine CSP re-check and the touch smoke on the image.
- **Yoshi:** `timeline-driver.ts` and its spec are untouched by me (his D1 fix).

# Rosalina — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** The dark token set, designer layout (2c), save, share and player UX (Phase 5), the timeline UX (Phase 6), and accessibility and photosensitivity (Phase 7, gated on 2026-11-15). Open: the daily Firefox and WebKit run (to be defined in the post-Phase-7 interlude).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 to Phase 4 (summarized 2026-11-14)

- **Accepted rulings:** `/` auto-plays bursts (the prototype default is `loop`, so strobe comes from presets, Auto show, restored drafts and links). The photosensitivity notice and Reduce flashing ship with the designer (2c) and the player (Phase 5). The draft keeps display and the active tab. Dirty is a flag, and only shell and sky changes count (replace-only). The notice holds playback. Reduced motion opens in Manual on every load.
- **2c spec:** `docs/fireworks-app/design/designer-2c.md` (layout, copy, tokens, 15 departures). Record `rosalina-designer-2c-design-review.md` is partly superseded by `luigi-2c-dirty-flag-and-notice-hold.md`. Re-read every confirmation body when a ruling changes what an action touches.
- **Tokens:** semantic names are shipped in `src/web/fireworks-web/src/styles.css`: `success-surface`, `danger-surface` (+ on-), `border-control` #56627f (3.1:1), `text-heading`, `text-body`, `text-small`, `text-caption`. Don't hard-code colors.
- **DOM order:** stays panel-first. Reach the visitor with `aria-describedby` and focus, never a CSS reorder (WCAG 1.3.2 and 2.4.3). Check the oracle's DOM order before writing "read before X". The prototype's Space handler excludes only INPUT, TEXTAREA and SELECT. Tailwind `max-[761px]` gives the inclusive 760 breakpoint.
- **Dialog and hold patterns:** an alertdialog's initial focus goes on the safe button. Native `<dialog>` with `showModal()` gives the focus trap and Escape. OS-derived values are never edits and never persisted. A hold notice needs every launch path listed, frozen timers, and mode-aware "starts when" copy.
- **Save-time copy (F10):** 400 (`truncated` means there are more), 403 (writes switched off mid-session), 404 on Update original (offer Save as new), 413 (may be status 0 through Railway), 429 and the upgrade error. Clients key on status plus `code`. Save as new after a deleted original is a plain create, with no promise of a link to the original.
- **Last-write-wins** on Update original until `If-Match` → 412 (at Phase 8, or the first reported lost update).

### Folded from Phase 5 and Phase 6 (summarized 2026-11-15)

- **Phase 5 (`design/phase-5.md`, `rosalina-phase-5-design-review.md`):** F4 ruling: Save clears both dirty flags, and a separate `saved` flag drives the indicator; walk each action through each meaning of a flag. `session.canWrite()` is false while `api/me` is in flight, so "unavailable" UI waits for `status() === 'ready'`. A `disabled` button drops focus: use `aria-disabled` and ignore clicks. A PUT 404 asks; a remix 404 falls back to POST by itself.
- **Phase 5 rulings (Skyler, 2026-11-14):** player Remix shows whatever `canWrite` is; "Remixed from" renders nowhere before Phase 8; one notice dismissal and one Reduce flashing choice per device; a link load keeps `display`. The C17 banner copy (`TEST_MODE_TEXT`) must keep "change or delete any saved", which `designer-save.spec.ts` matches. C3 isolation: `<bdi>` around the name only; FSI and PDI inside the `quoted()` helpers for TS strings.
- **Phase 5 review gaps:** `/mine` h1 focus on load; a blocked-share `select()` without `focus()`; a named ARIA state needs a style (`.btn[aria-disabled]`); a centered "Reduce flashing is on." line can be false.
- **Phase 6 (`design/phase-6.md`, `rosalina-phase-6-design-review.md`):** route `/show`. Facts: `simulation.ts` `launch` bursts at `tx` and jitters the launch point, so cue `x` is "Position (where it bursts)"; rise is `sqrt(2·bh·760/g)`. Invariant: the builder stage equals a run from step 0 at the playhead, so adds round up to 0.1 s, there is no audition, and edits re-seek. `/c/` copy stays kind-neutral until the GET answers.
- **Phase 6 review (`rosalina-phase6-post-implementation-review.md`):** must-fix B1 (no API banner in the builder), B2 (Undo and Redo `disabled` focus drop) and B3 (notice focus). Pattern checks: a live region bound to an unchanged signal never re-announces an identical string; any ⌘Z can disable a focused button. Flash spacing is 41 steps; the ended line keeps curly quotes `“{name}” has ended.`
- **Phase 6 rulings (2026-11-15):** the API banner follows `api/me` as well as `/health/live`; ⌘Z on select, range and checkbox controls stays with the control. Library drag, pinch zoom, the `+k` badge, the scrub overview and Show JSON moved to Phase 7 and are built there.

## Learnings


### 2026-11-15: Phase 7 design-review (A2: accessibility, reduced motion, touch)
- Wrote `docs/fireworks-app/design/phase-7.md`. Record: `records/rosalina-phase-7-design-review.md`. New skill: `.squad/skills/focus-never-drops/SKILL.md`.
- Rulings:
  - Mobile = `(pointer: coarse)`; DPR `min(dpr, coarse ? 1.5 : 2)` on the stage and both timeline canvases.
  - Touch targets are 44px under coarse only, with 16px field text (iOS focus zoom).
  - ⌘S saves only while the save bar renders. With two choices it focuses `Update original`. The builder commits the focused number field first.
  - `aria-disabled` now looks unavailable by default; `.btn-busy` keeps the in-flight look.
- Code facts worth remembering:
  - `styles.css` gave `aria-disabled` only `cursor-progress`, so Undo with no history looked enabled.
  - Ctrl+wheel zoom is one ×1.5 step per event, which makes trackpad pinch explode. Safari sends `gesturechange` instead.
  - Pixi sets `touch-action: none` on its canvas.
  - The stage failure copy says "shell" on every surface.
  - `fieldLabel` still returns raw show paths. `showFieldLabel` in `show-copy.ts` is the right one for Apply notes.
- Eight more focus drops found by reading every `[disabled]` and every `@if` that wraps a button (K1–K8). Do that sweep on every review.
- Layout rule applied again: to rearrange at narrow widths without CSS `order`, insert a `basis-full h-0` line-break element in a `flex-wrap` row.
- Open for Skyler: Q1 (Apply is an Undo step, recommended yes), Q2 (⌘S with two choices).

### 2026-11-15: Phase 7 C2 post-implementation review
- Conditional pass. Wrote phase-7.md §15 and record `rosalina-phase7-post-implementation-review.md`. Rejected three deviations: Show JSON Copy has to copy the textarea text, as the designer's `json-panel.ts` does; wheel scroll has to stop Follow (phase-6.md §5.1); the designer's JSON note needs the B4 re-announce. Accepted the warm-up caps (12 ms idle, 6 ms playing).
- Specificity trap: `input[type='range']::-webkit-slider-thumb` is (0,1,2) and beats `.scrub-range::-webkit-slider-thumb` (0,1,1) in the same unlayered block. On touch, a generic element+attribute rule silently overrides a single-class rule. Only a real-browser screenshot caught it (390×844, Chrome channel; `scratchpad/pw/ros-c2.mjs` needs `channel: 'chrome'`, because the bundled headless shell isn't installed).
- A `summary` styled `display:flex` (`.section-heading`) loses its disclosure marker. Whenever I tell a `summary` to use a heading style, specify an explicit indicator.
- Focus-sweep miss: buttons that disappear while their own async load runs (Library `Try again` and `Show more` → `status: 'loading'`). Add "async state replaces the button" to the sweep, next to `[disabled]` and `@if`.
- Plurals in templated copy: write the k=1 form in the spec (`; and 1 more problem`).

### 2026-11-15: Phase 7 fix-round sign-off (7g.25)
- Signed off Bowser's C2 fixes (addendum in `rosalina-phase7-post-implementation-review.md`). Accepted K9's settle guard: move focus only if it's still on the pressed button or on `body`.
- My own spec caused a touch defect. The root font is 13px, so Tailwind rem spacing (`min-h-11`, `size-11`, `gap-2`) comes out at 35.75px and 6.5px. In this project, always spec touch sizes as raw px (`min-h-[44px]`, `gap-[8px]`). phase-7.md §5.2 now says so.
- For reduced motion, spec the behavior ("no transition runs") rather than a computed value. `transition-none` leaves the duration at 0.15s.

### 2026-11-15 — Phase 7 post-gate cross-agent update (Scribe)

- **Your §5.2 touch sizes caused the 13 px defect, and you corrected the spec.** `phase-7.md` §5.2 names raw px now. Bowser's px fix matches it. Mario's gate: `gate-touch` 18/18, with 13 negative controls failing.
- **Your C2 rulings are in code.** Copy copies the textarea; the wheel scroll stops Follow; the designer note re-announces. C2-1 to C2-4 are verified on the image. The K9 settle guard is in §3.2.
- **Your 10 s is canonical.** It supersedes Yoshi's 5000 ms (Yoshi's record is marked in place).
- **Carried for you:** the keyboard, reduced-motion and touch checks ran in Chromium at the gate. Their Firefox and WebKit runs are the daily run, not a gate criterion.

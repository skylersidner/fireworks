# Rosalina — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** The dark token set taken from the prototype's CSS variables, designer layout and controls (Phase 2c), save, share and player UX (Phase 5), the timeline UX (Phase 6), and accessibility and photosensitivity (Phase 7).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- The landing route `/` auto-plays bursts, including strobe (prototype default mode is `loop`). At the 2c design-review, decide whether the photosensitivity notice and reduced-motion handling move earlier than Phase 7.

### 2026-11-12 — Phase 1 cross-agent update (Scribe)
- Luigi's Phase 1 skeleton has placeholder colors that are not in the prototype, in `src/web/fireworks-web/src/styles.css`: `--color-success` (#7ddc9f), `--color-toast-success` (#12301f), `--color-on-toast-success` (#c9f2d7), `--color-toast-error` (#3a1414), `--color-on-toast-error` (#ffd2ca). Review them before 2c components depend on them. `--color-danger` (#ff9a8a) maps to the prototype's `#err`.
- The semantic token names (`surface-*`, `border*`, `text-*`, `accent*`, `scrim`) are shipped. Renaming is cheap now and costlier after 2c.

### 2026-11-12 — Phase 2c design-review (facilitated)
- Wrote `docs/fireworks-app/design/designer-2c.md`: layout, component inventory + copy, final tokens, range-row/select-row specs, accessibility, 15 numbered departures. Record: `.squad/decisions/records/rosalina-designer-2c-design-review.md`. Skill: `.squad/skills/flashing-content-safety/SKILL.md`.
- Check the premise against the oracle: the brief said `/` auto-plays strobe on arrival, but the default shell is Peony (no effect) and loop fires only the current shell, one flash per ~4.65 s. Strobe comes from presets, Auto show, restored drafts, links.
- Tokens: kept Luigi's names; renamed toast-* to success-surface/danger-surface (+ on-); added border-control #56627f (3.1:1; --line is 1.34:1 on panel); added text-heading/body/small/caption. Contrast script approach: quick Python WCAG luminance calc in scratchpad.
- API-down: blocking modal replaced by a non-blocking panel banner; `api/me` self-handled. Reason: plan §3.4 anonymous play never needs the server.
- Prototype bug worth remembering: Space handler excludes only INPUT/TEXTAREA/SELECT, so Space on a focused button fires Launch. Tailwind 4 `max-[X]` is `width < X`; the prototype's 760 breakpoint is inclusive, so use `max-[761px]`.
- Plan 2c has a contradictory "Shared form controls (ControlValueAccessors)" line vs OQ17 Signal Forms.
- Open for Skyler: whether `/` auto-plays at all (recommended yes, with notice + reduced-motion -> Manual); player notice in Phase 5 instead of 7.

### 2026-11-12 — 2c follow-up after Skyler's rulings
- Skyler accepted: `/` auto-plays; the player notice and Reduce flashing ship in Phase 5; the draft keeps display settings and the active tab; a preset or Apply over unsaved edits asks first. "Unsaved" means any change to the shell, display or tab against a baseline snapshot (last preset, Apply or first-visit default), and the baseline survives reload. Reduced motion opens in Manual on every load.
- Spec edited in place (Skyler wants no superseded footnotes): §6.4 replace confirmation, §3.6 adjustment note, §3.8 Canvas-only renderer note, §7.1 tri-state Reduce flashing. Record addendum is in `rosalina-designer-2c-design-review.md`.
- Patterns:
  - Confirmation copy must say what *isn't* replaced when the "dirty" definition is wider than what the action destroys.
  - An alertdialog's initial focus goes on the safe button, with no dialog-wide Enter.
  - Native `<dialog>` + `showModal()` gives the focus trap, Escape and an inert page.
  - OS-derived values are never edits and never persisted.
- Normalize kinds: count clamped, rounded and truncated (one per distinct path); dropped gets its own "ignored" sentence; defaulted stays silent.
- Peach's acceptance doc is `docs/fireworks-app/acceptance/phase-2.md`. 2c.16 still says display and tab don't count, which conflicts with Skyler's ruling.

### 2026-11-13 — 2c update: dirty flag, notice holds playback
- Skyler replaced the baseline snapshot with a dirty flag (the draft exists so state is never lost), and chose to have the first-visit notice hold playback, against my recommendation. Spec edited in place; record addendum items 9–12.
- Presets keep the sky, which is parity: the prototype's gravity and wind are globals. So the old preset confirm ("including its breaks and sky") was false. When a ruling changes what an action touches, re-read every confirmation body.
- With a flag (not a diff), think through the first-time path: the notice's "Turn on Reduce flashing" must not set dirty, or a first preset click asks about an untouched Peony.
- A hold notice needs: a list of every launch path, frozen timers (no burst backlog), mode-aware "starts when" copy, no × or Escape, and focus to the first button and then to Launch.
- Accepted Luigi's `cancel` + `close` Escape handling (Chrome's close-watcher skips `cancel`). Peach's acceptance 2c.9, 2c.16 and 2c.18 still describe the baseline and the non-pausing notice.

### 2026-11-13 — 2c check: notice DOM order
- My §7.2 line "notice read before the panel" was wrong against the oracle (prototype is panel, then stage) and led Luigi to reorder the DOM with `flex-row-reverse`. Ruled: keep panel-first DOM (h1 first, Tab order = visual order); reach the visitor through the initial focus move, `aria-describedby` on the notice buttons, and a swapped playback note ("Close the flashing notice on the stage to start.").
- Lesson: never ask for "read before X" in a spec without checking the oracle's DOM order; a CSS-order fix for reading order breaks WCAG 1.3.2/2.4.3. A focused button in a region doesn't read the region's body text; use aria-describedby.
- Confirmed Luigi: the Display switch swaps the notice copy but doesn't dismiss; notice focus only from body; Launch focused after render on dismiss.

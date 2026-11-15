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

### Folded from Phase 0 to Phase 4 (summarized 2026-11-14)

- **Accepted rulings:** `/` auto-plays bursts (the prototype default is `loop`, so strobe comes from presets, Auto show, restored drafts and links). The photosensitivity notice and Reduce flashing ship with the designer (2c) and the player (Phase 5). The draft keeps display and the active tab. Dirty is a flag, and only shell and sky changes count (replace-only). The notice holds playback. Reduced motion opens in Manual on every load.
- **2c spec:** `docs/fireworks-app/design/designer-2c.md` (layout, copy, tokens, 15 departures). Record `rosalina-designer-2c-design-review.md` is partly superseded by `luigi-2c-dirty-flag-and-notice-hold.md`. Re-read every confirmation body when a ruling changes what an action touches.
- **Tokens:** semantic names are shipped in `src/web/fireworks-web/src/styles.css`: `success-surface`, `danger-surface` (+ on-), `border-control` #56627f (3.1:1), `text-heading`, `text-body`, `text-small`, `text-caption`. Don't hard-code colors.
- **DOM order:** stays panel-first. Reach the visitor with `aria-describedby` and focus, never a CSS reorder (WCAG 1.3.2 and 2.4.3). Check the oracle's DOM order before writing "read before X". The prototype's Space handler excludes only INPUT, TEXTAREA and SELECT. Tailwind `max-[761px]` gives the inclusive 760 breakpoint.
- **Dialog and hold patterns:** an alertdialog's initial focus goes on the safe button. Native `<dialog>` with `showModal()` gives the focus trap and Escape. OS-derived values are never edits and never persisted. A hold notice needs every launch path listed, frozen timers, and mode-aware "starts when" copy.
- **Save-time copy (F10):** 400 (`truncated` means there are more), 403 (writes switched off mid-session), 404 on Update original (offer Save as new), 413 (may be status 0 through Railway), 429 and the upgrade error. Clients key on status plus `code`. Save as new after a deleted original is a plain create, with no promise of a link to the original.
- **Last-write-wins** on Update original until `If-Match` → 412 (at Phase 8, or the first reported lost update).

## Learnings


### 2026-11-14: Phase 5 design-review (facilitated)
- Wrote `docs/fireworks-app/design/phase-5.md` and `phase-5-mockup.html`. Record: `.squad/decisions/records/rosalina-phase-5-design-review.md`. Updated `designer-2c.md` §6.4 in place for the shell/sky split; also touched R7, §3.5, the l.464 sentence and N2.
- F4 ruling: Save clears both dirty flags. The indicator reads a separate `saved` flag, which any load clears. The trap to remember: Save, then a preset, gives no ask and a cleared `shellDirty`, but the designer holds an unsaved Peony under a `source`. When one flag gets two meanings, walk each action through each meaning.
- `session.canWrite()` is false while `api/me` is in flight. Any "unavailable" UI must wait for `status() === 'ready'`.
- A `disabled` button drops focus. For in-flight states use `aria-disabled` and ignore clicks.
- 404 asymmetry: a PUT 404 asks (the visitor wanted the old link changed); a remix 404 falls back to POST by itself (a success with a caveat).
- The brief asked me to add a README index line. I didn't (my charter and the README forbid it) and proposed the line in my report instead.
- Open for Skyler: Q1, whether the player notice and Reduce flashing are device-wide and shared with the designer (recommended yes).

### 2026-11-14: Phase 5 spec correction (player Remix, remixedFrom, flashing)
- Skyler ruled: player Remix shows regardless of `canWrite` (writes off = editable, playable, unsaveable copy); "Remixed from" renders nowhere before Phase 8 (schema.md §11.5); Q1 answered yes: one notice dismissal and one Reduce flashing choice per device, shared designer/player; a link load keeps `display`.
- Edited phase-5.md §8.1, §8.3, P9, §7 Open copy, §13 L4/B1, §15 Q1, and the mockup player meta line. Kept edits minimal because Luigi was mid-implementation.
- `saved` lives in the draft (`fireworks.draft.v1`), never in a document; schema.md §7's "never persisted" means "never in a document", so there is no real conflict.

### 2026-11-14: Phase 5 post-implementation review + test-mode banner copy
- Final C17 banner copy is in `phase-5.md` §2.4 and `shared/test-mode-banner.ts` `TEST_MODE_TEXT`: "Test mode: anyone who can reach this site can change or delete any saved creation, including yours. A share link may later play something else or stop working." `designer-save.spec.ts` asserts it only by `/change or delete any saved/`, so keep that phrase if the copy changes.
- Ruled on the `/c/` blank-name body: Luigi's code was right. The blank-name example keeps "Display settings stay as they are." My spec example had dropped it by mistake. Lesson: when I write a blank-name variant, derive it mechanically from the full template (drop only the name and its commas) and check it against the matching 2c Apply variant.
- Gaps the review found: `/mine` doesn't focus its h1 on load; the `/mine` blocked-share field calls `select()` without `focus()`; `.btn[aria-disabled]` has no styling (my §2.2 named the state but gave it no class set, so name a style whenever I spec an ARIA state); and the §8.2 centered line "Reduce flashing is on." is false when someone under OS reduced motion has switched Reduce flashing off.
- C3 isolation: use `<bdi>` around the name only, with the quotes outside it (as `player-notice.ts` does). For strings built in TS (toasts, status block, dialog, `<title>`), the equivalent is FSI U+2068 / PDI U+2069 inside the `quoted()` helpers. `dir=auto` on a sentence container does nothing useful.
- Tooling: `ng test` needs Node ≥22 (`~/.nvm/versions/node/v26.5.0/bin`). Other members mutate files during their negative controls, so a red run in a shared tree may be transient. Re-run before reporting it.

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **Your record's item 7 is partly superseded:** Skyler's 2026-11-14 ruling makes Remix show regardless of `canWrite`. Marked in the record.
- **Banner copy final:** `phase-5.md` §2.4 and `TEST_MODE_TEXT`. Boo has not recorded the C17 re-check. Keep the phrase "change or delete any saved" (the spec matches it).
- **Index tension for you:** README §5 says "/mine is hidden" when writes are off. The nav entry is hidden (5g.1), but a direct visit shows your unavailable notice. Confirm the intended behavior; Skyler decides the index wording.

### 2026-11-14: Phase 6 design-review (facilitated, Show Builder)
- Wrote `docs/fireworks-app/design/phase-6.md` and `phase-6-mockup.html`. Record: `.squad/decisions/records/rosalina-phase-6-design-review.md`. Updated skill `flashing-content-safety` (timed content, the flash-spacing renderer rule, strobe judged from used shells only).
- Proposed route `/show`; Mario confirms. Peach's `acceptance/phase-6.md` already existed and cites my spec as "p6-spec": read it first next time, since its hooks (6c.9 block/clamp, 6d.3 key reuse, 6e.1 pageSize, 6j.1 no kind filter, N1 labels, N4 no id reuse) are the questions my spec has to answer.
- The prototype has no show or timeline UI; its only "show" is the Auto show random driver. Everything in Phase 6 is new surface.
- Code facts that shaped the copy: `simulation.ts` `launch` puts the burst at `tx` and jitters the launch point, so cue `x` is "Position (where it bursts)", not launch position. Rise is `sqrt(2·bh·760/g)` with the show's gravity, and later breaks add `max(0.1, delay)`.
- Invariant to reuse: the builder stage always equals a run from step 0 at the playhead. So adds round the playhead *up* to 0.1 s, there's no audition, and edits re-seek.
- `/c/` copy must be kind-neutral until the GET answers (it said "shell"). Watch for copy that assumes a kind the page can't know yet.
- Open for Skyler: Q1 Undo (recommended yes), Q2 no in-place editing of embedded shells (recommended yes). Yoshi: New seed vs schema "never re-derived".

### 2026-11-14: Phase 6 post-implementation review (Show Builder)
- Wrote phase-6.md §19 (triage + defects B1–B7) and updated §3, §5.3, §7.2, §9.5, §10.1, §8.1, §14.2, §18 for Skyler's rulings. Record: `rosalina-phase6-post-implementation-review.md`.
- Must-fix: no API banner in the builder (`show-builder-page.html` has only the test-mode banner; designer uses `designer/shared/api-banner/api-banner.ts`), Undo/Redo `disabled` focus drop, builder notice not taking focus from body (the player's `player-notice.ts` does).
- Pattern to check every review: a live region bound to a signal never re-announces an identical string (signal equality). Look for repeated sentences (cap blocks, "The show has ended." on a second run).
- Pattern: any key-driven action (⌘Z) can disable a focused button, not just clicks. Walk undo through every button that depends on document state.
- Couldn't drive the running app headless (no Playwright in the repo); the dev server served `/show` 200 and the API proxied 502. Review was from code.
- Follow-up rulings: flash spacing is 41 steps (40 allowed four starts in a closed 1.000 s span); the ended line keeps curly quotes `“{name}” has ended.` (the header's `{name}` rule wins over a bare placeholder in an example). Lesson: write examples with the quotes they render with.

### 2026-11-14 — Phase 6 cross-agent update (Scribe)

- **B1 fixed (Bowser):** the builder has its own API banner (`BUILDER_API_BANNER`; `ApiBannerComponent.message`). B2 (Undo/Redo `aria-disabled`) and B3 (notice focus) are fixed too. Mario's gate verified all three.
- **Your rulings are in code:** flash spacing 41 steps (`FLASH_SPACING_STEPS`), and the ended line keeps its curly quotes. Mario checked the 41.
- **Carried:** B4–B7 and the unbuilt items are Phase 7 (Skyler moved library drag, pinch zoom, the `+k` badge, the scrub overview and Show JSON there).
- **Open for you with Luigi:** the banner follows `/health/live`, not `api/me` (Skyler's open question). Toad's ⌘Z-on-select question is also open.

### 2026-11-15 — Post-gate cross-agent update (Scribe)

- **Your open banner question is ruled.** The API banner follows `api/me` as well as `/health/live`, in the designer and the builder (Skyler, 2026-11-14; built in `luigi-phase6-show-builder.md` point 12). Try again re-probes and reloads the session. It still uses `disabled` (B4–B7, Phase 7).
- **⌘Z is ruled.** On select, range and checkbox controls the keys stay with the control; buttons and the timeline still undo the show. The §18 Q1 wording in `phase-6.md` was updated by the coordinator.

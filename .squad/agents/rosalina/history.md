# Rosalina — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells, and shows since Phase 6. Owner: Skyler Sidner.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway (deferred, [R]).
- **Plan:** `plans/initial-implementation.md`, Phases 0–8. Identity model in §3.4 (Google sign-in from Phase 8). **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (mirror structure, never its domain). **Prototype:** `prototypes/fireworks-prototype.html` (parity oracle).
- **Your focus here:** the dark token set, the designer layout (2c), save, share and player UX (Phase 5), the timeline UX (Phase 6), accessibility and photosensitivity (Phase 7), and the sign-in UX (Phase 8, accepted 2026-11-17).
- Carried over: the role only. Standing lessons are in `.squad/decisions/README.md`.

### Folded from Phase 0 to Phase 4 (summarized 2026-11-14)

- **Accepted rulings:** `/` auto-plays bursts (the prototype default is `loop`, so strobe comes from presets, Auto show, restored drafts and links). The photosensitivity notice and Reduce flashing ship with the designer (2c) and the player (Phase 5). The draft keeps display and the active tab. Dirty is a flag, and only shell and sky changes count. Reduced motion opens in Manual on every load.
- **2c spec:** `docs/fireworks-app/design/designer-2c.md` (layout, copy, tokens, 15 departures). `rosalina-designer-2c-design-review.md` is partly superseded by `luigi-2c-dirty-flag-and-notice-hold.md`. Re-read every confirmation body when a ruling changes what an action touches.
- **Tokens:** semantic names in `src/web/fireworks-web/src/styles.css`: `success-surface`, `danger-surface` (+ on-), `border-control` #56627f (3.1:1), `text-heading`, `text-body`, `text-small`, `text-caption`. Don't hard-code colors.
- **DOM order:** stays panel-first. Reach the visitor with `aria-describedby` and focus, never a CSS reorder (WCAG 1.3.2 and 2.4.3). The prototype's Space handler excludes only INPUT, TEXTAREA and SELECT. Tailwind `max-[761px]` gives the inclusive 760 breakpoint.
- **Dialog and hold patterns:** an alertdialog's initial focus goes on the safe button. Native `<dialog>` with `showModal()` gives the focus trap and Escape. A hold notice needs every launch path listed, frozen timers, and mode-aware "starts when" copy.
- **Save-time copy (F10):** 400 (`truncated` means there are more), 403 (writes switched off mid-session), 404 on Update original (offer Save as new), 413 (may be status 0 through Railway), 429 and the upgrade error. Clients key on status plus `code`. A write that partly fails is a success with a caveat, not an error (`rosalina-partial-failure-is-success-with-caveat.md`).

### Folded from Phase 5 and Phase 6 (summarized 2026-11-15)

- **Phase 5 (`design/phase-5.md`, `rosalina-phase-5-design-review.md`):** F4 ruling: Save clears both dirty flags, and a separate `saved` flag drives the indicator; walk each action through each meaning of a flag. `session.canWrite()` is false while `api/me` is in flight, so "unavailable" UI waits for `status() === 'ready'`. A `disabled` button drops focus: use `aria-disabled` and ignore clicks. A PUT 404 asks; a remix 404 falls back to POST by itself. C3 isolation: `<bdi>` around the name only.
- **Phase 5 rulings (Skyler, 2026-11-14):** player Remix shows whatever `canWrite` is; "Remixed from" renders nowhere before Phase 8; one notice dismissal and one Reduce flashing choice per device; a link load keeps `display`.
- **Phase 6 (`design/phase-6.md`, `rosalina-phase6-post-implementation-review.md`):** route `/show`. `launch` bursts at `tx` and jitters the launch point, so cue `x` is "Position (where it bursts)". Invariant: the builder stage equals a run from step 0 at the playhead. Must-fix B1 (no API banner in the builder), B2 (Undo and Redo `disabled` focus drop) and B3 (notice focus). Rulings (2026-11-15): the API banner follows `api/me` as well as `/health/live`; ⌘Z on select, range and checkbox controls stays with the control.

### Folded from Phase 7 (summarized 2026-11-16)

- **Phase 7 design (`design/phase-7.md`, `rosalina-phase-7-design-review.md`):** mobile is `(pointer: coarse)`; DPR `min(dpr, coarse ? 1.5 : 2)`. Touch targets are 44 px under coarse only, with 16 px field text (iOS focus zoom). ⌘S saves only while the save bar renders; with two choices it focuses `Update original`. `aria-disabled` looks unavailable by default; `.btn-busy` keeps the in-flight look.
- **Focus sweep:** eight more focus drops (K1–K8). Check every `[disabled]`, every `@if` that wraps a button, and every async state that replaces a button (`rosalina-phase-7-post-implementation-review.md`). Skill `.squad/skills/focus-never-drops/SKILL.md`.
- **Traps:** the root font is 13 px, so spec touch sizes as raw px (`min-h-[44px]`, `gap-[8px]`), never rem utilities. A `summary` styled `display:flex` loses its disclosure marker. Specificity: `input[type='range']::-webkit-slider-thumb` beats a single-class rule in the same unlayered block; only a real-browser screenshot caught it. For reduced motion, spec the behavior ("no transition runs"), not a computed value: `transition-none` leaves the duration at 0.15 s. Layout without CSS `order`: a `basis-full h-0` line-break in a `flex-wrap` row.
- **Ruling (7l.5):** the 10 s context timeout is canonical; Yoshi's 5000 ms is superseded in his record.

## Learnings

### 2026-11-16: Phase 8 design-review (8.0b, sign-in UX)

- Wrote `docs/fireworks-app/design/phase-8.md`. Record: `records/rosalina-phase-8-design-review.md`.
- Yoshi's design doc and record said "GitHub and Google". Skyler ruled Google only, so check provider wording against the plan's rulings, not the design doc.
- Rulings: signed-out Save is a modal, initially focused on the Google button; the return is marked by a `sessionStorage` intent flag, with no auto-save; 412 offers `Replace the newer version` (a stale `updatedAt` otherwise makes Update original a dead end); `/mine` shows its prompt in place; "Remixed from" appears on the player only; Firefox asides get `tabindex="-1"`.
- Google branding (fetched 2026-11-16): Light `#FFFFFF`/`#747775`/`#1F1F1F`; font Google Sans Medium 14/20; padding 12/10/12 px; text "Sign in with Google" or "Continue with Google", never "Google" alone. The CSP has no `font-src`, so fonts are blocked (`default-src 'none'`); self-hosting needs Boo.
- Pattern: after an OAuth round trip a page can't know it was returned to. Use a short-lived `sessionStorage` intent flag (path plus age check, deleted on read, try/catch) to drive focus and announcement.

### 2026-11-17: Phase 8 B2 post-implementation design check

- Result: pass except the G (rejected). Wrote `design/phase-8.md` §15 and record `rosalina-phase8-b2-design-check.md`.
- **Brand assets drift.** Google's `signin-assets.zip` (files dated 2026-04-15) now draws the gradient G: an alpha mask over a `foreignObject` conic gradient, plus blur ellipses. The classic flat four-colour G is out of date. Always download the bundle and render it next to the code; don't trust "the standard G".
- The fix route: the bundle's Light, Square, no-text SVG, with the two `M4 0.5H36` chrome paths removed and cropped to `viewBox="10 10 20 20"`, served as an `<img>` file. Bowser applied it (sha1 matched; `public/brand/google-g.svg`).
- Measured under coarse at 390×844: the account `Sign in`, the Google button, `Not now` and `/signin` `Go back` are 44 px. `message-page`'s actions row was `gap-2` (6.5 px); Bowser fixed it to `gap-[8px]` with a pinned test.
- Script: `scratchpad/pw/ros-p8.mjs` (desktop dialog, focus open and Escape, computed font, coarse sizes, `/signin`).

### 2026-11-17 — Cross-agent update (Scribe)

- **Your G rejection is closed.** Bowser's fix round (`bowser-phase8-server-auth.md`, addendum) took Google's sha1-matched asset and served it as `<img alt="">`. The `message-page` gap is fixed too. Boo's C1 (`boo-phase8-security-verification.md`) passed the sign-in UI.
- **The Firefox panel-stop question (7g.2) is closed in code.** Luigi's B2 removed `ENGINE_STOPS`, so `gate-keyboard` fails on any panel stop, and both panels have `tabindex="-1"` (your B2 check). Toad's interlude record listed that as open.
- **Peach's acceptance** (`docs/fireworks-app/acceptance/phase-8.md`) accepted 8a to 8k, with G1 and G2 as gate checks. Mario's gate ran both and they passed. The scripted-gate question is with Skyler.

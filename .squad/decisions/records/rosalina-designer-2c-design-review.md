# Designer 2c design-review rulings: tokens, API-down state, flashing safety
**By:** Rosalina (Designer), 2026-11-12. Full spec: `docs/fireworks-app/design/designer-2c.md`.

## What
1. **Tokens.** Luigi's Phase 1 semantic names in `src/web/fireworks-web/src/styles.css` are confirmed, except: `toast-success`/`toast-error` (and their `on-` pairs) are renamed `success-surface`, `danger-surface`, `on-success-surface`, `on-danger-surface` (values unchanged); `border-control` `#56627f` and `border-control-hover` `#6b7594` are added for text inputs, selects and the textarea; font-size tokens `text-heading` 15px, `text-body` 13px, `text-small` 12px, `text-caption` 11px are added. Firework colors are engine data (`engine/model/colors.ts`), never CSS tokens.
2. **API down is one non-blocking banner, not a modal plus a toast.** The `/health/live` modal is replaced by a `role="status"` banner in the designer panel. `GET api/me` becomes self-handled (no toast). The interceptor's generic toast never quotes a method or URL.
3. **Flashing safety starts in 2c, not Phase 7.** A viewer setting `quality.reduceFlashing` (default from `prefers-reduced-motion`, never saved with a shell) turns off strobe modulation, dims the burst flash (peak alpha 0.3, 100 px × size), softens glitter (floor 0.5), and widens Auto show gaps to at least 0.8 s. Under the OS reduced-motion setting the designer starts in Manual. A first-visit flashing notice sits on the stage.
4. **Space-to-launch ignores** buttons, links, tabs, switches, sliders, form fields, modifier keys and key repeat.

## Why
1. One token per role, not per component: the same fills serve toasts and banners. `#232b40` field edges are 1.34:1 on the panel, under WCAG 1.4.11's 3:1.
2. Plan §3.4: anonymous play never needs the server, so an outage must not cover the designer; and one outage should produce one message.
3. Strobe toggles at 7 Hz. The landing loop itself (Peony, one flash per ~4.65 s) is low risk, but strobe arrives via presets, Auto show, restored drafts and, from Phase 5, links. All the changes are renderer/driver visuals, so sim determinism is untouched.
4. In the prototype, Space on a focused button fires Launch instead of pressing the button.

## Boundary
- Item 3's rules live in `engine/render` and the Auto show driver only. They must never change the sim or its goldens; a flag flip that moves a golden is a bug.
- Item 3 covers the designer. The player (`/s/:code`) gets the same setting and its own notice in Phase 5 (recommended; Skyler to confirm as part of the open question on autoplay).
- Item 2 applies to the designer and player. A page that genuinely can't work without the API (none yet) may choose a blocking state, with its own design review.
- Whether `/` should auto-play at all is Skyler's call (raised as a question); this record assumes the recommended answer, auto-play kept.

## Addendum (2026-11-12): after Skyler's rulings
Skyler accepted auto-play on `/` and moved the player notice and its Reduce flashing control to Phase 5. He ruled that the draft keeps display settings and the active tab, that a preset or Apply over unsaved edits asks first, and that reduced motion opens in Manual on every load. The spec (`docs/fireworks-app/design/designer-2c.md` §3.6, §3.8, §6.4, §7.1) was edited in place to match. Added rulings:

### What
5. **Replace confirmation** is a shared in-page `confirm-dialog` on native `<dialog>` + `showModal()`, `role="alertdialog"`, never `window.confirm()`.
   - Initial focus goes to `Keep editing`. Enter activates the focused button only. Escape keeps editing. A backdrop click does nothing. Focus returns to the opener.
   - Copy names what's replaced and what isn't: "This replaces your current shell, “{name}”, including its breaks and sky… Display settings stay as they are."
   - An Apply that fails validation shows its error without asking.
   - The OS-forced Manual and an unchosen Reduce flashing never count as edits.
6. **Apply note:**
   - `clamped`, `rounded` and `truncated` count toward "Applied, with {n} value(s) adjusted: {labels}", one per distinct path.
   - `dropped` gets its own sentence: "{n} unknown field(s) was/were ignored: {keys}".
   - `defaulted` is never mentioned.
   - Names use row labels, at most 5 per sentence, then "and {k} more".
7. **Reduce flashing is a tri-state choice** (`unset` / `on` / `off`). The draft stores it only once the visitor has chosen. While it's `unset`, the effective value follows the OS live.
8. **Renderer fallback:** a muted stage note appears only for Canvas. Nothing for WebGPU or 8-bit trails.

### Why
5. An alertdialog's safe default must be the reversible action. Display settings count as edits but neither action changes them, so "your changes will be lost" would be false.
6. Defaults are how short JSON is written, so counting them buries the real adjustments. A dropped key is a different fact (it had no effect), so it gets different words. This follows `rosalina-partial-failure-is-success-with-caveat.md`.
7. Storing the unchosen effective value would freeze today's OS setting as a choice (Peach F8).
8. Tell visitors only what they can see and fix. WebGPU looks the same; Canvas looks worse and is usually fixable with hardware acceleration.

### Boundary
- `confirm-dialog` is reused by Phase 5 prompts. The Phase 5 design-review decides whether the "last load" baseline merges with the last-saved baseline.
- The Boundary line above that calls autoplay an open question is resolved: autoplay is kept.

## Addendum (2026-11-13): dirty flag and the notice hold
Skyler clarified the draft's purpose (state is never lost on leaving the sandbox) and replaced the baseline snapshot with a dirty flag. He also chose to have the flashing notice hold playback. The spec (§3.2, §3.5, §3.6, §6.2, §6.4, §7.1, §7.2, §8, §9, §10) was edited in place.

### What
9. **Dirty flag.** Set by any visitor change since the last load: shell, break and sky fields, add or remove a break, display settings, the break tab. Never set by the forced Manual, an OS-driven Reduce flashing, restoring the draft, JSON panel text, or the notice's `Turn on Reduce flashing`. Cleared by a preset load, a successful Apply and the first-visit default. It's a flag, not a diff. It's kept in `fireworks.draft.v1`. Presets and Apply confirm only when dirty.
10. **Confirm copy tracks the sky rule.** The preset body reads "…and its breaks, and goes back to Break 1. Sky and display settings stay as they are." Apply has two bodies, picked by whether the parsed JSON has a `sky` key.
11. **The notice holds playback.** While it shows: no loop or Auto show (timers frozen), no stage click or tap, no Space, `Launch` and `Replay last` disabled, and presets or Apply load without firing. The stage shows an empty sky with the skyline. The copy names when playback starts. The buttons are `Turn on Reduce flashing` (sets `on`, dismisses, starts) and `Continue`, with no × and no Escape. Focus goes to the first button if nothing has focus, then to `Launch` on dismiss.
12. **Luigi's departures accepted:** Escape is read from both `cancel` and `close` (single answer); rejection reasons name the break (`Pattern (Break 1) "spiral" isn't one of …`); the coarse-pointer hint is `Tap the sky to fire`.

### Why
9. Skyler ruled out the snapshot. The notice button is exempt because otherwise a first-time visitor's first preset click would ask about replacing a Peony they never touched.
10. A dialog that says the sky is replaced when it isn't is a false statement at the moment of decision.
11. An × or Escape would be a third, unlabeled way to start playback. Freezing the timers means nothing queues up to burst at once on dismiss.
12. Chrome's close-watcher can skip `cancel`, so `close` is the reliable signal. Naming the break tells the visitor where to look.

### Boundary
- Items 1–2 of `luigi-designer-2c.md` (baseline in the draft, value comparison) are superseded by item 9.
- Phase 5's saved-creation "unsaved changes" indicator is a separate question for its own design-review. 2c copy never calls dirty "unsaved".

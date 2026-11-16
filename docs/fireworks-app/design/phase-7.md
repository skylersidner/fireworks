# Phase 7: accessibility, reduced motion and touch (design-review notes)

**Date:** 2026-11-15 · **Ceremony:** design-review (Rosalina facilitating), before implementation · **Plan:** `plans/initial-implementation.md` §Phase 7, 7.1–7.3 batch A2, with Skyler's answers in 7.5 · **Record:** `.squad/decisions/records/rosalina-phase-7-design-review.md`

**Inputs, read in code:** every page under `features/**/pages` and `pages/`; `shared/fireworks-stage/*`; `engine/render/{pixi-renderer,visual-rules}.ts`; `engine/loop/drivers.ts`; `core/{browser,device-preferences}.ts`; `features/designer/shared/{api-banner,break-tabs,json-panel,playback-controls,save-bar}`; `features/show/pages/show-builder-page/*`; `features/show/shared/{timeline/timeline.ts,show-copy.ts}`; `engine/model/{labels,normalize}.ts`; `app.html` (toasts); `styles.css`; `index.html`.

**Scope (Skyler, 2026-11-15):** build my four Phase 6 deferrals (library drag, pinch zoom, the `+k` badge zoom, the scrub overview), the label-collision fix and Show JSON. No dense-flash warning and no multi-select. No fps-driven quality, but the mobile DPR cap ships. Railway stays deferred. Desktop-first stands (OQ10).

Peach writes `acceptance/phase-7.md` from this document. Every rule below that says **must** is meant to be testable, and §12 maps them to the 7.2 Done-when items.

---

## 1. Rulings (summary)

| # | Ruling | § |
|---|---|---|
| R1 | **Ctrl/⌘+S saves** on `/` and `/show`, but only while the save bar is rendered. With two choices it doesn't pick one: it moves focus to `Update original`. | 3.3 |
| R2 | **"Mobile" for the DPR cap means `(pointer: coarse)`.** Width plays no part. The resolution is `min(devicePixelRatio, coarse ? 1.5 : 2)` for the Pixi stage **and** for the timeline's 2D canvases (which today use the raw DPR). | 5.1 |
| R3 | **"Touch-friendly" means:** under `(pointer: coarse)`, every control has at least a 44×44 CSS px target, form text is 16px, and buttons use `touch-action: manipulation`. At 760px and narrower, the builder dock uses a two-row transport. | 5.2–5.4 |
| R4 | **`aria-disabled` gets two looks.** "Unavailable" (dimmed, `not-allowed`) is the default. "Busy" (`.btn-busy`: full look, `progress` cursor) is for in-flight states only. Today every `aria-disabled` button looks enabled. | 3.4 |
| R5 | **Focus never drops to `body`.** Eight more places drop it today (K1–K8). Each gets a named target. | 3.2 |
| R6 | **Reduced motion: verified, pass.** One non-canvas motion is left, the switch knob's 150 ms slide. It gets `motion-reduce:transition-none`. | 4 |
| R7 | **The scrub overview's view box is drawn but not draggable** (a departure from phase-6.md §5.2). A seek that lands outside the lane's view scrolls the lane to it. On touch, one finger pans the lane. | 7.3 |
| R8 | **The end label never covers a `+k` badge.** It tries the ruler first, then the lane foot, and otherwise isn't drawn. Badges always win. | 8 |
| R9 | **Show JSON is a closed disclosure at the end of the panel.** Its text exists only while it's open. Apply is one Undo step (Q1 for Skyler). | 9 |
| R10 | **Context loss:** playback holds. After 1 s a status line appears; after 10 s without a restore, a failure block with `Reload page`. Restoring removes either one with no other message. Both are per-surface copy. | 11 |

---

## 2. Already built: verified against the code

The plan marks these "verify only". All of them hold:

- **Reduce flashing follows the OS until chosen.** `reduceFlashing = choice ?? reducedMotion()` on all three surfaces: `shell-designer.store.ts:155`, `show-builder.store.ts:151` and `player-page.ts:219`. `mediaQuery()` is a live signal. Only an explicit choice is stored (`device-preferences.ts`, `fireworks.reduceFlashing.v1`).
- **Renderer rules.** `visual-rules.ts` keeps the strobe steady (`!reduceFlashing && E_STROBE`), draws the flash at alpha 0.3 and 100 px × size, and sets the glitter floor to 0.5. Crackle is unchanged.
- **Flash spacing is 41 steps.** `FLASH_SPACING_STEPS = 41`, and `pixi-renderer.ts:122` runs the gate only under Reduce flashing (reset otherwise). It applies wherever `render(…, reduceFlashing)` is called, which is all three surfaces through `fireworks-stage.ts:337`.
- **Auto show gap.** `RandomShowDriver` uses `REDUCED_SHOW_MIN_GAP` (0.8 s) under Reduce flashing (`drivers.ts:85`), and the gap updates live (`fireworks-stage.ts:219`).
- **Opening state under reduced motion.** The designer uses `forcedManual = untracked(reducedMotion)` on every load (never written back). The player uses `userPaused` and `showCenterPlay` from `untracked(reducedMotion)`, for shells and shows alike. The builder opens paused on every load, whatever the setting.

Nothing here needs rebuilding. §4 covers the one non-canvas leftover.

---

## 3. Keyboard access

### 3.1 Inventory, per page

"Reach" means it's in the Tab order or has a key. Rows marked **K** are defects (§3.2). Everything else passes in code today. Toad's Playwright tab-walk (Done-when 7) asserts each listed control is reachable and operable, that focus is visible, and that no step leaves `document.activeElement === body`.

**All pages: global.**

| Control | Reach | Notes |
|---|---|---|
| Toasts (`app.html`): `Dismiss notification` × | Tab (end of DOM) | **K7** |
| `:focus-visible` outline | — | `2px accent`, offset 2 (`styles.css`). It holds on `.btn-primary`, `.field`, `.switch`, range and the timeline container (offset −2). |

**`/`: designer.**

| Control | Reach | Notes |
|---|---|---|
| h1 row links: Show Builder, My creations | Tab | |
| API banner `Try again` | Tab | **K0** (`[disabled]`, §10) |
| Status block buttons, then the save bar (Save / Update original / Save as new, Share, the blocked share field) | Tab | Phase 5 rules hold (`moveFocusOffDisabled`). Ctrl/⌘+S is new (§3.3). |
| Playback: Launch, Replay last, Clear sky, Mode | Tab; Space = Launch | Launch and Replay are disabled only while the notice holds, and the notice has focus then. |
| Presets, shell fields, sky, display, Reduce flashing switch | Tab | Native |
| Breaks: `+ Add`, `− Remove`, tablist (roving tabindex, arrows, Home/End) | Tab, arrows | **K1** (`+ Add` at the 4th break) |
| Shell JSON: Revert, Copy, Apply, textarea | Tab | **K2** (Revert) |
| Flashing notice buttons | focus on load from `body`; Tab | |
| Confirm dialog | native `<dialog>` | |

**`/show`: Show Builder.**

| Control | Reach | Notes |
|---|---|---|
| **Skip link** `Skip to the timeline controls` | first Tab | **K8: missing.** The panel holds 40+ tab stops (10 presets, up to 24 of My shells, and so on) before Play. |
| h1 row links, banners, status, save bar | Tab | B5 (§10) |
| Show: New show, Name, Duration | Tab | B7 (§10) |
| Cue inspector: Shell, Launch time, Position, Own burst height, Burst height, New seed, Duplicate, Delete | Tab; Enter on the timeline focuses Launch time | Removing the selected cue removes the whole section (**K3**, via B5) |
| Library: item buttons (`aria-pressed`), `Remove` / `Remove…`, My shells, `Try again`, `Show more` | Tab | **K4** (Remove), B6 (§10) |
| Sky, Display | Tab | |
| Notice | focus from `body` | B3 fixed in Phase 6 |
| Transport: Play/Pause, Back to start, Playhead range, Zoom out / Fit / Zoom in | Tab; Space = Play/Pause | The zoom buttons already move focus to Fit when they disable. |
| Toolbar: Add cue, Duplicate, Delete, Undo, Redo | Tab; ⌘/Ctrl+Z, Shift+⌘/Ctrl+Z | **K5** (Duplicate and Delete use `[disabled]`). Undo and Redo look enabled when they aren't (R4). |
| Timeline | one tab stop; the phase-6.md §4.4 keys | Badges and the overview have no tab stop by design. Their keyboard equivalents are in §7. |
| Cue list (`details`) and its row buttons | Tab | |
| Stage marker | pointer only | The inspector rows are its equivalent (phase-6.md §8.2). |

**`/s/:code`: player (shell and show).** Remix, Pause/Play, Replay and the Reduce flashing switch are all reachable, as are the notice, the centered `Play` and the ended `Replay`. Space toggles Play/Pause. Every vanishing button already hands focus to `Pause` (`player-page.ts:284/297/320`). **Pass.**

**`/c/:code`.** The loading line and the message pages, whose `h1` takes focus on load (`message-page.ts`). Replace dialogs run on the target page. **Pass.**

**`/mine`.** Links, the `h1` focused on load and after paging, cards (Open, Play, Share, Delete), the share field, and paging (focus goes to the `h1`, so the `[disabled]` Previous/Next never strand it). **K6** (list-error `Try again`).

**`/status`.** One link, `Back to the designer`. **Pass.** It has no controls that change state.

**Not-found pages.** The message page, with the `h1` focused. **Pass.**

### 3.2 Focus defects and fixes

Rule (R5): when the focused control is disabled or removed by the visitor's own action, focus moves to the named target in the same render. "Disabled" counts both `disabled` and an element that leaves the DOM.

| # | Where | What happens today | Fix: focus goes to |
|---|---|---|---|
| K1 | `break-tabs.ts` `+ Add` at 3 → 4 breaks | `+ Add` disables under focus. 2c §8.1 said "focus stays on Add", which is right up to the 4th break and wrong on it. | The newly active tab, as after Remove. Only when Add has just disabled. Otherwise focus stays on Add (2c unchanged). |
| K2 | `json-panel.ts` `Revert` | Revert removes itself (`hasEdits` turns false). | The textarea. |
| K3 | Builder inspector, after ⌘Z or Redo removes or deselects the selected cue | The whole Cue section re-renders with no fields. | The timeline. Folded into B5's rule (§10). |
| K4 | Builder Library `Remove` (unused shell, no dialog) and `Remove…` → `Remove shell and cues` | The row is removed. The native `<dialog>` returns focus to an opener that no longer exists. | The next row's shell button in **In this show**, else the previous row's, else the first preset button. |
| K5 | Builder toolbar `Duplicate` / `Delete` with `[disabled]="!selectedCue()"` | Deleting the last cue (or ⌘Z) disables the focused button. `deleteSelected` only recovers when `activeElement === body`, and browsers disagree on whether a disabled button keeps `activeElement`. | Use `aria-disabled` (the R4 unavailable look) and ignore activation. Focus then never moves. |
| K6 | `/mine` list error `Try again` | The error card is replaced by the `aria-hidden` skeleton. | The `h1`. Then the list or the error renders as usual, and an error's `Try again` is reachable again by Tab. |
| K7 | Toast `×` (`app.html`) | The toast is removed. | The next toast's `×`, else the page's `h1`. The designer, builder, `/mine` and message-page `h1`s already have `tabindex="-1"`. Add it to the player's and `/status`'s `h1`s. Only when focus was on the removed `×`. A toast that times out while focused moves focus the same way. |
| K9 | Builder Library, My shells `Try again` and `Show more` (added in C2) | Both buttons are removed while the list loads (`status: 'loading'`), so focus drops to `body`. | Keep the pressed button rendered while loading, `aria-disabled` with `.btn-busy`. When the load succeeds: `Show more` → the first newly loaded item (or stays on `Show more` if it still renders); `Try again` → the first My shells item, else the `My shells` heading (`h3 tabindex="-1"`). On failure focus stays on `Try again`. Focus moves on settle only if it is still on the pressed button or has dropped to `body`; otherwise the visitor has moved on, and focus is left alone (C2 fix round). |
| K8 | Builder: no bypass (WCAG 2.4.1) | — | Add a skip link as the first element of the panel: `Skip to the timeline controls`. It's `sr-only` until focused, then `.btn btn-sm` placed at the top left of the panel. Activating it focuses `Play` (or `Back to start` while the notice holds Play). It's a link to `#transport` with a click handler that focuses, and it never scrolls the page. |

The designer needs no skip link: Launch is the second section, after the save bar.

### 3.3 Ctrl/⌘+S (R1)

phase-5.md §12.2 deferred it here. **It comes in**, on `/` and `/show`, as a page-level keydown like ⌘Z. The key is `(metaKey || ctrlKey) && !altKey && !shiftKey && key.toLowerCase() === 's'`, on any platform. It works **inside text fields too**: S has no native field meaning, unlike Z.

| State when pressed | Does | Default prevented? | Announced (the page's polite region) |
|---|---|---|---|
| No save bar (writes off, `api/me` failed or pending) | nothing | **no**. The browser's Save Page is the honest answer when the app can't save. | — |
| A confirm dialog is open | nothing | yes | — |
| A save is in flight | nothing | yes | — |
| `Saved` (nothing new to save) | nothing | yes | `Nothing new to save.` |
| Builder: an empty show (`cannotSave`) | nothing; no request (Peach 6f.2) | yes | `A show needs at least one cue before it can be saved.` |
| One choice (`Save`) | the same as pressing Save | yes | the existing toast and status block |
| Two choices (`Update original` · `Save as new`) | **focus moves to `Update original`**; nothing is sent | yes | `Choose Update original or Save as new.` |

- **The builder commits the focused field first.** Name, Duration and Launch time commit on `change`/blur. If one of them has focus, ⌘S runs that field's commit (the same function as blur, including B7's and §8.1's notes) and then saves. Otherwise a value typed into Duration would be missing from the save.
- **Why not pick a choice with two:** "the owner chooses with two visible buttons" is standing (phase-5.md). Update original changes what an existing link plays, so a reflex keystroke mustn't make that choice. Focus on the first choice makes it one more Enter.
- The Save button (single-choice state) gets `aria-keyshortcuts="Meta+S"` on Apple platforms and `"Control+S"` elsewhere (the save bar already knows the platform through `isApplePlatform()`). No visible hint: the toolbar text has no room, and the label stays `Save`.
- Shift+⌘S is **not** Save as new. One shortcut, one meaning.

### 3.4 `aria-disabled` looks (R4)

`styles.css` gives `.btn[aria-disabled='true']` only `cursor-progress`. That was right for Phase 5's in-flight save (phase-5.md §2.2). But Phase 6 reused `aria-disabled` for **unavailable** states (Undo with no history, Add cue and Duplicate at the cap), and those buttons look fully enabled. Replace the rule with:

```css
.btn[aria-disabled='true'] { @apply cursor-not-allowed opacity-45; }      /* unavailable: looks like :disabled */
.btn.btn-busy[aria-disabled='true'] { @apply cursor-progress opacity-100; } /* in flight: keeps its look */
```

- `.btn-busy` goes on the save bar's buttons while `saving() !== null`, on `/mine`'s Delete while `deleting()`, and on the API banner's Try again while `checking()` (§10).
- Every hover rule already excludes `[aria-disabled='true']`.
- Inactive controls are exempt from contrast minimums (WCAG 1.4.3), so 45% is fine. It matches `:disabled`, so "can't press this" looks the same whichever attribute carries it.

---

## 4. Reduced motion: audit and verdict

**Verdict: pass.** The canvas rules, the opening states and the Auto show gap are verified in §2. Outside the canvas:

| Motion | Where | Ruling |
|---|---|---|
| Switch knob slide, `transition-transform` (150 ms) | `styles.css` `.switch::after` | Add `motion-reduce:transition-none`. It's the only CSS transition in the app. |
| Player progress line (`scaleX` per frame) | `player-page.html` | Keep. It's a 2px indicator of the content's own progress, the visitor started it, and it stops on Pause (WCAG 2.2.2). |
| Timeline playhead, follow paging | `timeline.ts` | Keep. These are jumps, not animation, and they're the content's position. |
| Toasts, status block, skeleton | — | No transitions and no shimmer (phase-5.md §12.4). Confirmed: no `@keyframes` or `animate-` anywhere in `src`. |
| Smooth scrolling | — | None. `scrollIntoView` in `timeline.ts` is the timeline's own view scroll, set instantly. |

New Phase 7 surfaces must keep to this: the library-drag ghost, the badge zoom and the pinch zoom change the view instantly, with no easing. That's the rule for everyone, not only under reduced motion, because a timeline that glides fights the scrub-and-seek model.

---

## 5. Mobile and touch

### 5.1 What "mobile" means for the DPR cap (R2)

- **Mobile = `matchMedia('(pointer: coarse)').matches`** (the primary pointer is a finger). This is the existing `COARSE_POINTER_QUERY`.
  - Not width: a narrow desktop window has a desktop GPU and shouldn't lose sharpness.
  - Not `any-pointer`: a touch laptop used with a trackpad is a desktop.
  - A tablet without a trackpad counts as mobile, which is right, because its GPU is a phone's.
- **Resolution = `min(devicePixelRatio || 1, coarse ? 1.5 : 2)`**, from one shared function, for both surfaces:
  - The Pixi stage (`pixi-renderer.ts:96`, today `Math.min(dpr, 2)`) reads it when the renderer is created. A context-loss rebuild re-reads it.
  - **The timeline's ruler and lane canvases follow the same cap** (`timeline.ts:467`, today raw DPR). They read it on each draw. One rule is one test. A 2D canvas at 1.5 on a DPR 3 phone is still crisp at 11px text, and it saves 60% of the backing store.
- The engine shouldn't call `matchMedia`. The host passes the boolean or the resolution in (Yoshi places the function; A4 is deciding the renderer boundary at the same time).
- Tests (Done-when 6): with a coarse `MATCH_MEDIA` fake at DPR 3, both use 1.5. With fine at DPR 2, both use 2. With fine at DPR 3, both use 2 (the timeline changes here today). Negative control: drop the coarse branch and the first spec fails.

### 5.2 Target sizes and inputs (R3), all under `@media (pointer: coarse)` only

1. **Every `.btn`** (including `.btn-sm` and `.btn-heading`) gets `min-height: 44px; min-width: 44px; touch-action: manipulation`. Manipulation stops double-tap page zoom when a visitor taps `+` twice.
2. **Fields** (`.field`, selects, number inputs) get `min-height: 44px` and **`font-size: 16px`**. Below 16px, iOS Safari zooms the page into a focused field, and every field here is 13px.
3. **Range rows** get an input box at least 32px tall with a 24px thumb (WebKit and Gecko thumb pseudo-elements). The whole row height is the hit area.
4. **The switch rows** (`label` wrappers) get `min-height: 44px`. The label is already the hit area.
5. **Text links in header rows** (Shell designer, Show Builder, My creations, Fireworks Sandbox on the player) become `inline-flex items-center min-h-[44px]` with horizontal padding of at least 4px.
6. **Toast `×`** becomes `size-[44px]` (it's about 18px today).
7. **Spacing:** adjacent targets keep a gap of at least 8px (`gap-[8px]`). Groups at `gap-1` or `gap-1.5` (zoom group, card actions, player top bar) widen to `gap-[8px]` under coarse.
8. **The stage marker** (`stage-marker`, 14px ring) gets a transparent 44px hit area centered on the ring. The ring stays drawn at 14px.
9. **Timeline hit testing** for `pointerType === 'touch'` uses a 12 px radius (6 px for mouse and pen), and the `+k` badge hit box is at least 24×24 (§7.2).

**Every size in this section is CSS px, not rem.** The root font is 13px (`styles.css`), so rem-based Tailwind spacing scales down: `min-h-11` and `size-11` come out at 35.75px and `gap-2` at 6.5px. Use raw px (`min-h-[44px]`, `size-[44px]`, `gap-[8px]`, or px in `styles.css`). The gate measures computed px (C2 fix round, Toad).

The page keeps its own pinch-zoom. `index.html` doesn't set `user-scalable=no`, and it must stay that way (WCAG 1.4.4). Only the timeline (`touch-none`, already) and the stage (Pixi sets `touch-action: none` on its canvas) take the gesture. The stage's taps don't need `none`, so Luigi may switch the stage canvas to `manipulation` if Pixi's pointer events still arrive. That's a nice-to-have, not a gate item.

These rules make the designer panel about 30% longer on a phone. It already scrolls, and desktop is unchanged.

### 5.3 Designer at 760px and narrower

The 2c stacking stands (`flex-col-reverse`, panel `h-[45dvh]`, stage on top), plus §5.2. Nothing else changes: Launch sits in the second panel section, the hint already reads `Tap the sky to fire`, and the notice fits at 390px (`max-w-[420px]` with `left-3 right-3`).

### 5.4 Show Builder at 760px and narrower

The dock is the problem: at 390px today's single transport row needs about 400px before the scrub bar gets any width. The new narrow dock is (width-based, the same `max-[761px]` breakpoint):

```
+----------------------------- 390 -----------------------------+
| [Play] [|<]  0:12.5 / about 1:07                              |  transport line 1, 44px
| [====== overview scrub ======]               [-] [Fit] [+]    |  transport line 2, 44px
| [Add cue] [Edit cue] [Delete] [Undo] [Redo]                   |  toolbar, 44px
| 50 cues  (or the status sentence, wrapping)                   |  status line, always
| 0:00      0:10      0:20 ...  ruler 22px                      |
| lane, 4 rows of 18px                                          |  ≥ 74px
+----------------------------------------------------------------+
```

- **The DOM order doesn't change, and CSS `order` and grid placement aren't used** (WCAG 1.3.2 and 2.4.3; standing practice since 2c). The transport stays one `flex-wrap` row in today's order: Play, Back to start, time, scrub, zoom group. At this width only, an empty `basis-full h-0` element after the time breaks the line, so the scrub (`flex-1`) and the zoom group share line 2. Tab order equals visual order at both widths.
- **Toolbar:** Add cue, **Edit cue** (new, narrow only), Delete, Undo, Redo.
  - **Duplicate** is hidden at this width. It's in the inspector, which Edit cue reaches.
  - The active shell's name is hidden too (the Library shows it).
  - **Edit cue** shows while a cue is selected. It scrolls the panel so the Cue section's heading is at its top and focuses Launch time, the same as Enter on the timeline. That's why it exists: the inspector is in the panel below the stage, 40dvh away, and a tap on a cue otherwise gives no way to reach its fields except scrolling to find them.
- **The status line:** at this width the toolbar status (the count, or the cap, past-the-window or notice sentence) and the early-end note leave the toolbar and render as a wrapping `text-caption text-muted` line under it, always present. A truncated `title` is useless on touch.
- **Height:** the dock is `h-auto` with the timeline region fixed at 96px (ruler and 4 rows). That's about 250px with the status line. At 390×844 with the panel at 40dvh, the stage keeps about 250px (its 160px minimum holds).
- **Landscape phones** (wider than 760, about 390 tall) get the desktop layout and a cramped stage. That's a known limitation and not fixed in Phase 7 (OQ10, desktop-first).

### 5.5 Touch gestures on the timeline

| Gesture (`pointerType === 'touch'`) | On | Does |
|---|---|---|
| Tap (moved < 8px) | a cue | select it (as today) |
| Tap | empty lane | seek there and deselect (as today) |
| One-finger drag | **the selected cue** | move it (snap 0.1 s; the drag label; stops at 0 and `duration`) |
| One-finger drag | anywhere else on the lane | **pan** the view (new). No momentum. Nothing at Fit. |
| One-finger drag | the ruler | scrub (as today) |
| Two-finger pinch | lane or ruler | zoom (§6) |

Mouse and pen are unchanged: dragging any cue moves it, and dragging empty lane scrubs. **Why touch differs:** on a phone the lane is the only way to scroll a zoomed timeline, and a finger that lands on an unselected cue while panning must not move it. Select first, then drag. It costs one tap and prevents a silent edit.

---

## 6. Pinch zoom

- **Touch:** two pointers down on the timeline box (lane or ruler) start a pinch.
  - The zoom factor is the ratio of the current distance between the fingers to the starting distance, applied to the starting px/s and clamped from Fit to 200 px/s. It's continuous, not ×1.5 steps.
  - The time under the midpoint at the start stays under the midpoint. Moving both fingers sideways pans at the same time.
  - The view updates at most once per animation frame (it's a `viewChange`, like the wheel).
  - **A second finger cancels the one-finger action:** a cue drag reverts (no `moved` is emitted, so the document doesn't change), a pan stops, and a ruler scrub ends where it was, as a release does.
  - Lifting fingers after a pinch never counts as a tap: nothing is selected and nothing is sought until every pointer is up and a new touch starts.
  - The pinch stops Follow (as any manual zoom does) and isn't an Undo step (view isn't document).
- **Trackpad pinch (desktop).** Today each Ctrl/⌘+wheel event is a full ×1.5 step (`timeline.ts:328`). A trackpad pinch sends dozens of small events a second, so a gentle pinch jumps straight to 200 px/s. **Make it proportional:** `factor = exp(−deltaY × 0.01)` (with `deltaMode` lines × 16), clamped per event to one ×1.5 step either way. A mouse notch (|deltaY| ≈ 100) then still gives about one step.
- **Safari (macOS)** sends trackpad pinch as `gesturestart` / `gesturechange` (`scale`), not as Ctrl+wheel. Handle `gesturechange` on the timeline box with the same proportional rule, and `preventDefault` it so the page doesn't zoom. Toad's WebKit run checks it.
- No keyboard change: `+`, `-`, `0` and the buttons remain the non-pointer path.

---

## 7. Specs for the moved builder items

phase-6.md §4.1, §5.2, §6.2 and §9.5 were reread against the built code. Library drag and Show JSON stand with the details below. The scrub overview changes (R7). The badge spec gains a fallback at maximum zoom.

### 7.1 Library drag onto the timeline (phase-6.md §4.1, refined)

- **Fine pointers only** (mouse, pen). On touch, a drag in the panel is the panel's scroll. Touch adds with tap-to-select, then Add cue or a sky tap.
- **Start:** a pointerdown on an item's main button (not its `Remove`), then 4px of movement. Under 4px it's a click (select as active), as today.
- **Ghost:**
  - A chip follows the pointer, offset 8px down and right: `bg-surface-raised border border-accent rounded-md px-2 py-1 text-small`, with the item's swatches and name (`<bdi>`), at 90% opacity. It's `aria-hidden` and `pointer-events-none`.
  - The cursor is `grabbing`. The item stays in place.
- **Over the lane or ruler:**
  - A 1px `accent` vertical guide sits at the snapped time.
  - The cue drag label (`drag-label`) reads `0:12.5`, or `1:00.0 · window end` at the clamp.
  - Time snaps to 0.1 s (nearest), Alt/Option snaps to one step, and the drop is clamped to `0 … duration`, as a cue drag is (phase-6.md §4.2).
- **Blocked drops.** The label shows the short reason, and on release nothing is added and the full §9.2 sentence is announced:
  - 1000 cues: label `Show is full (1000 cues)`.
  - A 33rd shell: label `Show already has 32 shells`.
- **Drop:**
  - The cue is added with `t` = the drop time, `x` = 0.5 and no `burstHeight`, through the same `addCue` as Add cue. That includes copying the shell in and the My shells fetch (`Loading…` in the item's meta).
  - The item becomes the active shell (also on a blocked drop, so B6's note shows under it).
  - The new cue is selected. **Focus moves to the timeline** (the pointer is there, and the keys then act on the new cue).
  - Announced: `Added Peony at 0:12.5.` It's one Undo step.
- **Cancel:** dropping anywhere off the timeline box, or pressing Escape during the drag. Nothing changes and nothing is announced.
- Drops work while playing (the edit re-seeks, phase-6.md §5.3) and while the notice shows (it holds sky clicks, not timeline edits).
- No auto-scroll at the lane edges in v1: zoom out, then drop.

### 7.2 `+k` badge click-to-zoom (phase-6.md §6.2, refined)

- **Hit box:** the badge text's bounds plus 4px on every side, at least 24×24 CSS px, and it wins over cue hits inside it. On hover the cursor is `pointer` and the text turns `text-primary`.
- **Layout data:** each badge in `layoutLane` must carry its cluster's span `t0` (the earliest launch) and `t1` (the latest drawn extent), plus the id of the first hidden cue in firing order.
- **Click or tap:**
  - `pps = clamp(0.8 × laneWidth / max(t1 − t0, 0.05), current × 1.5, 200)`, with the span centered. That's always at least one zoom step, so a click never does nothing while zoom room remains.
  - It stops Follow. It isn't an Undo step and it isn't announced (the view change is visual, and screen-reader users reach these cues by arrow keys).
- **At 200 px/s** (cues overlapping within one zoom-max span), a badge click **selects that cluster's first hidden cue** and announces it with the keyboard-selection sentence (phase-6.md §16.3). The visitor can then walk the cluster with `←`/`→`.
- **Keyboard:** unchanged. Arrows select hidden cues too (scrolling them into view), and `+` zooms around the selected cue.

### 7.3 Scrub overview (phase-6.md §5.2, changed: R7)

- **Structure:** a `relative flex-1` wrapper. Behind it is an `aria-hidden` 2D canvas, 12px tall and vertically centered, with the same DPR rule (§5.1). On top is the existing native range at full size: transparent track, custom thumb 6×20px `accent` with a 1px `on-accent` edge (24×32 under coarse). The range keeps everything it has: `aria-label="Playhead"`, `aria-valuetext`, arrows 0.1 s, PageUp/PageDown 10 s, Home/End.
- **Drawn** across the whole view range `0 … viewEnd`, whatever the lane's zoom. It's redrawn on a document, view, size or selection change, never per frame.

| Layer | Look |
|---|---|
| Launch window `0 … duration` (or `0 … end` when the show ends early) | `surface-raised` fill |
| Tail | the lane's hatch (`border` lines on `surface-sunken`) |
| Each cue | a 1px × 8px tick at `t`, `text-muted` (5.7:1 on `surface-raised`). Dense shows merge into blocks, which is the truth about density. |
| Selected cue | a 2px tick, `accent` |
| End | 1px `text-muted` |
| The lane's visible window `scroll … scroll + width/pps` | a 1px `text-muted` outline box, full height, hidden at Fit (it would be the whole bar) |

- **The view box isn't draggable (departure).** One pointerdown on a native range can't both seek and drag a box without breaking the range for touch and assistive tech. Scrolling is covered instead by wheel and Shift+wheel (desktop), one-finger pan (touch, §5.5), arrow selection (keyboard), and this new rule:
- **New rule:** a seek from the scrub bar or `Back to start` that lands the playhead outside the lane's visible window scrolls the lane so the playhead sits 10% from the left (the Follow position). Ruler and lane seeks are always inside the window, so they never scroll.
- The focus ring is the global outline around the wrapper. Don't let `overflow-hidden` clip it.

### 7.4 Show JSON

See §9.

---

## 8. The end-label collision fix (R8)

Today (`timeline.ts:602–614`), when the end label can't sit in the ruler, it goes to the lane foot, where the `+k` badges are drawn (`laneH − 3`), and it can cover one. The new placement tries these in order and takes the first that fits. "Fits" means inside `0 … w`, clear of the window label's box, and, for lane positions, clear of every badge's hit box and of the `Tail` / `Nothing launches here` pad:

1. ruler, right of the end line;
2. ruler, left of the end line;
3. lane foot, right of the end line;
4. lane foot, left of the end line;
5. **not drawn.** The dashed line still marks the end, the transport reads `/ about 1:07`, and the overview draws the end tick.

- **Badges always win:** they're interactive now (§7.2), and they report cues that aren't drawn. The window label keeps its current rule (it flips left of its line when it would hit the end label or the edge).
- Done-when 9 test: a fixture where the end lands within one label width of `duration` at Fit, with an overflow badge under the end line. The label is placed by step 4 or 5, and no drawn label box intersects a badge box. Assert on the layout data (a `labelPlacement` result), not on pixels.

---

## 9. Show JSON: copy and flow (phase-6.md §9.5, refined)

### 9.1 Placement and behavior

- **The last panel section, after Display:** a `<details>` disclosure, **closed by default**. The `summary` is styled as `.section-heading` and reads `Show JSON`. It **must show a disclosure indicator** (C2): `.section-heading` is `display: flex`, which removes the native marker. Add a leading `<span aria-hidden="true">▸</span>` turned 90° while open (`group` on the `details`, `group-open:rotate-90`, no transition), and hide the WebKit marker (`[&::-webkit-details-marker]:hidden`). Its content renders **only while open**, as the Cue list does.
  - **Why closed:** a 1000-cue show is about 100 KB of text. Keeping that string and a textarea in sync on every edit costs the same as the draft write that phase-6.md §10.1 debounces.
  - **Why last:** it's a power and testing tool (Toad's two-engine round trip), not part of building.
- **Content** (2c §3.6 with show wording):
  - A buttons row: `Copy` · `Apply`, plus `Revert` only while there are unapplied edits. All are `.btn btn-sm`, and buttons never go inside the `summary`.
  - The textarea: `aria-label="Show JSON"`, `aria-describedby` → the note, `font-mono text-caption leading-[1.35] h-[180px] resize-y`, `spellcheck="false"`.
  - The note is a polite live region (B4's re-announce rule applies, §10).
- **Text:** the show document exactly as Save would send it (the same keys as Peach 6f.3, with no UI state), pretty-printed with 2 spaces. While open, it follows the document on every change, except while there are unapplied edits (2c D8: the edits are kept and Revert shows). **Copy copies the textarea's text**, as the designer's Shell JSON Copy does (C2 ruling). With no unapplied edits that's the document, so a Copy in one engine and an Apply in another deep-equal the source (Done-when 9). Closing the disclosure drops unapplied edits and the note (accepted in C2).
- **Apply:** `upgradeShow`, then lenient `normalizeShow`, then the outcome below.
  - **Over a dirty show it asks first** (§9.3).
  - On success:
    - The show is replaced; the playhead goes to 0:00, paused, with nothing selected and the view at Fit.
    - `nextCueId` is one more than the largest `c{n}` (as after a link load).
    - The active shell is unchanged if it's a preset, the designer item or My shells; an embedded active shell that's no longer there falls back to Peony.
    - Flags per phase-6.md §10.2 (Apply clears `dirty` and clears `saved`). `source` is handled as the designer's Apply handles it.
  - **Apply is one Undo step** (Q1 for Skyler).
  - **Focus stays on Apply**, and the note says what happened. That differs from Open copy's `h1`: the visitor is working in this panel.

### 9.2 Note copy

All 2c §3.6 rules carry over (count distinct paths; no more than 5 names, then `and {k} more`; `defaulted` and `cleaned` aren't mentioned; keys are shown as typed, cut at 40 characters, as text). Labels come from `showFieldLabel` (phase-6.md §15), resolved against **the document as pasted**, so `Cue at {t}` names the time the visitor can find in their own text.

| State | Note |
|---|---|
| Default | `This is the show as it's saved. Edit it, then press Apply to load it.` |
| Edited, not applied | `You have edits that aren't applied yet. Apply them, or Revert.` |
| Copy succeeded / blocked | `Copied to clipboard.` / `Copy was blocked. The text is selected; press ⌘C to copy it.` (`Ctrl+C` on other platforms) |
| Applied, clean | `Applied.` |
| Values adjusted | `Applied, with 2 values adjusted: Launch time (Cue at 1:05.0), Stars (Peony, Break 1).` |
| Unknown fields ignored | `Applied. 1 unknown field was ignored: sparkle (Cue at 0:12.5).` (show-level: `theme`; in a shell: `sparkle (Peony, Break 1)`) |
| An embedded shell's `sky` dropped (one) | appended: `Shells in a show play under the show's sky, so Peony's own sky was removed.` |
| …(several) | appended: `Shells in a show play under the show's sky, so 3 shells' own skies were removed: Peony, Willow, Ring.` |
| Not JSON | `Couldn't apply: this isn't valid JSON ({parser message}). Nothing changed.` |
| A shell pasted here (an object with `breaks` and no `cues`) | `Couldn't apply: this is a shell, not a show. Paste it in the designer's Shell JSON, or add it to a show from the Library. Nothing changed.` |
| Invalid show | `Couldn't apply: {reasons}. Nothing changed.` Reasons come from `showIssueReason`, joined with `; `, **at most 5, then `; and {k} more problems`** (`; and 1 more problem` when k is 1) (a broken 1000-cue paste must not produce a 1000-line note). Example: `Couldn't apply: Seed (Cue at 0:12.5) must be a whole number. Nothing changed.` |
| Waiting on the confirmation | unchanged (the "edits that aren't applied" text) |

The embedded-`sky` sentence is a caveat on a success, not an error (standing decision). It's separate from "unknown fields", because `sky` is a field the visitor knows from the designer. It isn't a typo.

### 9.3 Confirmation (over a dirty show)

> **Apply this JSON?**
>
> This replaces your current show, “{name}”, including its cues, shells and sky. Display settings stay as they are.
>
> `Keep editing` · `Apply JSON`

- The blank-name variant is derived mechanically, with the designer's `quotedName(…, ',')` rule: `This replaces your current show including its cues, shells and sky. Display settings stay as they are.`
- The action label is `Apply JSON`, matching the designer's `CONFIRM_APPLY_ACTION`. phase-6.md §9.5's `Apply` was the outlier, and it's replaced.
- Focus opens on `Keep editing` and returns to `Apply` on close.

### 9.4 Show-path labels and `labels.ts` (Peach N1)

N1's save-time half is closed in code: `show-save.ts` passes every issue through `showIssueReason`, and `showFieldLabel` implements §15. Two things are left:

1. **Apply's notes must use `showFieldLabel` for every path** (adjusted, ignored, and the sky sentence's shell names). The designer's `appliedNote` calls bare `fieldLabel`, which still returns `cues[3].seed` raw. Reusing it unchanged would reintroduce N1.
2. **Move `CUE_FIELDS` from `show-copy.ts` into `engine/model/labels.ts`** as `CUE_FIELD_LABELS`, next to `FIELD_LABELS`, and have the inspector's row labels read it. Then every row label in the app is in one file, as 2c D5 intended.
   - `showFieldLabel` itself stays in `show-copy.ts`: it needs the document and `formatTime`, which is copy, not schema.
   - `fieldLabel` stays shell-only. A spec asserts that no show surface imports it directly (the pattern of the `unsafe-sinks` structure spec).

---

## 10. Carried fixes: B4–B7 and Try again

| # | Fix | Copy |
|---|---|---|
| **B4** Repeated announcements are silent | One `announce(text)` helper for every `sr-only` polite region (the builder dock, the designer panel, the player, `/mine`): set `''`, then set `text` 100 ms later, cancelling any pending set. **Visible** live notes (the JSON note, Duration and Launch time) must also re-announce an identical message without blinking: re-insert the text node under a stable live container (a keyed `@for` over a sequence number), or another mechanism Luigi prefers. Cases to test: a second blocked add at the cap, a second show end in one session, two adds of one shell at one paused playhead, and Copy pressed twice. | — |
| **B5** Focus survives Undo/Redo | After any undo or redo (keys or buttons), in the next render: if focus is on `body`, on a disabled control, or on a disconnected node, move it. From the **save bar** → the panel `h1` (phase-6.md §9.1). From the **inspector or the toolbar** → the timeline (K3). Anywhere else → the panel `h1`. | — |
| **B6** The 32-shell note | Render the §9.2 sentence as a `.note` **directly under the active Library item** (in whichever group it's in), with an `id`, and give that item button `aria-describedby` → the note. It stays in the toolbar status as well. | `This show already holds 32 shells, the most it can. Use a shell that's already in it, or remove an unused one.` (unchanged) |
| **B7** Duration out of range | Every rejected entry leaves a note until the next valid entry. With cues, when `v` is below the last launch, use the existing blocked note. Otherwise, when `v` is blank, not a number, below 1 or above 600, use the range note. The note gets `aria-live="polite"`, and the field gets `aria-describedby` → the note. The same goes for Launch time's note (§8.1), which has the same gap. | `Duration is between 1 and 600 seconds.` |
| **Try again** (`api-banner.ts:28`) | `aria-disabled` and `.btn-busy` while checking, ignore clicks, label `Checking…`, and focus stays on the button. **On recovery the banner unmounts with focus inside it:** focus moves to the panel `h1` (designer and builder). On failure, the label goes back to `Try again` and focus stays. | unchanged |

Also found, same family: **the stage failure copy names a shell on every surface** (`fireworks-stage.html`: "your shell is kept in this browser"). The builder and the player need their own lines. The stage takes a `failureNote` input:

| Surface | Startup failure |
|---|---|
| Designer | `Fireworks can't start in this browser: {error}. The controls still work, and your shell is kept in this browser.` (unchanged) |
| Builder | `Fireworks can't start in this browser: {error}. The controls still work, and your show is kept in this browser.` |
| Player | `Fireworks can't start in this browser: {error}. You can still open a copy with Remix.` |

---

## 11. WebGL context loss: what the visitor sees (R10)

Yoshi (A4) decides where it lives. This is only what shows. It's the same on `/`, `/show` and `/s/` (shell and show).

| Phase | Stage | Copy | Focus and live region |
|---|---|---|---|
| `webglcontextlost` | the canvas is blank (the browser cleared it). **Playback holds:** no driver steps and no launches, so a show resumes at the same sim time (Done-when 5). The play state controls don't change (`Pause` still reads `Pause`; the hold isn't the visitor's pause). | nothing for the first **1 s**, so a quick loss and restore flashes no text | — |
| Still lost after 1 s | blank | the hint style, bottom left of the stage (replacing the builder's `Catching up…` line while shown): **`Graphics paused by the browser. Playback resumes when they're back.`** | `role="status"`. Focus doesn't move. |
| `webglcontextrestored` | redrawn from the kept sim, then playback continues from where it held | the line disappears. No toast, no "restored" message: the moving sky is the message. | — |
| Not restored 10 s after the loss | the failure block (the `stage-error` layout), with a **`Reload page`** button (`.btn`) | **`Graphics stopped on this page, and the browser hasn't brought them back.`** then, by surface: designer `Reload to start the fireworks again. Your shell is kept in this browser.` · builder `Reload to start the preview again. Your show is kept in this browser.` · player `Reload to play it again from the start.` | `role="alert"`. Focus doesn't move, and the button is reachable by Tab. |
| Restored after the failure block | **ignored** (coordinator ruling N1: the renderer is already destroyed; `Reload page` is the way back) | the block stays | — |

- **The builder's draft must be flushed before the reload.** The draft write is debounced (phase-6.md §10.1), so write it on `pagehide`. "Your show is kept" has to be true.
- The timeline's 2D canvases can lose their context too (Chrome under memory pressure fires `contextlost` and `contextrestored` on a canvas). Redraw on `contextrestored`. Nothing is shown to the visitor.
- Under Reduce flashing the resume is the same. Nothing about flashing changes across a loss.

---

## 12. For Peach: Done-when hooks

| 7.2 item | What this document makes checkable |
|---|---|
| 6 DPR | §5.1: coarse at DPR 3 → 1.5 for the stage and both timeline canvases; fine at DPR 2 → 2; fine at DPR 3 → 2 |
| 7 Accessibility | the §3.1 inventory as a tab-walk per page; K1–K8; §3.3's table row by row; R4's two looks; B4–B7 and Try again (§10); the §4 switch transition under `reduce` |
| 8 Touch (390×844, touch emulation) | §5.2 sizes (a computed `min-height ≥ 44` on every `.btn` and field, 16px field text); §5.4 narrow dock (two rows, Edit cue, status line); §5.5 gestures; §6 pinch changes `view.pxPerSecond` |
| 9 Builder UX | §7.1 drop adds exactly one cue at the snapped drop time; §7.2 badge zoom and its max-zoom fallback; §7.3 overview layers and the seek-scroll rule; §8 no label box intersects a badge box; §9 round trip, Apply over dirty asks, the sky note, labels via `showFieldLabel` |
| 5 Context loss | §11's states and copy, the 1 s and 10 s thresholds, the hold (same sim time) |

---

## 13. Departures from earlier specs (recorded)

1. **D1 (phase-6.md §5.2):** the scrub overview's view box isn't draggable. A seek outside the view scrolls the lane instead (§7.3).
2. **D2 (phase-6.md §3.2):** on touch, a one-finger drag pans unless it starts on the selected cue (§5.5). §3.2 said "drag moves".
3. **D3 (phase-6.md §9.5):** Show JSON is a closed disclosure. The confirm action reads `Apply JSON`. Apply is an Undo step, pending Q1.
4. **D4 (designer-2c.md §8.1):** after `+ Add` creates the 4th break, focus moves to the new tab (K1).
5. **D5 (phase-5.md §2.2, `styles.css`):** `aria-disabled` now looks unavailable by default. In-flight buttons add `.btn-busy` (R4).
6. **D6 (phase-5.md §12.2):** Ctrl/⌘+S added (R1).
7. **D7 (phase-6.md §4.1):** a library drop clamps to `0 … duration` like a cue drag, and makes the dragged item active.

## 14. Questions for Skyler

- **Q1. Is Show JSON Apply an Undo step?** Your Phase 6 ruling lists what clears the history (a link load, New show), and Apply isn't on it. **Recommended: yes, one step.** A wrong paste is the likeliest mistake on that panel, and Undo is the cheap way back. The alternative is that Apply clears the history like New show.
- **Q2. Ctrl/⌘+S with two save choices: move focus to `Update original` (recommended), or do nothing?** Production writes are off until Phase 8, so this mostly matters in Development and test windows either way.

---

## 15. Post-implementation review (C2, 2026-11-15)

Checked B2 (`luigi-phase7-client-hardening.md`) and B3 (`luigi-phase7-ux-accessibility.md`) against this document, in code plus one Chromium look (1280×800 and 390×844 touch, `/show`). Record: `.squad/decisions/records/rosalina-phase7-post-implementation-review.md`.

**Conforms:** copy (stage startup and loss lines, Show JSON notes and confirm, skip link, drop labels, range note); K1, K2, K4–K8; ⌘S table, the field commit and two choices focusing `Update original`; R4 looks and `.btn-busy` (save bar, `/mine` Delete, Try again); B4–B7; Try again focus (`BannerFocus`); the narrow dock (two-row transport, Edit cue, status line, 96 px timeline); pinch, trackpad and Safari zoom; library drag; badge zoom and the 24×24 box; the overview layers; `labelPlacement`; context-loss 1 s / 10 s; the switch knob under reduced motion.

**Deviation rulings:**
1. B4 repeat-only clear: **accepted.**
2. Show JSON Copy of the saved document: **rejected.** Copy copies the textarea, as the designer does (`json-panel.ts` copies `el.value`). Closing drops edits: **accepted.**
3. Wheel scroll not stopping Follow: **rejected.** phase-6.md §5.1 says a manual scroll stops following; while playing, Follow fights the wheel. Wheel and Shift+wheel scroll go through `manualView`.
4. Designer Shell JSON Copy twice: **rejected.** B4 covers every polite note; the designer's note needs the same `liveNote` keyed render.
5. Badge text-width estimate: **accepted** (the 24×24 floor covers the error).
6. Warm-up caps (12 ms idle, 6 ms playing): **accepted.** No visible cost; the builder stays at 60 fps.

**Defects:** C2-1 the touch scrub thumb and track (`styles.css`: the generic `input[type='range']` pseudo-element rules, specificity 0,1,2, beat `.scrub-range`'s 0,1,1, so the scrub gets a round thumb on an opaque 4 px track that covers the overview); C2-2 the Show JSON disclosure indicator (§9.1); C2-3 K9; C2-4 the `1 more problem` plural; plus rulings 2–4.

# Shell Designer (Phase 2c): design-review notes

**Ceremony:** design-review before 2c. Facilitator: Rosalina. Participants: Luigi (implements), Peach (acceptance criteria).
**Date:** 2026-11-12; updated 2026-11-13 for Skyler's draft, dirty-flag and notice-hold rulings, and 2026-11-14 for the shell/sky flag split (§6.4) at the Phase 5 design-review.
**Oracle:** `prototypes/fireworks-prototype.html`. Line numbers below refer to it.
**Scope:** the `/` route (`designer-page`) and the app-wide pieces it sits on (tokens, toasts, API-down state). No save, share, player or My creations copy here; that is Phase 5.

Everything below is parity with the prototype unless it appears in **§9 Deliberate departures**. If the prototype and this note disagree and the point isn't listed in §9, the prototype wins and this note has a bug.

---

## 1. Rulings from this review (summary)

| # | Question from the brief | Ruling |
|---|---|---|
| R1 | Semantic token names in `styles.css` | **Confirmed**, with three changes: the `toast-*` tokens are renamed to role names (`success-surface`, `danger-surface` and their `on-` pairs), a `border-control` token is added for form-field edges (contrast), and four font-size tokens are added. Full table in §4. |
| R2 | Placeholder toast/success colors | **Values confirmed** (contrast measured, §8.4). Only the names change. |
| R3 | API down shows the modal *and* a toast | **Neither as it stands.** The blocking modal goes; it becomes a non-blocking banner in the panel, because anonymous play never needs the server (plan §3.4). The `api/me` failure stops toasting (it's self-handled by `SessionService`). One outage, one message. §6.3. |
| R4 | Photosensitivity: move forward from Phase 7? | **Yes, into 2c** for the designer: a first-visit flashing notice that **holds playback until it's dismissed** (Skyler, 2026-11-13), a **Reduce flashing** display setting (on automatically under `prefers-reduced-motion`), and Manual as the starting mode under reduced motion. The player notice and its Reduce flashing control ship in Phase 5, when the player exists. `/` auto-plays once the notice is gone (Skyler, 2026-11-12). §7. |
| R7 | Replacing the shell when the visitor has changed something (Skyler's rulings, plan 2c) | **An in-page confirmation dialog** before a preset load or a JSON Apply, only when it would replace a shell or sky change the visitor made. Two flags (`shellDirty`, `skyDirty`) that the visitor's own changes set; there's no baseline snapshot. Rules, copy, focus and keys in §6.4. |
| R8 | Renderer fallback (Luigi's Phase 1 finding 4) | **A stage note for Canvas only.** No notice for WebGPU. §3.8. |
| R5 | `range-row` / `select-row` as Signal Forms custom controls | Specified in §5. Both wrap **native** inputs (native range, native select), so keyboard, screen-reader and mobile-picker behavior come for free. |
| R6 | Landing route (OQ8) | **Confirmed:** the designer at `/`. |

**Correction to the premise in the brief and in plan 2c's design-review note:** `/` does not auto-play strobe on arrival. The default shell is `PRESETS[0]`, Peony (line 160), which has no effect, and preview loop fires only the current shell (lines 504–507). On arrival the visitor sees one Peony burst every ~4.65 s (`shellDuration`: rise 2.48 s + burn 1.6 × 1.1 + 0.4), one flash at a time, well under the three-flashes-per-second threshold. Strobe reaches the screen when the visitor picks the Strobe preset or effect, when **Auto show** draws it (25% current shell, else a random preset, every 0.35–1.75 s), or when a restored draft (`fireworks.draft.v1`) or, from Phase 5, a `/c/:code` link contains strobe. That's still enough to justify the work in §7; it changes where the risk is, not whether to act.

---

## 2. Layout

### 2.1 Desktop (wider than 760px)

Same as the prototype (lines 15–19, 61–115):

```
+------------------- 340px -------------------+------------------- flex 1 -------------------+
| Fireworks Sandbox                           | Click the sky to fire · Space to launch   HUD |
| Shell designer                              |                                     (2 lines) |
| [API banner, only when the server is down]  |        [Flashing notice, first visit]          |
|---------------------------------------------|                                                |
| PLAYBACK                                    |                                                |
| [Launch (Space)] [Replay last] [Clear sky]  |                  Pixi stage                    |
| Mode   [Preview loop (current shell)   v]   |               (cursor: crosshair)              |
| note                                        |                                                |
|---------------------------------------------|                                                |
| PRESETS   [Peony] [Chrysanthemum] ...       |                                                |
| SHELL     Name / Burst height / Angle jitter |                                                |
| BREAKS            [+ Add] [− Remove]        |                                                |
|   [Break 1] [Break 2] ...                   |                                                |
|   12 break rows                             |                                                |
| SKY       Gravity / Wind                    |                                                |
| DISPLAY   Motion blur / Star budget /       |                                                |
|           Reduce flashing                   |                                                |
| SHELL JSON        [Copy] [Apply]            |▄▄▄ skyline ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄|
+---------------------------------------------+------------------------------------------------+
```

- Page: `flex h-full`, `overflow: hidden` on the page (the panel scrolls, the page never does).
- Panel: `w-[340px] flex-none overflow-y-auto bg-surface border-r border-default px-[14px] pt-[14px] pb-10`.
- Stage: `relative flex-1 min-w-0 cursor-crosshair bg-surface-sunken`.
- Sections in this order: Playback, Presets, Shell, Breaks, Sky, Display, Shell JSON (departure D3 splits the prototype's "Sky & physics" into Sky and Display).
- Section: `border-t border-default pt-3 pb-1.5`. Section heading (`h2`): `flex items-center justify-between m-0 mb-2 text-caption font-semibold uppercase tracking-[0.1em] text-muted`.

### 2.2 760px and narrower

Prototype lines 53–56: `flex-direction: column-reverse`, so the **stage is on top** and the panel is below it at 45% height with a top border instead of a right one.

- Page: `max-[761px]:flex-col-reverse`. Tailwind 4's `max-[X]` compiles to `width < X`, while the prototype's `max-width: 760px` includes 760 itself, so `761px` matches it to the pixel. Don't use `max-md` (768px).
- Panel: `w-full h-[45dvh] border-r-0 border-t border-default`. `dvh`, not `%`, so mobile browser chrome doesn't push the panel off-screen (departure D12).
- Stage takes the remaining height. The HUD and hint stay in the stage corners; below 480px the hint gets `max-w-[55%]` so it wraps instead of running under the HUD.
- Touch: tap-to-fire is the same pointer handler as click. On `(pointer: coarse)` the hint and Launch label drop the keyboard reference (§3.1), and slider and select rows get `min-h-9` so the thumb is a usable target.

### 2.3 Stage overlays

| Overlay | Position | Style | Notes |
|---|---|---|---|
| Hint | `absolute top-2.5 left-3` | `text-small text-muted pointer-events-none [text-shadow:0_1px_2px_#000]` | Lines 49–50. Copy: `Click the sky to fire · Space to launch`; on `(pointer: coarse)`: `Tap the sky to fire` (D12). |
| HUD | `absolute top-2.5 right-3 text-right` | `font-mono text-caption leading-[1.5] text-muted pointer-events-none whitespace-pre [text-shadow:0_1px_2px_#000]` | Lines 47–48. Updates about 4 times a second (plan §3.2 item 2), never per frame. `aria-hidden="true"`: a counter that changes four times a second is noise to a screen reader. |
| Flashing notice | `absolute top-12 left-3 right-3 mx-auto max-w-[420px]` | See §7.2. | New (D1). |
| Renderer failure | `absolute inset-0 flex items-center justify-center p-[30px] text-center text-danger` | Lines 51–52. | Copy in §3.8. |
| Canvas renderer note | `absolute bottom-2.5 left-3 max-w-[60%]` | `text-caption text-muted pointer-events-none [text-shadow:0_1px_2px_#000]` | New (D17). Copy in §3.8. Only when Pixi fell back to Canvas. |

The replace confirmation (§6.4) is not a stage overlay: it's a modal dialog over the whole page.

---

## 3. Component inventory and copy

Maps the plan's 2c presentational components to the prototype. Copy is final: use it verbatim. "aria" lists only what isn't implied by the visible text.

### 3.1 `playback-controls` (prototype lines 65–81)

| Element | Copy | Behavior / aria |
|---|---|---|
| Primary button | `Launch (Space)`; on `(pointer: coarse)`: `Launch` | Fires the current shell at `defaultTarget`. `bg-accent-gradient text-on-accent font-semibold border-0`. |
| Button | `Replay last` | `title="Fire the last launch again, with the same seed"`. **Disabled until something has launched** (D7). |
| Button | `Clear sky` | Removes every shell and particle. |
| Select row, label | `Mode` | Native select, wide row (no value column). |
| Options | `Preview loop (current shell)` · `Manual (click sky / Space)` · `Auto show (random presets)` | Values `loop` / `manual` / `show`. Changing mode resets the mode timer (line 705). |
| Note | `Click anywhere in the sky to burst the current shell at that point.`; on coarse pointer: `Tap anywhere in the sky to burst the current shell at that point.` While the flashing notice shows: `Close the flashing notice on the stage to start.` (§7.2) | `.note`: `mt-1 text-caption text-muted`. |

Button row: `flex flex-wrap gap-1.5`. The mode row sits `mt-2.5` below it (line 72).

### 3.2 `preset-bar` (lines 83–86, 655–662)

- Heading: `Presets`.
- One button per preset, labeled with the preset name exactly as in `presets.ts`: Peony, Chrysanthemum, Willow, Palm, Ring, Crossette, Crackling Heart, Strobe, Rainbow, Triple Break.
- Buttons: `text-small px-2 py-1`. Clicking loads the preset, selects Break 1, and fires it once immediately, resetting the loop timer (line 667).
- **When the designer is dirty, the click asks first** (D16, §6.4). When it isn't, it loads and fires at once, as in the prototype.
- A preset load **keeps the current sky** (Gravity, Wind) and never changes display settings. The prototype does the same: its gravity and wind are world settings, not part of a preset.
- While the flashing notice is showing (§7.2), a preset loads but doesn't fire; playback starts when the notice is dismissed.

### 3.3 `shell-fields` (lines 88–91, 606–615)

| Label | Control | Range / step | Value display | `aria-valuetext` |
|---|---|---|---|---|
| Name | text input, wide row | 1–80 chars (schema), `maxlength="80"` | none | — |
| Burst height | range | 0.30–0.85 / 0.01 | `65%` | `65 percent` |
| Angle jitter | range | 0–20 / 1 | `4°` | `4 degrees` |

- Name placeholder: `Name your shell`. When 70 or more characters are used, a counter appears right-aligned under the field: `72/80` (`.note`, `text-right`). An empty name is allowed while editing; whatever later saves it (Phase 5) supplies the default.
- Ranges come from `engine/model/limits.ts`, never re-typed in a template.

### 3.4 `break-tabs` + `break-fields` (lines 93–97, 617–645)

**Heading row:** `Breaks` on the left; on the right a button group:

| Button | Visible copy | aria-label | Disabled when | Title when disabled |
|---|---|---|---|---|
| Add | `+ Add` | `Add break` | 4 breaks | `A shell can have up to 4 breaks.` |
| Remove | `− Remove` (true minus, U+2212) | `Remove Break {n}` (the active one) | 1 break | `A shell needs at least one break.` |

Heading-row buttons use `text-small px-2 py-0.5 normal-case tracking-normal font-normal` so they don't inherit the heading's uppercase caption styling.

**Tabs:** `Break 1` … `Break 4`, `flex flex-wrap gap-1 mb-1.5`, each `text-small px-2.5 py-1`. Active: `border-accent text-accent` (line 42). Implemented as an ARIA tablist (§8.2).

**Add** copies the last break (not the active one), sets its delay to 0.6, and selects it (lines 676–681). **Remove** removes the active break and selects the one before it (lines 682–686). A polite live region in the panel announces `Break 3 added.` / `Break 2 removed.`.

**Break rows**, in this order:

| Label | Control | Range / step | Value | `aria-valuetext` |
|---|---|---|---|---|
| Pattern | select | Peony · Ring · Palm · Heart | — | — |
| Stars | range | 4–400 / 1 | `120` | `120 stars` |
| Burst speed | range | 60–400 / 5 | `220` | — (number alone) |
| Color | select + swatch | Red · Orange · Gold · Green · Cyan · Blue · Purple · Pink · White · Silver · Rainbow | — | — |
| Changes to | select + swatch | No change · Red … Silver | — | — |
| Change at | range | 0.10–0.95 / 0.05 | `60%` | `60 percent of burn time` |
| Burn time | range | 0.3–5 / 0.1 | `1.6s` | `1.6 seconds` |
| Air drag | range | 0–4 / 0.05 | `0.90` | — |
| Star size | range | 0.4–3 / 0.05 | `1.00` | — |
| Trail | select | None · Tail · Glitter | — | — |
| Effect | select | None · Crackle · Crossette · Strobe | — | — |
| Delay | range (breaks 2–4 only) | 0.1–2.5 / 0.05 | `0.60s` | `0.60 seconds after the previous break` |

- Option **labels** are display copy (D5); option **values** stay the lowercase schema values (`peony`, `none`, `rainbow` …). The mapping lives in one place next to `enums.ts`/`colors.ts`, not in each template.
- **Change at** is disabled when **Changes to** is `No change` (D6), with a note under it: `Pick a second color to use this.`
- When **Effect** is Strobe and Reduce flashing is on, a note appears under Effect: `Strobe shows as steady stars while Reduce flashing is on.`

### 3.5 `sky-fields` and `quality-fields` (lines 99–102, 647–653)

The prototype's single "Sky & physics" section becomes two (D3), because the plan separates saved physics from viewer settings (§3.2 item 3).

**Sky** (`sky-fields`), saved with the shell:

| Label | Range / step | Value | `aria-valuetext` |
|---|---|---|---|
| Gravity | 40–400 / 5 | `160` | — |
| Wind | −80–80 / 1 | `-20`, `0`, `20` | `20, blowing left` · `calm` · `20, blowing right` |

Note: `Saved with the shell.`

**Display** (`quality-fields`), this device only:

| Label | Control | Range / step | Value |
|---|---|---|---|
| Motion blur | range | 0–0.92 / 0.01 | `78%` |
| Star budget | range | 0.25–1 / 0.05 | `100%` |
| Reduce flashing | switch (`role="switch"`, native checkbox underneath) | on / off | `On` / `Off` |

Notes:
- Under the section: `These stay on this device and aren't saved with the shell.`
- Under Reduce flashing: `Turns off strobe and dims burst flashes.` When the OS setting turned it on, append: ` On because your device asks for reduced motion.`

The draft exists so the current state is never lost when the visitor leaves the sandbox for any reason: a reload, `/status`, closing the tab (Skyler, 2026-11-13). Display settings, the Mode, the active break tab and the two dirty flags (§6.4) are kept in it (`fireworks.draft.v1`, one key; there is no separate display key), next to the shell but never inside the shell document, so Copy and Apply never see them. Two exceptions, both so the OS keeps control until the visitor takes it: Reduce flashing is stored only once the visitor has chosen (§7.1), and the OS-forced Manual mode is never written back (§7.1). Wrap every storage read and write in try/catch; the page must work when storage throws.

### 3.6 `json-panel` (lines 104–108, 670–704)

- Heading: `Shell JSON`, with `Copy` and `Apply` buttons on the right.
- Textarea: `font-mono text-caption leading-[1.35] h-[180px] resize-y`, `spellcheck="false"`, `aria-label="Shell JSON"`, `aria-describedby` → the note.
- The note is a polite live region. Its messages:

| State | Note text |
|---|---|
| Default | `This is the shell as it's saved. Edit it, then press Apply to load it.` |
| Edited, not applied | `You have edits that aren't applied yet. Apply them, or Revert.` A `Revert` button appears beside Copy/Apply only in this state (D8). |
| Copy succeeded | `Copied to clipboard.` |
| Copy blocked | `Copy was blocked. The text is selected; press ⌘C to copy it.` (`Ctrl+C` on non-Apple platforms.) |
| Apply: clean | `Applied.` |
| Apply: values adjusted | Singular: `Applied, with 1 value adjusted: Stars (Break 1).` Plural: `Applied, with {n} values adjusted: Stars (Break 1), Burn time (Break 2).` (D9) |
| Apply: unknown fields ignored | Singular: `Applied. 1 unknown field was ignored: sparkle (Break 1).` Plural: `Applied. {n} unknown fields were ignored: sparkle (Break 1), theme.` |
| Apply: both | The adjusted sentence, then the ignored one, minus the second `Applied.`: `Applied, with 1 value adjusted: Stars (Break 1). 2 unknown fields were ignored: sparkle (Break 1), theme.` |
| Apply: waiting on the confirmation | Unchanged: the note keeps the "edits that aren't applied yet" text until the visitor answers (§6.4). |
| Apply: not JSON | `Couldn't apply: this isn't valid JSON ({parser message}). Nothing changed.` |
| Apply: invalid shell | `Couldn't apply: {reason}. Nothing changed.` Reasons come from `normalize`, in field-label language, and name the break when the field is inside one (D9): `Couldn't apply: Pattern (Break 1) "spiral" isn't one of Peony, Ring, Palm, Heart. Nothing changed.` or `Couldn't apply: a shell needs 1 to 4 breaks. Nothing changed.` |

**Sky on Apply.** JSON with a `sky` object replaces the current sky (missing `gravity` or `wind` inside it are defaulted by `normalize`, as for any field). JSON with no `sky` key keeps the current sky, the same as a preset.

The adjusted case is the standing decision "a write that partly fails is a success with a caveat": the shell loaded, so it reads as success, then says exactly what was changed.

**Which adjustments count.** `normalizeShell` returns `adjustments[]` with kinds `defaulted | clamped | rounded | truncated | dropped` (Yoshi's 2a record).

| Kind | In the message? | Why |
|---|---|---|
| `clamped` | Counts toward "{n} values adjusted" | The visitor typed a value and got a different one. |
| `rounded` | Counts | Same: `120.4` stars became `120`. |
| `truncated` | Counts (shows as `Name`) | Same: their name was cut to 80 characters. |
| `dropped` | Its own sentence, "unknown fields were ignored" | Nothing was adjusted; something the visitor wrote had no effect. Different fact, different words. |
| `defaulted` | **Not mentioned** | Leaving a field out is the normal way to write short JSON (`{"breaks":[{"stars":200}]}`); the fields and the refreshed JSON show what was filled in. Counting defaults would turn a two-field paste into "23 values adjusted", which hides the adjustments that matter. A missing `version` and a blank name becoming `Custom` are defaults too. |

Rules for the list:
- **Count distinct paths, not entries.** A value that was both clamped and rounded (`9999.5` stars) is one adjusted value.
- **Adjusted values are named by row label** with the break in parentheses: `breaks[1].burn` → `Burn time (Break 2)`, `sky.wind` → `Wind`, `name` → `Name`. The label map is the same one the rows use (§3), so the note and the fields can't disagree. Order: shell fields, then breaks in order with fields in row order, then sky.
- **Unknown fields are named by the key as typed**, with its break if it's inside one: `sparkle (Break 1)`, top-level `theme`. A key can be anything, so show at most 40 characters of it (then `…`) and render it as text, never markup.
- **Show at most 5 names** per sentence, then `and {k} more`: `Applied, with 7 values adjusted: Stars (Break 1), Burst speed (Break 1), Burn time (Break 1), Stars (Break 2), Wind, and 2 more.`
- The note stays until the next edit, Copy or Apply, like the other states.

### 3.7 `hud` (lines 526–527)

Two lines, verbatim formats from the prototype:

```
12,345 particles · 60 fps
seed 20261112
```

Before the first launch the second line is `seed —`. Number formatting uses the browser locale, as the prototype's `toLocaleString()` does.

### 3.8 Page header and renderer failure

- `h1`: `Fireworks Sandbox` (`text-heading tracking-[0.02em] m-0 mb-0.5`).
- Subtitle: `Shell designer` (`text-small text-muted mb-3`). The prototype's "Shell designer prototype · PixiJS v8" is dropped (D4).
- Renderer failure, in the stage (2b fallback): `Fireworks can't start in this browser: {detail}. The controls still work, and your shell is kept in this browser.` Pixi falls back WebGL → WebGPU → Canvas (Luigi's Phase 1 canary record), so this appears only when every renderer fails.
- **Renderer fallback notice (D17).** Decided per renderer, by whether the visitor would see a difference and could do anything about it:

| Renderer | Notice | Why |
|---|---|---|
| WebGL | None | The prototype's path. |
| WebGPU (WebGL unavailable) | **None** | Still GPU-drawn, with the float trail target (`rgba16float`), so it looks the same. Telling people about a renderer they can't see would only worry them. |
| WebGL2 without float color buffers (`rgba8unorm` trails) | None | Slight banding in long trails at most. |
| Canvas | **Yes**, the stage note in §2.3 | No GPU: glow and trails can look flatter and big bursts can stutter, and the visitor *can* usually fix it. |

  Canvas copy, verbatim: `Your browser is drawing without the GPU, so glow and trails may look simpler. Turning on hardware acceleration in your browser settings usually fixes this.`
  - Static text, shown for the whole visit, no dismiss button (it's small, muted and in a corner). Not `aria-hidden`; it's read once in page order after the stage label.
  - Shows only after the renderer is up and `renderer === 'canvas'`; never at the same time as the renderer failure.
  - The stage's `data-renderer` attribute stays the test hook; the note is for people.

---

## 4. Tokens (final)

Values are the prototype's `:root` (lines 8–11) unless marked. **Names in bold are changes** from Luigi's Phase 1 `styles.css`; everything else is confirmed as written.

### 4.1 Color

| Token (`--color-…`) | Value | Prototype source | Used for |
|---|---|---|---|
| `surface-sunken` | `#04060c` | `--bg` | Page and stage background, Pixi clear color, fade rect |
| `surface` | `#0d111c` | `--panel` | Designer panel |
| `surface-raised` | `#141a29` | `--panel2` | Inputs, buttons, modal/notice cards |
| `border` | `#232b40` | `--line` | Section dividers, button edges, panel edge (decorative) |
| `border-hover` | `#3a4562` | `button:hover` | Button hover edge |
| **`border-control`** | **`#56627f`** | new | Edges of text inputs, selects and the textarea (3.1:1 against `surface`; §8.4) |
| **`border-control-hover`** | **`#6b7594`** | new | Hover edge for those fields |
| `text-primary` | `#e6e9f2` | `--text` | Body text, values |
| `text-muted` | `#8b93a8` | `--dim` | Labels, headings, notes, HUD, hint |
| `accent` | `#ffb347` | `--accent` | Focus ring, active tab, slider `accent-color`, notice edge |
| `accent-secondary` | `#ff7a59` | `--accent2` | Bottom of the primary gradient |
| `on-accent` | `#1a0d00` | `button.primary` | Text on the primary gradient |
| `danger` | `#ff9a8a` | `#err` | Error text, renderer failure |
| `success` | `#7ddc9f` | new (confirmed) | Positive inline state text |
| **`success-surface`** | `#12301f` | was `toast-success` | Success toast and success banners |
| **`on-success-surface`** | `#c9f2d7` | was `on-toast-success` | Text on it |
| **`danger-surface`** | `#3a1414` | was `toast-error` | Error toast, API-down banner |
| **`on-danger-surface`** | `#ffd2ca` | was `on-toast-error` | Text on it |
| `scrim` | `color-mix(in oklab, #000 60%, transparent)` | new (confirmed) | Modal scrim (Phase 5 dialogs) |

Why rename the toast tokens: the same fills serve the API-down banner now and save-result banners in Phase 5. A token named for one component gets copied under a second name the first time another component needs it. Tailwind classes become `bg-success-surface text-on-success-surface` and `bg-danger-surface text-on-danger-surface`.

Why `border-control`: `#232b40` on `#0d111c` is 1.34:1, so a text field or the JSON textarea has no perceivable edge (WCAG 1.4.11 asks for 3:1 for the boundary that identifies a field). Buttons keep `border` because their label already identifies them. Add a hand-written `@utility border-control` beside `border-default`, for the same `border-border` naming reason Luigi documented.

**Not tokens:** firework colors (`COLORS`, line 124) and the rainbow gradient belong to the engine (`engine/model/colors.ts`). Swatches read hex values from there; they are never duplicated in CSS.

### 4.2 Type

| Token | Value | Prototype use |
|---|---|---|
| `--font-sans` | system-ui stack | body (confirmed) |
| `--font-mono` | ui-monospace stack | textarea, HUD (confirmed) |
| **`--text-heading`** | `15px` | `h1` |
| **`--text-body`** | `13px` / line-height 1.4 | body, inputs, buttons |
| **`--text-small`** | `12px` | subtitle, hint, preset and tab buttons, values |
| **`--text-caption`** | `11px` | section headings, notes, HUD, textarea |

These generate `text-heading`, `text-body`, `text-small`, `text-caption`, replacing the `text-[15px]`-style arbitrary values in `home.html`. None collides with the `text-primary` / `text-muted` color utilities.

### 4.3 Shape and spacing (Tailwind values; no new tokens)

- Radius: inputs and buttons `rounded-md` (6px). Toasts `rounded-lg`, modal cards `rounded-xl` (as Luigi has them).
- Input padding `px-[7px] py-[5px]`; button padding `px-2.5 py-1.5`.
- Disabled (new; the prototype relies on browser defaults): `disabled:opacity-45 disabled:cursor-not-allowed`, and no hover border change.

---

## 5. Control specs (Signal Forms custom controls)

Both controls implement Signal Forms' value-control contract (a `value` model that the form field binds to, plus the optional `disabled` input), **not** `ControlValueAccessor` (OQ17). The plan has one line that still says "Shared form controls (ControlValueAccessors)" next to a line saying the opposite; §10 N3.

### 5.1 `range-row`

**Inputs:** `label`, `min`, `max`, `step`, `format: (v) => string` (the visible value), optional `valueText: (v) => string` (screen-reader text; defaults to `format`). The bound value is a `number`.

**Anatomy:** `grid grid-cols-[96px_1fr_44px] items-center gap-2 my-1.5`.

| Part | Element | Classes |
|---|---|---|
| Label | `<label for=…>` | `text-muted` |
| Slider | native `<input type="range">` | `w-full accent-accent` (`accent-color: var(--color-accent)`) |
| Value | `<output for=…>` | `text-right tabular-nums text-small text-primary` |

**Interaction:**
- The value updates on `input` (while dragging), not only on `change`, so the preview responds live (line 583). In preview loop, an edit doesn't re-fire; the next loop uses it (parity).
- Keyboard is the native slider's: arrows move one step, Page Up/Down move a larger step, Home/End jump to the limits. No custom key handling.
- `aria-valuetext` is set from `valueText`, so a screen reader says "1.6 seconds", not "1.6".
- Focus: the global `:focus-visible` ring (2px `accent`, offset 2px) around the slider.
- Disabled: the slider and value take `opacity-45`; the label stays readable. Disabled rows keep their value visible.
- Coarse pointer: `min-h-9` on the row.

### 5.2 `select-row`

**Inputs:** `label`, `options: { value, label }[]`, optional `swatch: (value) => SwatchSpec | null`. The bound value is a `string`.

**Anatomy:** `grid grid-cols-[96px_1fr] items-center gap-2 my-1.5`; the control cell is `flex items-center gap-1.5` (line 45).

| Part | Element | Classes |
|---|---|---|
| Label | `<label for=…>` | `text-muted` |
| Select | native `<select>` | `w-full rounded-md border border-control bg-surface-raised text-primary px-[7px] py-[5px] hover:border-control-hover` |
| Swatch | `<span aria-hidden="true">` | `inline-block size-3 flex-none rounded-full` |

**Swatch** (lines 43–44, 594–599):
- A named color: background is the engine hex, and the glow is `box-shadow: 0 0 6px <same hex>`.
- `rainbow`: background `conic-gradient(red, gold, lime, cyan, blue, magenta, red)`, glow color `#ff5cc8`.
- `none` (No change): the swatch is not rendered, and the select keeps its full width.
- The swatch is decorative; the color name in the select is the accessible value. Colors are never conveyed by the swatch alone.

**Interaction:** native select: keyboard type-ahead, arrows, the platform picker on mobile. The value commits on `change`. Focus ring as above.

### 5.3 Text input and textarea

Same field styling as the select: `border-control`, `bg-surface-raised`, `rounded-md`, `px-[7px] py-[5px]`. Textarea uses the mono caption type.

### 5.4 Reduce flashing switch

A native `<input type="checkbox" role="switch">` inside the label row, styled as a 28×16 track: off `bg-surface-raised border-control`, on `bg-accent`, thumb `text-primary` / `on-accent`. The visible `On`/`Off` text sits in the value column, so state is never color-only. Space toggles it (native).

---

## 6. Behavior details

### 6.1 Click / tap to fire (lines 560–567)

A pointer-down on the stage fires the current shell at the pointer, converted with `screenToWorld`. It is ignored within 60 world units of the ground (`wy < GROUND - 60`). In preview loop it pushes the next loop back by one `shellDuration`.

### 6.2 Space to launch (lines 706–710)

Space fires Launch, except when focus is somewhere Space already means something. Ignore the key when **any** of these is true (D10 widens the prototype's list):
- focus is on `input`, `textarea`, `select`, `button`, `a[href]`, `summary`, `[contenteditable]`, or any element with `role` `tab`, `switch`, `button`, `checkbox` or `slider`;
- Alt, Ctrl or Meta is held;
- `event.repeat` is true (holding Space fires once, not 30 shells a second; Skyler confirmed, 2026-11-13);
- the replace confirmation (§6.4) is open;
- the flashing notice (§7.2) is showing.

The listener is registered by the designer page and removed on destroy, never on `window` for the whole app.

### 6.3 API down (decides Luigi's open item)

Today: when `/health/live` fails, `App` shows a blocking `role="dialog"` modal; `/health/live` itself is exempt from toasting, but `SessionService.load()`'s `GET api/me` fails too and the interceptor toasts `Request failed for GET api/me`. So the visitor sees the modal and a toast that quotes a URL.

**Ruling:**
1. **No blocking modal on `/`.** Anonymous play never needs the server (plan §3.4), so an outage must not cover the designer. Replace the modal with a banner at the top of the panel, under the subtitle:
   - `role="status"`, `rounded-md bg-danger-surface text-on-danger-surface border border-default px-3 py-2 mb-3 text-small`.
   - Copy: `Can't reach the server right now. You can keep designing; your shell is kept in this browser.` Button: `Try again` (while checking: `Checking…`, disabled).
   - On recovery the banner disappears; no success toast.
   - The banner keeps the Phase 1 purpose noted in `app.ts` (the only visible proof the dev proxy's `/health` rule works).
   - In Phase 5 this banner is also where Save explains why it's unavailable; Phase 5 copy will extend it, not add a second surface.
2. **One outage, one message.** `GET api/me` becomes self-handled: `SessionService` already turns its failure into `status: 'unavailable'`, so nothing else should report it. Add it to `SELF_HANDLED_PATHS` (or send it with `SUPPRESS_ERROR_TOAST`; Luigi picks, but one mechanism, with the spec updated).
3. **Generic error toast copy** (the interceptor's fallback for calls that don't handle their own errors): `Something went wrong talking to the server. Try again in a moment.` Method, URL and status go to the console only. Phase 5 operations supply their own specific copy.
4. **Toast timing:** success toasts auto-dismiss at 4 s (as now). Error toasts stay 8 s and pause while hovered or focused. Error toasts use `role="alert"`; success toasts stay in the polite region.

### 6.4 Replace confirmation (D16)

Skyler's rulings (plan 2c, 2026-11-12 and 2026-11-13): a preset or a JSON Apply asks first **only when it would replace something the visitor changed in the shell or the sky**. Display settings and the active tab never count.

**When it asks.** The designer keeps two booleans, **`shellDirty`** and **`skyDirty`**. There's no baseline snapshot and no comparison of values.

- **`shellDirty` is set** by any visitor change to the shell, meaning everything but the sky: a shell field (Name, Burst height, Angle jitter), a break field, `+ Add` or `− Remove`.
- **`skyDirty` is set** by any visitor change to a Sky field (Gravity, Wind).
- **Never counted, by either flag:**
  - display settings (Mode, Motion blur, Star budget, the Reduce flashing switch) and selecting a break tab. They're autosaved in the draft but never make a load ask, because no load replaces them;
  - the Manual mode forced at load under reduced motion (§7.1);
  - Reduce flashing following the OS while the visitor hasn't chosen (§7.1), including an OS change mid-visit;
  - restoring the draft on load;
  - the flashing notice's `Turn on Reduce flashing` button (it's a display setting);
  - the JSON panel's text. Typing there sets nothing, because pending text isn't lost by a preset or an Apply (it stays pending after `Keep editing`, and Apply is what consumes it). Revert sets nothing either.
- **Cleared** only by what replaces the part they guard:
  - a preset load clears `shellDirty` and leaves `skyDirty` as it was, because a preset keeps the sky;
  - a successful Apply (with or without adjustments) clears `shellDirty`, and clears `skyDirty` only when the JSON has a `sky` object (otherwise the kept sky is still the visitor's);
  - the first-visit default (Peony) starts with both clear.
- **Phase 5 additions** (`phase-5.md` §4): opening a link through `/c/:code` loads a working copy with **both set** (schema.md §11.2, Skyler's L1), and a **successful Save clears both**, because saved work can't be lost by a replace.
- **They're flags, not a diff.** Change a field and set it back, and it still counts. The cost is one extra question; the alternative was a snapshot to compare against, which Skyler ruled out.
- **They're kept in the draft**, so a reload keeps them: edit, reload, click a preset, and it still asks. Reading them **fails safe**: only an explicit `false` reads as clean, so a missing, `null` or malformed flag reads as set. A draft written before the split, with one `dirty` flag, reads it for both. A corrupt draft is dropped whole and the designer opens clean on the first-visit default (one key, one lifecycle; `toad-a-baseline-and-its-draft-share-one-lifecycle.md`).

**Order of checks.**
- **Preset click:** `shellDirty`? Then ask. Otherwise load and fire. A sky change alone never makes a preset ask, because the preset keeps the sky.
- **Apply:**
  1. Parse and `normalize` first. Invalid JSON or an invalid shell shows its `Couldn't apply` note (§3.6) **without asking**. There's nothing to confirm, and a dialog that ends in an error is worse than the error.
  2. Ask when `shellDirty`, or when the JSON has a `sky` object and `skyDirty`.
  3. Otherwise apply.

  The adjusted or ignored note appears only after the visitor confirms.

**Form.** An in-page dialog component (`confirm-dialog`, shared; Phase 5's discard and delete prompts will reuse it), never `window.confirm()`. Build it on a native `<dialog>` opened with `showModal()`: that gives the top layer, an inert page behind it, focus containment and Escape for free.

| Part | Spec |
|---|---|
| Dialog | `role="alertdialog"`, `aria-labelledby` → title, `aria-describedby` → body. `w-[calc(100%-32px)] max-w-[380px] rounded-xl bg-surface-raised border border-default text-primary p-4 shadow-[0_16px_48px_rgba(0,0,0,0.55)]` |
| Backdrop | `::backdrop { background: var(--color-scrim); }` |
| Title | `h2`, `text-heading font-semibold m-0 mb-1.5` |
| Body | `p`, `text-body text-primary m-0 mb-4 break-words` (a shell name can be 80 characters with no spaces) |
| Buttons | `flex justify-end flex-wrap gap-2`. The safe button comes first and is a plain button. The replace button is the primary gradient button. |

**Copy.** `{name}` is the current shell's name in curly quotes. When the name is blank, drop the quoted name and its commas: `This replaces your current shell, including…`.

Preset load (example: Willow):
> **Load Willow?**
>
> This replaces your current shell, “{name}”, and its breaks, and goes back to Break 1. Sky and display settings stay as they are.
>
> `Keep editing` · `Load Willow`

JSON Apply, when the JSON has a `sky` object:
> **Apply this JSON?**
>
> This replaces your current shell, “{name}”, including its breaks and sky, with the shell in the JSON panel. Display settings stay as they are.
>
> `Keep editing` · `Apply JSON`

JSON Apply, when the JSON has no `sky` key:
> **Apply this JSON?**
>
> This replaces your current shell, “{name}”, and its breaks with the shell in the JSON panel. Sky and display settings stay as they are.
>
> `Keep editing` · `Apply JSON`

The body says what's replaced and what isn't. A preset never touches the sky or display, and Apply touches the sky only when the JSON has one, so the visitor's sky edits and display settings can survive a replace that asks. Copy that says "your changes will be lost" would be wrong whenever some of their changes are kept. The Apply variant is picked from the parsed JSON (does it have a `sky` key), the same check that decides whether the sky is replaced (§3.6), so the dialog and the result can't disagree.

**Focus and keys.**
- On open, focus goes to **`Keep editing`**. The replace is the action you can't take back, so the default is the one you can.
- **Enter** and **Space** activate the focused button, as native buttons do. There's no dialog-wide Enter shortcut, so pressing Enter straight after opening keeps editing. A visitor who wants to replace presses Tab, then Enter.
- **Escape** = `Keep editing`. Handle both the dialog's `cancel` event and its `close` event: Chrome's close-watcher rules can close a modal on Escape without firing `cancel` (Luigi, `luigi-designer-2c.md` item 5). The dialog answers once: any close that didn't come from the replace button is `Keep editing`.
- Clicking the backdrop does nothing. A stray click shouldn't count as an answer either way.
- Tab cycles between the two buttons (native modal containment).
- On close, either way, focus returns to the button that opened it: the preset button or `Apply`.

**Outcomes.**
- **Keep editing:** nothing changes: fields, tab, JSON text (pending edits stay pending, with their note), draft, dirty flag (still set), loop timer. Nothing fires.
- **Load Willow / Apply JSON:** exactly what happens when nothing needed asking. The shell loads, the tab goes to Break 1, it fires once, the loop timer resets, and the flags clear as listed above. Apply then shows its §3.6 note.
- While the dialog is open, the stage keeps playing (Preview loop and Auto show continue behind the scrim), and Space doesn't launch (§6.2).

---

## 7. Photosensitivity and reduced motion (moved forward from Phase 7)

### 7.1 Reduce flashing: what it changes

One viewer setting, `quality.reduceFlashing: boolean`, never saved with a shell.

- **Follows the OS until the visitor chooses.** The stored value is a choice: `unset`, `on` or `off`.
  - `unset` (every first visit, and any draft from before the visitor touched the switch): the effective value is `matchMedia('(prefers-reduced-motion: reduce)').matches`, re-read live, so an OS change mid-visit applies at once.
  - The visitor flips the switch: the choice becomes `on` or `off` and is written to the draft's display settings (inside `fireworks.draft.v1`; there's no separate key). From then on the OS setting is ignored, across reloads, until the draft is lost.
  - The draft never stores the effective value while the choice is `unset`. Storing it would freeze today's OS setting as if the visitor had picked it.
  - The flashing notice's `Turn on Reduce flashing` button counts as choosing `on`.
  - There's no "follow my device" option in the UI. A visitor who has chosen keeps their choice; that's the point of choosing.
- **Renderer effects** (all in `engine/render`, the per-kind visual rules; the sim is untouched, so playback stays deterministic and golden tests don't move):

| Effect | Normal (prototype) | Reduce flashing |
|---|---|---|
| Strobe stars (line 452) | Alpha toggles 1 ↔ 0.06 at 7 Hz after 30% of burn | **No toggle.** Strobe stars render as ordinary steady stars. |
| Burst flash, `K_FLASH` (line 463) | Peak alpha 0.9, 140 px × size | **Peak alpha 0.3, 100 px × size.** |
| Glitter flicker (line 458) | Alpha 1 ↔ 0.15 | **Alpha 1 ↔ 0.5** (shimmer, not flicker). |
| Crackle pops | Unchanged | Unchanged (small and brief). |

- **Driver effect:** in Auto show, the gap between launches becomes 0.8–1.75 s instead of 0.35–1.75 s, so large bursts can't arrive faster than about one a second.
- **Reduced motion at load:** when the OS setting matches, the designer opens in **Manual on every load**, whatever mode the draft saved (Skyler's ruling). Nothing moves until the visitor launches.
  - The visitor can switch to Preview loop or Auto show during the visit. That choice is saved to the draft like any mode change, but the next load opens in Manual again while the OS setting holds.
  - The forced Manual is never written to the draft, and it never sets dirty (§6.4). Neither does Reduce flashing following the OS.
  - Turning Reduce flashing on in-app doesn't change the mode. The OS preference is about motion; the toggle is about flashing.

### 7.2 Flashing notice

A non-modal card on the stage that **holds playback until it's dismissed** (Skyler, 2026-11-13). The panel stays fully usable while it shows, so a visitor can turn on Reduce flashing or pick a mode before anything fires.

**When it shows.** When the visitor hasn't dismissed it before (`fireworks.flashNotice.v1` in localStorage; if storage is unavailable, it shows on every load). It's decided once, at page load, before the first frame, so nothing has fired yet when it appears.

**What's held while it shows.** Every way a shell can reach the sky:
- the Preview loop timer and the Auto show driver: they don't run and their timers don't advance, so nothing queues up to burst at once on dismiss;
- click and tap on the stage: ignored;
- Space: ignored (§6.2);
- `Launch` and `Replay last`: disabled, with `title="Close the flashing notice to start."` (Replay is disabled anyway before the first launch, D7);
- a preset click or a successful Apply: loads the shell (with the §6.4 confirmation if dirty) but doesn't fire it.

Not held: every panel control, Mode included; `Clear sky` (harmless, the sky is empty); resize; the HUD (it reads `0 particles`).

**How the stage looks.** **Empty sky**: the background and the skyline, drawn as normal, with no shells or particles. The renderer keeps running so resize and the skyline stay correct; only launches are held. (A frozen last frame would be the same picture here, because the notice only appears before the first launch, so there's no separate "paused frame" to design.)

**On dismiss**, by either button: the notice is removed, `fireworks.flashNotice.v1` is written, and playback starts in the current mode: Preview loop fires its first burst right away and resets its timer, Auto show starts its driver, Manual waits for a click, tap, Space or `Launch`.

**Style.** `rounded-md bg-surface-raised border border-default border-l-[3px] border-l-accent text-primary text-small px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]`. Buttons `flex flex-wrap gap-2 mt-2.5`. `role="region"`, `aria-label="Flashing lights notice"`. Not a dialog: nothing behind it is inert, and there's no scrim.

**Copy.** The second sentence depends on the current mode and updates live if the visitor changes Mode while the notice shows:
- Preview loop or Auto show: `Fireworks start when you close this notice.`
- Manual: `You can launch fireworks once you close this notice.`

When Reduce flashing is **off**:
> **Flashing lights.** {mode sentence} Bursts flash, and some effects strobe. If flashing affects you, turn on Reduce flashing first. To stop the loop later, set Mode to Manual.
>
> `Turn on Reduce flashing` (primary gradient) · `Continue`

When it's **already on** (OS setting or an earlier choice):
> **Flashing lights.** {mode sentence} Reduce flashing is on, so strobe is off and burst flashes are dimmed. You can change this under Display.
>
> `Continue`

Drop the "To stop the loop later" sentence when the mode is Manual (there's no loop to stop).

**Buttons.**
- `Turn on Reduce flashing`: sets the choice to `on` (a visitor choice, written to the draft, §7.1), then dismisses, then playback starts with Reduce flashing already in effect. Its first burst is never an unreduced one.
- `Continue`: dismisses and starts playback. Changes nothing else.
- No close (×) button and no Escape handling: both answers are explicit, and an × would be a third, unlabeled way to start playback.

**Focus.**
- On load, if focus is still on `body` (the visitor hasn't clicked or tabbed into anything), focus moves to the notice's first button: `Turn on Reduce flashing` when it's off, `Continue` when it's on. A keyboard visitor's first Space or Enter therefore answers the notice (and with the off copy, the safer answer) instead of doing nothing. If focus is already elsewhere, it's left alone.
- **DOM order stays panel, then stage**, as in the prototype, so the page's `h1` is the first thing read and Tab order matches the visual order (no `flex-row-reverse`). The notice sits inside the stage's `<main>`, right after the stage element. Don't move the stage before the panel to make the notice read earlier: the initial focus move and the two cues below reach the visitor instead.
- **Screen readers hear the notice text when it takes focus.** Give the copy paragraph a unique `id` and point both buttons' `aria-describedby` at it. The region's name alone ("Flashing lights notice") doesn't say what the notice asks.
- **A cue in the panel.** While the notice shows, the playback note under Mode reads `Close the flashing notice on the stage to start.` instead of the click/tap sentence, so a visitor reading the panel from the top, before Launch can be pressed, learns why Launch is unavailable. The disabled buttons' `title` stays, but a disabled button's title isn't reachable by keyboard.
- On dismiss, the focused button is removed with the notice, so focus goes to `Launch`, which is now enabled. The next Space presses it.

The notice, the hold, Manual under reduced motion, and the Peony-only arrival loop (§1) are the mitigation. `/` auto-plays once the notice is gone (Skyler, 2026-11-12).

### 7.3 Later phases

- **Phase 5:** the player's own photosensitivity notice and a Reduce flashing control on the player, since `/s/:code` drops visitors straight into autoplay (Skyler accepted, 2026-11-12). Specified in `phase-5.md` §8.
- **Phase 7:** full keyboard audit across every page, automatic star budget, and the mobile DPR cap.

---

## 8. Accessibility

### 8.1 Focus

- Keep Luigi's global `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }`. Accent on `surface` is 10.6:1.
- Never remove an outline without replacing it. The primary gradient button keeps the same outline; the 2px offset separates it from the button's own orange.
- No focus moves on preset load or mode change. After **Remove**, focus goes to the newly active tab (the Remove button may have just disabled itself). After **Add**, focus stays on Add.
- Replace confirmation: focus goes to `Keep editing` on open, and returns to the opening button on close (§6.4).
- Flashing notice: on load, focus goes to its first button if nothing else has focus; on dismiss, to `Launch` (§7.2), once it's enabled. DOM order stays panel, then stage (§7.2).

### 8.2 Keyboard map

| Where | Keys |
|---|---|
| Anywhere on `/` (outside excluded elements, §6.2) | Space: launch |
| Break tabs | Left/Right: previous/next tab, and select it (automatic activation; panels are cheap). Home/End: first/last. Tab: leaves the tablist into the break fields. Roving `tabindex` (only the active tab is in the tab order). |
| Sliders, selects, switch | Native |
| Replace confirmation | Tab/Shift+Tab: between its two buttons. Enter/Space: the focused button. Escape: Keep editing. |
| Flashing notice | Enter/Space: the focused button. No Escape (§7.2). Space doesn't launch while it shows. |
| Stage | Not focusable. Its keyboard equivalent is Launch / Space. The stage container has `aria-label="Fireworks sky"` and `role="img"`. |

Tabs: `role="tablist"` with `aria-label="Breaks"`, each tab `role="tab"` with `aria-selected` and `aria-controls`; the fields container is `role="tabpanel"` with `aria-labelledby` the active tab.

### 8.3 Live regions

One polite region in the panel for break add/remove announcements; the JSON note is its own polite region. The HUD is `aria-hidden`.

### 8.4 Contrast (measured, WCAG 2.x)

| Pair | Ratio | Needs |
|---|---|---|
| `text-primary` on `surface` / `surface-raised` | 15.5 / 14.3 | 4.5 |
| `text-muted` on `surface` / `surface-raised` / `surface-sunken` | 6.1 / 5.7 / 6.6 | 4.5 |
| `accent` on `surface` (active tab text, focus ring) | 10.6 | 4.5 / 3 |
| `on-accent` on `accent` / `accent-secondary` (primary button, both gradient ends) | 10.7 / 7.4 | 4.5 |
| `danger` on `surface` / `surface-sunken` | 9.2 / 9.9 | 4.5 |
| `success` on `surface` | 11.3 | 4.5 |
| `on-success-surface` on `success-surface` | 11.7 | 4.5 |
| `on-danger-surface` on `danger-surface` | 11.9 | 4.5 |
| `border-control` against `surface` | 3.1 | 3 (field boundary) |
| `border` against `surface` | 1.34 | decorative only, never a field's only edge |

The HUD and hint sit over fireworks, so their contrast varies; the prototype's 1px black text-shadow stays.

---

## 9. Deliberate departures from the prototype

1. **Flashing notice** on the stage on first visit, holding playback until it's dismissed (§7.2). The prototype has none and starts the loop at once.
2. **Reduce flashing** setting and its renderer and Auto show changes, plus Manual as the starting mode under `prefers-reduced-motion` (§7.1). Pulled forward from Phase 7.
3. **"Sky & physics" splits into Sky (saved) and Display (this device)**, with a note under each, and Reduce flashing added to Display. The plan already separates `sky` from `quality`; the UI says which settings travel with the shell.
4. **Subtitle** is `Shell designer`, not `Shell designer prototype · PixiJS v8`.
5. **Option labels are display copy** (`Peony`, `No change`, `Rainbow`), not raw schema values (`peony`, `none`). Values are unchanged.
6. **Change at is disabled when Changes to is No change**, with a note. The prototype leaves it live although it has no effect.
7. **Replay last is disabled until the first launch.** The prototype's button silently does nothing (line 689).
8. **The JSON panel keeps unapplied edits.** The prototype overwrites the textarea on every field change (line 672), losing typed edits; its unused `jsonDirty` (line 670) suggests this was intended. A Revert button appears while edits are pending.
9. **JSON Apply reports adjusted values as a success with a caveat** and rejects invalid documents with a reason in field-label language that names the break (`Pattern (Break 1) …`). The prototype only checks for a non-empty `breaks` array (line 700).
10. **Space is ignored on buttons, tabs, switches and links, with modifiers, and on key repeat.** In the prototype, Space on a focused preset button fires Launch instead of pressing the button (its exclusion list is only INPUT, TEXTAREA, SELECT), which breaks keyboard use.
11. **Form fields get a 3:1 edge** (`border-control`) instead of `--line`, and every control gets a visible focus ring and a defined disabled style.
12. **Mobile panel height uses `45dvh`**, not `45%`, so browser chrome doesn't hide it. Touch targets grow on coarse pointers, and the hint (`Tap the sky to fire`), Mode note and Launch label drop the keyboard reference there.
13. **API-down state** is a non-blocking banner (no prototype equivalent; replaces the Phase 1 modal).
14. **Copy changes:** the JSON note no longer mentions ".NET API", the Replay title says "the same seed" in plain words, the renderer failure says what still works, and the Copy-blocked message names the platform's shortcut.
15. **Accessibility semantics** the prototype lacks: tablist for breaks, `aria-valuetext` on sliders, `<output>` for values, live regions, `aria-hidden` HUD, labeled stage.
16. **Replace confirmation.** A preset load or a JSON Apply asks first when the designer is dirty, in an in-page dialog (§6.4). The prototype replaces without asking. Skyler's rulings, plan 2c.
17. **Canvas renderer note** on the stage when Pixi fell back to Canvas (§3.8). The prototype says nothing about which renderer it got.

Not departures (kept on purpose): when the designer is clean, a preset click loads and fires immediately with no prompt; a preset (and JSON with no `sky`) keeps the current gravity and wind, as the prototype's world settings do; ranges and steps, the value formats, the three modes and their labels, and click-to-fire ignoring the bottom 60 units.

---

## 10. Notes for implementers and owners

- **N1 (Luigi: `normalize`).** Built (`luigi-designer-2c.md` item 6): Yoshi's `{ ok, shell, adjustments }` / `{ ok: false, errors }` shape, with `ShellIssue.code`, `value` and `options` so the designer phrases reasons from `engine/model/labels.ts` rather than from developer `message` text. §3.6 says which adjustment kinds the note counts and how paths map to row labels.
- **N2 (Luigi).** `shellDirty` and `skyDirty` (§6.4) mean "the visitor changed this part since it was last replaced or saved", nothing more. They guard replaces; they don't drive the Phase 5 "Not saved" indicator, which reads a third flag, `saved` (`phase-5.md` §4). Nothing should call the dirty flags "unsaved" in copy. `confirm-dialog` is shared so Phase 5's prompts reuse it.
- **N3 (plan text).** Plan 2c lists "Shared form controls (ControlValueAccessors): `range-row`…" one bullet after saying they're Signal Forms custom controls, not ControlValueAccessors. OQ17 governs; the plan line needs correcting by whoever owns the plan text.
- **N4 (Peach).** Observable acceptance points from this note: the Space exclusions in §6.2 (each one testable by focusing that element), Reduce flashing defaults under an emulated `prefers-reduced-motion` (Chrome DevTools rendering panel, or Playwright `reducedMotion: 'reduce'`), Manual as the starting mode in that state, the notice dismissal surviving a reload, exactly one API-down surface with the API stopped, and no toast quoting a URL. From §6.4: a clean designer never asks; a change set back to its old value still asks (flag, not diff); dirty survives a reload; the forced Manual, an OS-driven Reduce flashing flip and the notice's `Turn on Reduce flashing` never make it ask; the preset dialog says the sky stays, and the Apply dialog's wording follows whether the JSON has `sky`; initial focus on `Keep editing`; Enter straight after opening keeps editing; Escape keeps editing (with or without a `cancel` event); a backdrop click does nothing; focus returns to the opener. From §7.2: with fresh storage, nothing fires for 10 s while the notice shows, in any mode (HUD at 0 particles), stage clicks and Space do nothing, `Launch` is disabled; `Continue` in Preview loop fires within about 1 s; `Turn on Reduce flashing` leaves the switch On and the first burst reduced; focus starts on the notice's first button and lands on `Launch` after. From §3.6: `{"breaks":[{"stars":9999}]}` reads `Applied, with 1 value adjusted: Stars (Break 1).` (defaults filled for the other fields aren't counted). From §7.1: with the switch never touched, flipping the emulated OS setting flips the effective value, and the stored draft has no Reduce flashing value. From §3.8: forcing Canvas shows the note, and forcing WebGPU doesn't.
- **N5 (Toad).** The reduce-flashing rules live in the renderer, so they need a renderer-level check (the alpha a strobe star gets at a given age with the flag on and off), not a sim golden. The sim goldens must not change when the flag flips; that's a cheap negative control.

No HTML mockup accompanies this note: the layout is the prototype's, and the additions are small enough to read from the specs above.

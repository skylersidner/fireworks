# Phase 6 (Show Builder): design-review notes

**Ceremony:** the design-review before Phase 6 is implemented. Facilitator: Rosalina. Participants: Luigi (implements), Peach (acceptance, `acceptance/phase-6.md`, which cites this file as **p6-spec**), Yoshi (`TimelineDriver`, seek, the end estimate: §13.3 notes), Mario (confirms the route at the start of the build batch).
**Date:** 2026-11-14.
**Inputs:** plan Phase 6; schema.md §4 (sky precedence, embedded shells, cue, firing rule §4.4, end §4.5), §5.1, §11, §13; `designer-2c.md`; `phase-5.md`; `acceptance/phase-6.md`; code: `engine/model/show.ts`, `engine/loop/timeline-driver.ts` (still a stub), `engine/sim/simulation.ts` (`launch` l.87–107, `shellDuration` l.117, shell stepping l.139–181), `engine/model/labels.ts`, `app/app.routes.ts`, `app/core/open-creation.ts`, `app/core/device-preferences.ts`, `app/shared/link-copy.ts`, `features/player/pages/player-page/*`, `features/designer/pages/designer-page/designer-page.html`, `features/mine/*`.
**Oracle:** `prototypes/fireworks-prototype.html` has **no show or timeline UI**. Its only "show" is the designer's `Auto show (random presets)` mode (l.77, l.508), a random driver with no cues, no timeline and no saved order. Everything in this note is new surface. It reuses the 2c tokens and controls and the Phase 5 save bar, status block, toasts, confirm dialog, notice and test-mode banner. No token value changes.
**Mockup:** `docs/fireworks-app/design/phase-6-mockup.html` (static: the builder with a selected cue, its stage marker and the tail at Fit zoom; the empty, capped and early-end states; and the show player's ended state).

> **Updated 2026-11-14 after the post-implementation review** (Skyler's rulings): Show JSON (§9.5) moves to Phase 7; Motion blur is a device-wide preference (§10.1); the builder's fields use native controls, not Signal Forms (§8.1); Undo is session-only, 50 steps, and ⌘/Ctrl+Z in a text field is the field's own undo (§18 Q1); shells are not edited in place (§18 Q2). The build's deviations and their triage are in §19.

The copy in this note is final, so use it verbatim. `{name}` follows the Phase 5 rules: curly quotes, text only, and `<bdi>` or FSI/PDI isolation. Times are written `m:ss.s` (`0:12.5`, `10:00.0`) everywhere a visitor reads one, and spoken through `aria-valuetext` as `12.5 seconds` or `1 minute 2.5 seconds`.

---

## 1. Rulings from this review (summary)

| # | Question | Ruling | Where |
|---|---|---|---|
| S1 | Builder route | **`/show`**, for Mario to confirm. A show link still opens through `/c/:code`, which redirects to `/show`. | §2 |
| S2 | Layout | The designer's frame: a 340px panel (Show, Cue inspector, Library, Sky, Display; Show JSON in Phase 7) and a stage column holding **stage, transport and timeline** stacked. | §3 |
| S3 | Adding cues | Pick a library shell, then **Add cue** (at the playhead), **click the sky** (at the playhead, at the clicked position), or drag a library shell onto the timeline. A shell is copied into the show, without `sky`, on its first use, and an identical shell already in the show is reused. | §4 |
| S4 | Move, duplicate, delete | Drag on the timeline (0.1 s snap), the inspector fields, or the keys in §4.4. A duplicate lands 0.5 s later with a new id and a new seed. Delete needs no confirm (see Q1, Undo). | §4 |
| S5 | Zoom and scroll | Starts at **Fit** (the whole show and its tail). Zooms from Fit up to 200 px/s. The transport's scrub bar is also the whole-show overview. | §5 |
| S6 | 1000 cues | The cue lane is **one canvas**, redrawn on change and never per frame. Level of detail switches at 20 px/s. It's never 1000 DOM nodes. | §6 |
| S7 | Burst marker and tail | Each cue draws its launch tick at `t`, a rise bar, and a burst dot at `t + rise`, plus a smaller dot for each later break. Past `duration` the lane is hatched, labelled **Tail**, and runs to an **Ends about m:ss** marker. | §7 |
| S8 | Cue `x` | Shown as **Position**, 0–100% across the sky: where the shell bursts, not where it leaves the ground. It's edited in the inspector, or by dragging the selected cue's marker on the paused stage. | §8 |
| S9 | Seed | **Visible** in the inspector as `Seed 1834729`, with a **New seed** button. Duplicate gets a new seed. Yoshi confirms that a visitor-chosen re-roll is allowed under schema.md §4.3's "never re-derived" (§13.3 Y3). | §8.3 |
| S10 | No empty shows | Save stays visible but is `disabled`, with an always-visible note: `A show needs at least one cue before it can be saved.` Nothing is sent. | §9.1 |
| S11 | Caps and invalid states | Every cap blocks the action in place and says why, next to the control. Duration can't be set below the last cue's launch. Nothing out of range is ever stored. | §9 |
| S12 | Dirty and saved | One `dirty` flag (any change to the show document), plus the Phase 5 `saved` flag and `source`. It's the same F4 rule. | §10 |
| S13 | Player `/s/` for shows | Plays once from 0 to the last particle, with no loop. The time is in the top bar, there's an ended state with Replay, and the notice names the length and whether the show strobes. | §11 |
| S14 | `/mine` | Lists **both kinds** in one grid, with no filter (Peach 6j.1). Cards read `Show ·` or `Shell ·`. Copy is updated for both kinds. | §12 |
| S15 | Flashing | The builder never auto-plays. The notice holds Play. Under Reduce flashing, a new renderer-only rule stops burst flashes from coming faster than 3 a second (dense shows). | §14 |
| S16 | Show issue paths (Peach N1, and phase-5.md §11.1 deferred) | Labels and qualifiers by cue time and shell name: `Seed (Cue at 0:12.5)`, `Stars (Peony, Break 1)`. | §15 |

---

## 2. Route

- **`/show`** is the Show Builder: lazy, with its own draft (§10). Singular, because there's one show draft, as there's one designer draft at `/`. It doesn't collide with the player: `underPrefix('s')` matches only a first segment exactly equal to `s`.
- Rejected alternatives: `/shows` reads as a list. `/shows/new` implies `/shows/:code/edit`, which schema.md §11.1 rules out. `/builder` doesn't say what it builds.
- `/c/:code` with `kind: "show"`: GET, then `upgradeShow`, then `normalizeShow`, then the §10.3 confirm if the **builder** draft is dirty, then write the builder draft, then navigate to `/show` with `replaceUrl`. The designer draft is never touched. This is the same load-then-redirect contract as shells (schema.md §11.1).
- **Navigation between the two editors** (new):
  - The designer's `h1` row gains a `Show Builder` link before `My creations`. It's always visible, because the builder works with writes off.
  - The builder's `h1` row has `Shell designer` and `My creations` (the latter only when `canWrite`, as on `/`).
  - Style: the Phase 5 `My creations` link style, separated by `gap-3`.

---

## 3. Layout

### 3.1 Desktop (wider than 760px)

```
+------------------- 340px -------------------+------------------------ flex 1 ------------------------+
| Fireworks Sandbox   Shell designer  My creations |  HUD                                               |
| Show Builder                                |              [Flashing notice, first visit]            |
| [test-mode banner] [API banner] [status]    |                                                        |
| [Save] [Share]                    Not saved |                    Pixi stage                          |
| note (owner note / empty-show note)         |        (selected cue's marker when paused, §8.2)       |
|---------------------------------------------|                                                        |
| SHOW      Name / Duration (s)               |▄▄▄ skyline ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄|
| CUE       inspector, or "Select a cue…"     |--------------------------------------------------------|
| LIBRARY   In this show / From the designer /|[Play] [|<]  0:12.5 / about 1:07  [====overview====]  [-][Fit][+] |
|           Presets / My shells               |[Add cue] Peony at 0:12.5     [Duplicate] [Delete]   50 cues     |
| SKY       Gravity / Wind                    | 0:00     0:10     0:20  ...  1:00 |////Tail////| Ends about 1:07 |
| DISPLAY   Motion blur / Reduce flashing     | ●   ●●    ●     ●   ●  ●●   ●    |////////////|                 |
| (SHOW JSON: Phase 7)                        |   ●    ●     ●●   ●      ●     ● |////////////|                 |
+---------------------------------------------+--------------------------------------------------------+
```

- Page and panel: exactly as 2c §2.1 (`flex h-full overflow-hidden`, panel `w-[340px] … overflow-y-auto`). Panel subtitle: `Show Builder`.
- Stage column (`main`): `flex-1 min-w-0 flex flex-col`. The stage is `relative flex-1 min-h-[200px] bg-surface-sunken`, with `cursor-crosshair` when sky clicks add cues (§4.1). Under it is the **dock**: `flex-none h-[232px] border-t border-default bg-surface flex flex-col`, holding the transport row (36px), the timeline toolbar (32px) and the timeline (the rest: a 22px ruler and the cue lane).
- Panel sections in order: **Show**, **Cue**, **Library**, **Sky**, **Display**. (**Show JSON** joins at the end in Phase 7, §9.5.) The 2c section and heading classes apply.
  - **Show:** `Name` (2c text input, the same 80-character rule) and `Duration` (§9.3).
  - **Sky:** the 2c Gravity and Wind range rows, with the note `Every shell in the show plays under this sky. Gravity also changes how long shells take to rise, so burst markers move.`
  - **Display:** Motion blur and Reduce flashing (the device-wide choice, `device-preferences.ts`). **No Star budget:** the builder previews at `starBudget` 1, like the player, so the preview is the show other people see (concurs with Peach Q3; schema.md §13). **No Mode:** the transport replaces it.
- The HUD stays (2c §2.3), with its count and fps. The hint reads `Click the sky to add a cue at the playhead · Space to play` (coarse pointer: `Tap the sky to add a cue at the playhead`).
- DOM order: panel, then `main` (stage, then dock). Tab order is panel → notice → transport → toolbar → timeline. It's not reordered with CSS (2c §7.2).

### 3.2 760px and narrower

- Like 2c §2.2: `max-[761px]:flex-col-reverse`, so `main` is on top and the panel is below it at `h-[40dvh]`. Inside `main` the stage takes `flex-1 min-h-[160px]` and the dock shrinks to `h-[176px]` (the ruler and 3 rows of cues).
- Touch: tap selects, drag moves (pointer events with `touch-action: none` on the lane only), and a two-finger pinch zooms. The transport's scrub bar is the native range, so it works with touch already. Desktop-first stands (OQ10). Phase 7's touch pass owns anything beyond this.

---

## 4. Cues: add, move, duplicate, delete

### 4.1 Adding

**The active shell.** The library has one **active shell**, the one new cues use. Clicking a library item makes it active (`aria-pressed="true"`, accent edge). On a first visit the active shell is the first preset (Peony). Making a shell active **changes nothing in the document**. A library shell is copied into `shells` only when a cue first uses it.

Three gestures add a cue, all with the active shell:

| Gesture | `t` | `x` | `burstHeight` |
|---|---|---|---|
| **Add cue** (toolbar) or `A` on the timeline | the playhead, rounded **up** to 0.1 s | `0.5` | absent (the shell's own) |
| **Click/tap the sky** (playing or paused) | the playhead, rounded up to 0.1 s | the click's fraction of the stage width | absent |
| **Drag a library item onto the lane** (pointer only) | the drop point, snapped to 0.1 s | `0.5` | absent |

- **Why round up:** a cue never lands before the step the sim has already run. Then `Math.round(t × 120) ≥` the current step, the driver fires it on schedule, and the stage still matches a run from 0 (§5.3 invariant). While playing, a sky click fires within 0.1 s, so clicking along to the show works like recording.
- Clicking the sky never fires an unsaved "test" burst. Every burst on the builder stage is a cue in the document.
- **New cue fields** (Peach 6c.2): `id` is `c{n}` from a **counter kept in the builder draft** (`nextCueId`). It never reuses a deleted id (Peach N4). After a link load the counter starts at one more than the largest `c{n}` in the document. `seed` is a random int32 from `crypto.getRandomValues`. There's no `burstHeight` key.
- **Copying the shell in** (schema.md §4.1–4.2, Peach 6d.1, 6d.3): upgrade, then normalize, then drop `sky`. If an embedded shell deep-equals the result, the cue uses that key, so placing Peony ten times embeds it once. Otherwise it gets a new key `s{n}` (the lowest free `n`, keys up to 12 characters by the pattern). Keys are never shown.
- After an add, the new cue is selected, the inspector shows it, and focus stays where it was (on Add cue, the timeline or the stage).
- The playhead past the launch window blocks every add (§9.2).

### 4.2 Moving

- **Drag a cue horizontally** on the lane. `t` snaps to 0.1 s. Hold `Alt`/`Option` while dragging to move in single steps (1/120 s). A small label above the pointer reads `0:12.5` while dragging. Dragging stops at 0 and at `duration` (it never extends the window; §9.3). It only ever changes `t`: rows and vertical position are layout (§6), not data.
- The inspector's **Launch time** field, **Position** slider and **Burst height** row (§8).
- Dragging the selected cue's **marker on the paused stage** sets `x` and, when the cue has its own burst height, `burstHeight` (§8.2).
- Moving changes nothing but `t`, `x` and `burstHeight`. `id` and `seed` never change (Peach 6c.3).

### 4.3 Duplicate and delete

- **Duplicate** (toolbar, inspector, `D`): a copy with `t + 0.5 s` (clamped to `duration`), the same `shell`, `x` and `burstHeight`, a **new id** and a **new seed** (in real fireworks two shells of one kind never burst identically; the inspector's seed is shown, so a visitor who wants a twin can see they differ). The copy is selected.
- **Delete** (toolbar, inspector, `Delete`/`Backspace`): removes the cue with no confirm. Selection moves to the next cue in firing order, else the previous one, else none. Without Undo (Q1) a delete can't be taken back, which is why Q1 recommends Undo.
- **Removing a shell from the show:** in Library → In this show, an unused shell has `Remove`. A shell used by cues has `Remove…`, which opens the shared `confirm-dialog`:

> **Remove {shellName} from the show?**
>
> Its {n} cues are deleted too. Your other cues don't change.
>
> `Keep it` · `Remove shell and cues`

  (`1 cue is deleted too` when `n` is 1.) Removing may leave the show with no cues, which is allowed in the draft and blocks Save (§9.1).

### 4.4 Keyboard (the timeline has focus)

The timeline is one tab stop (§16.2). These keys work only while it has focus, so no single-letter key is global (WCAG 2.1.4).

| Key | Does |
|---|---|
| `←` / `→` | Select the previous or next cue in firing order `(fireStep, id)` (`orderCues`), and scroll it into view |
| `Home` / `End` | Select the first or last cue |
| `,` / `.` | Move the selected cue 0.1 s earlier or later |
| `Shift`+`,` / `Shift`+`.` (`<` / `>`) | Move it 1 s |
| `A` | Add cue (§4.1) |
| `D` | Duplicate |
| `Delete` / `Backspace` | Delete |
| `Enter` | Focus the inspector's Launch time field |
| `Escape` | Deselect |
| `+` / `=`, `-` | Zoom in or out around the selected cue (else the playhead) |
| `0` | Fit |
| `Space` | Play/Pause (as everywhere on `/show`) |

- `Alt`+arrow is avoided on purpose: on Windows `Alt`+`←` is the browser's Back. `Ctrl`/`⌘`+`D` is avoided because it bookmarks.
- **Space** toggles Play/Pause anywhere on `/show` except INPUT, TEXTAREA and SELECT (the 2c §6.2 exclusion list), and never while the notice shows.
- The scrub keyboard equivalent is the transport's native range (§5.2).

---

## 5. Zoom, scroll, transport and scrubbing

### 5.1 The time axis

- **The view range** is `0 … max(duration, end)`, where `end` is the end estimate (§7.3), plus 2% padding on the right.
- **Fit** (the initial view, `0`, the `Fit` button) puts the whole view range in the lane's width. **Zoom** runs from Fit up to **200 px/s** (one 1/120 s step is then 1.7 px, about the finest drag that's useful). Each step is ×1.5.
  - `-`, `Fit` and `+` buttons are on the transport row (`aria-label`s `Zoom out`, `Fit whole show`, `Zoom in`). `Zoom in` disables at 200 px/s and `Zoom out` at Fit (if the pressed button disables, move focus to `Fit` so it never drops to `body`; phase-5.md §12.1).
  - `Ctrl`/`⌘`+wheel and trackpad pinch zoom around the pointer.
  - The wheel and `Shift`+wheel scroll horizontally. The lane has no vertical scroll (§6.2).
- **Ruler ticks** adapt to keep labels at least 60 px apart: 0.5 s, 1 s, 5 s, 10 s, 30 s, 1 min, 2 min. Labels are `text-caption text-muted`, in `m:ss` form.
- **Follow:** while playing, the view pages forward when the playhead reaches 90% of the lane. A manual scroll or zoom stops following until the next Play.

### 5.2 Transport (one row above the toolbar)

`[Play|Pause]` · `[|<]` (`aria-label="Back to start"`) · time · overview scrub bar · zoom group.

- **Play/Pause**, `.btn btn-primary` (the builder's one gradient button, as Launch is on `/`). The label changes, with no `aria-pressed`. Play starts at the playhead. At the end of the show, Play starts again from 0:00.
- **Time**: `0:12.5 / about 1:07` (`font-mono text-small tabular-nums`). Once a run has reached the true end in this session, it reads `0:12.5 / 1:06.8` (§7.3). It's not a live region.
- **Overview scrub bar:** a native `input type="range"`, `flex-1`, min 0, max the view range end, step 0.1, `aria-label="Playhead"`, `aria-valuetext="12.5 seconds of about 1 minute 7 seconds"`. Arrows move 0.1 s, PageUp/PageDown 10 s, Home/End the ends. Behind its track, aria-hidden, are the launch window (`surface-raised`), the tail (hatched), one 1px tick per cue, and the lane's visible window as an outlined box. Dragging the box scrolls the lane. The scrub bar is the whole-show map for a 600 s show.
- **On the timeline**, clicking or dragging on the ruler seeks. Clicking empty lane space seeks and deselects. The playhead is a 2px `accent` line through the ruler and lane, with a handle on the ruler.
- The notice holds Play (§14.1). While it shows, Play is disabled with `title="Close the flashing notice to play."`, and the toolbar shows `Close the flashing notice on the stage to play.` in place of its status text.

### 5.3 Scrubbing and the stage invariant

**The stage always shows what a run of the current document from step 0 shows at the playhead** (standing ruling: scrubbing re-runs from t = 0 in simulation time). How it's met (full re-run, exact checkpoints) is Yoshi's and Luigi's call (§13.3 Y1). "Fast-forward from T − 21 s" doesn't meet it (Peach 6i.2).

- **While dragging** the playhead: the time label and the playhead line follow the pointer at once, and the stage seeks when the drag pauses for 150 ms and again on release, keeping the last frame meanwhile.
- **Catching up:** when a seek takes longer than 300 ms, the stage shows `Catching up to 4:12.0…` (the hint style, bottom-left, `role="status"`) until it lands. A newer seek replaces an older one. The visitor never waits on a seek that's been overtaken.
- **Edits:** while **paused**, any change to the document (a cue, a shell, the sky) re-seeks to the playhead, so the frame stays true. While **playing**, any edit, an added cue included, re-seeks to the current time from the latest kept checkpoint and keeps playing (as built; the cost is at most one 10 s checkpoint span, under the 300 ms `Catching up…` threshold for the Done-when show). While a cue is being dragged, the stage re-seeks on drop only.
- A scrub or seek sets no flag, writes no draft and sends no request (Peach 6i.3). The playhead isn't saved. The builder opens at 0:00.

---

## 6. Drawing up to 1000 cues

### 6.1 Rendering

- The **cue lane is one `<canvas>`** (2D context, device-pixel-ratio aware), `aria-hidden="true"`. It's drawn on any change to cues, view, selection or size, at most once per animation frame. The **playhead is a separate DOM line** over it, so playback moves one element and never redraws 1000 cues per frame. The ruler can be a second canvas or DOM. That's Luigi's call.
- It's not Pixi: the timeline needs no WebGL context, and the stage already has the one Pixi host (`pixi-host-lifecycle` skill).
- Hit testing reads the same layout the draw used: the nearest cue within 6 px of the pointer, with the selected cue first, then the latest-drawn.

### 6.2 Rows and level of detail

- **Rows** are layout, not data. Cues are packed greedily in firing order into the first row where they don't overlap the previous cue's drawn extent (launch tick to last break dot, plus 4 px). Row height is 18 px. The lane fits 7 rows at 232px (3 at 176px). A cue that would need a further row is drawn in the last row, and that row's overflow gets a `+{k}` badge (`text-caption text-muted`) at the left of the cluster. Clicking the badge zooms to it. Rows are recomputed on every change, so a cue can change rows. That's fine, because rows mean nothing.
- **Detailed** (≥ 20 px/s): the launch tick, rise bar, burst dot and break dots (§7.1).
- **Compact** (< 20 px/s, which includes Fit for any show over about 45 s): the launch tick and the burst dot only, with dots at 6 px. At this level the drawn extent is the dot, so rows pack tighter.
- **Selected cue:** always drawn last (on top), with a 2px `accent` ring around the burst dot and the rise bar in `accent`.
- **Timeline focus ring:** the 2c `:focus-visible` outline on the timeline container.

---

## 7. Burst marker, breaks and the tail

### 7.1 One cue, drawn

```
 launch tick        rise bar               burst dot   break 2   break 3
     |━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●┄┄┄┄┄┄┄┄┄┄•┄┄┄┄┄┄┄┄┄┄•
     t                                  t + rise    + delay₂   + delay₃
```

- **Launch tick** at `t`: 1px × 8px, `text-muted`, at the row's bottom. This is the cue's time, the thing a drag moves (`t` is launch time, a standing decision).
- **Rise bar** from `t` to `t + rise`: 2px, `border-control`.
- **Burst dot** at `t + rise`: 8px (6px compact), filled with the cue shell's break 1 `color1` from `engine/model/colors.ts`. `rainbow` uses the 2c conic gradient, approximated on canvas as 6 wedges. A `border-control` 1px edge keeps dark colors visible on `surface`.
- **Break dots** (detailed level only): 4px dots at each later break's burst, in that break's `color1`, joined by a 1px dotted line.
- **Times** (from `simulation.ts` `launch` and the shell-stepping code, so the marker shows what the sim does):
  - `rise = sqrt(2 × bh × 760 / g)`, where `bh = cue.burstHeight ?? shell.burstHeight` and `g` is the **show's** gravity. (`h = max(60, 760 − ty)` is always `bh × 760`, because `bh ≥ 0.3`.)
  - break `k` (k ≥ 1) bursts `max(0.1, delay_k)` after break `k − 1`.
  - Wind doesn't change these times.
  - This belongs in one engine function, for example `cueTimes(cue, shell, sky)` in `engine/model/show.ts` (Yoshi, §13.3 Y2), shared by the timeline, the inspector and the end estimate.

### 7.2 The launch window and the tail

- **`0 … duration`** (the launch window): lane background `surface`. At `duration` there's a 1px solid `accent-secondary` line, labelled on the ruler `Launch window ends 1:00`. Cues can only launch inside it.
- **Past `duration`:** the lane is hatched (45° 1px lines in `border` on `surface-sunken`, every 6px) and labelled `Tail` at its top-left (`text-caption text-muted`). Bursts and breaks from late cues are drawn here as normal. A cue at `t == duration` has its launch tick on the line and its burst in the tail (fixture `cue-at-duration.json`, Peach 6c.7).
- **The end marker** at `end`: a 1px dashed `text-muted` line, labelled `Ends about 1:07`, or `Ends 1:06.8` once known. It comes after the last cue's last break and can be well past `duration`, or before it (next point).
- **A show whose cues finish early.** When `end < duration`, the hatching starts at `end`, not at `duration`. The span from `end` to `duration` is labelled `Nothing launches here` and the toolbar shows: `The show ends at about 0:17, before its launch window closes at 1:00. Add cues later in the window, or lower Duration.` That's literally what L4 means (playback stops at the last particle, whatever `duration` says), and the visitor shouldn't find out from a player that stops early.

### 7.3 The end estimate

- **Before playing through,** `end ≈ max over cues of (t + rise + Σ later delays + max burn × 1.1 + 0.4 + child tail)`. That's `shellDuration`'s formula with the show sky, plus about 2.2 s when the shell has crossette or glitter (schema.md §13). It's labelled `about` everywhere, because the true end depends on the particles.
- **Once a run reaches the true end** `E` (schema.md §4.5) in this session, whether by playing or by a seek past it, the exact value replaces the estimate (`Ends 1:06.8`, time `/ 1:06.8`) until the next document change.
- If playback passes the estimate, the view range, the scrub bar's max and the end marker extend live. The visitor can always reach the last particle.

---

## 8. The cue inspector

### 8.1 Fields

Panel section **Cue**. With nothing selected: `Select a cue on the timeline to edit it.` (`.note`). With no cues: `Add a cue to start: pick a shell in the Library, then press Add cue or click the sky.`

| Row | Control | Copy and behavior |
|---|---|---|
| Heading line | text | `{shellName} · Cue 3 of 50` (the position in firing order; `text-small text-muted`) |
| Shell | 2c `select-row` over the shells in this show | Option label `{shellName}`. Duplicate names get ` · 2`, ` · 3` in key order. Changing it changes only `cue.shell`. |
| Launch time | number input, seconds, `step="0.1"`, `min="0"`, `max="{duration}"` | Label `Launch time (s)`. Under it, a `.note`: `Bursts at 0:15.0 · fades by about 0:20.3`. An out-of-range entry clamps on blur (`Launch time is between 0 and 60 seconds.` shows as the field's note until the next valid entry). A typed value isn't snapped (schema.md §4.4 rule 5). |
| Position | 2c `range-row`, 0..1 step 0.01 | Label `Position`. The value is shown as `40%`. Note: `Where it bursts across the sky: 0% is the left edge.` |
| Burst height | a checkbox `Own burst height`, plus a 2c `range-row` 0.3..0.85 step 0.01 | Off: the range is disabled and reads the shell's value, with the label `Burst height (from shell)`, and there's no `burstHeight` key. On: the key is set, starting at the shell's value. Turning it off removes the key (never `null`). |
| Seed | text | `Seed 1834729` (`font-mono text-caption text-muted`), and a `.btn btn-sm` `New seed`, `title="Pick a new random seed. The burst keeps its shell, time and place but scatters differently."` |
| Actions | `.btn btn-sm` | `Duplicate` · `Delete` (`aria-label="Delete cue at 0:12.5"`) |

- Every inspector edit sets `dirty` (§10). Changing the selection doesn't.
- The builder's fields are native controls (and the 2c `range-row`), not Signal Forms: an accepted OQ17 departure for this page only (Skyler, 2026-11-14), because every field change is an Undo-recorded command on an immutable document.
- Values use the designer's `formats.ts` where they overlap (burst height, percentages).

### 8.2 Position on the stage

- **What `x` is:** the burst point's horizontal fraction of the stage width, `tx = x × worldWidth()` (schema.md §4.3, OQ5). The shell **leaves the ground** offset by its angle jitter (`launch`: `x0 = tx ± tan(jitter) × h`) and bursts at `tx`. So the UI calls it **Position** ("where it bursts") and never "launch position". The brief's phrase would mislead for jittery shells.
- **Stage marker:** while paused with a cue selected, the stage shows a DOM overlay marker at `(x, burst y)`: a 14px ring in `accent`, a 1px dotted `accent` line down to the skyline, and the label `{shellName} · 0:15.0` (`text-caption`, 2c text-shadow).
  - Dragging the ring sets `x`. If the cue has its own burst height, it also sets `burstHeight` (clamped to 0.3..0.85). Otherwise vertical movement is ignored, and the inspector checkbox is the way in.
  - The marker is `aria-hidden`. Its keyboard equivalents are the inspector rows.
  - It hides while playing (it would sit over live bursts).
- Wind drifts in absolute units, so a narrow window drifts further relative to the width (schema.md §13). Nothing to design; the stage shows the truth.

### 8.3 Why the seed is visible

The seed decides how a burst scatters, and it's what makes two cues of one shell differ. Showing it lets a visitor tell a duplicate from a twin, report "cue with seed …" in a bug, and see that **New seed** did something. It's in mono caption text, so it doesn't compete with the fields. Whether **New seed** is allowed under schema.md §4.3 ("assigned once when the cue is created and never re-derived") is Yoshi's to confirm (§13.3 Y3). My reading is that "never re-derived" forbids deriving a seed from `id` or position, not a visitor choosing a new one. If Yoshi rules otherwise, drop the button and keep the text.

---

## 9. Empty, cap and invalid states

All are plain text next to the control they explain, so no state hides behind a disabled button's `title` (Phase 5 lesson).

### 9.1 Empty show (Skyler Q4: a show with no cues can't be saved)

- **Save bar:** the buttons stay (`Save`, or `Update original` · `Save as new`) but are `disabled`, and the note under the bar reads `A show needs at least one cue before it can be saved.`, replacing the owner note. Share is unaffected (it copies the last saved version, which has cues). Peach 6f.2: no request.
  - Why disabled and visible rather than hidden: the visitor learns where Save is and what unlocks it. Why not enabled with an error on press: the rule is known before the press, so say it before.
  - **Focus:** deleting the last cue never has focus on Save (focus is on the timeline or the inspector), so the `disabled` focus drop doesn't arise. If Save is somehow focused when it disables, focus moves to the panel `h1`.
- **Timeline lane:** a centered `text-small text-muted` line: `No cues yet. Pick a shell in the Library, then press Add cue or click the sky.`
- **Toolbar** status text: `0 cues`.
- **First visit:** name `New show`, duration 60, sky `DEFAULT_SKY`, no shells and no cues. Active shell: Peony.

### 9.2 Caps and limits

| State | Where | Copy | Effect |
|---|---|---|---|
| 1000 cues (Peach 6d.4) | toolbar status, replacing `{n} cues` | `1000 cues, the most a show can have. Delete a cue to add another.` | Add cue, `A`, Duplicate, sky clicks and drops do nothing. Add cue and Duplicate are `aria-disabled` (they keep focus). A sky click announces the same sentence in the polite region (§16.3). |
| 32 shells, and the active shell isn't in the show (Peach 6d.3) | Library note under the active item, and the toolbar status | `This show already holds 32 shells, the most it can. Use a shell that's already in it, or remove an unused one.` | Adding with that shell is blocked as above. The draft is unchanged. A shell already in the show still adds. |
| Playhead past the launch window | toolbar status | `The playhead is past the launch window, which ends at 1:00. Move it back, or raise Duration.` | Adds are blocked. |
| Duration at 600 s, dragging a cue to the end | drag label | `1:00.0 · window end` (stops) | Clamped. |
| Size over 256 KB | status block, Phase 5 row 413 (show wording) | as phase-5.md §6 | Can't happen at the current caps (1000 cues at about 90 bytes plus 32 four-break shells is under 140 KB), but the shared size check stays. |

Counts: the toolbar status shows `{n} cues` (`1 cue`) at the right, `text-caption text-muted`, and turns into the cap sentence at 1000.

### 9.3 Duration

- Panel field `Duration (s)`: a number input, `step="0.1"`, `min="max(1, last cue t)"`, `max="600"`. Under it, a note: `The launch window. The show keeps playing after it until the last spark fades.`
- **It can't go below the last launch** (Peach 6c.9: blocked, not clamped or flagged). An entry below it reverts on blur and the note reads `The last cue launches at 0:52.3, so the window can't end before it. Move or delete that cue first.` until the next valid entry. It never moves cues on its own.
- Cue drags stop at `duration` (§4.2). Lengthening the window is always an explicit Duration edit, so the window never grows by accident.
- The ruler's `Launch window ends` line isn't draggable in v1 (keyboard parity would need a second slider; the field is enough).

### 9.4 Invalid documents

The builder can't produce one (every control clamps or blocks). Invalid data arrives only through a stale tab's Save (400), and from Phase 7 through Show JSON Apply (lenient normalize, §9.5). Both use the §15 labels.

### 9.5 Show JSON (moved to Phase 7, Skyler 2026-11-14)

Not in Phase 6. The design below stands for Phase 7 unchanged.


Same as 2c §3.6 with `show` wording: `Copy` and `Apply`. Apply runs `upgradeShow` then lenient `normalizeShow`, and reports adjustments in the 2c note style with the §15 qualifiers. Apply over a dirty show asks (the §10.3 dialog, with `Apply` in place of `Open copy`, titled `Apply this JSON?`, and the body `This replaces your current show, {name}, including its cues, shells and sky. Display settings stay as they are.`). An embedded shell's `sky` is dropped with the note `Shells in a show play under the show's sky, so {shellName}'s own sky was removed.`  It earns its place because Toad's two-browser runs can paste one exact document.

---

## 10. Dirty, saved and the builder draft

### 10.1 Draft

Key: Luigi's call (Peach), for example `fireworks.showDraft.v1`. Layout: `{ show, nextCueId, selectedCueId, activeShell, view: { pxPerSecond, scroll }, dirty, saved, source }`. `display` isn't in it. **Motion blur is a device-wide preference** (Skyler, 2026-11-14), `fireworks.motionBlur.v1` in `device-preferences.ts`, beside `fireworks.reduceFlashing.v1`, shared by the designer, the builder and the player. Absent or unreadable means the 0.78 default and nothing stored. A designer draft from before the ruling is adopted once, only while the device has no value. The builder's slider writes the device key; the player renders with it and has no control.
- The builder never writes the designer draft. It **reads** it for the Library's `From the designer` item (Peach 6c.1, 6d.1) and for the one-time Motion blur adoption above.
- **Write the draft debounced** (on drag end and at most every 500 ms otherwise). A 1000-cue draft is about 100 KB, too much to write on every pointer move.

### 10.2 Flags

This is the Phase 5 F4 rule with one dirty flag. A show has no partial replace (no preset swaps "just the shell"), so there's nothing for a second flag to tell apart.

| Flag | Meaning | Set by | Cleared by |
|---|---|---|---|
| `dirty` | the visitor changed the show since it was last replaced or saved | any edit to name, duration, sky, `shells` or `cues` (add, move, duplicate, delete, inspector, shell remove, New seed); a link load (L1) | New show; Apply; a successful save |
| `saved` | the document is exactly what was last saved | a successful save, if the document sent is still the same object (phase-5.md §3.3) | any document change, a load's included |
| `source` | the saved record this is a working copy of | link load, save | a 404 from PUT or remix (schema.md §11.2) |

Never dirty: selection, the active shell, zoom, scroll, the playhead, play state, Motion blur, Reduce flashing, the notice. Indicator, buttons, owner note, toasts and status block are phase-5.md §2–§6 verbatim, except as follows:
- Owner note: `Update original changes what the share link for {sourceName} plays. Save as new keeps it and makes a new link.` (unchanged).
- Every "Your shell is kept in this browser." becomes **"Your show is kept in this browser."** 400b reads `the server didn't accept this show ({reasons})`.
- Toasts as §3.2 with `{name}` the show's name.
- With writes off, there's no save bar (Peach 6f.1), and Share shows when there's a `source`.

### 10.3 Asking before a replace

Two things replace the show: a show link (`/c/` with `kind: "show"`) and **New show**. Each asks only when `dirty`. The shared `confirm-dialog`, with focus on the safe button:

> **Open {linkName}?**
>
> This replaces your current show, {name}, including its cues, shells and sky, with a copy of {linkName}. Display settings stay as they are.
>
> `Keep editing` · `Open copy`

> **Start a new show?**
>
> This replaces your current show, {name}, and its {n} cues with an empty show. Display settings stay as they are.
>
> `Keep editing` · `Start new show`

- Blank-name variants are derived mechanically: drop `, {name},` and keep the rest (the Phase 5 lesson).
- **New show** is a `.btn btn-sm` at the end of the Show section heading row (`h2` row, as Breaks' Add/Remove in 2c). With `dirty` false it acts at once.
- Keep editing on a link lands on `/show` with focus on the panel `h1` (phase-5.md §7.2). Open copy: playhead 0:00, paused, nothing selected, focus on the panel `h1`.
- A shell link never looks at the builder's flag, and a show link never looks at the designer's (Peach 6g.3).

### 10.4 `/c/` copy, now that a link can be either kind

The kind is unknown until the GET answers, so the Phase 5 shell-only wording must change (departure D2):
- Loading line: `Opening the shared link…` (was `…shell…`).
- Kind unknown (bad code, 404, status 0, 429, 5xx): `Your shell in the designer hasn't changed.` becomes `Nothing in the designer or the Show Builder has changed.`, and `The shared shell couldn't be loaded.` becomes `The shared creation couldn't be loaded.` The button stays `Go to the designer`.
- Kind known to be a show (upgrade or normalize fails): phase-5.md §7.3 with "show": **This show needs a newer version of the app.** `It was saved by a newer version of Fireworks Sandbox than this page has. Reload to open it.` · `Reload` · `Go to the Show Builder`. **This show can't be opened.** `Its saved data isn't valid in this version of the app. Your show in the Show Builder hasn't changed.` · `Go to the Show Builder`.
- `showNotSupportedMessage` (`link-copy.ts` l.87) is deleted.

---

## 11. The show player: `/s/:code` with `kind: "show"`

This replaces "This show can't be played yet." on both `/s/` and `/c/`.

### 11.1 Layout

The phase-5.md §8.1 top bar, with these differences:
- Under the name, the meta line reads `Fireworks Sandbox · 0:12 / about 1:07` (once known, `/ 1:07`). Whole seconds, `tabular-nums`, `text-small text-muted`. It's not live and not `aria-hidden`: a screen-reader visitor can read it on demand.
- `Remix`: `title="Open a copy in the Show Builder to change and play"`. It's always shown (standing decision), and goes to `/c/{code}`, then `/show`.
- `Pause`/`Play`, then `Replay` (`title="Start the show again from the beginning"`), then Reduce flashing.
- **Progress line:** a 2px bar along the very bottom of the viewport (`accent` on `border`), `aria-hidden`. It's not interactive: the player is a viewer, and seeking a 600 s show from 0 is a builder job.
- A click on the sky and Space-as-fire do nothing (Peach 6a.7). Space is Play/Pause.

### 11.2 Playback

- It plays **once**, from step 0 to the end step `E`, with `TimelineDriver` at `starBudget` 1. It never loops and never stops at `duration`.
- Pause freezes the step counter. Play resumes at the same step with no backlog.
- **The ended state:** at `E` the stage is empty sky. Centered, the phase-5.md S1 layout: a `Replay` button (primary gradient) with the line `“{name}” has ended.` under it (curly quotes and isolation per the header rule; the name is a `<bdi>` inside the quotes). Focus doesn't move (it would yank a reader), and the polite region says `The show has ended.` The top-bar toggle reads `Play` and starts again from 0, the same as Replay.
- **Under reduced motion:** it opens paused at step 0 with the centered `Play` and the phase-5.md S1 lines (Peach 6h.3).
- Loading and errors: phase-5.md §8.4 unchanged ("creation" wording already covers shows).

### 11.3 Flashing notice (show variant)

The phase-5.md §8.3 component and rules, with the length named because a show is long motion:

Reduce flashing **off**:
> **Flashing lights.** {name} starts when you close this notice and runs about {length}. {strobe ? `It has bright bursts and strobe effects.` : `Its bursts flash brightly.`} If flashing affects you, turn on Reduce flashing first. You can pause at any time.
>
> `Turn on Reduce flashing` (primary gradient) · `Play`

Reduce flashing **on**:
> **Flashing lights.** {name} starts when you close this notice and runs about {length}. Reduce flashing is on, so strobe is off and burst flashes are dimmed and spaced out.
>
> `Play`

- `{length}` comes from the §7.3 estimate, rounded: under 60 s → `{n} seconds`; otherwise → `{m} minutes` rounded to the nearest whole minute, with `1 minute` singular. It always reads "about".
- **`strobe`** is true when any shell **used by a cue** has a break with `effect: "strobe"`. Unused embedded shells never play, so naming their strobe would be false (phase-5.md §8.3's "name the actual risk").
- The dismissal and the Reduce flashing choice stay device-wide (standing decision).

---

## 12. My creations with shows

- **Both kinds in one grid**, with no `kind` parameter (Peach 6j.1 ledger), in the server's order. There's no filter in Phase 6. Revisit if a visitor's list gets long enough to need one (the API already supports `kind`).
- **Card meta:** `Show · Updated 3 days ago` or `Shell · Updated …`. The kind word is the marker. Palette swatches as Phase 5. A show's palette covers every embedded shell, unused ones too (accepted, schema.md §2.2).
- **Open** → `/c/{code}` → the designer or `/show` by kind. **Play** → `/s/{code}`. **Share** and **Delete** are unchanged. Delete copy is unchanged ("Its share link will stop working…" holds for shows).
- **Copy changes** (departure D4):
  - Header links: `← Shell designer` becomes two links, `Shell designer` · `Show Builder`.
  - Subtitle: `Shells and shows you've saved. Anyone with a share link can play it; nothing here is listed publicly.`
  - Empty state: **Nothing saved yet** `Shells you save in the designer and shows you save in the Show Builder show up here, with a share link for each.` · `Open the designer` (primary) · `Open the Show Builder`.
  - Unavailable notice: `Saving is turned off on this site right now, so there's nothing to list here. You can still design shells and build shows, and your work is kept in this browser.`
  - Session unavailable: unchanged ("You can keep designing" covers both).

---

## 13. Library

### 13.1 Groups, in order

Each group is an `h3` (`text-caption text-muted uppercase`) and a `ul` of item buttons. An item is a `button` row: swatches (the 2c dots, `size-3`, at most 8, from the shell's breaks like `palette`), the name (`text-small`, one line, ellipsis, `title` = full name), and a right-aligned meta (`text-caption text-muted`). The active item has `aria-pressed="true"` and `border-accent`.

| Group | Items | Meta | Shown when |
|---|---|---|---|
| **In this show** | the embedded shells, in key order | `12 cues` / `1 cue` / `Unused`, plus `Remove` / `Remove…` (§4.3) as a separate `.btn btn-sm` | one or more shells are embedded |
| **From the designer** | one item: the designer draft's current shell, as it is now | `Designer` | a designer draft exists and reads cleanly |
| **Presets** | the ten presets | none | always |
| **My shells** | `GET api/me/creations?page=1&pageSize=24&kind=shell` (Peach 6e.1), then `Show more` for the next page, appended | `Saved` | `session.status() === 'ready' && canWrite` |

- The group note under the Library heading: `New cues use the selected shell. Shells are copied into the show and play under the show's sky, not their own.`
- **My shells and the write switch** (Peach 6e.2, 6e.3): while the session is loading, the group isn't rendered and nothing is fetched. When it's ready and `canWrite` is false, or `api/me` failed, the group is never rendered and there's no request and no notice (the same as the hidden nav). An empty list: `No saved shells yet. Save one in the designer to use it here.`
- **List errors** (inline in the group, `SUPPRESS_ERROR_TOAST`): status 0 → `Couldn't load your shells. Check your connection.` · `Try again`. 429 → `Too many requests right now. Try again {when}.` · `Try again`. 5xx → `Couldn't load your shells right now.` · `Try again`. 403 → the group disappears (writes went off).
- **Using one of my shells** needs its document: on the first add (not on selection), one `GET api/creations/{code}` (Peach 6d.2, N2), then upgrade and normalize, then the §4.1 copy. While in flight, the item shows `Loading…` in its meta, and the add happens when the GET answers (if the cap still allows). Failures, inline under the item, with nothing added:
  - 404: `{name} was deleted, so it can't be added. Nothing changed.` The item is then removed from the list.
  - status 0: `Couldn't load {name}. Check your connection, then try again.`
  - 5xx: `Couldn't load {name} right now. Try again in a moment.`
  - Newer version: `{name} was saved by a newer version of the app. Reload to use it.`
- **From the designer** is read at the moment of the add (not cached), so "as it is now" is true.

### 13.2 Not in v1

- **Editing an embedded shell in place.** Shells are snapshots (schema.md §4.2). To change one, edit it in the designer and add it again. See Q2.
- **Auditioning a shell** without placing it: every burst on the builder stage is a cue (§4.1), so the stage never shows something the show won't.
- **Multi-select** of cues. A single selection keeps the inspector and keyboard model simple. It's the first thing to add after Undo.

### 13.3 Notes for Yoshi and Luigi

- **Y1 (Yoshi, Luigi): seek.** Meet the §5.3 invariant exactly, including at the 40k cap (Peach 6i.2). The UX budget: a seek to anywhere in a 600 s, 1000-cue show should land in under about 1 s on a laptop. Beyond 300 ms, `Catching up…` shows. If a full re-run can't meet that, exact checkpoints (for example every 10 s of sim time, kept in memory, dropped on any document change before them) are the expected answer.
- **Y2 (Yoshi): `cueTimes` and `estimateShowEnd`** as pure engine functions (§7.1, §7.3), and the exact end `E` reported by the driver when reached.
- **Y3 (Yoshi): New seed.** Confirm that a visitor-chosen re-roll is within schema.md §4.3 (§8.3).
- **L1 (Luigi): timeline canvas** per §6, with the playhead as a DOM line. Debounced draft writes (§10.1).
- **L2 (Luigi): the stage in the builder** needs a timeline mode (cues and `beforeStep` firing), `clickToFire` meaning "add a cue", a seek API, and an exposed current step. That's the 6a.8 readout Peach and Toad need in the built image.
- **L3 (Luigi): `fieldLabel`** per §15.
- **L4 (Luigi): the Reduce flashing flash-spacing rule** (§14.2) in `engine/render` visual rules, with its test.

---

## 14. Flashing, reduced motion and long motion

### 14.1 Builder

- **It never auto-plays.** It opens paused at 0:00 on every load (reduced motion or not), with the sky empty. Nothing moves until Play, or a seek into the show renders a frame (one still frame isn't flashing).
- **The notice** (device-wide dismissal, 2c §7.2 component): it shows on the stage when not yet dismissed. It holds Play, Space and sky clicks (no cue is added while it shows), and seeks render nothing (the stage stays empty) until it's answered. Every panel control works. Copy:

  Off:
  > **Flashing lights.** You can play the show once you close this notice. Bursts flash, and some effects strobe. If flashing affects you, turn on Reduce flashing first. You can pause at any time.
  >
  > `Turn on Reduce flashing` (primary) · `Continue`

  On:
  > **Flashing lights.** You can play the show once you close this notice. Reduce flashing is on, so strobe is off and burst flashes are dimmed and spaced out. You can change this under Display.
  >
  > `Continue`

  Focus: to its first button if focus is on `body`. On dismiss, to `Play`.
- **Pause** exists everywhere a show moves (WCAG 2.2.2): the transport in the builder, the top bar in the player, and Space in both.

### 14.2 A new Reduce flashing rule: flash spacing (renderer only)

A show can put many bursts in one second, which Auto show's 0.8 s driver gap can't help with: changing launch times would change the show. So, under Reduce flashing, **a burst flash (`K_FLASH`) is drawn only if it starts at least 41 steps (41/120 s) after the last drawn burst flash started**. Otherwise it isn't drawn at all. Stars and sparks are unaffected.
- This holds the screen to at most 3 big flashes in any 1 s span (WCAG 2.3.1's threshold), whatever the cue density. 41, not 40: at 40 steps, starts at steps 0, 40, 80 and 120 put four inside one closed 1.000 s span (Toad, 2026-11-14).
- Flashes that start on the same sim step are one flash in time and are drawn or skipped together (as built: a flash is keyed by its start step). Sim time moving backward (a seek) resets the gate.
- It's renderer-only: the sim and every count are unchanged, so Peach 6a.6 holds. The test is a flag-flip negative control (the skill's rule 6), plus a renderer spec with two flashes 0.2 s apart that draws one with the flag on and two with it off.
- It applies on every surface (designer, player, builder). On a shell it rarely triggers (one burst at a time). The notice's "on" copy now says "dimmed and spaced out" on the player and the builder. The designer's 2c copy may stay as is, because there it almost never applies.

### 14.3 Not done

- **A dense-flash warning on the timeline** (marking seconds with more than 3 burst starts). Useful to creators, but it's a creator aid, not viewer protection, and §14.2 already protects viewers. It's a Phase 7 candidate.

---

## 15. Show issue paths (Peach N1, phase-5.md §11.1 deferred)

`fieldLabel` and `issueReason` resolve show paths against **the document that was sent or applied** (the client has it), so cues read by time and shells by name.

| Path | Label |
|---|---|
| `name` / `duration` | `Name` / `Duration` |
| `sky.gravity` / `sky.wind` | `Gravity (Sky)` / `Wind (Sky)` |
| `cues[i].t` / `.x` / `.burstHeight` / `.seed` / `.shell` / `.id` | `Launch time` / `Position` / `Burst height` / `Seed` / `Shell` / `Cue id`, each with ` (Cue at {t})` |
| `cues[i]` itself | `Cue at {t}` |
| `shells.<key>.<field>` | the shell label, with ` ({shellName})` |
| `shells.<key>.breaks[n].<field>` | the break label, with ` ({shellName}, Break {n+1})` |
| `shells.<key>` itself | `{shellName}` |

- `{t}` is the cue's `t` formatted `m:ss.s` when it's a finite number in `0..600`. Otherwise it's `Cue {i+1}` (the array position, the only handle left). `{shellName}` is the embedded shell's `name` when it's a non-blank string, otherwise `shell “{key}”` (the key quoted and escaped per phase-5.md §11.1 rules 3–5). Names are isolated (FSI/PDI).
- Examples: `Seed (Cue at 0:12.5) must be a whole number`. `Stars (Peony, Break 1) is outside 4 to 400`. `Position (Cue 4) is outside 0 to 1`.
- The codes deferred to this review:

| Code | Reason |
|---|---|
| `key-format` (at `shells.<key>`) | `shell key “{key}” isn't valid: use up to 12 letters, digits, - or _, starting with a letter` |
| `duplicate-id` (at `cues[i].id`) | `Cue id {id} is used by more than one cue` |
| `unknown-shell` (at `cues[i].shell`) | `Shell (Cue at {t}) names a shell this show doesn't have` |
| `unknown-property` on an embedded shell's `sky` (Apply only; the save never sends it) | the §9.5 note, not this reason |

---

## 16. Accessibility

### 16.1 Focus

- **On load:** the panel `h1` (`tabindex -1`) after a `/c/` redirect. On a direct visit, nothing (or the notice rule).
- **After an add:** focus stays on what triggered it. After a **delete**, it stays on the timeline (selection moved, §4.3), or on the inspector's `Duplicate` if Delete was pressed in the inspector and a cue is still selected, else on the timeline.
- `disabled` controls that can hold focus at the moment they disable (Add cue and Duplicate at the cap) use `aria-disabled` and ignore activation, with the `.btn[aria-disabled]` style from the Phase 5 review.
- Confirm dialogs: the 2c pattern (initial focus on the safe button, return to the opener).

### 16.2 The timeline as one control

- Container: a `div tabindex="0"` with `role="group"` (not `role="application"`, which would switch off screen-reader browse keys for the whole region) with `aria-roledescription="timeline"`, `aria-label="Cues"`, and `aria-describedby` pointing at a visually hidden help line: `Left and Right select cues. Comma and period move the selected cue. A adds, D duplicates, Delete removes. Plus and minus zoom.`
- Because the canvas is `aria-hidden`, the **selected cue** is described in the polite region (next section) and in the inspector, which is the full, native-control editing surface. Every timeline action has a non-pointer path: selection (arrows), time (`,` `.` and Launch time), position and height (inspector), add, duplicate and delete (keys and buttons), zoom (keys and buttons), and seek (scrub range).
- **A complete alternative for review:** a `details` disclosure under the toolbar, `Cue list ({n})`. It's a `table` (Launch, Bursts, Shell, Position), in firing order, where each row's button selects that cue. 1000 simple rows is fine for the DOM. It's rendered only while open.

### 16.3 Live regions

One polite region in the dock (`sr-only`, `role="status"`), and nothing else new:

| Event | Announced |
|---|---|
| Keyboard selection | `Cue 3 of 50: Peony, launches 0:12.5, bursts 0:15.0, 40% across.` |
| Add / duplicate | `Added Peony at 0:12.5.` / `Duplicated to 0:13.0.` |
| Delete | `Deleted cue at 0:12.5. 49 cues.` |
| Keyboard move | `0:12.6`, debounced 400 ms, so holding `.` reads only the final time |
| Blocked add (cap, window) | the §9.2 sentence |
| Play ends | `The show has ended.` |
| Seek | nothing: the range announces its own `aria-valuetext` |

The HUD stays `aria-hidden`. The `Not saved` indicator stays non-live (phase-5.md §12.3).

### 16.4 Contrast

New pairs, measured against the 2c tokens: `accent-secondary` duration line on `surface` 7.3:1. `border-control` rise bar on `surface` 3.1:1 (a graphical object needs 3:1). `text-muted` labels on the hatched `surface-sunken` tail 6.6:1 (the hatch lines are `border`, decorative; labels sit on a `surface-sunken` pad so the hatch never runs under text). When the end label would collide with the `Launch window ends` label on the ruler, it moves to the foot of the lane on the same pad (as built). The burst dots' `border-control` edge meets 3:1 against `surface` on its own, so dark fills (`blue`, `purple`) stay visible.

---

## 17. Deliberate departures and additions

Everything here is new surface. These change existing Phase 2c or Phase 5 surfaces:
1. **D1:** the designer's `h1` row gains a `Show Builder` link.
2. **D2:** the `/c/` loading line and the kind-unknown failure copy no longer say "shell" (§10.4). `showNotSupportedMessage` is removed.
3. **D3:** the player gains a show variant: time in the meta line, a progress line, an ended state, no loop, and length in the notice (§11).
4. **D4:** `/mine` lists both kinds, with the header, subtitle, empty-state and unavailable copy updated (§12). `mine.store.ts` drops `kind: 'shell'`.
5. **D5:** a new Reduce flashing renderer rule, flash spacing, on every surface (§14.2). The player's and builder's "on" notice copy adds "and spaced out".

## 18. Open questions for Skyler

- **Q1. Undo in the Show Builder for v1?** **Answered yes (Skyler, 2026-11-14):** session-only, 50 steps, cleared by a link load or New show; ⌘/Ctrl+Z and Shift+⌘/Ctrl+Z on the page plus Undo and Redo toolbar buttons. Inside any native form control (text input, textarea, select, range slider including the scrub bar, checkbox or switch) the keys stay with that control (Peach N6; extended to selects and ranges by Skyler, 2026-11-14), so typing in Name and pressing ⌘Z undoes text, not the last show edit. Buttons and the timeline still undo the show. Edits with one coalesce key in a row (typing a name, dragging a slider) are one step. Original question: Without it, a mis-pressed `Delete` or a bad drag can't be taken back. Neither confirms, because confirming every cue delete is worse. **Recommended: yes.** Undo and Redo (`⌘`/`Ctrl`+`Z`, `Shift`+`⌘`/`Ctrl`+`Z`, and two buttons on the toolbar) over document snapshots, 50 steps, kept for the session only (not in the draft), cleared by a link load or New show. The alternative is shipping without it and adding it in Phase 7.
- **Q2. Shells in a show can't be edited in place in v1.** **Answered yes (Skyler, 2026-11-14).** Original question: To change one, edit it in the designer and add it again (§13.2). Is that acceptable for Phase 6? **Recommended: yes**, because snapshots are the schema's model (§4.2), and "Edit in designer" needs a round trip between two drafts that deserves its own design pass.
- Concurred, not new: Peach's Q3 (`starBudget` 1 for the builder preview and the show player). §3.1 relies on it.

---

## 19. Post-implementation review (2026-11-14)

Reviewed against Luigi's build (`features/show/**`, the player's show variant, `/c/`, `/mine`, `visual-rules.ts` `FlashSpacing`) and `records/luigi-phase6-show-builder.md`.

### 19.1 Triage of the build's deviations

| Deviation | Ruling | Note |
|---|---|---|
| Drag a library item onto the lane (§4.1) | Phase 7 | Add cue, `A` and sky clicks cover adding; the drag was pointer-only sugar. |
| Two-finger pinch zoom (§3.2) | Phase 7 | The touch pass owns it; the zoom buttons work on touch. |
| Clicking a `+k` badge to zoom (§6.2) | Phase 7 | The badge still tells the truth; `+`, `-`, Fit and Ctrl/⌘+wheel zoom. |
| Scrub bar overview: window, tail, cue ticks, view box (§5.2) | Phase 7 | A plain native range for now. The lane at Fit already shows the whole show. |
| Checkpoint warm-up in the background | Accept | Not a UX commitment; `Catching up…` covers slow seeks. |
| Every edit while playing re-seeks from the checkpoint (§5.3) | Accept | The invariant holds; §5.3 updated. |
| Undo/Redo toolbar buttons | Accept | They were in Q1's recommendation. **But** they need the focus rule in 19.2 (B2). |
| No API banner in the builder | **Must fix now** | B1 below. |
| End label moves to the lane foot on collision | Accept | §7.2 updated. It can sit over a `+k` badge at the lane foot (Phase 7, cosmetic). |
| Same-step flashes count as one | Accept | One flash in time is what WCAG 2.3.1 counts. §14.2 updated. |
| The builder imports the designer's save bar, status block and HUD | Accept (design) | The same component is what the spec asked for: copy and visuals can't drift. Moving them to `app/shared` is a structural call for Yoshi and Luigi. |

### 19.2 Defects

Must fix now:
- **B1. No API banner.** When `api/me` fails, the builder hides the save bar and says nothing, so saving seems not to exist. Render the designer's banner with the show noun: `Can't reach the server right now. You can keep building; your show is kept in this browser.` · `Try again` (the designer's `api-banner.ts` copy with "designing" → "building", "shell" → "show"), in the §3.1 slot after the test-mode banner.
- **B2. Undo and Redo use `disabled`.** Pressing Undo until the history is empty disables the focused button, and focus drops to `body` (phase-5.md §12.1). Use `aria-disabled` and ignore activation (the `.btn[aria-disabled]` style), or, when the pressed one disables, move focus to the other button if enabled, else to the timeline.
- **B3. The builder notice doesn't take focus.** §14.1: focus goes to its first button when focus is on `body`, as `player-notice.ts` does.

Phase 7 (accessibility pass):
- **B4. Identical announcements are silent.** The polite region is a signal, so the same sentence twice in a row isn't re-read: a second blocked add at the cap, a second show end in one session (Play from the end doesn't clear it), two adds of one shell at one paused playhead. Clear the region before each set, or append a zero-width toggle.
- **B5. Save focused when it disables.** With focus on Save and one cue, ⌘/Ctrl+Z removes the cue and Save disables under focus. §9.1 says move focus to the panel `h1`.
- **B6. The 32-shell note** shows in the toolbar only, not under the active Library item (§9.2).
- **B7. Duration outside 1..600 with no cues** reverts silently. Show `Duration is between 1 and 600 seconds.` until the next valid entry, like Launch time.

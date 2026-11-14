# Phase 5 (save, share, player, remix): design-review notes

**Ceremony:** design-review before Phase 5 implementation. Facilitator: Rosalina. Participants: Luigi (implements, confirms F4), Peach (acceptance criteria), Yoshi (two small contract points in §13), Boo (share-link review reads §8 and §10).
**Date:** 2026-11-14.
**Inputs:** plan Phase 5; schema.md §2.1–§2.7, §8.2–§8.3, §11; `acceptance/phase-3.md` F4, F10, F12; `designer-2c.md` (tokens, `confirm-dialog`, toasts, §6.3 banner, §6.4 flags, §7 flashing); the code under `src/web/fireworks-web/src/app/` (`shell-designer.store.ts`, `designer-draft.ts`, `designer-copy.ts`, `confirm-dialog.ts`, `notifications.ts`, `session.ts`, `http-error-interceptor.ts`, `app.html`).
**Oracle:** `prototypes/fireworks-prototype.html` has no save, share, player or list, so everything here is new surface. It reuses the 2c tokens and components; nothing in this note changes a 2c token value.
**Mockup:** `docs/fireworks-app/design/phase-5-mockup.html` (static; the save bar in each state, the player with its notice, a My creations card and the not-found page).

Copy in this note is final: use it verbatim. `{name}` is a creation's name in curly quotes (“ ”) and is always non-blank, because a blank name saves as "Custom" (schema.md §6.4). Every name is rendered as text, never markup.

---

## 1. Rulings from this review (summary)

| # | Question | Ruling | Where |
|---|---|---|---|
| P1 | How the owner chooses Update original or Save as new (schema.md §11.4) | **Two buttons side by side, no dialog or menu**, with a note under them that says what each one does to the share link. | §2, §3 |
| P2 | F4: does a successful Save clear `shellDirty`/`skyDirty`? | **Yes, both.** The "Not saved" indicator reads a **third** flag, `saved`, which any shell or sky change clears (presets and Apply included). Luigi confirms. | §4 |
| P3 | What the dirty indicator says | `Not saved` · `Saving…` · `Saved`, next to the Save buttons, only when `canWrite`. | §2.3 |
| P4 | Share before the first save | Share is shown only when the designer has a `source`. Fresh work shows a note instead. When there are unsaved changes, the toast says the link plays the saved version. | §5 |
| P5 | Where save results and failures appear | Successes are toasts. **Failures and caveats are an inline status block** at the top of the panel, where the API banner sits (2c §6.3 said Phase 5 would extend that spot). Saves send `SUPPRESS_ERROR_TOAST`. | §3.4, §6 |
| P6 | F10 copy for every Save-time failure | §6 table. A 404 on Update original **asks**; a 404 on Save as new or a non-owner Save **falls back to a plain POST by itself** and reports success with a caveat. | §6 |
| P7 | Opening a link over shell or sky changes | The shared `confirm-dialog`, shown over the designer. | §7 |
| P8 | Player layout | Full-screen stage, an always-visible top bar (name, Remix, Play/Pause, Replay, Reduce flashing), the flashing notice centered. Under reduced motion it opens paused. | §8 |
| P9 | Player flashing notice | Same rules as the designer's: it holds playback until dismissed. The copy says whether this shell strobes. **One dismissal and one Reduce flashing choice per device, shared with the designer** (Skyler, 2026-11-14; Q1 answered). | §8.3 |
| P10 | Not-found page | One page for the player and `/c/:code`, for a bad-format code and a 404. | §9 |
| P11 | My creations | A card grid with palette swatches, a delete confirm, an empty state, paging, and an "unavailable" notice that waits for the session to settle. | §10 |
| P12 | F12: bracket paths in the Apply note | Keys outside the identifier pattern are shown in curly quotes, with invisible characters written as JSON escapes. Sky keys gain `(Sky)`. | §11.1 |

---

## 2. The save bar (designer panel)

### 2.1 Placement

A new block in the panel header, between the subtitle and the Playback section, in this order:

```
Fireworks Sandbox                                My creations
Shell designer
[status block: API banner, or a save message (§6), at most one of each]
[Save]  [Share]                                      Not saved
Update original changes what the share link for “Willow 2” plays.      (owner note, §2.2)
------------------------------------------------------------------
PLAYBACK ...
```

- **The whole bar renders only when `session.canWrite()` is true**, except Share (§5), which needs only a `source`. When writes are off and there's no `source`, the panel looks exactly as in 2c.
- **My creations link:** `a.text-small text-muted hover:text-primary`, right-aligned on the `h1` row (`flex items-baseline justify-between`). Hidden when `canWrite` is false (standing decision).
- Bar: `flex flex-wrap items-center gap-1.5 mb-1`. The indicator sits at the end with `ml-auto text-caption`.
- The save buttons use `.btn` with an accent edge and accent text: `.btn border-accent text-accent`. **Not the primary gradient**: Launch keeps the only gradient button in the panel, so there's one obvious "fire" action and Save doesn't compete with it. Contrast: accent on `surface-raised` is 9.8:1.
- Share is a plain `.btn`.
- At 760px and narrower, the bar sits at the top of the 45dvh panel, which is the first thing visible when the panel scrolls to the top. No change to 2c §2.2.

### 2.2 The buttons in each state

`source` is the draft's link to a saved record (schema.md §11.2). Rows are checked top to bottom.

| State | Buttons | Note under the bar |
|---|---|---|
| A save is in flight | Every save button inert: `aria-disabled="true"` and clicks ignored, **not** the `disabled` attribute, so the pressed button keeps focus (§12.1). The one pressed reads `Saving…` | unchanged |
| `source` is null (fresh work) | `Save` | none |
| `source.isOwner` is true | `Update original` · `Save as new` | `Update original changes what the share link for {sourceName} plays. Save as new keeps it and makes a new link.` |
| `source.isOwner` is false | `Save` | `Saves your own copy with a new link. The original isn't changed.` |

- **`{sourceName}`** is the saved record's name, which `source` doesn't hold today. Recommendation for Yoshi and Luigi: add `name` to the draft's `source` (client state only, §13 Y1). Until then the note reads `Update original changes what its share link plays. Save as new keeps it and makes a new link.`
- **While the indicator reads `Saved`**, `Save` and `Update original` are disabled (`title="No changes since you saved."`); the `Saved` beside them says why. `Save as new` stays enabled, because a duplicate is a legitimate thing to want.
- Why two buttons and not a dialog or a menu: the choice is between two permanent outcomes, and visible labels with a note let the visitor read both before acting, with one click and nothing hidden. A dialog would add a step to every save, and a split button hides the second option behind a chevron. The note says what Update original replaces (Peach's F4 note asked for that).
- Update original takes **no confirmation.** The button is labeled with what it does, and the note says what it changes. It's last-write-wins (schema.md §11.4); there's no undo and no version history, which is why the note is always visible and not a tooltip.

### 2.3 The indicator

`<p class="ml-auto m-0 text-caption">`, not a live region (§12.3).

| Condition (first match) | Text | Color |
|---|---|---|
| `canWrite` is false | not rendered | — |
| A save is in flight | `Saving…` | `text-muted` |
| `saved` is true | `Saved` | `text-success` |
| `source` is set, or `shellDirty \|\| skyDirty` | `Not saved` | `text-muted` |
| otherwise (untouched preset or default, no `source`) | not rendered | — |

- `Not saved` is muted, not a warning color. The draft keeps the work in this browser whatever happens (standing decision), so nothing is at risk; it's information, not an alarm.
- A working copy opened from a link reads `Not saved` straight away. That's literally true and matches L1: a link opens a new, unsaved copy.
- The state is never conveyed by color alone: the word changes.

### 2.4 Test-mode banner (Boo C17)

Shown whenever `canWrite && !isAuthenticated` (Skyler, 2026-11-14), which before Phase 8 is every test window. It appears on the designer (panel header, above the API banner and the status block), the player (in the top bar, under the controls) and `/mine` (under the subtitle). Copy, verbatim:

> Test mode: anyone who can reach this site can change or delete any saved creation, including yours. A share link may later play something else or stop working.

- One sentence for the exposure, one for what it means for a link. "Play something else" covers an overwrite; "stop working" covers a delete. "Including yours" is there because the first reading of "any saved creation" is "other people's".
- Style: `rounded-md border border-accent bg-surface-raised px-3 py-2 text-small text-primary`, `role="note"`, no Dismiss. It's a standing condition of the site, not an event, so it isn't a live region and doesn't take focus.
- It names no mechanism (no "login", no "Phase 8"): the visitor only needs to know what can happen to their link.

---

## 3. The Save flow

### 3.1 What each button sends

As schema.md §11.4. Every save sends compact JSON (`JSON.stringify`, no indent; schema.md §2.5) of the normalized shell after `validateShell`, with `SUPPRESS_ERROR_TOAST`.

| Button | Request | On 201/200 |
|---|---|---|
| `Save` (no `source`) | `POST api/creations` | `source` = the new record |
| `Update original` | `PUT api/creations/{source.shareCode}` | `source.updatedAt` (and `name`) refreshed |
| `Save as new` | `POST api/creations/{source.shareCode}/remix` | `source` = the new record |
| `Save` (non-owner) | `POST api/creations/{source.shareCode}/remix` | `source` = the new record |

Before sending, two client checks, in order:
1. **Strict validation.** `validateShell` fails → the §6 "400" message with the reasons, and no request.
2. **Size.** The UTF-8 byte length of the request body (`new TextEncoder().encode(body).length`) over 262,144 → the §6 "413" message, and no request. Reason: through Railway's edge an oversized body may come back as a reset (status 0), which would read as "offline" (schema.md §2.5). A shell can't get near 256 KiB, so this is for shows (Phase 6), but it belongs to the shared save path.

### 3.2 Success toasts

Success toasts are the existing 4 s polite toasts (`NotificationService.success`).

| Outcome | Toast |
|---|---|
| First save (POST) | `Saved {name}.` |
| Update original (PUT) | `Updated {name}. Its share link plays this version now.` |
| Save as new (remix) | `Saved {name} as a new creation with its own link.` |
| Non-owner save (remix) | `Saved {name} as your own copy.` |

`{name}` is the name the server returned (`CreationResponse.name`), so a blank name shows as “Custom”. The Name field itself stays as the visitor left it; the JSON panel already shows `Custom` (schema.md §6.4: the form model keeps raw text).

A successful save also clears any save message in the status block (§6).

### 3.3 Edits during a save

The document is captured when the button is pressed. On success:
- `source` is updated whatever happened meanwhile; the record exists.
- `saved`, `shellDirty` and `skyDirty` are cleared **only if the shell and sky are the same objects that were sent** (compare `shellPart`/`skyPart` by reference, as the flags already do). A visitor who edits while the request is in flight keeps `Not saved` and both flags. Saying `Saved` over an edit the server never received would be false.

### 3.4 Where results appear

- Success: a toast (§3.2), plus the indicator.
- Failure, or success with a caveat: the **status block** in the panel header (§6). It persists until the next save attempt, a successful save, or `Dismiss`. Failures that need a choice (the 404 on Update original, Reload) need buttons that outlast an 8 s toast, and one place for every save result means the visitor never has to look in two.
- Only the most recent save message shows. A new one replaces the old.

---

## 4. Dirty flags and Save (F4, for Luigi to confirm)

### 4.1 Recommendation

**A successful save clears `shellDirty` and `skyDirty`.** The "Not saved" indicator doesn't read those flags; it reads a third flag, **`saved`**.

| Flag | Meaning | Set by | Cleared by |
|---|---|---|---|
| `shellDirty` | the visitor changed the shell since it was last replaced or saved | a visitor shell edit; a link load (L1) | a preset or Apply load; a successful save |
| `skyDirty` | the visitor changed the sky since it was last replaced or saved | a visitor sky edit; a link load (L1) | an Apply with `sky`; a successful save |
| `saved` (new) | the shell and sky are exactly what was last saved | a successful save (§3.3 condition) | **any** change to the shell or sky, the visitor's or a load's: an edit, a preset, an Apply, a link load |

Draft layout: `{ shell, activeBreak, display, shellDirty, skyDirty, saved, source }`. **`saved` fails safe the other way**: only an explicit `true` reads as saved, so a missing or malformed value reads as `Not saved`. A broken flag must never claim the work is on the server, just as a broken dirty flag must never skip a confirmation. Display settings and the tab never touch any of the three.

### 4.2 Why

- **Why clear the dirty flags.** They exist to stop a replace from destroying the visitor's work (Skyler's 2c rulings). After a save the work is on the server, reachable from My creations and its share link, so a replace can't lose it. Asking "This replaces your current shell" right after Saved would warn about a loss that can't happen, every time the visitor moves on to the next preset. The confirm also stops asking when they open another link after saving, which is what §11.3's "second link straight after the first also asks" leaves to F4.
- **Why a third flag and not "not dirty".** Clearing the dirty flags on Save isn't enough to drive the indicator. Save, then click a preset: the preset doesn't ask (nothing to lose) and clears `shellDirty` as every load does, but the designer now holds Peony while `source` still points at the saved record (§11.2: a preset on a working copy is an edit to that copy). If the indicator read the dirty flags, it would say `Saved` over a Peony that was never saved, and `Update original` would be disabled (§2.2) or worse, look like a no-op. `saved` is cleared by loads as well as edits, so it can't be fooled.
- It's still flags, not a snapshot compare, as Skyler ruled for 2c. Setting a field back after saving reads `Not saved`.

### 4.3 What Luigi needs to confirm

1. `saved` as a `linkedSignal` over the whole model (shell and sky parts by reference), with the same restore-then-`true` computation pattern as the dirty flags, except its computation yields **`false`** on change and the save handler sets it `true` after the write, under the §3.3 condition.
2. A successful save sets `shellDirty` and `skyDirty` to `false` (same condition).
3. Fallbacks: the §6 404 paths clear the flags on their own success, like any save.

Peach writes the F4 criterion from this table once Luigi confirms.

---

## 5. Share

- **Shown when `source` is set**, whatever `canWrite` says: a share link is public and copying it writes nothing. Label `Share`. With writes off and no `source` (the production default), Share isn't shown.
- **Fresh work** (no `source`, `canWrite` true): no Share button, and the bar shows the note `Save to get a share link.` until the first save. A disabled button's `title` isn't reachable by keyboard, so the note is plain text.
- Share copies `{origin}/s/{source.shareCode}` (always the player link, schema.md §11.1) and shows a toast:

| State | Toast |
|---|---|
| `saved` is true | `Share link copied.` |
| otherwise | `Share link copied. It plays the last saved version, not your unsaved changes.` |

- The caveat case is "success with a caveat" (standing decision): the copy worked, then it says exactly what the link will play. For a non-owner's working copy, "the last saved version" is the original they opened, which is still accurate.
- **Clipboard blocked:** no toast. A row appears under the bar with a read-only text input holding the link, selected, and the note `Copy was blocked. The link is selected; press ⌘C to copy it.` (`Ctrl+C` off Apple platforms, as in the JSON panel). It goes away on the next Share, Save or any edit. Input: the 2c text-input style, `font-mono text-caption w-full`, `aria-label="Share link"`.
- Share never saves. "Share means save" would turn a copy into a write, and fail in all the ways §6 lists.

---

## 6. Save-time failures (F10)

A failed save is an **error**: nothing was written, so the caveat rule doesn't apply. The only caveat case is the remix fallback (row 404b), where the save did succeed.

**Status block** (one component, `save-status`, at the 2c §6.3 banner spot, below the API banner if both show):
- Error: `rounded-md border border-default bg-danger-surface text-on-danger-surface px-3 py-2 mb-3 text-small`, `role="alert"`.
- Caveat: the same with `bg-success-surface text-on-success-surface`, `role="status"`.
- Buttons inside: `.btn btn-sm mt-2`, in the order listed; then a `Dismiss` text button at the end (`aria-label="Dismiss message"`).
- Every error message ends with what is still true: the shell is kept in this browser. That's the most important fact for someone who just saw "Couldn't save".

| # | Status | When | Message | Buttons |
|---|---|---|---|---|
| 400a | 400, any issue with code `version` at `version` | A stale tab: the server now expects a newer document than this page makes | `Couldn't save: this page is out of date. Reload to get the latest version, then save again. Your shell is kept in this browser.` | `Reload` |
| 400b | 400, any other issues; or the client's own strict check (§3.1) fails | A client bug, or a stale tab sending something the server no longer accepts | `Couldn't save: the server didn't accept this shell ({reasons}). Reloading the page usually fixes this. Your shell is kept in this browser.` | `Reload` |
| 403 | 403 | Writes were switched off during the visit | `Couldn't save: saving has been turned off on this site. Your shell is kept in this browser.` | none |
| 404a | 404 on `Update original` (PUT) | The original was deleted, or it isn't this visitor's any more | `Couldn't update {sourceName}: the original was deleted or is no longer yours. Nothing was saved. Save as new to keep your shell with a new share link.` | `Save as new` |
| 404b | 404 on `Save as new` or a non-owner `Save` (remix) | The source was deleted | Not shown as an error. The client **retries once as a plain `POST api/creations`** (schema.md §11.2: never another remix) and, on success, shows the caveat block: `Saved {name} as a new creation. The original it came from was deleted, so the two aren't linked.` | none |
| 413 | 413, or the §3.1 size check | The document is over 256 KB | Shell: `Couldn't save: this shell is larger than the 256 KB the server accepts. Nothing was saved.` Show (Phase 6): `Couldn't save: this show is larger than the 256 KB the server accepts. Remove some cues or shells, then save again. Nothing was saved.` Both end `Your work is kept in this browser.` | none |
| 429 | 429 | Rate limited (20 a minute, 300 a day) | `Couldn't save: too many saves in a short time. Try again {when}. Your shell is kept in this browser.` | none |
| 0 | status 0, or no response | Offline, the server unreachable, or a dropped connection | `Couldn't save: can't reach the server. Check your connection and try again. Your shell is kept in this browser.` | `Try again` |
| 5xx | 500–599, or anything else | Server fault | `Couldn't save: something went wrong on the server. Try again in a moment. Your shell is kept in this browser.` | `Try again` |

Rules behind the rows:
- **400a before 400b.** A `(version, version)` issue means the page is older than the server, and the only fix is a reload. The draft survives the reload, and the new bundle upgrades it (schema.md §8.3, Peach F6).
- **`{reasons}`** comes from `issueReason` (§11.2), joined with `; `, at most 3, then `, and {k} more`; when the body has `truncated: true`, the tail is `, and more` (the true count is unknown; schema.md §2.4). Reasons in field-label language, so a bug report from the visitor is readable.
- **403:** after showing it, the client re-fetches `api/me`, so `canWrite` turns false and the save bar hides (§2.1). The status block stays until dismissed, so the explanation outlives the buttons it explains. The My creations link hides too.
- **404a: after a 404 from PUT, `source` becomes `null`** (recommendation, §13 Y2). The original is gone for this visitor, so the share link no longer plays and an Update original can never succeed again. With `source` null, Share hides and the bar offers plain `Save`, which is exactly the plain POST schema.md §11.2 calls for. The message's `Save as new` button does that POST. Why ask here and not fall back by itself: the visitor asked to change an existing link, and a new link is a different outcome they should choose.
- **404b falls back by itself** because the visitor already asked for a new record, and a plain POST gives them exactly that (a remix of a deleted source would have `remixedFrom: null` anyway, schema.md §2.1). If the fallback POST fails, its own row applies.
- **`{when}` from `Retry-After`:** seconds or an HTTP date, converted to seconds from now. Under 60 s: `in {n} seconds` (`in 1 second`); 60 s to 90 minutes: `in {m} minutes`, rounded up (`in 1 minute`); longer: `in about {h} hours` (the daily cap). Header missing or unreadable: `in a minute`. Static text: no live countdown (it would be re-announced or go stale). The Save buttons stay enabled.
- **Status 0** never brings up the API banner: one failure, one message (2c §6.3). If the API banner is already showing, a status-0 save still shows row 0, because it answers the button the visitor just pressed.
- **415** isn't listed: the client always sends JSON, so a 415 is a client bug and gets row 5xx's wording.
- The interceptor still logs method, URL and status to the console for every failure; no message quotes a URL or a status code.

---

## 7. Opening a link: `/c/:code`

### 7.1 While it loads

`/c/:code` loads, then redirects to the editor (schema.md §11.1). The visitor sees the empty page background with, after 300 ms (none for a fast load), a centered `Opening the shared shell…` (`role="status"`, `text-small text-muted`). A code that fails the §9 regex goes to the not-found page (§9) with no fetch.

### 7.2 The confirm over shell or sky changes

Asks only when `shellDirty || skyDirty` (schema.md §11.3; display settings and the tab never count). Shown **over the designer**, rendering the current draft behind the scrim, so the visitor sees what would be replaced. Whether `/c/:code` gets there through a resolver, a guard or a component is Luigi's call (§11.1).

The shared `confirm-dialog` (2c §6.4: native `<dialog>`, `alertdialog`, focus on the safe button, Escape and any close that isn't the replace button mean cancel, no backdrop answer):

> **Open {linkName}?**
>
> This replaces your current shell, {name}, including its breaks and sky, with a copy of {linkName}. Display settings stay as they are.
>
> `Keep editing` · `Open copy`

- `{linkName}` is the fetched creation's name; `{name}` is the current shell's. When the current name is blank, drop it and its commas and keep the closing sentence: `This replaces your current shell, including its breaks and sky, with a copy of {linkName}. Display settings stay as they are.` (the 2c rule; Apply's blank-name body keeps it too). The closing sentence is load-bearing: a link load keeps `display` (standing decision), and a confirm must say what it doesn't replace.
- The body always names the sky: a working copy brings its own sky (`DEFAULT_SKY` when the record has none, schema.md §11.2), so a link replaces both parts.
- **Keep editing:** the draft is untouched and the visitor lands in the editor (`/`), with no further fetch. Focus goes to the panel `h1` (tabindex `-1`), because the element that opened the dialog was on another page.
- **Open copy:** the working copy replaces the draft (both dirty flags set, `saved` false, `source` from the response, `display` kept), the editor shows it, its tab is Break 1, and it fires once like a preset load. Focus goes to the panel `h1`.
- No confirm needed (clean): the same as Open copy, without the dialog.
- First visit with no draft: no confirm; the designer's flashing notice applies as usual, holding the first burst.

### 7.3 When it can't open

| Case | Shown |
|---|---|
| Bad-format code, or 404 | The not-found page (§9), with its `/c/` sentence. The draft is untouched. |
| Upgrade fails (`version` newer than this app, schema.md §8.2) | Full-page message: **This shell needs a newer version of the app.** `It was saved by a newer version of Fireworks Sandbox than this page has. Reload to open it.` Buttons: `Reload` (primary) · `Go to the designer`. |
| Normalize fails on a current-version document (shouldn't happen; validator drift) | **This shell can't be opened.** `Its saved data isn't valid in this version of the app. Your shell in the designer hasn't changed.` · `Go to the designer`. Console warning with the issues. |
| Status 0 | **Can't reach the server.** `The shared shell couldn't be loaded. Check your connection and try again. Your shell in the designer hasn't changed.` · `Try again` (primary) · `Go to the designer` |
| 429 | **Too many requests right now.** `Try again {when}.` · `Try again` · `Go to the designer` |
| 5xx | **Something went wrong on the server.** `Try again in a moment. Your shell in the designer hasn't changed.` · `Try again` · `Go to the designer` |

These full-page messages share the not-found page's layout (§9). For shows (Phase 6), "shell" becomes "show" in every row.

---

## 8. The player: `/s/:code`

### 8.1 Layout

Full viewport, `surface-sunken`, the stage filling it (`absolute inset-0`), no panel, no HUD, no hint.

```
+------------------------------------------------------------------------------------+
| Willow 2                                    [Remix] [Pause] [Replay] Reduce [Off]  |
| Fireworks Sandbox                                                                  |
|                                                                                    |
|                     [ Flashing lights notice, centered ]                           |
|                                                                                    |
|▄▄▄ skyline ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄|
+------------------------------------------------------------------------------------+
```

- **Top bar**, always visible (no auto-hide; a hiding control bar fights keyboard and screen-reader use, and the bar is small): `absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 px-3 pt-2.5 pb-6 bg-[linear-gradient(to_bottom,rgba(4,6,12,0.75),transparent)]`. The gradient is the stage color, so it reads as sky, not chrome.
- **Left:** `h1` = the creation's name (`text-heading m-0 [text-shadow:0_1px_2px_#000] break-words`, max 2 lines). Below it, `text-small text-muted`: a link `Fireworks Sandbox` → `/` (so a visitor can make their own). No "Remixed from" line: it isn't rendered anywhere before Phase 8 (Skyler, 2026-11-14; schema.md §11.5).
- **Right**, `flex flex-wrap gap-1.5 justify-end`:
  - `Remix`: `.btn border-accent text-accent`, **always shown, whatever `canWrite` is** (Skyler, 2026-11-14; schema.md §11.1). Navigates to `/c/{code}` (no API call; §7). With writes off, the working copy can be edited and played but not saved (the save bar stays hidden, §2.1). `title="Open a copy in the designer to change and play"`.
  - `Pause` / `Play`: one toggle button, `aria-pressed` not used; the label changes. Required by WCAG 2.2.2 (motion over 5 s needs a pause).
  - `Replay`: fires the shell again from the start, now.
  - The Reduce flashing switch, the 2c §5.4 control, label `Reduce flashing`, value `On`/`Off`.
- At 480px and narrower the right group wraps under the name; the bar keeps `pb-6`.
- `<title>`: `{name} · Fireworks Sandbox` (no curly quotes in the title).

### 8.2 Playback

- **A shell plays as the designer's Preview loop**: it fires at the default target, then again every `shellDuration`, with the 2c §7.1 reduce-flashing rules in force. Clicking the sky does nothing here (a viewer, not a sandbox; avoids accidental bursts on touch).
- **Pause** freezes the loop timer and the sim (the stage's existing `paused` input, `luigi-2c-dirty-flag-and-notice-hold.md` point 4); particles in flight hold still. **Play** resumes where it stopped.
- **Under `prefers-reduced-motion`**, the player opens **paused**, whatever the notice state, with a centered `Play` button (primary gradient) on the empty sky and the line `Reduce flashing is on. Press Play to start.` under it, or `Press Play to start.` when Reduce flashing is off (S1, Rosalina's post-build review, approved by the coordinator 2026-11-14). This is the player's version of "Manual under reduced motion" (decisions §5: "The player gets the same in Phase 5"). It's never remembered: the next load under the same setting opens paused again.
- Space toggles Play/Pause when focus isn't on a control (the 2c §6.2 exclusion list), and never while the notice shows.
- A show (Phase 6) plays through to its last particle (schema.md §4.5). Phase 5 plays shells; until Phase 6, a show link shows the §7.3 "can't be opened" layout with **This show can't be played yet.** `Shows arrive in a later version of Fireworks Sandbox.` · `Go to the designer`.

### 8.3 Flashing notice

Same component family and rules as the designer's (2c §7.2): non-modal, on the stage, **holds playback until it's dismissed**, no ×, no Escape, focus to its first button if focus is on `body`. Position: `absolute inset-x-3 top-1/2 -translate-y-1/2 mx-auto max-w-[420px]`, 2c notice style. It appears after the creation loads (the copy depends on it), before the first burst.

The strobe sentence is chosen from the shell: **strobe** when any break has `effect: "strobe"`.

Reduce flashing **off**:
> **Flashing lights.** {name} starts when you close this notice. {strobe ? `It has bright bursts and strobe effects.` : `Its bursts flash brightly.`} If flashing affects you, turn on Reduce flashing first. You can pause at any time.
>
> `Turn on Reduce flashing` (primary gradient) · `Play`

Reduce flashing **on** (an earlier choice or the OS setting):
> **Flashing lights.** {name} starts when you close this notice. Reduce flashing is on, so strobe is off and burst flashes are dimmed.
>
> `Play`

- `Play` replaces 2c's `Continue`, because on the player that's exactly what happens.
- Under reduced motion the notice still shows (when not yet dismissed); its `Play` starts playback. The visitor answered a notice that said so; that's the explicit start the reduced-motion rule waits for.
- On dismiss, focus moves to `Pause` (the control that now matters).
- **Ruled (Skyler, 2026-11-14; Q1): one dismissal per device, shared with the designer** (`fireworks.flashNotice.v1`), and **one Reduce flashing choice per device**, shared too. A link load keeps `display` (schema.md §11.3), so opening a link never undoes the choice. A visitor who turned Reduce flashing on in the designer would be surprised to get unreduced strobe from a share link. Today the choice lives in the designer draft (`fireworks.draft.v1` `display.reduceFlashing`); where a shared value should live is Luigi's and Yoshi's call (§13 L4). The cost of sharing the dismissal: on a shared computer, a second person opening a link doesn't see the notice. Reduce flashing following the OS still covers anyone who has asked their device for reduced motion.

### 8.4 Loading and errors

- While the GET is in flight: the empty sky and skyline, and after 300 ms a `Loading…` line bottom-left (`role="status"`, the 2c hint style).
- Bad-format code or 404: the not-found page (§9).
- Upgrade fails: **This creation needs a newer version of the app.** `It was saved by a newer version of Fireworks Sandbox than this page has. Reload to play it.` · `Reload` (primary).
- Normalize fails: **This creation can't be played.** `Its saved data isn't valid in this version of the app.` · `Make your own` → `/`.
- Status 0, 429 and 5xx: the §7.3 rows with `to play it` wording and without the designer sentence: **Can't reach the server.** `This creation couldn't be loaded. Check your connection and try again.` · `Try again`. **Too many requests right now.** `Try again {when}.` · `Try again`. **Something went wrong on the server.** `Try again in a moment.` · `Try again`.

---

## 9. Not-found page

One page for `/s/` and `/c/`: a code that fails the share-code regex (no fetch) or a 404.

- Layout (shared by every full-page message in §7.3 and §8.4): `min-h-dvh grid place-items-center bg-surface-sunken p-4`, card `max-w-[420px] rounded-xl bg-surface border border-default p-5`, `h1 text-heading`, body `text-body text-muted`, buttons `flex flex-wrap gap-2 mt-4`. The skyline silhouette along the bottom, static (no stage, no Pixi chunk).
- `<title>`: `Link not found · Fireworks Sandbox`.

> **Nothing plays at this link**
>
> The link may be mistyped or cut short, or the creation was deleted. Share links are case-sensitive, so check capital letters too.
>
> `Make your own` (primary) → `/`

On `/c/`, one more sentence: `Your shell in the designer hasn't changed.` And the button reads `Go to the designer`.

Deliberately vague between "never existed" and "deleted": the server answers both with the same 404 (schema.md §10), and the copy mustn't claim more than it knows.

---

## 10. My creations: `/mine`

### 10.1 States, checked in order

| State | Shown |
|---|---|
| Session still loading (`session.status() === 'loading'`) | Nothing but the page header; after 300 ms `Loading…` (`role="status"`). **Never the unavailable notice yet**: `canWrite` is false until `api/me` answers (`session.ts`), so deciding early would flash "unavailable" at every visitor with writes on. |
| Session `unavailable` (api/me failed) | **Can't reach the server.** `My creations can't load right now. You can keep designing; your work is kept in this browser.` · `Try again` · `Go to the designer` |
| `canWrite` false | The unavailable notice (§10.2). No call to `api/me/creations`. |
| Loading the page | Skeleton: 6 card outlines (`border border-default rounded-lg h-[132px]`), no shimmer animation. |
| `totalCount` 0 | The empty state (§10.5). |
| Items | The grid. |
| A page past the end (`items` empty, `totalCount` > 0) | Navigate to the last page with `replaceUrl`. |
| List errors | 403: the unavailable notice (writes went off). 0: **Couldn't load your creations.** `Check your connection and try again.` · `Try again`. 429: **Too many requests right now.** `Try again {when}.` · `Try again`. 5xx: **Something went wrong on the server.** `Try again in a moment.` · `Try again`. The list GET sends `SUPPRESS_ERROR_TOAST`. |

### 10.2 Unavailable notice (writes off)

> **My creations isn't available**
>
> Saving is turned off on this site right now, so there's nothing to list here. You can still design shells in the designer, and your work is kept in this browser.
>
> `Go to the designer`

Same card layout as §9. `<title>`: `My creations · Fireworks Sandbox`.

### 10.3 Page and card

- Page: `min-h-dvh bg-surface-sunken px-4 py-5`, content `max-w-[1100px] mx-auto`. Header: `a` `← Shell designer` (`text-small text-muted`), `h1` `My creations`, subtitle `text-small text-muted`: `Shells you've saved. Anyone with a share link can play it; nothing here is listed publicly.`
- Grid: `grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`, as a `ul`/`li` list. `pageSize` 24 (fills 2, 3, 4 or 6 columns evenly; schema.md §2.2.1).
- **Card** (`li`): `rounded-lg bg-surface border border-default p-3 flex flex-col gap-2`.
  - Swatch row: one dot per `palette` entry, in order (at most 8): `size-4 rounded-full`, the engine hex with the 2c glow (`box-shadow: 0 0 6px <hex>`), `rainbow` as the 2c conic gradient. The row is `role="img"` with `aria-label="Colors: Red, Gold, Rainbow"` (the 2c color labels); the dots are `aria-hidden`. An empty palette (shouldn't occur for a shell) renders no row.
  - Name: an `h2 text-body font-semibold m-0 line-clamp-2 break-words`, containing the **Open** link (`/c/{code}`), so the name is the primary target. `title` = the full name.
  - Meta: `text-caption text-muted`: `Shell · Updated 3 days ago`, the time a `<time datetime="{updatedAt}">` with `title` = the full local date and time. Relative text from `Intl.RelativeTimeFormat` (`just now` under a minute). Display only; `updatedAt` stays an opaque token for comparisons (schema.md §2.1).
  - Actions, `flex gap-1.5 mt-auto`: `Play` (`a.btn btn-sm` → `/s/{code}`), `Share` (`.btn btn-sm`, copies the `/s/` link: toast `Share link copied.`, blocked clipboard → the §5 inline field under that card), `Delete` (`.btn btn-sm`, `aria-label="Delete {name}"`).
- **Open** goes through `/c/`, so an unsaved draft gets the §7.2 confirm.
- Phase 5 cards are all shells; a show card (Phase 6) reads `Show ·` and its Open goes to the Show Builder.

### 10.4 Delete

The shared `confirm-dialog`:

> **Delete {name}?**
>
> Its share link will stop working for everyone you've sent it to. This can't be undone.
>
> `Keep it` · `Delete`

- The confirm button uses a new `.btn-danger`: `bg-danger-surface text-on-danger-surface border border-danger font-semibold` (text 11.9:1; the `danger` edge is 8.5:1 against the dialog's `surface-raised`). Not the primary gradient, which means "go" everywhere else.
- Focus starts on `Keep it` (2c pattern).
- **204:** the card is removed, toast `Deleted {name}.`, and the page is re-fetched (paging shifts by one). Focus moves to the next card's name link, else the previous card's, else the `h1` (tabindex `-1`). On a page emptied by the delete, go to the previous page.
- **404:** the desired state holds (it's gone; `boo-race-guards-check-desired-state.md`), so it's a success: remove the card, toast `{name} was already deleted.`
- **403:** the unavailable notice replaces the page (writes went off).
- **0 / 429 / 5xx:** an error toast (these are short, and the card is still there to retry): `Couldn't delete {name}: can't reach the server. Try again.` · `Couldn't delete {name}: too many changes in a short time. Try again {when}.` · `Couldn't delete {name}: something went wrong on the server. Try again in a moment.` Delete sends `SUPPRESS_ERROR_TOAST`.
- Deleting the record the designer's draft points at needs nothing special: the next Update original gets row 404a.

### 10.5 Empty state

> **Nothing saved yet**
>
> Shells you save in the designer show up here, with a share link for each.
>
> `Open the designer` (primary)

### 10.6 Paging

- Only when `totalCount > pageSize`. `nav aria-label="Pages"` under the grid: `Previous` · `Page 2 of 5` · `Next` (`.btn btn-sm`; the ends disable at page 1 and the last page).
- The page is in the URL (`/mine?page=2`), so Back and reload work. A `page` that isn't a positive integer is treated as 1 (`replaceUrl`).
- After a page change, focus moves to the `h1` and a polite region says `Page 2 of 5.`

---

## 11. Copy for issue codes and paths

### 11.1 F12: bracket paths in the Apply note

`unknownKeyName` (`designer-copy.ts`) shows §6.2 rule 11 paths raw today (`["a.b"]`, `breaks[0]["a\"b"]`). The rule:

1. **Parse the last segment** of the path: a plain `.name` (or a root `name`), or a bracket `["…"]`, unescaping `\\` → `\` and `\"` → `"`. Its container gives the qualifier: root → none, `sky` → ` (Sky)`, `breaks[n]` → ` (Break {n+1})`.
2. **A plain-form key is shown as typed**, as today: `sparkle (Break 1)`, `theme`.
3. **A bracket-form key is shown in curly quotes**: `“a.b”`. Quotes are what tell the visitor this is one odd name, not a path, and make an empty name visible (`“”`).
4. **Inside the quotes, invisible characters are written as JSON escapes**, so the visitor can find them in what they pasted: control characters (Cc) as `\n`, `\t`, `\r`, `\b`, `\f`, else `\u001b` style (lowercase hex, as `JSON.stringify` writes them); format characters (Cf, including zero-width spaces, U+FEFF and the bidi controls U+202A–U+202E, U+2066–U+2069), U+2028, U+2029, and every space character except U+0020, as `\uXXXX`. A backslash becomes `\\` so an escape can't be confused with a typed one. `"` stays as is. U+FFFD (from an unpaired surrogate) stays as is. Writing bidi controls as escapes also stops a pasted key from reordering the rest of the note.
5. **The 40-character cut** (2c §3.6) applies after step 4, counting code points; the `…` goes inside the closing quote: `“aaaaaaaa…”`.

| Path | Shown |
|---|---|
| `breaks[1].sparkle` | `sparkle (Break 2)` |
| `theme` | `theme` |
| `sky.theme` | `theme (Sky)` (today: `theme`) |
| `["a.b"]` | `“a.b”` |
| `[""]` | `“”` |
| `breaks[0]["a\"b"]` | `“a"b” (Break 1)` |
| `["a\nb"]` (a newline in the key) | `“a\nb”` |
| `sky["‮evil"]` (U+202E) | `“‮evil” (Sky)` |
| `["st�ars"]` | `“st�ars”` |

Show paths (`shells.<key>…`, `cues[i]…`) get their qualifiers at the Phase 6 timeline design-review.

### 11.2 `issueReason` copy for the codes that reach a Save (schema.md §15)

These appear in the §6 400b `{reasons}` list. The lenient Apply never shows most of them, because lenient mode adjusts instead (2c §3.6 already words the adjustments). Bounds come from `limits.ts`.

| Code | Reason |
|---|---|
| `missing`, required field | `{Field} is missing` |
| `missing`, optional field given `null` (`sky`, a cue's `burstHeight`; schema.md §6.2 rule 13) | `{Field} is null; remove it instead` |
| `missing`, blank name | `Name is blank` (a save never sends one; normalize makes it "Custom") |
| `out-of-range` | `{Field} {value} is outside {min} to {max}` |
| `not-integer` | `{Field} must be a whole number` |
| `type` with `integer` (F11, Luigi) | `{Field} must be a whole number` |
| `too-long` | `Name is longer than 80 characters` |
| `unknown-property` | `{key per §11.1} isn't a field this app knows` |
| `name-format` | `Name has spaces at its ends or hidden characters` |
| `not-json` | `the data sent wasn't valid JSON` |
| `duplicate-key` | `{Field} appears more than once` |
| `shell-count` | `a show can have up to 32 shells` |
| `cue-count` | `a show needs 1 to 1000 cues` |
| `key-format`, `duplicate-id`, `unknown-shell` | Worded at the Phase 6 timeline design-review; until then the existing placeholder `{Field} isn't valid`. |

**`cleaned` in the Apply note:** not mentioned, like `defaulted`. Trimming edge spaces or removing invisible control characters from a pasted name changes nothing the visitor can see, and the refreshed JSON shows the cleaned name.

---

## 12. Accessibility

### 12.1 Focus

- Save buttons: the pressed button keeps focus through `Saving…` (it's `aria-disabled`, not `disabled`, §2.2). A `disabled` button drops focus to `body` in most browsers, so when the save ends with that button disabled (`Saved`, §2.2), focus moves on: to `Save as new` for an owner, otherwise to `Share` (which a first save has just revealed). Focus is never left on a disabled control.
- The status block never takes focus; `role="alert"` announces it. Its buttons are next in Tab order after the h1 row, before the save bar.
- After 404a's `Save as new`, focus returns to the save bar's `Save`.
- `/c/` confirm: initial focus `Keep editing`; afterwards the panel `h1` (§7.2).
- Player: notice's first button if focus is on `body`; on dismiss, `Pause`; under reduced motion with no notice, the centered `Play`. Not-found and full-page messages: the `h1` (tabindex `-1`) on load. `/mine`: the `h1` on load and after paging; the delete rules in §10.4.

### 12.2 Keyboard

| Where | Keys |
|---|---|
| Designer | Unchanged from 2c §8.2. Save has no shortcut in Phase 5 (Phase 7's keyboard audit can add Ctrl/⌘+S). |
| Player | Tab order: name links, Remix, Pause/Play, Replay, Reduce flashing. Space: Play/Pause when focus isn't on a control (2c §6.2 exclusions) and the notice isn't showing. Enter/Space on the notice's buttons. |
| My creations | Tab order per card: name (Open), Play, Share, Delete. Then paging. |
| Dialogs | The 2c `confirm-dialog` keys. |

### 12.3 Live regions

- Toasts: success polite (existing), errors `role="alert"` (existing).
- Status block: `role="alert"` for errors, `role="status"` for the caveat.
- **The `Not saved` / `Saved` indicator is not a live region.** It flips to `Not saved` on the first keystroke of every edit; announcing that would talk over the visitor. The save result is announced by the toast or the status block.
- `/mine`: a polite region for `Page {n} of {m}.`; delete results are toasts.
- Player: the `Loading…` line is `role="status"`; Play/Pause label changes aren't announced beyond the button's own name.

### 12.4 Contrast and motion

- New pairs (measured): accent on `surface-raised` (save buttons) 9.8:1; `danger` edge on `surface-raised` 8.5:1; `on-danger-surface` on `danger-surface` 11.9:1 (2c §8.4); `text-muted` on `surface-sunken` 6.6:1 (player meta, mine subtitle). The player's top-bar text sits over fireworks, so it keeps the 2c text-shadow and the stage-colored gradient.
- No new animation. Toasts, the status block and the player bar appear without transitions. Skeleton cards don't shimmer.

---

## 13. Notes for implementers and owners

- **Y1 (Yoshi, Luigi): `source.name`.** Add the saved record's `name` to the draft's `source` (client state, schema.md §7, §11.2), set wherever `source` is set, so §2.2's note and §6 404a can name the original. Without it the copy falls back to "its share link" / "the original".
- **Y2 (Yoshi, Luigi): `source` becomes null after a 404 from PUT** (§6 404a). schema.md §11.2 says only a link load and a save change `source`; this adds a third. After a 404 the source is gone to this visitor, so keeping it would offer an Update original that can't succeed and a Share link that plays nothing. If Yoshi prefers keeping `source` with a "gone" marker, the visible behavior in §6 must stay the same.
- **L1 (Luigi): the `saved` flag and F4** (§4.3). Confirm, or bring a counter-proposal to me before building.
- **L2 (Luigi): `/mine` waits for the session** (§10.1). `canWrite` is false while `api/me` is in flight, so a direct visit must not decide "unavailable" until `status()` is `ready`.
- **L3 (Luigi): status 0 on a save never triggers the API banner** (§6).
- **L4 (Luigi, Yoshi): a device-wide Reduce flashing choice** shared by the designer and the player, and one shared notice dismissal (§8.3, Q1 ruled 2026-11-14). A link load keeps `display`.
- **L5 (Luigi): `unknownKeyName`** per §11.1, and `issueReason` per §11.2.
- **B1 (Boo):** names render as text everywhere (cards, `h1`, `<title>`, dialog bodies, toasts). `remixedFrom` is not rendered anywhere before Phase 8 (schema.md §11.5); the API still returns it under §2.1 (accepted interim exposure). The player's `Fireworks Sandbox` link goes to `/` only.
- **P (Peach): observable points.** Indicator states in §2.3 (including `Not saved` straight after a link load, and `Not saved` after Save → preset); Save buttons per §2.2 by `source`; a save → preset click → no dialog (F4); a save → open another link → no dialog; edit during an in-flight save → still `Not saved`; Share hidden before the first save, the caveat toast when unsaved; each §6 row by stubbing the status (Toad's harness); 404b makes exactly one remix call then one plain POST (call ledger); 403 hides the save bar and keeps the message; a draft with `saved` missing reads `Not saved`; the player opens paused under emulated reduced motion; the notice holds playback and its strobe sentence follows the shell; `/mine` never shows "unavailable" during the session load with writes on; delete focus moves to the next card.

## 14. Deliberate departures and additions

Everything here is new surface without a prototype counterpart. The departures that touch 2c behavior:
1. **A successful save clears both dirty flags** (§4), adding to 2c §6.4's clearing list (updated in place).
2. **Sky keys in the Apply note gain `(Sky)`** (§11.1); 2c §3.6 named only breaks.
3. **Bracket-form keys are quoted and escaped** in the Apply note (§11.1).
4. **The panel header grows the save bar and the status block** (§2), below the 2c header.

## 15. Open questions for Skyler

- **Q1 (answered 2026-11-14: yes to both). Is the player's flashing notice once per device, shared with the designer, and is the Reduce flashing choice one device-wide setting?** Recommendation: yes to both (§8.3). The alternatives are a notice on every player visit (safer on shared computers, more friction for every link), or a player choice kept separately from the designer's.

# Phase 8 design review: sign-in UX (8.0b)

**Date:** 2026-11-16 · **Author:** Rosalina (design-review, before B2) · **Status:** proposed; binds B2 once Skyler answers §13 and Boo's 8.0a doesn't overrule a point marked **[Boo]**. · **Record:** `.squad/decisions/records/rosalina-phase-8-design-review.md`

**Inputs, read as code:**
- `design/phase-8-auth.md` §3.4, §3.8, §5.3, §5.4, §6, and `records/yoshi-phase8-auth-design.md`. Both still say "GitHub and Google". Skyler ruled **Google only**, so every provider list below has one entry, and the "provider list" UI is one button.
- `core/session.ts`: `canWrite` is false until `api/me` answers, and `status()` is the only reliable "decided" signal.
- `shared/save-bar/save-bar.ts`: the save buttons render only `@if (canWrite())`, and the indicator and note return null when `!canWrite`.
- `features/designer/pages/designer-page/designer-save.ts` and `show-save.ts`: a 403 reloads `api/me`, and `forgetSource()` runs on a PUT 404.
- `shared/save-copy.ts`: `SaveStatusAction` is `reload | saveAsNew | retry`. `shared/save-shortcut.ts`: `!canWrite → pass`.
- `features/mine/pages/mine-page/{mine-page.ts,.html}`: the `unavailable` notice comes from `!canWrite || forbidden`. `CreationListItem` (`core/models.ts`) has **no `remixedFrom`**.
- `features/player/pages/player-page/player-page.html`: the top bar, Remix, and the banner wrapper at l.86 and l.193.
- `designer-page.html` and `show-builder-page.html`: the nav sits on the `h1` row, `My creations` is `@if (saveFlow.canWrite())`, and `<app-test-mode-banner />` sits under the subtitle. The builder's skip link is the aside's first child.
- `shared/test-mode-banner.ts`, `shared/confirm-dialog.ts` (cancel first, safe button focused, native `<dialog>`).
- `src/api/Fireworks.Api/Services/ResponseHeaders.cs`: the CSP. It has **no `font-src`**, so fonts fall back to `default-src 'none'`, and `img-src 'self'`.
- `tools/browser-gates/gate-keyboard.mjs` l.51: `ENGINE_STOPS = { firefox: ['designer-panel', 'builder-panel'] }`.
- Google's current branding guidelines (developers.google.com/identity/branding-guidelines, fetched 2026-11-16).

---

## 1. Rulings (summary)

| # | Ruling |
|---|---|
| R1 | **Account control** sits on the subtitle row of the designer, the builder and `/mine`, aligned right: `Sign in` when signed out, and `{name} · Sign out` when signed in. The player gets none (§2). |
| R2 | **`My creations` is always in the nav.** Signed out, it leads to the in-page sign-in prompt (§4). |
| R3 | **The branded button is a self-built HTML button** following Google's Light theme, rectangular, with the text `Sign in with Google`. The G is copied unmodified from Google's asset bundle. It appears only in the sign-in dialog, on `/signin` and on `/mine`'s prompt. The nav `Sign in` is our own text control, which opens the dialog (§3). |
| R4 | **Signed-out Save is a dialog, not inline.** The save bar renders one `Save` whenever the session is `ready` and signed out. It opens a native `<dialog>` and sends nothing (§5). **[Boo: C9]** |
| R5 | **No auto-save after the return** (agreeing with Yoshi). Focus goes to Save, and a toast says `Signed in as {name}.` A `sessionStorage` intent flag tells the page it has just come back (§6). |
| R6 | **⌘S signed out opens the sign-in dialog** (prevented). It stays `pass` only when no save bar renders (§5.5). |
| R7 | **`/mine` signed out renders the prompt in place** at `/mine`, with no redirect. This departs from Yoshi §6.3; Yoshi and Luigi to confirm (§7). |
| R8 | **Legacy creations get no special UI.** To every account they look exactly like someone else's creation (§8). |
| R9 | **401, 412, 428 and the sign-in failure copy** are in §9. **412 offers `Save as new` and `Replace the newer version`.** Without the second, Update original is a permanent dead end for that working copy. |
| R10 | **"Remixed from"** renders only on the player, under the name, as `Remixed from the original`, for `isAuthenticated && isOwner` (§10). |
| R11 | **The banner slot closes up.** Nothing replaces it (§11). |
| R12 | **Firefox aside stops:** add `tabindex="-1"` to both scrollable asides, and drop `ENGINE_STOPS` from `gate-keyboard` (§12.5). |

---

## 2. Signed-in and signed-out states

### 2.1 Placement

Designer (the builder is the same, with `Shell designer` and `Show Builder` swapped):

```
Fireworks Sandbox                         Show Builder   My creations
Shell designer                                              Sign in
```
```
Fireworks Sandbox                         Show Builder   My creations
Shell designer                                 Ada Lovelace · Sign out
```

`/mine`: the existing nav row (`Shell designer  Show Builder`) becomes `flex justify-between`, and the account control sits on its right.

- The subtitle `<p>` becomes `flex items-baseline justify-between gap-2`. The subtitle text stays first in the DOM, and the account control comes after it, so the Tab order is h1-row links, then the account control, then the API banner and status block, then the save bar.
- **States, from `session.status()`:**
  - `loading` or `unavailable`: nothing is rendered in the slot. The row's height doesn't change, because the subtitle holds it.
  - `ready` and signed out: `Sign in`.
  - `ready` and signed in: the name and `Sign out`.
- **`Sign in`:** a `<button type="button">` styled as the existing nav links (`touch-link text-small text-muted hover:text-primary`, no underline), with `aria-haspopup="dialog"`. It opens the §5 dialog in its nav variant. It is not a Google-branded control, so the branding rules don't apply to it. It never says "Google" on its own, which the guidelines forbid for a sign-in action.
- **The name:** `<bdi>` text (Boo C1, C3) in `text-small text-primary`, `truncate max-w-[16ch]` (`max-w-[12ch]` under 760px). It has `title="Signed in with Google as {name}"`, and the full name stays in the DOM, so a screen reader reads all of it. A blank `displayName` reads `Signed in`.
- **`Sign out`:** a button in the same link style. A ` · ` separator (`aria-hidden="true"`) sits between the name and it.
- **The player gets no account control.** It is a viewing surface with a stage overlay, and nothing there needs identity except "Remixed from" (§10). The way to sign in from a link is Remix, then Save.

### 2.2 Sign out

1. On press, `Sign out` becomes `aria-disabled="true"` with `.btn-busy`-style behavior (clicks ignored, `cursor-progress`), and the client sends `POST api/auth/logout`.
2. On 204, `session.load()` runs.
3. When it settles, `Sign in` replaces the control. **Focus moves to `Sign in`** if it was on `Sign out` or `body` (the K9 guard). Success toast: `Signed out.`
4. On `/mine`, the page swaps to the signed-out prompt (§7), and focus goes to that card's `h1`.
5. A network failure gives the error toast `Couldn't sign out: can't reach the server. Try again.` `Sign out` stays and keeps focus.

**The draft stays in this browser after sign-out.** That is the standing rule: a draft is never lost. Its `source.isOwner` is corrected by the next signed-in restore (Yoshi §6.4). Whether a shared computer should clear it is §13 Q1.

---

## 3. The Google button (branding)

Google's current guidelines allow:

| Theme | Fill | Stroke | Text |
|---|---|---|---|
| Light | `#FFFFFF` | `#747775`, 1px, inside | `#1F1F1F` |
| Dark | `#131314` | `#8E918F`, 1px, inside | `#E3E3E3` |
| Neutral | `#F2F2F2` | none | `#1F1F1F` |

- **Allowed text:** `Sign in with Google`, `Sign up with Google`, `Continue with Google`. "Google" alone is not allowed.
- **Shapes:** rectangular or pill. An icon-only G exists, but it isn't needed here.
- **Font:** Google Sans Medium, 14px on a 20px line.
- **Web padding:** 12px before the logo, 10px between the logo and the text, and 12px after the text.
- **The G:** standard colors only. Don't change its size or color, and don't redraw it. Start from the asset bundle (`developers.google.com/static/identity/images/signin-assets.zip`).
- **Size:** the button may scale only if its aspect ratio is kept.
- **Custom buttons:** allowed when Google's SDK isn't used. Here it can't be: the GIS script is cross-origin, `script-src 'self'` forbids it, and GIS is a client ID-token flow rather than our server-side OAuth redirect.

**Our button:**
- **Light theme, rectangular, `Sign in with Google`.** The white fill is the one place the G sits on white, which is the safest reading of "the logo must appear on a white background". It's also the most visible action on our dark surfaces. The Dark theme's `#131314` would look like our own `.btn` and lose its prominence. One variant only: no pill, no Dark, no Neutral.
- **Element:** a `<button type="button">` (not an `<a>`). Its handler runs `flushDraft()`, sets the §6.1 intent flag, then calls `location.assign(...)` (Yoshi §6.1; not a `<form>`, because of `form-action`).
- **Classes:** `inline-flex items-center h-[40px] pl-[12px] pr-[12px] gap-[10px] rounded-[4px] border border-[#747775] bg-[#FFFFFF] text-[#1F1F1F] text-[14px] leading-[20px] font-medium` with `font-family: 'Google Sans', Roboto, system-ui, sans-serif`. Use raw px throughout: the root font is 13px, so rem utilities would come out wrong (phase-7.md §5.2). The border is `box-border` (inside).
- **Brand hexes stay literal.** They aren't added as theme tokens: they are Google's, not ours, and must not drift with our palette. This is the one sanctioned hard-coded color set, and it is scoped to this one component (`app-google-sign-in-button`).
- **Touch:** under `pointer-coarse`, `min-h-[44px]`. Only the vertical padding grows; the G and the text keep their size.
- **The G:** a 20×20 inline `<svg aria-hidden="true">` in the component template, with its paths copied unmodified from the bundle's web asset. An inline template SVG needs no `img-src` and is not an HTML sink. If Luigi prefers a file, use `public/brand/google-g.svg` as an `<img alt="">`, which `img-src 'self'` allows.
- **States:**
  - Hover: Google's own buttons add a light overlay. Use `hover:bg-[#F7F8F8]`. That changes the fill only, never the G.
  - Focus: our standard `focus-visible` accent outline, offset 2px. The guidelines don't restrict focus rings, and keyboard visibility comes first.
  - After the press: `aria-disabled="true"` and `cursor-progress`, with the text unchanged. The page is navigating away.
- **Font, [Boo]:** Google Sans would have to be self-hosted from the same origin (a subset WOFF2 of Medium, about 20 KB). That needs **`font-src 'self'`** added to the CSP, and today fonts fall to `default-src 'none'`.
  - **Recommendation:** add `font-src 'self'` and self-host. Luigi checks the font's licence in the download.
  - If Boo declines, the stack falls back to Roboto or the system sans at weight 500. That is a minor branding departure, recorded here, and the button is still recognisable by the G and the wording.
  - Never load the font from `fonts.googleapis.com`. The CSP forbids it, and it would send every visitor's IP address to Google before they choose to sign in.
- **Accessible name:** the visible text. No `aria-label`.

---

## 4. Nav: `My creations`

`My creations` now renders whatever `canWrite` is (until now it was `@if (saveFlow.canWrite())`). Signed out, it opens the `/mine` prompt (§7), which explains itself. Hiding it would leave a returning visitor with no way to find their work before signing in. This replaces the "hidden when `canWrite` is false" part of phase-5.md §2.1, which tracked the pre-Phase-8 write switch.

---

## 5. Save for anonymous visitors

### 5.1 The save bar, signed out

When `session.status() === 'ready'` and the visitor isn't signed in:
- **One `Save`**, whatever `choices()` says. A restored interim draft can carry `source.isOwner: true`, but no `Update original` or `Save as new` appears while signed out.
- It is styled as today (`.btn border-accent text-accent`), with `aria-haspopup="dialog"` and `aria-keyshortcuts` as today.
- **Share** shows when `source` is set, as today. The link is public, and copying it writes nothing.
- **No indicator.** "Not saved" for someone who can't save yet is a nag. The dialog says what is kept.
- **Note under the bar:** `Sign in to save and get a share link. Your work is kept in this browser.`
- The builder's `cannotSave` (an empty show) still wins: its note replaces this one, and Save stays unavailable as today. Signing in wouldn't make an empty show saveable.
- **No bar** while `status` is `loading` or `unavailable` (the API banner covers an outage). That keeps today's rule that nothing flashes before `api/me` answers.

### 5.2 Why a dialog

- **The choice is a page-leaving navigation.** The visitor must see, before they leave, that the draft survives and (in the builder) that Undo won't. A modal is the one surface that is guaranteed to be on screen and read first.
- **An inline expansion in a 340px panel**, or at the top of the 45dvh mobile panel, pushes Playback down and can render below the fold.
- **The branded button needs room:** about 190px wide plus `Not now`. It doesn't fit beside `Share` on the save bar row.

### 5.3 The dialog

- Native `<dialog>` with `showModal()`, `role="dialog"`, using `confirm-dialog`'s classes, its Escape handling (read from `cancel` and `close`) and its return-focus-to-opener.
- `aria-labelledby` points at the title, and `aria-describedby` at the body paragraphs.
- Buttons: `Not now` (`.btn`) first, then the Google button (§3), right-aligned with `flex-wrap justify-end gap-[8px]`.
- **Initial focus: the Google button.** This is not an alertdialog. Nothing is destroyed, and the visitor pressed Save to go forward. The confirm dialog's safe-button rule is for answers that discard work.

**Save variant, designer:**

> **Sign in to save**
>
> Saving needs a Google sign-in, so your shells stay yours and only you can update their links. Your shell stays in this browser while you sign in and will be here when you come back. Nothing is saved until you press Save.
>
> Fireworks Sandbox keeps your name from Google, not your email address.
>
> `Not now` · `[G] Sign in with Google`

**Save variant, Show Builder:** the same, with "shows" and "show", and **one extra sentence when `canUndo() || canRedo()`**:

> Undo history starts fresh when you come back.

- It is a separate `<p>` after the first, also in `aria-describedby`.
- With no history, it's omitted. A warning about nothing is noise.
- The Undo loss doesn't change the focus or role. The standing contract is that the draft is kept, and Undo was ruled session-only.

**Nav variant** (from `Sign in`): title `Sign in`. Body: `Sign in with Google to save shells and shows and see My creations. Whatever you're working on stays in this browser.` The privacy line follows, and the builder's Undo line too when there's history. Same buttons.

**The privacy line, [Boo]:** this is true only if the scopes are `openid profile` and the server stores no email (Yoshi: "No email is stored"). Boo confirms the scopes. If any email is requested, the line goes.

**Sign-in unavailable:** `loginProviders` is empty, or `client-config` failed. The same dialog, with title `Sign-in isn't available right now` and body `Saving needs a sign-in, and it's switched off on this site at the moment. Your shell is kept in this browser.` One button, `Close`, focused. The nav `Sign in` still renders, and it opens this variant. A visitor who presses Save always gets a prompt (Done-when 1).

### 5.4 Pressing the Google button

1. Call the page store's `flushDraft()` (Yoshi §6.2).
2. Write the intent flag (§6.1).
3. Set the button to `aria-disabled`.
4. Call `location.assign('/api/auth/login/google?returnUrl=' + encodeURIComponent(path + search))`.
   - `/c/:code` is never the return path: it has already redirected to `/` or `/show`, so the path is the page itself.
   - The builder's playhead and selection aren't saved. That's no change, because a reload loses them today.

### 5.5 ⌘S

phase-7.md §3.3's table gains one row, checked after "a confirm dialog is open" and "a save is in flight":

| State when pressed | Does | Prevented? | Announced |
|---|---|---|---|
| Signed out, save bar rendered | opens the §5.3 dialog (Save variant), the same as pressing Save | yes | — (the dialog's title and description) |

- The `pass` row narrows to "no save bar" (`status` is `loading` or `unavailable`).
- "A dialog is open" includes this dialog, so ⌘S inside it is held.
- In `save-shortcut.ts` terms, the state gains `signedIn: boolean`, and `canWrite: false` with a rendered bar maps to a new `{ kind: 'prompt' }`.

---

## 6. The return from Google

### 6.1 Knowing it's a return

The return is a full page load at `returnUrl`, and nothing in the URL says so. Before `location.assign`, write:

```
sessionStorage['fireworks.signin.v1'] = JSON.stringify({ from: 'save' | 'nav', path, at: Date.now() })
```

`sessionStorage` survives a same-tab round trip to another origin. Wrap every read and write in try/catch: if it's blocked, the return simply gets no focus move or toast, and nothing breaks.

On load, read the flag and **delete it at once**. Act on it only if `path` matches the current path and `at` is under 10 minutes old. Then, once `session.settled()` emits:

| Session after return | Do |
|---|---|
| Signed in | Success toast: `Signed in as {name}.` (or `Signed in.` when the name is blank). Then focus as in §6.2. |
| Signed out | Nothing. A Google failure or cancel lands on `/signin` (§9.4), not here. Arriving here signed out means the browser refused the cookie, and there's nothing useful to say beyond the still-visible `Sign in`. |
| `unavailable` | Nothing. The API banner shows. |

### 6.2 Focus after the return

- **The flashing notice first.** If it's showing, it keeps focus (phase-6 B3, 2c). The toast still announces.
- **`from: 'save'`:** focus the save bar's first choice. That's `Save`, or `Update original` when the source is owned, matching phase-7.md §3.3's two-choice rule. The visitor came here to save, so this puts them one Enter away. Nothing is pressed for them.
- **`from: 'nav'`:** focus the panel `h1` (or `/mine`'s `h1`), the page's top. The toast announces the result.
- **Wait for the `source` refresh (Yoshi §6.4).** While its GET is in flight, the save buttons are `aria-disabled` with `.btn-busy`, presses and ⌘S are held, and the indicator is unchanged.
  - When it settles, `choices()` can change: `['save']` can become `['update','saveAsNew']` for the visitor's own link, or the reverse for a legacy draft.
  - The `@for` then **removes the focused button**. So: after the refresh settles, if focus is on a save button that is no longer rendered, or on `body`, move it to the first choice (the K9 guard; `focus-never-drops` item 3).
  - Focus the Save target only after the refresh, never before. One move, not two.

### 6.3 No auto-save

I agree with Yoshi. Further reasons:
- After the refresh, the right request can differ from what the visitor expected. A legacy draft's "update" becomes a remix.
- A visitor who signed in from the nav didn't ask to save at all.
- "Nothing is saved until you press Save" is now a promise in the dialog.

---

## 7. `/mine` signed out

**In place, at `/mine`, with no redirect to `/signin`.**
- After `Sign out` on `/mine`, the page has to swap to this state anyway, because guards don't re-run.
- With the prompt in place, one state covers both arrivals. A redirect would add a second path, and the URL would stop matching what's on screen.
- The page already waits for `session.status()` (phase-5.md §10.1, Peach N1), so the guard's `settled()` wait isn't needed for correctness.
- **Yoshi and Luigi confirm.** If the guard stays, it must redirect to this same copy.

`notice()` gains `'signed-out'`, which replaces `'unavailable'`. It is checked after `session-error`. A 401 from the list or from a delete sets it too, which replaces the 403 `forbidden` branch.

> **My creations**
>
> Sign in to see the shells and shows you've saved. You can design and play without signing in; your work is kept in this browser.
>
> `[G] Sign in with Google` · `Go to the designer`

- It uses the `message-page` card, and its `h1` is focused on load (§12.1).
- The Google button's `returnUrl` is `/mine` (plus `?page=` if one is set). The intent flag is `from: 'nav'`. On return, the list loads, the `h1` is focused, and the toast says `Signed in as {name}.`
- **Providers empty:** the body becomes `Sign-in isn't available right now, so there's nothing to list here. You can keep designing; your work is kept in this browser.` The only action is `Go to the designer`.
- **The old `unavailable` copy** ("Saving is turned off on this site…") is retired. After Phase 8, writes are never "off" for a signed-in visitor.
- **A 401 during a delete:** error toast `You've been signed out, so nothing was deleted.` The page swaps to the prompt, and focus goes to its `h1`.

---

## 8. Read-only legacy creations

**No special UI. This is deliberate.**
- The server can't tell a legacy row from someone else's to the client: it never exposes an owner id, and it mustn't start.
- The visitor's options are already right:
  - On the player: `Remix` (as always).
  - On a `/c/` working copy:
    - signed out: one `Save` that prompts sign-in;
    - signed in: one `Save` with the non-owner note `Saves your own copy with a new link. The original isn't changed.`, which sends a remix.
  - On `/mine`: not listed, because it is nobody's.
- **An interim draft in localStorage** (with `source.isOwner: true` from a test window):
  - While signed out, §5.1 shows one Save.
  - After sign-in, Yoshi's §6.4 refresh sets `isOwner: false`, and the bar becomes one Save with the non-owner note. §6.2 moves focus across that change.
  - If the refresh fails (network), `isOwner` stays true, the bar offers `Update original`, and the PUT answers 404. The existing 404a row says `the original was deleted or is no longer yours` and offers `Save as new`. That's already correct for this case.
- **The claim SQL** (Skyler's option) needs no UI. After it runs, the rows are Skyler's in `/mine`.
- The words "legacy", "test mode" and "default user" never appear in the UI.

---

## 9. New error copy

These are rows in phase-5.md §6's status block (`role="alert"`, error tone). `{noun}` is shell or show, and `{sourceName}` is `quoted()`, as today.
- `SaveStatusAction` gains `'signIn'` (label `Sign in`, which opens the §5.3 Save variant) and `'replace'` (label `Replace the newer version`).
- Clients key on status (and `code`) only, never on the server `message` (Boo C15).

### 9.1 401: signed out mid-edit (an expired session, or a sign-out in another tab)

| Status | Message | Buttons |
|---|---|---|
| 401 on any save | `Couldn't save: you've been signed out. Sign in to save; your {noun} is kept in this browser.` | `Sign in` |

- The 401 interceptor reloads the session (Yoshi §6.1) and swallows the generic toast. The bar then switches to its §5.1 signed-out form.
- **Focus:** the pressed button may disappear: `Update original` and `Save as new` collapse to one `Save`. If focus was on a save button that's gone, or on `body`, move it to the signed-out `Save`, which opens the same dialog. The status block keeps its no-focus rule (phase-5.md §12.1).
- **The draft is untouched,** `source` included. After the visitor signs back in, possibly as another account, the §6.4 refresh decides the choices again.
- Yoshi's wording ("You've been signed out. Sign in to save.") is replaced by this row, which keeps the "is kept in this browser" ending every save error has.

### 9.2 412: Update original against a newer version

| Status | Message | Buttons |
|---|---|---|
| 412 on Update original (PUT) | `Couldn't update {sourceName}: it was changed somewhere else (another tab or device) after you opened it. Nothing was saved. Save as new keeps both versions; Replace puts yours on its share link and discards the other changes.` | `Save as new` · `Replace the newer version` |

- **Why Replace is offered.** `source.updatedAt` stays as it was (Yoshi, and it must, for If-Match). So without Replace, every later `Update original` on this working copy answers 412 again, forever. The owner's only way to put their version on the original link would be to rebuild it on a fresh copy.
  - The two buttons and the sentence follow the standing "owner chooses with two visible buttons" pattern.
  - Replace is labelled with what it does, and the message says what it discards.
  - No extra confirm: the message is the confirmation, as with `Update original` (phase-5.md §2.2).
- **What Replace does:**
  1. One `GET api/creations/{code}` (self-handled).
  2. If it returns 404, or `isOwner: false`, show row 404a.
  3. Otherwise, a PUT with `If-Match` set to that response's tag (`updatedAt`).
  4. On 200, the update success toast, and `completeSave` stores the new `updatedAt`.
  5. Another 412 shows this row again.
  - While the request runs, the Replace button is `aria-disabled` with `.btn-busy` and the label `Replacing…`, and the save bar is busy as for any save.
- **Focus:** `Update original` is still rendered and enabled, so it keeps focus. After Replace succeeds, the block clears. Focus then moves to `Save as new`, the first enabled save button (the K-rule: `Update original` is disabled while `Saved`).
- `Save as new` in this row is a remix, the same as the bar's.

### 9.3 428: If-Match missing

| Status | Message | Buttons |
|---|---|---|
| 428 | `Couldn't update {sourceName}: this page is out of date. Reload, then save again. Your {noun} is kept in this browser.` | `Reload` |

- It can surface only through a client bug, or a draft `source` with an empty `updatedAt`.
- Reload is the honest fix: the new bundle and the draft survive it (as row 400a).
- **The client guard:** a source with an empty `updatedAt` never sends a PUT. It shows this row without a request.

### 9.4 Sign-in failure or cancel: the `/signin` page

`OnRemoteFailure` redirects to `/signin?error=…&returnUrl=…`.
- **For Bowser:** pass the challenge's `returnUrl` through from `AuthenticationProperties`, checked again with the safe-internal-URL rule.
- **For Bowser:** distinguish `error=cancelled` (Google's `access_denied`) from `error=failed` (everything else). If the handler can't tell them apart, use `failed`.

The page uses the `message-page` card. `<title>`: `Sign in · Fireworks Sandbox`. The `h1` is focused on load.

| State | Heading | Body | Actions |
|---|---|---|---|
| `error=cancelled` | `Sign-in was cancelled` | `Nothing changed. Your work is still in this browser.` | `[G] Sign in with Google` · `Go back` |
| `error=failed` | `Sign-in didn't finish` | `Google didn't complete the sign-in. Try again in a moment. Your work is still in this browser.` | `[G] Sign in with Google` · `Go back` |
| No `error` (a direct visit) | `Sign in to Fireworks Sandbox` | `Sign in to save shells and shows and see My creations. You can design and play without signing in.` | `[G] Sign in with Google` · `Go back` |
| Providers empty | `Sign-in isn't available right now` | `Your work is still in this browser.` | `Go back` |
| Already signed in | none: `router.navigateByUrl(returnUrl, { replaceUrl: true })` | | |

- `Go back` is a link to `returnUrl` (or `/`). The label is `Go to the designer` when `returnUrl` is `/` or missing, and `Back to the Show Builder` for `/show`.
- The page's Google button keeps the original `returnUrl`. `/signin` reads the intent flag on load (and deletes it, like any page), keeps its `from` in memory, and writes it again when its own Google button is pressed. A retry from `/signin` after a Save prompt still returns focus to Save.
- "Your work is still in this browser" is true, because `flushDraft()` ran before leaving.
- The heading carries the news, so no `role="alert"` is needed. A focused `h1` is read on arrival.

---

## 10. "Remixed from"

- **Where:** only on the player (`/s/:code`), in the small muted line under the name:

  ```
  Fireworks Sandbox · Remixed from the original
  ```

  `the original` is a `routerLink` to `['/s', remixedFrom]`, built only after `isShareCode(remixedFrom)` (Boo C4, C11).
- **Condition:** `session.isAuthenticated() && response.isOwner && remixedFrom !== null` (Skyler's ruling).
- **The text is fixed.** The envelope carries only the original's code, not its name, and the name mustn't be fetched just to label a link. One link, one clause.
- **Not on `/mine` cards:** `CreationListItem` has no `remixedFrom`, and adding a field to the list for a minor link isn't worth a contract change. **Not in the designer or builder:** `source` doesn't carry it, and the save note is the wrong place for history. Revisit if Skyler asks for lineage.
- **On a show's player,** the same line.
- **When the original was deleted:** the server returns `null`, and nothing is rendered.

---

## 11. Test-mode banner removal

- Delete `<app-test-mode-banner />` from the designer, the builder and `/mine`. On the player, delete both `<div class="w-full max-w-[640px]">` wrappers (l.86, l.193), not just the component, or an empty flex item leaves a gap.
- **Nothing takes the slot.** The API banner and the status block move up by the banner's height. The account control (§2) now answers "who am I saving as", which the banner used to imply.
- Remove `TEST_MODE_TEXT` and the `designer-save.spec.ts` match on "change or delete any saved". Yoshi's server invariant `canWrite == isAuthenticated` replaces it.

---

## 12. Accessibility

### 12.1 Focus (`focus-never-drops` sweep of every new control)

| Control | Can it disappear or disable itself while focused? | Focus goes to |
|---|---|---|
| Nav `Sign in` | It opens a modal | The dialog's Google button. On close (`Not now` or Escape), back to `Sign in` |
| Signed-out `Save` | It opens a modal | Same; on close, back to `Save` |
| Status block `Sign in` (401) | It opens a modal | Same; on close, back to it |
| `Sign out` | Yes: it is replaced by `Sign in` | `Sign in` (K9 guard). On `/mine`, the prompt's `h1` |
| Save buttons during the source refresh | Yes: `@for` re-keys | The first choice after the refresh (§6.2) |
| Save buttons after a 401 | Yes: the bar collapses | The signed-out `Save` (§9.1) |
| Google button | It navigates away | n/a. While `aria-disabled`, it stays focused |
| Replace (412) | Yes: the block clears on success | `Save as new` (§9.2) |
| `/mine` Delete after a 401 | Yes: the page swaps | The prompt's `h1` |
| `/signin` | Page load | `h1` |

### 12.2 Live regions

- Toasts (polite): `Signed in as {name}.`, `Signed out.` Errors use the alert toast: the sign-out failure, and the delete 401.
- The status block: `role="alert"` for 401, 412 and 428, as for every save error.
- The dialog is announced through `aria-labelledby` and `aria-describedby` when it opens. It isn't a live region.
- The account control is not a live region. Its change comes with a toast.

### 12.3 Keyboard

- The dialog: Tab cycles `Not now` and the Google button (native modal containment), Enter or Space activates, and Escape is `Not now`.
- ⌘S: §5.5.
- **Tab order on the designer and builder:** h1-row links, `Sign in` (or `Sign out`), the banners and status block, the save bar, then the rest as today. In the builder, the skip link stays first.

### 12.4 Touch

- The nav `Sign in` and `Sign out` use `touch-link` (44px under coarse).
- The Google button and `Not now` get `min-h-[44px]` under coarse, with an 8px gap in raw px.
- The name truncates; its tap does nothing.

### 12.5 Firefox: scrollable asides as tab stops (carried 7g.2)

**Ruling: add `tabindex="-1"` to both scroll containers** (`data-testid="designer-panel"` and `builder-panel`). Remove `ENGINE_STOPS` from `gate-keyboard.mjs`, and expect no aside stop in any engine.

- Firefox makes a scroll container a sequential focus stop even when it has focusable children. Chromium's "keyboard-focusable scrollers" does so only when it has none, which is why only Firefox shows the stop.
- These panels are full of controls. Tabbing through them already scrolls the panel (focus scrolls into view), so the extra stop gives keyboard users nothing.
- In the builder it costs the skip link its point: K8 put the skip link first so that one Tab reaches it.
- The stop is also an **unnamed** `complementary` landmark (the asides have no `aria-label`), so a screen reader announces a bare "complementary" on it.
- `tabindex="-1"` keeps the panel focusable by click, so arrow keys and Page Down still scroll it after a click on its background, and it removes only the Tab stop. Mouse clicks don't match `:focus-visible` on a non-input element, so no ring appears.
- **Toad's negative control:** remove the attribute, and the Firefox daily run must report the stop as a failure, no longer as a NOTE.
- **Carried, not fixed here:** the panels' `<aside>` semantics. The designer panel is the page's main control surface, not complementary content. Renaming the landmark (`<section aria-label="Shell controls">`, or `<main>` around panel and stage) is a separate Phase 7-style audit item. I'm not mixing it into an auth batch.

### 12.6 Contrast

- The Google button: `#1F1F1F` on `#FFFFFF` is 16.5:1. The white fill itself is 17.4:1 against `surface-raised` (`#141a29`), so the fill is the component boundary. The `#747775` stroke adds 3.8:1.
- The account name in `text-primary` and the links in `text-muted` are existing pairs.

---

## 13. Questions for Skyler

| # | Question | Recommendation |
|---|---|---|
| **Q1** | After **Sign out**, should the browser's draft (the shell or show being worked on) be cleared? On a shared computer, the next person would see it, though they can't save over your links. | **Keep it.** The standing rule is "a draft is never lost". It holds no account data, and saving it as someone else only ever makes their own copy. Revisit if a shared-device complaint arrives. |

**For Boo (8.0a), not Skyler:**
- C9 changes (§5.1).
- `font-src 'self'` (§3).
- The scopes behind the privacy line (§5.3).

**For Yoshi and Luigi:**
- `/mine` in place, not guarded (§7).
- The `sessionStorage` intent flag (§6.1).

**For Bowser:**
- `returnUrl` and `error=cancelled|failed` on the `/signin` redirect (§9.4).

---

## 14. Departures from earlier specs (recorded)

| From | Now | Why |
|---|---|---|
| phase-5.md §2.1: the bar renders only when `canWrite` | It also renders signed out, as one prompting `Save` (§5.1) | Done-when 1. **[Boo C9]** |
| phase-5.md §2.1: `My creations` hidden when `!canWrite` | Always shown (§4) | It now leads to a sign-in prompt, not a dead end |
| phase-5.md §2.4: the test-mode banner | Deleted (§11) | Skyler's Phase 8 ruling |
| phase-5.md §10.2: the unavailable notice | Replaced by the signed-out prompt (§7) | Writes can no longer be "off" for a signed-in visitor |
| phase-7.md §3.3: ⌘S `pass` when `!canWrite` | `pass` only with no bar; signed out opens the dialog (§5.5) | One shortcut, the same meaning as the button |
| phase-8-auth.md §6.3: guard plus redirect | Prompt in place (§7) | Sign-out on `/mine` needs the in-place state anyway |
| phase-8-auth.md §6.1: a provider list | One branded button (§3) | Google only |
| phase-8-auth.md §6.1: 401 copy | §9.1 wording | Keeps the "kept in this browser" ending |
| phase-8-auth.md §5.3: 412 offers Save as new only | Adds `Replace the newer version` (§9.2) | Otherwise Update original is a permanent dead end |
| gate-keyboard `ENGINE_STOPS` | Removed; the asides get `tabindex="-1"` (§12.5) | The skip link stays first in every engine |

---

## 15. Post-implementation check of B2 (2026-11-16)

Light code-and-copy review of Luigi's B2 (`records/luigi-phase8-client-sign-in.md`) plus one Chromium pass on `localhost:4200` (stub sign-in, 1280×800 and 390×844 coarse). Record: `records/rosalina-phase8-b2-design-check.md`.

### 15.1 The G (amends §3)

Google's current `signin-assets.zip` (fetched 2026-11-16, files dated 2026-04-15) no longer carries the flat four-colour G. Every web SVG in it draws the **gradient G**: a G-shaped alpha mask over a conic gradient (`foreignObject`) plus blurred colour ellipses. B2's inline five-path G is the older mark, so it is not "copied unmodified from the bundle".

**Ruling:** use the file route §3 already allowed.
1. From the bundle, take `Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg`.
2. Delete only its two button-chrome paths (both start `M4 0.5H36`: the white fill and the `#747775` stroke).
3. Change `width="40" height="40" viewBox="0 0 40 40"` to `width="20" height="20" viewBox="10 10 20 20"`. Nothing else changes: no path, colour or filter is edited.
4. Save it as `public/brand/google-g.svg`, and render it as `<img src="brand/google-g.svg" alt="" width="20" height="20" class="block flex-none">` (`img-src 'self'` allows it). Don't inline it: the Figma export uses `foreignObject` with an XHTML `div`, which shouldn't go through an Angular template.
5. Toad checks the `<img>` renders in Chromium, Firefox and WebKit. Chromium is verified (scratchpad render, 2026-11-16). If an engine shows only the blurred ellipses, report it; don't redraw the logo.

### 15.2 Rulings on Luigi's recorded deviations

| # | Deviation | Ruling |
|---|---|---|
| 1 | No `font-src`; Google Sans only if installed, else Roboto or system sans at 500 | **Accepted as a recorded departure.** It does not meet Google's spec to the letter (Google Sans Medium 14/20). Size, weight, line height, padding, colours, wording and the G are what make the button recognisable, and those conform (measured: 14px/20px, 500, 40px tall, 12/10/12 padding). Follow-up for a later phase: if an openly licensed Google Sans cut can be self-hosted, add `font-src 'self'` (Boo) and ship it. |
| 2 | Flat four-colour G, not checked against the bundle | **Rejected.** See §15.1. |
| 3 | 403 uses the server-fault row | **Accepted.** After Phase 8, a 403 is the server's cross-origin check, which this client can't trigger. "Something went wrong on the server" is honest, and the "turned off" wording would now be false. |
| 4 | `/signin` `Go back` only to `/`, `/show`, `/mine`; query dropped | **Accepted.** Losing `?page=2` costs one click; the Google retry keeps the full checked `returnUrl`. |
| 5 | Builder moves focus off a stranded button after a save | **Accepted.** It matches the designer and the K9 settle guard. Note: like the designer, ⌘S pressed with focus on `body` also lands focus on the first save button afterwards (the K9 guard counts `body` as stranded). That's consistent with Phase 7, so it isn't a defect. |

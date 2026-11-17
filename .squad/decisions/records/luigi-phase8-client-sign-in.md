# Phase 8 B2: client-side sign-in (Luigi)

**Date:** 2026-11-16 · **Status:** proposed (built; regular tier green). Implements Rosalina's `docs/fireworks-app/design/phase-8.md`, Boo's A5 (client half), A6 and A40–A44, `schema.md` §11.2 writer 4 and §11.4, and Bowser's B1 contract (`bowser-phase8-server-auth.md` item 2). Promotion to the index is Skyler's call.

## What

1. **Where identity and the login navigation live.**
   - `core/session.ts` gains `isAuthenticated`, `displayName` (trimmed; `''` when signed out), `signedInWith` (absent reads `null`), `settled()` (a one-shot replay of the first load, either way) and `signOut()` (`POST api/auth/logout`, then one `load()`, emitting `true`/`false`; toast suppressed). The initializer still doesn't block the first render.
   - `core/sign-in.ts` has no HTTP and no identity. It holds `isSafeInternalUrl` (the server's `SafeReturnUrl` table, row for row, including `/%zz` passing as on the server), `loginUrl`, the `fireworks.signin.v1` marker (`writeSignInIntent` and `takeSignInIntent`, which deletes on read and checks path and a 10-minute age), and `startSignIn` (flush, marker, then navigate). **It is the only file that calls `location.assign`**, and only as `location.assign(url)` with `url = LOGIN_PATH + '?returnUrl=' + encodeURIComponent(checked path)`. `setSignInNavigationForTesting` is the spec seam.
   - `core/auth-interceptor.ts` sits after `httpErrorInterceptor`. On a 401 from `/api/*` (not `api/me`) it reloads the session once, unless a reload is already in flight, then rethrows. It never retries. `isSignedOutError` (in `self-handled-request.ts`, so the error interceptor stays out of the HTTP-reaching set) tells `httpErrorInterceptor` to skip its generic toast.
   - `core/save-session.ts` is the identity side of a page's Save flow, a plain class that each flow builds with its own injected services. It provides `prompt` (`ready && !canWrite`), `refreshing`, `returned` and `start()`. `start()` is called once by the page after any `/c/` handoff. It reads the marker, waits for `settled()`, then sends exactly one `GET` for the restored source: only when signed in, and only while the store's source is still the restored object. It applies `refreshSource` (isOwner and name; updatedAt kept; 404 clears). Then, signed in with a marker, it toasts `Signed in as {name}.` and sets `returned`. **It never saves.**
2. **Saves.**
   - `creations.update(code, doc, updatedAt)` sends `If-Match: "<updatedAt>"`. `SavePlan.update` carries `updatedAt`. An empty token returns a 428 outcome without a request.
   - `CreationError` gains `unauthorized` (401), `precondition-failed` (412) and `precondition-required` (428).
   - `replaceCreation` does one GET, then a PUT with the fresh tag. A 404, `isOwner: false` or another kind becomes the `update` not-found outcome (row 404a) with no PUT.
   - **Copy for a 403 (now only the server's cross-origin check, which this client can't trigger):** the server-fault row. The old "saving has been turned off" row and its `api/me` reload are gone.
   - Both flows have `replace()`, `replacing`, `busy` (saving, replacing or refreshing) and `flushDraft`. Replace doesn't set `saving`, so the bar's Update original doesn't read "Saving…" while the block's button reads "Replacing…".
3. **UI** (`shared/sign-in/`):
   - `app-google-sign-in-button`: Light theme literals, an inline 5-path G, font stack `'Google Sans', Roboto, system-ui, sans-serif`. One press only, then `aria-disabled`.
   - `app-sign-in-dialog`: `save` or `nav` variants, the Undo line, and the unavailable variant with one Close. Initial focus goes to the Google button or Close. Focus returns to the opener.
   - `app-account-control`.
   - `watchIdentityFocus` (`identity-focus.ts`), the one focus helper for the designer and the builder. It handles the return focus, K9 after the bar re-keys (refresh, 401 collapse), and stranded focus after a save or Replace. The builder now gets the stranded-focus move after a save too; before this it had none.
   - The save bar gains `prompt` (one Save, `aria-haspopup="dialog"`, emits `signIn`, no indicator, the signed-out note; `cannotSaveNote` still wins and disables it) and `busy`.
   - The save status gains `replacing` and `busy`.
   - `saveShortcut` gains `prompt`, and `{ kind: 'prompt' }` comes after `hold`. An empty show signed out announces its note rather than opening the dialog.
4. **Pages.**
   - Designer and builder: account control on the subtitle row; `My creations` always shown; the banner deleted; `tabindex="-1"` on both panels; status actions `signIn`, `replace` and (412) `saveAsNew` as the remix.
   - `/mine`: `notice()` is `'signed-out'`, from `!canWrite`, a list 401 or a delete 401. It renders the prompt in place (no guard), or the providers-empty body. The account control sits on the nav row. A delete 401 shows the error toast.
   - Player: "Remixed from the original" under the name, only when `isAuthenticated && response.isOwner && isShareCode(remixedFrom)`. The wrappers are gone.
   - `/signin` (new route): the four copy states. `Go back` and the already-signed-in redirect go only to the literal `'/'`, `'/show'` or `'/mine'` (`backTargetOf`). The Google button passes the checked `returnUrl` on, encoded, with the marker's `from` kept.
5. **Guard specs, narrow changes.**
   - `unsafe-sinks`: `BROWSER_NAVIGATION` is allowed only in `core/sign-in.ts`, with the exact `location.assign(url)` and `loginUrl` shape pinned. `returnUrl` may appear only in `core/sign-in.ts` and `pages/signin/signin-page.ts`. `SAFE_NAVIGATION` accepts `'/mine'`, and the three `/signin` calls are listed. C10 becomes C10/A43: `remixedFrom` is read by `models.ts` and the player only, once, behind the auth, owner and pattern checks, pinned by regex. C4/C5 lists `creation-save.ts` as an envelope-only `getByShareCode` caller and checks that it never reads `.document`. The URL bindings list the two player links.
   - `designer-structure`: `auth-interceptor` and `save-session` join the derived banned set. Both flows gain `import core/save-session`. The banner's entry becomes `shared/sign-in/account-control.ts` (session only).
   - `client-config.contract`: three new `client-config` importers.
   - `engine-boundary` is unchanged.
6. **`gate-keyboard.mjs`:** `ENGINE_STOPS`, the walk's skip branch and the builder's extra-Tab loop are removed. A panel stop in any engine now fails the walk.

**Verification:** regular tier PASS, 176.2 s. Mutant set `tools/mutants/sets/phase8-client.mjs`: 17 KILLED, 1 equivalent (S3). Running app (Chromium, 4200 → 5180 → stub on 5190): sign-in from Save, then Save (POST), the 412 Replace across two contexts, Sign out, `/mine` signed out with zero list calls, and Cancel landing on `/signin?error=cancelled`.

## Why

- Every write still needs `canWrite`. The signed-out Save only opens a dialog, and the only thing ever sent from it is the one login navigation (A40, A6).
- The marker moves focus and shows a toast. It can't cause a write (A41).
- Replace exists because `source.updatedAt` must stay the edit base, and without Replace Update original would answer 412 forever (Rosalina §9.2).
- `SaveSession` and `watchIdentityFocus` are shared so the designer and the builder can't drift. The flows were already near-duplicates.

## Boundary

- **A44:** implemented as the page rule in `phase-8-auth.md` §6.3 and the plan (prompt in place, zero list calls while signed out or undecided), not as Boo's guard plus redirect. Boo should confirm, as Yoshi asked.
- **Font:** no `font-src` change (Boo A6: no CSP change in Phase 8). Google Sans is used only if installed locally; otherwise Roboto or the system sans at 500. This is the minor branding departure Rosalina recorded.
- **The G paths** are Google's standard four-color G as rendered by Google's own button. I did not download the asset bundle (the brief said nothing from Google, and the session has no network for it). Rosalina or Skyler should diff the paths against `signin-assets.zip` once.
- **`/signin` `Go back` drops the query** (for example `/mine?page=2` goes back to `/mine`), because client navigation is kept to literal routes (C14). The Google retry keeps the full checked `returnUrl`.
- **Test fixtures:** `ME_TEST_WINDOW` (`canWrite && !isAuthenticated`) can't occur after Phase 8, but it still drives many Phase 5–7 specs. Because the restore refresh runs only when signed in, those specs keep their exact ledgers. New Phase 8 specs use `ME_ANONYMOUS` and `ME_ADA`.
- **The README and `railway.toml`** already carry no test-mode text (grep, 2026-11-16).
- **Not done here:** the panels' landmark semantics (carried by Rosalina), and the daily Firefox `gate-keyboard` run that proves item 6. That is Toad's negative control: remove `tabindex`, and the stop must fail.
- **Running-app find (fixed):** `SaveSession` first captured the restored source in `start()`, after the `/c/` handoff, so opening a link while signed in sent a redundant refresh GET. It now captures in the constructor (regression spec and mutant R2).

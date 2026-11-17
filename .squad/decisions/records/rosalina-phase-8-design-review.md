# Phase 8 design review: sign-in UX (Rosalina)

**Date:** 2026-11-16 · **Status:** proposed. It binds B2 (Luigi) once Skyler answers Q1, and as far as Boo's 8.0a allows on C9, `font-src` and the scopes. · **Spec:** `docs/fireworks-app/design/phase-8.md`

## What

1. **Account control** on the subtitle row of `/`, `/show` and `/mine`, aligned right:
   - signed out: `Sign in`, which opens a dialog;
   - signed in: `{name} · Sign out`, with the name in `<bdi>` and truncated;
   - nothing while `api/me` is loading or has failed.
   - The player has no account control.
   - `My creations` is always in the nav.
2. **Google button:** Light theme, rectangular, text `Sign in with Google`, built in HTML.
   - The G is copied unmodified from Google's bundle, as an inline SVG.
   - Font: Google Sans Medium 14/20, self-hosted (needs `font-src 'self'`, Boo), falling back to Roboto or system sans at 500.
   - Brand hexes stay literal and are scoped to one component; they are not tokens.
   - The button appears only in the sign-in dialog, on `/signin` and on the `/mine` prompt.
3. **Signed-out Save:** the bar renders one `Save` (no indicator; note `Sign in to save and get a share link. Your work is kept in this browser.`).
   - It opens a native modal `Sign in to save`, with initial focus on the Google button.
   - The builder adds `Undo history starts fresh when you come back.` only when Undo or Redo history exists.
   - With no providers, the dialog says sign-in isn't available.
   - ⌘S signed out opens the dialog; `pass` only when no bar renders.
4. **The return:**
   - A `sessionStorage` intent flag (`fireworks.signin.v1`: `from`, `path`, `at`) marks the round trip.
   - On return: the toast `Signed in as {name}.`; focus goes to Save (`from: save`) or the page `h1` (`from: nav`), but only after the source refresh settles, with a K9 guard.
   - No auto-save.
5. **`/mine` signed out:** the prompt renders in place at `/mine` (no guard redirect). It replaces the `unavailable` notice. A 401 swaps to the prompt too.
6. **Legacy creations:** no special UI. They read exactly as another person's creation. The words legacy, test mode and default user never appear.
7. **New status rows:**
   - **401:** `Couldn't save: you've been signed out. Sign in to save; your {noun} is kept in this browser.` Button `Sign in`.
   - **412:** `Couldn't update {name}: it was changed somewhere else…` Buttons `Save as new` and **`Replace the newer version`**, which does a fresh GET, then a PUT with that tag.
   - **428:** the `Reload` wording.
   - **`/signin`:** `Sign-in was cancelled` and `Sign-in didn't finish`, both with `Your work is still in this browser.`
8. **"Remixed from":** on the player only, as `Fireworks Sandbox · Remixed from the original` (a link to `/s/{code}`), when `isAuthenticated && isOwner`. Not on `/mine` cards (the list item has no field), and not in the designer or builder.
9. **Banner removal:** the slot closes up, and the player's wrapper divs go with it.
10. **Firefox aside stops:** `tabindex="-1"` on `designer-panel` and `builder-panel`. `gate-keyboard`'s `ENGINE_STOPS` is removed.

## Why

- **Done-when 1** needs a visible Save that prompts. A dialog is the only surface that guarantees the visitor reads the "your draft survives; Undo doesn't" facts before a page-leaving navigation.
- **Without Replace, a 412 is a dead end.** `source.updatedAt` must stay stale for If-Match, so every later Update original on that working copy would answer 412 forever.
- **In-place `/mine`:** a sign-out on `/mine` needs the in-place state anyway, because guards don't re-run. One path is simpler than two.
- **`tabindex="-1"`** keeps the K8 skip link first in every engine, and removes an unnamed landmark stop that gave keyboard users nothing.
- **Self-built button:** the GIS SDK is cross-origin script, which `script-src 'self'` forbids, and it uses a different auth flow.

## Boundary

- **It changes:**
  - phase-5.md §2.1 (bar visibility, `My creations` visibility);
  - phase-5.md §2.4 (banner, removed);
  - phase-5.md §10.2 (unavailable notice);
  - phase-7.md §3.3 (the ⌘S `pass` row);
  - phase-8-auth.md §5.3 (412 actions), §6.1 (provider list, 401 copy) and §6.3 (the guard, pending Yoshi and Luigi).
- **Does not decide:**
  - Boo C9 and the CSP `font-src` (Boo);
  - the OAuth scopes behind the privacy line (Boo);
  - `error=cancelled|failed` and `returnUrl` passthrough on the failure redirect (Bowser);
  - the panels' landmark semantics (carried, a separate audit).
- **Open for Skyler:** Q1, whether Sign out clears the browser draft. Recommended: keep it.

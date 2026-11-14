# Phase 5 design-review: save, share, player, My creations

> **Superseded in part by Skyler's ruling of 2026-11-14 on 2026-11-14** (decisions README §5, "Remix always shows"; plan Phase 5): item 7's "Remix when `canWrite`" no longer holds. Remix shows on the player whatever `canWrite` is, and only Save follows `canWrite`. The Boundary's Q1 question is answered yes: one notice dismissal and one Reduce flashing choice per device. Items 1–6 and 8–10 stand.

**By:** Rosalina (Designer), 2026-11-14. **Status:** proposed. Spec: `docs/fireworks-app/design/phase-5.md` (mockup `phase-5-mockup.html`). Updates `designer-2c.md` §6.4 in place for the shell/sky flag split.

## What
1. **F4: a successful save clears `shellDirty` and `skyDirty`.** The "Not saved" indicator reads a third draft flag, **`saved`**: set by a successful save, cleared by *any* shell or sky change, loads included. Only an explicit `true` reads as saved. Flags clear only if the model is the same objects that were sent. Luigi confirms (phase-5.md §4.3).
2. **Owner choice:** two visible buttons, `Update original` and `Save as new`, with a note under them saying what each does to the share link. No dialog, no menu, no confirm on Update original.
3. **Save results:** successes are toasts. Failures and caveats go in one inline status block at the top of the panel (the 2c API-banner spot), with `SUPPRESS_ERROR_TOAST`. Every error ends "Your shell is kept in this browser."
4. **F10 copy** for 400 (stale tab `version` separately), 403, 404 on PUT, 404 on remix, 413 (with a client-side byte check before sending), 429 (`Retry-After` wording), status 0 and 5xx, plus the "newer version" upgrade page: phase-5.md §6, §7.3, §8.4.
5. **404 on Update original asks** (`Save as new` → plain POST); **404 on a remix falls back to a plain POST by itself** and reports success with a caveat.
6. **Share** shows only with a `source` (writes on or off), copies `/s/:code`, and says when the link plays the saved version rather than the unsaved changes. Share never saves.
7. **Player:** full-screen stage, an always-visible top bar (name, Remix when `canWrite`, Pause/Play, Replay, Reduce flashing), a centered notice that holds playback and says whether the shell strobes, and **opens paused under reduced motion**.
8. **My creations** waits for the session to settle before showing "unavailable" (`canWrite` is false while `api/me` is in flight).
9. **F12:** bracket-form keys show in curly quotes, with invisible characters written as JSON escapes (bidi controls included); sky keys gain `(Sky)`.
10. `cleaned` isn't mentioned in the Apply note.

## Why
- The dirty flags guard replaces. Once work is saved, a replace can't lose it, so asking would warn about nothing. But clearing them isn't enough to say "Saved": Save → preset doesn't ask and clears `shellDirty`, leaving Peony under a `source` that points at the saved record. That's why there's a separate `saved` flag that any load clears.
- Update original and Save as new are both permanent. Visible labels plus a note let the visitor read both before acting, with no extra step on every save.
- Failures need buttons (Reload, Save as new) that outlast an 8 s toast. Keeping one place for save results means the visitor looks in one spot.
- The asymmetry in item 5 follows intent. Update original asked for an existing link to change, so a new link is a different outcome the visitor should choose. Save as new already asked for a new record.
- Under reduced motion, a playback-only surface should wait for an explicit start, as the designer waits in Manual (decisions §5).

## Boundary
- Applies to the shell designer, `/c/:code`, `/s/:code` and `/mine` in Phase 5. The Show Builder inherits the save bar, the §6 table and the flag rules at the Phase 6 timeline design-review.
- Proposes two contract changes for Yoshi (phase-5.md §13): `source.name`, and `source` set to null after a 404 from PUT (a third way `source` changes, beyond schema.md §11.2's two).
- Open for Skyler (Q1): whether the player notice dismissal and the Reduce flashing choice are device-wide, shared with the designer. Until ruled, phase-5.md §8.3 recommends yes.
- Doesn't change any token value. It adds `.btn-danger` (existing tokens).

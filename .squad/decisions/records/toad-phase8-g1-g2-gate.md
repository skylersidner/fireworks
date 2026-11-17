# Phase 8 gate G1 and G2 in gate-auth; equivalent mutants (Toad)

**Date:** 2026-11-17 · **Status:** proposed. Follows `toad-phase8-auth-gates.md`. Promotion to the index is Skyler's call.

## What

1. **`gate-auth.mjs` part `save` (Mario's G1).** One fresh Chromium profile. The flashing notice is dismissed through its Continue button first (it rightly takes focus on a fresh profile). The shell name is set to a marker, and the gate waits until the draft holds it. Then:
   - Save while signed out opens the dialog, with focus on the Google button and no write.
   - The gate signs in through the stub (`POST /__next-subject?sub=g1-saver`, then the Google button).
   - On return: `fireworks.draft.v1` is byte-identical, the name field shows the marker, the toast `Signed in as Stub g1-saver.` was shown, focus is on Save, there was no write, and the sign-in marker is gone.
   - Save gets `POST api/creations` 201.
   - Control `NEG=save`: an init script on the return document rewrites the draft and sends a POST before the app boots. The run must print `SAVE PATH BROKEN: the draft is byte-identical … nothing was written on return`.
2. **Part `signout` (G2).** It continues in the same profile, now signed in. On `/show` the show name is set and the gate waits for `fireworks.showDraft.v1`. Across Sign out, both drafts are byte-identical, the logout gets 204, and the write ledger holds exactly `["POST /api/auth/logout"]`. Control `NEG=signout`: the show draft is rewritten when the logout answers. The run must print `DRAFT CHANGED ON SIGN OUT: fireworks.showDraft.v1`. With `PARTS=signout` alone, the gate signs in through `signInAs` and reloads.
3. **The write ledger is every non-GET/HEAD/OPTIONS request to the app origin,** navigations included, not only `/api/`.
4. **Toasts are recorded, not polled.** A MutationObserver in an init script reports every toast text through `exposeBinding`. A success toast lives 4 s, so on the dev stack a "still visible" check failed 2 of 3 runs. With the observer it passed 3 of 3.
5. **Spec:** in `designer-save.spec.ts`, the Sign out test seeds both drafts and asserts `[draft, showDraft]` is unchanged and non-null. Mutant **G2** in `phase8-client` (Sign out removes the show draft) must be KILLED by it.
6. **Runner convention: `equivalent: '<reasoning>'`** on a mutant (`tools/mutants/run.mjs`). The mutant still runs. SURVIVED becomes **EQUIVALENT**, which counts like KILLED for the exit code. KILLED becomes **NOT-EQUIVALENT**, which fails the run: either the claim is wrong or a spec pins an implementation detail. `phase8-client` S3 carries Mario and Luigi's reasoning: with `url[0] === '/'` and the raw `url[1] === '/'`, decoding (only `%XX` runs) leaves `decoded[1] === '/'`.

## Measured

- The regular tier passed in 224 s wall. The smoke step `auth` went from 24.6 s to 35.3 s (+10.7 s; load 11 to 12, against 7 to 8 before).
- `phase8-client` gave 18 KILLED and 1 EQUIVALENT (S3), exit 0.

## Why

- G1 and G2 were manual gate steps in Mario's scratch script. In the regular tier, a regression on the signed-out Save path or on Sign out keeping drafts now shows up on every change.
- Skipping an equivalent mutant would hide a later change that makes it killable, or that makes it non-equivalent. Running it and inverting the verdict keeps the claim checked.

## Boundary

- `equivalent` needs written reasoning in the set; "it survived" is not reasoning. A gate check on a toast reads the observer record, never the live DOM.

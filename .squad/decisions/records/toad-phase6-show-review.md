# Toad: Phase 6 review, what a show test must prove

**Date:** 2026-11-14 · **Status:** proposed · **Phase:** 6 (QA review of Luigi's Show Builder and player, Yoshi's TimelineDriver)

## What
1. **A Replay or restart test asserts the restart itself.** That means the step drops back near 0, the ended state goes away, the ledger is only the rows fired so far, and the show ends again with the oracle's ledger. Comparing the final ledger alone isn't enough: a driver that never restarts still holds the old, correct ledger (mutant `player-replay-no-seek` passed the original 6h.4 test).
2. **A re-seek-after-edit test edits a cue *behind* the playhead** and compares the resulting state (ledger and particle positions) to a straight run of the edited show. It also checks that the seek took the kept-checkpoint number of frames. An edit after the playhead leaves the state the same with or without a re-seek.
3. **"Only X's flag counts" tests set the other flag to a real, parseable dirty value.** A designer draft of `'{"designer":"keep"}'` isn't dirty, so it can't show that designer dirtiness is ignored.
4. **The Done-when smoke exits non-zero on any `console.error` or `pageerror`**, and the end wait has a configurable allowance. Both 6a.8 negative controls are recorded: an injected `console.error` fails the run, and a suppressed ended state fails it by timeout. Script: `scratchpad/p6smoke/done-when-toad.mjs` (`TOAD_INJECT_ERROR`, `TOAD_HIDE_ENDED`, `TOAD_END_TIMEOUT_S`).
5. **Keyboard shortcut tests press both modifiers.** ⌘ and Ctrl are separate code paths. Mutant `key-no-meta` (Ctrl only) survived until the page spec pressed ⌘Z on the page.

6. **A move-and-delete smoke edits two different cues** and asserts on the POST body, not on the page: the saved show keeps a `t == 0` and an `x == 0` cue (c1), the moved cue is in the body with its new `t` and otherwise equal to the fixture's cue, the deleted cue is absent, and the added cue is there. Moving and then deleting the same cue (Luigi's original smoke) proves nothing about the move.
7. **The smoke clicks Share** and checks that exactly `${origin}/s/{code}` was passed to `navigator.clipboard.writeText` (wrapped, so the real call still runs; in Chromium it also reads the real clipboard back), that the `Share link copied.` toast shows, that no share-link field appears, and that no request is sent.
8. **Ledger-diff specs for move and delete run the whole show to its end** and include a cue that shares its step with another (c2 and c10). A move test checks the seed after *each* edit: a reseed applied on each of two edits (`seed ^ 1` twice) cancels out and passes a check made only at the end.
9. **Every smoke check has a recorded negative control** that makes the run exit 1 (all re-run 2026-11-14 against `dotnet run` and ng serve 4200):
   - `TOAD_INJECT_ERROR=1` (one `console.error` in the player) gives `FAIL: console errors (6a.3)`. (webkit)
   - `TOAD_HIDE_ENDED=1 TOAD_END_TIMEOUT_S=120` (the ended state removed as it appears) gives `timed out at 1:06 / 1:06`. (firefox)
   - `TOAD_BLOCK_CLIPBOARD=1` (writeText always rejects) gives `6f.9 share failed`, with `blocked: true` and no toast. (firefox)
   - `TOAD_SAME_CUE=1` (Luigi's path: delete the cue just moved) gives `6b.2 POST checks failed`, with `moved: false`. (chromium)
10. **Inequalities in a "at most N per window" test are strict when the window is closed.** "At most 3 flashes in any closed 1.000 s span" means four starts span *more than* 120 steps. A `>= 120` check passes a spacing of 40 (starts 0/40/80/120); `> 120` kills both 40 and 39 (Bowser found it).

11. **URL and navigation guards are allowlists of shapes plus an exact ledger, not lists of bad spellings** (Boo Phase 6 F2, closed 2026-11-15 in `src/app/unsafe-sinks.spec.ts`).
    - **C2:** `urlBindings()` lists every dynamic URL binding (bound, `bind-`/`bindon-`, interpolated, `host`, `@HostBinding`). Each must be a string literal, a code-shaped expression (`code`, `shareCode`, a member path or `()` call ending in one), or a route array of those; an interpolation may hold only a code. The shipped set is pinned exactly (`SHIPPED_URL_BINDINGS`: the two `/mine` card `routerLink`s), so even a safe-shaped new binding fails until someone adds it on purpose.
    - **C14:** `navigationCalls()` lists `navigate`, `navigateByUrl`, `parseUrl` and `createUrlTree` on any receiver, with the first argument parsed by bracket depth (multi-line safe). Each must be `'/'`, `'/show'`, `['/c', code]` or `[]`, and the sorted ledger is pinned (`SHIPPED_NAVIGATION`, 8 calls). `BROWSER_NAVIGATION` bans `location.assign/replace(`, `location.href =`, `window|document.location =` and `window|globalThis.open(`. `location.reload()` and `location.origin` stay allowed.
12. **Show entry is pinned to `openShow`** (Boo Phase 6 F5, `features/designer/designer-structure.spec.ts`). `showEntryViolations()` runs over `src/app` and `src/engine`: `upgradeShow` only in `open.ts`; `normalizeShow` only in `open.ts`, `validate.ts` and `show-save.ts` (as `normalizeShow(sent.show)`); `openShow` only in `open-creation.ts` (`openShow(r.document)`) and `show-draft.ts` (`openShow(raw)` and `openShow(withSentinel)`); one `JSON.parse` under `features/show`; no `as ShowDocument`; `readShowDraft` only from the store; and only `/c/` offers to `ShowWorkingCopyHandoff`, with `opened.show`. The rule is a function over a sources map, so its nine negative controls are mutated maps; no product file has to change.

## Why
Of the 48 mutants in this review, 11 were killed only by tests added in it, among them Replay with no seek, Undo not setting dirty, an edit keeping the redo stack, the designer's dirty flag gating a show link, ⌘Z, jsonb key order on shell reuse, and a flash spacing of 39 steps.

Review-fix round (2026-11-14): 18 more mutants, all killed (`scratchpad/toad-p6/mut.py`, `TOAD_M2=1`): move or delete touching the same-step neighbour, a reseed on move (killed only after the per-edit seed check), Share's path, origin, toast swap, missing toast and blocked link, Show more on the same page, replacing instead of appending, or ignoring `more`, strobe from all embedded shells, number inputs dropped from the field-undo list, field Redo or Ctrl+Z hijacked, and flash spacing 40 and 39.

F2/F5 follow-up (2026-11-15): 19 file-walk mutants on a copy of the tree (`scratchpad/toad-f2/mut.py`), all killed. The pre-change spec let 7 of them through: `shellNameOf(cue)`, `activeName()` and `d.title` in a URL, `inject(Router).navigateByUrl`, `this.r.navigate`, `location.assign` and `window.open`.

## Boundary
- This applies to specs and smokes for timeline playback, Undo and kind dispatch. It doesn't ask for a production ledger readout (6a.8 still stands).
- Rules 11 and 12 pin today's call sites. A new URL binding, navigation call or show entry point updates the ledger in the same change, with a reason, and never widens a shape regex to pass.
- Cross-browser is still "runs in each engine" (Skyler). Nothing here compares engines.

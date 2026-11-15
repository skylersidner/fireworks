# Phase 6 design-review: Show Builder, show player, /mine with shows

**By:** Rosalina (Designer), 2026-11-14. **Status:** proposed. Spec: `docs/fireworks-app/design/phase-6.md` (mockup `phase-6-mockup.html`). Peach's `acceptance/phase-6.md` cites it as p6-spec.

## What
1. **Route `/show`** for the Show Builder (Mario confirms at the build batch). Show links still open through `/c/:code`, which redirects to `/show`. The designer and the builder link to each other.
2. **Layout:** the designer's 340px panel (Show, Cue inspector, Library, Sky, Display, Show JSON), and a stage column with a 232px dock under the stage (transport, toolbar, timeline). The builder previews at `starBudget` 1 and has no Star budget or Mode control.
3. **Cues are added with an active library shell:** Add cue, a sky click, or a drop. Each one lands at the playhead **rounded up** to 0.1 s, so it never lands behind the sim. A shell is copied in (with no `sky`) on first use, and an identical embedded shell is reused. Cue ids come from a draft counter and are never reused.
4. **Moves** snap to 0.1 s (Alt/Option for single steps) and stop at 0 and `duration`. **Duplicate** is +0.5 s with a new id and a new seed. **Delete** has no confirm (Undo is open, Q1).
5. **Timeline keys work only while it has focus:** ←/→ select, `,`/`.` nudge (Shift for 1 s), A/D/Delete, + / − / 0 zoom, Space play. There's no Alt+arrow (Windows Back) and no Ctrl+D (bookmark). The scrub keyboard path is a native range that doubles as the whole-show overview.
6. **Rendering:** the cue lane is one canvas, with the playhead as a DOM line. Level of detail switches at 20 px/s. Rows are layout only.
7. **Markers:** a launch tick at `t`, a rise bar, a burst dot at `t + rise` (show gravity), and break dots. The tail past `duration` is hatched, and there's an `Ends about m:ss` marker (exact once reached). When cues end before `duration`, the builder says so.
8. **`x` is labelled Position** ("where it bursts"), not launch position: the shell leaves the ground offset by angle jitter. The seed is visible, with a **New seed** button (Yoshi confirms).
9. **No empty shows:** Save stays visible but disabled, with the note `A show needs at least one cue before it can be saved.` Caps block in place, with a sentence beside the control. Duration can't go below the last launch.
10. **One `dirty` flag** for the show draft, plus Phase 5's `saved` and `source`. New show and show links ask only when dirty.
11. **`/c/` copy is now kind-neutral** until the GET answers. `showNotSupportedMessage` is removed.
12. **Show player:** plays once to the last particle. It shows the time in the meta line, a progress line and an ended state with Replay. The notice names the length and says strobe only when a **used** shell strobes.
13. **`/mine` lists both kinds** with no filter. Cards read `Show ·` or `Shell ·`, and the copy covers both editors.
14. **New Reduce flashing rule (renderer only, every surface):** a burst flash isn't drawn within 0.33 s of the previous one, so there are at most 3 big flashes a second whatever the cue density.
15. **Show issue paths** read by cue time and shell name (`Seed (Cue at 0:12.5)`, `Stars (Peony, Break 1)`). There's copy for `key-format`, `duplicate-id` and `unknown-shell`.

## Why
- One rule keeps the stage honest: everything on it is a cue in the document, and it always matches a run from step 0. That's why there's no audition, edits re-seek, and adds round up.
- An empty show is known to be unsaveable before the press, so the builder says so before the press. Disabled plus visible teaches where Save is and what unlocks it.
- A show is long motion that a creator can make dense. The 0.8 s Auto show gap can't apply without changing the show, so the protection goes in the renderer, where the sim doesn't move.
- The brief's "launch position" would mislead: the burst lands at `x`, and the launch point moves with jitter (`simulation.ts` `launch`).

## Boundary
- Applies to `/show`, the show path through `/c/`, `/s/` for shows, and `/mine`. Departures D1–D5 in phase-6.md §17 change Phase 2c and Phase 5 surfaces.
- Doesn't decide the seek mechanism (Yoshi and Luigi), only the invariant and a budget of about 1 s. It doesn't change any token value.
- Open for Skyler: Q1, Undo (recommended yes, session-only, 50 steps); Q2, no in-place editing of embedded shells in v1 (recommended yes).
- For Yoshi: whether a visitor-chosen New seed is within schema.md §4.3's "never re-derived".

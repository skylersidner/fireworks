# Scribe — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Orchestration and session logs, cross-agent history updates, and history summarization.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 1 logging (Scribe)
- Partial overlaps between records are flagged in the session log, not marked "Superseded". Mark a record only when a newer one replaces the whole of it. A partial overlap leaves the older record binding on its other items.
- Phase 1 logs are not committed. They go into the Phase 2 commit, since other agents are writing to `.squad/` concurrently.

### 2026-11-13 — Phase 2 logging (Scribe)
- This batch's manifest asked for partial supersession to be marked in place. That overrides the Phase 1 rule of flagging partial overlaps only. Each affected record now has a top-of-file `> Superseded in part by … on …` note, following Luigi's precedent. The note names the items that still stand. Records are never deleted or merged.
- Index contradictions by older records are flagged in the session log. The index is not edited; promotion is Skyler's call.
- Phase 2 logs are not committed. They go into the Phase 3 commit.

### 2026-11-13 — Phase 3 logging (Scribe)
- **Partial supersession, two forms:** a record that a newer record replaces in part gets a top-of-file `> Superseded in part by … on …` note that names the items that still stand. When the older point is inside an addendum, the marker goes inline on that point. Nothing is merged or deleted.
- **History size unit:** 12 KB is taken as 12,288 bytes (`wc -c`). Keep each file under 12,000 bytes after an append, so the reading doesn't matter. Peach (12,159) and Yoshi (12,036) sit between the two readings and are to be checked next batch.
- **Cross-agent notes** also go to any member whose surface a ruling changes, even when the manifest omits them (Toad, for the show-length ruling). Say so in the session log.
- Phase 3 logs are not committed (Skyler: do not commit this batch). They go into the next commit with the other `.squad/` changes.

### 2026-11-14 — Phase 4 logging (Scribe)
- The Phase 4 build was committed by the coordinator (`facf980`), not by Scribe. Scribe's logs for that batch are not committed; this batch was "write files only", so they sit uncommitted with the other `.squad/` changes.
- **History size check is per file, after every append.** Peach was under 12,288 and over 12,000 at the start of the batch; a Phase 5 entry written during the batch pushed it over 12,288. Re-measure every file you touched after the last write, not only the ones you planned to change.
- **Concurrent writes happen.** Peach's Phase 5 entry landed while this batch was running. Re-read a file right before you edit it, and say in the session log when a change wasn't this batch's.
- **Supersession on a numbered item:** when a ruling overrides one clause of a numbered requirement (Boo's S13), mark the clause inline and add the top-of-file note. The rest of the record stands, so it stays the binding reference.
- Records not yet in the index stay out of it. Note in the session log which records are candidates for promotion, and leave the call to Skyler.

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **Index check (Phase 5):** three items are flagged to Skyler rather than edited into the index: the `/mine` "hidden" wording, the "Save as new (remix)" row after a PUT 404, and the F11 status conflict. The session log holds them.
- **Marker form:** partial supersession uses the bold `Superseded in part by … on DATE` line under the title, as in Phase 2 to 4. Rulings are cited by date and README §5.

### 2026-11-14 — Phase 6 cross-agent update (Scribe)

- **Supersession marks added in place:** `luigi-phase5-save-share-player.md` point 6 (the "not yet" kind check) and `boo-phase5-security-verification.md` (the C5 show branch). Yoshi's 2a point 8 marker was already in place.
- **Dates:** file names use the UTC write time (2026-11-15T02:01:39Z). Content is dated 2026-11-14, the batch and ruling date, which is the local date.
- **Index check:** no new record contradicts a §5 entry. Flags are in the Phase 6 session log for Skyler; the index was not edited.

### 2026-11-15 — Post-gate addendum (Scribe)

- **Plan and index differ.** The 2026-11-15 rulings (seek budget 25 ms, `ClientPlayback` in appsettings, ranges as built, Boo's tightening declined) are in plan §Phase 6 but are not index rows in `decisions/README.md` §5. Flagged in the session log; promotion is Skyler's call.
- **Supersessions are marked in the records, not the index:** Luigi's point 13 (partial; 8 ms is now 25 ms) and two bullets in `mario-phase6-gate.md`.
- **Folding:** Boo, Bowser, Luigi and Toad were over 12 KB and are folded. Yoshi is checked against the same rule.

### 2026-11-15 — Phase 7 logging (Scribe)

- **Batch:** 14 orchestration entries (one per agent per batch; a batch's name is its record's UTC write time, since several agents ran two batches), one session log, 14 supersession marks in place, 8 cross-agent notes and 7 history folds.
- **Index:** not edited. Session log flags: the cross-browser row (narrowed by the Chromium-only amendment), the Show Builder seek row (basis stale after the cold-seek ruling), the Phase 7 scope row (overtaken), the throughput rule (not indexed), and the "public" wording on the share-code GET.
- **Pattern:** a supersession mark goes on the exact anchor sentence, and the script asserts one match per anchor. A fold is applied by heading prefix with one match asserted, and the size is checked after each file. Bowser and Luigi finished 50 to 60 bytes under the 12 KB limit, so the next append on either needs a fold.
- **Commits:** none. Commits were not authorized.

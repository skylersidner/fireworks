# Session log: Phase 5 client integration (save, share, player, remix) (2026-11-14)

- **Ran:** Peach (acceptance: criteria, Q1–Q4, review), Boo (C1–C20; verification), Rosalina (design review, spec, post-implementation review), Luigi (batch 1 foundation, batch 2 UI, review-fix), Yoshi (schema.md Phase 5 edits and addendum), Toad (review, 3 tests, `unsafe-sinks` hardening), Mario (phase-gate: PASS WITH NOTES).
- **Commit:** none. Commits are not authorized. Files are written for Skyler's review; nothing is staged or committed.
- **Skyler's rulings (2026-11-14):** Remix always shows (only Save follows `canWrite`). Display and flashing preferences are device-wide, and a link load keeps display. No "Remixed from" UI before Phase 8. The test-mode banner is required in Phase 5. Coordinator defaults: `/mine` lists `kind=shell`; show links at `/s/` and `/c/` get a "not supported yet" page until Phase 6.
- **Build and gate:** Luigi batch 1 1056 tests; batch 2 1227 (smoke 31/31); review-fix 1246. Gate: npm 1246 of 1246; `unsafe-sinks` 9 of 9; backend gated 565 of 565; image Done-when 1–5 PASS; local deep links PASS. Railway items 5i.2–5i.5 DEFERRED.
- **Reviews:** Peach accepted 5a–5h, 5i.1 with a note, and the 2c.8 rule. Boo: 18 PASS, C3 accepted as partial, C18 deferred. Rosalina: PASS with D1–D3 and S1 (all fixed). Toad: all PASS, F1–F5, 3 tests added (1230); F1 closed by the hardening.
- **Records present in `.squad/decisions/records/` (verified on disk):** `boo-phase5-security-requirements.md`, `boo-phase5-security-verification.md`, `luigi-phase5-client-foundation.md`, `luigi-phase5-save-share-player.md`, `mario-phase5-gate.md`, `rosalina-phase-5-design-review.md`. Not records: Peach's acceptance (`docs/fireworks-app/acceptance/phase-5.md`), Yoshi's schema work (addendum in `yoshi-phase3-creation-schema.md`), Rosalina's design doc, and Toad's review (no record).
- **Supersession, marked in place (partial; nothing wholly superseded):**
  1. `luigi-phase5-client-foundation.md`: point 4's fallback (a 404 from PUT or remix falls back to a plain POST) is superseded in part by `luigi-phase5-save-share-player.md` point 3. Only a remix 404 falls back; a PUT 404 asks. Its boundary items (F4, the 2c.8 rule) are closed there.
  2. `rosalina-phase-5-design-review.md`: item 7 ("Remix when `canWrite`") is superseded in part by Skyler's 2026-11-14 ruling.
  3. `yoshi-phase4-architecture-review.md`: item 2's PUT half (a 404 from PUT falls back to a plain POST) is superseded in part by `rosalina-phase-5-design-review.md` item 5 and `luigi-phase5-save-share-player.md` point 3. The remix half stands.
  - The S13 marker in `boo-phase4-security-requirements.md` (Phase 4) stands.
- **Index check (`.squad/decisions/README.md`; not edited):** no new record contradicts a §5 entry. Three items are flagged for Skyler:
  1. **`/mine` wording (possible tension).** §5 says "`/mine` is hidden" when writes are off. Phase 5 hides the nav entry (5g.1), but a direct visit to `/mine` shows the "unavailable" notice and makes no list request. Decide whether the row should say "the nav entry is hidden", or whether the page itself should be hidden.
  2. **"Save as new (remix)" row is incomplete.** After a PUT 404, Save as new is a plain `POST api/creations` (schema §11.2; Boo C7). The row doesn't mention the fallback. This is not a contradiction.
  3. **Remix copy (resolved).** Rosalina's item 7 conflicted with "Remix always shows". The index already holds the ruling, and the record is marked.
- **Index lines pending promotion:** Boo's and Rosalina's proposed lines are not in any file under `.squad/`; they were in reports to the coordinator. Their text can't be checked here. Promotion is Skyler's call.
- **Conflict to reconcile (not changed here):** F11 (`type` copy for integer fields). Peach's acceptance (5h) closes it, and the code has the integer wording (`designer-copy.ts`, `save-copy.spec.ts`). Mario's gate lists it as carried to Phase 6. Peach and Mario to reconcile.
- **Carried forward:**
  - Railway window (Bowser runs; writes switched on for the window, then off; links saved in the window still play): 5i.2–5i.5, Boo C18 (S5, S21, S28), and Toad's 21-fixture round trip rerun (65 s pacing).
  - Boo: record the C17 re-check against the final banner copy (`TEST_MODE_TEXT`). Not recorded yet.
  - Phase 7 (Bowser and Boo): bare 404 for dotted links such as `/c/..%2Fme`; chunked `Connection: close`.
  - Toad's C2 "name"-only heuristic: a call for Boo or Yoshi.
  - F11 by Phase 6, if it is reconciled as carried.
- **Cross-agent updates (appended under `## Learnings`, dated 2026-11-14):** Luigi, Toad, Rosalina, Boo, Yoshi, Bowser, Peach, Mario, Scribe.
- **History summarization (12 KB = 12,288 bytes):**
  - Luigi 18,202 B → 12,154 B. Phase 3 and 4 learnings and Phase 5 batch 1 folded into `## Core Context`; Phase 5 review-fix condensed.
  - Toad 15,355 B → 12,070 B. Phase 3 and 4 folded. Under 12 KB; slightly above the 12,000 target, left as is.
  - Rosalina 13,933 B → 7,757 B. Phase 0 to 4 folded.
  - Boo 12,323 B → 9,453 B. Phase 4 folded.
  - Yoshi 12,171 B → 10,278 B. Phase 4 folded.
  - Bowser 11,887 B → 10,703 B after the append. Phase 4 folded.
  - Peach 9,578 B and Mario 10,927 B are under 12 KB; no folding needed.
- **Attribution:** none added. No commit made by Scribe.

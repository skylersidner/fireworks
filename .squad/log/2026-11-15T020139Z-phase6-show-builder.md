# Session log: Phase 6 Show Builder (2026-11-14)

- **Ran:** Rosalina (design review, post-implementation review), Peach (acceptance, rejection review), Yoshi (TimelineDriver), Luigi (builder; Motion blur follow-up), Toad (fixture, QA review, review-fix), Bowser (review fixes), Mario (phase-gate: PASS WITH NOTES).
- **Commit:** none. Commits are not authorized. Files are written for Skyler's review; nothing is staged or committed. Last commit is `53b0199` (Phase 5).
- **Skyler's rulings (2026-11-14):** cross-browser means the show runs in each browser, not identical fidelity; session-only Undo, 50 steps; no in-place editing of shells; seek accepted as measured; native controls on the builder (OQ17 departure, that page only); Motion blur device-wide; Show JSON, library drag, pinch zoom, the `+k` badge and the scrub overview move to Phase 7. Coordinator defaults: route `/show`; the harness may seed the 50-cue fixture; `starBudget` 1; ⌘Z inside text fields is native (N6). Schema §12.2 row added for the new fixture.
- **Build and gate:** Luigi 1385, then 1406 with the follow-up; Toad 1415, then 1433 after review-fix. Mario's gate: npm 1433/1433 in 53 files; typecheck and `ng build` clean; fixtures 176; gated backend 567/567; no backend diff since `53b0199`. Built image `fireworks:phase6-gate` ran three cross-engine round trips. Railway 6k.3 and 6k.4 DEFERRED.
- **Reviews:**
  - Toad: PASS on all areas; 48 mutants; 9 tests added (`toad-phase6-show-review.md`).
  - Peach: rejected 6a, 6b and 6k on harness evidence gaps (her history; no separate record). Closed by Toad's review-fix and Mario's gate evidence.
  - Rosalina: rejected B1–B3 (must-fix; fixed by Bowser). B4–B7 and the four unbuilt items to Phase 7. She later ruled flash spacing 41 and the ended line's curly quotes.
- **Records verified present in `.squad/decisions/records/`:** `rosalina-phase-6-design-review.md`, `rosalina-phase6-post-implementation-review.md`, `peach-phase6-acceptance.md`, `yoshi-phase6-timeline-driver.md`, `luigi-phase6-show-builder.md` (the Motion blur follow-up is its point 6), `toad-phase6-show-review.md`, `bowser-phase6-review-fixes.md`, `mario-phase6-gate.md`. Not records, by design: the Toad fixture (in his history and the generator), Peach's rejection and the Toad review-fix round (in their histories).
- **Supersession, marked in place (partial; nothing wholly superseded):**
  1. `luigi-phase5-save-share-player.md`, point 6 ("`'show'` gives \"not yet\""): superseded in part by `luigi-phase6-show-builder.md` point 8.
  2. `boo-phase5-security-verification.md`, C5 row ("`'show'` → not yet"): superseded in part by the same point. Boo has not re-verified C5 for shows.
  3. `yoshi-phase2a-engine-boundaries.md`, point 8: already marked by Yoshi, in place, citing `yoshi-phase6-timeline-driver.md`.
  - Checked, not marked: Motion blur (no older record states it); `/mine` shells-only (only the coordinator default, not a record); the builder's OQ17 departure (a new index row, not a supersession).
- **Index check (`.squad/decisions/README.md`, not edited):** no new record contradicts a §5 entry. Flags for Skyler:
  1. **Designer draft row.** It says the draft keeps display settings. Motion blur now lives in the device store (the Phase 6 row). The draft still mirrors `display.persistence`, so the row is literally true, but its wording is now incomplete.
  2. **Forms row.** "Forms: Angular Signal Forms on Angular 22" has no pointer to the builder's page-level exception (its own row). Consistent; a cross-reference would help a reader.
  3. **`/mine` hidden (carried from Phase 5).** The nav-versus-page question is still open. Phase 6 makes `/mine` list both kinds.
  4. **Seek trigger unmeasured.** The seek row's revisit trigger (p95 above 1 s in Chrome on a saved show) has no Chrome measurement in the Phase 6 records.
- **Carried forward:**
  - Railway: 6k.3 and 6k.4 (Bowser's test window; writes off afterward).
  - Phase 7: Show JSON; library drag; pinch zoom; the `+k` badge; the scrub overview; Rosalina B4–B7; `/health/ready` unmapped (returns `index.html` 200); the api-banner Try again uses `disabled`; the dotted-link 404 (`/c/..%2Fme`); chunked `Connection: close`.
  - Open questions for Skyler: (1) should the banner follow `api/me` failure (it follows `/health/live` today); (2) should select or range ⌘Z undo the show.
  - `doneWhenShow()` is still a local stand-in; switching to Toad's fixture is Luigi's separate change (the fixture is now final).
  - F11 (`type` copy): Peach's acceptance (5h) closes it in code. Mario's Phase 5 gate carried it to Phase 6, and the Phase 6 gate is silent. Peach and Mario to reconcile.
  - Boo's C17 banner re-check (Phase 5) is still not recorded.
  - No Boo security verification ran for Phase 6, though C1–C15 bind the builder and show player (`boo-phase5-security-requirements.md`, closing paragraph). The phase map does not require one; Skyler to decide before Phase 7.
  - Peach has no closing note for the 6a, 6b and 6k rejections (her history only).
  - Local processes left running at the gate (Mario): `ng serve` on 4200 and `dotnet run` for the API on 5180.
- **Files modified or added, not attributed in the manifest** (confirm the author before the commit): `.squad/skills/{exact-swap-mutants,flashing-content-safety,prototype-oracle-golden}/SKILL.md` (modified); `.squad/skills/{cross-browser-determinism-oracle,per-frame-dom-readouts}/` (new); `src/web/fireworks-web/src/engine/sim/golden/record-prototype-golden.mjs` (modified; prototype goldens are regression guards, changed only by reviewed change, schema §8.1); `src/web/fireworks-web/src/engine/model/shell.ts` (modified).
- **Cross-agent updates (appended under `## Learnings`, dated 2026-11-14):** Luigi, Bowser, Toad, Peach, Rosalina, Mario, Boo, Yoshi, Scribe.
- **History summarization (12 KB = 12,288 bytes; sizes before to after):**
  - Luigi 15,664 → 11,827 B: Phase 5 folded; Phase 6 build and follow-up summarized into Core Context; Phase 2 and 3–4 blocks compacted.
  - Toad 16,977 → 11,043 B: Phase 5 review and review-fix folded; Phase 6 QA and review-fix folded. Tests, mutant rig and traps kept.
  - Bowser 13,114 → 11,479 B: Phase 4 fix round and cross-agent notes folded.
  - Peach 13,168 → 10,152 B: Phase 3 to Phase 5 acceptance folded.
  - Mario 12,294 → 7,346 B: Phase 0 to Phase 4 gates folded; Phase 5 and 6 gates kept.
  - Yoshi 12,204 → 11,856 B: Phase 5 folded.
  - Rosalina 11,308 B, Boo 10,184 B and Scribe 5,202 B are under 12 KB after their appends; no folding.
- **Dates:** file names use the UTC write time (2026-11-15T02:01:39Z). Content is dated 2026-11-14, the batch and ruling date.
- **Attribution:** none added. No commit made by Scribe.

# Session log: Phase 7, polish and deploy hardening (2026-11-15)

- **Ran (in order):** Mario (planning). Batch A: Boo (A1), Rosalina (A2), Toad (A3), Yoshi (A4). Peach (A5). Batch B: Bowser (B1), Luigi (B2 and B3). Yoshi reviewed Luigi's warm-up API (addendum 1) and fixed D1. Batch C: Toad (C3), Rosalina (C2), Boo (C1), Peach (C4). Bowser's fix round, then the touch px fix. Toad wrote the gate scripts and re-checked the fix round. Rosalina signed off. Peach reworded three criteria (7h.4, 7e.10, 7k.1). Mario ran the gate.
- **Commit:** none. Commits are not authorized, and nothing is staged. Last commit is `bc0594b` (Phase 6).
- **Gate:** Mario, **PASS WITH NOTES**, Chromium only. Suites: web 1640/1640 in 68 files; typecheck, `ng build` and prettier clean; fixtures 176 match; `dotnet test` 661 passed and 12 skipped of 673; gated 673/673; three-stage `docker build` succeeded. Items 1 to 12 PASS; item 13 [R] DEFERRED.
- **Skyler's rulings (2026-11-15):**
  - Railway stays deferred. Batch D is dropped, and every [R] item is DEFERRED.
  - No fps-driven automatic quality. It moves to the end-of-project CPU review. The DPR cap ships.
  - Rosalina's four builder items, the label fix and Show JSON are built. Background warm-up is built too, because cold seeks count toward the 1 s trigger, on every device class, touch included.
  - No If-Match yet. The ETag is `"<updatedAt>"`.
  - Caps stay at 40k particles and 600 s.
  - CSP allows `style-src 'unsafe-inline'`. Scripts stay strict, with no `unsafe-eval`.
  - Show JSON Apply is one Undo step.
  - The 7l.5 early-seek bar is an OR: p95 ≤ 4,330 ms, or ≤ 1.2× a paired same-load no-warm-up baseline.
  - Throughput constraints for the rest of the project: mutation testing only on engine, save-path and security or guard code; at most two agents at once; heavy runs serial; real-time and measurement runs once, at the gate. Regular runs and gates use Chromium only; Firefox and WebKit move to a daily run.
  - A post-Phase-7 testing interlude (fast show-testing strategy; Toad and Yoshi).
- **Reviews and outcomes:**
  - Boo C1: PASS on S1, S2, S4 to S7, S9 to S12 and S14 to S17; S3 and S8 PASS locally ([R] at the edge); S13 deferred to the gate; S18 to Phase 8. F1 fixed in the fix round; F3 closed by Luigi.
  - Rosalina C2: conditional pass; four rulings (two accepted, two rejected and fixed); C2-1 to C2-4 fixed; signed off.
  - Toad C3: no product defects; spec gaps closed with controls; gate scripts written; the 13 px root defect found and fixed by Bowser.
  - Yoshi A4: rulings in place. D1 (a Phase 6 `divergeStep` defect) fixed in `timeline-driver.ts` under coordinator authorization.
  - Peach C4: accepted; 7o DEFERRED.
- **Records verified present in `.squad/decisions/records/`:** all 14 manifest records: `mario-phase7-planning`, `boo-phase7-security-requirements`, `boo-phase7-security-verification`, `rosalina-phase-7-design-review`, `rosalina-phase7-post-implementation-review` (sign-off addendum present), `toad-phase7-caps-and-seek`, `toad-phase7-c3-review` (addendum present), `yoshi-phase7-architecture-rulings` (addendum 1 present), `peach-phase7-acceptance`, `bowser-phase7-server-hardening`, `bowser-phase7-review-fixes` (addendum present), `luigi-phase7-client-hardening`, `luigi-phase7-ux-accessibility`, `mario-phase7-gate`.
- **Supersession, marked in place (2026-11-15):**
  - `yoshi-phase7-architecture-rulings.md` §1: the 5000 ms context timeout, superseded by Rosalina's 10 s (`rosalina-phase-7-design-review.md` point 11).
  - `boo-phase4-security-requirements.md` S16: the share-code GET is `private, no-cache` with an ETag (`boo-phase7-security-requirements.md`).
  - `bowser-phase4-creations-persistence.md`: `ApiResponseHeaders.cs` replaced by `ResponseHeaders.cs` (`bowser-phase7-server-hardening.md`).
  - `bowser-phase7-server-hardening.md` point 2: four writers, now five (`bowser-phase7-review-fixes.md`).
  - `luigi-phase6-show-builder.md`: warm-up is built (point 5 of `luigi-phase7-client-hardening.md`); `doneWhenShow()` is the fixture (point 8).
  - `bowser-phase6-review-fixes.md`: Try again no longer `disabled` (`luigi-phase7-ux-accessibility.md` points 2 and 3).
  - `luigi-phase7-ux-accessibility.md`: three deviations (Copy, wheel scroll, Copy-twice re-announce) ruled and fixed; the size classes are px.
  - `peach-phase7-acceptance.md`: the 7l.5 "+20%" bar, superseded by the OR rule.
  - `boo-phase7-security-requirements.md` S13: gates use Chromium; Firefox and WebKit daily.
  - `mario-phase7-planning.md`: Batch D dropped; warm-up built; caps kept.
  - Not marked (findings closed in their own records or in addenda, as in Phase 6): Boo's F1 to F3, Rosalina's C2-1 to C2-4, Toad's M8 to M10 and the 13 px defect, Yoshi's D1 (a Phase 6 defect fixed in Phase 7; recorded in `yoshi-phase7-architecture-rulings.md` addendum 1).
- **Index check (`.squad/decisions/README.md`, not edited). Flags for Skyler:**
  1. **Cross-browser row vs the amended ruling.** The row "Cross-browser means it runs in each browser" (plan Phase 6, 2026-11-14) is narrowed for gates by the 2026-11-15 amendment: regular runs and gates are Chromium only, and Firefox and WebKit are a daily run that is not a gate criterion until it exists. Not in the index. Promote, or amend the row.
  2. **Show Builder v1 row is stale.** It says the seek is accepted as measured, revisit at p95 above 1 s in Chrome on a saved show. The trigger tripped on cold seeks (realistic 600 s cold p95 3.6 to 4.9 s, Toad A3). Skyler ruled cold seeks count and warm-up shipped. The row needs a pointer to the 2026-11-15 ruling.
  3. **Phase 7 scope row is conditional and now overtaken.** "warm-up only if p95 seek > 1 s" is superseded by the caps row ("cold seeks count, so background warm-up ships"). Both rows are read in order, so annotate the first.
  4. **Missing rows.** The throughput constraints (mutants only on engine, save-path and guard code; at most two agents; serial heavy runs; measurement once at the gate) and the 7l.5 OR bar are in plan 7.5 only.
  5. **Wording.** "Share-code GETs stay public" (My creations row) is true for access, but P7-S4 makes that GET `private, no-cache` with an ETag. "Public" is easy to misread as a caching rule.
  6. **Carried, still open (Phase 5 and 6 flags):** `/mine` nav-versus-page wording; the forms row's missing cross-reference to the builder's exception; the designer draft row's Motion blur wording.
  7. **Not promoted (records only, Skyler's call):** the DPR rule `min(dpr, coarse ? 1.5 : 2)`; `pixi.js/unsafe-eval` and the CSP shape; the one-writer-per-class header rule; the ETag `"<updatedAt>-p"` Phase 8 rule; the ⌘S two-choice rule.
  - No new record contradicts a §5 entry literally. Items 1 and 2 are where a reader would be misled.
- **Carried forward:**
  - Mario's gate notes: (1) precompressed `*.js.br` and `*.js.gz` in the image's `wwwroot`, Bowser to decide (turn off publish compression, or record as accepted); (2) the 7l.5 margin is thin, input to the end-of-project CPU review; (3) no `chunk--*` file in this build, covered by spec only; (4) leftover database `fireworks_test_toad_c3`, Toad to drop. Scribe did not drop it and did not verify it.
  - [R] DEFERRED (Q7.1): the Railway window (7o); 7b.4 and 7c.4 through the edge; 7d.4 Railway backups and the writes-off check; Boo C18 and C20 at the edge (S3, S8 as well); Toad's 21-fixture round trip; the 2d Firefox and Safari checks.
  - Phase 8: S18 `Vary` (Boo) and the `"<updatedAt>-p"` tag (Yoshi, Bowser); `If-Match` 412 (schema §11.4 trigger).
  - End-of-project review: automatic quality and `starBudget` framed as CPU cost (Q7.2); the `unsafe-eval` polyfill's CPU cost (Boo A1; measured, not gated); the warm-up memory clamp, trigger `ClientPlayback__CheckpointMemoryMiB` above 128 (Yoshi; not fired, config is 64).
  - Post-Phase-7 interlude: the fast show-testing strategy and the daily Firefox and WebKit run (Toad and Yoshi). Rows 7b.7, 7k.3 and 7j.4 now read "daily run".
  - Peach's closing note on 6a, 6b and 6k: present in `acceptance/phase-6.md` (checked).
  - Left running at the gate (Mario): API on 5180 (PID 93618) and `ng serve` on 4200 (PID 73241).
- **History folding (over 12 KB = 12,288 bytes; before to after):** Toad 18,631 to 10,350; Bowser 17,761 to 12,227; Yoshi 16,163 to 10,656; Rosalina 15,371 to 10,035; Boo 13,965 to 11,550; Luigi 13,945 to 12,235; Peach 14,468 to 11,957. Mario 10,703 to 11,344 (note appended, no fold). Scribe 5,797 (under). Folds: the oldest Core Context blocks compacted into one block per agent (paths and rules kept); the oldest Learnings (Phase 5 and 6, and Phase 7 A3 and B1 where they were the oldest) moved into Core Context. **Bowser (12,227) and Luigi (12,235) are under the limit by 61 and 53 bytes; the next append will need a fold.**
- **Cross-agent notes** (dated 2026-11-15, under `## Learnings`): Boo, Bowser, Luigi, Yoshi, Rosalina, Peach, Toad, Mario.
- **File names:** each orchestration entry is named by its batch's record write time (UTC), because several agents ran two batches. This session log is named by the Scribe run time.
- **Attribution:** none added. No commit made by Scribe.

# Session log: post-Phase-7 testing interlude (2026-11-16)

- **Ran (in order, record times UTC):** Yoshi (proposal, 00:23); Toad (timing, 00:28; strategy, 00:43; tooling batch 1, 01:22); Luigi (spec split, 02:11); Toad (T3 property tests, 12:14); Yoshi (T2 fingerprints, 12:19; F1 addendum, 15:33); Boo (T2 exception and F6, 15:40); Toad (final tier and first full daily, 16:10). Ten orchestration entries.
- **Commits:** none. Commits were not authorized. Files written only; nothing staged; Scribe did not run git.
- **Rulings applied (Skyler, 2026-11-15 and 2026-11-16):**
  - Regular tier under 5 min, including the Chromium smoke.
  - Daily tier runs manually, about 25 to 30 min, once per phase before its gate. A gate needs a green daily run under 24 h old, unless Skyler accepts the failure.
  - Final tier (benchmarks, `at-maximums`, uncached Docker build) runs at the end-of-project review only.
  - Firefox and WebKit fingerprint mismatches are report-only.
  - Lean process is standing. Show caps (600 s) and seeking stay. One heavy job at a time.
- **Outcomes:**
  - Regular `ng test` 90 to 126 s before, 33 to 53 s after. Regular tier about 2 to 3 min.
  - First full daily PASS, 21.4 min.
  - F1 fixed, with a coverage floor. F03 killed. F6 fixed (import rule with control).
- **Coordinator's process failure:** the 7-hour T3 run came from concurrent mutant sweeps, macOS CPU throttling (`CPU_Speed_Limit` 22) and other projects' Docker containers. The coordinator owns the scheduling error. Toad's history now carries the pre-sweep check (`pgrep -f mutants/run.mjs`, `pmset -g therm`).
- **Supersessions marked in place (2026-11-16):**
  - `toad-interlude-testing-strategy.md`: partial, by `toad-interlude-final-tier.md` (daily composition and time; the §8 questions are answered in the plan).
  - `toad-interlude-tooling-batch1.md`: partial, by the final tier (`daily-status` reads `final/`; docker build, gate-warm and bench out of daily; "T2 not built" by `yoshi-interlude-t2-fingerprints.md`).
  - `yoshi-interlude-show-testing.md`: partial, by the final tier (daily row).
  - `yoshi-interlude-t2-fingerprints.md`: partial, by the final tier (`at-maximums` now final only).
  - `yoshi-phase6-timeline-driver.md`: point 5, partial, by the F1 addendum.
  - Not marked: Boo's F6 (closed in Toad's record) and Luigi's F4 (Luigi corrects his own record). Same precedent as Phase 7.
- **Cross-agent notes (`## Learnings`, dated 2026-11-16):** Toad (F1 fix landed); Yoshi (final tier moved `at-maximums`; F3 open; F2 closed; lean process); Luigi (seek cost after F1; F4 correction; 7g.2 decision); Boo (F6 fixed, re-check open; daily CSP gate); Mario (gate rule, change gate, first daily, final never run end to end); Rosalina (7g.2 decision with Luigi).
- **History folds (threshold 12,288 bytes):** Toad 12,730 to 12,153; Yoshi 13,559 to 10,573; Luigi 14,110 to 11,958. Boo was under the limit at 12,182; folded to 10,539 ahead of its note. Current sizes: Bowser 12,227 (not in this batch), Mario 12,047 (note appended), Rosalina 10,495. Bowser and Mario need a fold on their next append.
- **Index check (`.squad/decisions/README.md`, not edited). Flags for Skyler:**
  1. **Contradiction:** the "Test tiers" row says daily is "~1 h" and "also the final review". The ruling is about 25 to 30 min, once per phase, with the final review in a separate `final` tier.
  2. **Gap:** the final tier (benchmarks, `at-maximums`, uncached Docker build) is not indexed.
  3. **Gap:** the lean process (standing, 2026-11-16), "one heavy job at a time", and the mutant cadence (sweeps at phase gates, changed files only) are in the plan but not the index.
  4. **Gap and stale row:** "seeking stays" (2026-11-16) is not indexed. The "Show Builder v1" row still says seek is "revisit at >1 s p95" without the 2026-11-15 cold-seek ruling (carried from Phase 7).
  5. **Question:** the lean process says small fixes are "one agent with no review chain". Confirm that this waives review only for small fixes and does not change the review gating in CLAUDE.md rule 6.
  6. **Carried from Phase 7:** the cross-browser row (narrowed for gates), the Phase 7 scope row (overtaken), the throughput rule (plan only), and "public" on the share-code GET.
- **Ceremonies flag (not edited):** `.squad/ceremonies.md` phase-gate does not yet name the daily-status check (under 24 h). Coordinator to add.
- **Operations for Skyler:** old Fireworks Docker images removed. The trivia-game-ui containers were stopped at Skyler's request, but their restart policy is `always`, so Docker may start them again when it restarts. Skyler's call whether to change that.
- **Open items carried:**
  1. `gate-keyboard` fixes (Toad): clipboard grant at `gate-keyboard.mjs:471` for Firefox and WebKit; WebKit macOS Option+Tab walk.
  2. Firefox makes the scrollable `aside` panels tab stops before the skip link (7g.2). Decision for Rosalina and Luigi.
  3. The final tier has never run end to end.
  4. Redundant-spec deletions are deferred to Skyler's review, after the official `t3-engine` and p6-web sweeps (not yet run; no other sweep running).
  5. Yoshi F3: `reset` keeps `sim.simTime` (minor, open).
  6. Luigi F4: `luigi-interlude-spec-split.md` kill counts for T21 and T27 to be corrected.
  7. Boo F6: re-check against Boo's wording.
  8. History size watch: Bowser (12,227) and Mario (12,047) are near the limit.
- **Records verified present in `.squad/decisions/records/`:** all 10 manifest records (`toad-interlude-test-timing`, `yoshi-interlude-show-testing`, `toad-interlude-testing-strategy`, `toad-interlude-tooling-batch1`, `luigi-interlude-spec-split`, `yoshi-interlude-t2-fingerprints`, `toad-interlude-t3-property-tests`, `yoshi-phase6-timeline-driver` (F1 addendum), `boo-phase7-security-verification` (interlude addendum), `toad-interlude-final-tier`).

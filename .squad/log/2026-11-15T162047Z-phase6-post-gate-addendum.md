# Session log: Phase 6 post-gate addendum (2026-11-15)

Addendum to `2026-11-15T020139Z-phase6-show-builder.md`. Covers the work after the gate. Content dated 2026-11-14 (rulings, Boo's verification) and 2026-11-15 (F1, served config, addendum).

- **Ran:** Boo (security verification, then addendum), Luigi (rulings, Boo F1 seek, served config), Toad (F2 and F5 closure, seek and config verification), Bowser (client config endpoint). The coordinator also edited `docs/fireworks-app/design/phase-6.md` §18 Q1 (form controls); it is not an agent, so there is no orchestration entry.
- **Commit:** none. Commits are not authorized; nothing staged. Last commit is `53b0199` (Phase 5).
- **Skyler's rulings:**
  - 2026-11-14: the API banner also shows when the `api/me` check fails; ⌘/Ctrl+Z on select, range and checkbox controls stays with the control; Boo runs a Phase 6 security review.
  - 2026-11-15: fix Boo F1 now with a time-budgeted seek, and defer cap decisions to Phase 7; the seek budget is 25 ms, configurable in appsettings `ClientPlayback` with a README section; the config ranges stay as built and Boo's tightening is declined.
- **Measured at 25 ms (Chrome headless, Metal GPU):** Done-when scrub to the end 1.4 s (3.3 s at 8 ms). `at-maximums` 183 s (369 s at 8 ms; 142 s frozen before the fix). Frames p50 33 ms. Real-mouse Pause at 120 ms or under. At Boo's worst in-range config (100 ms), input latency reaches 440 ms.
- **Records verified present in `.squad/decisions/records/`:** `boo-phase6-security-verification.md` (with addendum); `luigi-phase6-show-builder.md` (points 12–13); `bowser-phase6-client-playback-config.md`; `toad-phase6-client-config-contract-parity.md`; `toad-phase6-show-review.md` (rules 11–12).
- **Supersession, marked in place:**
  1. `luigi-phase6-show-builder.md` point 13 (and the 8 ms in point 4): the budget is now 25 ms, configurable (partial; cites `bowser-phase6-client-playback-config.md`).
  2. `mario-phase6-gate.md`, two open-question bullets (banner on `api/me`; ⌘Z on select and range): superseded by `luigi-phase6-show-builder.md` point 12 on 2026-11-14.
  - Not marked: Boo's F1 and F2 (findings, closed in place by the addendum and Toad's rules); the gate's test counts (1433, 567), which are counts, not decisions, and are superseded by 1471 and 594/594 in Toad's record.
- **Index check (`.squad/decisions/README.md`, not edited):** no new record contradicts a §5 entry. Flags for Skyler:
  1. **Rulings missing as index rows.** The 2026-11-15 rulings (25 ms budget, `ClientPlayback` in appsettings, ranges as built, Boo's tightening declined) are in plan §Phase 6 (the "Phase 6 gate rulings" paragraph) but not as §5 rows. The coordinator's brief said they were in §5; only the banner and ⌘Z row is. Promotion is Skyler's call.
  2. **Seek row basis is stale.** The "Show Builder v1" row says seek is accepted as measured, with a revisit trigger of p95 above 1 s in Chrome on a saved show. That ruling was made on the 480-step seek (about 3.6 s worst). The seek is now time-budgeted. The trigger is unchanged and still unmeasured for a saved show.
  3. **⌘Z row is narrower than the ruling.** The row names selects and range controls. The ruling and Luigi's point 12 also cover checkboxes. Not a contradiction.
  4. Carried from the earlier session log, still open: the designer draft row's wording (Motion blur); the forms row's missing cross-reference to the builder's exception; the `/mine` nav-versus-page question.
- **Carried forward:**
  - **Corrections owed:** Bowser's "only the gated test catches" sentence (Toad measured otherwise). Luigi's naming mismatch (TS `PlaybackClientConfig` vs C# `ClientPlaybackConfig`, low).
  - **Open for Yoshi:** a late config does not change the checkpoint interval until reload (`TimelineDriver.inherit`; Yoshi's call). The frame-past-end clamp is still open from 2026-11-14.
  - **Open for Boo:** re-check Toad's F2 and F5 closures; the addendum did not cover them.
  - **Phase 7:** cap decisions (particle cap for shows, max duration) with measured numbers; background checkpoint warm-up; Show JSON; library drag; pinch zoom; the `+k` badge; the scrub overview; Rosalina B4–B7 (includes Try again on `disabled`); `/health/ready` unmapped (returns `index.html` 200); the dotted-link 404 (`/c/..%2Fme`); chunked `Connection: close`.
  - **Still open from earlier:** Railway 6k.3 and 6k.4 (Bowser's test window); Peach's closing note for the 6a, 6b and 6k rejections; F11 reconcile (Peach and Mario); `doneWhenShow()` still the local stand-in (Luigi); the Chrome p95 seek measurement for a saved show.
  - **Closed in this batch:** the two open questions (banner on `api/me`; ⌘Z on select and range); Boo's C17 re-check (closed on the final copy); "no Boo verification for Phase 6" (done); the player not in the structure spec (Toad's loader ledger in `designer-structure.spec.ts`).
  - **Local processes:** the dev server on 4200 and the API on 5180 were running for the addendum; check before the next run.
- **Cross-agent updates (Learnings, dated 2026-11-15):** Luigi, Bowser, Toad, Boo, Yoshi, Rosalina, Mario, Peach, Scribe.
- **History folding (over 12 KB = 12,288 bytes; before to after):** Luigi 16,788 to 9,695 B; Toad 14,064 to 11,952 B; Bowser 13,441 to 11,984 B; Boo 13,068 to 10,516 B; Yoshi 11,856 to 12,216 B (the Phase 6 TimelineDriver entry folded, and it is now under the limit). Rosalina 11,868, Peach 10,630, Mario 8,222 and Scribe 5,797 are under the limit.
- **Dates:** file names use the UTC write time (2026-11-15T16:20:47Z).
- **Attribution:** none added. No commit made by Scribe.

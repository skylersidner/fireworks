# Session log: redundant timeline-driver spec deletion (2026-11-17)

- **Ran:** Toad (prove and delete redundant specs). One orchestration entry: `.squad/orchestration-log/2026-11-17T155632Z-Toad.md`.
- **Outcome:** 19 timeline-driver tests deleted, each mutant-proven against the tier that stays. "seek clamps and floors" kept and strengthened (K1, K2 now killed). Mutant X1 added. Regular web 1778 to 1763 tests; unit-web 34.9 s to 29.7 s; daily web PASS (27 tests, 98 s).
- **Findings carried:** T21 and T23 survive all regular engine specs (predates this batch). Owner Luigi or Yoshi; decision pending. T07 is now killed only by the property spec.
- **Records:** `toad-redundant-spec-deletion.md` present in `.squad/decisions/records/`. Pointer notes present in `toad-interlude-t3-property-tests.md` and `yoshi-interlude-t2-fingerprints.md`.
- **Index check (`.squad/decisions/README.md`, not edited):**
  - No contradiction. The record applies the standing row "Old tests are deleted only after their replacement kills the same mutants."
  - Not promoted. The manifest asked for an index row, but Scribe does not edit the index, and the README says promotion is Skyler's call. The earlier interlude records (`toad-interlude-t3-property-tests`, `yoshi-interlude-t2-fingerprints`) have no index rows either. Skyler decides whether this one gets one.
- **Cross-agent notes:** appended to `.squad/agents/luigi/history.md` and `.squad/agents/yoshi/history.md` under Learnings (T21/T23 gap, T07 thin kill).
- **History fold:** Toad's `history.md` was 13,842 bytes, over the 12,288 threshold. Its Phase 8 auth gate learnings (B3, G1/G2 and the cross-agent block) were folded into Core Context, with paths and rules kept. Now 11,547 bytes. Luigi 11,952 and Yoshi 11,212 are under the limit.
- **Commits:** none. Not authorized. Nothing staged; Scribe did not run git.
- **Open:** final tier end-to-end run (Toad, in progress); end-of-project review follows.

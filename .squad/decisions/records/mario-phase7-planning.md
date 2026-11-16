# Mario: Phase 7 planning (Polish and deploy hardening)

> **Superseded in part by the plan §7.5 answers (Skyler, 2026-11-15) on 2026-11-15:** Batch D (the Railway window) is dropped (Q7.1); background warm-up is built, since cold seeks count toward the 1 s trigger (`toad-phase7-caps-and-seek.md`); caps stay at 40k particles and 600 s (Q7.5). Points 3 and 5 are read with these answers.

**Date:** 2026-11-15 · **Status:** proposed (awaiting Skyler on Q7.1–Q7.5) · **Ceremony:** planning (Peach and Yoshi consulted through their records, not spawned)

## What
1. **The Phase 7 expansion lives in the plan file** (`plans/initial-implementation.md` §Phase 7, subsections 7.1–7.5), not a separate `docs/fireworks-app/plan/` doc. Every earlier phase's scope, Done-when and rulings live in the plan; `docs/fireworks-app/` holds per-phase design (`design/`) and acceptance (`acceptance/`) companions. No `plan/` folder existed.
2. **Scope:** caching and ETag; CSP and security headers; pipeline edges (`/health/ready`, dotted segment, chunked `Connection: close`); takedown runbook and backups; WebGL context loss; mobile DPR and touch; a keyboard and reduced-motion audit; the Phase 6 builder carry (Show JSON, library drag, pinch zoom, `+k` badge, scrub overview, label collision, B4–B7, Try again); caps measurement and ruling; cleanups; the Railway window [R].
3. **Out:** `If-Match`/412 (schema.md §11.4 trigger: first lost update or Phase 8); fps-driven `starBudget` [P]; multi-select; the dense-flash warning; background checkpoint warm-up unless the >1 s p95 trigger fires.
4. **Done-when:** 13 observable items (7.2), each with the evidence the gate will use. [R] items depend on Q7.1.
5. **Batches:** A (Boo security-review, Rosalina design-review, Toad measurement, Yoshi rulings, then Peach acceptance), B (Bowser B1; Luigi B2 hardening, B3 UX; B4 caps change if ruled), C (Boo, Rosalina, Toad, Peach reviews), D [R] Railway window, E gate.
6. **Two standing-decision collisions surfaced, not decided:** Q7.1 (Railway deferred vs Railway backups and the carried Railway checks) and Q7.2 (performance bench vs fps-driven `starBudget`; OQ10's "automatic quality comes in Phase 7" has the same tension).
7. **Reconciled:** F11 is closed in code (`designer-copy.ts:87`, Peach 5h); my Phase 5 gate's carry was stale (marked in place). The Phase 5 "C2 name-only heuristic" item is replaced by Toad's F2 shape allowlist; it only needs Boo's re-check (A1).

## Why
- The outline had no Done-when and about 40 items carried from Phases 1–6 in six places. Gating needs one list with evidence per item.
- Phase 7's phase map row has no Peach or Yoshi, but Show JSON was promised a Phase 7 acceptance criterion (`acceptance/phase-6.md`), and context loss, the late-config question and the ETag token are architecture calls. Both are added as short briefs.
- Already-built items (Reduce flashing from OS reduced motion, flash spacing, the player notice, `/api` no-store) are marked verify-only so nobody rebuilds them.

## Boundary
- Proposed scope only; Skyler's answers can move [R] and [P] items. Caps (Q7.5) are not decided until Toad's A3 numbers exist.
- Does not edit `.squad/decisions/README.md`. Does not start implementation. No commit.

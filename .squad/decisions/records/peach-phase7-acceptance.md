# Phase 7 acceptance criteria (Peach, A5)

**Date:** 2026-11-15 · **Status:** proposed · **File:** `docs/fireworks-app/acceptance/phase-7.md`

## What
1. Phase 7 is accepted against `acceptance/phase-7.md` 7a–7n. Header, cache, CSP, health, pipeline-edge and runbook rows count only on the **built image** with a fresh database and the real header. A dev server or a route-injected header doesn't count.
2. Every [R] row is DEFERRED (7o) and is listed by the gate as deferred, not passed.
3. Context loss follows p7-spec §11: the 1 s status line, then the 10 s failure block with its own copy and `Reload page`. It doesn't use the startup no-WebGL message that 7.2.5 named.
4. Warm-up is accepted by A3's cold realistic row rerun on the production build: p95 under 1 s, measured after a page-observable "finished" hook and not after a fixed sleep. Scrubbing before warm-up finishes must not be worse than the baseline + 20%. **Superseded in part by Skyler's 7.5 ruling on the 7l.5 bar (2026-11-15), recorded on 2026-11-15:** the early bar passes at p95 ≤ 4,330 ms, or at ≤ 1.2× a paired same-load no-warm-up baseline.
5. Show JSON Apply: one Undo step, `source` unchanged, `dirty` and `saved` false, and `openShow` as its only new entry.

## Why
Each of these is observable in headers, payloads, the DOM, focus or measured time. Where the design specs split states that 7.2 lumped together, the criteria follow the specs.

## Boundary
Doesn't decide the warm-up design (Luigi and Yoshi), the late-restore conflict (Yoshi and Rosalina, N1) or the F3 helper name (Boo and Yoshi, N4). Skyler's Q1 (warm-up on touch devices) has a recommended default of "yes".

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

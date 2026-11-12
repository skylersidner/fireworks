# Bowser — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22 (standalone, zoneless, signals, typed reactive forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 10 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase 1a, 1c and 1d (API skeleton, identity foundation, Docker, compose, Railway), Phase 4 (creation persistence), and Phase 7 operations (caching, backups, runbook).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- OQ20 ruling: `Identity:AllowAnonymousWrites` is false in `appsettings.json` and true in Development. Railway env var `Identity__AllowAnonymousWrites` is toggled on only for testing. `api/me` includes `canWrite`.
- `.dockerignore` must exclude `.squad/`, `.claude/`, `plans/`, and `prototypes/`.
- `CreationListItem` carries the derived palette.
- Angular stays on port 4200. The API stays on 5180.

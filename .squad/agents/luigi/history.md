# Luigi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22 (standalone, zoneless, signals, typed reactive forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 10 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase 1b (Angular skeleton and the Pixi canary), Phase 2 (engine port into `src/web/fireworks-web/src/engine/` and the Shell Designer), Phase 5 (save, share, player, My creations), and Phase 6 (Show Builder UI).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- Before 2c starts, run the Signal Forms spike with Yoshi (OQ17). Use Signal Forms if they're stable in the installed Angular 22. Otherwise use typed reactive forms. Record the outcome.
- `session.canWrite` comes from `api/me` and hides write controls when false (OQ20).
- Angular dev server stays on port 4200 (OQ12).

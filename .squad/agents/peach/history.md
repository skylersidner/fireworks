# Peach — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22 (standalone, zoneless, signals, typed reactive forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 10 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Turning each phase's "Done when" into observable acceptance criteria, surfacing open questions (plan §5) to Skyler through the coordinator, and running acceptance reviews.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 open-question triage (plan §5)
- No code exists in Phase 0, so the payload surfaces are the plan's contract text: Phase 1 `GET api/me` shape, Phase 4 `CreationListItem` / `CreationResponse.isOwner`, Phase 5 `session.canWrite()`, and §3.3 cue fields. Prototype (`prototypes/fireworks-prototype.html`) settles engine facts: world is 800 tall with width from aspect (l.177, 485), `burstHeight` is a fraction of GROUND=760 not of 800 (l.487), default mode is `loop` so `/` auto-plays flashing content (l.74).
- §3.4 interim identity (everyone resolves to the default user) makes several defaults mean something else until Phase 8: OQ3 "latest edit" means anyone can rewrite any share link; OQ13 "deletion by the owner" means deletion by anyone; Phase 5 "isOwner false -> save becomes remix" is unobservable in the running app (only Phase 4 two-user service tests reach it).
- Payload gaps to track: `api/me` has no `canWrite`, so the client can't honor `AllowAnonymousWrites=false`; `CreationListItem` fields are unspecified but OQ14 swatch cards need colors; the base `appsettings.json` value of `AllowAnonymousWrites` is unstated (only "true in dev"); embedded shells inside a show carry their own `sky`, which conflicts with the show-level `sky` (one sim, one gravity).
- OQ12 port plan is incomplete: both apps' Angular dev servers default to 4200 (reference `package.json` start is bare `ng serve`), so "run side by side" doesn't hold for the web app.
- OQ15 is stale: `.squad/` and `.claude/agents/` already exist in this repo.

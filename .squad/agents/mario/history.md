# Mario — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22 (standalone, zoneless, signals, typed reactive forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 10 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase sequencing, phase-gate reviews against each phase's "Done when", integration between `src/web` and `src/api`, and Railway release readiness.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 bootstrap
- Repo initialized on `main`; one commit "Phase 0: bootstrap repository". Git identity was already set globally (skylersidner); I did not touch it.
- Moves: prototype to `prototypes/fireworks-prototype.html` (with `prototypes/README.txt`, do-not-edit rule), context to `docs/fireworks-app/context.md`. Plan stays in `plans/`.
- Reference fix set came from the grep, not guesswork. Besides the expected files it also hit `docs/fireworks-app/context.md` itself (lines 3 and 58), and CLAUDE.md line 7 had "moves to `prototypes/` in Phase 0" wording the grep pattern didn't catch; a second grep for "in Phase 0|Phase 0 moves" found it. Lesson: grep for the transitional wording too, not just the old filename.
- Remaining intended grep hits: plan lines 159-160 are the Phase 0 task text ("Move X to Y") and correctly name the old paths.
- `.gitignore` mirrors the reference plus `src/api/Fireworks.Api/wwwroot/`, `.DS_Store`, `.claude/settings.local.json`. `.claude/agents/` and `.squad/` are committed.
- Phase 0 "open questions resolved" is Skyler's ruling (Peach reviewing §5); the gate can't fully pass until then.

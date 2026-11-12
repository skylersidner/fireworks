# Boo — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22 (standalone, zoneless, signals, typed reactive forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 10 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Security review of the Phase 1 pipeline, Phase 4 (ownership, rate limits, validation, size limits), Phase 5 (share-link exposure), Phase 7 (CSP and headers), and Phase 8 (authentication). Note: unlike the reference app, this one has per-user ownership (`owner_user_id`), so IDOR findings are real findings here.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- Production writes are off until Phase 8 (OQ20). This is what makes OQ3 (share links show the latest edit, so a link can be rewritten) and OQ13 (owner-based deletion, which is effectively anyone's deletion under the interim identity) acceptable in the interim. Restate both as conditions in the Phase 4 and 5 security reviews.

# Mario — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
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

### 2026-11-12 — Phase 1 phase-gate
- Verdict PASS WITH NOTES; Railway items DEFERRED (1d, Skyler). All evidence from my own runs: `dotnet build` 0 warn/0 err; plain `dotnet test` 26 pass / 3 skip; gated (`FIREWORKS_TEST_POSTGRES`, fireworks_test on 5433) 29/29; npm (Node 26.5.0) ci, test 44/44 in 10 files, typecheck, build into `src/api/Fireworks.Api/wwwroot`.
- Only the .NET 11 runtime (Microsoft.AspNetCore.App 11.0.0) is installed, so "runs on net11 without roll-forward" is proven by the runs succeeding at all. `dotnet-ef` 10.0.15 local tool (rollForward false) still runs here.
- Image freshness check: `find src -newermt <image Created>` (strip nanoseconds; bfs rejects them) returned nothing, so the running `fireworks:phase1` container reflects the tree.
- The long-lived container's log says "No migrations were applied" because compose DB is already migrated; the fresh-DB migration proof is the gated test, and the Railway "startup log shows migration" item needs a fresh Railway DB.
- Mutant sweep: grep README negative-control mutations against source (CanWrite, Guid.Empty, MapHealthChecks, /api catch-all, EnsureDefaultUserExistsAsync, canary destroyed guard, toadMutant, canWriteTypo). All reverted.
- Ignore coverage: root `.gitignore` plus `src/web/fireworks-web/.gitignore` (/dist, /out-tsc, /coverage). `git status --ignored` shows only bin/obj/wwwroot/.angular/node_modules ignored.

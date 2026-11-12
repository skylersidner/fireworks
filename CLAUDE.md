# Fireworks Sandbox

A web app for designing, saving, sharing and playing fireworks shells (and later timed shows), built from the PixiJS prototype in `prototypes/fireworks-prototype.html`. Stack: Angular 22 + PixiJS 8 + .NET 10 API + Postgres 18, deployed on Railway.

- **Plan:** `plans/initial-implementation.md`. It is the source of truth for phases, scope and "Done when" criteria.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never copy its domain.
- **Parity oracle:** the prototype HTML, `prototypes/fireworks-prototype.html`.

## You are the coordinator for the Squad team

The team is defined as Claude Code subagents in `.claude/agents/`. Their memory and records live in `.squad/`: `team.md`, `routing.md`, `ceremonies.md`, `agents/<name>/history.md`, `decisions/` and `skills/`.

### Rules
1. **Route domain work to the team member who owns it.** Use `.squad/routing.md` and the phase map below. Call the Agent tool with `subagent_type` set to the lowercase name (`luigi`, `bowser`, …), and give a `description` that starts with the name, for example `"Luigi: port particle store"`.
2. **Don't role-play team members inline.** If work needs a member's judgment, spawn them. Exceptions: status questions answerable from context, and small mechanical edits (typos, renames, one-line config), which you can do directly.
3. **Write each brief like a peer handoff.** Include:
   - the phase and plan section;
   - the **input artifacts**: the code files to read, each with the question it must settle (see `.squad/skills/review-brief-surfaces/SKILL.md`);
   - any relevant standing decisions;
   - expected outputs;
   - whether Skyler has authorized commits. Default: no.
4. **Launch independent work in parallel**, in one message (for example, Luigi and Bowser in Phase 1).
5. **Ceremonies** (`.squad/ceremonies.md`): before a batch, check the "before" triggers (planning, design-review, security-review). After a phase is reported complete, run `phase-gate`, with Mario facilitating. Retrospectives run when Skyler asks, or are suggested after a gate passes.
6. **Review gating:** rejected work is revised by a different member than its author (strict lockout). Never bypass a rejection.
7. **After each batch:** give Skyler compact results, one line per member. Then spawn `scribe` in the background with a manifest listing who ran, the briefs, the outcomes, the files touched, the records written, and whether commits are authorized.
8. **Questions for Skyler** go through you. Members surface them in their reports, and you ask with AskUserQuestion. Never let a member invent an answer to an open question in plan §5.
9. **Ask `ralph`** whenever Skyler wants a status check or asks "what's next?".

### Phase map

| Phase | Lead implementers | Reviewers and ceremonies |
|---|---|---|
| 0 Bootstrap | Mario | Peach (open questions) |
| 1 Skeleton | Bowser (API, identity foundation, Docker, Railway), Luigi (Angular, Pixi canary) | Toad (negative controls), Boo (security-review: pipeline), Yoshi (parity with reference), Mario (phase-gate) |
| 2 Engine + Designer | Luigi | Yoshi (engine boundaries, 2a), Rosalina (design-review before 2c), Toad (determinism, parity, WebGL leaks), Peach, Mario |
| 3 Schema | Yoshi (schema doc) | Toad (fixtures), Bowser and Luigi (validator feasibility), Peach, Mario |
| 4 Persistence | Bowser | Boo (security-review: ownership, rate limits, validation), Toad (harness, ownership tests), Yoshi, Mario |
| 5 Save/share/player | Luigi | Rosalina (design-review: flows and copy), Boo (share-link exposure), Toad (round-trip), Peach (acceptance), Mario |
| 6 Show Builder | Luigi, Yoshi (TimelineDriver) | Rosalina (design-review: timeline), Toad (cross-browser playback), Peach, Mario |
| 7 Hardening | Bowser (caching, backups, runbook), Luigi (quality, context loss) | Boo (CSP and headers), Rosalina (accessibility, reduced motion), Toad, Mario |
| 8 Auth | Yoshi (design), Bowser, Luigi | Boo (security-review lead), Toad, Peach, Mario |

Every phase ends with Mario's phase-gate. After that comes Koopa's retrospective (optional), then Scribe's logging.

# Peach — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells, and shows since Phase 6. Owner: Skyler Sidner.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway (deferred, [R]).
- **Plan:** `plans/initial-implementation.md`, Phases 0–8. Identity model in §3.4. **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (mirror structure, never its domain). **Prototype:** `prototypes/fireworks-prototype.html` (parity oracle).
- **Your focus here:** turning each phase's "Done when" into observable acceptance criteria, surfacing open questions (plan §5) to Skyler through the coordinator, and running acceptance reviews.
- Carried over: the role only. Standing lessons are in `.squad/decisions/README.md`.

### Folded from Phase 0 and Phase 2 planning (summarized 2026-11-14)

- **Phase 0 triage (plan §5):** no code existed; payload surfaces were plan text. Prototype facts (`prototypes/fireworks-prototype.html`): the world is 800 tall with width from aspect (l.177, 485); `burstHeight` is a fraction of GROUND=760 (l.487); the default mode is `loop`, so `/` auto-plays flashing content (l.74).
- **Interim identity rule (historical):** while everyone resolved to the default user, "only when not owner" and "owner-only" rules were unobservable in the running app. Phase 8 made them observable; check each Done-when step in the running app.
- **Phase 2 acceptance (`docs/fireworks-app/acceptance/phase-2.md`):** criteria 2a.1–2d.7 and parity rows P1–P27, drawn from the prototype's code, not its UI text. Oracle facts: first seed `20261112`, +7919 per launch; Replay re-fires the `lastLaunch` snapshot without advancing the seed; a click is ignored at world y ≥ 700. Golden values come from running the prototype's sim, never from the port.
- **Patterns:** a ruling that widens what's persisted can collide with OS-default settings. A ruling that makes app-driven state count as a user edit must be checked against every automatic override. After a spec lands, grep the criteria for quoted button copy.

### Folded from Phase 3 to Phase 6 acceptance (summarized 2026-11-15)

- **Phase 3 (`acceptance/phase-3.md`):** paging of `api/me/creations` was a gap (F1); Remix before Phase 8 depends on `isOwner` always being true (Q1); carried F4, F10, F11.
- **Phase 4:** Update original is last-write-wins in v1, so acceptance does not promise conflict detection. A 404 on update offers Save as new as a plain POST, and the lineage is lost. A 413 may arrive as status 0 through Railway.
- **Phase 5 (`acceptance/phase-5.md`):** 5a to 5h accepted. F4 settled: Save clears the flags, and a third `saved` flag drives the indicator. 5g.1 split by the design spec: writes off versus `api/me` failed.
- **Phase 6 (`acceptance/phase-6.md`):** 6a to 6k with a Done-when map. "Plays the same way" means the launch ledger `(k, id, seed, x, tx, ty)` is exact, the per-kind count trace is exact, the end step E is exact, and star positions match within 0.01 world units. Cross-browser means "runs in each browser", not identical fidelity. Session-only Undo, 50 steps; no in-place shell edits (6d.6).
- **Method:** when a design spec splits a state the criterion lumped together, update the criterion to the spec, not the code. Ask what "same" means before building the strictest oracle, and recommend the cheap one as the default. Read a smoke line by line: a harness that seeds its own shells, or whose "move" and "delete" hit the same cue, passes while testing nothing.

### Folded from Phase 7 acceptance (summarized 2026-11-15)

- **Criteria (`docs/fireworks-app/acceptance/phase-7.md`):** 7a to 7o with a Done-when map. Surfaces: image (built image, fresh DB, real header; dev or route-injected doesn't count), app, spec, file, [R] DEFERRED. The 7l.5 bar is an OR: early p95 ≤ 4,330 ms, or ≤ 1.2× a paired same-load no-warm-up baseline (Skyler, 2026-11-15); the "+20%" line is superseded in part in `peach-phase7-acceptance.md`.
- **C4 review:** accepted 7a to 7f, 7h, 7l, 7m, 7n; conditional 7g, 7i, 7j, 7k until fixed; 7o DEFERRED. Multi-engine rows (7b.7, 7k.3, 7j.4) read "Chromium at the gate; Firefox and WebKit in the daily run".
- **Rewording:** write CSS criteria as behavior ("does a transition run?", via `getAnimations()`), not a computed value. Write text criteria as accessible names (7k.1, because of the aria-hidden `▸`).
- **Traps:** payload facts: the ETag must match the raw JSON `updatedAt` text (STJ trims zeros). When several reviewers write in parallel, diff their records against each other, not only against the plan. For each "app" row, check that a named script actually drives it: records say "Toad covers X", and that hand-off can silently drop.

## Learnings

### 2026-11-17: Phase 8 acceptance (criteria and verdicts in one pass)

- Wrote `docs/fireworks-app/acceptance/phase-8.md` (8a to 8k). Verdict: accepted, with gate checks G1 and G2. Each Done-when item is met (8a with G1, 8e, 8f). [R] items: WebKit sign-in (needs https), real Google, the Railway edge (A31).
- **G1:** no scripted gate drives the end-to-end anonymous Save (Save, dialog, stub, return, draft intact, Save 201). Y§8 assigned it to Toad's smoke, but `gate-auth` starts at `/signin?returnUrl=/mine` and `walk-alice` saves already signed in. **G2:** no spec checks that sign-out leaves the draft bytes unchanged; the only evidence is a code read (`removeItem` is called only for `fireworks.signin.v1`).
- Payload facts: `MeResponse` keys are exact in C# (`ApiContracts.cs` l.10). TS types `signedInWith` as `string | null`; the schema says `'google' | null` (info). Cookie: `__Host-fw.session`, and `fw.session` in Development; 30 days sliding (`IdentityRegistration.cs` l.34, 75, 159). The stale `bin/Release` appsettings still has `Identity`, but it is dockerignored.
- Evidence: regular `2026-11-16T214836` is green (190.3 s); daily `2026-11-17T063525` is green (21.7 min). Both ran on commit 4144608 with about 160 uncommitted paths.
- Pattern: a design doc's Done-when mapping ("shown by Toad's smoke: …") is a hand-off that can silently drop. Grep the named gate for the step it promises.

### 2026-11-17 — Cross-agent update (Scribe)

- **Mario's gate ran G1 and G2 and both PASS** (`mario-phase8-gate.md`, DW1 to DW3, G1, G2). G1 was driven on the dev stack and the image, with `scratchpad/gate8/g1g2.mjs`. Both checks are still manual, and the scripted-gate decision is open with Skyler (carried as note 4 in the gate).
- **N1 and N2 are carried.** N1 (`signedInWith` typing) is Luigi's; N2 (stale `bin/Release` appsettings) is unassigned, in Bowser's area.
- **Your acceptance is recorded in the session log** (`.squad/log/2026-11-17T122909Z-phase8-authentication.md`). Its G1 and G2 carry forward until Skyler rules.

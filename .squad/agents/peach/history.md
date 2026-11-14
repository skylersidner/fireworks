# Peach — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Turning each phase's "Done when" into observable acceptance criteria, surfacing open questions (plan §5) to Skyler through the coordinator, and running acceptance reviews.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 and Phase 2 planning (summarized 2026-11-14)

- **Phase 0 triage (plan §5):** no code existed; the payload surfaces were plan text (`GET api/me`, `CreationListItem`/`CreationResponse.isOwner`, `session.canWrite()`, §3.3 cue fields). Prototype facts (`prototypes/fireworks-prototype.html`): the world is 800 tall with width from aspect (l.177, 485); `burstHeight` is a fraction of GROUND=760 (l.487); the default mode is `loop`, so `/` auto-plays flashing content (l.74).
- **Interim identity rule:** while everyone resolves to the default user, "only when not owner" and "owner-only" rules are unobservable in the running app (only the Phase 4 two-user service tests reach them). Check each Done-when step is still observable in the running app.
- **Phase 2 acceptance (`docs/fireworks-app/acceptance/phase-2.md`):** criteria 2a.1–2d.7 and parity rows P1–P27, drawn from the prototype's code, not its UI text. Oracle facts: first seed `20261112`, +7919 per launch; Replay re-fires the `lastLaunch` snapshot and doesn't advance the seed; Clear doesn't wipe the trail; a click is ignored at world y ≥ 700; Add break copies the last break; remove deletes the active one; delay shows only on breaks 2–4; the prototype JSON has no `sky`. Golden values come from running the prototype's sim, never from the port. The 24-step loop cap is unreachable under the 0.1 s dt clamp, so a cap test must bypass the clamp.

### Folded from Phase 2 acceptance (summarized 2026-11-14)

- **Where it lives:** `docs/fireworks-app/acceptance/phase-2.md` (criteria 2a.1–2d.7; parity rows P1–P27). P9 reads "the shell document has no mode field" (fixed 2026-11-13). F15 (the split store) is still not marked closed in that file.
- **Rulings that shaped the criteria:** Q5 reduced motion forces Manual on every load. Q6, then Q8: unsaved edits are a persisted `dirty` flag, not a baseline; confirm only when shell or sky changed (display and tab never count; app-made changes never set dirty; a preset doesn't clear sky-changed). Skyler reversed Q8(a) to replace-only confirm. 2c.18 follows `designer-2c.md` §7.2 (`Turn on Reduce flashing` / `Continue`, no `Got it`). fps is benched (plan §6): 2d.4 removed; 2d.1 and the HUD readout kept.
- **Patterns:** a ruling that widens what's persisted can collide with OS-default settings (persist a setting only once chosen). A ruling that makes app-driven state count as a user edit must be checked against every automatic override. A "pause until X" ruling ripples into every criterion that times a first burst. When a removed criterion is cited elsewhere, inline its procedure. After a spec lands, grep the criteria for quoted button copy. Re-grep the code right before writing a finding; it moves under a running brief.
- **Spec drift to watch:** `designer-2c.md` §6.4 still describes one `dirty` flag; `normalize.ts` may still carry the old `adjusted` shape. Check before copying either.

## Learnings


### 2026-11-13 — Phase 3 schema acceptance
- Wrote `docs/fireworks-app/acceptance/phase-3.md`: ACCEPT WITH NOTES, F1–F16, Q1–Q3. Fixed P9 in `acceptance/phase-2.md` ("the shell document has no mode field").
- Payload checks that paid off: diffing schema.md §12's fixture names against `schema/fixtures/**` (none missing), and grepping the designer's `[formField]` bindings (17 shell fields, all in `EditableShell`; the 4 display fields are in `DesignerDraft.display`).
- Gaps to carry into Phase 4/5/6 briefs: the paging shape of `api/me/creations` is unspecified (F1). The player's Remix button behavior is undefined, and before Phase 8 `isOwner` is always true, so Done-when step 3 depends on it (Q1). Phase 5 "dirty indicator" vs the replace-confirm `shellDirty`/`skyDirty` flags (F4). Save-time 400/403/404/413/429 copy has no owner (F10). `issueReason` renders `type` with `options:['integer']` as "must be text" (F11). Show stop-at-`duration` vs a valid cue at `t == duration` (Q3).
- Doc vs code: schema.md §8.3 says draft restore runs upgrade; `readDraft` doesn't. Full `ng test` needs Node 26 (`~/.nvm/versions/node/v26.5.0/bin`); the shell default v21.5 is refused. The reduce-flashing spec times out under full-suite load.
- Pattern: when a ruling says "X happens only when not owner" and the interim makes everyone the owner, check that each Done-when step is still observable in the running app.

### 2026-11-13 — Phase 4 cross-agent update (Scribe)
- **Update original is last-write-wins in v1** (Yoshi §11.4). Two tabs of one visitor can overwrite each other silently. Phase 5 acceptance should not promise conflict detection. The `If-Match` 412 comes at the first reported lost update, or at Phase 8.
- **Original deleted:** a 404 on Update original offers Save as new, which is a plain `POST api/creations` (§11.2), not a remix of the deleted source. The lineage is lost; the API hides it anyway (`remixedFrom: null`). Accept this as the flow.
- **Interim exposure (Skyler, accepted):** before Phase 8, `remixedFrom` is visible to every visitor, so a visitor of a remix's link sees the original's share code.
- **Writes off:** `GET api/me/creations` returns 403 and `/mine` is hidden. Save shows 403 when writes are switched off mid-session.
- **Oversize and malformed saves:** a 413 may reach the client as status 0 through Railway's edge (deploy check, Boo S5). A 400 on save or list carries `truncated` (at most 100 issues). Acceptance copy for these cases belongs to Rosalina (F10).

### 2026-11-14 — Phase 5 acceptance criteria (pre-implementation)
- Wrote `docs/fireworks-app/acceptance/phase-5.md`: 5a–5i, a Done-when map, Q1–Q4, N1–N4. Copy is referenced to Rosalina's `design/phase-5.md` (p5-spec), which hadn't landed when I wrote it; F4 (5b.11) is written with both outcomes until she rules.
- Payload facts: `CreationContracts.cs` `CreationResponse` has 9 fields; PUT/remix bodies must be exactly `{document}` (a `kind` is 400). `serializeDraft` has no `source` slot yet. `session.canWrite()` is false while api/me loads and the initializer doesn't wait, so `/mine` must read `session.status()` too (N1). `app.routes.ts` `**` redirects to `/`, which would swallow bad-code pages (N3).
- `session.ts` doc lists Remix as a write control, but schema.md §11.1 says Remix makes no API call: raised as Q1 (recommend showing it with writes off).
- Pattern: for a "replaces the draft" rule, list every draft sibling (display, tab, flags, source) and ask which survive; a photosensitivity choice is in there (Q2).

### 2026-11-14 — Phase 5 acceptance review
- Verdict: 5a–5h accept. 5i.1 is accepted with a note: the built-image curl wasn't run this batch, and only `/s/abc123` is in `SkeletonEndpointTests.cs`. 5i.2–5i.5 stay deferred to Railway. Rerun: `ng test` 1227/1227 (Node 26). Luigi's smoke: `scratchpad/smoke/luigi-p5-donewhen.mjs`, 31/31.
- I resolved the pending rows in `acceptance/phase-5.md`: 5b.11 and 5e.5 (F4: Save clears the flags, and a third `saved` flag drives the indicator), 5c.2, 5d.7, 5d.9, 5f.6, 5f.11 and 5g.1. For 5g.1, p5-spec splits "writes off" from "api/me failed". I also marked 2c.8 in `acceptance/phase-2.md` as superseded.
- 2c.8 replacement accepted. The rule is a regex in `designer-structure.spec.ts`. It doesn't ban `fetch(`/`XMLHttpRequest`, and `inject\(X\)` misses `inject(X, opts)`. The import clause still catches the second case, and the `app.startup.spec.ts` cold-load ledger is the behavioral backstop.
- Pattern: when a design spec splits a state the criterion lumped together (writes off vs api/me failed), update the criterion to the spec. Don't fail the code for following the spec.
- Still open: the test-mode banner copy is provisional (Rosalina) and must be final before the Railway window.

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **F11 conflict:** your acceptance review (5h) closes F11, and the code has the integer wording (`designer-copy.ts`, `save-copy.spec.ts`). Mario's gate lists it as carried to Phase 6. Please reconcile with Mario.
- **Q1–Q4 settled:** Q1 yes (Remix always shows); Q2 display kept, with a device-wide flashing choice; Q3 Rosalina's presentation; Q4 the coordinator defaults (`/mine` `kind=shell`; "not yet" at `/s/` and `/c/`).
- **Still open:** 5i.2–5i.5 at Railway, and the C17 banner re-check (Boo).

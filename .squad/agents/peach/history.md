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

### Folded from Phase 3 to Phase 5 acceptance (summarized 2026-11-15)

- **Phase 3 (`acceptance/phase-3.md`, accepted with notes, F1–F16, Q1–Q3):** the paging shape of `api/me/creations` was a gap (F1). Remix before Phase 8 depends on `isOwner` always being true (Q1). Carried gaps: dirty flags and replace-confirm (F4), save-time error copy (F10), `issueReason` on `type` with integer options (F11). Show stop-at-`duration` versus a cue at `t == duration` (Q3; the schema now runs to the last particle).
- **Phase 4 cross-agent:** Update original is last-write-wins in v1, so acceptance does not promise conflict detection. A 404 on update offers Save as new as a plain POST, and the lineage is lost. The interim `remixedFrom` exposure is accepted by Skyler. A 413 may arrive as status 0 through Railway.
- **Phase 5 (`acceptance/phase-5.md`):** 5a–5h accepted; 5i.1 accepted with a note (built-image curl not run then). F4 settled: Save clears the flags, and a third `saved` flag drives the indicator. 5g.1 split by the design spec: writes off versus `api/me` failed. The 2c.8 replacement accepted. Skyler's Q1–Q4 settled: Remix always shows, a device-wide flashing choice, `/mine` `kind=shell`, and "not yet" at `/s/` and `/c/` (the last is superseded by Phase 6).
- **Method:** when a design spec splits a state the criterion lumped together, update the criterion to the spec, not the code. While the interim makes everyone the owner, check that each Done-when step is observable in the running app.

## Learnings


### 2026-11-14 — Phase 6 acceptance criteria (pre-implementation)
- Wrote `docs/fireworks-app/acceptance/phase-6.md`: 6a–6k, Done-when map, F11 reconciliation, Q1–Q3, N1–N5. p6-spec (`design/phase-6.md`) hadn't landed; route is `{builder}` placeholder.
- "Plays the same way" = launch ledger `(k,id,seed,x,tx,ty)` exact + per-kind count trace exact + end step E exact + star positions within 0.01 world units + realtime playback == offline run. Basis: deaths are age-only (`simulation.ts` l.187) and lives/fuses/counts come from mulberry32 + IEEE-exact ops; only positions use sin/cos/exp (implementation-approximated).
- F11 is closed in code (`designer-copy.ts` l.85–88, `save-copy.spec.ts` l.49); Mario's gate carry is stale. New gap: `labels.ts` `fieldLabel` has no show-path labels (`cues[3].seed` → raw path; `shells.s1.breaks[0].stars` → "Stars").
- Payload gaps: `CreationListItem` has no document, so "my shells" add = one GET per shell. Phase 5 smoke used dev-only `window.ng`; the cross-browser check needs a prod-build readout.
- Replaced defaults to verify at the gate: `mine.store.ts` l.47 `kind: 'shell'`; `open-creation.ts` `status: 'show'`.

### 2026-11-14 — Phase 6 acceptance revised for Skyler's rulings
- Skyler on cross-browser: "runs in each browser", not matching fidelity. §6a now = loads, plays to ended state, zero console errors, Save/Share/player work; Chromium + Firefox/WebKit via Playwright where installable, else Safari by hand. Exact ledger/digest stays same-engine (`engine/loop/timeline-driver.spec.ts`). No prod ledger readout (N3 withdrawn).
- Lesson: I over-specified the oracle (exact cross-engine compare + prod readout) from what the code *could* support rather than what Skyler needed. Ask what "same" means before building the strictest oracle; recommend the cheap one as default.
- Settled: Q2 harness may seed 50 cues (UI still adds/moves/deletes one, Save via builder); Q3 starBudget 1 until Phase 7; session-only Undo 50 steps (6c.11); no in-place shell edits (6d.6); seek accepted as measured, ~3.6 s worst with "Catching up…" (6i.4), revisit if >1 s p95 in Chrome.
- p6-spec (`design/phase-6.md`) landed: route `/show`; duration below last launch is blocked (§9.3); identical shells reuse key (§4.1); library pageSize 24 + Show more; no notice when My shells is unavailable (group hidden); strobe named only for shells used by a cue (§11.3, corrects my 6h.2). N6: Undo's behaviour inside text fields unspecified (Rosalina).

### 2026-11-14 Phase 6 acceptance review
- **Smoke harness is a surface, read it line by line.** `scratchpad/p6smoke/done-when.mjs` seeded its own hand-written shells (not `schema/fixtures/valid/show/done-when-60s-50.json`; cues match, all six shells differ), and its "move" then "delete" both hit c1 (Home selects the first cue), so the saved show lost its t==0 and x==0 cues. The log line `moved 0 -> 0.1` then `49 cues` gave it away. It also never fails on console errors (logs only) and never asserts GET document == POST body.
- **Cross-engine evidence lives in `cross.log`:** Firefox and WebKit replayed a code saved by another run (`kwnPU9Pc`); Chromium played its own (`riEeCeJD`). WebKit's ledger tripled (dev-server reload).
- **Unbuilt spec items need a deferral ruling, not silence:** library drag onto the lane (6c.2 gesture) was left out without one.
- **Full suite under load:** `timeline-driver.spec.ts` digest test times out at the 5 s default when other agents run; passes alone. Node 26 is at `~/.nvm/versions/node/v26.5.0/bin` (default shell node is 21, too old for ng).

### 2026-11-14 — Phase 6 cross-agent update (Scribe)

- **Skyler's Phase 6 rulings** moved library drag, pinch zoom, the `+k` badge, the scrub overview and Show JSON to Phase 7. Their criteria in `acceptance/phase-6.md` need a deferral note so the file does not read as unbuilt-and-owed. Check whether one is there.
- **Your rejections (6a, 6b, 6k)** were closed by Toad's review-fix and Mario's gate evidence. No Peach re-review record exists for Phase 6 (`peach-phase6-acceptance.md` is the acceptance spec). A short closing note from you would close the loop.
- **F11:** your history says it is closed in code (`designer-copy.ts` l.85–88). Mario's Phase 6 gate does not mention it. Reconcile with Mario.
- **History:** this file was over 12 KB; the Phase 3 to Phase 5 entries are folded into Core Context on 2026-11-15.

### 2026-11-15 — Post-gate cross-agent update (Scribe)

- **Seek numbers changed after your acceptance.** Your 6i.4 "about 3.6 s worst" was the old 480-step slice. At the 25 ms default (Luigi point 13, Boo F1), the Done-when scrub takes 1.4 s and the max show 183 s, with frames at p50 33 ms. Skyler's "accepted as measured" ruling stands.
- **Your 6i.4 trigger is still unmeasured** in Chrome on a saved show (p95 above 1 s). Nothing in the Phase 6 records measures it yet.

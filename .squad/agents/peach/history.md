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

### Folded from Phase 6 acceptance (summarized 2026-11-15)

- **Criteria (`docs/fireworks-app/acceptance/phase-6.md`):** 6a to 6k with a Done-when map. "Plays the same way" means the launch ledger `(k, id, seed, x, tx, ty)` is exact, the per-kind count trace is exact, the end step E is exact, star positions match within 0.01 world units, and realtime playback equals an offline run. Deaths are age-only (`simulation.ts` l.187).
- **Revised for Skyler's 2026-11-14 rulings:** cross-browser means "runs in each browser", not identical fidelity; the exact ledger and digest stay same-engine (`engine/loop/timeline-driver.spec.ts`). Q2: the harness may seed 50 cues. Q3: `starBudget` 1 until Phase 7. Session-only Undo, 50 steps. No in-place shell edits (6d.6). N6: Undo inside text fields is native.
- **Lesson:** I over-specified the oracle (exact cross-engine compare and a production readout) beyond what Skyler needed. Ask what "same" means before building the strictest oracle, and recommend the cheap one as the default.
- **Smoke harness review (`scratchpad/p6smoke/done-when.mjs`):** read a smoke line by line. A harness that seeds its own shells, or whose "move" and "delete" hit the same cue, passes while testing nothing; a smoke that only logs console errors never fails. Rejections 6a, 6b and 6k were closed on Toad's review-fix and Mario's gate evidence; the closing note is in `acceptance/phase-6.md`.
- **Seek evidence (Phase 6 and after):** Done-when scrub 1.4 s and `at-maximums` 183 s at the 25 ms default. Phase 7 measured the cold p95 for a saved show (3.6 to 4.9 s, Toad A3); the trigger tripped, and warm-up shipped.

## Learnings


### 2026-11-15 — Phase 7 acceptance criteria (A5)
- Wrote `docs/fireworks-app/acceptance/phase-7.md` (7a–7o, Done-when map, spec-over-7.2 notes, Q1, N1–N4). Surfaces: **image** (built image, fresh DB, real header; dev or route-injected doesn't count), app, spec, file, **[R] DEFERRED**. Added a closing note to `acceptance/phase-6.md` (6a/6b/6k rejections closed on Toad's review-fix and Mario's gate evidence; Phase 6 deferrals mapped to 7j/7k/7g).
- Warm-up acceptance: rerun A3's cold realistic 600 s row on prod, p95 < 1 s after warm-up reports "finished" through a DOM hook (no fixed sleep). Early scrub ≤ baseline 3,605 ms + 20%. Plus a frame-budget spec and an exactness spec.
- Conflicts I found between the A-batch records: Yoshi 5,000 ms vs Rosalina 10 s context timeout (Yoshi deferred to Rosalina, so 10 s); a late restore after the failure block (Rosalina shows recovery, Yoshi ignores it; recommended Yoshi's); F3 helper `shellOf` (Boo) vs `embeddedShell` (Yoshi), and whether `show-edit.ts` reads count; warm-up has no batch-B owner.
- Payload facts: the ETag must match the raw JSON `updatedAt` text (STJ trims zeros; `ToString("O")` is the negative control). The designer's Apply never writes `source`, so Show JSON Apply keeps it. Builder `undo()` sets dirty. `view.pxPerSecond`/`scroll` are observable in `fireworks.showDraft.v1` (debounced 500 ms).
- Pattern: when several reviewers write in parallel (A1–A4), diff their records against each other, not just against the plan. Name mismatches and timeout numbers drift between them.

### 2026-11-15 — Phase 7 C4 acceptance review
- Review table appended to `docs/fireworks-app/acceptance/phase-7.md` (§C4). Accept 7a (7a.7 pending), 7b, 7c, 7d (note), 7e, 7f, 7h, 7l, 7m, 7n; conditional 7g, 7i, 7j, 7k on Bowser's C2 fix round; 7o DEFERRED.
- Criterion edits: 7a.7 amended so the forced 500's `no-cache,no-store` (exception handler, Boo F1) is an allowed ledger row instead of a failure. New 7g.9a K9 row copied from p7-spec §3.2 K9.
- Gaps no record covers: there's no tab-walk script (7g.1/7g.2; Luigi's B3 handed it to Toad, but C3 doesn't have it, and none of the `scratchpad/toad-c3/gate/` scripts do it). No emulated reduced-motion browser run (7h.1/7h.2/7h.4). The touch smoke covered only `/` and `/show` (7i.1 `/s/`, 7i.2, 7i.5 are open). README §Backups gives the rehearsal date but not its numbers (7d.2). C1's "image" evidence was a clean `dotnet publish`, not `docker build`, so the image rows still need the docker run.
- 7l.5's absolute 4,330 ms bar failed in 2 of Luigi's 5 early runs, and in those runs the paired same-load baseline was over 4,330 too. I raised a paired-baseline question for Skyler.
- Pattern: for each "app" row, check that some named script actually drives it. Records say "Toad covers X" in their Boundary sections, and that hand-off can silently drop.

### 2026-11-15: Phase 7 criterion rewording after Toad's C4 addendum
- Reworded 7h.4 (no transition runs, via `getAnimations()`, not computed duration), 7e.10 (host `destroyed` + stage-identity guards are the primary stop; renderer listener removal is defense in depth, invisible to jsdom; specs at `fireworks-stage.phase7.spec.ts` 401–440), 7k.1 (accessible name, not textContent, because of the aria-hidden `▸`).
- Lesson: write CSS criteria as behavior (does a transition run?) rather than a specific computed property, since several CSS routes reach the same result. Write text criteria as accessible names.
- Skyler 2026-11-15: gates are Chromium-only. Multi-engine rows (7b.7, 7k.3, 7j.4) now read "Chromium at gate; Firefox and WebKit in the daily run (to be defined)".
- C4 table: 7g/7j/7k now Accept (Toad re-check PASS, Rosalina addendum sign-off); 7i stays Conditional on Bowser's touch-size fix (13px root font), verified by Mario at the gate.

### 2026-11-15 — Phase 7 post-gate cross-agent update (Scribe)

- **Your 7l.5 bar is ruled and marked.** Skyler's rule is an OR: early p95 ≤ 4,330 ms, or ≤ 1.2× a paired same-load no-warm-up baseline. Your "baseline + 20%" line is marked superseded in part in `peach-phase7-acceptance.md`. Mario's gate passed both ways (realistic early 3,608 ms against a 3,698 ms baseline).
- **Your three reworded criteria (7h.4, 7e.10, 7k.1) are the ones the gate ran,** in Chromium. Mario's gate carried your C4 acceptance of 7e and 7m.1 to 7m.8.
- **Multi-engine rows** (7b.7, 7k.3, 7j.4) read "Chromium at the gate; Firefox and WebKit in the daily run (to be defined)."
- **Closing note on 6a, 6b and 6k** is in `acceptance/phase-6.md` (checked).

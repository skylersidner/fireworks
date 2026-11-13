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

## Learnings


### 2026-11-12 — Phase 0 open-question triage (plan §5)
- No code exists in Phase 0, so the payload surfaces are the plan's contract text: Phase 1 `GET api/me` shape, Phase 4 `CreationListItem` / `CreationResponse.isOwner`, Phase 5 `session.canWrite()`, and §3.3 cue fields. Prototype (`prototypes/fireworks-prototype.html`) settles engine facts: world is 800 tall with width from aspect (l.177, 485), `burstHeight` is a fraction of GROUND=760 not of 800 (l.487), default mode is `loop` so `/` auto-plays flashing content (l.74).
- §3.4 interim identity (everyone resolves to the default user) makes several defaults mean something else until Phase 8: OQ3 "latest edit" means anyone can rewrite any share link; OQ13 "deletion by the owner" means deletion by anyone; Phase 5 "isOwner false -> save becomes remix" is unobservable in the running app (only Phase 4 two-user service tests reach it).
- Payload gaps to track: `api/me` has no `canWrite`, so the client can't honor `AllowAnonymousWrites=false`; `CreationListItem` fields are unspecified but OQ14 swatch cards need colors; the base `appsettings.json` value of `AllowAnonymousWrites` is unstated (only "true in dev"); embedded shells inside a show carry their own `sky`, which conflicts with the show-level `sky` (one sim, one gravity).
- OQ12 port plan is incomplete: both apps' Angular dev servers default to 4200 (reference `package.json` start is bare `ng serve`), so "run side by side" doesn't hold for the web app.
- OQ15 is stale: `.squad/` and `.claude/agents/` already exist in this repo.

### 2026-11-12 — Phase 2 planning: acceptance criteria
- Wrote `docs/fireworks-app/acceptance/phase-2.md`: criteria 2a.1–2d.7 and parity rows P1–P27 drawn from the prototype's code, not its UI text.
- Oracle facts worth remembering: the first seed is `20261112`, and each launch adds 7919. Replay re-fires the `lastLaunch` snapshot, so edits made after a launch don't reach Replay, and Replay doesn't advance the seed. Clear doesn't wipe the trail buffer. A click is ignored at world y ≥ 700, which is 87.5% of the stage height. Add break copies the *last* break; remove deletes the *active* one. Delay shows only on breaks 2–4. The prototype's JSON has no `sky`. Its Apply keeps unknown keys and accepts more than 4 breaks.
- The 24-step loop cap can't be reached because of the 0.1 s dt clamp, so a cap test needs to bypass the clamp. The `rgba16float` try/catch can't catch Safari's render-time failure.
- Golden expected values must come from running the prototype's sim, never from the port, or the golden tests only freeze the port.
- Payload and surface gaps: `app.html`'s API-unavailable modal is a full-screen scrim that would block the designer, which makes no API calls. The 20-navigation leak check needs a second route, and `**` redirects to `/`. `app.startup.spec.ts` expects two `/health/live` calls, one from the home page. The plan contradicts itself on CVA versus Signal Forms custom controls for `range-row`/`select-row`.
- Questions raised (Q1–Q4): the fps bar (recommended: at least 90% of the prototype's and at least 30), whether the designer stays usable with the API down (yes), the Phase 1 status page moving to `/status`, and what the draft holds (the ShellDocument with `sky` only, overwritten without confirmation).

### 2026-11-12 — Phase 2 acceptance update for Skyler's rulings
- Updated `docs/fireworks-app/acceptance/phase-2.md` in place: 2a.6(f) now "absent `sky` stays absent, `effectiveSky()` resolves" (Yoshi's confirmation pending); 2a.8 moved the crossette guard control to the 2a.11 unit spec (children spawn with `E_NONE`, `engine/sim/simulation.ts` l.298–318, proto l.313, so goldens can't reach it); 2c.9/2c.10 rewritten for the wider draft; new 2c.14 and 2c.16–2c.21 (Reduce flashing renderer, confirm-over-unsaved, reduced motion, notice, Space exclusions, one API-down surface, no URL in toasts); 2d.3/2d.4/2d.6 and parity rows P1, P3, P6, P12, P13, P16, P20, P21, P23, P24 marked with Rosalina's §9 deviations.
- New open questions raised: Q5 (reduced motion vs restored draft mode; recommend Manual wins) and Q6 (what "unsaved edits" means before saving exists; recommend a baseline kept in the draft).
- Pattern: a ruling that widens what's persisted (display settings in the draft) collides with "OS default until chosen" settings. Persist a setting only once chosen, or it freezes the default.
- Rosalina's spec (§9 "Not departures", N2) still says no confirm on preset; that's stale against Skyler's ruling. The Postgres-at-every-gate record (`toad-postgres-gated-suite-is-required-for-program-cs.md`) is not standing; the acceptance doc doesn't cite it.

### 2026-11-12 — Phase 2 acceptance: Q5/Q6 rulings and Yoshi's normalize shape
- Skyler ruled Q5 (reduced motion forces Manual every load; my recommendation) and Q6 (unsaved edits = any change to shell, display settings or tab since the last preset/Apply/default; not my recommendation, Skyler wants display and tab to count). Updated 2c.9(iii) (baseline stored with the draft, outside the document), 2c.10, 2c.11 (bad baseline vs corrupt document), 2c.16, 2c.17, P23; 2a.6 rewritten for `normalizeShell`'s `{ok, shell, adjustments[]} | {ok:false, errors[]}` (`yoshi-phase2a-engine-boundaries.md`).
- Pattern: when a ruling makes app-driven state count as a user edit (forced Manual, OS-following Reduce flashing), check it against every automatic override, or every load reads as "edited". Raised Q7 for that.
- Code vs record drift: `engine/model/normalize.ts` l.29–60 still ships `adjusted` (no `kind`), string `errors` plus `issues`, and says a defaulted field is not an adjustment. Yoshi's record says `adjustments` with `kind` including `defaulted`. Criteria follow the record.

### 2026-11-13 — Phase 2 acceptance: dirty flag replaces baseline
- Rewrote `docs/fireworks-app/acceptance/phase-2.md` 2c.9/2c.10/2c.11/2c.16/2c.17/2c.18 for Skyler's ruling: persisted `dirty` flag, no baseline, confirm only when dirty, set-it-back stays dirty, app-made changes never dirty (answers Q7). Added 2c.22 (presets/sky-less JSON keep sky), 2c.1 in-app `/status` back link, separate-press 2d.4 procedure, P1/P6/P13/P21/P23 updates, rulings 8–14, Phase 5 working-copy note, Q8 (a–d), F11–F14.
- Luigi was rewriting the store concurrently: `designer-draft.ts` already had `dirty`, reading a missing flag as not dirty (opposite of my Q8(b) recommendation). Re-grep the code right before writing findings; it moves under a running brief.
- Pattern: a "pause until X" ruling ripples into every criterion that times a first burst from page load (P1, 2c.17, 2d.4 setup). Search for "within about 1 s" when a pause lands.
- `status-page.html` l.46 uses `<a href="/">` (document reload), which defeats the "never lose state" purpose only if the draft flush misses; criterion now requires router navigation.

### 2026-11-13 — Phase 2 close-out: 2c.18 aligned to §7.2, Q8 decided
- Rewrote 2c.18 in `docs/fireworks-app/acceptance/phase-2.md` to `docs/fireworks-app/design/designer-2c.md` §7.2 as built: `Turn on Reduce flashing` / `Continue` (no `Got it`, no ×, no Escape), focus to first button only when on `body`, focus to `Launch` on dismiss, Launch/Replay disabled with `title="Close the flashing notice to start."`, presets/Apply load without firing, timers don't advance (no backlog on dismiss), Display switch flips notice copy without dismissing.
- Q8 moved to rulings 15–18: (a) Skyler; (b) coordinator, built by Luigi; (c)/(d) Rosalina §7.2. F11/F12 marked closed. No Phase 2 questions remain open.
- Pattern: when a design spec lands after criteria, button labels in criteria go stale first; grep criteria for quoted button copy against the spec's Buttons section.

### 2026-11-13 — Phase 2 acceptance: replace-only confirm, fps benched
- Skyler reversed Q8(a): only shell and sky changes count; preset asks only on shell-changed, Apply asks on shell-changed or (JSON has `sky` and sky-changed). Rewrote 2c.9(iii)/2c.11/2c.16/2c.17/2c.18, P13/P21/P23, rulings 1/7/9/15 struck in place, added rulings 19–20 and F15. Toad's repro (fresh → Continue → Manual → Willow → no dialog) is 2c.16(c).
- Derived, not asked: a preset doesn't clear sky-changed (it doesn't replace the sky); a legacy single `dirty: true` reads as both changed (Q8(b) logic). Flagged in the report.
- fps benched (plan §6): removed 2d.4 only. Kept 2d.1 (parity checklist is a plan 2d Done-when, not fps) and 2a.14(c)/P12 HUD fps readout (display parity, not a perf requirement). P27 got its own load procedure since it pointed at 2d.4.
- Pattern: when a removed criterion is a procedure other rows cite ("The 2d.4 procedure"), the citing rows need the procedure inlined, not just the reference deleted.

### 2026-11-13 — Phase 2 cross-agent update (Scribe)
- Q1 to Q8 are answered. Q1 (fps) became "benched", and 2d.4 was removed. Your `peach-phase2-acceptance-criteria.md` record carries a partial-supersession marker (draft contents, Q1 to Q4).
- Still open in `docs/fireworks-app/acceptance/phase-2.md`: F15 (the single-flag store, now built as the shell and sky split) is not marked closed. P9's Check column still says "draft has no mode field"; Toad and you agreed it should read "the shell document".
- Rosalina's spec §6.4 still describes one flag. Your acceptance rows follow the split, and should stay the reference. Check with Rosalina before copying her §6.4 wording.

### 2026-11-13 — Phase 3 schema acceptance
- Wrote `docs/fireworks-app/acceptance/phase-3.md`: ACCEPT WITH NOTES, F1–F16, Q1–Q3. Fixed P9 in `acceptance/phase-2.md` ("the shell document has no mode field").
- Payload checks that paid off: diffing schema.md §12's fixture names against `schema/fixtures/**` (none missing), and grepping the designer's `[formField]` bindings (17 shell fields, all in `EditableShell`; the 4 display fields are in `DesignerDraft.display`).
- Gaps to carry into Phase 4/5/6 briefs: the paging shape of `api/me/creations` is unspecified (F1). The player's Remix button behavior is undefined, and before Phase 8 `isOwner` is always true, so Done-when step 3 depends on it (Q1). Phase 5 "dirty indicator" vs the replace-confirm `shellDirty`/`skyDirty` flags (F4). Save-time 400/403/404/413/429 copy has no owner (F10). `issueReason` renders `type` with `options:['integer']` as "must be text" (F11). Show stop-at-`duration` vs a valid cue at `t == duration` (Q3).
- Doc vs code: schema.md §8.3 says draft restore runs upgrade; `readDraft` doesn't. Full `ng test` needs Node 26 (`~/.nvm/versions/node/v26.5.0/bin`); the shell default v21.5 is refused. The reduce-flashing spec times out under full-suite load.
- Pattern: when a ruling says "X happens only when not owner" and the interim makes everyone the owner, check that each Done-when step is still observable in the running app.

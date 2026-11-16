# Yoshi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0 to 7 are built. Open: the post-Phase-7 interlude (fast show-testing strategy, with Toad); the Phase 8 identity seam and the `-p` ETag tag; the coarse-pointer warm-up memory clamp (trigger: `CheckpointMemoryMiB` above 128).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 to 2a (summarized 2026-11-13, compacted 2026-11-15)

- **Rulings and parity:** the Signal Forms spike ran before 2c (OQ17: Signal Forms on Angular 22.2.x). Phase 3 states show-vs-shell sky precedence (one sim, one gravity) and `burstHeight` as a fraction of ground height (760). The skeleton mirrors the reference; diff with name substitution (`sed 's/MonsterOfTheWeek/X/'`). The Phase 8 seam is `IdentityRegistration` (DefaultUserId guard, initializer, auth middleware, AllowAnonymous on health, fallback and share GET). Records: `yoshi-phase1-parity-review.md`, `yoshi-phase1-plan-followups.md`. "My creations" follows the write switch before Phase 8: 403, not an empty 200.
- **Engine boundaries (`yoshi-phase2a-engine-boundaries.md`):** the boundary spec needs a layer-edge rule, a transitive reach rule and a fail-closed parser (skill `import-boundary-spec`). No module-level `let` or `var` in the engine; PRESETS are deep-frozen. `normalize` gains `adjustments` and structured `errors`. Worst-case shell lifetime at the limits is about 21 s. `ShellIssue.code` is contract (schema.md §6.3).

### Folded from Phase 3 (summarized 2026-11-14, compacted 2026-11-15)

- **Creation schema (`yoshi-phase3-creation-schema.md` and two addenda):** `normalizeShell` returns only `errors` when any exist, so strict mode needs both. Codes map 1:1 from adjustment kinds (`defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, `cleaned`→`name-format`). Names: remove Cc and unpaired surrogates, trim the explicit JS-trim set (C# `Trim()` misses U+FEFF), blank → Custom, cut at 80 code points. Show v1: required `sky` (wins); embedded shells lose `sky`; `shells` 0..32 keyed `^[A-Za-z][A-Za-z0-9_-]{0,11}$`; cues 0..1000; `fireStep = Math.round(t*120)`, order `(fireStep, id)`. Typical 1000-cue show 72 KB; worst 215 KB; the request limit is 256 KiB.
- **Rulings:** cue `t` is the launch time; share links are not locked; goldens are regression guards; version bumps are for document-shape changes only; no empty shows; a show runs until its last particle fades, and `duration` is the launch window only. `jsonb` drops key order, so tests compare parsed JSON.
- **Validator feasibility (Bowser's probes):** `TryGetDouble` is true for `1e400` (check `IsFinite`); `AllowDuplicateProperties=false` has no path (the walker detects duplicates, last wins); `GetString` and `ValueEquals` throw on lone surrogates (`Utf8.IsValid` gate). An API claim in a spec is a hypothesis until a probe runs.
- **Calls:** "Save as new" uses `POST …/remix`. `/c/:code` is load-then-redirect with `replaceUrl`. `GET api/me/creations` takes `pageSize` 24 (max 100), a `kind` filter and order `updatedAt` desc, then `shareCode`.

### Folded from Phases 4 to 6 (summarized 2026-11-14 and 2026-11-15)

- **Phase 4 (`schema.md` folds of Boo's S1–S29):** §2.1 (S13 overruled: `isOwner` only), §2.2.1 query rules, §2.4 cap, §2.6 gate order (429, 403, 415, 413, 400 envelope, 404 lookup, 400 document), §2.7 status and rate-limit tables, §6.5, §9. The 400 body is exactly `{ message, errors, truncated }`, at most 100 issues. `[FromQuery] string?` turns `kind=` into null, so the list reads `Request.Query`.
- **Phase 5:** draft `source` gains `name` (Rosalina Y1). A 404 from PUT or remix sets `source` to null (Y2). §11.2: a PUT 404 asks; a remix 404 falls back to a plain POST. Share-code reuse is "improbable, not prevented". Delete is hard (`CreationRepository.DeleteOwnedAsync`), with no tombstone. `Connection: close` comes from `ApiResponseHeaders` (declared length over `MaxRequestBodySize`).
- **Phase 6 TimelineDriver (`engine/loop/timeline-driver.ts`, `yoshi-phase6-timeline-driver.md`):** the driver owns the show clock (it counts `beforeStep` calls). Measured pure re-run: 0.12 ms/step (Done-when), 0.28 (600 s, 1000 presets), 1.6 at the 40k cap. So exact checkpoints every 1200 steps, keyed by width, starBudget and capacity, with a 64 MiB cap that doubles the spacing; edits inherit checkpoints up to the first differing cue (`options.from`). `cueTimes` lives in `sim/lifetime.ts`. A late config does not reset the grid (`TimelineDriver.inherit` copies `from.cpSteps`).
- **Lesson (all phases):** trace a new writer of a contract state through every path that reaches it, and every fallback through the endpoint it calls.

## Learnings

### 2026-11-15 — Phase 7 A4 architecture rulings

- **Record:** `yoshi-phase7-architecture-rulings.md`. schema.md gained §2.1.1 (ETag), a sentence in §11.4 and a Phase 7 block in §15. Skill `pixi-host-lifecycle` gained a context-loss section, and its stale stage path is fixed (`app/shared/fireworks-stage/`).
- **Context loss:** the renderer detects (`onContextChange`), the host rebuilds through the factory after `restored`. Pixi 8.23 already calls preventDefault and restores in place, but a rebuild re-probes the trail format and reuses the proven destroy path. Trap: `app.destroy()` itself fires `webglcontextlost`. `FlashSpacing` and the last width move to the host so they survive a rebuild, and loss acts as an implicit pause.
- **Clamps stay out of the driver:** the stage reports `endStep` after playback crosses it. A driver that stopped counting at `done` would make a seek past the end never arrive. A late config doesn't reset the grid, because checkpoints are exact on any grid. Trigger: the first deployed `ClientPlayback__CheckpointIntervalSeconds` override.
- **ETag:** strong `"<updatedAt>"`, serialized with the body's converter (`ToString("O")` pads to 7 digits, a trap). Phase 8: owner keeps the token, non-owner gets `"<updatedAt>-p"`.
- **F3:** use an `embeddedShell()` helper plus a `.shells[` grep guard rather than null-prototype end to end; spreads and structuredClone drop the null prototype silently. A grep guard must exclude the sim's own `this.shells[s]`. Check what a regex matches before you name it as a guard.
- **Shared move:** save-bar, save-status, hud, api-banner, save-copy and formats go to `app/shared`; `save-copy`'s `reasonOf` becomes required; a new rule says shared files never import features.

### 2026-11-15 — Phase 7 B2 review (Luigi's `twin` / `adoptCheckpoints`)

- **PASS for B2, plus one Phase 6 defect of mine (D1):** when the new schedule is a strict prefix of the old one (the last cue removed), `divergeStep` keeps checkpoints from the gap after the new show's real end, and `restore` then reports the end at the checkpoint (4800 instead of 1113). Fix: cap at the receiver's last `fireStep` when it is a strict prefix. Verified in a copy; `timeline-driver.spec.ts:582` asserts the defect. Addendum 1 in `yoshi-phase7-architecture-rulings.md`.
- **Lesson:** "exact up to the first differing cue" covers the world, not derived state that depends on the *absence* of later cues (`endStep`). Check derived fields at every boundary case: prefix, suffix and empty.
- **Memory:** checkpoints move by reference, so the shadow and the visible driver share snapshots. The measured union equals the larger list, so there is no 2× cap. Warm-up makes the cap the steady state, so the trigger is a deployment setting `CheckpointMemoryMiB` above 128, which needs a coarse-pointer clamp.
- **Probe trick:** vitest under `ng test` hides `console.log` from passing tests. Put the values in a failing `expect([...]).toEqual([])` to read them. `ng test` has no `-t`. Probe specs over about 5 s time out when run alongside the stage spec.

### 2026-11-15 — D1 fix (prefix cap in `divergeStep`)

- **Fixed my Phase 6 defect** in `src/web/fireworks-web/src/engine/loop/timeline-driver.ts` (coordinator authorized that file and its spec only; Luigi under lockout). `divergeStep(a, b)` treats `b` as the receiver; a strict-prefix receiver caps at `b.at(-1).fireStep`. Specs added for last-cue deletion (`endStep` 1113, both inherit and adopt) and the M8 off-interval pin; `:582`'s removal row is now `[1200, 2400]`.
- **Mutants:** six targeted ones (N1-N5 plus M8), all killed. Argument order at both call sites is now load-bearing and pinned (N4, N5).
- **Lesson:** never run mutants and the full suite at the same time. Contention made heavy stage and store specs time out (5-30 s) in both runs, which looked like real failures and kills. Run them one after the other, or the result reads nothing.

### 2026-11-15 — Phase 7 post-gate cross-agent update (Scribe)

- **Your §1 timeout is superseded.** Rosalina's design sets the failure block after 10 s (`rosalina-phase-7-design-review.md` point 11), and Luigi built 10 s (`luigi-phase7-client-hardening.md` point 2). Your 5000 ms is marked in place. The rule that a restore after the failure is ignored stands.
- **D1 is in, with your fix.** `timeline-driver.spec.ts` now expects `[1200, 2400]` for the removal row, and a last-cue deletion spec pins `endStep` 1113. Mutants N1 to N5 and M8 are killed.
- **Built as you ruled:** `fail()` sets `data-warm-up` to `off` (Luigi B3 point 11). Bowser's `ResponseHeaders` and 304 path (B1) match §4.
- **Open for you:** the coarse-pointer memory clamp (trigger: `CheckpointMemoryMiB` above 128; not fired). A late checkpoint interval still doesn't reset the grid (your §2 rule).
- **Interlude:** the fast show-testing strategy is yours with Toad, after Phase 7.

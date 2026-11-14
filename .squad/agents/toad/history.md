# Toad — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0–3 are done. Next: the API harness and ownership tests (Phase 4), the round-trip repro (Phase 5), and cross-browser show playback (Phase 6).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 to 1 (summarized 2026-11-13)

- **Rulings:** the Phase 5 non-owner remix branch can only be tested through Phase 4 two-user service tests before Phase 8, because the interim identity makes everyone the default user. The Railway round trip runs with `Identity__AllowAnonymousWrites` on temporarily (OQ20). The "real .NET 10" row is obsolete; the target is the .NET 11 runtime without `DOTNET_ROLL_FORWARD`.
- **Plain `dotnet test` does not cover `Program.cs`** beyond fail-fast startup: with no Postgres the real process never listens. `/health/live`, `/api/nope` 404 and deep links are covered only by `Data/ProgramOnPostgresTests.cs`. The gated run is mandatory before "done". Record: `toad-postgres-gated-suite-is-required-for-program-cs.md`.
- **`npm run typecheck` does not see Angular templates.** A template typo passes it; `npm test` and `npm run build` catch it (TS2551 from the angular-compiler plugin).
- **Startup ledger:** `app.startup.spec.ts` asserts the sorted multiset of startup requests (`['GET /api/me','GET /health/live','GET /health/live']`). Per-component specs alone can't see a deleted `appConfig` initializer.
- **Headless WebGL:** Pixi falls back silently (WebGL to WebGPU to Canvas 2D). Check `getContext('webgl2')` on the canvas, not "running". Skill: `.squad/skills/headless-webgl-smoke/SKILL.md`. Use `channel: 'chrome'` for Playwright (`npx playwright install chromium` stalls here). Scripts live in the scratchpad, never the repo.

### Folded from Phase 2 (summarized 2026-11-13)

- **Oracle:** `record-prototype-golden.mjs` slices the prototype's own `fire()` text, with no port imports. Sum checksums are blind to radial errors, so the golden also carries spread (`Σ|p−mean|`, tolerance 0.01 + 0.01·n). Burst-speed mutants `×1.01` and `×1.003` both fail 13 tests with spread. Measured port-vs-prototype delta is at most 5e-4 per sum or spread. Record: `toad-phase2ab-golden-spread-and-oracle-fire.md`.
- **Mutant hazard:** under machine load a slow spec hits vitest's timeout and "kills" unrelated mutants. Re-run any kill whose only failure is a slow spec. Check `uptime` (or `sysctl -n vm.loadavg`) before a timing or pixel run; Docker VM contention once stalled rAF to 72 frames in 12 s.
- **Reduce flashing:** `fireworks-stage.reduce-flashing.spec.ts` (same launches and frames with the flag on and off give identical sim traces, and the flag reaches the renderer).
- **Designer input:** the held Space fires once (D10), so stress uses separate Space presses every 100 ms from `<body>`. Selecting Mode sets dirty, so a preset must come before Mode in scripts.
- **Leak check:** WebGL contexts created minus lost stays at 2, with one document load across `/` to `/status` round trips (popstate in-app; `/status` → "Back to the designer" is a plain `href` and reloads). The old `lost === created − 1` formula was wrong.
- **BindGroup warning:** one `[BindGroup] textureSource destroyed while still bound` warning per teardown, fixed by Luigi's teardown order (3 to 0).
- **Mutants:** hold mutants 11 of 11 killed (`scratchpad/toad3/mut.py`).
- **Parity (2d.1), Chrome 157 headless only:** P1–P27 recorded in `docs/fireworks-app/acceptance/phase-2.md` as 17 Pass, 10 Deviation, 0 Fail. Both apps served from one origin by `tools/fps-compare/serve.mjs <port>` with `?kit=0`. Count launches from the seed delta `(seed − 20261112)/7919 + 1`, not HUD samples. Headless Chrome doesn't throttle background tabs; stall the main thread for a 10 s frame gap (P26). Compare visuals at matched times, not wall-clock.
- **fps kit:** `tools/fps-compare/{serve.mjs,kit.js,README.md}` is kept, in `.dockerignore`, and benched (plan §6). Its pass bar is historical; record `toad-fps-kit-measurement.md` is superseded in part.

## Learnings

### 2026-11-13 — Phase 3 shared fixtures and follow-up
- **Fixtures are generated, never hand-edited:** `schema/tools/generate-fixtures.mjs` (`--check` diffs the disk). It bundles `presets.ts` with the web app's esbuild, reads boundaries from `schema/limits.json` (20 rows; `show.cues.count` min 1 per Skyler's Q4), and splices text that `JSON.stringify` can't produce via sentinels (`"@@raw:1e400@@"`, `"@@key:__proto__@@"`). Every non-ASCII char is `\u`-escaped.
- **Final count: 175 fixtures** (valid/shell 21, valid/show 9, invalid/shell 71, invalid/show 51, server-only 23). Expected errors are transcribed from schema.md §6, §2.6 and §12 only, never from a validator. Luigi's validator then passed all 134 valid and invalid fixtures on its first run.
- **Format spec** `engine/model/schema-fixtures-format.spec.ts` is separate from the runner. It checks shape, codes from the §6.3 table, presets, `__proto__` own keys, boundaries, size (max show 189,359 B UTF-8, 210,479 B escaped, limit 262,144), layout, rule-11 paths, and repeated names in bodies (JSON.parse hides them). It has 17 negative controls, all caught.
- **Server-only fixtures** are `{ description, body, status, errors?, contentType?, byteMarkers? }`; `status` is 400, 413 or 415. `contentType` is for 415 only (`wrong-content-type.json`). `@@byte:ff@@` becomes a raw `0xFF` (`not-utf8.json`). Record `toad-phase3-server-only-wire-fields.md`; README has the harness rules (root-array and root-string become `(document, not-object)`).
- **Mutants:** the generator has 14 mutants, all caught (`scratchpad/toad6/nc.py`). The runner asserts each replacement text is unique before writing.
- **Edit-tool trap:** `�` escapes in the generator came back as literal U+FFFD. Output was identical, but grep the source for non-ASCII after edits that contain escapes.
- **Shared-file edits:** when schema.md or `limits.ts` is being edited in parallel, mutate with an exact one-occurrence swap and reverse it. Never restore from a backup copy, which clobbers a teammate's edit.
- **Runner loudness:** Luigi's runner throws at module load on a bad kind or bad JSON, failing the whole file (426 to 291 tests). That's intentional.
- **Phase 3 follow-up:** Luigi's `childPath` (rule 11) already landed, so the four `unknown-key-*` fixtures passed on the first run. Two mutants show the runner catches the old `parent.name` form.
- **Reduce-flashing spec timeout (Peach F16):** `fireworks-stage.reduce-flashing.spec.ts` has an explicit `30_000` ms timeout, the same pattern as Yoshi's L7. The work is unchanged. Three full `npm test` runs on Node 26.5.0 took 6263, 5628 and 6636 ms under load averages of 10 to 52; alone it's about 3.6 s. Measure per-test durations with `--reporters=verbose`.
- Node 26.5.0 full suite at gate time: 953 tests in 29 files, typecheck clean.

### 2026-11-13 — Phase 3 cross-agent update (Scribe)
- **Show length changed (Skyler L4; Yoshi addendum 2, point 6):** `duration` never gates firing. Playback ends after the last cue fires and no particle is live. A cue at `t == duration` is valid and its burst is seen. Your Phase 6 cross-browser playback check should watch the tail, not stop at `duration`.
- **Phase 5 non-owner ledger (Yoshi, addendum 2 boundary):** the non-owner path is covered by Phase 4's two-user service tests, plus a Phase 5 spec with a stubbed `isOwner: false` call ledger (exact sorted multiset). Trigger for a real-app test: the first non-owner bug that reaches the running app past those specs.
- **Fixtures are the authority for Bowser's C# harness:** the server-only format above (`status`, `contentType`, `byteMarkers`) is what Bowser's `CreationApiHarness` must read. Changing a fixture is a schema change and needs a matching validator change on both sides.

### 2026-11-13 — Phase 4 QA review (Bowser's creations persistence)
- **Harness verdict:** `CreationFixtureHarnessTests` matches schema/README "The C# harness": raw `GetRawText()` documents, raw server-only bytes with `contentType`/`byteMarkers`, exact sorted ledgers (`SchemaFixtures.Ledger`), and a translation derived from `ValueKind` and pinned to the two root files by a Fact. Everything runs on real Kestrel (`FireworksApiHarness`, port 0); there is no TestServer in the repo. Six fixture-expectation edits in a scratch copy each failed (`scratchpad/toad7/hmut.py`).
- **Mutants:** `scratchpad/toad7/mut.py <tree> KEYS [--pg]` (copy = `Fireworks.slnx`, `dotnet-tools.json`, `schema/`, `src/api`, without bin/obj). Bowser's 4 re-run with identical counts. **Survivors of the original suite (plain and pg):** palette not recomputed on PUT, no `ThenBy(ShareCode)` (the index gives ordinal ties anyway), no `DbUpdateConcurrencyException` catch, service ignoring a null update. New tests: `Creations/CreationUpdateEdgeTests.cs` (palette; a delete interleaved via a `SaveChangesInterceptor` added with `services.ConfigureDbContext<FireworksDbContext>` through the harness's `configureServices`) and `Repositories/CreationListOrderSqlTests.cs` (`DbCommandInterceptor`, ORDER BY keys exact). Record `toad-phase4-order-promises-are-asserted-on-the-sql.md`.
- **No real race test exists**, so no round count is needed: the collision retry is driven deterministically by `QueuedShareCodeGenerator`, and the interleaved delete by the interceptor. Prefer an interceptor over a timing loop whenever the window can be hit deterministically.
- **Client gap for Phase 5:** `core/models.ts` has only `MeResponse`; TS `IssueCode` lacks the server-only codes `not-json` and `duplicate-key`.
- Suite: 543 tests (533 plain + 10 skipped; 543 with `FIREWORKS_TEST_POSTGRES`), .NET SDK 11.0.100, no `DOTNET_ROLL_FORWARD`.

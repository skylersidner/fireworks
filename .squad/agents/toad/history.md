# Toad — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Negative-control table (Phase 1), engine determinism golden tests and the parity checklist (Phase 2), shared schema fixtures (Phase 3), the API harness and ownership tests (Phase 4), the round-trip repro (Phase 5), and cross-browser show playback (Phase 6).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- The Phase 5 non-owner remix branch can only be tested through Phase 4 two-user service tests before Phase 8, because the interim identity makes everyone the default user.
- The Railway round trip runs with `Identity__AllowAnonymousWrites` temporarily on (OQ20).

### 2026-11-12 — Phase 1 verify-the-verifier review and real-browser smoke
- Re-ran 9 negative controls myself (2 C# build/test, 1 Program.cs mutant on both suites, 2 Luigi npm-test mutants, 2 typecheck, 1 template typo on typecheck/test/build). All matched the claims. Table: `README.md` "Verify the verifier".
- **Plain `dotnet test` does not cover `Program.cs` at all beyond fail-fast startup.** Program migrates before `app.Run()`, so with no Postgres the real process never listens. `/health/live` text/plain, `/api/nope` 404 and deep links are covered only by `Data/ProgramOnPostgresTests.cs`. No test-only fix without a production change; the gated run is mandatory before "done" (record `toad-postgres-gated-suite-is-required-for-program-cs.md`).
- **`npm run typecheck` does not see Angular templates.** A template typo passes it; `npm test` and `npm run build` both catch it (TS2551 from the angular-compiler plugin).
- Startup request ledger: `/health/live` has two callers (App probe, home page); `api/me` one (the appConfig initializer). Per-component specs use `expectOne` + `verify()`, which is exact per spec, but none ran the real `appConfig`, so deleting the initializer passed every spec. Added `src/web/fireworks-web/src/app/app.startup.spec.ts` (sorted multiset `['GET /api/me','GET /health/live','GET /health/live']`), proven against two mutants.
- Smoke script lives in scratchpad (`toad/smoke.mjs`), Playwright installed there, never in the repo. Headless Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader`. Pixel check: decode the canvas element screenshot in-page, count pixels with max channel > 60 against the `#04060c` background.
- Local .NET is 11 only; everything ran with `DOTNET_ROLL_FORWARD=Major`. The "real .NET 10" row stays pending.
- Pixi falls back silently: with WebGL disabled, the canary ran on WebGPU, and with the GPU also disabled, on Canvas 2D. A "running" canary isn't proof of WebGL; check `getContext('webgl2')` on its canvas. Skill: `.squad/skills/headless-webgl-smoke/SKILL.md`.
- `npx playwright install chromium` stalls here; use `channel: 'chrome'`.

### 2026-11-12 — Phase 1 cross-agent update (Scribe)
- The "real .NET 10" row above is obsolete. Skyler ruled the backend on .NET 11 (`net11.0`), so the verification target is the .NET 11 runtime without `DOTNET_ROLL_FORWARD`.
- `.squad/skills/headless-webgl-smoke/SKILL.md` reads the Phase 1 canary (`.canary[data-renderer]`). In 2a the canary is deleted or moved (Yoshi's parity review, item 5), so retarget the smoke to the engine host before the canary goes.
- `decisions/records/toad-postgres-gated-suite-is-required-for-program-cs.md` is proposed for index promotion. Skyler decides.

### 2026-11-12 — Phase 2a/2b QA (oracle, mutants, leak, fps prep)
- **Oracle verdict:** `record-prototype-golden.mjs` runs only the prototype's text slice (no port imports). Before my change, regenerating was byte-identical only after a manual Prettier run, and the 7919 stride and base seed were typed into the harness, so a prototype stride mutation left the fixture unchanged. Fixed: it now slices the prototype's `fire()` and formats its own output. Prototype-side mutants (crackle count, glitter rate, drag, stride, baseSeed, burst speed) all move the fixture now. The crossette guard can't move it (unreachable in playback).
- **Sum checksums are blind to radial errors.** `burst speed ×1.01` and `×1.003` passed all 193 specs. Added spread (`Σ|p−mean|`) to the fixture and spec (tolerance 0.01 + 0.01·n), and both mutants now fail 13 tests. Measured port-vs-prototype delta ≤ 5e-4 per sum or spread in Node 26, headless Chrome 157 and macOS `jsc`. Record: `toad-phase2ab-golden-spread-and-oracle-fire.md`.
- **Mutant runner hazard:** under machine load, the 40k cap spec hit vitest's 5 s timeout and "killed" unrelated mutants (including a Pixi-renderer one). Yoshi had already raised it to 30 s in the live tree. Always re-run any kill whose only failure is a slow spec.
- Mutants: the full table is in the Phase 2a/2b report. Survivors with no unit oracle: `app.destroy` removed in pixi-renderer (only 2d.3 sees it), and burst-speed spread (fixed by the spread check).
- New spec: `features/designer/shared/fireworks-stage/fireworks-stage.reduce-flashing.spec.ts` (same launches and frames with Reduce flashing on and off give identical sim traces, and the flag reached the renderer).
- **The designer's held Space fires once (D10)**, so 2d.4's "hold Space until 39k" can't reach the cap in the port. My stress procedure sends separate Space presses every 100 ms from `<body>` in both apps.
- `/status` → "Back to the designer" is a plain `href`, so it reloads the document. My leak script uses popstate in-app navigation and counts `load` events.
- Leak oracle: WebGL contexts created minus lost stays at 2 (Pixi's probes) on every cycle. Live build over 20 cycles went 3−1 → 23−21, with no warnings and 1 canvas per return.
- Machine load (Docker VM at 500% CPU, load average up to 87) made headless rAF stall (72 frames in 12 s). Check `uptime` before trusting any timing or pixel run.
- Scratch tools: `scratchpad/toad2/{mut.py,leak.mjs,fps.mjs,serve-static.mjs,xeng/}`.

### 2026-11-13 — Phase 2 gate prep (live-tree suite, leak, fps, kit, hold mutants)
- Live tree on Node 26.5.0: `npm test` gave 342 and then 347 after Luigi's DOM-order and aria change (25 files). `typecheck` and `build` are clean. The shell's default node is 21.5. Prefix PATH with `~/.nvm/versions/node/v26.5.0/bin`.
- **The 2026-11-12 "port never reaches the cap" was my script.** Selecting Mode sets dirty, so a Willow click afterwards opens "Load Willow?" and Space is ignored. Fixed order: preset, then Mode. Both apps now reach 40k in about 4 s headless.
- The leak check (`scratchpad/toad3/leak.mjs`) uses `/` → `/status` via popstate (the designer has no `/status` link) and `/status` → `/` via the routerLink. Result: 1 document load, created − lost = 2 on all 21 rows, and the pixel check passes before and after. The old script's `d_pass` formula (`lost === created − 1`) was wrong; the invariant is created − lost = 2.
- There's one Pixi `[BindGroup] textureSource destroyed while still bound` warning per teardown, already present in the 11-12 build. Reported to Luigi as low priority.
- The fps kit is in the repo at `tools/fps-compare/{serve.mjs,kit.js,README.md}`, and `tools/` is in `.dockerignore` (proven with a busybox context listing, plus a control with the line removed). Record: `toad-fps-kit-measurement.md` (the overlay's rAF median is the number of record; the browser tool is the cross-check).
- Hold mutants: 11 of 11 killed (frame tick, time-advances-but-swallowed, launch, replay, fireNow, click, page Space, store, and three on reduce-first-burst). Runner: `scratchpad/toad3/mut.py`.

### 2026-11-13 — Phase 2 parity checklist (2d.1), Chrome only
- Skyler deferred Firefox/Safari parity, 2d.5 and 2d.6 to the Railway deploy. Recorded Chrome 157 headless (SwiftShader) for P1–P27 in `docs/fireworks-app/acceptance/phase-2.md`: 17 Pass, 10 Deviation, 0 Fail. Both apps served from one origin by `tools/fps-compare/serve.mjs <port>` with `?kit=0`.
- Scripts: `scratchpad/toad4/{lib.mjs,t1.mjs,t1b.mjs,t2.mjs,t3.mjs,t5b.mjs,t14.mjs,t27.mjs,twind.mjs,t3r.mjs,t2l.mjs}`. `lib.mjs` abstracts both apps (HUD seed, particles, ranges by label, canvas brightness and centroid).
- **Count launches from the seed delta** `(seed − 20261112)/7919 + 1`, never by sampling HUD changes. The port's HUD updates about 4/s, so a 400 ms settle sometimes misses a launch (a false "click didn't fire" at 30% height went away with a 900 ms settle).
- **Headless Chrome doesn't throttle background tabs**, and `Page.setWebLifecycleState frozen` doesn't stop rAF. For P26, stall the main thread for 10 s (`while (performance.now()-t<10000){}`), which gives a real 10 s frame gap.
- Prototype seed-20261112 first launch: `addInitScript` that sets `#mode` to manual on DOMContentLoaded, then the preset click fires. Port: a `reducedMotion: 'reduce'` context (opens in Manual), Continue, switch Reduce flashing off, then the preset click.
- On the wall clock, the port's burst frames run about 0.4 s ahead of the prototype's from a fresh page. Compare visuals at matched times, not equal times.
- Mario's `mario-parity2.mjs` counts `Delay` while tab 1 is selected (always 0). Re-checked separately.
- P9's "draft has no mode field" conflicts with 2c.9(ii)/2c.10 (mode is a display setting outside the document). Read it as the document and flagged it to Peach for rewording.
- `tools/fps-compare/README.md` now says the kit is benched (plan §6) and the bar is historical.

### 2026-11-13 — Phase 2 cross-agent update (Scribe)
- Phase 3 fixtures must use normalize's paths (`breaks[1].color1`, `sky.wind`, `name`, `version`), not free-form field names. Source: Yoshi's record, item 4.
- fps is benched (plan §6; `tools/fps-compare/README.md`). Your pass bar is historical. Your fps record is marked superseded in part.
- The `[BindGroup] textureSource destroyed while still bound` warning you reported is fixed by Luigi's teardown order (glow texture destroyed after `app.destroy`). Smoke: 3 warnings before, 0 after.
- P9's Check column wording is still open with Peach.

### 2026-11-13 — Phase 3 shared fixtures
- Built `schema/limits.json` (20 rows; `show.cues.count` min 1 per Skyler's Q4), `schema/fixtures/**` (140 files: valid/shell 21, valid/show 9, invalid/shell 66, invalid/show 38, server-only 6), `schema/fixtures/upgrade/README.md`, `schema/README.md`.
- **Fixtures are generated, never hand-edited:** `schema/tools/generate-fixtures.mjs` (`--check` diffs the disk). It bundles `presets.ts` with the web app's esbuild (Node can't import extensionless TS), reads boundaries from `limits.json`, and splices text `JSON.stringify` can't make via sentinels (`"@@raw:1e400@@"`, `"@@key:__proto__@@"`). Every non-ASCII char is `\u`-escaped.
- Expected errors are transcribed from schema.md §6/§12 only. Luigi's `validate.ts` then passed all 134 valid/invalid fixtures on the first run: two independent derivations from the doc agreeing.
- Max show: compact `{kind, document}` body 189,359 B UTF-8, 210,479 B `\u`-escaped (limit 262,144).
- Luigi had already written `limits.spec.ts` (via `SCHEMA_LIMIT_ROWS` in `limits.ts`) and the runner `schema-fixtures.spec.ts`; I added `schema-fixtures-format.spec.ts` (shape, codes from the §6.3 table, presets, `__proto__` own key, boundaries, size, layout). 17 negative controls, all caught (scratchpad `toad5/nc.py`). Luigi's runner throws at module load on a bad kind or bad JSON, which fails the whole file (426 → 291 tests), so it's loud, not per-file.
- Shared files being edited in parallel (schema.md, limits.ts): mutate with an exact one-occurrence swap and reverse the swap; never restore from a backup copy, which would clobber a teammate's concurrent edit.

### 2026-11-13 — Phase 3 follow-up: edge-case fixtures (schema.md §2.6, §6.2 rules 7–13, §12.3–12.4 "(new)")
- 35 new fixtures through the generator, 175 total: valid/shell 21, valid/show 9, invalid/shell 71 (+5), invalid/show 51 (+13), server-only 23 (+17). Expected errors transcribed from schema.md only.
- Luigi's rule 11 `childPath` had already landed in `normalize.ts`, so all four `unknown-key-*` fixtures passed his runner on the first run (and two mutants show the runner does catch the old `parent.name` form).
- Server-only format grew `contentType` (415 only) and `byteMarkers` (`@@byte:ff@@` → 0xFF). Record `toad-phase3-server-only-wire-fields.md`. README has the harness rules, including the root-array/root-string `(document, not-object)` translation.
- Format spec now parses rule 11 paths (rejects a bracketed plain name and any lone surrogate in a path), scans bodies for repeated names (JSON.parse hides them), and checks the marker bytes with a fatal `TextDecoder`.
- The Edit tool turned my `�` escape in the generator into a literal U+FFFD. Output is identical, but grep the source for non-ASCII after edits that contain escapes.
- Negative-control runner `scratchpad/toad6/nc.py`: 14 generator mutants, all caught. Twice, a mutant's replacement text wasn't unique, so the reverse swap failed; the runner now asserts the replacement is absent before writing. Restored both by hand and verified with `--check`.
- Node 26.5.0 full suite: 953 tests in 29 files, typecheck clean.

### 2026-11-13: reduce-flashing spec timeout (Peach F16)
- `fireworks-stage.reduce-flashing.spec.ts` now has an explicit `30_000` timeout (same pattern as Yoshi's L7 on the cap spec). The work is unchanged (2 runs x 1,200 frames, all ten presets), so the 2026-11-12 negative control (halve starBudget when Reduce flashing is on) still applies as recorded.
- Measured in three full `npm test -- --watch=false --reporters=verbose` runs (Node 26.5.0, 953/953 passed each time): 6263, 5628, 6636 ms, with 1-minute load average 10 to 52 (other work on the machine). Alone it's ~3.6 s. The 30 s budget gives a ~4.5x margin over the worst full-suite run.
- `--reporters=verbose` on the Angular unit-test builder prints per-test durations; that's the way to measure these.

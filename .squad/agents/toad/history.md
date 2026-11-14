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

### Folded from Phase 3 and Phase 4 (summarized 2026-11-14)

- **Fixtures are generated, never hand-edited:** `schema/tools/generate-fixtures.mjs` (`--check` diffs the disk). Limits come from `schema/limits.json` (20 rows; `show.cues.count` min 1). 175 fixtures: valid shell 21, valid show 9, invalid shell 71, invalid show 51, server-only 23. Expected errors are transcribed from schema.md §6, §2.6 and §12, never from a validator. Grep the generator for non-ASCII after any edit that contains escapes.
- **Format spec** `engine/model/schema-fixtures-format.spec.ts` is separate from the runner (shape, codes, presets, `__proto__`, boundaries, size, rule-11 paths, repeated names; 17 negative controls). A runner that throws at load on a bad kind or bad JSON is intentional.
- **Server-only fixtures** are `{ description, body, status, errors?, contentType?, byteMarkers? }`. `status` is 400, 413 or 415; `contentType` is for 415; `@@byte:ff@@` is a raw byte (record `toad-phase3-server-only-wire-fields.md`). Bowser's harness reads these fields.
- **Show tail (L4):** a cue at `t == duration` is valid and its burst is seen. Phase 6 playback checks watch the tail, not `duration`.
- **Phase 4 harness:** `CreationFixtureHarnessTests` follows `schema/README.md` "The C# harness". Everything runs on real Kestrel (`FireworksApiHarness`, port 0); there is no TestServer. Ledgers are exact and sorted (`SchemaFixtures.Ledger`).
- **Blind spots closed:** palette recompute on PUT, `ThenBy(ShareCode)`, `DbUpdateConcurrencyException`, and a null update. Prefer a `SaveChangesInterceptor` or `DbCommandInterceptor` over a timing loop (`CreationUpdateEdgeTests`, `CreationListOrderSqlTests`; record `toad-phase4-order-promises-are-asserted-on-the-sql.md`).
- **Shared-file mutation:** use an exact one-occurrence swap and reverse it. Never restore from a backup copy, which clobbers a teammate's edit. The runner refuses a replacement that already exists in the file.
- **Timing:** `fireworks-stage.reduce-flashing.spec.ts` has an explicit 30 s timeout (Peach F16); alone it takes about 3.6 s.
- **Phase 7 test:** a chunked over-limit `/api` write gets `Connection: close` (Boo verification point 2), if Bowser adds the chunked close.

## Learnings

### 2026-11-14 — Phase 5 QA review (Luigi's save, share, player, /c/, /mine)
- **Suites:** web 1227 → 1230 (39 files, Node 26.5.0, typecheck clean); backend 555 + 10 skipped plain, 565/565 with `FIREWORKS_TEST_POSTGRES` (README §108 string, `fireworks_test` db).
- **Mutants (`scratchpad/toad-p5/mut.py KEYS`):** 23 run. 21 killed by Luigi's specs; `flow-ignores-canwrite` survived (status block in `designer-page.html` isn't gated on canWrite, so a stale Try again is the reachable path; my new designer-save test kills it); `link-keeps-visitor-sky` is equivalent (`normalizeSky(undefined)` already returns DEFAULT_SKY).
- **Runner trap:** a mutant whose replacement is `""` or a non-unique string can't be reversed by an exact swap. The first run left `creation-save.ts` mutated until I restored it by hand. The runner now refuses a mutant whose replacement text already exists in the file. Always checksum targets before and after.
- **Cascade trap in Luigi's specs:** `afterEach(() => { http.verify(); vi.restoreAllMocks(); })` means one failure throws in verify, skips the TestBed reset and the mock restore, and every later test in the file fails ("Cannot configure the test module…"). Read the first failure, not the count.
- **Round trip:** compare parsed values (`util.isDeepStrictEqual`). jsonb reorders keys (length, then bytes). All 21 valid shell fixtures plus a hand doc round-trip through POST/GET, PUT/GET and remix/GET. Browser level: the designer's sent document deep-equals the draft `shell` and the GET. Scripts: `scratchpad/toad-p5/roundtrip.mjs`, `rt-fixtures.mjs`, `cleanup.mjs <iso> [--dry]`, `scratchpad/smoke/toad-p5-browser-roundtrip.mjs`.
- **Write rate limit 20/min fixed window (and 300/day)**, deletes included. Pacing at 3.2 s still hits 429 when a cleanup shares the window. Wait 65 s between batches, and clean up by listing `api/me/creations` by `updatedAt`.
- **Structure rule hole (2c.8 Phase 5 form):** `IDENTITY_OR_HTTP` hand-lists core modules. `core/health`, `core/api-status` and a raw `fetch(` all pass. The designer page legitimately uses ApiStatusService (the API banner), so a derived rule needs that one allowance.
- A parallel teammate edited `player-page.html` during my run (15:39:03). Exact one-occurrence swaps kept it safe.

### 2026-11-14 — Phase 5 review-fix: unsafe-sinks.spec.ts C1/C2 (Boo F1)
- **Fix:** `UNSAFE_SINK` is now `/…/i` and also bans `createContextualFragment`, `setHTMLUnsafe`, `parseHTMLUnsafe`, `DOMParser`. C2 uses an exported `NAME_IN_URL` (flag `i`) over `URL_ATTR` = `(attr.)?(href|xlink:href|src|srcset|ngSrc|ngSrcset|srcdoc|action|formaction|poster|routerLink)`, in three spellings: bound (`[x]=`, `bind-x=`, `bindon-x=`, either quote), interpolated (`x="…{{ …name… }}…"`, bounded by the quote and the closing `}}`), and `host: { '[x]': '…name…' }`. 28 URL negative controls, 8 positive controls, 15 new sink controls.
- **Why case-insensitive:** `@angular/compiler` 22.2.6 `DOM_PROPERTY_REMAPPING` = class, for, formaction, innerHtml, readonly, tabindex. Only `innerHtml` and `formaction` matter for sinks. `BIND_NAME_REGEXP` still accepts `bind-`/`bindon-` prefixes.
- **Mutant rig without touching the shared tree:** copy `src`, `angular.json`, `package.json`, `tsconfig*.json` into the scratchpad and symlink `node_modules`; `ng test` runs there fine (`scratchpad/toad-c1c2/mut.py [names]`). Spec mutants and tree mutants (append to a copied template) both run in the copy. The original spec let all 6 tree mutants pass; the new one kills all. 
- **Expected survivor:** swapping the file-filter regex back to the old one survives on a clean tree; the tree mutants are what kill it. A URL-attr list member with no control survives (`ngSrcset` did until I added one) — drop each alternative as a mutant.
- **Positive controls matter for unbounded regexes:** `[\s\S]*` without the quote bound flagged the real tree (`routerLink="/">{{ name }}`); the positive-control test kills the brace and quote unbounding.

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **Boo F1 closed:** your `unsafe-sinks.spec.ts` hardening (9 of 9) covers the `[innerHtml]` and `href="{{ name }}"` spellings Boo found. Mario re-ran it at the gate.
- **Round trip not rerun at the gate:** Mario skipped your 21-fixture parsed-value round trip because of the write limit. Rerun it in the Railway window, 65 s between batches, cleaning up by `updatedAt`.
- **Rig drift:** Luigi's `prettier --write` changed line 58 (the `bind-|bindon-` alternative). Re-sync your rig copy to the repo's full form.
- **No Phase 5 record:** `records/` has no toad-phase5 file. The review lives in history and the `exact-swap-mutants` skill. Write a record if you want it archived.
- **Open for you or Boo:** the C2 "name"-only heuristic.

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

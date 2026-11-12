# Luigi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase 1b (Angular skeleton and the Pixi canary), Phase 2 (engine port into `src/web/fireworks-web/src/engine/` and the Shell Designer), Phase 5 (save, share, player, My creations), and Phase 6 (Show Builder UI).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- Before 2c starts, run the Signal Forms spike with Yoshi (OQ17). Use Signal Forms if they're stable in the installed Angular 22. Otherwise use typed reactive forms. Record the outcome.
- `session.canWrite` comes from `api/me` and hides write controls when false (OQ20).
- Angular dev server stays on port 4200 (OQ12).

### 2026-11-12 — Phase 1b: Angular skeleton + Pixi canary
- **Toolchain:** Node 26.5.0 via nvm (`export PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"` before every npm/ng command; shell default 21.5.0 is rejected). npm 11.17.0. CLI 22.2.7 (`@angular/build`, `@angular/cli`), framework 22.2.6, TypeScript 6.0.3, Vitest 5.1.0, jsdom 30.1.3, Tailwind 4.3.5, pixi.js 8.23.0. Skyler wants exact pins: every direct dep in `package.json` is pinned with no caret.
- **CLI 22.2 output already matches the reference** for tsconfig*.json, .prettierrc, .editorconfig and .gitignore, byte for byte. TS 6 defaults `strict` on, so no `strict` key is needed. Zoneless is the default, with no `provideZonelessChangeDetection()` and no zone.js.
- **typecheck:** root `tsconfig.json` is solution-style (`files: []`), so `tsc -p tsconfig.json` exits 0 on a type error (verified). The script runs app and spec configs separately.
- **npm 11.17 `allowScripts`:** approved @parcel/watcher, esbuild, lmdb, msgpackr-extract (pinned), mirroring the reference; fsevents stays unapproved (warning only). Versions change on upgrades, so re-run `npm approve-scripts --allow-scripts-pending` after bumping.
- **Pixi loading:** `CANARY_SCENE_FACTORY` InjectionToken whose default dynamically imports `canary-scene.ts`, so Pixi is its own lazy chunk (not even in the home chunk), and specs inject a fake (`src/app/testing/fake-canary-scene.ts`) and never load Pixi or need WebGL. Reuse this for app-fireworks-stage. Skill: `.squad/skills/pixi-host-lifecycle/SKILL.md`.
- **Pixi destroy releases the context:** `GlContextSystem.destroy()` calls `WEBGL_lose_context.loseContext()`, so `app.destroy({ removeView: true }, { children, texture, textureSource })` is enough.
- **Build:** initial 255.41 kB raw / 69.50 kB transfer; Pixi chunk 347 kB / 85 kB. `@xmldom/xmldom` (Pixi webworker adapter, CJS) is tree-shaken from every output, so it's in `allowedCommonJsDependencies`. `--stats-json` writes `browser-stats.json` INTO wwwroot (served publicly), so delete it after analysis.
- **Session:** `core/session.ts` loads `api/me` from an initializer that does not block first render (no guards until Phase 8). `canWrite` is `user?.canWrite === true`, false until loaded and after failure. `models.ts` `MeResponse` mirrors `MeResponse(Guid? UserId, string? DisplayName, bool IsAuthenticated, bool CanWrite)`, so both are nullable.
- **OQ17 finding:** Signal Forms are stable in 22.x (`@publicApi 22.0`, angular.dev "stable since v22.0"); they were `@experimental 21.0.0` in 21.2.26. Only the WebMCP bits are still experimental in 22.
- 2026-11-12 (coordinator): Skyler decided OQ17. Use **Signal Forms** on Angular 22.2.x. The spike is no longer needed.

### 2026-11-12 — Phase 1 fix round (Yoshi #1/#6, Toad #3, Boo cosmetic)
- **Pixi renderer honesty:** a string `preference: 'webgl'` gives the order webgl → webgpu → canvas in `autoDetectRenderer`, and canvas always succeeds. "Running" never proves WebGL. Read `app.renderer.name` (`'webgl' | 'webgpu' | 'canvas'` in 8.23; `RendererType` is @internal) and surface it. The canary has `data-renderer`, the `[data-testid="canary-renderer"]` line, and a renderer-aware aria-label. The stage in Phase 2 should expose the same thing.
- **Verified in real Chrome** with scratchpad Playwright (`channel: 'chrome'`) and a tiny node static server over wwwroot that returns 503 for /api and /health. The three flag sets gave webgl, webgpu and canvas. Script pattern: `.squad/skills/headless-webgl-smoke/SKILL.md`.
- **`isSelfHandledRequest`** now matches the exact path of `request.url` (scheme and host stripped, `?`/`#` cut) against a Set. With a path-prefixed `apiBaseUrl`, the entries need the prefix too. Spec: `core/self-handled-request.spec.ts`.
- **`tsconfig.spec.json`** has the reference's `outDir: ./out-tsc/spec` back. Toolchain drift (npm 11.17.0, Vitest 5.1.0, jsdom 30.1.3 vs ref 11.12.1, 4.1.10 and 28.1.0) is recorded as an addendum in `luigi-phase1b-angular-skeleton.md`.
- **Mutants in a copy:** rsync the web tree into the scratchpad at `…/mut/src/web/fireworks-web` and symlink node_modules. The `src/web` depth keeps `outputPath ../../api/...` inside the scratchpad. `ng test` works from the copy.
- Suite: 44 tests. Build: Pixi chunk 347.02 kB, home 4.54 kB, initial 255.56 kB.

# Phase 1b: Angular skeleton choices (Luigi, 2026-11-12)

## What
1. **Session loads in the background.** `provideAppInitializer` subscribes to `SessionService.load()` and returns void, so the first render does not wait on `api/me`. `canWrite` is `currentUser()?.canWrite === true`: false until `api/me` answers, and false again if it fails.
2. **Pixi loads only through an injectable factory that dynamic-imports the scene module.** The canary does this through `CANARY_SCENE_FACTORY`, and app-fireworks-stage will follow the same pattern. No Angular component file imports `pixi.js` statically.
3. **Every direct npm dependency is pinned exactly**, not just `pixi.js`.
4. **`@xmldom/xmldom` is in `allowedCommonJsDependencies`.**
5. **Never ship a `--stats-json` build.** Angular writes `browser-stats.json` into the API's wwwroot, where it would be served publicly.

## Why
1. There are no route guards until Phase 8, and write controls are hidden by default, so blocking buys nothing. A non-blocking load also keeps a hung `api/me` from holding the page and the API-unavailable modal hostage.
2. Pixi stays out of the initial bundle and out of the page chunk (the build stats show 0 Pixi modules in `main` and `home`). Specs inject a fake, so jsdom never needs WebGL.
3. Skyler ruled that we pin exactly the versions the CLI installs.
4. Pixi's web-worker adapter imports xmldom (CommonJS), but esbuild tree-shakes it from every output chunk. Allow-listing it keeps the build warning-free, so a new CommonJS warning stands out.
5. Stats output exposes module paths and sizes.

## Boundary
- Item 1 holds only until a route guard reads identity. Phase 8 must return the observable from `provideAppInitializer`, the reference AuthService pattern. Otherwise the first `canMatch` runs against a null user.
- Item 3 does not stop upgrades. Bump the pins deliberately, then re-run `npm approve-scripts --allow-scripts-pending`.
- Item 4 must be revisited if xmldom ever shows up in an output chunk's inputs in the stats.

## Addendum: toolchain drift from the reference (2026-11-12, Phase 1 fix round, Yoshi #1)

### What
The web toolchain differs from the reference app on three tools. Each value is the exact pin in `src/web/fireworks-web/package.json`, compared with the reference's `package.json` and lockfile:

| Tool | Fireworks (exact pin) | Reference (range, locked) |
|---|---|---|
| npm (`packageManager`) | `npm@11.17.0` | `npm@11.12.1` |
| Vitest | `5.1.0` | `^4.0.8` (locked 4.1.10) |
| jsdom | `30.1.3` | `^28.0.0` (locked 28.1.0) |

The builder (`@angular/build:unit-test`), the `test` and `typecheck` scripts, and the tsconfig files match the reference (`tsconfig.spec.json` now has the reference's `"outDir": "./out-tsc/spec"` again).

### Why
These are the versions the Angular 22.2 CLI installed, pinned exactly under Skyler's exact-pin ruling. The reference was scaffolded on an earlier CLI. npm 11.17 is what ships with Node 26.5.0, the version on PATH. Nothing in Phase 1 depends on a Vitest 5 or jsdom 30 feature, and the full suite (44 tests) passes on these versions.

### Boundary
- The plan's §2 row says "Vitest 4, jsdom 28" for the reference and "Vitest 5.1.0 and jsdom 30.1.3" for us. Yoshi is updating that row; this addendum is the evidence for it.
- Don't downgrade to match the reference. Bump deliberately, with the item 3 boundary above.

## Addendum: canary reports the renderer Pixi actually picked (2026-11-12, Phase 1 fix round, Toad #3)

### What
`CanaryHandle.renderer` is `'webgl' | 'webgpu' | 'canvas'`, read from `app.renderer.name`. The canary host carries `data-renderer`, the visible line says `Renderer: WebGL` or `Renderer: WebGPU (WebGL unavailable, Pixi fell back)` / `Canvas 2D (…)`, and the aria-label names the renderer. The failure message now says that Pixi failed to load or no renderer could initialize, and no longer claims "WebGL is unavailable". The init keeps `preference: 'webgl'` with Pixi's fallback, as in the prototype.

### Why
With a string preference, Pixi 8.23's `autoDetectRenderer` tries webgl, then webgpu, then canvas, and canvas always succeeds. So `data-status="running"` did not prove WebGL, and the old failure message could only appear when the chunk failed to load or init threw, never because WebGL alone was missing. I checked this in headless Chrome against the built wwwroot. With the default flags the canary reported `webgl`, and `getContext('webgl2')` returned the owning context. With WebGL disabled it reported `webgpu`. With WebGL, 3D APIs and the GPU disabled it reported `canvas`. All three runs had `data-status="running"`.

### Boundary
- A running-app check that WebGL works must assert `data-renderer="webgl"` (or the webgl2 context check in `.squad/skills/headless-webgl-smoke/SKILL.md`), never `data-status="running"` alone.
- Whether the real stage (Phase 2) should refuse the fallback with `preference: ['webgl']` is not decided here. The prototype falls back, so parity says keep the fallback; raise it with Rosalina and Toad if fallback visuals differ.
- Negative controls (in a scratch copy of the tree): when the component ignores `handle.renderer` and claims `webgl`, 2 tests fail and 42 pass. When `isSelfHandledRequest` goes back to `urlWithParams.includes('/health/live')`, 7 tests fail (the non-exempt cases in `self-handled-request.spec.ts`).

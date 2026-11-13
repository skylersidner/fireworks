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

### 2026-11-12 — Phase 1 cross-agent update (Scribe)
- Yoshi's parity review (`decisions/records/yoshi-phase1-parity-review.md`, item 5): the canary `src/web/fireworks-web/src/app/pages/home/pixi-canary/canary-scene.ts` imports `pixi.js` outside `engine/render`. In 2a, delete the canary or move its scene under `engine/render`. Do not allow-list it in the import-boundary spec.
- Rosalina owns the placeholder toast and success tokens in `styles.css` (`--color-success`, `--color-toast-*`, `--color-on-toast-*`). Keep templates on the semantic names so she can retune values in one place before 2c.

### 2026-11-12: Phase 2a/2b, engine port and fireworks-stage
- **Engine layout:**
  - `src/engine/model/{colors,enums,shell,presets,limits,normalize}.ts`;
  - `sim/{constants,kinds,rng,particle-store,patterns,simulation}.ts` plus `sim/golden/`;
  - `loop/{playback-driver,drivers,engine-loop,timeline-driver}.ts`;
  - `render/{stage-renderer,coordinates,visual-rules,glow-texture,skyline,trail-buffer,pixi-renderer}.ts`. Only the last four import pixi. `stage-renderer`, `coordinates` and `visual-rules` are pure, so they're specced without a DOM.
- **Golden values come from the prototype itself:** `sim/golden/record-prototype-golden.mjs` slices the HTML by text markers, runs it in Node and writes `prototype-golden.ts`. The port matched all 10 presets plus 4 scenarios on the first run. Skill: `.squad/skills/prototype-oracle-golden/SKILL.md`.
- **Steps 60/240 only cover the rise** (about 300 steps). I added 360 and 450, during the burst.
- **`// @vitest-environment node` works under `@angular/build:unit-test`** (negative control recorded). Every model/sim/loop spec carries it, and the boundary spec enforces it. The boundary spec reads files through `process.getBuiltinModule('node:fs')`, so it needs no @types/node and no bundler externals.
- **Canary deleted.** The stage replaces it on the home route as a temporary smoke check (Peony, loop mode, stats line).
- **`StageRenderer` contract:** `start(onFrame)`, `render(sim, persistence)`, `screenToWorld`, `worldWidth`, `name`, `trailFormat`, `destroy`. The token is `STAGE_RENDERER_FACTORY`; the spec fake is `app/testing/fake-stage-renderer.ts`.
- **Pixi gotchas:**
  - Off-stage containers (`worldRoot`, the trail fade root) are not destroyed by `app.destroy`; destroy them explicitly first.
  - `RenderTexture.create` never throws on an unsupported format. Check `renderer.context.webGLVersion === 2` plus `extensions.colorBufferFloat` or `EXT_color_buffer_half_float` (WebGPU is always fine).
  - Canvas 2D has a ParticleContainer pipe in 8.23.
- **The tint cache as a Uint32Array per live slot is exact:** `live` and `pool` are both stacks moved top to top, so slot i always holds the same Particle.
- **Peach's acceptance file** `docs/fireworks-app/acceptance/phase-2.md` is the checklist for Phase 2. Read it before 2c (Q2–Q4 are open for Skyler).
- **Rosalina's 2c record** (`rosalina-designer-2c-design-review.md`) adds `quality.reduceFlashing`, which touches `render/visual-rules.ts` (strobe, flash, glitter) and `RandomShowDriver` (gap of at least 0.8 s). That's 2c work, not started.
- **Smoke:** stub `/health/live` as 200, or the API-unavailable modal covers the stage.
- **Build:** initial 259.53 kB; Pixi chunk (`pixi-renderer`) 367.92 kB; home 17.71 kB (sim and loop are in it, Pixi is not).
- **Mutants (17, all killed; runner is `scratchpad/mutate.py`, copy-tree pattern):** the stride and prand mutants fail goldens. The crossette gen guard is unreachable in real playback (children spawn with `E_NONE`), so only the hand-spawned gen-1 unit spec kills that mutant, and no golden can. Reported to Peach as a correction to 2a.8.

### 2026-11-12: Phase 2c, Shell Designer
- **Files.**
  - Page and store: `features/designer/pages/designer-page/{designer-page.ts,.html,shell-designer.store.ts}`.
  - Shared presentational components: `features/designer/shared/{playback-controls,preset-bar,shell-fields,break-tabs,break-fields,sky-fields,quality-fields,json-panel,hud,flash-notice,api-banner}/`.
  - Designer modules: `designer-draft.ts`, `designer-copy.ts`, `formats.ts`.
  - App-wide controls: `app/shared/{range-row,select-row,confirm-dialog}.ts`.
  - Core: `core/{api-status,browser}.ts`.
  - Labels: `engine/model/labels.ts`. Freeze helper: `engine/model/freeze.ts`.
  - Status page moved to `/status` (`pages/status/`). `pages/home` deleted.
  - Test helpers: `testing/{memory-storage,fake-match-media}.ts`.
- **Signal Forms 22.2 gotchas:**
  - The directive is `[formField]` (`FormField`, from `@angular/forms/signals`).
  - FormField owns `min`/`max`/`maxlength` and more. `[attr.maxlength]` beside `[formField]` is compile error NG8022, so use `maxLength(p.name, 80)` in the schema. Custom controls must not declare inputs named `min`/`max`/`name`/`disabled` unless they mean the field state. range-row takes one `range` input.
  - `disabled(b.changeAt, ({ valueOf }) => valueOf(b.color2) === 'none')` inside `applyEach` flows into the control's `disabled` input.
  - A generic `SelectRowComponent<T>` with `model.required<T>()` type-checks against `FieldTree<Pattern>`.
- **Store pattern.**
  - `model` is the form's raw model, never rewritten, so no field fights the user.
  - `shell` is a `linkedSignal` of normalize(model) that keeps the last good value.
  - The draft is an effect with a 300 ms debounce, compared to the last write, and flushed on `pagehide` and DestroyRef.
  - Notes are keyed by (shellJson, edits), so any edit clears them without an effect.
- **Stage host sizing gotcha.** `class="absolute inset-0"` on `app-fireworks-stage` loses to its own `:host { position: relative }` (same specificity, component CSS later), and the stage renders 0 px tall. Use `h-full w-full`. Only the real-browser smoke caught it.
- **Stage additions.** `fireNow(shell, sky)` sets `loop.shell` and `sim.sky` synchronously before launching. Input effects only run at the next change detection, so a preset launch would otherwise fire the old shell. Reduce flashing is flipped on the running `RandomShowDriver`, not by recreating it, so the timer doesn't reset.
- **Machine load.** With Toad and Yoshi running in parallel, load average hit 104 and the suite took 293 s, with 7 timeouts and no assertion failures. Check `sysctl -n vm.loadavg` before reading a timeout as a regression.
- **Mutants:** 31, all killed by assertions. Runner: `scratchpad/luigi-2c-mutate.py`, with a per-mutant `--include` list of specs (`ng test --include` works). Copy: `scratchpad/luigi-2c-mut/src/web/fireworks-web`.
  - A mutant that fails to compile is not a kill. Fix it: `if (false)` broke narrowing, `Number.NaN > 0` doesn't.
  - Re-check patterns after Prettier reflows a line.
- **Suite:** 309 tests in 25 files, typecheck clean. Initial bundle 282.90 kB, `pixi-renderer` 368.00 kB lazy, `designer-page` 113.65 kB, `status-page` 2.04 kB. A "PixiJS" string appears only in lazy chunks.

### 2026-11-13: Phase 2c fix round (dirty flag, notice hold, status routerLink)
- **Draft is now `{ shell, activeBreak, display, dirty }`.** Baseline, `stateJson` and `DesignerState` are deleted. `readDraft` is fail-safe: only an explicit `false` reads clean (Peach 2c.11, coordinator-settled). Record: `decisions/records/luigi-2c-dirty-flag-and-notice-hold.md`. Superseding note added to `luigi-designer-2c.md` points 1–2.
- **Dirty-flag pattern:** `linkedSignal({ source: [visitor signals], computation: (_, prev) => prev === undefined ? restored : true })`. Clear it with `dirty.set(false)` **after** the load's writes. `linkedSignalSetFn` runs `producerUpdateValueVersion` first, so the writes are absorbed. Clearing before the writes leaves it dirty (mutant D5). To keep the flag across an app write (the notice's Turn on), read it, write, then `set(wasDirty)`.
- **Hold:** the stage's `paused` input skips `loop.frame` (timers frozen) and makes `launch`, `replay` and `fireNow` (fireNow still sets shell and sky) and click no-ops. The page ignores Space while held. Launch and Replay are disabled with the title `PLAYBACK_HELD_TITLE`.
- **Rosalina's §7.2 (2026-11-13) beat the brief's wording:** the Display switch does NOT dismiss the notice. The buttons are `Turn on Reduce flashing` and `Continue` (testid `flash-continue`). There's a mode sentence. The notice focuses its first button if focus is on body; dismiss focuses Launch. Apply's confirm body depends on `hasSky`.
- **DOM order is now stage before panel** (`flex-row-reverse`, `max-[761px]:flex-col`), so the notice is read first. Visual layout is unchanged in the smoke.
- `/status` back link uses `routerLink`. The spec asserts `click.defaultPrevented`, and the smoke counts 0 `load` events.
- Suite 342 tests in 25 files (309 before). Build: initial 291.77 kB, designer-page 114.71 kB, pixi-renderer 368.00 kB, status-page 2.10 kB. Mutants: `scratchpad/luigi-fix-mutate.py` (full suite per mutant, copy at `scratchpad/luigi-fix-mut/`): 32, all killed. D3 (an app write in the constructor before the first read) was equivalent, because the lazy first computation absorbs it, so it was replaced by D3b (an app write after the first read), which was killed. Literal-type mutants (`!== 'timeline'`) fail TS2367. Use `|| true` instead.

### 2026-11-13: §7.2 accessibility correction (panel-first DOM order)
- Rosalina corrected §7.2: **DOM order stays panel, then stage**. My stage-first `flex-row-reverse` from the fix round is withdrawn. The row is now `flex h-full overflow-hidden max-[761px]:flex-col-reverse`, so the stage stays on top when narrow without reordering the DOM. Lesson: don't reorder the DOM to make something read earlier. Use focus and `aria-describedby` instead.
- Flash notice: the copy `<p>` gets `[id]="textId"` from a module counter (`flash-notice-text-N`), and both buttons in both branches get `[attr.aria-describedby]="textId"`. The playback note has testid `playback-note` and reads `Close the flashing notice on the stage to start.` while `paused()`.
- Record item 7 is updated in `decisions/records/luigi-2c-dirty-flag-and-notice-hold.md`. No spec or smoke had asserted stage-first, so nothing needed flipping. The new spec asserts row children `['ASIDE','MAIN']`.
- Mutants: `scratchpad/luigi-a11y-mutate.py` (page spec only, copy at `scratchpad/luigi-a11y-mut/`). All 10 killed. Mutants for block moves are built from the template by slicing (aside and main, stage and notice) so they don't depend on line-exact patterns.
- Smoke: `scratchpad/smoke/luigi-a11y-smoke.mjs <wwwroot>` (the build outputs to `src/api/Fireworks.Api/wwwroot`, not `dist`). In `luigi-2c-fix-smoke.mjs`, `focusAfterDismiss` is read in the same tick as the click, before the `afterNextRender` focus, so it reports `flash-continue`. Wait about 300 ms and it reads `launch`.
- Suite: 347 tests in 25 files. Build: initial 291.78 kB, designer-page 115.10 kB.

### 2026-11-13: Two dirty flags (shell, sky) and the BindGroup teardown warning
- **Skyler's ruling:** a preset or Apply asks only when it would replace a visitor change. Draft is now `{ shell, activeBreak, display, shellDirty, skyDirty }`. `readFlag` falls back to a legacy `dirty` only when the new key is absent. Addendum in `decisions/records/luigi-2c-dirty-flag-and-notice-hold.md`.
- **Source by reference, not by value.** A `JSON.stringify` computed source looks neat but loses a set-back with no read in between (blue then red stays "equal", so not dirty). Use the model's sub-objects by reference: Signal Forms keeps untouched branches' identity. Since `load()` does `structuredClone`, a kept sky gets a new reference, so read `skyDirty` before the writes and set it back after.
- **Pixi teardown order:** the ParticleContainer pipe's shared `defaultShader` keeps `uTexture` bound until the renderer dies, so the glow texture must be destroyed after `app.destroy`. Smoke: `scratchpad/smoke/luigi-teardown-smoke.mjs <wwwroot>` (client-side nav to `/status` via pushState + popstate, back via `back-to-designer`, counts BindGroup warnings and leftover canvases): 3 before, 0 after.
- **Node:** `~/.nvm/versions/node/v26.5.0/bin` must be prepended to PATH by hand. The shell default is v21.5.0, and `ng` refuses it.
- Mutants: `scratchpad/luigi-split-mutate.py` (copy at `scratchpad/luigi-split-mut/fireworks-web`, node_modules symlinked, three designer specs via `--include`).
- Suite 363 tests in 25 files. Build: initial 291.78 kB, designer-page 115.65 kB, pixi-renderer 368.00 kB.

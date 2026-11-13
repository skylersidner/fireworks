# Luigi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase 2 is done (`b3039e6`). Next: Phase 5 (save, share, player, My creations) and Phase 6 (Show Builder UI).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from early learnings (Phase 0 to 1, summarized 2026-11-13)

- **Rulings:** `session.canWrite` comes from `api/me` and hides write controls when false (OQ20). Angular dev server stays on port 4200 (OQ12). Signal Forms on Angular 22.2.x (OQ17, Skyler's ruling; stable in 22.x, `@publicApi 22.0`, so the spike wasn't needed).
- **Toolchain:** Node 26.5.0 via nvm. Run `export PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"` before every npm or ng command; the shell default (21.5.0) is rejected. npm 11.17.0, Angular CLI 22.2.7, framework 22.2.6, TypeScript 6.0.3, Vitest 5.1.0, jsdom 30.1.3, Tailwind 4.3.5, pixi.js 8.23.0. Every direct dependency is pinned, with no caret. Zoneless is the default; no zone.js.
- **Config:** the root `tsconfig.json` is solution-style (`files: []`), so `tsc -p` exits 0 on a type error. Typecheck the app and spec configs separately. `tsconfig.spec.json` keeps `outDir: ./out-tsc/spec`. npm 11.17 `allowScripts` approves @parcel/watcher, esbuild, lmdb and msgpackr-extract. Re-run `npm approve-scripts --allow-scripts-pending` after a bump. `@xmldom/xmldom` is in `allowedCommonJsDependencies`.
- **Build output:** `--stats-json` writes `browser-stats.json` into wwwroot, which is served publicly. Delete it after analysis. Rule: never ship a stats build (not yet enforced by the Dockerfile; Scribe flagged it).
- **Pixi loading:** the lazy-load pattern is an InjectionToken whose default dynamically imports the Pixi file, and specs inject a fake. Pixi stays its own chunk; specs never load Pixi or need WebGL. Skill: `.squad/skills/pixi-host-lifecycle/SKILL.md`. Phase 2 uses `STAGE_RENDERER_FACTORY`.
- **Renderer honesty:** a string `preference: 'webgl'` falls through webgl, then webgpu, then canvas, and canvas always succeeds. "Running" doesn't prove WebGL. Read `app.renderer.name` and surface it (`data-renderer`). Headless check: `.squad/skills/headless-webgl-smoke/SKILL.md`.
- **Pixi destroy:** `app.destroy({ removeView: true }, { children, texture, textureSource })` releases the context. Off-stage containers (`worldRoot`, the trail fade root) are not destroyed by `app.destroy`; destroy them first.
- **Session:** `core/session.ts` loads `api/me` from an initializer that doesn't block first render. `canWrite` is `user?.canWrite === true`, false until loaded and after a failure. `MeResponse` fields are nullable.
- **Self-handled requests:** `isSelfHandledRequest` matches the exact path (scheme and host stripped, `?` and `#` cut) against a Set. With a path-prefixed `apiBaseUrl`, the entries need the prefix. Spec: `core/self-handled-request.spec.ts`.
- **Tokens:** templates use semantic token names (`--color-success`, `--color-toast-*`). Rosalina retunes values in `styles.css`, so don't hard-code colors.
- **Mutants:** rsync the web tree to the scratchpad at `…/mut/src/web/fireworks-web` and symlink node_modules. The `src/web` depth keeps `outputPath ../../api/...` inside the scratchpad.

## Learnings

### 2026-11-12: Phase 2a/2b, engine port and fireworks-stage
- **Engine layout:** `src/engine/model/*`, `sim/*` plus `sim/golden/`, `loop/*`, and `render/*` (only `render/{glow-texture,skyline,trail-buffer,pixi-renderer}.ts` import pixi). `render/stage-renderer`, `coordinates` and `visual-rules` are pure and specced without a DOM.
- **Goldens:** `sim/golden/record-prototype-golden.mjs` writes `prototype-golden.ts` from the prototype. Skill: `.squad/skills/prototype-oracle-golden/SKILL.md`. Steps 360 and 450 were added to 60 and 240 (the rise ends near 300). Re-run only when the prototype changes.
- **Specs:** `// @vitest-environment node` works under `@angular/build:unit-test`. The boundary spec reads files through `process.getBuiltinModule('node:fs')`.
- **Contract:** `StageRenderer` is `start(onFrame)`, `render`, `screenToWorld`, `worldWidth`, `name`, `trailFormat`, `destroy`. Token `STAGE_RENDERER_FACTORY`; fake `app/testing/fake-stage-renderer.ts`. The canary was deleted, not moved.
- **Pixi gotchas:** `RenderTexture.create` never throws, so check `webGLVersion === 2` plus a float extension (WebGPU is always fine). Tint cache as `Uint32Array` per live slot is exact.
- **Mutants:** 17, all killed. The crossette gen guard is unreachable in playback, so only the gen-1 unit spec kills its mutant.

### 2026-11-12: Phase 2c, Shell Designer
- **Files:** `features/designer/pages/designer-page/` (page and `shell-designer.store.ts`); `features/designer/shared/*` (components, `designer-draft.ts`, `designer-copy.ts`, `formats.ts`); `app/shared/{range-row,select-row,confirm-dialog}.ts`; `core/{api-status,browser}.ts`; `engine/model/{labels,freeze}.ts`; `pages/status/` (replaced `pages/home`).
- **Signal Forms gotchas** (skill: `.squad/skills/signal-forms-custom-controls/SKILL.md`):
  - The directive is `[formField]` (`FormField`, from `@angular/forms/signals`).
  - FormField owns `min`, `max`, `maxlength` and more. `[attr.maxlength]` beside `[formField]` is compile error NG8022, so use `maxLength(p.name, 80)` in the schema.
  - Custom controls must not declare inputs named `min`, `max`, `name` or `disabled` unless they mean the field state. `range-row` takes one `range` input.
  - `disabled(b.changeAt, ({ valueOf }) => valueOf(b.color2) === 'none')` inside `applyEach` feeds the control's `disabled` input.
  - A generic `SelectRowComponent<T>` with `model.required<T>()` type-checks against `FieldTree<Pattern>`.
- **Store pattern:** `model` is the form's raw model and is never rewritten, so no field fights the user. `shell` is a `linkedSignal` of normalize(model) that keeps the last good value. The draft is an effect with a 300 ms debounce, compared to the last write, and flushed on `pagehide` and DestroyRef. Notes are keyed by (shellJson, edits), so any edit clears them without an effect.
- **Stage host sizing:** `class="absolute inset-0"` on `app-fireworks-stage` loses to its own `:host { position: relative }`, and the stage renders 0 px tall. Use `h-full w-full`. Only the real-browser smoke caught it.
- **Stage additions:** `fireNow(shell, sky)` sets `loop.shell` and `sim.sky` synchronously before launching, since input effects only run at the next change detection. Reduce flashing is flipped on the running `RandomShowDriver`, not by recreating it, so the timer doesn't reset.
- **Machine load:** timeouts under parallel runs with no assertion failures. Check `sysctl -n vm.loadavg` first.
- **Mutants:** a mutant that fails to compile is not a kill. Use `|| true`, not a literal-type mutant (TS2367).

### 2026-11-13: Phase 2c fix round (dirty flag, notice hold, status routerLink)
- Draft layout and dirty flag: see the Addendum in `decisions/records/luigi-2c-dirty-flag-and-notice-hold.md`. The baseline, `stateJson` and `DesignerState` were deleted. `readDraft` is fail-safe: only an explicit `false` reads clean.
- **Dirty-flag pattern:** `linkedSignal({ source: [visitor signals], computation: (_, prev) => prev === undefined ? restored : true })`. Clear it with `dirty.set(false)` after the load's writes, because `linkedSignalSetFn` absorbs writes that happen first. Clearing before the writes leaves it dirty (mutant D5). To keep the flag across an app write, read it, write, then `set(wasDirty)`.
- **Hold:** the stage's `paused` input skips `loop.frame` (timers frozen). `launch`, `replay` and `fireNow` (which still sets shell and sky) and clicks are no-ops. The page ignores Space while held. Launch and Replay are disabled with the title `PLAYBACK_HELD_TITLE`.
- **Rosalina's §7.2 beat the brief's wording:** the Display switch does NOT dismiss the notice. Buttons are `Turn on Reduce flashing` and `Continue` (testid `flash-continue`). The notice focuses its first button only if focus is on body; dismiss focuses Launch.
- `/status` back link uses `routerLink`. The spec asserts `click.defaultPrevented`.
- Mutant D3 (an app write in the constructor before the first read) was equivalent, since the lazy first computation absorbs it. It was replaced by D3b (an app write after the first read), which was killed.

### 2026-11-13: §7.2 accessibility correction (panel-first DOM order)
- Rosalina corrected §7.2: **DOM order stays panel, then stage**, as in the prototype. My stage-first `flex-row-reverse` was withdrawn. The row is now `flex h-full overflow-hidden max-[761px]:flex-col-reverse`, so the stage stays on top when narrow.
- Lesson: don't reorder the DOM to make something read earlier. Use focus and `aria-describedby` instead. The notice copy `<p>` gets `[id]="textId"` from a module counter (`flash-notice-text-N`). Both buttons get `[attr.aria-describedby]="textId"`. The playback note (testid `playback-note`) reads `Close the flashing notice on the stage to start.` while `paused()`.
- The new spec asserts row children `['ASIDE','MAIN']`. Mutants: `scratchpad/luigi-a11y-mutate.py`, all 10 killed.

### 2026-11-13: Two dirty flags (shell, sky) and the BindGroup teardown warning
- **Skyler's ruling:** a preset or Apply asks only when it would replace a visitor change. The draft is `{ shell, activeBreak, display, shellDirty, skyDirty }`. `readFlag` falls back to a legacy `dirty` only when the new key is absent. Addendum: `decisions/records/luigi-2c-dirty-flag-and-notice-hold.md`.
- **Source by reference, not by value.** A `JSON.stringify` computed source loses a set-back with no read in between. Use the model's sub-objects by reference: Signal Forms keeps untouched branches' identity. `load()` runs `structuredClone`, so a kept sky gets a new reference. Read `skyDirty` before the writes and set it back after.
- **Pixi teardown order:** the ParticleContainer pipe's shared `defaultShader` keeps `uTexture` bound until the renderer dies. Destroy the glow texture after `app.destroy`. Smoke: `scratchpad/smoke/luigi-teardown-smoke.mjs <wwwroot>`. It counts BindGroup warnings across `/status` round trips: 3 before, 0 after.
- Suite: 363 tests in 25 files. Build: initial 291.78 kB, designer-page 115.65 kB, pixi-renderer 368.00 kB.
- Mutants: `scratchpad/luigi-split-mutate.py`, with three designer specs via `--include`.

### 2026-11-13 — Phase 2 cross-agent update (Scribe)
- Phase 3: the schema doc (Yoshi) is the authority for the validator shape. Your `ShellIssue.code` is open for it. Don't extend `ShellIssue` further until Yoshi rules.
- Rosalina's `designer-2c.md` §6.4 still describes one `dirty` flag (l.403 to 427), and l.464 wrongly says display and tab set dirty. Your shell and sky split is the rule. Check the addendum before copying §6.4's wording.
- Mario's gate passed with notes. Firefox and Safari parity wait for Railway; your smoke scripts are the reference for that pass.
- Toad verified the BindGroup warning fix (3 to 0).

### 2026-11-13: Phase 3, TypeScript validator
- **Files:** `engine/model/{normalize,validate,upgrade,show,limits}.ts`; specs `validate.spec.ts`, `limits.spec.ts`, `schema-fixtures.spec.ts` (mine) beside Toad's `schema-fixtures-format.spec.ts`. Fixtures at repo-root `schema/fixtures/**`, read via `process.getBuiltinModule('node:fs')` at `${process.cwd()}/../../../schema` (cwd is the workspace under `@angular/build:unit-test`; no config change needed).
- **Walker:** one `walkShell(input, prefix, report, keys)` serves root shells and embedded shells (`shells.<key>`, keys without `sky`, so an embedded `sky` is `dropped`). `NormalizeResult`'s failure branch now carries `adjustments` too; `validate.ts` = errors ∪ adjustments mapped by `STRICT_CODE`. Show fields with no default use a `REQUIRED` sentinel in `num()` → hard `missing`.
- **Trap:** the Write tool turned ` `-style escapes in my content into the literal characters (and broke a regex across lines). For code with Unicode escapes, write the escape text via Python (`'\\'+'u'+hex`) and grep for non-ASCII afterwards.
- **Mutants (scratchpad `mut/`, also copy `schema/` and `docs/fireworks-app` to the scratch root):** 16 run, 15 killed; "trim via String.trim" survives because JS's trim set equals the explicit set (equivalent in JS; it matters only for C#). Seed-rounding and duplicate-id-at-first mutants are killed only by my unit spec / the 1000-cue valid fixture, not by a targeted invalid fixture.
- `issueReason` has a `default` placeholder for the new codes until Rosalina writes copy; `appliedNote` stays silent on `cleaned`.

### 2026-11-13: Phase 3 follow-up (rule 11 paths, settlements, lenient specs)
- **`childPath(parent, name)`** (exported from `engine/model/normalize.ts`) is the one place a property name enters a path: `walkShell`'s `at()`, `shells.<key>`, and `dropUnknown`. Plain `^[A-Za-z_][A-Za-z0-9_-]*$` → `parent.name` (no dot at the root); else `parent["name"]`, escaping only `\` and `"`, lone surrogates → U+FFFD. Built with `String.fromCharCode(0xfffd)` to dodge the Write-tool escape trap.
- Settlements in §6.2 rules 7–13 already matched the walker; new specs pin them (`validate.spec.ts` "show walk settlements"). §12.5 lenient specs live in `normalize.spec.ts`.
- **Fixture runner** (`schema-fixtures.spec.ts`) now records a `loadError` per malformed fixture (bad JSON, non-object, folder/kind mismatch, invalid without `errors`) and that fixture's own test fails; verified by injecting two broken files in the scratchpad copy.
- Mutants: `scratchpad/luigi-rule11-mutate.py <mut root>`, 14 run, 13 killed. "Failed id joins seenIds" survives and is equivalent: a key-format-failing id can only collide with another key-format-failing id, which hits key-format first.
- Suite after Toad's new fixtures: 953 tests in 29 files.

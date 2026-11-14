# Luigi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0–3 are done (`b3039e6` Phase 2, `cb0f0ff` Phase 3). Next: Phase 5 (save, share, player, My creations) and Phase 6 (Show Builder UI).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from early learnings (Phase 0 to 1, summarized 2026-11-13)

- **Rulings:** `session.canWrite` comes from `api/me` and hides write controls when false (OQ20). Angular dev server stays on port 4200 (OQ12). Signal Forms on Angular 22.2.x (OQ17).
- **Toolchain:** Node 26.5.0 via nvm. Run `export PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"` before every npm or ng command; the shell default (21.5.0) is rejected. Every direct dependency is pinned, with no caret. Zoneless; no zone.js.
- **Config:** the root `tsconfig.json` is solution-style (`files: []`), so `tsc -p` exits 0 on a type error. Typecheck the app and spec configs separately. npm 11.17 `allowScripts`: re-run `npm approve-scripts --allow-scripts-pending` after a bump.
- **Build output:** never ship a `--stats-json` build; `browser-stats.json` in wwwroot is served publicly (not yet enforced by the Dockerfile).
- **Pixi:** lazy-load through an InjectionToken whose default dynamically imports the Pixi file; specs inject a fake (`STAGE_RENDERER_FACTORY` in Phase 2). A string `preference: 'webgl'` falls through to canvas, so "running" doesn't prove WebGL; read `app.renderer.name` (`data-renderer`). Skills: `.squad/skills/pixi-host-lifecycle/SKILL.md`, `.squad/skills/headless-webgl-smoke/SKILL.md`. Destroy with `app.destroy({ removeView: true }, { children, texture, textureSource })`; destroy off-stage containers (`worldRoot`, the trail fade root) first.
- **Session:** `core/session.ts` loads `api/me` from an initializer that doesn't block first render. `canWrite` is `user?.canWrite === true`, false until loaded and after a failure.
- **Self-handled requests:** `isSelfHandledRequest` matches the exact path against a Set (spec `core/self-handled-request.spec.ts`). With a path-prefixed `apiBaseUrl`, the entries need the prefix.
- **Tokens:** templates use semantic token names (`--color-success`, `--color-toast-*`); Rosalina retunes values in `styles.css`. Don't hard-code colors.
- **Mutants:** rsync the web tree to the scratchpad at `…/mut/src/web/fireworks-web` and symlink node_modules, so `outputPath ../../api/...` stays inside the scratchpad.

### Folded from Phase 2 (summarized 2026-11-13)

- **Engine layout:** `src/engine/model/*`, `sim/*` (plus `sim/golden/`), `loop/*`, `render/*`. Only `render/{glow-texture,skyline,trail-buffer,pixi-renderer}.ts` import pixi; `stage-renderer`, `coordinates` and `visual-rules` are pure. `// @vitest-environment node` works under `@angular/build:unit-test`.
- **Goldens:** `sim/golden/record-prototype-golden.mjs` writes `prototype-golden.ts` from the prototype (skill `.squad/skills/prototype-oracle-golden/SKILL.md`). Re-run only when the prototype changes. `StageRenderer` is `start(onFrame)`, `render`, `screenToWorld`, `worldWidth`, `name`, `trailFormat`, `destroy`; the fake is `app/testing/fake-stage-renderer.ts`.
- **Pixi:** `RenderTexture.create` never throws, so check `webGLVersion === 2` plus a float extension. Destroy the glow texture after `app.destroy`: the ParticleContainer pipe's shared `defaultShader` keeps `uTexture` bound (BindGroup warnings 3 to 0; smoke `scratchpad/smoke/luigi-teardown-smoke.mjs <wwwroot>`).
- **Designer files:** `features/designer/pages/designer-page/` (page, `shell-designer.store.ts`); `features/designer/shared/*` (components, `designer-draft.ts`, `designer-copy.ts`, `formats.ts`); `app/shared/{range-row,select-row,confirm-dialog}.ts`; `core/{api-status,browser}.ts`; `pages/status/`.
- **Signal Forms** (skill `.squad/skills/signal-forms-custom-controls/SKILL.md`): `[formField]`; FormField owns `min`, `max`, `maxlength` (`[attr.maxlength]` beside it is NG8022, so use `maxLength(p.name, 80)`); custom controls must not declare inputs named `min`, `max`, `name` or `disabled`.
- **Store:** `model` is the raw form model and is never rewritten. `shell` is a `linkedSignal` of normalize(model) that keeps the last good value. The draft is an effect with a 300 ms debounce, flushed on `pagehide` and DestroyRef.
- **Stage host:** use `h-full w-full` on `app-fireworks-stage`; `absolute inset-0` loses to the host's `position: relative`. `fireNow` sets `loop.shell` and `sim.sky` synchronously. Reduce flashing flips the running `RandomShowDriver`; don't recreate it.
- **Dirty flags (Skyler's ruling; record `.squad/decisions/records/luigi-2c-dirty-flag-and-notice-hold.md`):** the draft is `{ shell, activeBreak, display, shellDirty, skyDirty }`. A preset or Apply asks only when it would replace a visitor change. `readDraft` is fail-safe (only an explicit `false` reads clean). Clear a `linkedSignal` flag with `set(false)` after the load's writes. Use sources by reference, never `JSON.stringify`; `load()` runs `structuredClone`, so read `skyDirty` before the writes and set it back after.
- **Hold and notice:** the stage's `paused` input skips `loop.frame`; launch, replay, fireNow and clicks are no-ops; Launch and Replay carry `PLAYBACK_HELD_TITLE`. Buttons are `Turn on Reduce flashing` and `Continue` (`flash-continue`). The Display switch doesn't dismiss. Don't reorder the DOM for reading order; use `aria-describedby` and focus (Rosalina's §7.2: panel, then stage).
- **Mutants:** a mutant that doesn't compile is not a kill (use `|| true`). Check load (`sysctl -n vm.loadavg`) before trusting a timeout.
- **Open:** Rosalina's `docs/fireworks-app/design/designer-2c.md` §6.4 still describes one `dirty` flag (l.403–427, l.464). The shell and sky split is the rule.

## Learnings

### 2026-11-13: Phase 3, TypeScript validator
- **Files:** `engine/model/{normalize,validate,upgrade,show,limits}.ts`; specs `validate.spec.ts`, `limits.spec.ts`, `schema-fixtures.spec.ts` (mine) beside Toad's `schema-fixtures-format.spec.ts`. Fixtures at repo-root `schema/fixtures/**`, read via `process.getBuiltinModule('node:fs')` at `${process.cwd()}/../../../schema`.
- **Walker:** one `walkShell(input, prefix, report, keys)` serves root shells and embedded shells (`shells.<key>`, keys without `sky`, so an embedded `sky` is `dropped`). `NormalizeResult`'s failure branch carries `adjustments` too; `validate.ts` = errors ∪ adjustments mapped by `STRICT_CODE`. Show fields with no default use a `REQUIRED` sentinel in `num()`, giving a hard `missing`.
- **Trap:** the Write tool turns `\uXXXX`-style escapes into literal characters. Write escape text via Python and grep for non-ASCII afterwards.
- **Mutants:** 16 run, 15 killed; "trim via String.trim" survives because JS's trim set equals the explicit set (it matters only for C#).
- `issueReason` has a `default` placeholder for the new codes until Rosalina writes copy; `appliedNote` stays silent on `cleaned`.

### 2026-11-13: Phase 3 follow-up (rule 11 paths, settlements, lenient specs)
- **`childPath(parent, name)`** (exported from `engine/model/normalize.ts`) is the one place a property name enters a path: `walkShell`'s `at()`, `shells.<key>`, and `dropUnknown`. Plain `^[A-Za-z_][A-Za-z0-9_-]*$` gives `parent.name` (no dot at the root); otherwise `parent["name"]`, escaping only `\` and `"`, with lone surrogates as U+FFFD. Build U+FFFD with `String.fromCharCode(0xfffd)`.
- Settlements in §6.2 rules 7–13 already matched the walker; `validate.spec.ts` "show walk settlements" pins them. §12.5 lenient specs live in `normalize.spec.ts` (`describe('property names in paths (schema.md §6.2 rule 11)')` is the rule-11 list that Bowser's C# must match).
- **Fixture runner** (`schema-fixtures.spec.ts`) records a `loadError` per malformed fixture, and that fixture's own test fails.
- Mutants: `scratchpad/luigi-rule11-mutate.py <mut root>`, 14 run, 13 killed. "Failed id joins seenIds" is equivalent: a key-format-failing id can only collide with another, which hits key-format first.
- Suite after Toad's new fixtures: 953 tests in 29 files.

### 2026-11-13 — Phase 3 cross-agent update (Scribe)
- **`ShellIssue.code` is in the contract** (schema.md §6.3). `path` and `code` are the contract; `message` is developer-facing, and UIs build copy from `code`.
- **F11 (Peach, yours):** `issueReason` renders a `type` issue with `options: ['integer']` (cue `seed`, `normalize.ts` l.566) as "must be text". Unreachable from the shell designer today; a show Apply reaches it. Fix by Phase 6 at the latest.
- **Upgrade wiring, Phase 5 (F6/F14; schema.md §8.3):** `readDraft` and `applyJson` call no `upgradeShell` today. Wire it into both, with the player's load path, in the order `upgrade → normalize`. Harmless while v1 is the only version.
- **`/c/:code` is the only editing link (schema.md §11; Yoshi L1):** it loads a dirty working copy, then redirects to the editor with `replaceUrl`, so the draft carries the copy across reloads. The player's Remix and My creations' Open go there. `/shows/:code/edit` is gone. The draft gets `source: { shareCode, kind, isOwner, updatedAt } | null`, set only by a link load or a successful save. Link-over-dirty asks first only when shell or sky is dirty (L3). Save on an owned source offers Update original (PUT) or Save as new (POST `…/remix`).
- **Show length (L4; Yoshi addendum 2, point 6):** `duration` never gates firing. The Phase 6 `TimelineDriver` runs until the last cue has fired and no particle is live. A cue past a clamped `duration` fires at its `t`; don't stop playback at `duration`.

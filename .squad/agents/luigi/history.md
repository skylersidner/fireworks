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
- **Pixi:** lazy-load through an InjectionToken (`STAGE_RENDERER_FACTORY` in specs). A string `preference: 'webgl'` falls through to canvas, so read `app.renderer.name`. Skills: `.squad/skills/pixi-host-lifecycle/SKILL.md`, `.squad/skills/headless-webgl-smoke/SKILL.md`. Destroy with `app.destroy({ removeView: true }, {...})`, and destroy off-stage containers first.
- **Session:** `core/session.ts` loads `api/me` from an initializer that doesn't block first render. `canWrite` is `user?.canWrite === true`, false until loaded and after a failure.
- **Self-handled requests:** `isSelfHandledRequest` matches the exact path against a Set (spec `core/self-handled-request.spec.ts`). With a path-prefixed `apiBaseUrl`, the entries need the prefix.
- **Tokens:** templates use semantic token names (`--color-success`, `--color-toast-*`); Rosalina retunes values in `styles.css`. Don't hard-code colors.
- **Mutants:** rsync the web tree to the scratchpad at `…/mut/src/web/fireworks-web` and symlink node_modules, so `outputPath ../../api/...` stays inside the scratchpad.

### Folded from Phase 2 (summarized 2026-11-13)

- **Engine layout:** `src/engine/model/*`, `sim/*` (plus `sim/golden/`), `loop/*`, `render/*`. Only `render/{glow-texture,skyline,trail-buffer,pixi-renderer}.ts` import pixi; `stage-renderer`, `coordinates` and `visual-rules` are pure. `// @vitest-environment node` works under `@angular/build:unit-test`.
- **Goldens:** `sim/golden/record-prototype-golden.mjs` writes `prototype-golden.ts` (skill `.squad/skills/prototype-oracle-golden/SKILL.md`); re-run only when the prototype changes. `StageRenderer` fake: `app/testing/fake-stage-renderer.ts`.
- **Pixi teardown:** check `webGLVersion === 2` plus a float extension, since `RenderTexture.create` never throws. Destroy the glow texture after `app.destroy` (BindGroup warnings 3 to 0).
- **Designer files:** `features/designer/pages/designer-page/` (page, `shell-designer.store.ts`); `features/designer/shared/*` (components, `designer-draft.ts`, `designer-copy.ts`, `formats.ts`); `app/shared/{range-row,select-row,confirm-dialog}.ts`; `core/{api-status,browser}.ts`; `pages/status/`.
- **Signal Forms** (skill `.squad/skills/signal-forms-custom-controls/SKILL.md`): `[formField]`; FormField owns `min`, `max`, `maxlength` (`[attr.maxlength]` beside it is NG8022, so use `maxLength(p.name, 80)`); custom controls must not declare inputs named `min`, `max`, `name` or `disabled`.
- **Store:** `model` is the raw form model and is never rewritten. `shell` is a `linkedSignal` of normalize(model) that keeps the last good value. The draft is an effect with a 300 ms debounce, flushed on `pagehide` and DestroyRef.
- **Stage host:** use `h-full w-full` on `app-fireworks-stage`; `absolute inset-0` loses to the host's `position: relative`. `fireNow` sets `loop.shell` and `sim.sky` synchronously. Reduce flashing flips the running `RandomShowDriver`; don't recreate it.
- **Dirty flags (Skyler's ruling; `luigi-2c-dirty-flag-and-notice-hold.md`):** draft is `{ shell, activeBreak, display, shellDirty, skyDirty }`. A preset or Apply asks only when it would replace a visitor change. `readDraft` is fail-safe (only an explicit `false` reads clean). Use sources by reference, never `JSON.stringify`; read `skyDirty` before `load()`'s `structuredClone` writes.
- **Hold and notice:** the stage's `paused` input skips `loop.frame`; launch, replay and clicks are no-ops. Buttons are `Turn on Reduce flashing` and `Continue`. The Display switch doesn't dismiss. Keep the panel-first DOM and use `aria-describedby` (Rosalina §7.2).
- **Mutants:** a mutant that doesn't compile is not a kill (use `|| true`). Check load (`sysctl -n vm.loadavg`) before trusting a timeout.
- **Resolved in Phase 5:** `designer-2c.md` §6.4 now follows the shell and sky split (Rosalina).

### Folded from Phase 3 and Phase 4 (summarized 2026-11-14)

- **Validator walk:** one `walkShell(input, prefix, report, keys)` in `engine/model/normalize.ts`. `validate.ts` maps adjustments to codes 1:1 (`defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, `cleaned`→`name-format`). `ShellIssue.code` is contract (schema.md §6.3); copy is built from `code`.
- **Property names in paths (rule 11):** `childPath(parent, name)` in `normalize.ts` is the one entry point. Plain names give `parent.name`; others give `parent["name"]`, with `\` and `"` escaped and lone surrogates as U+FFFD. The rule-11 list in `normalize.spec.ts` is what Bowser's C# matches.
- **Fixtures:** `schema-fixtures.spec.ts` runs the fixtures at repo-root `schema/fixtures/**` (read via `process.getBuiltinModule('node:fs')`). A bad fixture fails its own test. Toad's `schema-fixtures-format.spec.ts` checks their shape.
- **Wire contract (Phase 4):** compact `JSON.stringify` on every save (pretty output reaches 290 KB). Read `truncated` on every 400. Compare `updatedAt` as an opaque string. No GET-before-PUT check (`If-Match` → 412 later). An Update original 404 falls back to a plain `POST`, never `…/remix`. Compare round trips as parsed values (`jsonb` drops key order). A 413 may reach the client as status 0 through Railway (Boo S5).
- **Show length (L4):** `duration` never gates firing. The Phase 6 `TimelineDriver` runs until the last cue has fired and no particle is live.
- **Editor traps:** the Write tool turns `\uXXXX` escapes and `“` into literal characters. Write escapes through Python and grep for non-ASCII afterwards. Prettier reflows lines, so a mutant's `old` string must come from the formatted file. A mutant that does not compile is not a kill.

### Folded from Phase 5 batch 1 (summarized 2026-11-14)

- **Files:** `core/models.ts` (Creation* mirrors of `Contracts/CreationContracts.cs`, `ValidationErrorResponse`), `core/creations.ts` (`CreationsService`; `toCreationError` keys on status only), `core/share-code.ts` (pure `isShareCode`), `core/creation-save.ts` (`saveChoices`, `planSave`, `fallbackPlan`, `sourceFrom`, `saveCreation`, which returns outcome values and never errors), `engine/model/open.ts` (`openShell`/`openShow`, upgrade then normalize). Record `luigi-phase5-client-foundation.md`.
- **Wire facts:** 400 is `{message, errors, truncated}` or just `{message}`. 413 and 415 are problem+json with no errors. The 404 body is fixed. 429 `Retry-After` is rounded up. PUT and remix bodies are `{document}` only.
- **Traps:** every creation call suppresses the generic toast. Ledger specs use a recorder interceptor and an exact `METHOD url` list. Base58 includes `K`, and the Kelvin sign U+212A is the look-alike to test. Upgrade and normalize reject the same versions in v1, so `designer-structure.spec.ts` pins the `openShell` calls.
- **Mutant trap:** the scratch tree needs repo-root `docs/` and `schema/` too (`limits.spec.ts` reads schema.md). Run the baseline green first.

## Learnings

### 2026-11-14: Phase 5 batch 2, Save, Share, player, `/c/:code`, `/mine`
- **Files:** `core/{device-preferences,open-creation}.ts`; `features/designer/pages/designer-page/designer-save.ts` (`DesignerSaveFlow`), `pages/open-link-page/open-link-page.ts`, `features/designer/shared/{save-bar,save-status,save-copy,working-copy-handoff}`; `features/player/*`; `features/mine/pages/mine-page/*`; `app/shared/{test-mode-banner,link-copy,message-page,fireworks-stage}` (stage moved here); `pages/link-not-found/`; `app/unsafe-sinks.spec.ts`. Record `luigi-phase5-save-share-player.md` (holds the 2c.8 rule and its replacement).
- **F4:** `saved` is a `linkedSignal` over `[shellPart, skyPart]`, persisted in the draft, true only when explicitly true. `completeSave(source, snapshot)` clears flags only if the parts are the objects that were sent.
- **Contract:** `fallbackPlan` retries only after a remix 404. A PUT 404 asks and sets `source` to null, as does a remix 404. A response share code that fails the pattern is `unexpected`.
- **Router reuse:** `/c/a` to `/c/b` reuses the component, so link pages subscribe to `paramMap`. The C12 spec found this.
- **Traps:** a spec with its own `withInterceptors([recorder])` doesn't install `httpErrorInterceptor`, so "no generic toast" passes vacuously. The Write tool turns `“` into a literal quote inside Angular templates; keep such strings in TS.
- Suite 1227 in 39 files. Mutants 18 applied, 17 killed. Running-app Done-when 31/31 (`scratchpad/smoke/luigi-p5-donewhen.mjs`).

### 2026-11-14: Phase 5 review-fix
- **Fixed:** `/mine` focuses its h1 on load (D1) and the blocked-share field (D2); `.btn[aria-disabled='true']` gets cursor and no hover (D3; `shared/button-styles.spec.ts`); the centered line follows `reduceFlashing()` (S1, `CENTER_LINE*` in `player-page.ts`); names isolated with FSI/PDI in `app/shared/bidi.ts` `isolate()` (C3); `readSource(value, expected)`, and `saving` set only after `saveCreation` plans.
- **2c.8 final form:** `luigi-phase5-save-share-player.md` point 2a (derived banned set, exact file to hit-label map).
- **Traps:** a node-env spec with no imports is a global script, so add `export {};` (TS2451). `kind !== expected` doesn't narrow `unknown`. `saveCreation` throws synchronously from `planSave`, so set state after building it. Mutants: `scratchpad/luigi-p5fix-mutate.py <mut root>` (copy `docs/` and `schema/` too).

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **F11 conflict:** Peach's acceptance (5h) closes F11, and the code has the integer wording (`designer-copy.ts`). Mario's gate lists it as carried to Phase 6. Peach and Mario to reconcile; no code change is asked of you.
- **Index row:** README §5 says Save as new is a remix. After a PUT 404 it is a plain POST (§11.2). Your code follows the schema; the row is incomplete.
- **Stale smoke script:** Mario's `luigi-p5-donewhen.mjs` doesn't strip U+2068/U+2069 in titles and needs `window.ng` (dev only). Update it if you keep using it.
- **Boo C17:** re-check the final banner copy (`TEST_MODE_TEXT`); no re-check is recorded yet.

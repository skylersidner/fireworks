# Luigi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells, and shows since Phase 6. Owner: Skyler Sidner.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway (deferred, [R]).
- **Plan:** `plans/initial-implementation.md`, Phases 0–8. Identity model in §3.4. **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (mirror structure, never its domain). **Prototype:** `prototypes/fireworks-prototype.html` (parity oracle).
- **Your focus here:** Phases 0 to 8 are built. Phase 8 client sign-in (B2) is built and was revised by Bowser's fix round. Open: N1 (`signedInWith` typing); the G2 draft-bytes spec, if Skyler approves G2; the coarse-pointer warm-up memory clamp (trigger `ClientPlayback__CheckpointMemoryMiB` above 128); the kill-count correction in `luigi-interlude-spec-split.md` (Toad's F4).
- Carried over: the role only. Standing lessons are in `.squad/decisions/README.md`.

### Folded from Phases 0 to 4 (summarized 2026-11-13 and 2026-11-14, compacted 2026-11-15)

- **Rulings and toolchain:** `session.canWrite` comes from `api/me` and hides write controls when false (OQ20). Dev server on 4200 (OQ12). Signal Forms on Angular 22.2.x (OQ17). Node 26.5.0: `export PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"` before every npm or ng command. Dependencies are pinned, with no caret; zoneless. The root `tsconfig.json` is solution-style, so typecheck the app and spec configs separately. Never ship a `--stats-json` build (`browser-stats.json` is served publicly).
- **Session and requests:** `core/session.ts` loads `api/me` from a non-blocking initializer. `isSelfHandledRequest` matches exact paths in a Set. Use semantic tokens (`--color-success`, `--color-toast-*`); don't hard-code colors.
- **Pixi:** lazy-load through `STAGE_RENDERER_FACTORY`. A string `preference: 'webgl'` falls back to canvas: read `app.renderer.name` and `webGLVersion === 2`. Destroy with `app.destroy({ removeView: true }, {...})`, off-stage containers first. Skills `pixi-host-lifecycle`, `headless-webgl-smoke`.
- **Engine and designer:** only `render/{glow-texture,skyline,trail-buffer,pixi-renderer}.ts` import pixi. Goldens: `sim/golden/record-prototype-golden.mjs` (skill `prototype-oracle-golden`). Fake renderer: `app/testing/fake-stage-renderer.ts`. The designer model is the raw form model; `shell` is a `linkedSignal` of normalize(model). Dirty is by reference, never `JSON.stringify`. Signal Forms: `[formField]`; custom controls must not declare inputs `min`, `max`, `name` or `disabled`.
- **Validator and wire:** `walkShell` in `engine/model/normalize.ts`; `validate.ts` maps adjustments 1:1 (`defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, `cleaned`→`name-format`). `ShellIssue.code` is contract (schema.md §6.3). Save with compact `JSON.stringify`; read `truncated` on every 400; compare round trips as parsed values.
- **Mutants and editing:** a mutant that doesn't compile is not a kill. Check `sysctl -n vm.loadavg` before trusting a timeout. The Write tool turns `\uXXXX` into literal characters: write escapes via Python and grep for non-ASCII. Prettier reflows lines, so a mutant's `old` string comes from the formatted file.

### Folded from Phase 5 (summarized 2026-11-15)

- **Client foundation:** `core/models.ts`, `core/creations.ts` (`toCreationError` keys on status), `core/share-code.ts`, `core/creation-save.ts` (`planSave`, `fallbackPlan`, `sourceFrom`, `saveCreation`, which never errors), `engine/model/open.ts` (`openShell`/`openShow`: upgrade, then normalize). 400 is `{message, errors, truncated}` or `{message}`; 413 and 415 are problem+json.
- **Save, share, player:** `core/{device-preferences,open-creation}.ts`, `designer-save.ts`, `designer/shared/{save-bar,save-status,save-copy,working-copy-handoff}`, `features/player/*`, `features/mine/*`. `saved` is a `linkedSignal`; `completeSave` clears only the parts sent. `fallbackPlan` retries only after a remix 404. Names are isolated with `isolate()` (C3).
- **Traps:** `/c/a` to `/c/b` reuses the component (subscribe to `paramMap`). A spec with its own `withInterceptors` skips `httpErrorInterceptor`, so a no-toast check passes vacuously.

### Folded from Phase 6 (summarized 2026-11-15)

- **Builder (`luigi-phase6-show-builder.md`):** `features/show/pages/show-builder-page/` (page, `show-builder.store.ts` with no HTTP, `show-save.ts`, `show-library.ts`); `features/show/shared/` (`show-edit.ts`, `show-draft.ts` key `fireworks.showDraft.v1`, `show-copy.ts`, `show-working-copy-handoff.ts`, `timeline/`); `testing/show-fixtures.ts`. One edit path: `edit(next, coalesce)` records Undo (50 steps, session only) and sets `dirty`. Motion blur is `fireworks.motionBlur.v1`. `FlashSpacing` lives in `visual-rules.ts`, renderer-only.
- **Banner and Undo:** `core/api-status.ts` `bannerStatus` is `unavailable` when the `/health/live` probe or `api/me` fails. `FORM_FIELDS` (select, range, checkbox) keep ⌘Z inside the control.
- **Seek and config:** `FireworksStageComponent.seekSlice` runs `TimelineDriver.seek` in chunks until the budget passes on `STAGE_CLOCK`. At 25 ms, the Done-when scrub is 1.4 s and the max show 183 s. Measure on Metal with `GPU=1`; SwiftShader swamps a small budget. `core/client-config.ts` (values, `PLAYBACK_LIMITS`, `clampPlayback`); `core/client-config-loader.ts` is the only HTTP. Drivers read config at construction. `TimelineDriver.inherit` copies `from.cpSteps`.
- **Guard specs pin this code:** `unsafe-sinks.spec.ts` (`SHIPPED_URL_BINDINGS`, 8 navigation calls), `designer-structure.spec.ts` (`showEntryViolations()`), `core/client-config.contract.spec.ts` (`PLAYBACK_LIMITS` against `[Range]`). A new URL binding, navigation call or range changes the ledger in the same change.

### Folded from Phase 7 and the interlude (summarized 2026-11-15 and 2026-11-16)

- **Spec split (`luigi-interlude-spec-split.md`, 2026-11-15):** `*.daily.spec.ts` for timeline-driver (15), stage phase7 (11), the store's 6c.3/6c.4 (2) and the 40k load test (1), all verbatim. Helpers: `engine/loop/testing/timeline-spec-helpers.ts`, `app/testing/scheduled-ledger.ts`, `app/testing/stage-clock.ts` (`provideStepClock`), `shortShow()` in `show-fixtures.ts`. Regular `ng test` 53 s (from 90–126 s). Lessons: cost is particle-steps; a small equivalent must keep the mechanism the mutant needs; fake `setTimeout` only keeps `whenStable` and `RouterTestingHarness` working. Open gaps T22, T23, T32, T35, T36, T38 are candidates for Toad's T3.
- **B2 (`luigi-phase7-client-hardening.md`):** CSP: `pixi.js/unsafe-eval` first in `pixi-renderer.ts` (pinned by `engine-boundary.spec.ts`); `inlineCritical: false` in `angular.json` production. Playwright's `waitForFunction` is blocked by that CSP, so measurement contexts use `bypassCSP: true`. A comment that says `new Function` trips the C1 sink ban. Context loss: `StageRenderer.onContextChange`; statuses `starting|running|lost|failed`; `lostNotice` 1 s; fail at 10 s. DPR: `core/browser.ts` `canvasResolution`. Warm-up: `TimelineDriver.twin()` and `adoptCheckpoints()` share `divergeStep`; skill `checkpoint-warm-up`.
- **B3 (`luigi-phase7-ux-accessibility.md`):** `shared/announcer.ts`; `shared/save-shortcut.ts`; `BannerFocus` and `ToastFocus`. Builder: `historyStep()` for all undo and redo. Touch sizes are raw px (the root font is 13 px; `touch-px-utilities.spec.ts` fails rem coarse utilities). The coarse block is unlayered.
- **Post-gate:** Show JSON Copy writes `jsonValue()`; the Shell JSON note is keyed by `seq`. Guard specs pin `embedded-shell-reads.spec.ts` too.

## Learnings

### 2026-11-16 — Phase 8 B2: client-side sign-in (record `luigi-phase8-client-sign-in.md`)

- **Files:**
  - `core/`: `sign-in.ts` (the only `location.assign`; `isSafeInternalUrl` mirrors `SafeReturnUrl` row for row, including `/%zz`; marker `fireworks.signin.v1`), `auth-interceptor.ts` (401 → one `load()`, never retries; `isSignedOutError` in `self-handled-request.ts`), `save-session.ts` (`prompt`, `refreshing`, `returned`, `start()`). `session.ts` gains `settled()`, `signOut()`, `isAuthenticated`, `displayName` and `signedInWith`.
  - `shared/sign-in/`: `google-sign-in-button`, `sign-in-dialog`, `account-control`, `identity-focus.ts` (`watchIdentityFocus`), `sign-in-copy.ts`. `pages/signin/signin-page.ts`. The test-mode banner is deleted.
  - Fixtures `ME_ANONYMOUS` and `ME_ADA` in `testing/creation-fixtures.ts`. Mutant set `tools/mutants/sets/phase8-client.mjs`.
- **Running-app find:** `SaveSession` captured the restored source in `start()`, after the `/c/` handoff, so a fresh link copy got a redundant refresh GET. Capture page-entry state in the constructor (regression spec in `designer-save.spec.ts`, mutant R2).
- **Traps:** save-status text needs bidi isolates around names. `readSource` drops an empty `updatedAt`, so the 428-without-request path is reachable only in `creation-save.spec`. A first visit shows the flashing notice, which keeps focus on return: rigs must pre-set `fireworks.flashNotice.v1`. Local Playwright has no bundled Chromium; launch with `channel: 'chrome'`.
- **Results:** regular tier 176.2 s, 1,774 web tests. Mutants `phase8-client`: 17 KILLED; S3 survived as an equivalent (the decoded check covers a raw `//`).

### 2026-11-16 — Interlude cross-agent update (Scribe), still open

- **Yoshi's F1 fix changes seek cost after a mixed run** (`yoshi-phase6-timeline-driver.md` addendum). Check the warm-up expectations in `fireworks-stage.phase7.spec.ts` if you touch that path.
- **Your kill count needs correcting** (Toad's F4): `luigi-interlude-spec-split.md` counts T21 and T27 as killed by regular, but `results-new-reg.jsonl` shows both SURVIVED (88/88). Correct it in place with an addendum.

### 2026-11-17 — Cross-agent update (Scribe)

- **Bowser's fix round replaced your G** (`bowser-phase8-server-auth.md`, addendum 2026-11-16, under strict lockout). The Google mark is Google's sha1-matched asset, `public/brand/google-g.svg`, served as `<img alt="">`. `sign-in.spec.ts` pins the `<img>`. Your record's note that the G paths were Google's standard four-colour mark is superseded. Bowser also set `message-page.ts` to `gap-[8px]`, with a pinned test.
- **N1 is yours:** `core/models.ts` l.17 types `signedInWith` as `string | null`; schema §2.8 says `'google' | null` (Peach's acceptance, info).
- **G2 has no spec:** sign-out keeps the draft bytes (`fireworks.draft.v1`, `fireworks.showDraft.v1`). Mario checked it by script on both surfaces. If Skyler approves it as a gate, a one-line spec assertion is yours or Toad's.
- **Toad's `gate-keyboard` now fails on any panel stop**, since your B2 removed `ENGINE_STOPS`.

### 2026-11-17 — Cross-agent update (Scribe): T21 and T23 gap

- **Toad deleted 19 redundant timeline-driver specs** (`toad-redundant-spec-deletion.md`). Each deletion was mutant-proven against the tier that stays. The regular unit-web step went from 34.9 s to 29.7 s, and the regular wall time from 198.8 s to 190.1 s.
- **Open gap, owner you or Yoshi (Toad writes the test, you decide):** T21 (adopt ignores the grid) and T23 (checkpoint ignores the run key) survive every regular engine spec. This predates the cleanup. The fast screen had said T23 was killed by a thin single case, and that did not hold. T40 is covered only at stage level, and T27 is equivalent in the app.
- **Also:** T07 (restore with the wrong digest) is now killed only by `timeline-driver.property.spec.ts`. If the generator's stream changes, re-run `t3-redundancy T07` first.
- **Your decision:** make T21 and T23 a spec, or mark them equivalent with a reason. Nothing has changed in product code.

### 2026-11-17 — End-review CPU fixes, client (record `luigi-end-review-cpu-fixes.md`)

- **Render on change:** `fireworks-stage.ts` `shouldRender` (new renderer, `resized`, DPR, `frameDirty` from quality and seek frames, count change, live particles with `simTime` moving), then `RENDER_SETTLE_FRAMES` 90. `pixi-renderer.ts` removes Pixi's per-tick present (`app.ticker.remove(app.render, app)`) and presents in `render()`. `start` passes `(deltaMS, resized)`; `FakeStageRenderer.resize()`. Fade convergence at 0.92 is 84 frames, not 83.
- **Lean upload:** `engine/render/particle-upload.ts` (`PARTICLE_DYNAMIC_PROPERTIES`, `StaticUploadMark`). `particle-upload.spec.ts` runs Pixi's real `ParticleBuffer` under the polyfill in jsdom and mirrors `_staticBuffer.setDataWithSize`, whose size is in **elements**, not bytes. `pixi-renderer.structure.spec.ts` pins the wiring by text and checks the remove call against the real `TickerPlugin.init` on a plain object.
- **Warm-up:** `quietMs` resets on every seek frame (an edit always seeks), and warm-up waits for `playback.warmUpDelayMs`. The first slice is a probe, and a show at or under `WARM_UP_SKIP_COLD_RUN_MS` (token, 700 since 2026-11-17) is `skipped`. Warm-up specs provide 0 and `warmUpDelayMs: 0` (`PLAYBACK` in both phase7 files and `stage-clock.spec`).
- **Contract spec trap:** a new knob with the same range as an old one breaks `swap()`'s once-only check (`[Range(0, 5000,`). Lengthen the anchor.
- **Mutant runner:** `scratchpad/mut/run.py` (apply, run one spec with `ng test --include`, restore in `finally`). One spec file builds and runs in about 7 s. 23/23 killed.
- **Open for Toad:** `gate-warm.mjs` `after` waits only for `finished`, and a skipped show hangs it. The Q2 smoke screenshot (particles after the count grows) is not built.

### 2026-11-17: verification-ruling follow-ups (skip threshold, T23)
- **Skip threshold 700 ms** (was 1000): at 1000, done-when-60 skipped and seeked cold at p95 947–995 ms, under the 1 s bar by only a few ms. A skip threshold needs margin under the seek bar it promises. The boundary specs derive `skipMs` from `endBoundStep`, so only the default spec and the spec-local 1000s changed.
- **Gate coupling:** `gate-warm.mjs` patches the compiled default by literal string. esbuild prints 1000 as `1e3` and 700 as `700` (checked with the project's esbuild). After a default change, tell Toad the new string; it's his file.
- **Dead guard removed:** `takeCheckpoint`'s `sameKey` check was unreachable after F1 (one caller, `beforeStep` nulls `runKey` right before it). Removed it along with mutant T23 from `t3-engine.mjs`. `run.mjs --check <set>` confirms the anchors without running specs. Node 26.5.0 is at `~/.nvm/versions/node/v26.5.0/bin`; the shell default is 21.5.

### 2026-11-17: skip threshold 200 ms; Reduce flashing first render (record `luigi-end-review-cpu-fixes.md`, second addendum)
- **Threshold 200:** the probe under-predicts about 4× (Toad). Set a skip threshold against the prediction, not against the bar. Natural gate after the change: done-when-60 `finished`, p95 247 ms; realistic-600 p95 514 ms. The 4 s Done-when spec fixture's end bound is step 1335, so compute `endBoundStep + 1` before picking a spec step cost. The skill `checkpoint-warm-up` is updated.
- **Router creation-mode gap:** `RouterOutlet.activateWith` = `createComponent` + `markForCheck`. The page's static DOM is live for a macrotask before any binding, so a top-level `[checked]` reads false. The fix is an update-mode block (`@if (true)`). An input default never shows; that was refuted by mutant. Test it with `<router-outlet (activate)>` reading the DOM (`app/reduce-flashing-first-render.spec.ts`).
- **Gate harness:** `startApi`'s OAuth stub is in-process, so run the gate with async `spawn`, not `spawnSync`. Wrapper: `scratchpad/luigi-warm/run-natural.mjs`.

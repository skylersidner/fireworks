# Luigi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0 to 7 are built. Open: the coarse-pointer clamp on warm-up memory (Yoshi's trigger: `ClientPlayback__CheckpointMemoryMiB` above 128); the Phase 8 client work.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.
### Folded from Phases 0 to 4 (summarized 2026-11-13 and 2026-11-14; compacted 2026-11-15)

- **Rulings and toolchain:** `session.canWrite` comes from `api/me` and hides write controls when false (OQ20). Dev server on 4200 (OQ12). Signal Forms on Angular 22.2.x (OQ17). Node 26.5.0: `export PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"` before every npm or ng command. Dependencies are pinned with no caret; zoneless. The root `tsconfig.json` is solution-style, so typecheck the app and spec configs separately. Never ship a `--stats-json` build (`browser-stats.json` is served publicly).
- **Session and requests:** `core/session.ts` loads `api/me` from a non-blocking initializer. `isSelfHandledRequest` matches exact paths in a Set. Use semantic tokens (`--color-success`, `--color-toast-*`); don't hard-code colors.
- **Pixi:** lazy-load through `STAGE_RENDERER_FACTORY`. A string `preference: 'webgl'` falls back to canvas: read `app.renderer.name` and `webGLVersion === 2`. Destroy with `app.destroy({ removeView: true }, {...})`, off-stage containers first. Skills `pixi-host-lifecycle`, `headless-webgl-smoke`.
- **Engine and designer:** only `render/{glow-texture,skyline,trail-buffer,pixi-renderer}.ts` import pixi. Goldens: `sim/golden/record-prototype-golden.mjs` (skill `prototype-oracle-golden`), re-run only when the prototype changes. Fake renderer: `app/testing/fake-stage-renderer.ts`. The designer model is the raw form model; `shell` is a `linkedSignal` of normalize(model). Dirty is by reference, never `JSON.stringify`. Signal Forms: `[formField]`; custom controls must not declare inputs `min`, `max`, `name` or `disabled`.
- **Validator and wire:** `walkShell` in `engine/model/normalize.ts`; `validate.ts` maps adjustments 1:1 (`defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, `cleaned`→`name-format`). `ShellIssue.code` is contract (schema.md §6.3). Save with compact `JSON.stringify`; read `truncated` on every 400; compare round trips as parsed values. Phase 5 changed the PUT 404 to ask (see the Phase 5 fold). Show `duration` never gates firing (L4).
- **Mutants and editing:** a mutant that doesn't compile is not a kill. Check `sysctl -n vm.loadavg` before trusting a timeout. The Write tool turns `\uXXXX` and `“` into literal characters: write escapes via Python and grep for non-ASCII. Prettier reflows lines, so a mutant's `old` string comes from the formatted file.

### Folded from Phase 5 (summarized 2026-11-15)

- **Client foundation:** `core/models.ts`, `core/creations.ts` (`toCreationError` keys on status), `core/share-code.ts`, `core/creation-save.ts` (`planSave`, `fallbackPlan`, `sourceFrom`, `saveCreation`, which never errors), `engine/model/open.ts` (`openShell`/`openShow`: upgrade, then normalize). 400 is `{message, errors, truncated}` or `{message}`; 413 and 415 are problem+json.
- **Save, share, player:** `core/{device-preferences,open-creation}.ts`, `designer-save.ts`, `designer/shared/{save-bar,save-status,save-copy,working-copy-handoff}`, `features/player/*`, `features/mine/*`. `saved` is a `linkedSignal`; `completeSave` clears only the parts sent. `fallbackPlan` retries only after a remix 404. Names are isolated with `isolate()` (C3).
- **Traps:** `/c/a` to `/c/b` reuses the component (subscribe to `paramMap`). A spec with its own `withInterceptors` skips `httpErrorInterceptor`, so a no-toast check passes vacuously.

### Folded from Phase 6 build, gate follow-up and post-gate seek and config (summarized 2026-11-15)

- **Files and rules (`luigi-phase6-show-builder.md`):** `features/show/pages/show-builder-page/` (page, `show-builder.store.ts` with no HTTP, `show-save.ts`, `show-library.ts`); `features/show/shared/` (`show-edit.ts`, `show-draft.ts` key `fireworks.showDraft.v1`, `show-copy.ts`, `show-working-copy-handoff.ts`, `timeline/`); `testing/show-fixtures.ts`. One edit path: `edit(next, coalesce)` records Undo (50 steps, session only) and sets `dirty`. Motion blur is `fireworks.motionBlur.v1`. `FlashSpacing` lives in `visual-rules.ts`, renderer-only. The 2c.8 rule covers `features/show`.
- **Banner and Undo (points 12):** `core/api-status.ts` `bannerStatus` is `unavailable` when the `/health/live` probe or `api/me` fails. `FORM_FIELDS` (select, range, checkbox) keep ⌘Z inside the control; buttons and the timeline undo the show.
- **Seek (point 13):** `FireworksStageComponent.seekSlice` runs `TimelineDriver.seek` in chunks until the budget passes on `STAGE_CLOCK`; the driver is unchanged. At 25 ms: Done-when scrub 1.4 s, max show 183 s, Pause at 120 ms or under. Measure on Metal with `GPU=1`; SwiftShader swamps a small budget.
- **Client config (point 13):** `core/client-config.ts` (values, `PLAYBACK_LIMITS`, `clampPlayback`); `core/client-config-loader.ts` is the only HTTP, a non-blocking initializer that keeps defaults silently on failure. Drivers read the config at construction, so a late config never swaps a playing driver. `TimelineDriver.inherit` copies `from.cpSteps`.
- **Guard specs pin this code:** `unsafe-sinks.spec.ts` (`SHIPPED_URL_BINDINGS`, 8 navigation calls), `designer-structure.spec.ts` (`showEntryViolations()`), and `core/client-config.contract.spec.ts` (`PLAYBACK_LIMITS` against the `[Range]` attributes). A new URL binding, navigation call or range changes the ledger in the same change.

## Learnings

### 2026-11-15 — Phase 7 B2: client hardening (record `luigi-phase7-client-hardening.md`)

- **CSP:** `pixi.js/unsafe-eval` first in `pixi-renderer.ts` (pinned in `engine-boundary.spec.ts`); `inlineCritical: false` in `angular.json` production. Verified 0 violations in Chromium against a clean publish of the API (Bowser's real header) on 5197 with `--webroot <scratch>/build/browser`. Playwright's `waitForFunction` is blocked by that CSP; measurement contexts use `bypassCSP: true`. A comment that says `new Function` trips the C1 sink ban (`unsafe-sinks.spec.ts`).
- **Context loss:** `StageRenderer.onContextChange`; host statuses `starting|running|lost|failed`, `failure: 'start'|'lost'`, `lostNotice` (1 s), fail at 10 s with renderer destroyed and later restore ignored (coordinator N1). Tokens `STAGE_TIMERS`, `PAGE_RELOAD`; stage input `surface`; copy in `app/shared/fireworks-stage/stage-copy.ts`. Fake renderer has `loseContext()`/`restoreContext()`.
- **DPR:** `core/browser.ts` `canvasResolution` + `CANVAS_RESOLUTION` (+ `DEVICE_PIXEL_RATIO` token); stage passes `resolution` to the factory, timeline reads it per draw and redraws on `contextrestored`.
- **Warm-up:** `TimelineDriver.twin()` / `adoptCheckpoints()` (shared `divergeStep`), stage input `warmUp` (builder only), `data-warm-up`. Realistic 600 s cold p95 3.7 s → 0.49–0.63 s after a ~10 s warm-up on prod; idle cap 12 ms / playing 6 ms keeps frames at 17 ms. The 6c.3 store spec times out at 20 s in the full suite under load (4.5 s alone, same as before B2). Skill `checkpoint-warm-up`.
- **Moves:** save-bar, save-status, hud, api-banner, save-copy, formats → `app/shared`; `reasonOf` required (moved before defaulted params); `MAX_BODY_BYTES` → `core/creation-save.ts` (the new layering rule caught `show-save` importing it from `designer-save`). F3: `embeddedShell` + `src/app/embedded-shell-reads.spec.ts`. `doneWhenShow()` reads Toad's fixture via fs + `openShow`.
- **Traps:** mutants in a copied tree need the repo layout (`mutroot/src/web/fireworks-web` + `mutroot/schema` symlink) or every fixture spec "fails" with ENOENT; always run an unchanged baseline mutant first. The builder opens paused, so a "canvas changes after restore" screenshot check is only meaningful on `/` and `/s/`.

### 2026-11-15 — Phase 7 B3: UX and accessibility (record `luigi-phase7-ux-accessibility.md`)

- **Helpers:** `shared/announcer.ts` (`announcement()`: a repeat goes `''` then the text after 100 ms; `liveNote()`: keyed `@for (track seq)` so a visible note re-announces), `shared/save-shortcut.ts` (§3.3 table), `core/browser.ts` `isApplePlatform`/`isSaveShortcut`. `BannerFocus` (api-banner) and `ToastFocus` (app.ts) track focus by `focusin` and forget it only when `relatedTarget` is a connected node, because a removed node's `focusout` has none.
- **Builder:** `historyStep()` for all undo/redo (B5); `capNoteFor`; `onLibDown` (window listeners, 4 px, Escape); `onManualView` stops Follow; `seekTo(t, reveal)`; Show JSON state in the page (`jsonText` computed only inside the open `<details>`); `store.applyJson`/`applyShow` = one `edit()`. `saveDocumentOf` in show-save keeps the pinned `normalizeShow(sent.show)`.
- **Timeline:** `manualView` output, touch pan/tap/drag, pinch via a box-level `touches` map with a `Gesture.cancel`, proportional wheel, Safari `gesture*`, badges with `t0/t1/firstHiddenId/box`, `labelPlacement`, `revealView`, `dropAt`/`showDrop`. `scrub-overview.ts` is a separate component.
- **Traps:** Tailwind utilities (`min-w-0`, `text-caption`) beat `@layer components`, so the coarse block must be unlayered (found only in a real browser). A spec that uses the function under test as its oracle is vacuous: the "text is the save document" mutant survived until the spec compared with `normalizeShow`. jsdom has `PointerEvent` with `pointerId`/`pointerType`; mock `getBoundingClientRect` on the box and lane. Configure TestBed in `beforeEach`, not in a `make()` called twice. Fake-timer toasts work with `fixture.detectChanges()`.
- **Rules for the rest of Phase 7 (coordinator; now standing):** mutants only on engine, save-path and security code; at most two agents; no three-browser or long runs.

### 2026-11-15 — Phase 7 post-gate cross-agent update (Scribe)

- **Yoshi's D1 fix is in `timeline-driver.ts`, not in your B2 code.** The coordinator authorized Yoshi to change that file and its spec only. Your warm-up API uses the fixed `divergeStep`.
- **Rosalina's rulings changed three of your B3 deviations.** Show JSON Copy writes the textarea (`jsonValue()`); a wheel scroll stops Follow through `emitManual`; the designer's Shell JSON note is keyed by `seq`. Bowser made these under lockout. Your B3 record's deviation list is marked in place.
- **Touch sizes are raw px now.** The root font is 13px, so rem utilities like `size-11` and `gap-2` came out at 35.75 and 6.5 px. Use px classes (`pointer-coarse:min-h-[44px]`, `size-[44px]`, `gap-[8px]`). `src/app/touch-px-utilities.spec.ts` fails any rem-number coarse utility.
- **Your Phase 6 "not built" and "stand-in" statements are marked in place**, and your B2 work closed them.
- **Open for you:** the coarse-pointer memory clamp for warm-up. It fires only if `ClientPlayback__CheckpointMemoryMiB` goes above 128 (Yoshi's trigger; not fired at 64).
- **Guard specs pin your code:** `unsafe-sinks.spec.ts`, `designer-structure.spec.ts` (`showEntryViolations`) and `embedded-shell-reads.spec.ts` change in the same PR as any new URL binding, navigation call or shell read.

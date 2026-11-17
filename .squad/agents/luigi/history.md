# Luigi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0 to 7 are built. Interlude batch 1 is in: regular `ng test` about 33 to 53 s, down from 90 to 126 s. Open: the coarse-pointer clamp on warm-up memory (Yoshi's trigger: `ClientPlayback__CheckpointMemoryMiB` above 128); the Firefox aside tab-stop question (7g.2, with Rosalina); the Phase 8 client work.
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

### Folded from Phase 7 B2, B3 and the post-gate update (summarized 2026-11-16)

- **B2 (`luigi-phase7-client-hardening.md`):** CSP: `pixi.js/unsafe-eval` first in `pixi-renderer.ts` (pinned by `engine-boundary.spec.ts`); `inlineCritical: false` in `angular.json` production. Playwright's `waitForFunction` is blocked by that CSP, so measurement contexts use `bypassCSP: true`. A comment that says `new Function` trips the C1 sink ban. Context loss: `StageRenderer.onContextChange`; statuses `starting|running|lost|failed`; `lostNotice` 1 s; fail at 10 s, renderer destroyed, a later restore ignored. DPR: `core/browser.ts` `canvasResolution` and `CANVAS_RESOLUTION`. Warm-up: `TimelineDriver.twin()` and `adoptCheckpoints()` share `divergeStep`; stage input `warmUp` (builder only); skill `checkpoint-warm-up`. Realistic 600 s cold p95 3.7 s, to 0.49–0.63 s after about 10 s of warm-up. Moves: save-bar, save-status, hud, api-banner, save-copy and formats to `app/shared`; `MAX_BODY_BYTES` to `core/creation-save.ts`; F3 closed by `embeddedShell` and `src/app/embedded-shell-reads.spec.ts`; `doneWhenShow()` reads Toad's fixture.
- **B3 (`luigi-phase7-ux-accessibility.md`):** `shared/announcer.ts` (a repeat goes empty, then the text after 100 ms; `liveNote()` is keyed by `seq`); `shared/save-shortcut.ts`; `BannerFocus` and `ToastFocus` track focus by `focusin`. Builder: `historyStep()` for all undo and redo; `store.applyJson` and `applyShow` are one `edit()`; a wheel scroll stops Follow through `emitManual`. Touch sizes are raw px (the root font is 13 px; `touch-px-utilities.spec.ts` fails rem coarse utilities). Tailwind utilities beat `@layer components`, so the coarse block is unlayered.
- **Post-gate (Rosalina's rulings, Bowser's fix round):** Show JSON Copy writes `jsonValue()`; the Shell JSON note is keyed by `seq`.
- **Guard specs pin your code:** `unsafe-sinks.spec.ts`, `designer-structure.spec.ts` (`showEntryViolations`), `embedded-shell-reads.spec.ts` and `core/client-config.contract.spec.ts`. A new URL binding, navigation call or shell read changes them in the same change.

## Learnings

### 2026-11-15 — Testing interlude batch 1: daily split and test seams (record `luigi-interlude-spec-split.md`)

- **Files:** `*.daily.spec.ts` for timeline-driver (15), stage phase7 (11), the store's 6c.3/6c.4 (2) and the 40k load test (1), all verbatim. Helpers: `engine/loop/testing/timeline-spec-helpers.ts` (`smallShow`, `SMALL_CP` 120, `SMALL_CAP` 2500, `straight`, `referenceRun`), `app/testing/scheduled-ledger.ts`, `app/testing/stage-clock.ts` (`provideStepClock`), and `shortShow()` in `show-fixtures.ts`. `timeline-driver.spec.ts` is split, with `.checkpoints.spec.ts` as the new half. Skill `daily-spec-split`.
- **Results:** `ng test` regular 53 s (from 90–126 s); daily alone 61 s. Counts 1,640 → 1,647 regular + 29 daily.
- **Lessons:**
  - Cost is particle-steps. Compressing a show doesn't save anything; fewer cues or a lower capacity does.
  - A small equivalent must keep the mechanism the mutant needs: the digest case first missed "restore wrong digest" because it never restored a checkpoint.
  - Fake `setTimeout` only (`toFake: ['setTimeout', 'clearTimeout']`) keeps `whenStable` and `RouterTestingHarness` working, and the +1 ms debounce mutants that real sleeps can't see are now killed.
- **Traps:**
  - Background `python &` ignores SIGINT, so a mutant runner can't be interrupted cleanly. Restore its tree from git or the repo.
  - A mutant whose replacement is a substring of its original fails the uniqueness check. Add a marker comment.
  - Mutant rigs also need `docs` and `src/api` symlinked, or `limits`, `schema-fixtures-format` and `client-config.contract` "fail".
  - Moving verbatim makes the daily kill set the old one, so for a moved test the proof only needs regular ⊇ daily.
- **Open gaps (old and new alike):** T22, T23, T32, T35, T36 and T38 on the driver, and death at `age > life`. These are candidates for Toad's T3.

### 2026-11-16 — Interlude cross-agent update (Scribe)

- **Yoshi's F1 fix changes seek cost after a mixed run** (`yoshi-phase6-timeline-driver.md` addendum, 2026-11-16). `TimelineDriver.beforeStep` clears the run key on any step under another width, starBudget or capacity, and a null key takes no checkpoints until reset or restore. The stage still does not re-seek on resize. A seek after a resize and back may now run from 0 or from an exact checkpoint. Check the warm-up expectations in `fireworks-stage.phase7.spec.ts` if you touch that path.
- **Your record's kill count needs correcting** (Toad's F4, `toad-interlude-t3-property-tests.md`). `luigi-interlude-spec-split.md` counts T21 and T27 as killed by regular, but your `results-new-reg.jsonl` shows both SURVIVED (88/88). Correct it in place with an addendum.
- **Open decision with Rosalina (7g.2):** Firefox makes the scrollable `designer-panel` and `builder-panel` asides tab stops before the skip link. This is engine behavior, not a product defect. Whether the panel gets `tabindex="-1"` or the gate expects the stop is yours and Rosalina's (`toad-interlude-final-tier.md` point 3).

### 2026-11-16 — Phase 8 B2: client-side sign-in (record `luigi-phase8-client-sign-in.md`)

- **Files:**
  - `core/`: `sign-in.ts` (the only `location.assign`; `isSafeInternalUrl` mirrors `SafeReturnUrl` row for row, including `/%zz`; marker `fireworks.signin.v1`; `setSignInNavigationForTesting`), `auth-interceptor.ts` (401 → one `load()`, never retries; `isSignedOutError` lives in `self-handled-request.ts`), `save-session.ts` (`prompt`, `refreshing`, `returned`, `start()`). `session.ts` gains `settled()`, `signOut()`, `isAuthenticated`, `displayName` and `signedInWith`.
  - `shared/sign-in/`: `google-sign-in-button`, `sign-in-dialog`, `account-control`, `identity-focus.ts` (`watchIdentityFocus`), `sign-in-copy.ts`.
  - `pages/signin/signin-page.ts`. The test-mode banner is deleted.
  - Fixtures: `ME_ANONYMOUS` and `ME_ADA` in `testing/creation-fixtures.ts`.
  - Mutant set: `tools/mutants/sets/phase8-client.mjs`.
- **Running-app find:** `SaveSession` first captured the "restored" source in `start()`, which runs after the `/c/` handoff, so a fresh link copy got a redundant refresh GET. Capture page-entry state in the flow's constructor, before the page body runs (regression spec in `designer-save.spec.ts`, mutant R2).
- **Traps:**
  - Specs that compare save-status text need the bidi isolates (`⁨…⁩`) around names.
  - `readSource` drops an empty `updatedAt`, so the 428-without-request path is reachable only in `creation-save.spec`.
  - `/health/live` is self-handled too, so no toast.
  - The local Playwright has no bundled Chromium; launch with `channel: 'chrome'`, as `lib/common.mjs` does.
  - A first visit shows the flashing notice, which keeps focus on return, so rigs must pre-set `fireworks.flashNotice.v1`.
- **Rig:** `--interactive` stub links read `Continue as dev-alice` and `Cancel`. 4200 → 5180 → stub on 127.0.0.1:5190.
- **Regular tier:** 176.2 s wall (228.8 s on the first run), 1,774 web tests. Mutants `phase8-client`: 17 KILLED; S3 survived as an equivalent mutant (the decoded check covers a raw `//`).

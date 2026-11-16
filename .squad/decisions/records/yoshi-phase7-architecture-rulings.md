# Phase 7 architecture rulings (A4)

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7, batch A4 (plan §Phase 7 7.3) · **Inputs, read as code:** `engine/render/pixi-renderer.ts`, `engine/render/stage-renderer.ts`, `app/shared/fireworks-stage/fireworks-stage.ts`, `engine/loop/timeline-driver.ts`, `engine/loop/engine-loop.ts`, `engine/render/visual-rules.ts` (`FlashSpacing`), `node_modules/pixi.js` 8.23.0 (`lib/rendering/renderers/gl/context/GlContextSystem.mjs`, `gpu/GpuDeviceSystem.mjs`), `features/designer/designer-structure.spec.ts`, `app/unsafe-sinks.spec.ts`, `features/show/shared/show-draft.ts`, `show-builder.store.ts`, `show-edit.ts`, `core/models.ts`, `Contracts/ApiContracts.cs`, schema.md §2.1 and §11.4, `luigi-phase6-show-builder.md` point 13, `boo-phase6-security-verification.md` F3, and the reference's `app/shared` (`monster-of-the-week-net-angular/src/web/monster-of-the-week-web/src/app/shared/custom-moves-card.component.ts`, used by five features).

## What

### 1. WebGL context loss: the renderer detects it, the stage host rebuilds

**How Pixi 8.23.0 behaves** (`GlContextSystem.mjs` l.103–104, 176–199):
- It adds `webglcontextlost` and `webglcontextrestored` listeners to the canvas. The lost handler calls `event.preventDefault()`, so the browser may restore the context.
- On restore it re-runs `getExtensions()` and emits `contextChange` to its own systems. That is an in-place restore on the same Application.
- It auto-restores only a loss it forced itself (`forceContextLoss`). A test that calls `WEBGL_lose_context.loseContext()` directly has to call `restoreContext()` itself.
- `destroy()` calls `loseContext()` on the extension. That fires a `webglcontextlost` event on the canvas being destroyed.
- The ticker keeps running while the context is lost. GL calls on a lost context are no-ops.
- WebGPU (`GpuDeviceSystem.mjs` l.31) restores a lost device by itself, with no event the app can see.

**Ruling:**
- **Detection lives in the renderer; policy lives in the host.** `StageRenderer` (still Pixi-free) gains `onContextChange(listener: (state: 'lost' | 'restored') => void): void`.
  - `PixiRenderer` listens on its own canvas, and only when `name === 'webgl'`. On `lost` it stops its ticker, so no frame runs, and calls the listener. On `restored` it calls the listener.
  - It removes both listeners **before** `app.destroy()`, and the handlers check `destroyed`. Pixi's own `loseContext()` in destroy fires `webglcontextlost`, and a host listening at that moment would start a rebuild loop on every navigation.
- **The host rebuilds; it doesn't restore in place.**
  - **On `lost`:** set `status` to a new `'lost'` value (`data-status="lost"`, which is the hook for Rosalina's overlay and Toad's check). Keep the old renderer, because its canvas is where `restored` arrives. Start a `CONTEXT_RESTORE_TIMEOUT_MS` timer: 5000, unless Rosalina's phase-7.md sets a number. **Superseded by `rosalina-phase-7-design-review.md` (point 11) on 2026-11-15: the timer is 10 s, not 5000 ms** (the failure block after 10 s without a restore; built in `luigi-phase7-client-hardening.md` point 2).
  - **On `restored` within the timeout:** destroy the old renderer first (the browser caps contexts per page), then call the same `STAGE_RENDERER_FACTORY` and the same mount path `start()` uses. That keeps the destroyed-while-pending guard, plus a generation counter so a stale resolve is destroyed and never mounted. Then append the new canvas, re-set `renderer` and `trailFormat` from the new instance, set `status` to `running` and `start` the new ticker.
  - **On timeout, or a factory rejection:** destroy, set `failed`, and show the existing no-WebGL message (Done-when 7.2.5). A `restored` that arrives later is ignored, because its listener is already gone.
- **Why rebuild rather than trust Pixi's in-place restore.**
  - Destroy-and-create is the path the 20-navigation leak check already proves.
  - The trail format must be re-chosen. `chooseTrailFormat` probes the renderer's capabilities, and a restored context can sit on a different GPU (for example discrete to integrated) without `rgba16float`.
  - The trail texture's contents are gone either way.
- **WebGPU and Canvas:** no handling in Phase 7. Canvas can't lose a context. WebGPU is only picked when WebGL init fails, and Pixi restores it silently. **Trigger:** if any gate run reports `data-renderer="webgpu"` on a stage surface, add a `device.lost` hook to `PixiRenderer`.

**The sim survives the rebuild untouched, by construction.**
- `FireworksSim`, `EngineLoop` and the `TimelineDriver` are fields of the host (`fireworks-stage.ts:163–176`). The renderer only reads the typed arrays (`pixi-renderer.ts` class doc).
- The rebuild replaces `this.stage` only. It never calls `sim.clear`, `loop.setDriver`, `seek` or `reset`.
- Two host rules keep that true while the renderer is down:
  - **Loss is an implicit pause.** While `status !== 'running'`:
    - `launch()` returns null and `replay()` returns false;
    - `fireNow()` only sets `shell` and `sky`;
    - clicks are already ignored (`!this.stage`).
  - **The host caches the last world width.** The loop's `worldWidth` provider returns the last real width while there is no renderer, not the 1280 fallback. Today `this.stage?.worldWidth() ?? 1280` would put a fire at the wrong x, and would also break the checkpoint `RunKey` match (width is part of the key).
- **`FlashSpacing` moves out to the host.** The host constructs it and passes it in through `StageRendererOptions.flashSpacing`, so its state survives a rebuild the way the sim does. Sim time stands still during the loss, so a fresh gate could draw a flash within 41 steps of the last drawn one. That breaks the Reduce flashing spacing rule (`flashing-content-safety` rule 6). `visual-rules.ts` imports no Pixi, so this crosses no boundary. `tintCache` and the particle pool stay in the renderer: they are a GPU-side cache with no meaning for the sim.

**The TimelineDriver during a loss: frozen, with nothing to do.**
- No frame runs, so no `beforeStep` runs, and the show clock (`driver.step`) and `simTime` stand still. "A show resumes at the same sim time" (7.2.5) follows.
- A pending `seekTarget` stays pending and continues on the first frame after the rebuild. Seeks already run only while a renderer is up, so cues fire at the real width.
- `seekElapsedMs` counts frame time only, so the loss doesn't count toward "Catching up…".
- A new driver input that arrives during the loss (a builder edit) goes through the usual effect (`setDriver`, then `requestSeek`), and lands after the rebuild.
- The first frame on the new ticker is clamped by `EngineLoop.frame` (`MAX_FRAME_DT` 0.1 s), so Auto show and the preview loop don't fire a burst of catch-up launches.

Rosalina owns what the user sees while `lost`: the overlay, its copy, and whether there's a retry. The failure copy must not interpolate a raw `error()` for a loss.

### 2. A late config and the end-of-show clamp

**A late `ClientPlayback` config does not reset the checkpoint grid. No driver change.**

What happens today, in the code:
- `seekBudgetMs` and `catchingUpDelayMs` are read on every seek frame, so a late value applies from the next frame.
- `checkpointMemoryMiB` applies to the next driver built: the builder's next edit, or the player's next load.
- `checkpointIntervalSeconds` applies only to a driver built without `from`. `inherit` copies `from.cpSteps` (`timeline-driver.ts:386`), which may also have been doubled by the memory cap.

Why that stays:
- **A checkpoint is exact on any grid.** Each one is a full snapshot keyed by width, star budget and capacity, so the interval is a speed knob, never a correctness input.
- **Resetting costs more than it saves.** Rebuilding without `from` mid-session throws away every checkpoint and re-seeks from 0. That is up to 183 s on `at-maximums` at the 25 ms budget (point 13 measurement).
- **The gap is narrow.** The committed appsettings equal the client defaults (`CommittedConfigurationTests`), so a late value differs only when a deployment overrides it through the environment.

Two documentation changes:
- **Bowser** adds a sentence to the README §Playback tuning: an open tab loads these values once, and the two checkpoint values apply to shows opened after they arrive.
- **Luigi** notes the same on `inherit`'s doc comment.

**Trigger:** the first deployment that sets `ClientPlayback__CheckpointIntervalSeconds`. Then build this change:
- the driver keeps a `requestedSteps`;
- `inherit` takes `from.cpSteps` only when `from.requestedSteps === this.requestedSteps`, and otherwise uses its own interval;
- the inherited checkpoints stay, because exactness doesn't depend on the grid.

**The end-of-show clamp belongs in the stage, not the driver.**
- **Why playback overshoots.** `EngineLoop.frame` runs every step its accumulator holds. The driver finds the end inside `beforeStep` at step E (`checkEnd`) and keeps counting on the remaining steps of that frame. So `driver.step` reads E+1 or E+2 at 60 fps. It reads up to E+12 on a clamped 10 fps frame (0.1 s is 12 steps).
- **Why the driver must keep counting.** `driver.step` must keep counting steps actually run: `seek` compares `k < this.k`, and checkpoints carry `step`. A driver that stopped counting at `done` would make a seek past the end never arrive, so `seekSlice` would loop forever.
- **The rule for `FireworksStageComponent`:**
  - After `this.loop.frame(deltaMS)` in `timelineFrame`, if `timeline.done`, set `playbackEndStep = timeline.endStep`.
  - `currentStep()` returns `seekTarget ?? playbackEndStep ?? driver.step`.
  - `requestSeek` and a driver change clear `playbackEndStep`.
  - The driver-change effect seeks to the reported step (`this.currentStep()`), not `previous.step`, so an edit after the end re-seeks to E, not E+2.
  - A seek whose target is past the end reports its target, so a scrub into the post-end tail keeps the playhead where the user put it.
  - The frame hook receives `currentStep()` already, so the player's clock and the builder's playhead stop at the exact end with no change to either host.
- **The spec:** play the Done-when fixture to the end at 60 fps and at 10 fps. `currentStep()` must equal `endStep` and the hook's last step must equal `endStep`. Negative control: return `driver.step` and the spec fails with E+2.

### 3. Shared components move to `app/shared`

The builder imports them, and the reference keeps anything that more than one feature uses in `app/shared` (`custom-moves-card.component.ts` is used by five features; no reference feature imports another feature's `shared/`).

**What moves.** Keep the directory names; update every importer, including the designer's own fields, which import `../formats`.

| From `features/designer/shared/` | To `app/shared/` |
|---|---|
| `save-bar/save-bar.ts` | `save-bar/save-bar.ts` |
| `save-status/save-status.ts` | `save-status/save-status.ts` |
| `hud/hud.ts` | `hud/hud.ts` |
| `api-banner/api-banner.ts` | `api-banner/api-banner.ts` (the builder imports it too; the brief's list missed it) |
| `save-copy.ts`, `save-copy.spec.ts` | `save-copy.ts`, `save-copy.spec.ts` |
| `formats.ts` | `formats.ts` (whole file; it's value formatting, not designer state) |

**What stays.**
- `designer-draft.ts` stays. The builder's `readDraft` and `adoptLegacyMotionBlur` read the designer's own storage, so that is a designer API.
- `designer-copy.ts` stays. It holds shell copy.
- `working-copy-handoff.ts` and every designer field component stay.

**One code change rides along.** `save-copy.ts` value-imports `issueReason` from `./designer-copy` as the default `reasonOf` (l.6, 112, 140, 202). In `app/shared` that would be a shared-to-feature import, so `reasonOf` becomes required, and `designer-save.ts` passes `issueReason` explicitly.

**The 2c.8 structure spec, checked against the moved files:**
- `controls = walk(app/shared)` already brings the moved files into the identity/HTTP allowlist check. They add no hit: `save-bar.ts` and `save-copy.ts` import `core/creation-save` and `core/creations` as types only, which `valueImports` ignores. So `ALLOWED` is unchanged and needs no new entry.
- The Signal Forms ban already covers `app/shared`.
- **One test loses coverage.** "Presentational components take inputs" walks `features/designer` only, so it would no longer see the moved components. Replace that coverage with one new rule in `designer-structure.spec.ts`:
  - no non-spec file under `app/shared` value-imports anything under `features/`;
  - `features/show` may import from `features/designer` only `designer-draft.ts` and `designer-copy.ts` (today's two legitimate reads).
  - Each rule needs a negative control. Without a feature import, a shared component can't inject a feature store.
- `unsafe-sinks.spec.ts:169` "sees the files" moves to `app/shared/save-bar/save-bar.ts`.
- `shared/bidi.spec.ts` updates its import.

### 4. The ETag token

Folded into schema.md as a new §2.1.1, with §11.4 updated in place.
- **The token.** `ETag: "<updatedAt>"`, where the value is the response's `updatedAt` string exactly as the JSON body serializes it (STJ, trailing zeros trimmed). Serialize it with the body's converter. `ToString("O")` pads to seven fractional digits and gives a different token.
- **Strong, not weak.** If-Match uses strong comparison (RFC 9110 §13.1.1), so a weak tag could never satisfy Phase 8's precondition.
- **Where it goes.** It is sent on every `CreationResponse`: the GET, POST, PUT and remix. The client can then echo the header, or build the tag from `source.updatedAt`; the two are equal.
- **The 304.** `If-None-Match` uses weak comparison and accepts `*` and lists. The 304 carries the same `ETag` and `Cache-Control` a 200 would. The 404 lookup and the read limit come first.
- **Phase 8, decided now.**
  - The owner's representation keeps `"<updatedAt>"`, so If-Match and 412 need no token change.
  - The non-owner representation gets `"<updatedAt>-p"`, because `isOwner` and `remixedFrom` differ in bytes. Then a browser that revalidates under a different identity gets a 200, never a stale `isOwner`.
- **Interaction with Boo's A1 `Cache-Control`.**
  - The token is the same either way.
  - With `no-store`, the ETag only serves explicit conditional requests and Phase 8's If-Match. No stored copy exists, so nothing stale is possible.
  - With `private, no-cache`, the browser revalidates, and one accepted gap appears. Deleting an original turns a remix's `remixedFrom` to `null` without changing the remix's `updatedAt`, so the cached old code survives a 304. It's harmless: the field isn't rendered before Phase 8, and afterward it names a deleted creation, whose link is the 404 page.
  - Either way the share-code GET must never be `public`. That is Boo's rule, and I agree.

### 5. Boo F3: keep `Object.hasOwn` discipline, through one helper and one spec; don't go null-prototype end to end

**Why not null-prototype end to end.** `structuredClone` and every object spread silently give back an `Object.prototype` object. Null-prototype maps would mean replacing six existing copy sites, plus every future one, with no type-level guard. A single missed spread reverts it without any test noticing. The protection it buys matters only if the "every `cue.shell` is an own key" invariant breaks, and the helper below covers exactly that case.

**The minimal rule:**
1. **Reads.** Every read of an embedded shell by key, outside `engine/model/normalize.ts`, goes through one helper in `engine/model/show.ts`: `embeddedShell(show, key): EmbeddedShell | undefined`, which is `Object.hasOwn(show.shells, key) ? show.shells[key] : undefined`.
   - Today there are 18 embedded-shell `.shells[` reads outside `normalize.ts` (grep on 2026-11-15; `sim/simulation.ts:175` also matches, but it is the sim's own in-flight `shells` array). The ones that matter are the bare reads Boo listed: `show-builder-page.ts:364, 666, 742, 827`, `show-builder-page.html:103, 163` (through a component method), `player-page.ts:166`, `show-builder.store.ts:358, 552` and `timeline-layout.ts:95`.
   - The rest are `Object.keys` loops and `hasOwn`-guarded reads (`show-builder-page.ts:287, 289, 323, 638`, `timeline-driver.ts:170`, `sim/lifetime.ts:129`). They move to the helper too, so the guard below can be a plain grep. `engine/sim` may import `engine/model`, so the layering holds.
   - The existing `hasOwn ? x[k] : null` pairs fold into the helper.
2. **Membership.** Use `Object.hasOwn` only: never `in`, never truthiness of `shells[k]`, and never `for…in`. To enumerate, use `Object.keys` or `Object.entries`.
3. **Writes.** Writes to `shells` happen only in `show-edit.ts` and `normalize.ts`, and only with a key that has passed `KEY_PATTERN`. The pattern rules out `__proto__`.
4. **Guard.** A structure spec allows `.shells[` (a property-access read) only in `normalize.ts`, `show.ts` and `show-edit.ts`, across `app/**/*.{ts,html}` and `engine/**`. `engine/sim/simulation.ts` is also allowed, with a comment, because its `this.shells[s]` is the sim's in-flight array. It needs a negative control: re-add one bare read.
5. **Toad's round-trip spec.** Keys `constructor`, `toString` and `valueOf` go through draft save and restore, `loadCopy`, add, remove, and the Save body. Add one direct case: `embeddedShell(show, 'constructor')` on a show without that key is `undefined`, while a plain lookup would return `Object`.

### 6. The TS and C# names: `ClientPlaybackConfig`

Rename the TS `PlaybackClientConfig` (`core/models.ts:108`, plus its doc comment at l.103, which names the wrong C# type) to `ClientPlaybackConfig`.
- It matches the C# record (`ApiContracts.cs:40`), the appsettings section `ClientPlayback` and `ClientPlaybackOptions`.
- Every other TS contract type in `core/models.ts` already carries its C# record's name (`CreationResponse`, `MeResponse`, `ClientConfigResponse`), so the record name is the convention.
- The wire keys don't change, so Toad's parity spec holds.

## Why
- Point 1 keeps the Phase 2a boundary doing its job. Pixi stays in `engine/render`, the host owns the lifecycle, and the engine owns state. That is why the sim survives a rebuild without being touched, and it lets the rebuild reuse the proven mount and destroy path instead of trusting a restore path nobody has tested.
- Point 2: keeping both clamps out of the driver keeps the engine exact and free of any clock; wall time and presentation stay in the stage (the same split as point 13).
- Point 3 follows the reference's convention and keeps the structure spec meaningful once the files leave `features/designer`.
- Point 4 lets Phase 8's If-Match reuse Phase 7's token with no contract change, which was Skyler's Q7.4 constraint.
- Point 5 puts the guarantee where a spec can see it. A runtime-shape guarantee would be lost on the next spread.

## Boundary
- Builds (B2, Luigi): point 1; the point 2 stage clamp; point 3; the point 5 helper and spec rule; the point 6 rename. Bowser (B1): the point 4 header and 304 path; the README sentence in point 2. Toad (C3): the point 2 clamp spec review, the point 4 harness test with a `ToString("O")` negative control, and the point 5 round trip.
- Not decided here: what a loss looks like (Rosalina); `Cache-Control` for `/api` (Boo, A1); the `CONTEXT_RESTORE_TIMEOUT_MS` number, if Rosalina's spec names a different one.
- The skill `pixi-host-lifecycle` is updated with the context-loss shape and the corrected stage path (`app/shared/fireworks-stage/`).

## Addendum 1 (2026-11-15): review of Luigi's B2 warm-up API (`twin`, `adoptCheckpoints`, shared `divergeStep`)

**Verdict: PASS for B2, with one defect that came from Phase 6, which B2 now also reaches (D1).** The probes and mutants ran in a copied tree (`scratchpad/yoshi-b2`, schema symlinked). Baseline: `timeline-driver.spec.ts`, `fireworks-stage.phase7.spec.ts` and `engine-boundary.spec.ts` pass, 92/92. Probe spec: `scratchpad/yoshi-b2-tools/yoshi-probe.spec.ts`. Mutant runner: `scratchpad/yoshi-b2-tools/mut.py`.

**1. Exactness: PASS, except D1.**
- I ran a twin to the end on its own sim and handed its checkpoints back. Seeks to 7300, 1300, 4801, 2400 and 6000 then equal a straight run (probe P1) in every particle field (all `ParticleStore.fields`, including `kind`, `gen`, `effect` and `trail`), in every in-flight shell with its `rngState`, in `firedCount` (the fired pointer), `endStep`, `done`, the ledger and the trace digest. `simTime` differs, and that is correct: only `FlashSpacing` reads it (`visual-rules.ts:101`). A backward jump resets it. A forward jump prunes decisions older than 1 s, so no stale decision can match a new flash.
- The run key covers width, `starBudget` and capacity (`timeline-driver.ts:93-95`). Every key reaches `seek`'s filter (l.312) and `takeCheckpoint`'s refusal (l.393).
  - P5: width changed mid warm-up. Shadow checkpoints at the old width are never used, and the seek equals a straight run at the new width.
  - P6: `starBudget` changed on the visible sim before the handoff. The seek is exact.
- `divergeStep` (l.116-120) is right for edits inside the schedule: a changed, added, moved or re-seeded cue, or an embedded shell edit (JSON compare). A checkpoint on the diverging step itself is still exact, because it is taken before that step's cues fire (l.269 before l.273).
- **D1 (defect, `timeline-driver.ts:116-120` with `:436`). When the new schedule is a strict prefix of the old one (the last cue or cues removed), an inherited or adopted checkpoint gives the wrong `endStep`.**
  - Cause: `divergeStep` returns the removed cue's `fireStep`, so the driver keeps checkpoints from the gap between the new show's real end and that step. Each one has `next === schedule.length` and `endStep === null` (the old show hadn't ended), so `restore` sets `_endStep = null`, and `checkEnd` then reports the end at the checkpoint's step.
  - Repro (P2, P2b): cues `a@1, b@5, c@40`, seek to 4900, remove `c`, seek to 4900. Straight run: `endStep` 1113. Inherited: 4800. `adoptCheckpoints` gives the same result.
  - Effect in the app: the builder's "Ends at" (`knownEnd`, `show-builder.store.ts:327`), the end clamp and `ended` all show the old cue's time after a user deletes the last cue with the playhead past the new end.
  - Not reachable through warm-up itself, because a twin's schedule is identical. It is reachable through `{ from }` on every edit, and through a builder `/c/` load of a show whose cues are a prefix of the open one's.
  - **Fix (verified in the copied tree):**
    ```ts
    const d = Math.min(a[i]?.fireStep ?? Infinity, b[i]?.fireStep ?? Infinity);
    return i === b.length && i < a.length ? Math.min(d, b.at(-1)?.fireStep ?? 0) : d;
    ```
    Here `b` is the receiver, which both call sites already pass second. At `b`'s last `fireStep` that cue hasn't fired yet, so `next < length` holds for every kept checkpoint.
  - With the fix, P2 and P2b pass and so do the other 85 specs. The one exception is `timeline-driver.spec.ts:582`, which asserts the defect (`[1200, 2400, 3600, 4800]`) and must become `[1200, 2400]`. Add P2 as a spec.
  - Owner: this is the Phase 6 inherit rule (mine). Under lockout, Luigi should not take it as a B2 revision. The coordinator routes it: Yoshi, if product edits are authorized, with Toad on the spec.

**2. A driver built `{ from }` a driver with checkpoints off keeps its own interval: correct.** `compatible` (l.419-427) needs both intervals to be above 0, so nothing is inherited and nothing is copied.
- Copying the spacing exists only to keep inherited checkpoints on-grid, so with nothing inherited there's nothing to copy.
- The old rule spread "off" to every later driver in the session.
- Production can't send 0 (`ClientPlaybackOptions.cs:31`, `[Range(1, 60)]`), so this only matters in specs and in this record's point 2 trigger design, which it matches.
- **Gap:** no spec pins it. The mutant that restores the old off-propagation (M8) survives. Add a two-line spec: build from an off driver and assert `checkpointInterval` is 1200; build off from an on driver and assert `[0, []]` (P3).

**3. Memory: it does not double. PASS.** Checkpoints move between the two drivers by reference (l.359-365, l.453), and the frame order (adopt from live, run, hand back; `fireworks-stage.ts:628-638`) converges both lists within one frame.
- Measured over 4000 simulated frames of play, far seeks and a twin rebuild (P4): the set of distinct snapshots both drivers hold together never exceeded the larger single list. That is 0.95 of the cap at 400 KiB and 0.96 at 900 KiB. At 150 KiB, a single checkpoint larger than the cap is kept by the existing one-checkpoint exemption (l.412), and the union still equals it.
- Overhead: one shadow `FireworksSim` at capacity. During one slice, add the few checkpoints taken in that slice before the handback. So it is not 128 MiB.
- **What did change:** warm-up turns the cap from a ceiling the user's scrubbing might reach into the builder's steady state for long, dense shows. At the operator maximum of 512 MiB (`ClientPlaybackOptions.cs:35`, Boo's note), every builder tab now holds about 512 MiB.
  - **Trigger:** the first deployment that sets `ClientPlayback__CheckpointMemoryMiB` above 128. Before it ships, the stage must clamp the warm-up's effective cap on coarse pointers (for example `min(config, 64)` MiB) or skip warm-up there.
  - At the committed 64 MiB, accept it.

**4. Engine boundary: PASS.** `timeline-driver.ts` imports only `model`, `sim` and the loop's own types (l.1-13). `twin` and `adoptCheckpoints` read no clock, timer or DOM. The stage owns wall time through its injected `clock()` (`fireworks-stage.ts:535, 565, 585, 591, 635`). `engine-boundary.spec.ts` passes.

**5. Edge cases and races: PASS, one cosmetic.**
- **Handoff mid-seek:** no warm-up runs while `seekTarget !== null` (l.563), and `adoptCheckpoints` never touches the receiver's run, so the result is exact either way.
- **Edit during warm-up:** the driver-change effect stops the warm-up (l.294). The new driver inherits everything handed back through the previous frame, and its twin resumes from the edit point. 7l.8 covers this, and mutant M11 is killed.
- **New show during warm-up:** same path. It is exact by `divergeStep` and `compatible`, except D1.
- **Context loss during warm-up:** frames stop with the ticker. `this.warm` survives a rebuild and resumes exactly, since the shadow never touches the renderer. A width change on rebuild re-keys, and M13 is killed.
- **Cosmetic:** `fail()` (l.486-496) clears `warm` but leaves `data-warm-up` at `running`. Set it to `off` there, so the hook doesn't report a warm-up on a failed stage.

**Mutants (13):**
- **Killed (5):** M3 sky ignored, M4 divergence ignored, M7 no cap on adopt, M11 no adopt-from-live, M13 `warmedFor` ignoring the key.
- **Survived, harmless for exactness (6):**
  - M1 twin without `from`, M5 twin with the default interval and M6 narrower spacing are performance only.
  - M2, dropping the `added` grid filter, is redundant: l.364 filters again.
  - M10, shadow `starBudget` not synced, and M12, default shadow capacity, are protected by the run key. Warm-up would silently do nothing at a non-default star budget or capacity. Add one stage spec at `starBudget` 0.5 that expects the warmed checkpoints to be used.
- **Survived, gaps (2):** M8 (point 2 above), and M9, `compatible` ignoring the `traceDigest` flag. No spec adopts across different digest settings. Add a one-line negative.

**D1 resolved (2026-11-15, Yoshi, product edit authorized by the coordinator for `timeline-driver.ts` and its spec only).**
- `divergeStep` now caps at the receiver's last `fireStep` when the receiver is a strict prefix of the sender (the verified fix above, with a doc comment naming `b` as the receiver). Both call sites (`inherit`, `adoptCheckpoints`) already pass the receiver second. An empty receiver caps at 0, so it keeps nothing (checkpoints exist only at `k > 0`).
- Specs: the removal row in "adding, removing or moving a cue" now expects `[1200, 2400]`. New spec "deleting the last cue past the new end" pins `endStep` 1113 = straight run, for both `{ from }` and `adoptCheckpoints`, plus world and ledger. New spec pins point 2 (M8): `{ from }` an off driver keeps 1200; off `{ from }` an on driver is `[0, []]`.
- Negative controls (copied tree `scratchpad/yoshi-d1`, runner `scratchpad/yoshi-d1-mut.py`), all killed: N1 no prefix cap, N2 cap at the sender's last cue, N3 cap one interval late, N4 `adoptCheckpoints` arguments swapped, N5 `inherit` arguments swapped, M8 off-propagation. Toad's M8 gap is closed; M9 and M10 remain Toad's.

**Owners:** D1 is routed by the coordinator (above). Luigi takes the `fail()` hook reset and the coarse-pointer clamp when the trigger fires. Toad takes the three spec gaps (M8, M9, M10).

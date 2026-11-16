# Toad: Phase 7 C3, QA review of B1, B2, B3 and D1

**Date:** 2026-11-15 · **Status:** proposed · **Phase:** 7, batch C3 · **Inputs, read as code:** `src/api/Fireworks.Api.Tests/Hardening/*`, `Controllers/CreationsController.cs`, `Services/ResponseHeaders.cs`, `Services/Health/HealthEndpoints.cs`, `Data/FireworksDbContext.cs` (`ApplyTimestamps`), `engine/loop/timeline-driver.ts` (+ spec), `app/shared/fireworks-stage/fireworks-stage.ts` (+ `phase7.spec`), `features/show/shared/show-json.ts`, `show-builder.store.ts`, `engine/model/show.ts`, `app/embedded-shell-reads.spec.ts`, `designer-structure.spec.ts` (`showEntryViolations`), `app/shared/button-styles.spec.ts`, `docs/fireworks-app/acceptance/phase-7.md`.

## What

1. **Heavy engine specs carry explicit timeouts, and a timeout is never counted as a kill.** The full suite's own workers slow CPU-bound specs 5-6x (see Timeouts). Spec-only changes:
   - `timeline-driver.spec.ts`: `vi.setConfig({ testTimeout: 30_000 })` for the file; the digest spec's explicit 20 s is raised to 30 s.
   - `fireworks-stage.phase7.spec.ts`: `vi.setConfig({ testTimeout: 30_000 })`.
   - `show-builder.store.spec.ts` 6c.3 and 6c.4: 60 s.
   - `show-builder-page.spec.ts` "is a lazy route…" (§14.1): 20 s.
   - The mutant runner (`scratchpad/toad-c3/mut.py`) prints each failure's error line. A mutant whose only failures are timeouts is re-run, never counted.
2. **Spec gaps closed (each proven against its mutant):**
   - **M9** (Yoshi addendum 1): `compatible` ignoring `traceDigest`. Spec "refuses checkpoints across different traceDigest settings, both ways and through { from }" (driver).
   - **M10**: shadow `starBudget` unsynced. Spec "at starBudget 0.5 the warmed checkpoints are used…" (stage). The mutant re-ran 4117 steps instead of 517.
   - **W9** (new, same class as M10): shadow fixed at width 1280. Spec "at a world width other than 1280…" (stage).
   - **W2** (new, next to D1): an empty receiver (every cue deleted) kept every checkpoint before the old first cue. Spec "deleting every cue past the old first launch…" (driver).
   - **J2** (new): Apply not falling back from a gone embedded active shell (7k.5). Spec "Apply: a gone embedded active shell falls back to Peony…" (store).
   - **Y§5 point 5 / 7m.5**: the prototype-key round trip was assigned to me and missing. Spec "prototype-named shell keys go through loadCopy, add, remove, the draft and the Save body" (store). It also kills F2, a bare read that evades the `.shells[` grep by aliasing.
   - **7h.5**: the spec read only `styles.css`, while the criterion says anywhere in `src`. Spec "no keyframes, animate- utilities or smooth scrolling in any source file", with a three-spelling negative control.
   - **A6** (API, new): the site-wide headers set with `TryAdd` instead of overwriting. Test `The_site_wide_set_overwrites_a_weaker_value_written_earlier` (ResponseHeaderTests). Nothing in the app writes those headers today, so no other test could see it.
   - **A9 is equivalent, and no test is kept for it.** The readiness probe's `catch → false` can't be reached through the provider: EF's `CanConnectAsync` returns false on a refused port, on protocol garbage and on a bad connection string (which fails earlier, while the options are built). Two candidate tests passed under the mutant, so both were removed.
3. **The `.shells[` guard is a grep for property-access reads, not an aliasing proof.** `const m = show.shells; m[k]` passes it. Behavior specs (item 2's round trip) are the second line. That is acceptable under Y§5's wording, but a new read path needs a behavior case with a prototype-named key, not only the grep.
4. **Gate scripts for Mario** are in `scratchpad/toad-c3/gate/`: `gate-csp.mjs` (real header, no `bypassCSP`, no `waitForFunction`, `MODE=none` negative control), `gate-warm.mjs` (7l.3 bar, measurement context with `bypassCSP`), and `gate-roundtrip.mjs` (Done-when flow on 5180/image plus the 7k.3 Show JSON two-engine round trip, `SKIP_PLAY`, `TOAD_JSON_TAMPER` negative control). Measurement contexts use `bypassCSP: true`; the CSP pass is its own run.

## Why
- A test that can't fail on the bug it names is worse than none. Six of the 14 web mutants survived Luigi's and Yoshi's specs and were killed only by the specs above.
- Under load the 5 s default produced "kills" that were timeouts (W3, W6, W8 first run, J1). Classifying each failure keeps mutant verdicts honest.

## Boundary
- No product code changed. Defects and gaps go to their owners: none of the mutants found a product defect; the gaps were in specs.
- `git diff`-based acceptance rows (7h.3, 7l.2): the repo is a git repo, but its last commit is Phase 6 and Phase 7 is uncommitted, so `git diff` against HEAD is a valid baseline for those rows only while nothing of Phase 7 is committed.
- Gate scripts were checked in Chromium only, on 5180 with the real header:
  - `gate-csp` real: 9 of 9 pages had 0 violations and 0 errors; MODE=none caught all 9.
  - `gate-roundtrip` with `SKIP_PLAY=1` and `JSON_ENGINE=chromium`: the 6b.2 POST checks pass, and Show JSON deep-equals; `TOAD_JSON_TAMPER=1` fails as it should.
  - `gate-warm`: syntax only (a measurement run).
  - Mario runs the three-engine, real-time and measurement parts.
- Suites at the end of C3: web 1624/1624 (67 files, load 8–10, no timeouts), typecheck and prettier clean; API 661 passed + 12 skipped plain, 673/673 gated.

---

## Addendum: C4 gate scripts and the re-check of Bowser's fix round (2026-11-15)

**Inputs, read as code:** `docs/fireworks-app/acceptance/phase-7.md` §C4, `docs/fireworks-app/design/phase-7.md` §3.1–3.2, §4, §5.2, §15, `bowser-phase7-review-fixes.md`, `rosalina-phase7-post-implementation-review.md`, `show-builder-page.{html,ts}`, `show-library.ts`, `json-panel.ts`, `shell-designer.store.ts`, `timeline.ts`, `styles.css`, `show-json.ts`, `pixi-renderer.ts`, `fireworks-stage.ts`, `testing/fake-stage-renderer.ts`, `ResponseHeaders.cs`, `ApiCacheControlLedgerTests.cs`.

### What
1. **Every gate script defaults to Chromium and keeps `ENGINES`** (Skyler 2026-11-15). `gate-csp` defaults to `ENGINES=chromium`, `gate-roundtrip`'s `JSON_ENGINE` defaults to `chromium` (a fresh profile; `none` skips it), and the new scripts take `ENGINES`.
2. **`gate-warm.mjs` MODE=early runs a paired, same-load, no-warm-up baseline** (7l.5, Skyler). The baseline is the same build with the builder chunk's compiled `(\`warmUp\`,!0)` flipped to `!1` through `page.route`. It is valid only if the patch applies exactly once and `data-warm-up` stays `off`. Pass per show: early p95 ≤ 4,330 ms, **or** ≤ 1.2 × the paired baseline p95, **and** every seek in both runs lands on its target (the scrub's bound value equals t). `MODE=nowarm-check` is the mechanism's own control: patched → `off`, unpatched → `running`.
3. **Gate scripts with one negative control per check class** (each Chromium-only by default, real header, no `bypassCSP`, no `waitForFunction`):
   - `gate-keyboard.mjs` (7g.1, 7g.2, K1–K9, 7c.3): `NEG=focus` (app `focus()` a no-op, `aria-disabled` mirrored to `disabled`) and `NEG=walk` (a tabindex=1 intruder, a self-removing first stop, listed controls pulled from the Tab order, outlines hidden). Checks that need no focus move are tagged `nat` and listed in the summary; no init-script control can fail them.
   - `gate-reduced-motion.mjs` (7h.1, 7h.2, 7h.4): `NEG=1` opens the "reduce" contexts at no-preference and writes the storage key after load.
   - `gate-touch.mjs` (7i.1 incl. `/s/<code>` and the toast ×, 7i.2, 7i.5, 7f.3 incl. the ruler at desktop DPR 2, C2-1): `NEG=1` uses a fine pointer, DPR 1 on desktop, and a DOM-swapped, `order:1` dock.
   - `gate-follow.mjs` (7j, C2 ruling 3): `NEG=1` sends no wheel.
4. **A pseudo-element read needs CDP in Chromium.** `getComputedStyle(range, '::-webkit-slider-thumb')` returns the input's own box. `gate-touch` reads the user-agent shadow tree with `DOM.getDocument({ pierce: true })`: the track is `pseudo="-webkit-slider-runnable-track"`, and the thumb is its child `id="thumb"`.
5. **7h.4 is asserted on behavior, not on the literal wording.** The build reaches "no slide" with `transition-property: none`, so the computed duration stays `0.15s`, and 7h.4's "transition-duration 0s" doesn't hold as written. The script toggles the switch and counts `::after` CSS transitions in `document.getAnimations()`: 0 under reduce, one of 150 ms without.
6. **7e.10 / 7n.2:** no control had been recorded. The existing spec asserts the fake's own `contextListener = null`, so it can't see the defect. Two specs were added to `fireworks-stage.phase7.spec.ts` (renderer listener left attached and firing lost and restored from inside `destroy`, as Pixi's `loseContext()` does). Their in-spec control is `delivered`, which proves the leaked events reach the host. The spec-side negative control (the leak not re-registered) fails both specs. The finding: leaving the renderer's listeners attached does **not** start a rebuild, because the host's `destroyed` and stage-identity guards stop it. 7e.10's sentence "listeners left attached make the navigation run show a rebuild" is false for this code. The renderer's `removeEventListener` is defense in depth, and no spec can see it (jsdom has no WebGL).

### Why
- A combined control hid four survivors (native Tab checks can't be failed by disabling `focus()`). One control per check class makes each survivor visible.
- A paired baseline is the only honest way to read an absolute bar at load 5–11.

### Boundary
- Mutants stayed within Skyler's constraint (security and save path only): four on the 500 ledger row (`ResponseHeaders.cs`), all killed. The UI was checked with negative controls only.
- **New defect, not in C2:** the root font is 13px (`styles.css:111`), so Tailwind's rem utilities fall short of p7-spec §5.2. `pointer-coarse:gap-2` is 6.5px, and `min-h-11` and `size-11` are 35.75px. The owner fixes it, and the coordinator decides who under lockout.

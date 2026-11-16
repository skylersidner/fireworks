# Toad — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0 to 7 are gated. Next: the post-Phase-7 testing interlude (fast show-testing strategy, with Yoshi, and the daily Firefox and WebKit run). Standing constraints: mutants only on engine, save-path and security or guard code; at most two agents at once; heavy runs serial.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phases 0 to 6 (compacted 2026-11-15)

- **Test-run rules:** `npm run typecheck` doesn't see Angular templates; `npm test` and `npm run build` do. Plain `dotnet test` doesn't cover `Program.cs`: the gated run (`FIREWORKS_TEST_POSTGRES`) is mandatory before "done" (`toad-postgres-gated-suite-is-required-for-program-cs.md`). `app.startup.spec.ts` asserts the sorted startup-request multiset.
- **Headless WebGL:** Pixi falls back silently; check `getContext('webgl2')`. Skill `.squad/skills/headless-webgl-smoke/SKILL.md`. Use `channel: 'chrome'`. Scripts live in the scratchpad, never the repo.
- **Oracle (Phase 2):** `record-prototype-golden.mjs` slices the prototype's `fire()` text. Sum checksums are blind to radial error, so the golden carries spread (`Σ|p−mean|`) (`toad-phase2ab-golden-spread-and-oracle-fire.md`). Parity P1–P27 in `docs/fireworks-app/acceptance/phase-2.md`. Compare at matched times. The fps kit `tools/fps-compare/` is kept and benched; its pass bar is historical (`toad-fps-kit-measurement.md`, superseded in part).
- **Leak check and Reduce flashing (Phase 2):** contexts created minus lost stays at 2 across `/` ↔ `/status`; `/status` "Back" is a plain href. `fireworks-stage.reduce-flashing.spec.ts` (equal sim traces with the flag on and off; 30 s timeout).
- **Fixtures (Phases 3 to 6):** generated, never hand-edited: `schema/tools/generate-fixtures.mjs` (`--check` diffs the disk). Limits from `schema/limits.json`; expected errors transcribed from schema.md §6, §2.6 and §12. Format spec `engine/model/schema-fixtures-format.spec.ts`. Server-only fixtures `{ description, body, status 400|413|415, errors?, contentType?, byteMarkers? }`, with `@@byte:ff@@` for raw bytes (`toad-phase3-server-only-wire-fields.md`). 176 fixtures; no exact count in code (lower bounds). The Done-when fixture `schema/fixtures/valid/show/done-when-60s-50.json` is value-equal to Luigi's `doneWhenShow()`.
- **Harness (Phase 4):** `CreationFixtureHarnessTests` runs on real Kestrel (`FireworksApiHarness`, port 0; no TestServer). Ledgers are exact and sorted (`SchemaFixtures.Ledger`). Prefer `SaveChangesInterceptor` or `DbCommandInterceptor` over timing loops (`toad-phase4-order-promises-are-asserted-on-the-sql.md`). Shared files: an exact one-occurrence swap, reversed afterwards; never restore from a backup copy.
- **Guard specs (Phases 5 and 6):** `unsafe-sinks.spec.ts` bans case-insensitively, including `createContextualFragment`, `setHTMLUnsafe`, `parseHTMLUnsafe` and `DOMParser`. C2 is an allowlist of URL-binding shapes (`SHIPPED_URL_BINDINGS`); C14 matches navigation calls on any receiver (8 shipped calls pinned); `BROWSER_NAVIGATION` bans `location.assign/replace`, `location.href =` and `window|globalThis.open(`. `showEntryViolations()` in `designer-structure.spec.ts` pins the show entry. Rules 11–12 (`toad-phase6-show-review.md`) are the spec for the next URL or navigation change: update the ledger in the same change; never widen a regex.
- **Round trips:** compare parsed values (`util.isDeepStrictEqual`); jsonb reorders keys. Write limit 20/min and 300/day, deletes included; wait 65 s between batches.
- **Phase 6 QA:** 48 mutants; 11 killed only by Toad's tests (Replay with no seek, Undo not setting dirty, Ctrl-only ⌘Z, flash spacing 39). A Replay test asserts the restart itself; move and delete tests use different cues and assert on the POST body.
- **Seek and config (Phase 6 post-gate):** web mutants 28 of 28 killed; API 10 of 10. `fireworks-stage.timeline.spec.ts` covers the chunk cap with a step-cost jump (use a getter on `clock.msPerStep`). `core/client-config.contract.spec.ts` reads `ApiContracts.cs`, the `[Range]` lines and `appsettings.json` (JSONC) as text.
- **Traps:** a compile break is not a kill (use type-preserving guards). Under load, default 5 s timeouts flake and fail only their own test. `timeline-driver.spec.ts` reads `../../../schema/fixtures`, so a mutant copy needs `schema` symlinked. The scratchpad is shared: use unique folder names.

### Folded from Phase 7 A3 and C3 (summarized 2026-11-15)

- **Caps and seek (`toad-phase7-caps-and-seek.md`):** cold and warm seeks are different questions. A freshly opened saved show has no checkpoints past the playhead, so the first far seek is a full run: realistic 600 s cold p95 3.6 to 4.9 s, warm 0.3 to 0.43 s. Report both, and say which one a trigger means. Caps don't move realistic seek cost (realistic shows sit at 10 to 28k particles). Method: `scratchpad/toad-a3/bench.mjs` (esbuild bundle, `FireworksSim({capacity})`); browser `scratchpad/pw/toad-a3.mjs` stubs `catchingUpDelayMs: 0`. Quote long tasks from the production build (API on 5180 serves `wwwroot`). Record machine load with every number.
- **C3 (`toad-phase7-c3-review.md`):** timeouts are load-only; heavy engine specs got explicit timeouts, and a timeout is never a kill. Runners: `scratchpad/toad-c3/mut.py` (copied web tree, schema symlinked) and `apimut.py`. The `.shells[` guard is a grep, so an aliased read passes it; the prototype-key round trip in `show-builder.store.spec.ts` is the second line. A store's draft write is an effect: call `TestBed.tick()` before `flushDraft()`.

## Learnings

### 2026-11-15 — Phase 7 C4 follow-up: gate scripts and the re-check of Bowser's fix round (record `toad-phase7-c3-review.md`, addendum)

- **Skyler, 2026-11-15:** regular runs and the gate use Chromium only, and Firefox and WebKit move to a daily run. Keep `ENGINES` in every script. 7l.5 passes at ≤ 4,330 ms **or** ≤ 1.2 × a paired, same-load, no-warm-up baseline, and `gate-warm` builds that baseline by flipping the builder chunk's compiled `` (`warmUp`,!0) `` through `page.route`.
- **One negative control per check class.** A single combined NEG for gate-keyboard left four survivors (native Tab checks don't depend on `focus()`). Tag each check with a kind (`focus`, `walk`, `nat`, `pre`), give each kind its own NEG, and list the `nat` checks (no focus move needed, so no control applies). Re-arm NEG side effects for each walk: a one-shot self-removing button only catches the first walk on a page.
- **The tab-walk harness:** derive the focusables from the DOM (tabIndex ≥ 0, not disabled, rendered, closed `<details>` contents skipped, one per radio group), start from a prepended `tabindex=-1` sentinel, then press Tab exactly N times. A listed control that is natively disabled in that state (Zoom out at Fit, Replay last before a launch) is not a miss.
- **`page.evaluate` works under the real CSP** (CDP doesn't go through `script-src`). Poll with evaluate instead of `waitForFunction`. Keep the harness's own `focus` (`window.__focus`) before NEG patches the prototype.
- **Chromium pseudo-elements:** `getComputedStyle(range, '::-webkit-slider-thumb')` returns the input's box. Use CDP `DOM.getDocument({ pierce: true })` plus `CSS.getComputedStyleForNode`. The track is `pseudo="-webkit-slider-runnable-track"`, and the thumb is its child `id="thumb"`.
- **The root font is 13px** (the prototype body), so every Tailwind rem utility is 0.8125× its nominal px: `gap-2` is 6.5px and `min-h-11`/`size-11` are 35.75px. Touch rules must use raw px. Found by gate-touch, and not in C2.
- **7h.4 as worded ("duration 0s") doesn't match the build** (`transition-property: none`, duration 0.15s). Assert behavior: `document.getAnimations()` filtered to `pseudoElement === '::after'` after a toggle.
- **7e.10:** listeners left on the renderer don't cause a rebuild, because the host guards it. The control lives in the spec (`delivered` proves the events reach the host). A fake that nulls its own listener can't test the real renderer's removal.
- **The 500 ledger row** (`ApiCacheControlLedgerTests` `GET api/me 500`) kills dropping the normalization, the value changed to `no-cache`, a kept Pragma and a kept Expires (`scratchpad/toad-c3/apimut2.py`).
- **Load:** `fireworks-stage.timeline.spec.ts` plus phase7 ran 53/53 in 23 s at load 4, so Bowser's two timeouts came from load.
- **The 5180 build lags the source.** Compare the `wwwroot` mtime with `find src -newer`. A fix that isn't in `wwwroot` fails on 5180, and that failure is the real pre-fix control (K9 before 17:09).

### 2026-11-15 — Phase 7 post-gate cross-agent update (Scribe)

- **Drop the leftover database.** Mario's gate found `fireworks_test_toad_c3` on the shared Postgres; it was not created at the gate. It is yours to drop. Scribe has not dropped it.
- **Yoshi's D1 changed one of your Phase 6 expectations.** `timeline-driver.spec.ts` now expects `[1200, 2400]` for the removal row (it asserted the defect before). Update any copy of that expectation in your mutant runners.
- **Gate scripts stay Chromium-only.** Mario's gate ran the `scratchpad/toad-c3/gate/` scripts. Keep `ENGINES` in each one.
- **Your interlude:** the fast show-testing strategy and the daily Firefox and WebKit run are yours, with Yoshi. Rows 7b.7, 7k.3 and 7j.4 now read "daily run".

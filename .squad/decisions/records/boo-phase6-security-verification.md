# Phase 6 security verification: C1–C17 on the show surfaces, plus the new builder surfaces

**By:** Boo · 2026-11-14 · Phase 6, after the build batch, Bowser's B1–B3 and Mario's gate
**Status:** proposed. Verdicts on `boo-phase5-security-requirements.md` for the Show Builder, show links, the show player and `/mine` for both kinds. This record closes the open "C5 for shows" note in `boo-phase5-security-verification.md` and the pending C17 re-check on the final banner copy. No product or spec code changed (strict lockout).
**Surfaces:**
- **Code** under `src/web/fireworks-web/src`: `app/features/show/**`, `app/core/{open-creation,device-preferences}.ts`, `app/features/player/pages/player-page/*`, `app/features/mine/**`, `app/shared/{bidi,test-mode-banner}.ts`, `engine/model/{open,normalize,limits}.ts`, `engine/loop/timeline-driver.ts`, `engine/sim/{particle-store,simulation}.ts` and `app/shared/fireworks-stage/fireworks-stage.ts`.
- **Guard specs:** `app/unsafe-sinks.spec.ts`, `features/designer/designer-structure.spec.ts` and `features/show/shared/show-draft.spec.ts`. 22/22 pass. Their regexes were mutation-checked in node, not by editing product files.
- **Running app:** the ng dev server on 4200 and the API on 5180 with writes on, driven by Playwright with installed Chrome. Scripts are in the session scratchpad: `pw/boo-p6.mjs`, `pw/boo-p6b.mjs`, `pw/boo-p6c.mjs` and `boo-bench/bench.ts`. Ten real writes were made, paced at 3.2 s or more apart. All four created rows were deleted (204 each). Save-failure cases used `page.route` stubs, so they made no real writes.
- **In flux, not reviewed:** the API banner on `api/me` failure, session handling, and ⌘Z on select and range controls (Luigi's concurrent change). Re-checks are listed at the end.

## Verdicts

| # | Verdict | Evidence |
|---|---|---|
| C1 | **PASS** | No sink in any non-spec file (spec green). Hostile names render as literal text in every show surface tested: show name `<img src=x onerror=alert(1)>`, shell names `‮ximer`, `{{7*7}}`, `"><svg onload=alert(1)>` and `<b>x</b>`. Surfaces: `/s/` heading, `document.title`, library "In this show" (`<bdi>`), inspector heading (`<bdi>`), cue list (`<bdi>`, 4 of 4), shell `<option>`s, toasts and confirm dialogs. 0 injected elements and 0 dialogs fired. The frame hook writes only `textContent` of time strings (`show-builder-page.ts:532`, `player-page.ts:195`). The timeline canvas `fillText`s only fixed copy and times, never a name. |
| C2 | **PASS** in code; **verifier gap** F2 | Every `routerLink` and `navigate` uses a literal or a checked code. Names reach only `[title]`, `[attr.aria-label]` and text. `data-testid`s are built from checked codes or keys. The spec's `\bname\b` heuristic misses the builder's name carriers (F2). |
| C3 | **PASS** | Show copy isolates every name with FSI/PDI (`show-copy.ts`: announcements, the open/new/remove-shell confirms and the library item notes). Templates use `<bdi>`. Running app: the remove-shell title is `Remove “⁨‮ximer⁩” from the show?`, the open-link confirm wraps both names, and the "Added" announcement is `Added ⁨‮ximer⁩ at 0:00.0.` The shell `<option>` labels aren't isolated, but an option is its own element, so this is accepted under the Phase 5 C3 verdict (F4). |
| C4 | **PASS** | `openCreation` runs `isShareCode` before the GET and checks the response `shareCode` after it. The library filters list items with `isShareCode`, and `fetchShell` re-checks before `openCreation`. `ShowSaveFlow.share` re-checks. `readSource(…, 'show')` checks the draft. Running app: `/s/..%2Fme`, `/s/abcdefgl` and `/c/..%2Fme` gave not-found with 0 `/api/creations` requests. After `/c/<show>`, the draft `source.shareCode` equals the response's. |
| C5 | **PASS** (shows re-verified) | `classifyCreation` (`open-creation.ts:75`) checks `kind` at runtime: anything other than `'shell'` or `'show'` is not-found. It then checks the response code, then `openShow` (upgrade, then lenient normalize), before the player's `TimelineDriver` or the `/c/` handoff. The builder takes the handoff through `structuredClone`. The player and `document.title` display the normalized `show.name`. Library adds go `openCreation` → `'show'` → "gone", and `'shell'` → `embeddable` (openShell again). Specs: `open-link-page.spec.ts:367,390` (gallery, show v2), `player-page.show.spec.ts`. `unsafe-sinks.spec.ts` C4/C5 pins `getByShareCode` to one caller and `openCreation` to three. |
| C6 | **PASS** | `readShowDraft` → `readSource(raw.source, 'show')`, all or nothing. Running app: a draft `source.shareCode` of `../me` restores the show with no Share control and makes 0 requests. |
| C7 | **PASS** | The builder Save POST has keys `["document","kind"]` and no newline (running app). Embedded keys `constructor` and `toString` go through unchanged. PUT and remix bodies come from `creation-save.ts`, which is unchanged since Phase 5. No request carries `isOwner`, an id or `remixedFrom`. |
| C8 | **PASS** | Stubbed ledgers in the running app: a PUT 404 then Save as new is `[PUT, POST api/creations]`; a 429 is `[PUT]` only; a 403 is `[PUT, GET api/me]`, followed by the library's own list reload because the real `api/me` still says writes are on. Nothing retried. `save()` sets `saving` only after `saveCreation` was built, so the Phase 5 F3 shape (stuck "Saving…") can't recur. |
| C9 | **PASS** | Running app with `api/me` stubbed to `canWrite: false` and a draft `source.isOwner: true`: no Save, Update or Save as new control, no "My shells" group, no test-mode banner, and 0 `api/me/creations` or `api/creations` calls. |
| C10 | **PASS** | `remixedFrom` appears in no file under `features/show` (spec C10). Running app: the show remix's `/s/` page `innerText` doesn't contain the original's code. The GET still returns it (accepted interim, S13). |
| C11 | **PASS** | `ShowSaveFlow.share` builds `${location.origin}/s/${code}` from the checked `source.shareCode`. Running app, after a builder Save: the clipboard stub got exactly `["http://localhost:4200/s/rh3CuZnG"]`. |
| C12 | **PASS** | Running app: `/s/..%2Fme`, `/s/abcdefgl`, `/s/ZZZZZZZZ`, `/c/..%2Fme` and `/c/ZZZZZZZZ` all render "Nothing plays at this link". Request counts are 0, 0, 1, 0 and 1. |
| C13 | **PASS** | Running app: `/c/<show>` over a dirty builder shows "Open “…”?". Keep editing leaves `fireworks.showDraft.v1` byte-identical, and the ledger is `[GET api/creations/{code}]` only. A clean builder loads at once, also with GET only. |
| C14 | **PASS** in code; **verifier gap** F2 | `/c/` uses `navigateByUrl('/show', { replaceUrl: true })`. Running app: `/c/<code>?returnUrl=https://evil.example&next=//evil.example` lands on `http://localhost:4200/show`. |
| C15 | **PASS** | A server 400 whose `message`, issue `message` and issue `value` are all `evil.example` gives a DOM without `evil.example` (running app). `saveFailureStatus` drops server `message` and `value`. `showIssueReason` words issues from code and path, with names isolated. |
| C16 | **PASS** | The only `console.*` calls on these surfaces are `open-creation.ts:88,93` (code plus issue codes and paths) and `mine.store.ts:51` (fixed text). |
| C17 | **PASS**, and it closes the Phase 5 re-check | `<app-test-mode-banner />` is on `/show` (`show-builder-page.html:35`), the designer, the player (both variants) and `/mine`. The final `TEST_MODE_TEXT` states both required facts: anyone can change or delete any creation, and a link may later play something else. Running app: visible on `/s/<show>` and `/show` with writes on, hidden with `canWrite: false`. |

## New attack surfaces

**Tampered show draft: no crash and no pollution, but the seek is not time-bounded (F1).** Each case was restored in the running app. `stored unchanged` was true in every case, so a rejected draft is ignored, not overwritten.
- **Rejected without error:** a `__proto__` shell key (raw JSON text), a cue naming the non-own key `toString`, `duration: 1e999` (`JSON.parse` gives Infinity), and 1001 cues. Each one restores to an empty "New show". `({}).polluted` stays undefined and `({}).constructor` is still a function.
- `view: {pxPerSecond: 1e-300, scroll: 1e308}` is accepted by `readView`, then clamped by `effectivePxPerSecond` and `clampScroll`. Tick loops stay bounded (step ≥ 0.5 s).
- **At the maximums** (`at-maximums.json`: 32 shells × 4 breaks, 1000 cues, 600 s): restore takes about 2 s, with a longest task of 213 ms. The ceiling is set by `openShow` and normalize (1000 cues, 32 shells, 4 breaks, ≤ 400 stars, duration ≤ 600) and by `CAP` = 40,000 particles.

**Embedded shell keys: safe, though not null-prototype end to end (F3).** `normalizeShow` builds `shells` with `Object.create(null)`, and `KEY_PATTERN` (`^[A-Za-z]…`) rules out `__proto__`. The server also rejects it: `400 key-format shells`.
- Downstream, the map becomes a plain object: `{ ...shells }` in `show-draft.ts:57,75`, `show-builder.store.ts:510` and `show-edit.ts`, and `structuredClone` in `loadCopy`.
- Prototype names that pass the pattern (`constructor`, `toString`, `valueOf`) survive as own keys. Running app: a show saved and re-opened with exactly those three keys plays, edits, lists, confirms and saves correctly.
- Every lookup by a key that didn't come from the document uses `Object.hasOwn` (`readActive`, `localShell`, `removeShell`, the timeline layout, `TimelineDriver`'s constructor). The rest index by `cue.shell`, which normalize guarantees is an own key.

**Library add path: PASS.** List items are filtered by `kind === 'shell' && isShareCode`. Each add costs one `openCreation` GET for the item's checked code, and is then cached per code. A new add unsubscribes the previous one, so rapid presses cancel instead of fanning out. A show at that code reads as "gone". The name in item notes is isolated.

**Checkpoint memory: PASS (hard bound on what is counted).** One snapshot is at most 40,000 particles × 64 B = 2.56 MB, plus 128 B per shell in flight. `takeCheckpoint` doubles the spacing while the counted bytes exceed 64 MiB, and keeps at least one checkpoint. Measured worst case (node, `at-maximums` run to the end): 15 checkpoints, 35.6 MiB. Each checkpoint also holds an uncounted copy of the ledger (at most 1000 small entries), about 100 KB, which is negligible. Each edit builds a new driver that inherits only the filtered checkpoints; the old driver is dropped. Undo holds at most 50 documents. Tab heap after the seek: 125 MiB.

**`fireworks.motionBlur.v1`: clean, self-only.** `readMotionBlur` turns the text into a number, rejects non-finite values (`Infinity`, `1e400`) and clamps to 0..0.92. The value is never sent, never rendered and never put in a document. `adoptLegacyMotionBlur` takes only a number from the designer draft, which `readDraft` has already normalized.

## Findings

**F1 [low] `app/shared/fireworks-stage/fireworks-stage.ts:51,348`: the seek is bounded by steps per frame, not by time.**
- **Attack:** someone shares a valid maximum show as a `/c/` link (the server accepts it). The victim scrubs or presses End in the builder.
- **Effect:** `SEEK_STEPS_PER_FRAME = 480` steps at 40,000 live particles cost about 0.9 s per frame in node and 2.0–2.2 s in headless Chrome on the dev build. Seeking to the end of `at-maximums` took 120 s in node and 142 s in the browser, with 152 long tasks. "Catching up…" shows, but Pause, Space and edits wait a second or two each. An edit during play re-seeks from the latest kept checkpoint, and after thinning that can be 9,600 steps (about 20 such frames).
- **Not affected:** the player, which plays in real time and seeks only to 0 on Replay. No data is affected, and the tab recovers.
- **Fix (Luigi, the stage owner; Yoshi if the driver API changes):** budget each frame's seek by time. For example, call `timeline.seek(loop, target, 16)` in a loop until about 8 ms of `performance.now()` have passed. Optionally run the scrub preview with checkpoints at a denser spacing.

**F2 [low, verifier] `app/unsafe-sinks.spec.ts`: the C2 and C14 guards are narrower than the builder's code.** Measured by running the spec's own regexes in node:
- `NAME_IN_URL` misses `[href]="shellNameOf(cue)"`, `[href]="activeName()"`, `[href]="o.label"` and `[href]="d.title"`, and `href="{{ shellNameOf(cue) }}"`. All of these carry stranger-controlled names in the builder. This is the same family as the "name"-only heuristic question from Phase 5.
- The C14 regex `router\.(navigateByUrl|navigate)\(` doesn't see `this.r.navigateByUrl(x)`, `inject(Router).navigateByUrl(x)` or `location.assign(x)` / `location.href =`.

No shipped file does any of these, so this is a verifier gap, not a live bug.
**Fix (Toad):** for C2, ban any non-literal binding on a URL attribute except an allowlist of code-shaped expressions (`shareCode`, `code`). For C14, match `\.(navigateByUrl|navigate)\(` on any receiver, and ban `location.(assign|replace)(` and `location.href =`. Add each string above as a negative control.

**F3 [info] `features/show/shared/show-draft.ts:57,75`, `show-builder.store.ts:509–510`: the shells map loses its null prototype after normalize.** It is safe today, for the reasons under "Embedded shell keys". The lookups that don't use `hasOwn` (`show-builder-page.ts:360,662,738,823`, `show-builder-page.html:103,163`, `player-page.ts:164`) rely on the invariant that every `cue.shell` is an own key. Hardening, if anyone touches these files: either keep `Object.hasOwn` at every lookup, or copy with `Object.assign(Object.create(null), …)`. Toad could add a builder round-trip spec with keys `constructor` and `toString`, since only my probe covers them today.

**F4 [info] `features/show/shared/show-edit.ts:213` `shellOptionLabels`: `<option>` labels aren't isolated.** Each option is its own element, so bidi can't cross it. Accepted under the Phase 5 C3 verdict.

**F5 [info, verifier] `designer-structure.spec.ts`: there's no show twin of the designer's F6 rule.** The designer's rule says untrusted shells enter only through `openShell`. Nothing structurally pins show draft restore and the `/c/` handoff to `openShow`; today `normalizeShow` has two direct callers: `open.ts`, and `show-save.ts` on the store's own document. Hardening for Toad: assert that `normalizeShow(` callers are exactly `engine/model/open.ts` and `show-save.ts`, and that `show-draft.ts` reaches `openShow`.

## Spot-check of the guard specs

- **`designer-structure.spec.ts`:** the exact-equality `ALLOWED` map covers `features/show` (its walk includes `timeline/`). The builder page is held to `api-status` only. `show-save.ts` and `show-library.ts` have tight entries, and the store, draft, edit and handoff files must reach nothing. This is sound, and I agree with Toad's "narrow".
- **`unsafe-sinks.spec.ts`:** C1 is solid (case-insensitive, with 26 negative controls). The C4/C5 single-entry rule now includes `show-library.ts`, which is right. C2 and C14 have the F2 gaps.

## Re-check once Luigi lands (in flux)

1. **API banner on `api/me` failure:** if `show-builder-page.ts` starts injecting `SessionService`, the `ALLOWED` entry must change by exactly that hit, and the store must still reach nothing. The banner must show fixed copy, never server text. Try again must not retry in a loop.
2. **⌘Z on select and range controls:** a control-local undo must not write a document that bypasses `store.edit` (dirty and the F4 `saved` rule). The page-level Undo must still be the only document history.

## Boundary

- These are verdicts only. F1 goes to Luigi (stage), F2 and F5 to Toad (verifier), and F3 and F4 are info. The coordinator routes them.
- C18 (S5, S21 and the S28 runbook) and C20 on the Production build stay deferred to the Railway test window. Nothing in Phase 6 changes them, but the show POST at `at-maximums` (210,819 B fixture) is the S5 body to send through the edge.
- The dev-server timings in F1 overstate the cost of a Production build. The node figure (0.9 s per frame) is the optimized-JIT floor.

## Addendum, 2026-11-15: `GET api/client-config`, client playback config, and the F1 re-check

**Scope.** Bowser's `ClientConfigController`, `Services/ClientConfig/*`, `ApiContracts.cs`, the Program.cs wiring and `appsettings.json`. Luigi's `core/client-config.ts`, `core/client-config-loader.ts`, `fireworks-stage.ts` `seekSlice`, `core/api-status.ts` (`bannerStatus`, `retry`) and the builder's `FORM_FIELDS`. Running app: API on 5180 (Debug build at 10:30, newer than the controller source at 10:24) and the dev server on 4200. **No real writes were made.** The hostile config was a `page.route` stub. Scripts are `scratchpad/pw/boo-f1v.mjs`, with logs `boo-f1v-default.log` and `boo-f1v-hostile.log`.

### Endpoint: PASS, no leak
- **Response:** exactly the four integers, `{"playback":{"seekBudgetMs":25,"catchingUpDelayMs":300,"checkpointIntervalSeconds":10,"checkpointMemoryMiB":64}}`. It carries no identity, environment, connection or host data. The controller uses no `ICurrentUser` and no service. Query strings (`?seekBudgetMs=999`), `X-Forwarded-For` and `Origin: https://evil.example` don't change it, and no CORS header comes back.
- **Headers:** `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on the 200 and on every 404 (running app). `Server: Kestrel` is the Phase 7 item that already exists, not a new one.
- **Methods:** HEAD, POST, PUT, DELETE, PATCH, OPTIONS and a form-encoded POST all return an empty `/api` 404. That matches `POST/DELETE api/me`, so it is the project's convention, not a 405 leak. `Unsupported_methods_fall_to_the_api_404_not_the_spa` pins it.
- **Form gate:** the form value providers are removed globally (`ControllersRegistration.cs:26-28`). The action binds nothing, so the gate doesn't apply.
- **Rate limit:** `[EnableRateLimiting(ReadPolicy)]`. `ClientConfigEndpointTests` shares one bucket with `api/me` (limit 3: me, cfg, cfg, then 429 with Retry-After and no-store). `CreationRateLimitTests:117` includes it in the 120-read sweep. I didn't exhaust the live bucket because Toad shares it. A 429 only costs the client its defaults, silently.
- **Validation:** `[Range]` checks run eagerly at registration, before the database, plus `ValidateOnStart`. Both sides use the same ranges.

### Client handling of a hostile config: safe, but the upper ranges are too generous
- **Clamping:** `clampPlayback` accepts only finite numbers and clamps each one. Anything else takes its default, and unknown keys are dropped. The driver floors `checkpointSteps` (`timeline-driver.ts:164`). The value is never rendered.
- **Stub test:** `{seekBudgetMs:1e9, catchingUpDelayMs:-5, checkpointIntervalSeconds:0.001, checkpointMemoryMiB:1e12, extra:'<img onerror>'}` clamped to 100/0/1/512, with 0 injected elements and 0 dialogs. The loader swallows errors and makes no retry.
- **MITM:** a MITM before HTTPS could inject script directly, so the clamp defends against misconfiguration, not MITM.
- **Max-show seek with the worst in-range config (100 ms, 1 s, 512 MiB), on an Intel UHD 630 desktop:**
  - frames p50 117 ms, p99 250 ms, max 317 ms;
  - 1,536 long tasks;
  - real-mouse input: Event Timing duration up to 440 ms (wait up to 228 ms);
  - **510 MiB of checkpoint buffers held** (155 snapshots). The JS heap reads 47 MiB because typed-array buffers are counted outside it.
- **Defaults for comparison:** the total seek time was the same, 183 s in both runs. So the 100 ms budget buys no throughput and costs responsiveness.
- **Risk:** 512 MiB is enough to get a tab OOM-killed on a low-memory phone or a Chromebook. That is a self-DoS by the operator, not an attacker. **Severity: low (hardening).**
- **Suggested tighter ranges (Skyler's call):** `SeekBudgetMs` 4–50 and `CheckpointMemoryMiB` 8–128, changed on both sides together.

### F1: PASS (closed on the running app)
- **Fix:** `seekSlice` is bounded by time. It always runs one step, then sizes chunks from the measured cost per step (≤ 32 steps between clock reads), and stops when the budget is used up. Overshoot is about one chunk.
- **Running app, defaults, max show to the end:**
  - 183.8 s;
  - frames p50 33 ms, p90 33 ms, p99 83 ms, max 217 ms;
  - longest task 214 ms;
  - real-mouse Pause/Play during the seek: Event Timing duration ≤ 120 ms, input wait ≤ 79 ms, click pairs 66–127 ms.
- **Before the fix:** 0.9–2.2 s per frame, and the UI blocked for seconds.
- **Luigi's 461 ms Pause:** this is Playwright's `locator.click` actionability overhead (it waits for stability across frames), not handler latency. Event Timing is the honest measure.
- **Residual:** the 100–200 ms tasks are render and GC, not the seek. The 3-minute catch-up for a max show is UX, not security (Luigi/Rosalina, if anyone wants checkpoints denser by default).

### Re-check list: all PASS
1. **Banner:** shows only constant copy (`BUILDER_API_BANNER` / `API_BANNER_DESIGNER` through `[message]`, plus fixed `Checking…`/`Try again`). `bannerStatus` reads only load statuses, never server text or identity.
   - Try again works only on click and is disabled while `checking`. `check()` ignores re-entry, and nothing retries on a timer or on error.
   - One edge: if `/health/live` has already failed while `api/me` is still loading, the button is enabled, so a second click can overlap a `session.load()`. It is user-paced and the later answer wins. Info.
2. **⌘Z:** `FORM_FIELDS` only widens an early `return` (no `preventDefault`), which removes a path rather than adding one.
   - A native undo arrives as `input`/`change` on the same bindings (`onName` → `store.setName`, `setCueShell` → `store.updateCue`, `commit*`), so every document write still goes through the store's edit methods.
   - The page writes no `show` signal itself, and page Undo/Redo stay the only document history.
3. **Allowlist:** `ALLOWED` for `show-builder-page.ts` is still exactly `import core/api-status` and `inject(ApiStatusService)`, so there was no growth. The banner reaches the session core to core through `ApiStatusService`.
   - `BANNED_CORE` gained `client-config-loader` (a tightening). Only `app.config.ts` imports the loader.
   - The value-only `core/client-config.ts` is read by the stage, the builder store and the player, and it does no HTTP.

### Boundary
- The endpoint stays anonymous, identity-free and read-limited (Bowser's record). Anything user-specific belongs on `api/me`.
- If the ranges are tightened, the `[Range]` attributes, `PLAYBACK_LIMITS`, the README and the committed-config tests all change in one batch (Bowser and Luigi).

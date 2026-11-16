# Phase 7 acceptance criteria: polish and deploy hardening

Owner: Peach. Written 2026-11-15 (batch A5), before implementation. B1 (Bowser) and B2/B3 (Luigi) build against this file; C1–C4 and Mario's gate check it.

**Sources.** `plans/initial-implementation.md` §Phase 7 (7.1 scope, 7.2 Done-when, 7.5 answers and further rulings). Rosalina's `docs/fireworks-app/design/phase-7.md`, cited as **p7-spec §n**. Copy quoted below is p7-spec's; where a row says "p7-spec copy" without quoting it, the cited section holds the exact text and the check is an exact string match. Boo's `.squad/decisions/records/boo-phase7-security-requirements.md`, cited as **P7-Sn**. Yoshi's `.squad/decisions/records/yoshi-phase7-architecture-rulings.md`, cited as **Y§n**. Toad's `.squad/decisions/records/toad-phase7-caps-and-seek.md`, cited as **A3**. Phase 6 criteria are cited as `acceptance/phase-6.md` 6x.n.

**Code read for this file:** `app/core/models.ts` (`PlaybackClientConfig` at l.108; `updatedAt` is a string token, l.32–53), `Contracts/ApiContracts.cs` (`ClientPlaybackConfig`, l.40), `Services/ApiResponseHeaders.cs` (still overwrites `Cache-Control` with `no-store`, l.31), `Program.cs` (step 6a), `Controllers/CreationsController.cs` (no ETag yet), `shared/fireworks-stage/fireworks-stage.{ts,html}` (`data-status`, `data-renderer`; startup copy still names "your shell" on every surface), `show-builder.store.ts` (`edit`/`undo`/`redo`, l.232–283), `shell-designer.store.ts` (`applyLoaded` never writes `source`, l.468), `pages/link-not-found/link-not-found-page.ts`, `README.md` (l.55 still says "There are no backups until Phase 7"), and the storage keys `fireworks.showDraft.v1`, `fireworks.draft.v1`, `fireworks.reduceFlashing.v1`, `fireworks.motionBlur.v1`, `fireworks.flashNotice.v1`.

**Rulings applied (Skyler, 2026-11-15):** Railway is deferred, so every **[R]** row is **DEFERRED** and Phase 7 passes on image evidence. No fps-driven automatic quality; the mobile DPR cap ships. Caps stay at 40,000 particles and 600 s. Background checkpoint warm-up ships, accepted by re-running A3's cold realistic row on the production build. CSP `style-src 'unsafe-inline'` is an accepted residual (scripts strict, no `unsafe-eval`). Show JSON Apply is one Undo step. ⌘/Ctrl+S with two save choices moves focus to `Update original` and sends nothing. No If-Match in Phase 7; the ETag is `"<updatedAt>"`.

### Surfaces

Every row names where it's checked:

- **image**: only on `docker build` (all three stages) plus `docker run` against a fresh database (skill `probe-the-published-build`). A dev server, `ng serve` proxy or route-injected header doesn't count.
- **app**: the running app in a real browser, either the dev stack or the image. Playwright where it says so.
- **spec**: Vitest (web) or xUnit (API), with a recorded negative control where this file asks for one (standing decision: verify the verifier).
- **file**: the repo text, a README or a record.
- **[R] DEFERRED**: only checkable through Railway's edge. Not run in Phase 7, and the gate records it as DEFERRED.

"Headers match" means byte for byte against P7-S1's site-wide set and the P7-S4 table. A `curl -sD- -o /dev/null` capture is the evidence.

---

## 7a. Caching and the ETag (Done-when 1)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7a.1 | **Hashed bundles are immutable.** `curl -I` on a `main-*.js`, a `chunk-*.js` (including one whose hash starts with `-`, such as `chunk--30TBvoS.js`) and the `styles-*.css` named in the built `index.html` gives `Cache-Control: public, max-age=31536000, immutable`, plus `ETag` and `Last-Modified`. | image |
| 7a.2 | **The shell revalidates.** `/`, `/index.html`, `/show`, `/mine`, `/s/<code>` and `/c/<code>` each give 200 `text/html` with `Cache-Control: no-cache` and an `ETag`. Sending that ETag back as `If-None-Match` gives 304 with an empty body. | image |
| 7a.3 | **Unhashed static files aren't immutable.** `/favicon.svg` and `/3rdpartylicenses.txt` give `Cache-Control: no-cache`. A static miss shaped like a bundle (`/chunk-AAAAAAAA.js`) and `/nope.js` give 404 with `no-store`, never `immutable` (P7-S4). | image |
| 7a.4 | **The share-code GET carries the token.** `GET api/creations/{code}` gives 200 with `ETag` equal to `"` + the body's `updatedAt` string + `"` (compare against the raw JSON text, not a reparsed date), and `Cache-Control: private, no-cache`. A 404 on the same route gives `no-store`. | image; spec (harness) |
| 7a.5 | **304 path.** The same GET with `If-None-Match: <tag>` gives 304, 0 body bytes, the same `ETag`, `private, no-cache` and the site-wide headers. `W/<tag>` gives 304. A list containing the tag gives 304. `*` gives 304. A garbage tag gives 200 with the body. `If-Match` with any value is ignored (200, never 412). | image; spec |
| 7a.6 | **A PUT changes the tag.** Writes on: GET gives tag T. PUT `api/creations/{code}` returns a response whose `ETag` is the new body's quoted `updatedAt` (Y§4: POST, PUT and remix responses carry it too). Then GET with `If-None-Match: T` gives 200 with a tag ≠ T, and that tag equals the PUT response's tag. | image; spec |
| 7a.7 | **Exact ledger of relaxed caching (P7-S5).** _Status: the 500 ledger row is in place (`ApiCacheControlLedgerTests.cs`) and Toad's four mutants on it (`ResponseHeaders.cs`) are killed._ A test enumerates every `/api` endpoint and status it can return, including a forced 500. Only `GET api/creations/{code}` 200 and 304 carry a `Cache-Control` other than `no-store`; the one allowed exception is the 500, which carries the exception handler's `no-cache,no-store` and has its own ledger row (amended in C4 for Boo's F1). POST, PUT and remix responses keep `no-store` even though they carry an `ETag`. | spec |
| 7a.8 | **Negative controls, recorded.** Each of the following fails the header test: (a) removing the immutable rule; (b) restoring the unconditional overwrite in `ApiResponseHeaders` (the share GET goes back to `no-store`); (c) serializing the tag with `ToString("O")` (seven fractional digits, so the tag ≠ the body's `updatedAt`; Y§4). | spec; record |

## 7b. Security headers and CSP (Done-when 2)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7b.1 | **Site-wide headers on every response class.** Each of these has exactly the P7-S1 set (`Content-Security-Policy` as in 7b.2, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`): index, a deep link, a hashed asset, a 304, `api/me` 200, `/api/nope` 404, 413 (writes on, 300 KB declared body), 429 (read burst), a forced 500, a 405 on a deep link, `/health/live`, and `/health/ready` both 200 and 503. | image |
| 7b.2 | **The CSP is enforced, and it is this exact string:** `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`. The header name is `Content-Security-Policy`, not `-Report-Only`. No `<meta http-equiv>` policy is in `index.html`. | image; file |
| 7b.3 | **No `Server` header anywhere,** including Kestrel's own 400 (`Host: a b`) and 431 (a 40 KB header sent over a raw socket) (P7-S2). | image |
| 7b.4 | **HSTS only over forwarded HTTPS.** With `X-Forwarded-Proto: https` and `Host: fireworks.example`, `/` has `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`, no `preload`). Without the proto header it's absent (P7-S3). Through the edge: **[R] DEFERRED**. | image |
| 7b.5 | **The built `index.html` has no inline code.** No `<script>` without `src`, no `<style`, no `data-beasties`, and a plain `<link rel="stylesheet">` for `styles-*.css` (P7-S11, P7-S12). | image (file in the image's `wwwroot`) |
| 7b.6 | **Pixi runs without `unsafe-eval`.** `engine/render/pixi-renderer.ts`'s first import is `pixi.js/unsafe-eval`, and a structure spec asserts that. Negative control: removing the import fails the spec, and on a scratch image the stage logs a `script-src eval` violation and doesn't start (P7-S10). A grep of the bundle for `new Function` isn't evidence either way (Boo §1). | spec; image (control) |
| 7b.7 | **Zero CSP violations, on the image with the real header** (P7-S13). Engines: Chromium at gate; Firefox and WebKit in the daily run (to be defined) (Skyler, 2026-11-15). In Playwright, with a `securitypolicyviolation` recorder from an init script and console capture, these produce 0 violations, 0 `pageerror` and a stage canvas on each stage page: `/` auto-playing (dismiss the notice); `/show` with a seek; `/c/<show>`; `/s/<shell>` and `/s/<show>` playing; `/mine` listing (writes on); `/status`; the not-found pages (`/s/abcdefgl`, `/c/..%2Fme`). Negative control: the same run served with `script-src 'none'` reports a nonzero count. Firefox and WebKit results are not part of the gate; until the daily run exists they are recorded as not run, not as passing. | image; Playwright |
| 7b.8 | **The `unsafe-eval` decision is recorded with its evidence.** Boo's record §1–§2 holds it (measured violations before, zero after, +1.6 KB gzip). | file (done) |
| 7b.9 | **Show JSON Apply is the only new show entry.** Toad's `showEntryViolations()` ledger gains exactly one caller, Show JSON Apply calling `openShow`, by a reviewed change. `upgradeShow` and `normalizeShow` get no new callers (P7-S14). The note and the textarea render text only (`unsafe-sinks.spec.ts` stays green with no new allowance). | spec |

## 7c. Pipeline edges (Done-when 3)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7c.1 | **`/health/ready` is a real check.** It gives 200 `text/plain` with the body `Healthy`. After `DROP DATABASE … WITH (FORCE)` on the instance's throwaway database (or stopping a gate-only container; never the shared `fireworks-postgres`), it gives 503 `text/plain` with `Unhealthy`, and its body contains no exception text and no connection string. `/health/live` stays 200 throughout. It is never `text/html`. Negative control: unmapping it makes the test see `text/html` and fail (P7-S6). | image; spec |
| 7c.2 | **`/health/ready/x` isn't the health check.** It gives the SPA fallback (200 `text/html`, `no-cache`), not a health body. | image |
| 7c.3 | **A dotted last segment shows the app's not-found page.** `/c/..%2Fme`, `/s/..%2Fme` and `/s/a.b` give 200 `text/html` with `no-cache` and the site-wide headers. In the browser, each renders `LinkNotFoundPageComponent`'s message (the same heading and button as `/s/abcdefgl`, by surface: player under `/s/`, editor under `/c/`), its `h1` has focus, and the Network log shows no `api/creations` request (C4) (P7-S7). `/nope.js` stays a bare 404 with `no-store`. | image; app |
| 7c.4 | **Chunked over-limit writes close the connection.** One Python `http.client` connection sends a chunked 300 KB `POST api/creations`: the response is 413 (writes on) or 403 (writes off) with `Connection: close`, and the next request on the same client object succeeds. Mutant: without the `ContentLength is null && CanHaveBody` branch, the second request fails (P7-S8). Through the edge: **[R] DEFERRED**. | spec (Kestrel harness); image |
| 7c.5 | **No compression.** No `Content-Encoding` on any response, with or without `Accept-Encoding: gzip, br` (P7-S9). | image |

## 7d. Operations (Done-when 4)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7d.1 | **The takedown runbook works as written.** README has a takedown section with the SQL to delete one creation by share code, plus a before and after check. Run verbatim on the gate database holding at least two creations, it deletes exactly the one with that code: the count drops by exactly 1, the other code still gives 200, and the deleted code's `GET api/creations/{code}` is 404 and `/s/{code}` shows the app's not-found page. | image; file |
| 7d.2 | **The local backup and restore procedure is rehearsed.** README's procedure: `pg_dump` from the gate database, restore into an empty database, after which `count(*)` and `max(updated_at)` on `creations` match the source. The README records the rehearsal's date and numbers. | image; file |
| 7d.3 | **The stale sentence is gone.** README no longer says "There are no backups until Phase 7" (l.55 today). It says what backup exists now (the local procedure) and that Railway backups wait for the first deploy. | file |
| 7d.4 | **Railway Postgres backups enabled, one listed in the dashboard.** **[R] DEFERRED** (Skyler, Q7.1). | [R] |

## 7e. WebGL context loss (Done-when 5)

Applies to `/`, `/show`, `/s/<shell>` and `/s/<show>`. "Lose" means `WEBGL_lose_context.loseContext()` on the stage canvas. "Restore" means `restoreContext()` on the same extension object (Pixi only auto-restores losses it forced, Y§1). Read state from the stage host's `data-status` attribute, the DOM copy and the readouts.

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7e.1 | **Quick loss and restore shows nothing.** Restore 300 ms after the loss: no status line, no failure block, no toast at any point. `data-status` goes `running`, then `lost`, then `running`. | app (Playwright) |
| 7e.2 | **Status line after 1 s.** Lost for over 1 s: the stage shows `Graphics paused by the browser. Playback resumes when they're back.` in an element with `role="status"`, bottom left of the stage. On `/show` it replaces `Catching up…` while it shows. Focus doesn't move (`document.activeElement` is unchanged). (p7-spec §11) | app |
| 7e.3 | **Playback holds.** While lost: the builder's time readout and the player's clock don't change; `Pause` still reads `Pause`; on `/` Space and Launch launch nothing (the HUD seed doesn't advance) and a sky click fires nothing. After restore the readout continues from the held value, so the first readout after restore is within 0.1 s of it. In spec: the driver's `step` and `simTime` are equal before and after the loss, the stage never calls `sim.clear`, `loop.setDriver`, `seek` or `reset` during a rebuild, and `launch()` returns null and `replay()` false while `status !== 'running'` (Y§1). | app; spec |
| 7e.4 | **It draws again after restore.** Within 2 s of restore, two canvas snapshots 500 ms apart differ (the `headless-webgl-smoke` pixel check), and `data-renderer="webgl"` holds. The renderer was rebuilt, not restored in place: the factory's create count is +1 and the old instance's destroy count is +1. | app; spec |
| 7e.5 | **No restore within 10 s gives the failure block.** It has the `stage-error` layout with `role="alert"`, the text `Graphics stopped on this page, and the browser hasn't brought them back.` followed by the surface's line (designer: `Reload to start the fireworks again. Your shell is kept in this browser.`; builder: `Reload to start the preview again. Your show is kept in this browser.`; player: `Reload to play it again from the start.`), and a `Reload page` button reachable by Tab. It never shows the startup copy `Fireworks can't start…` and never contains a raw error string. Focus doesn't move when it appears. (p7-spec §11; Y§1) | app |
| 7e.6 | **Your show is kept.** On `/show`, edit a cue, then within 500 ms trigger a loss and wait for the failure block. Then `Reload page`: after the reload, `fireworks.showDraft.v1` holds the edited cue (the draft was flushed on `pagehide`, p7-spec §11). | app |
| 7e.7 | **Reduce flashing spacing survives a rebuild.** With Reduce flashing on, across a loss and restore, no two drawn flash starts are closer than 41 steps (`FlashSpacing` is owned by the host and passed in, Y§1). Negative control: a fresh `FlashSpacing` per renderer fails the spec. | spec |
| 7e.8 | **Fire positions use the last real width.** While no renderer exists, the loop's `worldWidth` provider returns the last measured width, not 1280. A show resumed after a rebuild fires at the same `x` (world units) as an uninterrupted run (Y§1). | spec |
| 7e.9 | **No console errors** in any 7e run (0 `pageerror`, 0 `console.error`). | app |
| 7e.10 | **The leak check still passes.** The Phase 2 20-navigation check (`acceptance/phase-2.md` 2d.3) passes unchanged, and destroying a renderer doesn't start a rebuild. The host's `destroyed` check and its stage-identity check stop any rebuild from a destroyed renderer, even when that renderer's listeners are left attached and fire lost and restored from inside `destroy` (`fireworks-stage.phase7.spec.ts` 401–440: navigating away starts no rebuild; a restore rebuilds exactly once and the old renderer can't loop it). The renderer's `removeEventListener` calls before `app.destroy()` (`pixi-renderer.ts`, Y§1) are a second safeguard that no spec can observe (jsdom has no WebGL). Negative control: in those specs, the leaked listener not re-registered (no lost/restored delivered to the host) fails both. | app; spec |
| 7e.11 | **The timeline canvases recover too.** On `/show`, a `contextlost` then `contextrestored` on the ruler or lane 2D canvas redraws it (its pixels after restore equal a fresh draw). Nothing is shown to the visitor. | spec |
| 7e.12 | **Startup failure copy per surface.** With WebGL unavailable, the stage-error text is the p7-spec §10 table's line for that surface: the designer's is unchanged; the builder's ends `your show is kept in this browser.`; the player's ends `You can still open a copy with Remix.` | spec; app |

## 7f. DPR cap (Done-when 6)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7f.1 | **One function, three readers.** One shared function returns `min(devicePixelRatio \|\| 1, coarse ? 1.5 : 2)`, where `coarse` is `matchMedia('(pointer: coarse)').matches` and width plays no part. The engine receives the boolean or the number from the host and never calls `matchMedia` (`engine-boundary.spec.ts` stays green). | spec |
| 7f.2 | **Unit specs, all three cases:** coarse at DPR 3 gives 1.5 for the Pixi stage and the timeline's ruler, lane and overview canvases. Fine at DPR 2 gives 2 for all. Fine at DPR 3 gives 2 for all (the timeline gives 3 today). Negative control: with the coarse branch dropped, the first spec fails. | spec |
| 7f.3 | **In a browser.** Chromium with `deviceScaleFactor: 3, isMobile: true, hasTouch: true` at 390×844: for the stage canvas and each timeline canvas, `canvas.width / canvas.getBoundingClientRect().width` is 1.5 (±0.01). At desktop DPR 2 with a fine pointer it's 2. | app (Playwright, Chromium) |
| 7f.4 | **A rebuild re-reads it.** After a 7e loss and restore, the new stage canvas has the same ratio as before. | app |

## 7g. Keyboard and accessibility (Done-when 7)

### Tab-walk

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7g.1 | **Every listed control is reachable and works.** A Playwright tab-walk on `/`, `/show`, `/s/<shell>`, `/s/<show>`, `/c/<show>`, `/mine` (writes on, at least one card), `/status` and both not-found pages reaches every control in the p7-spec §3.1 table for that page, in DOM order, and activates each one with Enter or Space (or its listed key). Each step's focused element has a visible focus indicator: computed `outline-style` isn't `none` and the width is ≥ 2px. No step leaves `document.activeElement === document.body`. The walk's control list is derived from the page's DOM (every focusable), not a hand list, and is compared with the §3.1 rows. | app (Playwright) |
| 7g.2 | **Builder skip link (K8).** On `/show` the first Tab focuses a link reading `Skip to the timeline controls` that's visible once focused. Enter focuses `Play` (or `Back to start` while the notice holds Play), and `window.scrollY` doesn't change. | app |

### Focus targets K1–K7 (p7-spec §3.2)

Each row is a spec plus a step in the tab-walk. "Next render" means the assertion runs after one change-detection pass, with no timers.

| # | Action | Focus must land on |
|---|---|---|
| 7g.3 K1 | `+ Add` at 3 breaks (creates the 4th) | the newly active tab. At 1→2 and 2→3, focus stays on `+ Add`. |
| 7g.4 K2 | Shell JSON `Revert` | the textarea |
| 7g.5 K3 | Builder ⌘/Ctrl+Z or Redo that removes or deselects the selected cue while focus is in the inspector or toolbar | the timeline |
| 7g.6 K4 | Library `Remove` (unused shell), and `Remove…` → `Remove shell and cues` | the next row's shell button in **In this show**, else the previous row's, else the first preset button |
| 7g.7 K5 | Toolbar `Delete` on the last cue, or ⌘Z that deselects | stays on the button. `Duplicate` and `Delete` use `aria-disabled="true"`, not `disabled`, and activating them then does nothing (no document change, no Undo step). |
| 7g.8 K6 | `/mine` list-error `Try again` | the page `h1` |
| 7g.9 K7 | Toast `×`, or a focused toast timing out | the next toast's `×`, else the page `h1`. The player's and `/status`'s `h1` have `tabindex="-1"`. |
| 7g.9a K9 | My shells `Try again` or `Show more` in the Library, while the list loads (added in C4 from p7-spec §3.2 K9, Rosalina C2-3) | the pressed button stays rendered while loading (`aria-disabled="true"`, `.btn-busy`) and keeps focus. On success, `Show more` → the first newly loaded item (or stays on `Show more` if it still renders); `Try again` → the first My shells item, else the `My shells` heading (`h3 tabindex="-1"`). On failure focus stays on `Try again`. Never `document.body`. |

### Ctrl/⌘+S (p7-spec §3.3, R1)

Press both `metaKey+s` and `ctrlKey+s` in every row (Toad's rule 5: they're separate code paths). Check the Network log, `event.defaultPrevented`, the page's polite region and `document.activeElement`.

| # | State | Pass condition |
|---|---|---|
| 7g.10 | No save bar (writes off, or `api/me` failed or pending) | no request; `defaultPrevented` is **false** |
| 7g.11 | A confirm dialog open, or a save in flight | no request; `defaultPrevented` true; nothing announced |
| 7g.12 | `Saved` | no request; announces `Nothing new to save.` |
| 7g.13 | Builder, empty show | no request; announces `A show needs at least one cue before it can be saved.` |
| 7g.14 | One choice (`Save`) | exactly one request, the same one pressing Save sends (`POST api/creations`, or the remix POST); the existing toast and status block |
| 7g.15 | Two choices (`Update original` · `Save as new`) | **no request**; focus is on `Update original`; announces `Choose Update original or Save as new.` |
| 7g.16 | Focus in a text field (designer name; builder Name, Duration, Launch time) | the row above for that state still applies. On the builder, a value typed into Duration (or Name or Launch time) and not yet blurred is in the POST body, with that field's blur commit and notes applied. |
| 7g.17 | Alt or Shift held | nothing app-side; Shift+⌘S isn't Save as new |
| 7g.18 | Single-choice Save button | has `aria-keyshortcuts="Meta+S"` on Apple platforms and `"Control+S"` elsewhere; the label stays `Save` |

### Disabled looks, carried fixes

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7g.19 | **Two `aria-disabled` looks (R4).** A `.btn[aria-disabled='true']` without `.btn-busy` has computed `opacity: 0.45` and `cursor: not-allowed` (Undo with no history, Add cue at the cap, toolbar Duplicate and Delete with nothing selected). With `.btn-busy` it has `opacity: 1` and `cursor: progress`. `.btn-busy` is present exactly while the save bar's `saving() !== null`, `/mine` Delete's `deleting()`, and the API banner's `checking()`. | spec; app (computed style) |
| 7g.20 | **Try again (`api-banner.ts`).** While checking, it has `aria-disabled="true"` and `.btn-busy`, its label is `Checking…`, a second click sends no second `health/live` request, and focus stays on it. On recovery the banner unmounts and focus moves to the panel `h1` (designer and builder). On failure the label returns to `Try again` with focus still on it. | spec |
| 7g.21 | **B4: repeated messages re-announce.** Each of these is announced twice when it happens twice (the live region's text goes to `''` and back to the text within about 100 ms; a visible note re-inserts its text node): a second blocked add at the cap; a second show end in one session; two adds of one shell at one paused playhead; Copy pressed twice in Show JSON. | spec |
| 7g.22 | **B5: focus survives Undo/Redo.** After any undo or redo (key or button), if focus was on `body`, a disabled control or a disconnected node, it moves in the next render: from the save bar to the panel `h1`, from the inspector or toolbar to the timeline, and from anywhere else to the panel `h1`. | spec |
| 7g.23 | **B6: the 32-shell note sits under its item.** At 32 shells, a blocked add renders the p6-spec §9.2 sentence (`This show already holds 32 shells, the most it can. Use a shell that's already in it, or remove an unused one.`) as a `.note` directly under the active Library item, and that item's button has `aria-describedby` pointing at it. The toolbar status still shows it. | spec; app |
| 7g.24 | **B7: Duration and Launch time notes.** Each rejected Duration entry (blank, not a number, below 1, above 600) leaves `Duration is between 1 and 600 seconds.` until the next valid entry. Below the last launch it leaves the existing blocked note. The note has `aria-live="polite"`, and the field's `aria-describedby` points at it. Launch time's note behaves the same way. | spec |
| 7g.25 | **Rosalina's post-implementation review (C2) passes** and is recorded. | record |

## 7h. Reduced motion (Done-when 7)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7h.1 | **Each stage surface starts with Reduce flashing on.** Under emulated `prefers-reduced-motion: reduce` with empty storage, the Reduce flashing switch (`role="switch"`) is `checked` on `/`, `/show`, `/s/<shell>` and `/s/<show>`, and `fireworks.reduceFlashing.v1` isn't written by the load (only an explicit choice is stored). | app (Playwright, emulated) |
| 7h.2 | **Opening states hold.** Under `reduce`, `/` opens in Manual, the player opens paused with the centered `Play`, and `/show` opens paused (as on every load). | app |
| 7h.3 | **The existing visual-rules specs still hold, unedited:** steady strobe, flash alpha 0.3 at 100 px × size, glitter floor 0.5, and 41-step flash spacing. `git diff` on `visual-rules.spec.ts` shows no changed assertion. | spec; file |
| 7h.4 | **The switch knob doesn't slide under `reduce`.** Toggling the switch under `reduce` runs no CSS transition on `.switch::after` (`document.getAnimations()` holds 0 for it); without `reduce` it runs one of 150 ms. The computed `transition-duration` isn't the check: the build sets `transition-property: none`, so the duration still reads 0.15s (Toad, `gate-reduced-motion.mjs`; Rosalina confirmed intent). | app (computed style) |
| 7h.5 | **No new animation.** No `@keyframes`, `animate-` or `scroll-behavior: smooth` anywhere in `src`. The library-drag ghost, badge zoom, pinch and seek-scroll change the view instantly: in a spec, the view after the gesture is final in the same frame, with no easing frames. | spec (grep); spec |

## 7i. Touch (Done-when 8)

Run at 390×844 in Chromium with `isMobile: true, hasTouch: true` (which matches `(pointer: coarse)`), unless a row says otherwise.

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7i.1 | **Target sizes under coarse (p7-spec §5.2).** On `/`, `/show` and `/s/<code>`, every visible `.btn` (including `.btn-sm`, `.btn-heading` and the toast `×`) has a computed `min-height` and `min-width` ≥ 44px and `touch-action: manipulation`. Every `.field`, select and number input has `min-height` ≥ 44px and `font-size: 16px`. Switch rows are ≥ 44px tall. The header text links are ≥ 44px tall. With a fine pointer at the same width, the desktop sizes are unchanged. | app (computed style) |
| 7i.2 | **Spacing.** Adjacent targets in the zoom group, `/mine` card actions and the player top bar are ≥ 8px apart (bounding-box gap) under coarse. | app |
| 7i.3 | **Page zoom stays.** `index.html`'s viewport meta has no `user-scalable=no` and no `maximum-scale`. | file |
| 7i.4 | **The narrow builder dock (p7-spec §5.4).** At ≤ 760px: Play, Back to start and the time share one line. The scrub and the zoom group share a second line below it (by `getBoundingClientRect().top`). The toolbar reads Add cue, Edit cue (only while a cue is selected), Delete, Undo, Redo; Duplicate and the active shell's name aren't rendered visibly. The status sentence is a visible line under the toolbar. The stage is ≥ 160px tall. | app |
| 7i.5 | **Same Tab order at both widths.** The tab-walk's order of dock controls at 390px equals the order at 1280px, minus the hidden ones, plus Edit cue. No CSS `order` or grid placement reorders the dock (computed `order` is 0 throughout). | app; spec (grep) |
| 7i.6 | **Edit cue.** With a cue selected, Edit cue scrolls the panel so the Cue section's heading is at its top and focuses Launch time. | app |
| 7i.7 | **Touch gestures (p7-spec §5.5).** A tap on a cue selects it. A tap on empty lane seeks there and deselects. A one-finger drag on the **selected** cue moves it (snap 0.1 s, clamped 0…duration). A one-finger drag elsewhere on the lane pans (the draft's `view.scroll` changes, every cue's `t` is unchanged, and no Undo step is added), and does nothing at Fit. A drag on the ruler scrubs. With a mouse, dragging any cue still moves it and dragging empty lane still scrubs. | app; spec |
| 7i.8 | **Touch hit radius.** Timeline hit testing uses 12px for `pointerType === 'touch'` and 6px for mouse and pen; the stage marker has a ≥ 44px transparent hit area while its ring stays 14px. | spec |

## 7j. Builder UX: pinch, drag, badge, overview, end label (Done-when 8, 9)

### Pinch zoom (p7-spec §6)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7j.1 | **Pinch changes the zoom.** A two-pointer touch spread on the lane changes `view.pxPerSecond` (in the draft, `fireworks.showDraft.v1`, after its debounce, and on the store) by the finger-distance ratio, clamped between Fit and 200 px/s. The time under the starting midpoint stays under the midpoint (±1 px). | app (Playwright touch); spec |
| 7j.2 | **A second finger cancels.** A cue drag in progress reverts (document deep-equals before, no Undo step), a pan stops, and a ruler scrub ends where it was. Lifting after a pinch selects nothing and seeks nowhere. The pinch stops Follow and adds no Undo step. | spec |
| 7j.3 | **Proportional trackpad zoom.** One Ctrl+wheel event with `deltaY: -10` multiplies px/s by `exp(0.1)` (±1%). One with `deltaY: -100` multiplies by at most 1.5. `deltaMode` lines are ×16. | spec |
| 7j.4 | **Safari gesture events.** `gesturechange` on the timeline box zooms by the same rule and is `preventDefault`ed (the page doesn't zoom). | spec; app (synthetic event; Chromium at gate; Firefox and WebKit in the daily run (to be defined)) |

### Library drag (p7-spec §7.1)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7j.5 | **A drop adds exactly one cue.** With a mouse, dragging a Library item more than 4px and releasing over the lane adds exactly one cue: `t` = the drop time snapped to the nearest 0.1 s and clamped to `0…duration`, `x` = 0.5, no `burstHeight` key, and the shell copied in as Add cue does. Exactly one Undo step. The new cue is selected, focus is on the timeline, and the announcement is `Added {name} at {m:ss.s}.` A move under 4px is a click (select as active, no cue). | app; spec |
| 7j.6 | **While dragging:** an `aria-hidden` ghost chip follows the pointer; over the lane or ruler a 1px guide sits at the snapped time and the drag label reads the time (`… · window end` at the clamp). Alt/Option snaps to one step. | app |
| 7j.7 | **Blocked drops add nothing.** At 1000 cues the label reads `Show is full (1000 cues)`, and a 33rd shell reads `Show already has 32 shells`. On release: no document change, the p6-spec §9.2 sentence is announced, and the item becomes the active shell. | spec |
| 7j.8 | **Cancel.** Releasing off the timeline box, or Escape during the drag, changes nothing and announces nothing. | spec |
| 7j.9 | **Touch doesn't drag.** With `pointerType === 'touch'`, a drag in the Library scrolls the panel and adds nothing. | spec |

### `+k` badge, overview, end label (p7-spec §7.2, §7.3, §8)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7j.10 | **Badge layout data.** Each badge from `layoutLane` carries `t0`, `t1` and the first hidden cue's id (in firing order), and a hit box ≥ 24×24 that wins over cue hits inside it. | spec |
| 7j.11 | **Badge click zooms.** A click sets px/s to `clamp(0.8 × laneWidth / max(t1 − t0, 0.05), current × 1.5, 200)` with the span centered. It's never a no-op while zoom room remains. It stops Follow, adds no Undo step and announces nothing. | spec; app |
| 7j.12 | **At 200 px/s a badge click selects** the cluster's first hidden cue and announces the keyboard-selection sentence (p6-spec §16.3). | spec |
| 7j.13 | **Overview layers.** The overview canvas is `aria-hidden`, 12px tall, behind a native range that keeps `aria-label="Playhead"`, `aria-valuetext`, arrows 0.1 s, PageUp/PageDown 10 s, and Home/End. It draws the launch window, the tail hatch, one tick per cue, a 2px accent tick for the selected cue, the end line, and the view box (hidden at Fit). It's redrawn on a document, view, size or selection change and never per frame (with a draw counter, playing for 2 s with no change adds 0 draws). | spec |
| 7j.14 | **Seek-scroll rule.** A scrub-bar seek, or `Back to start`, that lands outside the lane's visible window scrolls the lane so the playhead is 10% from the left. A ruler or lane seek never scrolls. | spec |
| 7j.15 | **The end label never covers a badge.** On a fixture where the end lands within one label width of `duration` at Fit with an overflow badge under the end line, `labelPlacement` returns step 4 or 5 (§8 order), and no drawn label box intersects any badge hit box. The check is on layout data, not pixels. Negative control: today's lane-foot placement fails it. | spec |

## 7k. Show JSON (Done-when 9; promised by `acceptance/phase-6.md` §Questions settled)

p7-spec §9. The panel is the last section of `/show`, after Display.

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7k.1 | **Closed by default, no text while closed.** A `<details>` whose `summary` has the accessible name `Show JSON` is closed on load (its `textContent` is `▸Show JSON`, because the `▸` marker is `aria-hidden`). While closed, the DOM has no Show JSON textarea and no serialized show string. Buttons sit outside the `summary`. | spec; app |
| 7k.2 | **The text is the save document.** While open, the textarea's value equals `JSON.stringify(doc, null, 2)` where `doc` is exactly the `document` a Save would send (6f.3's keys, with no UI state: no `selectedCueId`, `view`, `activeShell`, `nextCueId`, `dirty` or `saved`). It follows every edit, except while there are unapplied edits, which are kept, with `Revert` shown. | spec |
| 7k.3 | **Round trip across a fresh profile (Toad).** Engines: Chromium at gate; Firefox and WebKit in the daily run (to be defined). Copy in context A, then Apply that text in context B (a fresh profile; a different engine in the daily run), then Save in B: the POST body's `document` deep-equals A's saved document. | app (Playwright; Chromium at gate) |
| 7k.4 | **Apply over a dirty show asks.** The dialog's title is `Apply this JSON?`, its body is `This replaces your current show, “{name}”, including its cues, shells and sky. Display settings stay as they are.` (the blank-name variant per p7-spec §9.3), and its buttons are `Keep editing` · `Apply JSON`. Focus opens on `Keep editing` and returns to `Apply` on close. `Keep editing` changes nothing. Over a clean show there's no dialog. | spec; app |
| 7k.5 | **A successful Apply.** The show deep-equals `openShow(pasted).show`. The playhead is at 0:00, paused, with nothing selected and the view at Fit. `nextCueId` is one more than the largest `c{n}`. The active shell is unchanged if it's a preset, the designer item or one of My shells; an embedded active shell that's gone falls back to Peony. `dirty` is false, `saved` is false, and `source` is unchanged (the designer's Apply doesn't write `source`). Focus stays on `Apply`. | spec |
| 7k.6 | **Apply is one Undo step.** After Apply, the Undo stack is one deeper and Redo is empty. One ⌘Z restores a show that deep-equals the pre-Apply show (and sets `dirty`). Redo restores the applied show. A failed Apply adds no step. | spec |
| 7k.7 | **The notes, exactly.** Each p7-spec §9.2 row produces its text: default, edited, copied, copy blocked (`⌘C` on Apple platforms, `Ctrl+C` elsewhere), `Applied.`, values adjusted, unknown fields ignored (show-level, cue and shell forms), the embedded-`sky` sentence (one shell and several), not JSON, a shell pasted here, and invalid show. Invalid shows list at most 5 reasons, then `; and {k} more problems`. With 1000 broken cues the note has ≤ 6 clauses. | spec |
| 7k.8 | **Labels come from `showFieldLabel`, against the pasted document.** No note contains a raw path: `cues[3].seed` reads `Seed (Cue at {t})`, a shell field reads `Stars (Peony, Break 1)`. A structure spec asserts that no show surface imports bare `fieldLabel`, with a negative control. | spec |
| 7k.9 | **`CUE_FIELD_LABELS` lives in `engine/model/labels.ts`** next to `FIELD_LABELS`, and the inspector's row labels read it. `show-copy.ts` no longer declares `CUE_FIELDS`. | spec; file |
| 7k.10 | **An embedded shell's `sky` is dropped.** Pasting a show whose shell carries `sky` applies it without that key (the shell in `show.shells` has no `sky`) and appends the sky sentence. That's a success with a caveat, not an error. | spec |

## 7l. Caps and checkpoint warm-up (Done-when 10)

A3's baseline (prod build, Chrome headless, i7-9750H, ±20% under load): realistic 600 s show (337 preset cues) cold 20-seek p50 61 ms / **p95 3,605 ms** (3 seeks over 1 s), warm p95 296 ms, seek to end 7.8 s. Done-when show cold p95 866 ms.

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7l.1 | **The numbers are recorded and the ruling cites them.** A3's record holds step cost at the cap, seek to end on `at-maximums` and the realistic show, and warm and cold p95. Skyler's keep-40k/600 s ruling cites it (plan 7.5). | file (done) |
| 7l.2 | **No cap change.** schema.md's caps, both validators' constants and the fixtures are unchanged (`git diff` on those values is empty), and `generate-fixtures.mjs --check` passes. B4 didn't run. | file; spec |
| 7l.3 | **Warm-up passes A3's cold row.** On the production build (image), Chrome headless, rerun A3's procedure on the realistic 600 s show: save it, open `/c/<code>`, wait until warm-up reports finished, then run the same 20 seeded cold seeks. **p95 < 1,000 ms.** Record p50, p95, seeks over 1 s, the warm-up's time from load to finished, and long tasks during the warm-up. Also rerun the Done-when show, which must not regress past its 866 ms baseline + 20%. | image; Playwright (Toad) |
| 7l.4 | **"Finished" is observable on the page.** The stage exposes when warm-up has finished through a DOM hook the gate can wait for (a `data-*` attribute on the stage host; Luigi names it). A fixed sleep isn't acceptable evidence for 7l.3. | app |
| 7l.5 | **Scrubbing before warm-up finishes is no worse.** On the same build, 20 cold seeks started 1 s after load (before warm-up finishes) have p95 ≤ A3's cold baseline + 20% (≤ 4,330 ms), and each seek still lands at its exact target. The numbers are recorded. | image; Playwright |
| 7l.6 | **Warm-up stays within the frame budget.** In a spec with a fake clock, warm-up steps stop once the frame's `seekBudgetMs` is spent, and a foreground seek's steps come before warm-up steps in a frame. | spec |
| 7l.7 | **Warm-up changes no result.** A seek to step k after warm-up gives the same launch ledger, per-kind counts and star positions (same engine, exact) as a straight run to k. Negative control: a warm-up checkpoint stored under the wrong key (for example width ± 1) is either rejected or fails the spec. | spec |
| 7l.8 | **An edit invalidates what it should.** After warm-up, editing a cue behind a kept checkpoint, then seeking past it, gives the state of a straight run of the edited show (Toad's rule 2). Checkpoint memory never exceeds `checkpointMemoryMiB`. | spec |
| 7l.9 | **The player is unchanged.** `/s/<show>` doesn't run warm-up (it has no scrub), and shows still play at `starBudget` 1 (6h.1, Q7.2). | spec |

## 7m. Cleanups (Done-when 11)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7m.1 | **Type rename.** `core/models.ts` declares `ClientPlaybackConfig` (matching `ApiContracts.cs:40`). No `PlaybackClientConfig` remains in `src/`. The doc comment names the right C# type. Wire keys are unchanged, and Toad's contract-parity spec passes unedited. | spec; file |
| 7m.2 | **Bowser's record sentence is corrected** per `toad-phase6-client-config-contract-parity.md`. | file |
| 7m.3 | **`doneWhenShow()` loads Toad's fixture** `schema/fixtures/valid/show/done-when-60s-50.json`, with no hand-written stand-in left in `app/testing/show-fixtures.ts`. The specs that address `c3`, c2/c10 and c3/c20 still pass. | spec |
| 7m.4 | **The shared-component move (Y§3).** `save-bar`, `save-status`, `hud`, `api-banner`, `save-copy(.spec)` and `formats` live under `app/shared/`, and none remain under `features/designer/shared/`. `designer-draft.ts` and `designer-copy.ts` stay. `reasonOf` is required, and `designer-save.ts` passes `issueReason`. New structure rules hold, each with a negative control: no `app/shared` non-spec file value-imports from `features/`, and `features/show` imports from `features/designer` only `designer-draft.ts` and `designer-copy.ts`. | spec |
| 7m.5 | **Boo F3 is closed (Y§5).** One helper, `embeddedShell(show, key)` in `engine/model/show.ts`, using `Object.hasOwn`. A structure spec allows the property-access read `.shells[` only in `normalize.ts`, `show.ts`, `show-edit.ts` and `sim/simulation.ts` (commented), across `app/**/*.{ts,html}` and `engine/**`. Negative control: a re-added bare read fails it. Toad's round trip with keys `constructor`, `toString` and `valueOf` passes through draft save and restore, `loadCopy`, add, remove and the Save body, and `embeddedShell(show, 'constructor')` is `undefined` on a show without that key. | spec |
| 7m.6 | **The late config and the end clamp (Y§2).** README §Playback tuning says an open tab loads the values once, and the checkpoint values apply to shows opened after they arrive. `inherit`'s doc comment says the same. The stage clamp spec: play the Done-when fixture to the end at 60 fps and at 10 fps, and `currentStep()` and the hook's last step both equal `endStep`. Negative control: returning `driver.step` fails with E+2. | file; spec |
| 7m.7 | **Boo's F2/F5 re-check is recorded** (Boo §7: both hold), which also closes the Phase 5 "C2 name-only heuristic" carry. | file (done) |
| 7m.8 | **Peach's 6a/6b/6k closing note** is in `acceptance/phase-6.md`. | file (done with this batch) |
| 7m.9 | **Anything not closed is carried with an owner.** The gate record lists it by name. | record |

## 7n. Suites (Done-when 12)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 7n.1 | `npm test`, `typecheck`, `ng build`, the `format` check, `generate-fixtures.mjs --check`, the gated `dotnet test` (`FIREWORKS_TEST_POSTGRES`) and the full three-stage `docker build` all pass. The gate records counts, and the npm count isn't lower than Phase 6's 1433. | spec; image |
| 7n.2 | The header (7a.8), ETag (7a.8c), CSP (7b.6, 7b.7) and context-loss (7e.7, 7e.10) checks each have a recorded negative control that made them fail. _Status: recorded; 7e.10's control is in `toad-phase7-c3-review.md` C4 addendum item 6._ | record |

## 7o. Railway [R] (Done-when 13): DEFERRED

Skyler, Q7.1 (2026-11-15). None of these run in Phase 7. The gate lists each as DEFERRED, not as passed: the Phase 1 Railway Done-when (health, deep links, `/api/nope`, canary, migrations in the startup log); 2d Firefox/Safari parity and the Safari trail-format check; 5i.2–5i.5; 6k.3–6k.4; Boo C18 (S5 413 through the edge with and without chunked, S21 client IP, S28 runbook with `pg_dump` first) and C20 on the production build; Toad's 21-fixture round trip; every 7a and 7b header and cache check repeated through the edge; 7b.4 and 7c.4 through the edge; 7d.4 backups; the writes-off check afterward (`canWrite: false`, 403 on `GET api/me/creations`).

---

## Done-when map

| 7.2 item | Criteria |
|---|---|
| 1 Caching | 7a.1–7a.8 |
| 2 Security headers and CSP | 7b.1–7b.9 |
| 3 Pipeline edges | 7c.1–7c.5 |
| 4 Operations | 7d.1–7d.3; 7d.4 [R] |
| 5 Context loss | 7e.1–7e.12 |
| 6 DPR | 7f.1–7f.4 |
| 7 Accessibility | 7g.1–7g.25, 7h.1–7h.5 |
| 8 Touch | 7i.1–7i.8, 7j.1–7j.4 |
| 9 Builder UX | 7j.5–7j.15, 7k.1–7k.10 |
| 10 Caps | 7l.1–7l.9 |
| 11 Cleanups | 7m.1–7m.9 |
| 12 Suites | 7n.1–7n.2 |
| 13 Railway | 7o (DEFERRED) |

## Where this file follows the design specs over 7.2's wording

The specs split states that 7.2 lumped together, so the criteria follow the specs:

1. **7.2.5 "Without restore, the no-WebGL message shows."** p7-spec §11 gives a loss its own failure block, copy and `Reload page` button, and Yoshi says a loss must not show the raw error (7e.5). The timeout is p7-spec's 10 s, not Yoshi's provisional 5,000 ms, which he deferred to Rosalina's number.
2. **7.2.3 "the database container is stopped."** Boo's method (drop the throwaway database; never stop the shared container) is accepted as equivalent (7c.1).
3. **7.2.1 "`favicon.svg` is not immutable."** Tightened to Boo's `no-cache` (7a.3).
4. **7.2.10 "If the p95 is over 1 s, the trigger's outcome is recorded."** Skyler ruled that cold seeks count, so the outcome is that warm-up gets built, and 7l.3–7l.8 accept it.

## Open items

**For Skyler (through the coordinator):**

- **Q1. Does warm-up run on touch devices too?** It's background CPU on a phone. **Recommended default: yes, the same on every device.** It's bounded by the per-frame budget (7l.6), it runs only on `/show` (7l.9), desktop-first stands (OQ10), and CPU cost goes to the end-of-project review.

**For the team (not Skyler's call):**

- **N1 (Yoshi and Rosalina): a restore after the failure block.** p7-spec §11 has a row saying a restore after the 10 s block removes it. Y§1 destroys the renderer on timeout and ignores any later restore. Both can't be true. **Recommended: Yoshi's.** The block's copy already says the browser hasn't brought graphics back and offers Reload, and a destroyed canvas can't be restored. With that, 7e has no row for a late restore. If Rosalina keeps her row, I add one.
- **N2 (coordinator): warm-up has no owner or design in batch B.** 7.3's B2 and B3 don't list it, and Luigi's Phase 6 record says it needs a second sim and its own review. It needs a Luigi (stage) and Yoshi (`{ from }` handoff) assignment and the 7l.4 hook. 7l is written against behavior, so it holds whatever the design is.
- **N3 (Luigi): when warm-up starts.** 7l.3 needs it after a `/c/` load. Recommended: also after a `/show` reload that restores a draft, and after Show JSON Apply, since those are cold too. After an edit, warm-up resumes from the edit point. 7l only gates the `/c/` case.
- **N4 (Boo and Yoshi): the F3 helper name and allowlist.** P7-S15 names `shellOf` and lists `show-edit.ts:113,216` as bare reads to replace. Y§5 names `embeddedShell` and allows `.shells[` in `show-edit.ts` (the writer). 7m.5 follows Yoshi, because he owns module boundaries. Boo should confirm that `show-edit.ts`'s reads at 113 and 216 are writes or key-pattern guarded. If they aren't, they move to the helper too.

---

## C4 acceptance review (Peach, 2026-11-15)

Code, specs and the C1–C3 records only (Skyler's constraint). "Gate" = Mario's gate run; "fix in flight" = Bowser's C2 fix round.

| Section | Verdict | Open at the gate |
|---|---|---|
| 7a | Accept | 7a.7 closed: the 500 ledger row is in place and its mutants are killed (Toad C4 addendum). Image surface: 7a.1–7a.6 were proven on a clean publish (C1), the docker image run is the gate's |
| 7b | Accept | 7b.7 verified at gate (`gate-csp.mjs` + `MODE=none`; Chromium at gate; Firefox and WebKit in the daily run (to be defined)); image re-curl of 7b.1–7b.5 |
| 7c | Accept | 7c.3 `h1` focus in a browser; image re-curl |
| 7d | Accept with note | 7d.1 runbook verbatim on the gate DB; 7d.2: README has the date but not the numbers, the gate rehearsal writes them in |
| 7e | Accept | none beyond the suite (Luigi's Chromium context-loss run is on record) |
| 7f | Accept | 7f.3 desktop DPR 2 and the ruler canvas in the touch smoke |
| 7g | Accept | 7g.25 and 7g.9a K9 (C2-3), 7g.21 Shell JSON repeat: re-checked PASS by Toad (C4 addendum), signed off by Rosalina (7g.25 addendum); 7g.1/7g.2 tab-walk at gate (`gate-keyboard.mjs`, `NEG=focus` and `NEG=walk`) |
| 7h | Accept | 7h.1, 7h.2, 7h.4 emulated reduced-motion browser check (`gate-reduced-motion.mjs`; 7h.4 reworded to behavior) |
| 7i | Conditional | C2-1 scrub thumb: re-checked PASS by Toad, signed off by Rosalina. Touch-size defect (13px root font, `styles.css:111`, rem utilities below 44px): Bowser fixing, Mario verifies at gate; 7i.1 on `/s/<code>`, 7i.2, 7i.5 in the touch smoke |
| 7j | Accept | wheel scroll stops Follow (C2 deviation 3): re-checked PASS by Toad, signed off by Rosalina; 7j.4 synthetic event, Chromium at gate |
| 7k | Accept | C2-2 disclosure marker, C2-4 plural, Copy copies the textarea: re-checked PASS by Toad, signed off by Rosalina; 7k.3 verified at gate (`gate-roundtrip.mjs`, Chromium) |
| 7l | Accept | 7l.3, 7l.5 verified at gate (`gate-warm.mjs`); 7l.8 config path covered in the store spec only (accepted) |
| 7m | Accept | 7m.9 carry list in the gate record |
| 7n | Accept, gate-run | 7n.1 three-stage `docker build` and the final counts |
| 7o | DEFERRED | unchanged |


# Phase 5 acceptance criteria: save, share, player, remix

Owner: Peach. Written 2026-11-14 at Phase 5 planning, before implementation.
Source: `plans/initial-implementation.md` Phase 5; `docs/fireworks-app/schema.md` §2 (envelope, paging, status codes), §8.3 (entry paths), §9 (share codes), §10, §11 (links, working copy, Save); `src/api/Fireworks.Api/Fireworks.Api.http` (payloads); `src/api/Fireworks.Api/Contracts/CreationContracts.cs` (records); `designer-draft.ts`, `session.ts`, `http-error-interceptor.ts` (current client). Copy, layout and the F4 ruling come from Rosalina's `docs/fireworks-app/design/phase-5.md` (cited as **p5-spec**). Where this file says "p5-spec copy", the criterion checks that the text shown is the spec's text verbatim; it never supplies copy of its own.

Every criterion is observably true or false, and names its **surface**: **spec** (Vitest under `src/web/fireworks-web/src/`, with `HttpTestingController` and a memory `Storage`), **running app** (`ng serve` against the compose API, or the built image, in a real browser with DevTools Network and Application > Local Storage open), **Railway** (deferred: only the deployed app can show it), or **grep/build**. "Ledger" means the complete list of HTTP requests a spec or the Network panel records for the action, asserted as an exact list, not "contains" (`toad-exact-call-ledger-over-positive-assertions.md`). "Draft" means the parsed value of localStorage `fireworks.draft.v1`. "Byte-identical" means the stored string is unchanged.

Before Phase 8 every visitor is the default user, so `isOwner` is true for every creation in the running app (schema.md §11.5). Rows that need `isOwner: false` say **spec only**.

---

## 5a. Contracts and the service

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5a.1 | `core/models.ts` declares `CreationResponse` (`shareCode, kind, name, schemaVersion, document, isOwner, remixedFrom, createdAt, updatedAt`), `CreationListItem` (`shareCode, kind, name, updatedAt, palette`), `CreationListPage` (`items, page, pageSize, totalCount`) and `ValidationErrorResponse` (`message, errors[{path, code, message}], truncated`), each field-for-field with `CreationContracts.cs` / `ApiContracts.cs`. `remixedFrom` is `string \| null`, not optional. `updatedAt` is typed `string` and compared with `===` wherever compared (never `new Date`). | file, grep `new Date(` in `core/creations.ts` and the draft code: no hit on `updatedAt` |
| 5a.2 | `core/creations.ts` exports `CreationsService` with one method per endpoint: create (`POST api/creations`), get (`GET api/creations/{code}`), update (`PUT api/creations/{code}`), remix (`POST api/creations/{code}/remix`), delete (`DELETE api/creations/{code}`), list (`GET api/me/creations`). | file |
| 5a.3 | **Request bodies are exact.** POST body keys are exactly `kind`, `document`. PUT and remix body keys are exactly `document` (a `kind` there is a 400, schema.md §2.6 step 5). `document` keys are exactly `version, name, burstHeight, angleJitter, sky, breaks`; no `display`, `activeBreak`, `shellDirty`, `skyDirty`, `source` or any other draft field. Every request has `Content-Type: application/json`. | spec (assert `req.request.body` key sets), running app (Network > Payload) |
| 5a.4 | **Compact JSON** (schema.md §2.5): the serialized request body contains no newline and no two-space indent. | spec on the serialized body |
| 5a.5 | A share code failing `^[1-9A-HJ-NP-Za-km-z]{8}$` is never sent: `get('abcdefgl')` makes no request. | spec (ledger empty) |
| 5a.6 | Save-time requests that render their own error (5b.9) carry `SUPPRESS_ERROR_TOAST`, so `httpErrorInterceptor` shows no generic toast for them. The player GET and `/c/:code` GET carry it too (their 404 has its own page). **Negative control:** remove the token from the Save call and the 400 spec sees the generic toast. | spec + recorded mutant |

## 5b. Save (designer)

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5b.1 | **Write switch.** With `canWrite` false (api/me says false, still loading, or failed), the designer DOM has no Save, Update original or Save as new control, and the designer otherwise works (launch, presets, Apply, draft). When api/me resolves with `canWrite: true` the controls appear without a reload. | spec (stub api/me false / pending / error / true), running app (prod-like config with `Identity__AllowAnonymousWrites=false`) |
| 5b.2 | **Fresh work** (`source` null): one Save control. Pressing it sends ledger exactly `[POST api/creations]` with `kind: "shell"`. On 201 the draft's `source` equals `{ shareCode, kind, isOwner, updatedAt }` taken from the response body, and the stored draft string contains that `source`. | spec, running app (Done-when 1) |
| 5b.3 | **Owned working copy** (`source.isOwner` true): the two choices are present with p5-spec labels (Update original, Save as new) in the p5-spec presentation. **Update original** sends exactly `[PUT api/creations/{source.shareCode}]`; afterward `source.shareCode` is unchanged and `source.updatedAt` equals the response's `updatedAt` (string equality). **Save as new** sends exactly `[POST api/creations/{source.shareCode}/remix]`; afterward `source.shareCode` is the response's new code and differs from the old one. | spec, running app (Done-when 3, 4) |
| 5b.4 | **Non-owner working copy, spec only** (stubbed GET with `isOwner: false`, then Save): the DOM has no Update original control, only the single Save; the ledger after Save is exactly `[POST api/creations/{code}/remix]`, with no PUT and no plain POST. **Negative control:** a mutant that offers both choices for `isOwner: false`, or sends PUT, fails it. | spec + recorded mutant (plan Phase 5 known limit) |
| 5b.5 | **404 fallback, PUT.** PUT answers 404 → p5-spec copy is shown offering Save as new; accepting sends exactly one `POST api/creations` with `{kind, document}`. Full ledger: `[PUT …/{code}, POST api/creations]`. No `…/remix` appears. Afterward `source` is the new record. | spec; running app: open `/c/:code`, delete the original (from `/mine` in another tab, or the `.http` DELETE), then Update original |
| 5b.6 | **404 fallback, remix.** Save as new (or a non-owner Save) answers 404 → the follow-up is a plain `POST api/creations`, never a second `…/remix`. Full ledger: `[POST …/{code}/remix, POST api/creations]` (with a p5-spec prompt between them if the spec has one). | spec; running app: same setup, Save as new |
| 5b.7 | **Blank name** saves as `Custom`: with the Name field empty (or whitespace only), the request's `document.name` is `"Custom"`, Save is enabled, and nothing blocks it. | spec, running app |
| 5b.8 | **Strict validation before sending** (schema.md §8.3): the document passes `validateShell` before any request. A spec that forces a strict failure (for example a stubbed validator) sees no request and p5-spec inline copy. | spec |
| 5b.9 | **Save-time failures (F10)** each show p5-spec copy inline (not the generic toast), leave the draft byte-identical, and leave Save usable for a retry: 400 (issues listed from `errors[].code`; with `truncated: true` the copy says there are more), 403 (writes switched off mid-session), 404 (5b.5/5b.6), 413, status 0 (what Railway's edge may turn 413 into, schema.md §2.5), 429. One spec case per status. | spec |
| 5b.10 | **One request per press:** pressing Save (or a choice) twice before the response arrives sends one request. | spec |
| 5b.11 | **Dirty indicator and Save vs dirty (F4). Decided (p5-spec P2, §4; Luigi confirmed):** a successful save sets the draft's `shellDirty` and `skyDirty` to `false` and `saved` to `true`, and a preset click right after Save loads without a dialog. The indicator reads the separate `saved` flag (`Not saved` · `Saving…` · `Saved`, only when `canWrite`): any shell or sky change, presets and Apply included, makes it `Not saved`. An edit made while the request is in flight keeps `Not saved` and both dirty flags. Only an explicit `saved: true` in the stored draft reads as saved. | spec, running app |
| 5b.12 | **Draft `source` survives reload, fail-safe on read.** After a save, a reload restores `source` field-for-field. A stored `source` that is malformed (missing field, wrong type, a code failing the §9 regex, `kind` not `shell`/`show`) reads as `null`, the shell is kept, and the next Save is a plain POST (never a PUT to a garbage code). `serializeDraft` writes `source` in a fixed key position. | spec (`designer-draft.spec.ts`) |

## 5c. Share

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5c.1 | Share writes exactly `${location.origin}/s/${shareCode}` to the clipboard (`navigator.clipboard.writeText` called once with that string) and shows the p5-spec toast. In the designer the code is `source.shareCode`; on a `/mine` card it is the card's code. Share makes no HTTP request. | spec (stubbed clipboard), running app (paste into the address bar) |
| 5c.2 | **Decided (p5-spec P4, §5):** Share shows whenever `source` is set, whatever `canWrite` is. With no `source` there is no Share button, and when `canWrite` is true the bar shows `Save to get a share link.` With unsaved changes the toast says the link plays the saved version. | spec |
| 5c.3 | If `writeText` rejects or `navigator.clipboard` is undefined, p5-spec's fallback is shown (the link visible and selectable), not a success toast, and no error toast. | spec |

## 5d. Working copy `/c/:code`

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5d.1 | Visiting `/c/{code}` with a clean draft sends exactly `[GET api/creations/{code}]`, then the URL is `/` and `history.length` did not grow (`replaceUrl`): Back goes to the page before `/c/…`. | spec (router), running app |
| 5d.2 | **Exactly the saved settings** (schema.md §11.2): the draft's `shell` deep-equals the response `document` after upgrade + normalize; a stored shell without `sky` gets `{gravity:160, wind:0}` (DEFAULT_SKY), never the visitor's previous sky. `activeBreak` is 0. | spec (one case with `sky`, one without, prior draft sky `{300, 40}`) |
| 5d.3 | **Loads dirty:** draft `shellDirty: true`, `skyDirty: true`. `source` equals `{shareCode, kind, isOwner, updatedAt}` from the response. | spec, running app (Application tab) |
| 5d.4 | **Reload restores the edited copy:** after 5d.1, change a field, reload `/`: the field keeps the change, `source` is unchanged, and the reload makes no `GET api/creations/…` request. | running app |
| 5d.5 | `/c/:code` works with `canWrite` false: the copy loads and plays; only the Save controls are absent (5b.1). | spec, running app (writes off) |
| 5d.6 | **Not found:** a code failing the §9 regex makes no request; a well-formed unknown code gets 404. Both show the same not-found page as the player (p5-spec copy), no generic toast, and the draft is byte-identical. The URL is not silently redirected to `/` (the `**` route must not swallow it). | spec, running app |
| 5d.7 | **Display settings across a link load (Skyler, 2026-11-14):** `display` (`mode`, `persistence`, `starBudget`, `reduceFlashing`) in the draft is unchanged by a link load. The Reduce flashing choice is device-wide under `fireworks.reduceFlashing.v1` (`on`/`off`). A pre-Phase 5 draft's `display.reduceFlashing` is adopted once, only while that key is absent. | spec |
| 5d.8 | A creation whose `document.version` is above the current one (stubbed) shows p5-spec's "newer than this app; reload" copy, does not redirect, and leaves the draft byte-identical. | spec |
| 5d.9 | **Decided (coordinator default for Q4):** a `kind: "show"` creation at `/c/:code` shows p5-spec's `This show can't be played yet.` page. There is no redirect, and the draft stays byte-identical. | spec |

## 5e. Opening a link over unsaved changes

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5e.1 | With `shellDirty \|\| skyDirty` true, visiting `/c/{code}` (by URL, by player Remix, or by `/mine` Open) shows the replace dialog with p5-spec copy before the draft changes. | spec, running app (Done-when 5) |
| 5e.2 | **Cancel:** the draft is byte-identical, the URL is `/`, and the designer shows the old draft. | spec, running app |
| 5e.3 | **Confirm:** the draft is the working copy (5d.2, 5d.3); the old shell is not kept anywhere in localStorage. | spec |
| 5e.4 | With both flags false but display settings or the active tab changed, no dialog appears (schema.md §11.3). | spec |
| 5e.5 | **Decided (F4):** opening a second link right after the first asks, because the loaded copy is dirty. Opening a link right after a successful Save doesn't ask, because Save cleared both flags. | spec |

## 5f. Player `/s/:code`

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5f.1 | **Lazy and separate:** the player is its own lazy route chunk (`ng build` output lists it; the initial bundle doesn't contain it). The player DOM has no designer panel. Its fetch ledger is exactly `[GET api/creations/{code}]` (plus the app-wide `GET api/me`). | build stats, running app |
| 5f.2 | **Plays** in a private window with no localStorage: after the p5-spec photosensitivity notice is dismissed, particles appear (HUD or stage count > 0) within the p5-spec start time. | running app (Done-when 2) |
| 5f.3 | **Flashing notice holds playback** until dismissed: while it shows, zero particles are spawned (no launches, timers don't advance, no burst backlog on dismiss), and the notice's buttons, focus and Reduce flashing control follow p5-spec. Under OS `prefers-reduced-motion: reduce` the player follows p5-spec (designer precedent: no auto-play). | spec (fake renderer launch count = 0 until dismiss), running app |
| 5f.4 | **Overlay:** shows `response.name` as text (a name `<b>x</b>` renders the literal characters, no element), and a Remix control. | spec, running app |
| 5f.5 | **Remix navigates to `/c/{code}` and makes no write:** the ledger from pressing Remix until the designer shows the copy is exactly `[GET api/creations/{code}]` (the working-copy load), with no POST, PUT or remix. The designer then shows a dirty copy (5d.3). The `…/remix` POST happens only on Save (5b.3). | spec, running app (Done-when 3) |
| 5f.6 | **Decided (Skyler, 2026-11-14):** Remix always shows, with writes on or off. It writes nothing. | spec |
| 5f.7 | **The player never edits the designer draft:** after visiting `/s/:code` and playing, the draft's `shell`, `activeBreak`, `shellDirty`, `skyDirty` and `source` are byte-identical. The only draft field the player may touch is the Reduce flashing choice, and only if p5-spec says its control writes it. | spec, running app |
| 5f.8 | **404 page:** a malformed code (no request) and a well-formed unknown code (GET 404) both show the p5-spec not-found page with a way back to `/`; no generic toast; no stage mounted (no Pixi chunk fetched). | spec, running app |
| 5f.9 | Upgrade path: GET → `upgradeShell` → `normalizeShell` → play. A stubbed `version: 2` document shows the p5-spec "newer than this app" copy and plays nothing. A current-version document that normalize adjusts logs one console warning listing the adjustments (schema.md §8.3). | spec |
| 5f.10 | **Remixed original still plays unchanged** (Done-when 3): after Save as new from a copy of A, `GET api/creations/{A}` returns a `document` deep-equal to the one before, and the new code's GET has `remixedFrom === A`. | running app (Network), `.http` |
| 5f.11 | **Decided (coordinator default for Q4):** a `kind: "show"` creation at `/s/:code` shows p5-spec's `This show can't be played yet.` page and mounts no stage. | spec |

## 5g. My creations `/mine`

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5g.1 | **Write switch:** with `canWrite` false after api/me has settled, the nav has no My creations entry in the DOM. A direct visit to `/mine` shows p5-spec's unavailable notice when api/me answered `canWrite: false`, and its `Can't reach the server.` notice when api/me failed (p5-spec §10). In both cases the ledger has **no** `GET api/me/creations`, and no toast appears. | spec, running app (writes off) |
| 5g.2 | **Direct visit before api/me answers:** with api/me pending, `/mine` neither requests the list nor shows the unavailable notice; it shows p5-spec's loading state and decides when api/me settles. (See finding N1: `canWrite` is false while loading, so a naive check shows "unavailable" in Development on every direct visit.) | spec (api/me held open, then flushed true → exactly one list GET; flushed false → notice, zero list GETs) |
| 5g.3 | **First page:** the ledger is exactly `[GET api/me/creations?page=1&pageSize={p5-spec size, default 24}]` plus `&kind=shell` (coordinator default for Q4). Cards render in response order, one per item, each with `name` as text and one swatch per `palette` entry (0–8). The page contains no `<canvas>` and fetches no Pixi chunk. | spec, running app |
| 5g.4 | **Paging:** with `totalCount > pageSize`, page controls appear and the page count is `ceil(totalCount / pageSize)`; going to page n requests `page=n` once. With `totalCount ≤ pageSize`, no page controls. With `totalCount` 0, p5-spec's empty state. | spec (stub totalCount 0, 24, 25, 49) |
| 5g.5 | **Open** goes to `/c/{code}` (so 5d and 5e apply). **Share** is 5c.1 with the card's code. | spec |
| 5g.6 | **Delete** asks per p5-spec, then sends exactly `[DELETE api/creations/{code}]`; on 204 the card is gone and the count reflects it. Deleting the last card on page n > 1 shows page n − 1, never an empty page while `totalCount > 0`. A 404 (already deleted elsewhere) removes the card too, with p5-spec copy. | spec, running app |
| 5g.7 | Deleting the creation that is the draft's `source` leaves the draft untouched; the next Update original hits 5b.5. | running app |

## 5h. Carried items from Phase 2 and Phase 3

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5h.1 | **F6/F14:** `readDraft` and `applyJson` both call `upgradeShell` before `normalizeShell`. Observable: Apply of a shell JSON with `"version": 2` shows the upgrade error copy (p5-spec, schema.md §8.2), not a normalize error; a stored draft whose `shell.version` is 2 is discarded the same way. **Negative control:** remove the upgrade call from `applyJson` and the Apply spec fails. | spec + recorded mutant, grep |
| 5h.2 | **F4:** see 5b.11. Closes when p5-spec rules and 5b.11 is green. | — |
| 5h.3 | **F10:** see 5b.9. Closes when every status listed has a spec case showing p5-spec copy. | — |
| 5h.4 | **F11:** a `type` issue with `options: ['integer']` renders integer wording (p5-spec), never "must be text". Plan allows this to slip to Phase 6; if it does, the gate records it as carried, not failed. | spec on `issueReason` |
| 5h.5 | **F12:** Apply of `{"a.b":1, …}` and of a break with key `a"b` shows the unknown-key note in p5-spec's form, not the raw bracket path `["a.b"]`. | spec on `designer-copy.ts` |

## 5i. Deep links and Railway

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 5i.1 | In the built image (compose), a cold load or reload of `/s/{code}`, `/c/{code}` and `/mine` returns 200 `text/html` (the SPA fallback) and renders that route. `GET /api/creations/abcdefgl` stays the API 404, not HTML. | running app (built image), `curl -i` |
| 5i.2 | **Railway (deferred to the test window):** 5i.1 against the Railway URL. | Railway |
| 5i.3 | **Railway round trip (deferred):** with `Identity__AllowAnonymousWrites=true` set for the window, Done-when steps 1–5 pass on the Railway URL, the share link plays in a private window on a second device or browser, and Share's clipboard works on the https origin. | Railway |
| 5i.4 | **Railway switch-off (deferred):** after the window, `GET /api/me` returns `canWrite: false`, `POST /api/creations` returns 403, Save controls and the My creations entry are gone, and links saved during the window still play. | Railway |
| 5i.5 | **Railway 413 (deferred, Boo S5):** a Save over 256 KiB through the edge shows the 5b.9 413-or-status-0 copy, whichever status the edge actually produces (recorded). | Railway |

---

## Done-when map

| Done-when step | Criteria | Runs where |
|---|---|---|
| 1. Save: POST + new code | 5a.3, 5a.4, 5b.2 | running app |
| 2. Link plays in a private window | 5f.1, 5f.2, 5f.3 | running app; 5i.3 on Railway |
| 3. Remix → dirty copy → Save as new → new code, `remixedFrom` set, original unchanged | 5f.5, 5d.3, 5b.3, 5f.10 | running app (owner only before Phase 8) |
| 4. Update original keeps the code; link plays the change | 5b.3, then 5f.2 on the same code | running app |
| 5. Open over dirty asks; Cancel keeps the draft | 5e.1, 5e.2 | running app |
| Known limit: non-owner Save | 5b.4 | spec only |
| Deep links on Railway | 5i.1, 5i.2 | Railway (deferred) |

## Open questions for Skyler

- **Q1 (player Remix with writes off).** `session.ts` lists Remix among the write controls hidden when `canWrite` is false, but Remix makes no API call (schema.md §11.1); Save is the write. Before Phase 8 production has `canWrite` false, so hiding Remix makes the player a dead end. **Recommended default:** show Remix regardless of `canWrite`; the designer hides Save as usual.
- **Q2 (display settings across a link load).** §11.3 says the working copy "replaces the draft". The draft also holds device settings (`mode`, `persistence`, `starBudget`, `reduceFlashing`). Wiping `reduceFlashing` on a link load would undo a photosensitivity choice. **Recommended default:** a link load replaces `shell`, `activeBreak`, the flags and `source`, and keeps `display` (as a preset does).
- **Q3 (Share on a dirty working copy).** Share copies `/s/{source.shareCode}`, which plays the saved record, not the unsaved edits on screen. **Recommended default:** Rosalina's p5-spec decides presentation; acceptance needs only that the copied link is always `source`'s and that Share is absent when `source` is null.
- **Q4 (shows before Phase 6).** The API already accepts `kind: "show"`, but there is no Show Builder or `TimelineDriver` yet. What do `/s/:code`, `/c/:code` and `/mine` do with a show? **Recommended default:** `/mine` requests `kind=shell` until Phase 6; `/s/` and `/c/` show a short p5-spec "shows aren't supported yet" notice and leave the draft untouched.

## Findings for the team

- **N1 (`core/session.ts` `canWrite`; plan Phase 5 `/mine`):** `canWrite` is `false` while `api/me` is loading, and app.config doesn't wait for it. A `/mine` that checks only `canWrite()` on init would show "unavailable" and skip the list on every direct visit or reload, even in Development. `/mine` must also read `session.status()` (5g.2). Owner: Luigi.
- **N2 (`designer-draft.ts` `readDraft`/`serializeDraft`):** neither knows `source` yet; today a `source` key would be dropped on the next write. 5b.12 sets the fail-safe (malformed reads as `null`, so the worst case is a plain POST, never a PUT to a bad code). Owner: Luigi.
- **N3 (`app.routes.ts` `**` → `''`):** unknown paths redirect to the designer. `/s/:code` and `/c/:code` with a bad code must show the not-found page rather than fall through (5d.6, 5f.8). Owner: Luigi.
- **N4 (p5-spec dependency):** 5b.3, 5b.9, 5b.11, 5c.1–5c.3, 5d.6, 5d.8, 5e.1, 5f.2–5f.4, 5f.8, 5g.1–5g.6, 5h.4, 5h.5 check copy or a rule from Rosalina's `design/phase-5.md`. I'll re-check the button labels and the F4 rule against it when it lands; F4 (5b.11) is the one criterion that's written with both possible outcomes.

## Acceptance review, 2026-11-14 (after Luigi batch 2)

Evidence: `ng test` 1227/1227 in 39 files (rerun by Peach); Luigi's running-app smoke `scratchpad/smoke/luigi-p5-donewhen.mjs` 31/31 against `ng serve` + compose API; the code under `src/web/fireworks-web/src/app/`.

| Section | Verdict | Notes |
|---|---|---|
| 5a Contracts and service | Accept | Compact `{kind, document}` POST body and exact ledgers, in spec and smoke. |
| 5b Save | Accept | F4 decided (5b.11). PUT 404 asks, and remix 404 falls back by itself (schema.md §11.2). Non-owner Save is spec only. |
| 5c Share | Accept | 5c.2 decided per p5-spec §5. |
| 5d `/c/:code` | Accept | `display` is kept (5d.7). Bad codes get the link not-found page (N3). |
| 5e Link over unsaved changes | Accept | 5e.5 decided. In the smoke, Cancel leaves the draft byte-identical and lands on `/`. |
| 5f Player | Accept | Remix always shows. The player never writes the draft (5f.7). The show page is "not yet". |
| 5g `/mine` | Accept | Waits for `status` (N1). Sends `kind=shell` and `pageSize=24`. |
| 5h Carried | Accept | F4, F6, F10 and F12 are closed. F11 is closed too (`save-copy.spec.ts`, integer wording). |
| 5i Deep links, Railway | Accept 5i.1 with a note; 5i.2–5i.5 deferred | 5i.1 was not run against the built image this batch. Only `/s/abc123` is covered (`SkeletonEndpointTests.cs`). Run the `curl -i` check at the gate. |

**2c.8 replacement:** accepted. The rule is in `features/designer/designer-structure.spec.ts`. The cold-load ledger in `app.startup.spec.ts` is still the behavioral backstop.

**Open before the Railway window:** the test-mode banner copy is provisional (`shared/test-mode-banner.ts`). Rosalina owes the final copy.

# Phase 5 security requirements: share-link exposure and untrusted creation data in the client

**By:** Boo · 2026-11-14 · Phase 5 security-review, before implementation
**Status:** proposed. C1–C20 bind Phase 5 for Luigi (build) and Toad (tests) once the coordinator forwards them. Promotion to the index is Skyler's call.
**Read against:** plan Phase 5 and §3.4; schema.md §2, §8.3, §9, §10, §11; `boo-phase4-security-requirements.md` (S1–S29) and `boo-phase4-security-verification.md`; the shipped client (`src/web/fireworks-web/src/app/core/*`, `engine/model/{upgrade,normalize}.ts`, `features/designer/shared/designer-draft.ts`, `designer-structure.spec.ts`, `app.html`, `shared/confirm-dialog.ts`, `engine/render/*`); the API (`CreationsController.cs`, `CreationService.cs` `GetAsync`/`ToResponse`, `CreationRepository.cs` `DeleteOwnedAsync`).

## What a share-link visitor can learn (settled from the code)

A `GET api/creations/{code}` returns exactly the S12 keys: `shareCode, kind, name, schemaVersion, document, isOwner, remixedFrom, createdAt, updatedAt` (`CreationService.ToResponse`, l.340–355). No internal id, no owner id, no user data.
- `isOwner` is true for every interim visitor (default user). It reveals nothing extra before Phase 8, and after Phase 8 it is false for everyone but the owner.
- `remixedFrom` reveals the original's share code to every interim visitor of a remix link. **Accepted interim exposure** (Skyler, ruling on S13). C10 keeps the client from widening it.
- `createdAt`/`updatedAt` show when a link was made and last changed. Info; accepted as honest (OQ3 says a link can be rewritten).
- **No existence oracle.** A never-existed code and a deleted code take the same path: one `FindByShareCodeAsync`, null, and the controller's fixed `NotFoundMessage` body (`CreationsController.cs:121`). Delete is a hard `ExecuteDeleteAsync` (`CreationRepository.cs:168–171`), so no tombstone row could make the two differ in body or timing. A malformed code gets the catch-all's empty 404 instead of the JSON 404. That reveals only the format, which is public (§9). The client must still render both the same way (C12).

## What

Each item has a verification method that Toad (or I) can run after implementation. "Spec" means a Vitest spec in `src/web/fireworks-web`. "Running app" means the Production build with writes on, unless the item says otherwise.

### Rendering untrusted strings

**C1 (must-have). Creation strings render as text only, app-wide.** This covers names, issue paths, `kind`, and anything else from a response or the draft. Interpolation (`{{ }}`), `[textContent]`, `Title.setTitle` and plain attribute bindings only. Banned in every non-spec file under `src/app` and `src/engine`: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `bypassSecurityTrust`, `DomSanitizer`, `Renderer2.setProperty(…, 'innerHTML')`, Pixi `HTMLText`, `eval(` and `new Function`.
- *Why:* the name is the only free text a stranger controls, and a share link delivers it to whoever opens it. Today's ban (`designer-structure.spec.ts:64`) covers only `features/designer` and `app/shared`. The player, `/mine`, `/c/:code` and `core/creations.ts` would fall outside it.
- *Verify:* (a) Replace the designer-only test with an app-wide structure spec over `src/app` and `src/engine`. Negative control: add `<span [innerHTML]="name()">` to the player overlay and check that the spec fails. (b) Running app: save shells named `<img src=x onerror=alert(1)>`, `{{7*7}}` and `"><svg onload=alert(1)>`, then open `/s/:code`, `/mine` and the delete confirm. Each element's `textContent` must equal the literal, `document.title` must contain the literal, no `img` or `svg` element may appear, and no alert may fire.

**C2 (must-have). A name never reaches a URL, a URL attribute, a linkifier or the canvas.** No `[href]`, `[src]` or `routerLink` built from a name. No auto-linking of URLs in names. No Pixi `Text` of the name (today `engine/render` draws no text at all).
- *Verify:* grep the templates for `name` inside `href`, `src` or `routerLink` bindings and expect none. Running app: a name of `https://evil.example` renders as plain text with no anchor.

**C3 (hardening, low). Isolate the name's direction.** Render it in `<bdi>`, or in an element with `dir="auto"` and `unicode-bidi: isolate`. §6.4 removes Cc characters, but Cf characters such as U+202E (right-to-left override) survive. Without isolation, a name can visually reorder the overlay copy next to it ("Remix", the test-mode banner).
- *Verify:* a spec asserts the overlay and card name elements are `bdi` or carry `dir="auto"`. Running app: the name `‮ximer` doesn't reverse the Remix button label.

### Share codes and URLs

**C4 (must-have). Validate every share code with the §9 TS regex `^[1-9A-HJ-NP-Za-km-z]{8}$` before building a URL from it.** This applies to the `/s/:code` and `/c/:code` route params, the draft's `source.shareCode`, `/mine` list items, and every response's `shareCode`. Build paths only from a fixed template, `api/creations/${code}`, after validation.
- *Why (measured with the WHATWG URL parser):* `new URL('/api/creations/../me')` and `/api/creations/%2e%2e/me` both resolve to `/api/me`. The router decodes `/s/..%2Fme` to `../me`, so without the check a crafted link makes the client request a different endpoint. That is client-side path traversal. It is harmless for GETs today, but it becomes a CSRF-shaped primitive for writes once Phase 8 adds cookies.
- *Corollary:* **`source.shareCode` is taken from the GET response's `shareCode` (validated), never from the route param.**
- *Behavior on failure:* a route param that fails shows the not-found page and makes no request. A draft source that fails is dropped (C6). A list item that fails is skipped, with a console warning. A response code that fails is an error, and nothing is stored or copied.
- *Verify:* `creations.ts` spec with `HttpTestingController`. The codes `../me`, `..%2Fme`, `%2e%2e`, `abcdefgl`, `abcdefgI`, `abcdefg0`, `abcdefgh\n`, 7 characters, 9 characters and `abcdefgK` must produce **zero** requests (`expectNone` plus `verify()`). Negative control: remove the regex and `../me` issues `GET api/me`.

**C5 (must-have). The player and `/c/:code` always run GET → runtime `kind` check → `upgradeShell`/`upgradeShow` → `normalizeShell`/`normalizeShow`, then the engine or `editableFrom`.**
- `kind` is checked at runtime against exactly `'shell'` and `'show'`. `models.ts` types it as a trusted union, but TypeScript checks nothing at runtime. Any other value shows the not-found or unsupported page, and normalize is never called.
- An upgrade error (newer version) shows the "reload to open this" copy, and the engine is never called.
- Normalize adjustments on a current-version document log a `console.warn` with codes and paths only (§8.3), never the name or the document.
- The displayed name is the normalized document's name, not the envelope's.
- *Verify:* stubbed-response specs. (a) `stars: 9999` reaches the engine as 400. (b) `version: 2` shows the reload copy, and the spy on the engine or `editableFrom` records 0 calls. (c) `kind: 'Shell'` and `kind: 'gallery'` record 0 normalize calls and show the not-found page. (d) `document: "x"` and `document: null` show the error page. (e) Call order: a spy ledger asserts exactly `[upgrade, normalize, play]`. Negative control: skip upgrade, and (b) fails.

### Client state is not authority

**C6 (must-have). The draft's `source` is untrusted on restore.** `readDraft` accepts it only when `shareCode` passes C4, `kind` is in the enum, `isOwner` is a boolean, and `updatedAt` is a string of at most 64 characters. Otherwise `source` is `null`: the shell is kept, and Save becomes a fresh POST.
- *Verify:* `designer-draft` specs with tampered sources: a bad code, `kind: 'admin'`, `isOwner: 'true'`, a 10 KB `updatedAt`, and `source: []`. Each restores the shell with `source: null`.

**C7 (must-have). `isOwner` only chooses which Save options appear. It never authorizes anything.** No request carries `isOwner`, an owner id, a user id or `remixedFrom`.
- POST bodies have exactly the keys `{kind, document}`. PUT and remix bodies have exactly `{document}`.
- The body is compact `JSON.stringify`, HttpClient's default (S1, schema.md §2.5).
- *Verify:* the call-ledger specs (C8) also assert each request's body key set and that the body has no newline. Running app: set `source.isOwner = true` in localStorage on a working copy of a record you don't own (two-user rig from `boo-phase4-security-verification.md`: same DB, two `Identity__DefaultUserId`s). Update original gets 404, and the stored row is unchanged.

**C8 (must-have). The server's answer decides, and the client never retries a write on its own.**
- A PUT 404 offers Save as new, which is a plain `POST api/creations` (never remix, never another PUT).
- A remix 404 falls back to a plain `POST api/creations`.
- A 403 reloads the session and hides the write controls.
- A 429 shows copy and doesn't retry automatically.
- *Verify:* exact sorted call ledgers (`toad-exact-call-ledger-over-positive-assertions.md`):
  - `isOwner: false` Save is `[POST …/remix]`.
  - PUT 404 then Save as new is `[PUT, POST api/creations]`.
  - Remix 404 is `[POST …/remix, POST api/creations]`.
  - A 403 is followed by exactly one `GET api/me` and no further writes.
  - A 429 is the single write, with nothing after it.

**C9 (must-have). Write controls need `session.canWrite()`, never `isOwner` alone.** Update original needs `canWrite && source.isOwner`. Delete on `/mine` needs `canWrite`. With `canWrite` false, no Save, Update, Delete or "Save as new" control renders anywhere, including the player, even though every interim response says `isOwner: true`. `/mine` makes no call in that state (plan §3.4).
- *Verify:* a spec with `me.canWrite: false` and a response with `isOwner: true` finds no write control in the DOM, zero write requests and zero `GET api/me/creations`. Running app, Production with writes off: the player shows only Remix, and the designer has no Save.

### Share-link exposure

**C10 (must-have). `remixedFrom` is not rendered anywhere in Phase 5** (player, `/mine`, designer, toasts). It stays in the model, and no template or copy function reads it.
- *Why:* the accepted interim exposure is an API field. Rendering it would put the original's unlisted code, or a link to it, in front of every viewer of every remix link and into their screenshots. A "Remixed from" UI, if wanted, needs `isAuthenticated && isOwner` and waits for Phase 8. That is a question for Skyler, not a Phase 5 default.
- *Verify:* grep `src/app` for `remixedFrom` outside `models.ts`, `creations.ts` and specs, and expect none. Running app: on a remix's `/s/:code`, the page's `innerText` doesn't contain the original's code.

**C11 (must-have). Share copies exactly `${location.origin}/s/${code}`.** The code is the C4-validated `shareCode` from the save response or list item. Never a server-provided URL, never the `Location` header, never the name, never a `/c/` link.
- *Verify:* a spec stubs `navigator.clipboard.writeText` and asserts its single argument with a regex. A response `shareCode` of `ab/../x1` gives no `writeText` call and shows error copy.

**C12 (must-have). One not-found page, with no retry.** A route param that fails C4 (no request), a service 404 (JSON body) and a catch-all 404 (empty body) render the same DOM. The draft is unchanged in each case, byte for byte. A 429, a 5xx or status 0 shows different copy ("couldn't load, try again"), never "doesn't exist", and nothing retries in a loop.
- *Verify:* three stubbed cases compare the not-found region's DOM snapshot as equal, and the draft storage string is identical before and after. The request count is 0 for the regex case and 1 for each 404. The 429 case shows distinct copy and makes exactly 1 request.

**C13 (must-have). A link can't silently replace the visitor's work, and loading one never writes.** This is the security reading of §11.3. Opening `/c/:code` over a dirty draft asks first, and Cancel leaves the draft byte-identical. `/s/:code`, Remix and `/c/:code` issue only GETs.
- *Verify:* a spec with a dirty draft navigates to `/c/:code`. The confirm is shown, Cancel leaves the storage string unchanged, and the ledger is `[GET api/creations/{code}]` with no POST, PUT or DELETE. The same holds for the player's Remix click.

**C14 (must-have). No navigation target comes from input.** `/c/:code` redirects to a fixed route chosen by the validated `kind` (`/` for a shell), with `replaceUrl`. No `returnUrl`, `next` or `redirect` query parameter is honored anywhere.
- *Verify:* `/c/<code>?returnUrl=https://evil.example` lands on `/`. Grep `navigateByUrl(` and `router.navigate(` and expect literal or route-table targets only.

**C15 (must-have). Save-failure copy is built from the status and issue `code`, never from server `message` text or the name.** Issue paths may appear, as text (C1). When `truncated` is true, the UI says there are more issues. The `upgrade.ts` message (l.58, which embeds `JSON.stringify` of an untrusted `version` of unbounded length) is never shown either: use the `version` code's copy.
- *Verify:* stub a 400 whose `message` and an issue `message` are `<b>x</b> visit evil.example`. The DOM doesn't contain `evil.example`.

**C16 (hardening). Console logging is limited to share code, status and issue codes.** Never log names or documents. The existing interceptor logs `urlWithParams`, which contains a share code. That's acceptable, because the console is the visitor's own.
- *Verify:* grep `console.` in new Phase 5 files and expect no `name` or `document` arguments.

### Interim exposure (plan §3.4, S28)

**C17 (must-have; promotes S28's hardening bullet now that Save UI ships). Show a test-mode banner when `canWrite && !isAuthenticated`.** It appears on every page that shows a write control (designer, player, `/mine`). Rosalina writes the copy, which must say that anyone who can reach the site can change or delete every saved creation and that a share link can be changed to play something else.
- *Verify:* a spec with `{canWrite: true, isAuthenticated: false}` shows the banner on all three pages. `{canWrite: false}` and `{canWrite: true, isAuthenticated: true}` (the Phase 8 shape) show none. Running app with writes on: the banner is visible.

**C18 (must-have, at deploy; carried from Phase 4). The Phase 5 Railway round trip is the first test window, so it runs S5 and S21 and follows the S28 runbook.** That means: `pg_dump` before; S5's 413 through the edge (its observed status decides the 413 copy in F10); S21 (a) and (b); then remove the variable, redeploy, confirm `canWrite: false` and a 403 on `GET api/me/creations`, and compare the row count and `max(updated_at)`. Bowser runs it, I check the output.

### Content safety and third parties

**C19 (must-have; cross-reference, owned by Rosalina and Toad).** A share link plays content chosen by whoever saved it, so the player's flashing safety (standing decision: first-visit notice, Manual under reduced motion, Reduce flashing) takes effect **before the first burst**, not after the creation loads.
- *Verify:* Rosalina's and Toad's player specs. From the security side: under reduced motion, the engine receives no launch before the visitor acts.

**C20 (hardening; the header is Phase 7, Bowser's). No third-party requests from any page.** No external fonts, analytics or images. A cross-origin request from `/s/:code` would carry the share code in `Referer` under a looser policy, and a same-origin-only page keeps the Phase 7 CSP simple. Phase 7 adds `Referrer-Policy: same-origin`, plus `frame-ancestors 'none'` against clickjacking Delete on `/mine` during test windows.
- *Verify:* running app: the network log for `/s/:code`, `/` and `/mine` shows only same-origin requests.

## Why

Phase 5 is the first time a stranger's text and documents reach other people's browsers through a link, and the first time the client builds write URLs. The server guarantees hold (Phase 4 verification): owner-only writes are enforced in the service, unknown and not-owned codes give the same 404, there is no existence oracle, and responses have no internal ids. So the client-side risks are rendering (C1–C3, C15), URL construction (C4, C11, C14), trusting client state (C6–C9), and widening the accepted interim exposures (C10, C17). Each requirement is cheap now and awkward to retrofit after the player and `/mine` ship.

## Boundary

- Binds Phase 5 client code (Luigi) and its specs (Toad), and the Phase 6 Show Builder for the same surfaces: a show's working copy, its link and embedded shell names follow C1–C15 unchanged.
- Not decided here: copy (Rosalina), whether Save clears the dirty flags (F4), Phase 7 CSP and headers beyond C20's pointer, and Phase 8 auth and CSRF. C4 is a precondition for Phase 8 CSRF safety, not its design.
- Any future server-rendered `<meta>` or Open Graph tags carrying a name (link previews) are a new HTML-injection surface and need their own review. Today the SPA has none, so unfurl bots see only "Fireworks Sandbox".
- Info for Yoshi: schema.md §9 says a share code "is never reused after a delete", but delete is a hard delete with no tombstone. Reuse is therefore only improbable (a 47-bit draw against the live rows), not prevented. Either reword §9 or keep a deleted-codes table. I recommend the rewording, because the risk is negligible.

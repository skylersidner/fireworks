# Phase 5 batch 1: client foundation for creations, Save and untrusted documents

> **Superseded in part by luigi-phase5-save-share-player.md on 2026-11-14:** point 4's fallback (a 404 from PUT or from remix falls back to a plain POST) is replaced by that record's point 3. Only a remix 404 falls back by itself. A PUT 404 asks, and `source` becomes null after either 404. The Boundary's two open items are closed there too: F4 (point 1) and the 2c.8 structure rule (point 2a). Points 1–3 (the status-keyed errors, the outcome values and the share-code check) and 5 stand.


Luigi, 2026-11-14. Plan Phase 5 (Client integration); schema.md §2, §8.3, §9, §11.

## What

1. **`core/creations.ts` `CreationsService`** mirrors CreationsController one method per action: `create`, `getByShareCode`, `update`, `delete`, `remix`, `listMine({ page?, pageSize?, kind? })`. Methods emit the raw `HttpErrorResponse`; `toCreationError(error)` maps it to a `CreationError` union keyed on status only: `validation` (400, with sanitized `errors` and `truncated`), `forbidden` (403), `not-found` (404), `too-large` (413), `rate-limited` (429, `retryAfterSeconds` from `Retry-After`, seconds or HTTP-date, else null), `network` (0), `unexpected` (anything else, or a non-HTTP error).
2. **Every creation call carries `SUPPRESS_ERROR_TOAST`**, reads included (the reference's custom-moves convention). Each caller renders its own failure: inline validation, the player's 404 page, Save-failure copy, `/mine` notices. A subscriber that ignores `error` shows nothing.
3. **A malformed share code never reaches the network.** `core/share-code.ts` holds `SHARE_CODE_PATTERN` and `isShareCode` (pure, no Angular import). Item methods given a bad code throw a synthetic 404 `HttpErrorResponse`, so it maps exactly like an unknown code.
4. **Save is pure decisions plus one runner** (`core/creation-save.ts`): `saveChoices(source)`, `planSave(source, choice, kind)`, `fallbackPlan(failed, error)`, `sourceFrom(response)`, and `saveCreation(service, request)`. `saveCreation` never errors: it emits one `SaveOutcome` value, `{ ok, request, fellBack, response/source | error }`. It sends at most two requests, and never two remixes. A 404 from PUT or remix falls back to a plain POST, with `fellBack: true`. That is a success with a caveat. `planSave` throws on a choice `saveChoices` didn't offer, or when the source's kind isn't the document's kind.
5. **`engine/model/open.ts` `openShell`/`openShow`** (upgrade → normalize, with the upgrade failure folded into the normalize failure branch) is the only way untrusted documents enter. Draft restore and JSON Apply use it now. The player and `/c/:code` must use it in batch 2. `toEditable` stays for the form model only, and `designer-structure.spec.ts` pins both.
6. **Draft `source`** is `{ shareCode, kind, isOwner, updatedAt } | null`, read all-or-nothing by `readSource`. A missing or malformed source reads as `null` and keeps the shell. Its fields are serialized in a fixed order and nothing else from the object is kept. The store holds it as a read-only signal, restored and written back with the draft. Presets and Apply don't touch it.

## Why

- Status-keyed errors: the 404 body is fixed and the 429 body is unspecified (schema.md §2.7). The 400 body is server input, so only well-formed issues are kept.
- Outcome values instead of Observable errors: with the toast suppressed, a forgotten `error` handler would hide a failed Save completely.
- One `open*` entry: in v1, upgrade and normalize reject the same versions, so a skipped upgrade is invisible in behavior until v2 ships. The structure spec is the only guard that fails today.
- A pure share-code module keeps the draft (and later the designer) from importing the HTTP client just to validate a stored code.

## Boundary

- Copy for every `CreationError` kind and for `fellBack` is Rosalina's (F10). Nothing here renders text.
- Whether a successful save clears the dirty flags (F4) is still open; `saveCreation` doesn't touch the store.
- **The designer structure rule "reads nothing from SessionService and makes no HTTP calls (2c.8)" has to change in batch 2.** Save needs `session.canWrite()` and `CreationsService` in the designer page. The narrowest version: only the page (or a Save component) may inject them, and the store and draft stay HTTP-free.
- The caller validates strictly (`validateShell`/`validateShow`) before `saveCreation` (§8.3). The runner doesn't, so it stays kind-agnostic.
- No `If-Match` precondition, and no stale-tab GET before PUT (§11.4). `source.updatedAt` is kept for when the precondition is added.

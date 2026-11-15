# Phase 5 batch 2: Save, Share, the player, `/c/:code` and My creations

> **Superseded in part by luigi-phase6-show-builder.md on 2026-11-14:** point 6's runtime `kind` check no longer answers "not yet" for shows. `openCreation` now opens shows (Phase 6 point 8). The rest of point 6 stands.

Luigi, 2026-11-14. Plan Phase 5; schema.md §7, §11; phase-5.md (Rosalina); `boo-phase5-security-requirements.md` C1–C17; `acceptance/phase-5.md` (Peach). Builds on `luigi-phase5-client-foundation.md`.

## What

1. **F4, confirmed as Rosalina designed it.** A successful save clears `shellDirty` and `skyDirty`, and a third draft flag, `saved`, drives the indicator. `saved` is a `linkedSignal` over the store's `[shellPart, skyPart]` (by reference), so any model change, a load's included, computes `false`. Only `completeSave(source, snapshot)` sets it `true`, and only when both parts are still the objects captured at the press (`snapshotForSave`). `source` is set either way. The draft stores `saved` between `skyDirty` and `source`, and only an explicit `true` reads as saved. It is never in a document (schema.md §7: "never persisted" means never in a document).

2. **Exact structure rule replacing 2c.8** (`designer-structure.spec.ts`, for Peach's gate review). In `src/app/features/designer`, the regex `IDENTITY_OR_HTTP` matches four things:
   - `inject(SessionService | CreationsService | HttpClient | ApiService)`;
   - a non-type `import … from '…core/(session|creations|api|open-creation|creation-save)'`;
   - a non-type import from `@angular/common/http`;
   - a call to `saveCreation(` or `openCreation(`.

   The rule has two parts:
   - The set of files that match is **exactly** `pages/designer-page/designer-save.ts` (the page-provided `DesignerSaveFlow`, the "Save component") and `pages/open-link-page/open-link-page.ts` (`/c/:code`). The page itself reaches identity only through `DesignerSaveFlow`.
   - `shell-designer.store.ts` and `designer-draft.ts` never match. A `import type` (for example `CreationSource`) is allowed anywhere.

   Negative controls in the spec feed each banned form to the regex, and both type-only forms must pass. The mutant "store injects SessionService" was killed. Only the page and `DesignerSaveFlow` may `inject(ShellDesignerStore)`.

   **Superseded by "Final 2c.8 rule" (review-fix round, 2026-11-14), below.**

2a. **Final 2c.8 rule** (`designer-structure.spec.ts`; Toad F2, Peach). Scope: every non-spec `.ts`/`.html` under `src/app/features/designer` **and `src/app/shared`**.
   - **Banned core modules are derived, not listed.** Seeds: each non-spec `src/app/core/*.ts` that has `inject(HttpClient …)` or `inject(ApiService …)`, or uses `fetch(`, `XMLHttpRequest` or `httpResource`. Closure: a core module that value-imports (`./x`) a banned module is banned. Today that is exactly `api`, `api-status`, `creation-save`, `creations`, `health`, `open-creation`, `session` (pinned, so a new HTTP-reaching core file fails the test until it is reviewed). Banned injectables: `HttpClient` plus every `export class` in a banned module.
   - **A file "reaches"** when it has any of: a non-type import of a banned core module (static, side-effect, `export … from`, or dynamic `import()`; single or double quotes; multi-line specifier lists); a non-type import of `@angular/common/http`; `inject(X)`, `inject(X, {…})` or `inject<T>(X)` for a banned injectable; `fetch(`, `XMLHttpRequest`, `httpResource`. `import type` is allowed anywhere.
   - **The set of reaching files, with their exact hit labels, must equal:**
     - `features/designer/pages/designer-page/designer-save.ts`: import core/creation-save, core/creations, core/session; inject(CreationsService), inject(SessionService).
     - `features/designer/pages/open-link-page/open-link-page.ts`: import core/creation-save, core/creations, core/open-creation; inject(CreationsService).
     - `features/designer/pages/designer-page/designer-page.ts`: import core/api-status; inject(ApiStatusService). The API banner only; ApiStatusService is allowed nowhere else.
     - `shared/test-mode-banner.ts`: import core/session; inject(SessionService).
   - `shell-designer.store.ts` and `designer-draft.ts` reach nothing.
   - Negative controls feed every form above (each new one included) to the matcher, plus six allowed forms that must not match, and a synthetic core map that checks the closure follows value imports and ignores type imports.

2b. **A source must be the draft's kind.** `readSource(value, expected)`; the shell draft passes `'shell'`, so a hand-edited `source.kind: 'show'` reads as `null` (Boo info). `DesignerSaveFlow.save()` builds the `saveCreation` Observable (which plans synchronously and throws for a plan it can't make) before setting `saving`; a throw shows the server-fault status and sends nothing.

2c. **Names in plain strings are isolated** (Boo C3 close-out): `app/shared/bidi.ts` `isolate(name)` wraps U+2068 … U+2069, quotes outside. Used by `quoted()`, `designer-copy.ts` `quotedName`/`confirmLinkTitle`/`confirmLinkBody`, `mine-page.ts` `deleteTitle`/`afterDelete`, and `creationTitle()`. Template sites keep `<bdi>`.

3. **A PUT 404 no longer falls back by itself.** `fallbackPlan` retries only after a remix 404 (phase-5.md §6). After a PUT 404 the flow sets `source` to null (Y2) and shows row 404a; its `Save as new` button sends a plain POST. A remix 404 also sets `source` to null, so if the fallback POST fails, `source` stays null (schema.md §11.2). This changes batch 1's `saveCreation` contract. Its specs are updated.

4. **A response whose `shareCode` fails the §9 pattern is an `unexpected` failure** inside `saveCreation`, so a bad code is never stored or copied (C4).

5. **`CreationSource.name` (Y1)** is copied from the response. `readSource` stays all-or-nothing: a missing or non-string `name`, or one longer than 160 UTF-16 units, reads as `null`. An `updatedAt` longer than 64 characters also reads as `null` (C6).

6. **One entry for share links: `core/open-creation.ts` `openCreation(service, code)`.** It runs:
   - the §9 code check, with no request on failure;
   - the GET;
   - a runtime `kind` check (`'show'` gives "not yet", and anything but `'shell'` gives not-found);
   - a check of the response `shareCode`;
   - `openShell`, which upgrades and then normalizes.

   It never errors. It logs adjustments and failures as `kind/code path` only. The player and `/c/` are its only callers, and `getByShareCode` is called nowhere else (`src/app/unsafe-sinks.spec.ts`).

7. **`/c/:code` is a component that redirects.** `OpenLinkPageComponent` opens the creation and builds `editableFrom(shell, DEFAULT_SKY)` plus `sourceFrom(response)`. It hands both to the root `WorkingCopyHandoff`, which holds one copy in memory and has no HTTP, then calls `navigateByUrl('/', { replaceUrl: true })`. The designer page `take()`s the copy on construction. When clean, the copy loads at once. When the shell or sky is dirty, the confirm (`pendingReplace` kind `link`) shows over the designer. The copy fires once the stage is `running`, and focus goes to the panel `h1`. The link pages follow `paramMap`, because the router reuses the component from `/c/a` to `/c/b`. A spec found that.

8. **Device-wide flashing preferences** live in `core/device-preferences.ts`:
   - The Reduce flashing choice is stored in `fireworks.reduceFlashing.v1` as `on` or `off`. It is a root signal shared by the designer and the player. A pre-Phase 5 draft's `display.reduceFlashing` is adopted once, and the draft still mirrors it.
   - The notice dismissal stays in `fireworks.flashNotice.v1`. It is read from storage each time a page opens, and each page holds its own visible state, so refused storage still shows the notice on every page load, as 2c's specs require.
   - The player never writes the draft.

9. **Routes.** `s/:shareCode` (player), `c/:shareCode`, `mine`, and a `UrlMatcher` per prefix that sends any other `/s…` or `/c…` path to `LinkNotFoundPageComponent` (N3). `**` still redirects to `''`.

10. **The stage moved to `app/shared/fireworks-stage/`** so the player doesn't import from the designer feature. It gained `clickToFire` (false on the player).

11. **The test-mode banner is `app/shared/test-mode-banner.ts`.** It renders when `canWrite && currentUser.isAuthenticated !== true`, on the designer, the player and `/mine`. **Its copy is provisional** (Rosalina hasn't written it). It states what C17 requires.

12. **C1 is app-wide.** `src/app/unsafe-sinks.spec.ts` scans every non-spec `.ts`/`.html` file under `src/app` and `src/engine`, and covers C1, C2, C10 and C14, with negative controls.

## Why

- F4: I found no defect. The by-reference check costs nothing (the parts are already computed for the dirty flags), and "edit during the request reads Not saved" falls out of it. Persisting `saved` matters: without it, a reload after a save would read "Not saved" and re-enable Update original for work that is already on the server.
- The handoff keeps the confirm over the designer (phase-5.md §7.2) without a resolver that would need the designer's store before the designer exists.
- Separate preference keys let the player honor and change Reduce flashing without touching the draft, so acceptance 5f.7 holds byte for byte.

## Boundary

- Not decided here: the test-mode banner copy (Rosalina), the 413 copy through Railway's edge (Boo S5, deploy), and anything about Phase 6 shows beyond the "not yet" notice.
- The 256 KiB pre-check measures the POST body (`{kind, document}`) for all three requests. That bound is the safe one, and a shell can't reach it.
- `issueReason`'s `version` row still quotes the value. It is the visitor's own pasted JSON in Apply (2c §3.6). Share-link pages and Save failures word version failures from the code alone (C15).

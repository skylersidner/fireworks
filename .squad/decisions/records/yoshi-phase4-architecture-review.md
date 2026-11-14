# Phase 4 architecture review: backend against schema.md

> **Superseded in part by rosalina-phase-5-design-review.md (item 5) and luigi-phase5-save-share-player.md (point 3) on 2026-11-14:** the PUT half of item 2 no longer holds. A 404 from Update original now asks: `source` becomes null and "Save as new" sends a plain `POST api/creations`. A 404 from `…/remix` still falls back to a plain POST by itself, which is item 2's remix half. The rest of the record stands.


**Author:** Yoshi · **Date:** 2026-11-13 · **Status:** proposed (for Skyler to promote, or not)
**Reviewed:** Bowser's uncommitted `src/api/Fireworks.Api/**` (`CreationsController.cs`, `Services/Creations/*`, `Repositories/CreationRepository.cs`, `Data/FireworksDbContext.cs`, `Data/Entities/Creation.cs`, `Data/Migrations/20261113202016_AddCreations.cs`, `Program.cs`), against `docs/fireworks-app/schema.md` and plan Phase 4. Record under review: `bowser-phase4-creations-persistence.md`.
**Probe:** a scratch copy of `src/api` plus one throwaway xunit test on `FireworksApiHarness` (Kestrel + SQLite), outside the repo. It measured the 415 and 413 bodies, the 201 and list payloads, both 404 bodies, and the next pooled request after a 403/415 on an unread 200 KB and 2 MB body (that request succeeded both times).

## What

1. **Bowser's five departures are accepted**, and schema.md now states each in place:
   - `COLLATE "C"` on `share_code` (§9);
   - microsecond truncation, and `updatedAt` as an exact, opaque token that clients compare as a string (§2.1);
   - `Connection: close` on the service's 413 (§2.7);
   - one fixed 404 body (§2.7);
   - the SQLite ticks converter, which is test-provider only and so not a schema matter.

   I also corrected §2.7: the 415 has a ProblemDetails body (measured), not "none".
2. **A 404 from PUT or from `…/remix` falls back to a plain `POST api/creations`, never another remix** (schema.md §11.2, plan Phase 5). Remix looks the source up as well, so "Save as new" after a delete would 404 forever. The lineage that's lost is lineage the API would hide anyway (`remixedFrom: null` for a deleted source).
3. **"Update original" is last-write-wins in v1, with a numeric trigger** (schema.md §11.4). Add `If-Match: "<updatedAt>"` → 412 at the first reported lost update, or at Phase 8, whichever comes first. It's a header, not an envelope field, so the strict §2.6 envelope stays as it is. The client adds no GET-then-compare check of its own.
4. **Routing precedes the gate** (schema.md §2.6): a code that fails the route constraint is the catch-all's 404 even with writes off, and DELETE's order is 429 → 403 → 404.

## Why

- Item 1: each departure was measured against real Postgres or a pooling client and is strictly closer to the contract's intent than the doc's wording was. Where the doc and the shipped code disagreed, the code was right.
- Item 2: without it, the §11.2 line "the client then offers Save as new" leads straight into a second 404.
- Item 3: the response already carries `updatedAt`, so adding a precondition later changes no response shape. A client-side check races and becomes dead code once the server precondition exists.

## Boundary

- Binds Luigi in Phase 5: the save fallback, string comparison of `updatedAt`, and no client stale-tab check.
- Binds Bowser when he adds a precondition: it's a header, and it's 412.
- Not decided here: the 429 body (still Bowser's call; clients key on the status).

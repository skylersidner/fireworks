# Phase 4: creations persistence, as built

> **Superseded in part by `bowser-phase7-server-hardening.md` on 2026-11-15:** `Services/ApiResponseHeaders.cs` is deleted and replaced by `Services/ResponseHeaders.cs` (one header middleware at step 6a, one writer per class). `Connection: close` now also covers chunked bodies (P7-S8). The caching question left open at the end of this record is decided there.

**Author:** Bowser · **Date:** 2026-11-13 · **Status:** proposed (for Skyler to promote, or not)
**Implements:** plan Phase 4; `docs/fireworks-app/schema.md` §2 (incl. §2.2.1, §2.4 cap, §2.6 order, §2.7), §6, §9, §10; Boo's `boo-phase4-security-requirements.md` S1–S29 (S13 as Skyler ruled: `isOwner ? source : null`, no `CanWrite` term).
**Code:** `src/api/Fireworks.Api/{Controllers/CreationsController.cs, Services/Creations/*, Services/RateLimiting/FireworksRateLimiting.cs, Services/{KestrelLimits,ApiResponseHeaders}.cs, Repositories/CreationRepository.cs, Data/Entities/Creation.cs, Data/Migrations/*_AddCreations.cs}`.

## What

1. **The service runs a write in one fixed order, and the body reaches it unread.** Controllers pass an `ICreationRequestBody` (`HttpCreationRequestBody`). The service then runs the `CanWrite` gate (403), `HasJsonContentType` (415), the capped read (413), the envelope walk, the owner-filtered lookup (404), and the document walk (400). There's no `[Consumes]` and no `[FromBody]`. Any new write endpoint takes the same shape. A source-guard test bans `[Consumes(`, `:regex(`, `[FromBody]`, `EnableBuffering`, `UseRequestDecompression` and `GlobalLimiter` in API code.
2. **`share_code` has `COLLATE "C"` on Postgres** (model-conditional `UseCollation`, in the migration). Measured: the compose database's default collation is `en_US.utf8`, where `'a' < 'B'`, so `ORDER BY share_code` (the §2.2.1 tiebreak) wasn't ordinal. SQLite's BINARY already is ordinal. A `[PostgresFact]` pins it.
3. **SQLite-only model shim: `DateTimeOffset` is stored as UTC ticks.** EF's SQLite provider can't `ORDER BY` a `DateTimeOffset`, and the list query must. Because this is model-level, the LINQ is identical on both providers. **Timestamps are truncated to whole microseconds** in `ApplyTimestamps`, so the `updatedAt` a write returns equals what the next read returns from Postgres.
4. **Every 413 the reader produces sends `Connection: close`.** Measured against the real Program: after a 413 the rest of the body is unread, Kestrel drops the connection, and the client's next request on the pooled connection failed with "response ended prematurely". Browsers pool connections too.
5. **One fixed 404 body for every creation miss** (`{ message: "No creation has that share code." }`). That covers an unknown code, a malformed code that reached the service, and someone else's creation (S9). A code that fails the route constraint gets the catch-all's own empty 404.
6. **Shared registration, called by Program.cs and every harness:**
   - `AddFireworksCreations` (repository, service, generator, the `sharecode` route constraint);
   - `AddFireworksRateLimiting(configuration)` (`RateLimits:Writes:PerMinute|PerDay`, `RateLimits:Reads:PerMinute`);
   - `KestrelLimits.Apply` (64 KiB global body limit);
   - `UseFireworksApiResponseHeaders` (`no-store`, `nosniff` on `/api`).

   A harness never re-lists these registrations by hand.
7. **PUT uses a tracked, owner-filtered load and then sets `State = Modified`**, not `ExecuteUpdate`. So "Update original" always bumps `updated_at`, even for an identical document, through the one `ITimestamped` hook. A concurrent DELETE (`DbUpdateConcurrencyException`) is re-checked against the desired state and becomes 404, not 500.
8. **`schema/` is in `.dockerignore`.** Nothing at runtime reads it (grep: the only hits in the API are the `schema_version` column name). `CreationLimits.cs` compiles the limits in and is checked against `limits.json` by a test.
9. **Developer messages echo at most 32 code points of user input**, with lone surrogates written as U+FFFD (S24). Names are never echoed.

## Why

Items 2, 3 and 4 are measured gaps that every SQLite test and every `curl` passed. Each showed up only against a real Postgres or with a pooling client. Item 1 is the only shape that satisfies Boo's order (gate before 415/413) while keeping the gate in the service (plan §3.4). Item 6 is `toad-oracle-and-real-host-shapes.md` ("test hosts bind exactly what real call sites bind") made structural.

## Boundary

- Binds anyone adding an API endpoint that takes a body (items 1, 4, 6), and anyone writing an `ORDER BY` on a text column (item 2: give the column a "C" collation or don't promise ordinal order).
- **For Luigi (Phase 5):** send compact `JSON.stringify` output, because the pretty-printed worst case is 290 KB, over the 256 KiB limit. A 413 arrives with `Connection: close`. A 400 always has `truncated`. Malformed codes 404 before any query, so the client's §9 regex check is a courtesy, not the gate.
- **For Yoshi:** schema.md §2.2.1 says the effective `page` is echoed. A `page` past `int` clamps to 2,147,483,647, so `page` stays an `int` in `CreationListPage`.
- **Open, deploy-time (Boo S5, S21):** the 413 through Railway's edge and the client-IP check are in README's Railway checklist and Test windows steps. Neither can run before a deploy.
- Not decided here: S25's issue order (the first 100 the walk emits), and Phase 7 caching beyond `no-store`.

## Addendum, 2026-11-13: fix round (Boo F1, F2, F4, F5; Yoshi D1-D3; Toad)

1. **Item 6 gains `AddFireworksControllers`** (`Services/ControllersRegistration.cs`), the only `AddControllers()` call in the API and the harness. It removes `FormValueProviderFactory`, `FormFileValueProviderFactory` and `JQueryFormValueProviderFactory` (Boo F1) and adds the API assembly as an application part once. The harness's own `AddControllers().AddApplicationPart(...)` is gone. An endpoint that ever needs form binding opts in alone, with its own gate test (Boo's boundary).
2. **Item 4 generalized: any `/api` response whose declared `Content-Length` is over the endpoint's current `MaxRequestBodySize` sends `Connection: close`** (`ApiResponseHeaders`, in `OnStarting`). Found while adding the form bodies to the gate test, which then failed 6 of 6 in isolation: a 403 to a 300 KB body left an undrainable body, and the next pooled request got "response ended prematurely". It passed in the full suite only by timing. It covers the 403, 415, 429 and catch-all 404 paths, none of which reads the body. A chunked body (no declared length) isn't covered; browsers send `Content-Length`. **Boo should look at this one:** it is a pipeline change his review didn't see.
3. **Item 7 replaced: PUT marks only `Name`, `SchemaVersion`, `Palette` and `Document` as modified** (Yoshi D1), never `State = Modified`. Writing every column put back a stale `remixed_from_id` after the database had nulled it (ON DELETE SET NULL), and the UPDATE failed the foreign key. Marking a property still makes the entry Modified, so `updated_at` still bumps on an identical document. Benign residue: the PUT's response can still name the just-deleted source in `remixedFrom` (loaded before the delete); the next GET shows null.
4. **`ICreationRepository.TryInsertAsync` returns `InsertOutcome { Inserted, ShareCodeTaken, RemixSourceGone }`** instead of `bool` (Yoshi D2). On a failed insert the repository asks, in order: does my row exist, is the remix source gone, is the code taken; else rethrow. The service maps `RemixSourceGone` to the fixed 404. Still no SQLSTATE matching.
5. **Logging:** `Microsoft.EntityFrameworkCore.Database.Command` is `Warning` in `appsettings.json` (Boo F4). README now states chunked framing counts toward the limit (F2) and **one replica only** until migrations take a lock (F5, `42P07`).

**Measured:** build 0 warnings; plain `dotnet test` 555 passed, 10 skipped; `FIREWORKS_TEST_POSTGRES` 565 passed. Mutants (scratch copy), each killed: providers restored (15 tests fail), whole-entry Modified (D1 test), no property marks (identical-update test), no source-gone check and service ignoring it (D2 test), no `Connection: close` (its header test), remix never storing `RemixedFromId` (gated round trip's new read-back, plus three others). Marking `Palette` alone is an equivalent mutant: change detection catches a changed palette, and an identical one needs only one mark.

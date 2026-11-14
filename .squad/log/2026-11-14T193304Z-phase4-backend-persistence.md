# Session log: Phase 4 backend persistence (2026-11-13 build, logged 2026-11-14)

- **Ran:** Bowser (Creations API, `jsonb` storage, validator, routing, rate limits, size gates, ownership, fix round), Boo (S1–S29 security requirements, then verification: 26 PASS, S5 and S21 deferred to deploy; found the form-value-provider bypass, fixed), Toad (harness, ownership and blind-spot tests, FK race repros), Yoshi (S1–S29 folded into `schema.md`; architecture review), Mario (phase-gate: PASS WITH NOTES).
- **Commit:** `facf980` "Phase 4: backend persistence for creations", committed by the coordinator with Skyler's approval. Push pending Skyler's credentials. This batch's logs are not committed (no commit authorized for Scribe); they go into the next commit with the other `.squad/` changes.
- **Gate:** Mario PASS WITH NOTES. Build 0/0. Plain `dotnet test` 555 passed, 10 skipped. Gated (Postgres) 565 of 565. `generate-fixtures.mjs --check` clean (175). `npm test` 953 of 953. Docker image on a fresh database: both migrations applied, full round trip, two identities, writes-off 403 on every write and `api/me/creations`, 413 with `Connection: close`.
- **Defects fixed in the phase:** case-insensitive share-code route regex (custom `sharecode` constraint); `[Consumes]` returning 404 (replaced by `HasJsonContentType()`); form value providers bypassing the write gate (`AddFireworksControllers`); D1 and D2 FK races (PUT marks four properties; `TryInsertAsync` returns `InsertOutcome`); 413 connection reuse (`Connection: close`, generalized to any `/api` response over the limit); `"C"` collation for `share_code`; SQLite `DateTimeOffset` ordering (test-provider shim, microsecond truncation); a flaky 30 s test timeout.
- **Carried forward:**
  - Boo: chunked `Connection: close` hardening (Phase 7).
  - Boo S5 and S21, and the Railway migration check, at the first deploy.
  - One replica only until migrations take a lock (`42P07` race; Bowser F5).
  - Update original is last-write-wins; `If-Match` → 412 at the first reported lost update or Phase 8.
  - Client contract types (Phase 5); Rosalina copy for F10, F4, F12, and 413 and status 0.
  - `schema.md` §11.2 404 fallback (plain POST, never remix); the client compares `jsonb` values parsed, not as strings (key order is not kept).
  - 413 body is `application/problem+json`.
- **Records present in `.squad/decisions/records/`:** `boo-phase4-security-requirements.md`, `boo-phase4-security-verification.md`, `bowser-phase4-creations-persistence.md`, `toad-phase4-order-promises-are-asserted-on-the-sql.md`, `yoshi-phase4-architecture-review.md`. Skills: `aspnet-request-gates`, `aspnet-write-endpoint-traps`. Verified on disk.
- **Index check (`.squad/decisions/README.md`):**
  - None of the five Phase 4 records is listed in the index. Promotion is Skyler's call, and the index was not edited.
  - No new record contradicts a §5 entry. The `remixedFrom` row already states the S13 ruling (`isOwner` alone, interim exposure accepted). Share-code GET stays public and `My creations` follows the write switch, both as the index says.
  - Boundary note for promotion, not a contradiction: §3 says query logic stays provider-agnostic. Bowser's model-level provider configuration (`UseCollation` on Postgres, the SQLite `DateTimeOffset` converter) sits in `FireworksDbContext`, not in the LINQ. The LINQ is identical on both providers.
  - Candidate rules for Skyler to promote, if wanted: a write gate runs before any body read and any 415 or 413 check (`aspnet-write-endpoint-traps`); `[Consumes]` and MVC form binding are off on the API (`aspnet-request-gates`); `ORDER BY` on an indexed text key is asserted on the SQL (Toad's record).
- **Supersession, marked in place (partial, nothing wholly superseded):**
  1. `boo-phase4-security-requirements.md`, S13: the `&& CanWrite` term is overruled by Skyler's ruling (`yoshi-phase3-creation-schema.md`, addendum 3, point 1). Top-of-file marker and an inline marker on S13 added. S1–S12 and S14–S29 stand.
  2. `bowser-phase4-creations-persistence.md`: items 4 and 7 are amended in place by its own addendum (no external marker needed).
- **Flags (not for Scribe to fix):**
  - `docs/fireworks-app/schema.md` §2.7 says only the 413 sends `Connection: close`. The shipped rule (Bowser fix round, Boo F2) sends it on any `/api` response whose declared `Content-Length` is over the limit (403, 415, 429, catch-all 404 too). Yoshi to update the doc.
  - Boo's verification count: manifest 26 PASS plus S5 and S21 deferred accounts for 28 of 29. The record doesn't name the 29th (likely S13, overruled). Boo to confirm.
  - Commit trailer on `facf980` reads `Claude Opus 5.5`; current attribution guidance is `Claude Haiku 5.5`. Not amended here (rewriting history is Skyler's call).
- **Cross-agent updates (appended under `## Learnings`, dated 2026-11-13):** Bowser (chunked close is Phase 7; `schema.md` §2.7 stale; If-Match trigger; deploy checks; Luigi's Phase 5 facts), Yoshi (§2.7 stale; form bodies not in §2.6; Phase 5 consumer checks), Peach (Phase 5 acceptance: last-write-wins, Save-as-new after a deleted original, interim `remixedFrom` exposure, writes-off, 413 status 0), Luigi (compact JSON, read `truncated`, opaque `updatedAt`, 404 fallback is POST, parsed-value compare, client contract gap), Rosalina (F10 copy from server facts, Save-as-new copy, last-write-wins copy later), Boo (S13 ruling, Phase 7 chunked hardening, deploy checks), Toad (S13 test matches the ruling; Phase 5 404-fallback test; Phase 7 chunked test).
- **History summarization (12 KB = 12,288 bytes; target under 12,000 after append):**
  - Bowser: 15,944 B before; oldest Phase 0–1 learnings, the .NET 11 retarget and Phase 3 probes folded into `## Core Context`; now 11,887 B.
  - Yoshi: 15,083 B before; Phase 0–2a and Phase 3 learnings folded into `## Core Context`; now 10,904 B.
  - Peach: 12,159 B before (under 12,288, over 12,000; flagged last batch). Phase 0 triage and Phase 2 planning folded into `## Core Context` (11,380 B). Then a Phase 5 acceptance entry, written 2026-11-14 by Peach's own run and not part of this batch, took it to 12,419 B. Phase 2 acceptance learnings folded too; now 7,777 B.
  - Boo: 10,764 B after this batch's append. A Phase 5 security-review entry (2026-11-14, Boo's own run, not this batch) took it to 12,314 B. Phase 0 to 2 learnings folded into `## Core Context`; now 10,863 B.
  - Others under 12,000 after append: Luigi 11,848; Toad 11,339; Rosalina 10,225. Mario 9,135 unchanged. Scribe 3,051 plus a Phase 4 learning.
- **Attribution:** none added. No commit made by Scribe.

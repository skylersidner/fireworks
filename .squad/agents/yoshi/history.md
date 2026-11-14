# Yoshi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase 4 is reviewed and shipped (`docs/fireworks-app/schema.md` is the contract). Next: Phase 5 (client Save and link flows, against §11), Phase 6 (`TimelineDriver`), and auth architecture (Phase 8, the identity seam in plan §3.4).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 to 2a (summarized 2026-11-13)

- **Phase 0 rulings:** run the Signal Forms spike with Luigi before 2c (OQ17, now Signal Forms on Angular 22.2.x). Phase 3 must state show-vs-shell sky precedence (one sim, one gravity) and `burstHeight` as a fraction of ground height (760), not of the 800 sky. Phase 4 may need a dev-only second user; that was later declined (see the Phase 3 final pass).
- **Phase 1 parity:** the skeleton mirrors the reference. Diff against the reference with name substitution (`sed 's/MonsterOfTheWeek/X/'`) to find real deviations fast. The Phase 8 seam touches the identity module (`IdentityRegistration`'s DefaultUserId guard, initializer seeding, auth middleware, AllowAnonymous on health, fallback and share GET), not services, controllers or schema. `ServiceErrorType` has no Forbidden (Phase 4 added one); `[Authorize(Policy)]` without an auth scheme throws on Forbid. Record: `decisions/records/yoshi-phase1-parity-review.md`.
- **Phase 1 follow-ups:** "My creations follows the write switch" before Phase 8: 403, not an empty 200 (the client never calls when `canWrite` is false). Record: `yoshi-phase1-plan-followups.md`. `IdentityOptions` became `DefaultUserOptions` (Bowser's fix round). The pinned `Pkcs` 10.0.13 is gone since the .NET 11 retarget (`bowser-net11-retarget.md`), so it's off the accepted-deviation list.
- **Phase 2a engine boundaries** (record `yoshi-phase2a-engine-boundaries.md`): the boundary spec checks direct specifiers only, so it needs a layer-edge rule, a transitive reach rule and a fail-closed parser (skill `import-boundary-spec`). The canary `canary-scene.ts` imports pixi outside `engine/render`; the spec has no allow-list. No module-level `let`/`var` in the engine; PRESETS are deep-frozen. `sky` absent stays absent. `normalize` gains `adjustments` and structured `errors`; the Phase 3 strict validator is normalize with zero adjustments. TimelineDriver needs a per-step hook (`beforeStep`) with an integer step counter, plus `fireSeeded`. Worst-case shell lifetime at the limits is about 21 s. `ng test` needs Node 26 (`~/.nvm/versions/node/v26.5.0/bin`).
- **Phase 2 cross-agent (folded):** Luigi's `ShellIssue` carries `code` and the TS validator is the mirror, so `code` is part of the §6.3 contract.

### Folded from Phase 3 (summarized 2026-11-14)

- **The creation schema (record `yoshi-phase3-creation-schema.md`, plus two addenda):** `normalizeShell` returns only `errors` when any exist, so strict mode needs both; codes map 1:1 from adjustment kinds (`defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, `cleaned`→`name-format`). Names: remove Cc and unpaired surrogates, trim the explicit JS-trim set (C# `Trim()` misses U+FEFF), blank → Custom, cut at 80 code points, one issue per name. Postgres `varchar(n)` counts characters, so `name varchar(80)` matches. Show v1: required `sky` (wins); embedded shells keep `version` and lose `sky`; `shells` map 0..32 keyed `^[A-Za-z][A-Za-z0-9_-]{0,11}$`; cues 0..1000; `burstHeight` optional, never null; `fireStep = Math.round(t*120)`, order `(fireStep, id)`. Measured: typical 1000-cue show 72 KB, worst 215 KB, so the request limit is 256 KiB, not the plan's 64 KiB.
- **Storage facts:** remix takes `{ document }`; palette, name and `schema_version` are computed at write, so the server never re-reads documents and has no upgraders. `jsonb` drops key order, so never give key order meaning; tests compare parsed JSON.
- **Rulings (Skyler, Q1–Q5 and L1–L4):** cue `t` is the launch time. Share links are not locked; goldens are regression guards, changed by reviewed change; version bumps are for document-shape changes only (a change in a stored value's meaning that needs rewriting still bumps, because upgraders key on version; changed lenient defaults and loosened ranges don't). No empty shows (`cues: []` → `cue-count`; `shells` keeps min 0). Blank name → "Custom". Links always open a dirty working copy; an owned source gets "Update original" (PUT) or "Save as new"; a link over dirty asks only when shell or sky is dirty; a show runs until its last particle fades, and `duration` is the launch window only.
- **Calls made:** "Save as new" uses `POST …/remix` (lineage, and it keeps Done-when step 3 observable while `isOwner` is always true). `/c/:code` is load-then-redirect with `replaceUrl`. Draft `source` is set only by a link load or a save. No dev-only second user; a stubbed `isOwner: false` call-ledger spec instead.
- **Validator feasibility (Bowser's probes):** `TryGetDouble` is true with +Infinity for `1e400` (need `IsFinite`); `AllowDuplicateProperties=false` has no path (the walker detects duplicates, last wins); `GetString`, `JsonProperty.Name` and `ValueEquals` throw on lone surrogates (`Utf8.IsValid` gate). Settled: envelope issues stop the document walk; `shells` absent → `missing`, `cues` absent → `cue-count`; the key set is the keys that pass key-format; one `duplicate-key` per name; bracket paths with U+FFFD for lone surrogates (this overruled Bowser's raw-escape path). Lesson: an API claim in a spec is a hypothesis until a probe runs.
- **Paging convention:** the reference's `SearchController.Get` with `PagedSearchResultResponse`, offset, 1-based. Clamps silently and echoes the effective values. `GET api/me/creations` takes `pageSize` 24 (max 100), a `kind` filter, order `updatedAt` desc then `shareCode`.
- **Superseded in part:** `yoshi-phase2a-engine-boundaries.md` point 8 (firing formula, see Phase 3 record point 5); Phase 3 addendum 1 point 7 (superseded by the L4 ruling, addendum 2 point 6).

### Folded from Phase 4 (summarized 2026-11-14)

- **schema.md, Phase 4 folds:** Boo's S1–S29 are folded in place: §2.1 (S13 overruled, `isOwner` only), §2.2.1 query rules, §2.4 cap, §2.5, §2.6 gate order (429, 403, 415, 413, 400 envelope, 404 lookup, 400 document), §2.7 status and rate-limit tables, §6.5 and §9. Plan §3.3, §3.4 and Phase 4 were edited to match. S25: the 400 body is exactly `{ message, errors, truncated }`, at most 100 issues. The cap sits in the 400-body builder, so validators stay complete.
- **Architecture review** (`yoshi-phase4-architecture-review.md`): accepted Bowser's departures. §2.1 has microsecond timestamps (compare `updatedAt` as a string). §2.6 puts routing before the gate. §2.7 has the 415 and 413 bodies. §9 uses `"C"` collation. §11.4 is last-write-wins. The §11.2 fallback was changed in Phase 5 (see that record's marker).
- **Query binding:** `[FromQuery] string?` turns `kind=` into null and takes the first of repeated values, so the list query reads `Request.Query` (trap 7 in `aspnet-request-gates`).
- **Lesson:** trace every fallback through the endpoint it calls, and every new writer of a contract state through every path that reaches the same state.

## Learnings

### 2026-11-14 — Phase 5 review points folded into schema.md
- Draft `source` gains `name` (Rosalina Y1). A 404 from PUT or remix sets `source` to `null` (Y2): that's a third writer, and I extended it to the remix-404 path as well. Rosalina's §6 asymmetry is in §11.2: the PUT 404 asks, the remix 404 falls back to a plain POST by itself.
- §9: share-code reuse is "improbable, not prevented". Delete is a hard delete (`CreationRepository.DeleteOwnedAsync`). No tombstone table; the trigger is 10⁷ total deletes, or any change that shortens codes. Per-creation odds are `D / 58⁸`.
- §2.7: `Connection: close` comes from `ApiResponseHeaders` (`OnStarting`, declared `Content-Length` > current `MaxRequestBodySize`, any status) plus `HttpCreationRequestBody`'s 413. A 429 on a write route sees the 64 KiB global, because the limiter runs before `[RequestSizeLimit]` (reasoned, not measured).
- Skyler's 2026-11-14 rulings went into §10, §11.1, §11.3, §11.5 and a §14 table. Rosalina's `phase-5.md` §8.1 still contradicts two of them; flagged, not edited.
- Lesson: when a design note adds a state transition to a contract I own (here, a new writer of `source`), trace it through every path that reaches the same state, not only the one the note names.

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **Your Phase 4 record's item 2 is partly superseded:** a PUT 404 now asks, and Save as new is a plain POST. A remix 404 still falls back by itself. Marked in the record; your §11.2 addendum already reflects it.
- **§2.7 flag closed:** Phase 4 said only the 413 sends `Connection: close`. The Phase 5 addendum now says any `/api` response over the limit does. Check the wording.
- **Index row:** README §5's "Save as new (remix)" is incomplete after a PUT 404 (§11.2). Not a contradiction; add the fallback when Skyler promotes.
- **Phase 7:** the dotted-link bare 404 may need a line in §2.7 or §11, depending on Bowser's decision. **Call for you or Boo:** Toad's C2 "name"-only heuristic.

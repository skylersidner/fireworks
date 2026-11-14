# Phase 3 creation schema: validation contract, show shape, envelope

**Author:** Yoshi · **Date:** 2026-11-13 · **Status:** proposed (for Skyler to promote, or not). Skyler's rulings on Q1–Q5 (2026-11-13) are folded in.
**Document:** `docs/fireworks-app/schema.md`. **Reviewed code:** `engine/model/{shell,limits,normalize,enums,colors,presets}.ts`, `engine/loop/{engine-loop,timeline-driver,playback-driver}.ts`, `engine/sim/{constants,rng,simulation}.ts`, `app/features/designer/shared/{designer-draft,designer-copy}.ts`, `shell-designer.store.ts`, `Services/ServiceResults.cs`, `Identity/ICurrentUser.cs`, `Data/Entities/User.cs`; reference `CustomMovesController.cs` `ToErrorResult`.

## What

1. **Strict = lenient walk with zero adjustments, and the walker must return errors and adjustments together.** Every adjustment kind maps to one strict code: `defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, new `cleaned`→`name-format`. Both validators must produce the same complete `(path, code)` multiset per fixture; the walk's skip rules (schema.md §6.2) are part of the contract.
2. **Names are cleaned, then trimmed, then counted.** Remove Cc and unpaired surrogates, trim an explicit list equal to JS `String.prototype.trim`, blank → `Custom`, cut at 80 code points. One issue per name: `type` > `missing` > `too-long` > `name-format`.
3. **The server walks a `JsonElement` and never adjusts.** No DTO deserialization with `UnmappedMemberHandling = Disallow`; integers by value (`1.0` is valid); duplicate keys rejected server-side only (`duplicate-key`).
4. **Show v1:** required `sky` that wins over everything; embedded shells are ShellDocuments without `sky` (an embedded `sky` is `unknown-property`); `shells` is a map of 0..32 keyed `^[A-Za-z][A-Za-z0-9_-]{0,11}$`; 1..1000 cues (an empty show can't be saved, Skyler Q4); `duration` 1..600. Cue `t` is the launch time (Skyler Q1). Cue `burstHeight` is optional (absent = the shell's), never `null`. Cue `id`, `t`, `shell`, `x` and `seed` have no defaults in either mode, and seeds are never rounded or clamped.
5. **Firing rule (behavior, not shape):** `fireStep = Math.round(t * 120)`; order by `(fireStep, id)`, never array order. This supersedes the `Math.round(cue.t / STEP)` wording in `yoshi-phase2a-engine-boundaries.md` point 8. Share links are not locked (Skyler Q2): changing this rule, or the sim, is a reviewed change that updates the goldens, with no version bump. Version bumps are for document-shape changes only.
6. **No meaning in key order, anywhere**, because `jsonb` doesn't keep it.
7. **Envelope:** `remixedFrom` is always present (string or null) and is visible only to the remix's owner; everyone else gets `null` (Skyler Q3). The remix endpoint takes `{ document }`, the edited working copy. `name`, `schema_version` and `palette` are computed at write time and stored, so the server never re-reads a stored document and needs no upgraders. 400 body is `{ message, errors: [{ path, code, message }] }`.
8. **Recommended request limit for creation writes is 256 KiB, not 64 KiB, pending Boo's Phase 4 security review.** Measured: a typical 1000-cue show is 72 KB; the worst case at every limit is 215 KB.
9. **Limits drift guard:** `limits.ts` is the source; `schema/limits.json` is a mirror that the TS spec (against `limits.ts` and the schema.md table) and the C# test (against `CreationLimits.cs`) both check; boundary fixtures check behavior. Cross-checked, not generated.
10. **Share codes:** 8 Base58 characters (`^[1-9A-HJ-NP-Za-km-z]{8}$`), case-sensitive, route constraint anchored, a non-matching code is a 404 with no query.

## Why

- 1: the shipped `normalizeShell` returns only `errors` when any exist, so a strict validator built on it would lose the adjustments in a document with both kinds of problem (fixture `mixed.json`). Multiset equality is the standing ledger rule (`toad-exact-call-ledger-over-positive-assertions.md`), and it only works if both sides stop walking at the same places.
- 2: Postgres `jsonb` rejects `\u0000` (an unvalidated name would 500 on insert). C# `string.Trim()` misses U+FEFF and adds U+0085, so "trim" without an explicit set means two different rules.
- 3: `Disallow` stops at the first unknown member and reports STJ's paths; `int Stars` rejects `120.0`. `JSON.parse` can't see duplicate keys, so only the server can check them.
- 4: `FireworksSim.sky` is sim-wide (`simulation.ts` l.63, l.89, l.135): one show, one sky. Making show `sky` required means precedence never depends on whether a key exists. No defaults for cue fields because shows have no legacy input, and a defaulted seed would silently change a burst.
- 5: `1/120` is inexact, so `t / STEP` can round differently from `t * 120` at half-steps. Ordering by `id` makes "reordering cues never changes how the others play" (plan §3.3) true even under the particle cap.
- 7: plan Phase 5 (Skyler): "If `isOwner` is false, saving becomes a remix", so the remix holds the visitor's edits and needs a body. Stored derived columns keep the "client upgrades, server stores" policy from forcing the server to understand old versions.
- 8: the plan's 64 KiB fits shells (≤ 1.5 KB worst case) but not the 1000-cue cap the same plan sets.

## Boundary

- Binds Phase 3 (Luigi: walker, `validate.ts`, `upgrade.ts`; Toad: fixtures, `limits.json`) and Phase 4 (Bowser: C# walker, request limit, 400 body, remix body, palette column). Boo reviews points 3, 7 and 8 in the Phase 4 security review.
- Q1–Q5 were ruled by Skyler on 2026-11-13 (schema.md §14): launch time; links not locked; owner-only `remixedFrom`; no empty shows, caps accepted; blank name saves as "Custom".
- Plan §3.3 and Phases 3–6 were edited in place on 2026-11-13 to match schema.md.

## Addendum (2026-11-13): validator feasibility and edge settlements

Inputs: `bowser-phase3-validator-feasibility.md` (C# probes on .NET 11), `luigi-phase3-ts-validator.md` (TS walker choices, checked against `engine/model/normalize.ts`), `toad-phase3-shared-fixtures.md` and Toad's questions. All folded into `docs/fireworks-app/schema.md` in place; plan Phase 4 edited to match.

### What
1. **Corrections to schema.md §6.5 (measured false on .NET 11):** `TryGetDouble` returns true with `+Infinity` for `1e400`, so `double.IsFinite` is required. `AllowDuplicateProperties = false` throws without a path, so the walker detects duplicates through `EnumerateObject()` and walks the last value. `GetString`, `JsonProperty.Name` and `ValueEquals` can throw on lone surrogates, so: `Utf8.IsValid` gate (invalid is `not-json`), wrapped `ValueEquals`, raw-token fallback for names and property names. New traps: no `[FromBody] JsonElement` (manual body read with `[Consumes("application/json")]`); C# regexes anchored `\z`.
2. **Envelope walk (§2.6):** 415 for a non-JSON content type; `("", not-json)` for empty, invalid-UTF-8 or unparseable bodies; `("", not-object)` for a non-object body; `kind` absent/null is `missing`, otherwise not `shell`/`show` is `enum`; `document` absent/null is `missing`, non-object is `not-object`; other envelope keys are `unknown-property`; envelope duplicates are `duplicate-key`. **The document is walked only when the envelope has zero issues** (stricter than Bowser's "kind valid and document an object": an unknown or duplicated envelope key also stops it), so envelope and document paths never mix.
3. **Collections:** `shells` absent/null is `(shells, missing)`; `cues` absent/null is `(cues, cue-count)`, the same as `[]`. One `key-format` per bad shell key. Confirms Bowser and Luigi.
4. **Cross-references:** the cue key set is the keys that passed `key-format`, whatever their embedded value; a cue naming a rejected key is `unknown-shell`. Cue `id`/`shell` of the wrong type is `type` only. An id that failed type or key-format never takes part in `duplicate-id`.
5. **Duplicate keys:** one `duplicate-key` per repeated name per object, at that name's path, checked only on objects the walk reads (not inside unknown values or skipped arrays). Last value wins for the rest of the walk.
6. **Paths for arbitrary names (§6.2 rule 11):** plain if `^[A-Za-z_][A-Za-z0-9_-]*$`, else `parent["name"]` with only `\` and `"` escaped and unpaired surrogates as U+FFFD. Overrules Bowser's "raw escaped name as the path", which wouldn't match the TS side (`JSON.parse` yields the surrogate itself, not the escape text) and isn't well-formed Unicode.
7. **Confirmed from Luigi:** show `sky` fields have no defaults; lenient clamps `duration` and cue `t`/`x`/`burstHeight`; `seed` is never adjusted. A lenient show can end up with `t` past a clamped `duration`; the Phase 6 driver doesn't fire such a cue. **Superseded in part by addendum 2, point 6, on 2026-11-13:** playback doesn't stop at `duration`, so a lenient cue past a clamped `duration` fires at its `t`; strict validation still flags it. The rest of this point stands.
8. **Confirmed:** embedded `version: 2` is `(shells.<key>.version, version)` and the walk continues; an embedded `sky` is `unknown-property` only and its value isn't walked; `sky: null` is strict `missing` (one null rule; stored documents never hold `null`).
9. **Harness:** posts each document's raw text; translates `root-array`/`root-string` to `(document, not-object)`; no other translation.

### Why
Each edge needs one `(path, code)` answer on both sides or the multisets differ. Not mixing envelope and document issues avoids `kind`/`foo` path collisions. A hand-specified path escape is the only form both languages produce identically and both fixture readers can load.

### Boundary
Binds Luigi (rule 11 paths in `dropUnknown`, §12.5 lenient specs), Toad (fixtures marked "(new)" in schema.md §12), Bowser (Phase 4 C# walker and harness). Not decided here, for Boo's Phase 4 security review: the 256 KiB limit, the manual body read, and Kestrel's global `MaxRequestBodySize`.

## Addendum (2026-11-13): link model, Save, show length, list paging

Inputs: Peach's `docs/fireworks-app/acceptance/phase-3.md` (F1–F16, Q1–Q3), Mario's gate notes, Skyler's rulings L1–L4 (schema.md §14). Edited in place: schema.md header, §2.2, §2.2.1 (new), §2.3, §4, §4.5 (new), §6.2 rule 9, §6.6, §7, §8.3, §10, §11 (rewritten), §13, §14, §15; plan §3.3, Phases 4, 5 and 6.

### What
1. **One link model (L1, Peach F8).** `/s/:code` plays; `/c/:code` is the only editing link for both kinds and always loads a dirty working copy; the player's Remix and My creations' Open navigate to `/c/:code`; `/shows/:code/edit` is gone. `/c/:code` loads, then redirects to the editor with `replaceUrl`, so the draft (not the URL) carries the copy across reloads.
2. **The draft's `source`** is `{ shareCode, kind, isOwner, updatedAt } | null`, set by a link load or a successful save and by nothing else. `isOwner` there is a display hint; the server's PUT 404 decides.
3. **Save (L2).** Fresh work → `POST api/creations`. Owned source → "Update original" (PUT) or "Save as new". Unowned source → remix. **My call: "Save as new" uses `POST …/remix`,** not a plain POST, so lineage is recorded (visible only to the owner, who owns both) and Phase 5's "Remix it" is observable before Phase 8.
4. **A link load sets `shellDirty` and `skyDirty`** (L1 "dirty form"). Link-over-dirty asks first (L3). Whether Save clears the flags stays open (F4, Rosalina and Luigi).
5. **No dev-only second user before Phase 8.** The non-owner path is covered by Phase 4's two-user service tests plus a Phase 5 stubbed `isOwner: false` call-ledger spec. Trigger: the first non-owner bug that reaches the running app past those specs.
6. **Show length (L4).** `duration` never gates firing; playback ends at the first step where every cue has fired and no particle is live. This supersedes addendum 1's point 7 ("the Phase 6 driver doesn't fire such a cue"): a lenient cue past a clamped `duration` fires at its `t`, and strict validation flags it.
7. **Paging (F1).** Offset, mirroring the reference's `SearchController.Get` and `PagedSearchResultResponse`: `page` (1-based), `pageSize` (default 24, clamped to 1..100), optional `kind` filter (a bad value is 400 `(kind, enum)`), ordered by `updatedAt` desc then `shareCode`, body `CreationListPage { items, page, pageSize, totalCount }` echoing the effective values. Index `(owner_user_id, updated_at desc, share_code)`. Switch to a keyset cursor when one owner passes 1,000 creations, p95 passes 150 ms on Railway, or a skipped or repeated row is reported.
8. **Stale text fixed:** the status header, the §15 done items, §6.6 bullets 2–3, and §8.3 (draft restore and Apply skip upgrade today; Luigi wires `upgradeShell` into both in Phase 5).

### Why
One editing link keeps two link models from diverging in Phase 6. Redirecting off `/c/:code` keeps a reload from offering to throw away edits. Remix for "Save as new" costs nothing and makes the Done-when honest under the default user. Offset paging is the reference's convention and fits per-owner lists; a page envelope leaves room for a cursor without a shape change.

### Boundary
Binds Luigi (Phase 5 link, draft `source`, Save table, upgrade wiring; Phase 6 builder through `/c/:code`), Bowser (Phase 4 paging contract and index, `.dockerignore` call on `schema/`), Rosalina (how the Save choice is presented, F4, F10, F12), and Toad (the non-owner call-ledger spec, `cue-at-duration` burst seen). Not decided here: the Show Builder's exact route (Mario and Rosalina, Phase 6), and whether Save clears the dirty flags (F4).

## Addendum (2026-11-13): Phase 4 security requirements folded in

Inputs: `boo-phase4-security-requirements.md` (S1–S29), Skyler's ruling on S13, Bowser's in-progress `CreationsController.cs`/`CreationService.cs` (read only, to match the request order he already built), and a scratch .NET 11 probe of query binding (not kept). Edited in place: schema.md header, §2.1, §2.2.1, §2.4, §2.5 (rewritten), §2.6, §2.7 (new), §6.3 `not-json`, §6.5, §9, §10, §14, §15; plan §3.3, §3.4 and Phase 4; README §5 `remixedFrom` row (coordinator-instructed, Skyler's ruling).

### What
1. **S13 overruled by Skyler: `remixedFrom` stays `isOwner`-only, no `CanWrite` term.** Before Phase 8 every visitor is the owner and sees the source code; accepted interim exposure. Closes in Phase 8 with no code change. Boo's S13 test changes: an owner with `CanWrite` false gets the source code, a non-owner gets `null`.
2. **S6: 415 from `Request.HasJsonContentType()` in the reader, no `[Consumes]`.** Missing type is 415 too.
3. **S14: `ShareCodeRouteConstraint : IRouteConstraint`** (`{shareCode:sharecode}`), ordinal per-character alphabet check; no `regex(...)` route constraint. Service re-checks.
4. **Limits (S1–S5, S17–S20, S23):** 256 KiB per write, 64 KiB global Kestrel limit, body read only in the action, no decompression; 429 limits by IP (IPv6 /64): writes 20/min + 300/day, reads 120/min; depth over 64 is `("", not-json)`. Request order: 429, 403 gate, 415, 413, `not-json`/envelope 400, lookup 404 (PUT, remix), document 400.
5. **S26, list query, my contract call:** read `page`, `pageSize`, `kind` from `Request.Query`, not model binding. Measured on .NET 11: `string? kind` binds `kind=` and `kind=%20` as `null` (would silently drop the filter, so Boo's `kind=` → 400 test fails with binding), `kind=shell&kind=show` binds as `shell`, and `long? page` turns `abc` or `99999999999999999999` into a ModelState ProblemDetails. Rule: integer literals of any size clamp (`page` 1..int.MaxValue, `pageSize` 1..100), offset in `long`, no `OFFSET` query past the end; non-integer `page`/`pageSize` is 400 `type`; `kind` must be exactly one ordinal `shell`/`show`, else `(kind, enum)`; all in the §2.4 body.
6. **S25 adopted: 400 `errors` capped at 100, with `truncated` always present** (`false` normally). Applied where the 400 body is built, after a full walk; the validators always return the complete multiset, so validator parity and every fixture are unchanged. Which 100 is unspecified (in practice walk order).

### Why
S6 and S14 are measured gaps between what an attribute appears to do and what it does with this app's catch-all and case folding. Query binding has the same class of gap (point 5), found by the same kind of probe. `truncated` is always present for the same reason `remixedFrom` is: a field the client branches on shouldn't have an "absent" state. The cap belongs at the HTTP edge so the parity contract between validators stays "complete multiset".

### Boundary
Binds Bowser (points 2–6 in Phase 4 code), Toad (the S13 test inverted per point 1; a code-built harness test for the cap, not a fixture; any exact-key-set check of the 400 body includes `truncated`; S26 tests read through point 5), Luigi (Phase 5: compact JSON on save, read `truncated`), Rosalina (F10 copy for `truncated` and a possible status-0 413). Not decided here: S16 `no-store`, S24 echo truncation, S27 logging and S28 runbook (Bowser and Boo; no schema change).

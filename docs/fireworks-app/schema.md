# Creation schema (v1)

**Owner:** Yoshi · **Phase:** 3 · **Status:** accepted 2026-11-13 (Peach: accept with notes, `acceptance/phase-3.md`; Mario's gate passed with notes). Skyler's rulings (2026-11-13) are folded in (§14): Q1–Q5, then the link, Save and show-length rulings L1–L4 that answer Peach's Q1–Q3. Bowser's C# probes, Luigi's TS validator choices and Toad's fixture questions are settled in place (2026-11-13: §2.5, §2.6, §6.2 rules 7–13, §6.3, §6.5, §9, §12).
**Written against the shipped code at b3039e6**, not only the plan: `src/web/fireworks-web/src/engine/model/{shell,limits,normalize,enums,colors,presets}.ts`, `engine/loop/{engine-loop,timeline-driver,playback-driver}.ts`, `engine/sim/{constants,rng}.ts`, the designer draft and store, and `src/api/Fireworks.Api/Services/{ServiceResults.cs,Identity/ICurrentUser.cs}`.
**Decision record:** `.squad/decisions/records/yoshi-phase3-creation-schema.md`.

This document is the contract between the TypeScript engine model, the C# API and the stored data. Where it and the code disagree after Phase 3 ships, one of them has a bug; the shared fixtures in `schema/fixtures/` decide which.

---

## 1. Conventions that apply everywhere

| Rule | Detail |
|---|---|
| **Encoding** | UTF-8 JSON. Property names are exact and case-sensitive (`Stars` is an unknown property, not `stars`). |
| **The one null rule** | `null` means the same as an absent key (Yoshi L4, shipped in `normalize.ts` `isAbsent`). A stored document never contains `null`: an optional field is omitted, never null. |
| **Numbers** | IEEE-754 doubles. `1`, `1.0` and `1e0` are the same value; an integer field accepts any of them. Non-finite values (`1e400` parses to `Infinity`) are a `type` error. Stored values are **not** snapped to slider steps (2a record, Boundary). |
| **Key order means nothing** | Postgres `jsonb` doesn't keep key order (it sorts keys by length, then bytes). No meaning may ever be carried by the order of keys in an object, including the `shells` map of a show. Tests compare parsed JSON, never bytes: SQLite `TEXT` keeps the C# order while Postgres doesn't. |
| **Array order** | Is kept by `jsonb` and is meaningful for `breaks` (break 0 bursts first). For `cues` it carries no playback meaning (§4.4). |
| **Colors** | Stored by name (`"blue"`, `"rainbow"`, `"none"`), never hex. Hex values live only in `colors.ts`. |
| **Paths** | The shipped form: `version`, `name`, `sky.wind`, `breaks[1].color1`; in a show `cues[3].seed`, `shells.s1.breaks[0].stars`. The document root is the empty path `""`. A property name that isn't a plain identifier is written in brackets (`["a.b"]`, `[""]`, `breaks[0]["st�ars"]`); the exact rule is §6.2 rule 11. Both validators emit identical paths. |
| **Enum values** | Lowercase schema values (`peony`, `none`, `rainbow`). UI labels are display copy and never stored (designer-2c.md D5). |

---

## 2. The envelope (API contracts)

A creation is stored as one row and returned in an envelope. The document inside it has no `kind` field; `kind` lives on the envelope and picks the validator.

### 2.1 `CreationResponse` (every endpoint that returns one creation)

| Field | Type | Notes |
|---|---|---|
| `shareCode` | string | §9 format. |
| `kind` | `"shell"` \| `"show"` | Fixed at creation; an update cannot change it. |
| `name` | string | Copied from `document.name` at write time. Never a separate request field. |
| `schemaVersion` | integer | Copied from `document.version` at write time. |
| `document` | object | The stored canonical document, at `schemaVersion`. The client upgrades it (§8). |
| `isOwner` | boolean | `ICurrentUser.UserId != null && UserId == owner_user_id`. Not gated by `CanWrite`; the client combines them (§10). |
| `remixedFrom` | string \| null | Share code of the creation this was remixed from. **Visible only to the remix's owner** (Skyler, Q3): it is the share code when `isOwner` is true and the remix has a live source, and `null` for everyone else, when not a remix, or when the original is deleted. Otherwise a remix's share link would reveal the original's unlisted code to everyone it is shared with. Always present (never omitted), so relaxing the rule later changes no shape. |
| `createdAt`, `updatedAt` | string | ISO 8601 with offset (`DateTimeOffset`, as `ITimestamped` already serializes). |

### 2.2 `CreationListItem` (`GET api/me/creations`)

`{ shareCode, kind, name, updatedAt, palette }`. `palette` is a string array of color names for the swatch card (OQ14). A show's palette covers every embedded shell, including shells no cue uses (accepted; Peach F2):

- **Shell:** breaks in order, `color1` then `color2`, distinct, first occurrence wins, `"none"` excluded, `"rainbow"` kept as its own token.
- **Show:** the same rule over embedded shells taken in ordinal key order (`string.CompareOrdinal`; keys are ASCII, so JS default sort agrees).
- At most 8 entries.
- **Computed at write time and stored in a column**, not derived on read. Then the server never has to parse a stored document again, which is what lets the server stay free of upgraders (§8).

### 2.2.1 Paging `GET api/me/creations` (Peach F1)

Offset paging, mirroring the reference's only paged endpoint (`MonsterOfTheWeek.Api/Controllers/SearchController.cs` `Get`, `Contracts/ApiContracts.cs` `PagedSearchResultResponse`, `Services/Search/SearchService.cs` `SearchAsync`).

| Part | Contract |
|---|---|
| Query | `page` (1-based, default 1), `pageSize` (default 24, max 100), `kind` (optional: `shell` or `show`; absent means both). |
| Out-of-range query | Clamped, not rejected, as the reference does: `page < 1` → 1; `pageSize < 1` → 1, `> 100` → 100. One difference from the reference: the response echoes the **effective** values, not the requested ones (`SearchController` echoes the raw `page`/`pageSize`). A `kind` that isn't `shell` or `show` is 400 `(kind, enum)` in the §2.4 body, because silently ignoring a filter returns the wrong set. |
| Order | `updatedAt` descending, then `shareCode` ordinal ascending as the tiebreak, so a page boundary is stable when two rows share a timestamp. The Phase 4 index becomes `(owner_user_id, updated_at desc, share_code)`. |
| Body | `CreationListPage { items: CreationListItem[], page, pageSize, totalCount }`, the reference's envelope with our item type. Never a bare array, so a field like `nextCursor` can be added later without a shape change. |
| Past the end | 200 with `items: []` and the real `totalCount`. |
| Gate | 403 when `CanWrite` is false (§10), before any query. |

`pageSize` 24 fills a 2-, 3-, 4- or 6-column card grid evenly; Rosalina may change the client's requested size without an API change. The Phase 6 "my shells" library calls it with `kind=shell` (the filter exists now because client-side filtering across pages would return short pages).

**Why offset, not a cursor:** one owner's list is small, the reference has the pattern and its tests, and `totalCount` gives `/mine` a page count. The cost: an edit while paging moves a row to the top, so the next page can repeat or skip one row. **Switch to a keyset cursor on `(updated_at, share_code)`** (adding `nextCursor`, keeping `page` working) when any one owner passes 1,000 creations, or `GET api/me/creations` p95 passes 150 ms on Railway, or a skipped or repeated row is reported.

### 2.3 Requests

| Endpoint | Body | Notes |
|---|---|---|
| `POST api/creations` | `{ kind, document }` | 201 with `CreationResponse`. |
| `PUT api/creations/{shareCode}` | `{ document }` | Validated against the stored `kind`. A request `kind` field is an unknown property (400). |
| `POST api/creations/{shareCode}/remix` | `{ document }` | **The body is the edited working copy, not an empty copy of the source** (§11). Validated against the source's `kind`. 201; the new row has `remixedFrom` set. Used for every save of a working copy that creates a new record: a non-owner's Save, and an owner's "Save as new" (§11). Needs `CanWrite`, never ownership of the source. |
| `DELETE api/creations/{shareCode}` | none | 204. |

The owner is always `ICurrentUser.UserId`, never a request field. `name`, `schemaVersion` and `palette` are always derived from the validated document.

### 2.4 Validation failure body (400)

```jsonc
{
  "message": "The document is invalid.",          // the reference's 400 shape keeps `message`
  "errors": [                                       // the complete list, order not significant
    { "path": "breaks[0].stars", "code": "out-of-range", "message": "breaks[0].stars: 401 is outside 4..400." }
  ]
}
```

`path` and `code` are the contract (§6.3). `message` is developer-facing; UIs build copy from `code` (as `designer-copy.ts` `issueReason` already does). Request-level problems use the request's own paths (§2.6). Document issues use paths relative to the document, never prefixed with `document.`. `ServiceError` needs an optional issue list to carry this (Bowser, Phase 4); the reference's `BadRequest(new { message })` (`MonsterOfTheWeek.Api/Controllers/CustomMovesController.cs` `ToErrorResult`) is the shape it extends.

### 2.5 Size

**Recommendation, pending Boo's Phase 4 security review:** `[RequestSizeLimit(262144)]` (256 KiB) on the creation write endpoints. Measured with a script: a typical 1000-cue, 32-shell show is 72 KB compact, and the worst case at every limit (17-digit numbers everywhere, 80-emoji names written as `\u` escapes) is 215 KB. A single worst-case shell is about 1.5 KB, so 64 KiB would only be enough for shells, and Phase 4 validates shows too. 413 for anything larger. If Boo sets a different number, it changes here, in plan Phase 4 and in the `show/at-maximums.json` size check together.

Bowser measured it on .NET 11 under this app's `AddProblemDetails()` + `UseExceptionHandler()` (`bowser-phase3-validator-feasibility.md` item 7): 413 for both an oversize `Content-Length` and a chunked body, 262,143 bytes accepted, and the manual body read (§2.6) still gets the 413. A 1000-cue show validates in 5 to 8 ms. **For Boo's Phase 4 review, not decided here:** the 256 KiB number itself; the manual body read in place of model binding; and Kestrel's global `MaxRequestBodySize`, which stays at its 30 MB default for every other endpoint. The 413 through Railway's edge hasn't been measured.

### 2.6 The envelope walk (server)

The server reads the request in this order. Each step that fails ends the request with the issues listed, and **the document is walked only when the envelope has no issues at all**. Envelope and document issues therefore never appear in one response, which keeps envelope paths (`kind`, `foo`) from being confused with document paths of the same name.

1. `Content-Type` isn't `application/json` → **415**, no `errors` body (`[Consumes("application/json")]`).
2. Over the size limit → **413** (§2.5).
3. The body bytes aren't valid UTF-8 (`System.Text.Unicode.Utf8.IsValid`), the body is empty, or it doesn't parse → `("", not-json)`.
4. The body root isn't an object → `("", not-object)`.
5. The envelope object, read like any walked object (§6.2 rules 2, 11 and 12):
   - POST: `kind` absent or `null` → `(kind, missing)`; any other value that isn't `"shell"` or `"show"`, including a non-string → `(kind, enum)`.
   - PUT and remix: `kind` is not an envelope field there, so `(kind, unknown-property)` (§2.3).
   - `document` absent or `null` → `(document, missing)`; present but not an object (array, number, string, boolean) → `(document, not-object)`.
   - Any other property → `unknown-property` at its name. A repeated envelope name → `duplicate-key` at that name (`kind` twice is `(kind, duplicate-key)`, even when both values are valid).
   - All envelope issues are reported together (a body with a bad `kind` and a `document: 5` gets both).
6. Only with a clean envelope: walk the document with the validator for the request's kind (POST) or the stored kind (PUT, remix).

Because step 5 rejects a non-object `document`, the document walker's own `("", not-object)` (§6.2 rule 1) never reaches an HTTP response. The C# harness translates it for two fixtures (§12.1).

---

## 3. ShellDocument v1

| Field | Type | Required | Range / values | Default (lenient only) |
|---|---|---|---|---|
| `version` | integer | yes | exactly `1` | `1` (reported) |
| `name` | string | yes | §6.4: 1..80 code points after cleaning | `"Custom"` |
| `burstHeight` | number | yes | 0.3..0.85, **fraction of the ground height (760 units)**: burst at `y = 760 − burstHeight × 760` | 0.65 |
| `angleJitter` | number | yes | 0..20 degrees (not an integer field) | 4 |
| `sky` | object | **no** | `{ gravity, wind }` | none: **absent stays absent** |
| `sky.gravity` | number | yes, in `sky` | 40..400 | 160 |
| `sky.wind` | number | yes, in `sky` | −80..80 | 0 |
| `breaks` | array | yes | 1..4 break objects | none (error) |

Break object (all fields required):

| Field | Type | Range / values | Default (lenient only) |
|---|---|---|---|
| `pattern` | enum | `peony`, `ring`, `palm`, `heart` | `peony` |
| `stars` | **integer** | 4..400 | 120 |
| `speed` | number | 60..400 | 220 |
| `color1` | enum | the 10 palette names (`red`, `orange`, `gold`, `green`, `cyan`, `blue`, `purple`, `pink`, `white`, `silver`) or `rainbow` | `red` |
| `color2` | enum | `none` or the 10 palette names (not `rainbow`) | `none` |
| `changeAt` | number | 0.1..0.95 | 0.6 |
| `burn` | number | 0.3..5 | 1.6 |
| `drag` | number | 0..4 | 0.9 |
| `size` | number | 0.4..3 | 1 |
| `trail` | enum | `none`, `tail`, `glitter` | `none` |
| `effect` | enum | `none`, `crackle`, `crossette`, `strobe` | `none` |
| `delay` | number | 0.1..2.5 seconds after the previous break. Stored and validated on break 0 too; the sim ignores it there. | 0.6 |

Defaults are the shipped `DEFAULT_SHELL` / `DEFAULT_BREAK` / `DEFAULT_SKY` in `shell.ts`. They matter only to lenient normalize (§6); a strictly valid document states every required field.

**Sky.** `sky` is optional. An absent `sky` plays under `DEFAULT_SKY` (`{160, 0}`) through `effectiveSky(shell)`, which is the only place that default is applied. A shell with no `sky` and one with `{160, 0}` play the same but are different documents, and both are valid. The ten presets have no `sky`. The designer's `EditableShell` always has one, so shells saved from the designer always carry `sky`.

---

## 4. ShowDocument v1

Schema frozen now, built in Phase 6.

| Field | Type | Required | Range / values |
|---|---|---|---|
| `version` | integer | yes | exactly `1` |
| `name` | string | yes | same rule as a shell (§6.4) |
| `sky` | object | **yes** | `{ gravity, wind }`, ranges as in a shell |
| `duration` | number | yes | 1..600 seconds. **The launch window only** (Skyler, L4): every cue launches in `0..duration`, and playback runs on until the last particle fades (§4.5). |
| `shells` | object (map) | yes | 0..32 entries. Key: `^[A-Za-z][A-Za-z0-9_-]{0,11}$`. Value: an embedded shell (§4.2). |
| `cues` | array | yes | 1..1000 cue objects (§4.3). **An empty show can't be saved** (Skyler, Q4). Because every cue names a key in `shells`, a valid show also has at least one shell; that follows from `unknown-shell`, so `shells` keeps its 0 minimum and no extra code exists for it. |

### 4.1 Sky precedence (settled)

**The show's `sky` wins, and an embedded shell's own `sky` is stripped.** One sim has one gravity and one wind (`FireworksSim.sky` is sim-wide: `simulation.ts` l.63, l.89, l.135), so per-shell skies inside a show can't be honored. The Show Builder strips `sky` when it copies a shell into a show; a stored show whose embedded shell has `sky` is invalid (`unknown-property` at `shells.<key>.sky`), and lenient normalize drops it with a `dropped` adjustment. Phase 6 extends `effectiveSky(shell, showSky?)`: when `showSky` is given it is returned and the shell is not consulted.

`sky` is required in a show (unlike a shell) so that a show always states the sky it plays under and precedence never depends on whether a key is present.

### 4.2 Embedded shells

An embedded shell is a ShellDocument v1 **without `sky`**, walked by the same shell walker with paths prefixed `shells.<key>.`. It keeps `version`, which must equal the shell version pinned by the show's version (v1 show → v1 shells). Keeping it means "extract a shell from a show" is: copy it, add the show's `sky`, and it's a valid ShellDocument.

Shells are snapshots: editing or deleting the source creation never changes a show. Shells not referenced by any cue are allowed (the builder's library can hold a shell before it is placed).

### 4.3 Cue

All fields required except `burstHeight`.

| Field | Type | Range / values |
|---|---|---|
| `id` | string | `^[A-Za-z][A-Za-z0-9_-]{0,11}$`, unique within `cues` |
| `t` | number | 0..`duration` seconds of simulation time from show start. **`t` is the launch time** (Skyler, Q1): the shell leaves the ground at `t` and bursts after its rise. The builder can draw the burst at `t + rise`. |
| `shell` | string | a key present in `shells` (own key: `Object.hasOwn`, see §6.5) |
| `x` | number | 0..1, **fraction of the world width** (OQ5). Launch target `tx = x × worldWidth()` |
| `burstHeight` | number, optional | 0.3..0.85, fraction of 760 as in a shell. **Absent means the shell's own `burstHeight`.** `null` is not stored (one null rule). This replaces the plan §3.3 draft's `"burstHeight": null`. |
| `seed` | integer | int32, −2147483648..2147483647. Assigned once when the cue is created and never re-derived. |

Target height: `ty = 760 − (cue.burstHeight ?? shell.burstHeight) × 760`, the same formula `defaultTarget` uses for a shell. The world is a fixed 800 units tall with ground at 760, and its width follows the window (OQ5).

### 4.4 Firing rule (part of the v1 contract)

This is how both browsers in the Phase 6 Done-when agree on a show. It describes behavior, not document shape, so changing it is a reviewed sim change under §8.1 (determinism checks and goldens updated), not a version bump:

1. The step counter starts at 0 when the show starts. Step *k* simulates one `STEP` = 1/120 s.
2. A cue's step is `fireStep = Math.round(t * 120)` (multiply by the exact integer 120; not `t / STEP`, because `1/120` is inexact). This supersedes the `Math.round(cue.t / STEP)` wording in `yoshi-phase2a-engine-boundaries.md` point 8.
3. Before step *k* runs, every cue with `fireStep <= k` that hasn't fired is fired (`beforeStep(ctx, k)`), via `fireSeeded(def, tx, ty, cue.seed)`, which doesn't consume the loop's launch counter.
4. Cues that fire before the same step fire in order of `(fireStep, id)`, with `id` compared ordinally. Array order never matters, so reordering, inserting or deleting cues never changes how the others play (plan §3.3), even under the 40k particle cap, where spawn order changes counts.
5. Two `t` values that round to the same step play identically. The builder may snap times for its UI; storage doesn't require it.

### 4.5 When a show ends (Skyler, L4)

"A show runs until the last particle fades. `duration` is the launch window only. A cue at `t == duration` is valid and its burst is seen."

- **`duration` never gates firing.** The driver fires every cue by rule 4.4.3, whatever `duration` says. `duration` bounds `t` for validation (§5.1) and sets the launch window the timeline draws.
- **Playback ends** at the first step *k* where every cue has fired and the sim holds no live particle (rockets, stars and child stars all count). That step is deterministic at equal `starBudget` (§13), so "plays the same in two browsers" includes the tail.
- **The tail is at most about 21 s** after the last launch at the current limits (§13 seek bound), so a 600 s show ends by about 621 s. The timeline shows the tail past `duration`; how it's drawn is Rosalina's Phase 6 call.
- `valid/show/cue-at-duration.json` is the fixture: its cue at `t == duration` must be seen to burst in the Phase 6 playback check (Toad).

---

## 5. Limits

### 5.1 The table

`limits.ts` is the source of truth. This table is **cross-checked, not generated** (§5.2). Rows between the markers are machine-read; keep the format.

<!-- limits:begin -->
| Key | Min | Max | Integer |
|---|---|---|---|
| shell.burstHeight | 0.3 | 0.85 | no |
| shell.angleJitter | 0 | 20 | no |
| break.stars | 4 | 400 | yes |
| break.speed | 60 | 400 | no |
| break.changeAt | 0.1 | 0.95 | no |
| break.burn | 0.3 | 5 | no |
| break.drag | 0 | 4 | no |
| break.size | 0.4 | 3 | no |
| break.delay | 0.1 | 2.5 | no |
| sky.gravity | 40 | 400 | no |
| sky.wind | -80 | 80 | no |
| shell.name.codePoints | 1 | 80 | yes |
| shell.breaks.count | 1 | 4 | yes |
| show.duration | 1 | 600 | no |
| show.shells.count | 0 | 32 | yes |
| show.cues.count | 1 | 1000 | yes |
| cue.t | 0 | show.duration | no |
| cue.x | 0 | 1 | no |
| cue.burstHeight | 0.3 | 0.85 | no |
| cue.seed | -2147483648 | 2147483647 | yes |
<!-- limits:end -->

Not in the table: `key` and `id` pattern `^[A-Za-z][A-Za-z0-9_-]{0,11}$`, the share-code format (§9), and the 256 KiB request limit (§2.5). Slider **steps** are a UI concern and are not schema; `limits.ts` keeps them, and the table doesn't. `QUALITY_LIMITS` (`persistence`, `starBudget`) is not schema either (§7).

`limits.ts` today has the shell, break and sky rows plus `NAME_MAX_LENGTH`, `MIN_BREAKS` and `MAX_BREAKS`. Phase 3 adds the show and cue rows and the key pattern there (Luigi).

### 5.2 How drift is prevented

Generation was rejected: there's no CI and no codegen step in the reference, and a generator is one more tool to keep alive. Instead, a single machine-readable mirror is checked from every side:

1. **`schema/limits.json`** (Toad writes it) holds exactly the rows above, as `{ "break.stars": { "min": 4, "max": 400, "integer": true }, … }`, with `cue.t.max` written as the string `"show.duration"`.
2. **TS spec** (`engine/model/limits.spec.ts`): `limits.ts` deep-equals `limits.json` (ignoring `step`), and the table between the markers in this file deep-equals `limits.json`.
3. **C# test**: `CreationLimits.cs` deep-equals `limits.json`.
4. **Behavior, not just constants:** the boundary fixtures (§12) put every numeric field at its min and max (valid) and just outside (invalid) and run through both validators. A validator that ignores its own constants still fails.
5. **Negative controls** (`toad-verify-the-verifier.md`): change one number in each of `limits.ts`, `CreationLimits.cs`, this table and `limits.json`, and the matching check must fail. Toad records each.

Changing a limit is a schema change: update `limits.ts`, this table, `limits.json` and `CreationLimits.cs` together, decide the version question (§8.2), and recompute the lifetime bound in §13.

---

## 6. Validation

### 6.1 One walker, two modes

There is one walk per document kind, shipped for shells as `normalizeShell` (`normalize.ts`). It returns hard **errors** (the document can't be used) and **adjustments** (what it changed to make the document fit):

- **Lenient** (`normalizeShell`, Phase 3 adds `normalizeShow`): for the client loading untrusted input (pasted JSON, the localStorage draft, an API document after upgrade). Succeeds when there are no errors; the adjustments are applied.
- **Strict** (`validateShell` / `validateShow` in `engine/model/validate.ts`): for anything about to be saved, and the only mode the server has. **Valid exactly when the lenient walk has no errors and no adjustments. Every adjustment becomes an error at the same path**, mapped by §6.3.

The server never adjusts a document. It reports, and it stores what it received, re-serialized.

**Required change to the shipped walker (Luigi):** `normalizeShell` returns only `errors` when there are any, and drops the adjustments it collected. Strict mode needs both, so the walker must expose errors and adjustments together, and `validate` reports their union.

### 6.2 Walk order and skip rules

Both validators must produce the **same complete multiset** of `(path, code)` pairs for every fixture (`toad-exact-call-ledger-over-positive-assertions.md`). So the places where the walk stops are part of the contract:

1. Root not an object → one `not-object` at `""`. Nothing else.
2. Unknown keys are reported at every object level (root, `sky`, each break, each cue, each embedded shell), in addition to whatever else is wrong.
3. A wrong `version` is reported and the walk **continues** (the shipped behavior).
4. `breaks` missing, not an array, empty or longer than 4 → one `break-count` at `breaks`; **no break is walked**.
5. A break, cue, `sky` or embedded shell that isn't an object → `not-object` at its path; its fields are not walked.
6. A field with the wrong JSON type gets exactly one `type` issue and nothing else.
7. Shows, `shells`: absent or `null` → `(shells, missing)` (a required field with no default; not `shell-count`, because 0 shells is in range); not an object (including an array) → `(shells, not-object)`; more than 32 entries → one `(shells, shell-count)`. In all three cases no shell is walked. Otherwise each key that doesn't match the key pattern gets its own `(shells, key-format)` with `value` = the key (two bad keys, two issues), and that entry isn't walked. The count is of distinct keys (what `JSON.parse` yields).
   Shows, `cues`: absent, `null`, not an array, empty, or longer than 1000 → one `(cues, cue-count)`, no cue walked. **A missing `cues` is the same error as `cues: []`**, as a missing `breaks` is `break-count` (§6.3 already says "not an array").
8. Cue cross-checks run only on cues whose own field passed:
   - `id`: absent → `missing`; not a string (`5`) → `type`; a string that fails the key pattern → `key-format`. An id that failed any of these joins no set, so it never causes or receives `duplicate-id`. `duplicate-id` is reported at the **second and later** occurrences' `cues[i].id`; the first occurrence is clean.
   - `shell`: absent → `missing`; not a string → `type`; otherwise `unknown-shell` when `shells` was walked and the value isn't in its **key set**. The key set is exactly the keys that passed `key-format`, whether or not their embedded shell is valid or even an object (`embedded-not-object.json` raises no `unknown-shell`). So a cue naming a key that failed `key-format` is `unknown-shell`, beside the `(shells, key-format)`. A cue's `shell` gets no `key-format` check of its own: membership is the only test.
   - When `shells` wasn't walked (rule 7), no `unknown-shell` is checked on any cue.
   - `cue.t`'s upper bound is `duration` only when `duration` itself is valid; otherwise it's 600.
9. **Show-only defaults.** In a show only `version` and `name` default. Show `sky` absent is `(sky, missing)`, and inside a show's `sky` a missing `gravity` or `wind` is a hard `missing` (no `DEFAULT_SKY` fill), unlike a shell's `sky`. Lenient mode clamps an out-of-range `duration` and cue `t`, `x` and `burstHeight` (adjustment `clamped`, strict `out-of-range`), and never adjusts `seed`: a fractional or out-of-int32 seed is a hard error in lenient mode too (§6.3, note below the table). Because rule 8 bounds `t` by 600 when `duration` is invalid, a lenient result can hold a cue whose `t` is past its clamped `duration` (`duration: 0`, `t: 5`). The Phase 6 driver fires it at its `t` like any cue, because `duration` never gates firing (§4.5); strict validation reports it as `out-of-range`, so it must be moved before the show can be saved. No document rule changes for it.
10. **Embedded shells and unknown values.** An embedded shell's `version` other than 1 (`2` in a v1 show) is `(shells.<key>.version, version)` and its walk continues (rule 3). An embedded `sky` is `(shells.<key>.sky, unknown-property)` only: the value of an unknown property is never walked, at any level, so bad values inside it raise nothing more.
11. **Property names in paths.** A child path is `parent.name` (or `name` at the root) when the name matches `^[A-Za-z_][A-Za-z0-9_-]*$` (C#: `\z`, not `$`). Any other name, including `""`, a name with `.`, `[`, a space or any non-ASCII character, is written `parent["name"]` (or `["name"]` at the root), where inside the quotes each `\` becomes `\\`, each `"` becomes `\"`, each unpaired surrogate becomes U+FFFD, and every other character is kept as is. No other escaping: this is not `JSON.stringify` (STJ escapes differently). Examples: `"a.b": 1` at the root → `["a.b"]`; `"": 1` → `[""]`; a break key `"st\ud800ars"` → `breaks[0]["st�ars"]` (U+FFFD). The replacement keeps paths well-formed Unicode, so they survive the 400 body and both fixture readers (C# `GetString` throws on a lone surrogate). Known schema keys and valid shell keys always take the plain form, so every path in the existing fixtures is unchanged.
12. **Duplicate keys (server only, §6.5).** Checked on exactly the objects the walk reads (the envelope, the document root, `sky`, each walked break, cue and embedded shell, and the `shells` map), and on nothing it skips (the value of an unknown property, a `breaks` or `cues` with a count error, a `shells` with `shell-count`). One `duplicate-key` **per repeated name per object**, however many times it repeats, at that name's path (rule 11; a repeated shell key is `shells.s1`). Names are compared after unescaping (`"stars"` and `"stars"` are the same name). The walk then treats the name as present once with its **last** value, as `JSON.parse` does, so the rest of the multiset is the one the TS side produces: `stars` 120 then 401 is `duplicate-key` plus `out-of-range`; an unknown `foo` twice is `duplicate-key` plus one `unknown-property`.
13. **`null` in an optional field** (`sky` in a shell, cue `burstHeight`) is `missing`, by the one null rule: `null` reads as absent, lenient mode drops it (`defaulted`, nothing filled in), and strict mode rejects it because a stored document never contains `null` (§1). This is intended even though the absent field is valid: strict accepts exactly the canonical form, and `"sky": null` isn't it. UI copy for `missing` on an optional field should say to remove the `null`, not to add a value (Rosalina, with the other §15 copy).

### 6.3 Issue codes

| Code | Raised when | Lenient | Strict |
|---|---|---|---|
| `not-object` | a value that must be an object isn't | error | error |
| `type` | wrong JSON type, or a non-finite number (`options`: `["number"]`, `["string"]`, `["integer"]`) | error | error |
| `enum` | an enum value outside its set, or not a string (`value`, `options` given); also the envelope's `kind` (§2.6) | error | error |
| `version` | `version` present but not the supported one: `99`, `"1"`, `true`, `1.5` (`value` given) | error | error |
| `break-count` | `breaks` missing, not an array, or not 1..4 | error | error |
| `missing` | from `defaulted`: a required field absent or `null`, a blank name, `null` in an optional field (`sky: null`, a cue `burstHeight: null`, §6.2 rule 13). Also, as a hard error, a required field with no default: show `sky`, `shells` and `duration`, a show sky's `gravity`/`wind`, the cue fields, and the envelope's `kind` and `document` | adjustment `defaulted`, or error where there's no default | error |
| `out-of-range` | from `clamped`: a number outside its range (tested on the raw value, so `stars: 400.4` is out of range, not "not an integer") | adjustment `clamped` | error |
| `not-integer` | from `rounded`: an integer field given a fraction inside its range | adjustment `rounded` | error |
| `too-long` | from `truncated`: a name longer than 80 code points after cleaning | adjustment `truncated` | error |
| `unknown-property` | from `dropped`: a key the schema doesn't have, including never-persisted keys (§7) and a `sky` in an embedded shell | adjustment `dropped` | error |
| `name-format` | from the **new** adjustment kind `cleaned`: control characters or unpaired surrogates removed, or edge whitespace trimmed (§6.4) | adjustment `cleaned` | error |
| `shell-count` | show `shells` over 32 entries | error | error |
| `cue-count` | `cues` absent, `null`, not an array, empty (`[]`), or over 1000 | error | error |
| `key-format` | a shell key (one issue per bad key, at `shells`) or a string cue `id` that doesn't match the key pattern | error | error |
| `duplicate-id` | a cue `id` already used by an earlier cue | error | error |
| `unknown-shell` | a cue `shell` that isn't an own key of `shells` | error | error |
| `not-json` | server only: the body is empty, isn't valid UTF-8, or isn't parseable JSON (§2.6) | — | error |
| `duplicate-key` | server only: an object the walk reads has the same name more than once; one issue per repeated name (§6.2 rule 12) | — | error |

Cue fields have no defaults, even in lenient mode: a missing `id`, `t`, `shell`, `x` or `seed` is a hard `missing` error, and `seed` is never rounded or clamped (a changed seed silently changes the burst), so a fractional or out-of-int32 seed is a hard `not-integer` or `out-of-range` error in both modes. Shows have no legacy inputs to be forgiving about; only `version` and `name` default in a show, mirroring the shell.

The shipped `ShellIssueCode` union (`not-object | version | type | enum | break-count`) grows to this table, and `AdjustmentKind` gains `cleaned` (Luigi). `designer-copy.ts` `issueReason` and `appliedNote` need copy for the new kinds and codes (Rosalina decides whether `cleaned` is mentioned in the Apply note).

### 6.4 Names (settled)

Applied in this order, identically on both sides:

1. Absent or `null` → `defaulted` (`missing`). Not a string → `type`.
2. **Clean:** remove every code point in Unicode category **Cc** (U+0000–U+001F, U+007F–U+009F) and every **unpaired surrogate**. Then **trim** leading and trailing code points in this explicit set, which is exactly JavaScript's `String.prototype.trim` set: U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Interior whitespace is kept as typed.
3. If the cleaned name is empty → `defaulted` to `"Custom"` (`missing`).
4. Else if it has more than 80 **code points** → `truncated` to its first 80 code points (`too-long`). C# counts runes; after step 2 there are no unpaired surrogates, so runes and JS code points agree.
5. Else if cleaning changed it → `cleaned` (`name-format`).

**One issue per name, at most**, with precedence `type` > `missing` > `too-long` > `name-format`, so both sides produce the same multiset.

Why trim: a name is a one-line label in cards, overlays and `<title>`; `" Peony"` and `"Peony"` should not be two different names, and strict mode needs one canonical form. Why remove controls: Postgres `jsonb` rejects `\u0000` outright (an insert would fail with a 500), JSON allows it, and the other control characters make no sense in a one-line label. Why an explicit set: C#'s `string.Trim()` uses `char.IsWhiteSpace`, which misses U+FEFF and adds U+0085; `Trim(char[])` with the list above matches JS exactly.

The designer is unaffected while typing: its form model keeps raw text ("no field fights the user", `shell-designer.store.ts`), and only the normalized `shell` it saves and shows in the JSON panel is cleaned. A visitor who clears the name and saves gets `"Custom"` (Skyler, Q5); Save is not blocked.

The designer's `maxlength="80"` counts UTF-16 units, so the input is stricter than the schema for astral characters (40 emoji). It never lets through a name the schema rejects; it's noted, not a bug.

### 6.5 Server-side specifics (Bowser)

- **Walk a `JsonElement`, not a DTO.** Implement the same walk over `JsonDocument`/`JsonElement` and build the canonical DTO from the walk, as `normalizeShell` builds its shell. Deserializing straight into DTOs with `UnmappedMemberHandling = Disallow` (the plan's Phase 4 draft) can't meet §6.2: it stops at the first unknown member, reports STJ's paths (`$.breaks[1].color1`) and messages instead of ours, and an `int Stars` property rejects the valid `120.0`.
Every claim below was measured on .NET 11.0.0 by Bowser's probes (`.squad/decisions/records/bowser-phase3-validator-feasibility.md`); three claims in the first draft of this section were false and are corrected here.

- **Integers by value, not by format.** Read numbers with `TryGetDouble`, **then require `double.IsFinite`**: on .NET 11 `TryGetDouble` returns `true` for `1e400`, with `+Infinity`. Non-finite is `type`. Test integrality on the double (`d == Math.Floor(d)`). `TryGetInt32` rejects `1.0`, `1e2` and `1293847.0`, which are a valid `version`, `stars` and `seed`. Test the range on the raw double first (`0.8500000000000001 > 0.85` is `out-of-range`). Order per field: `missing`, `type` (including non-finite), `out-of-range`, `not-integer`, one issue at most.
- **No rounding on the server.** It never adjusts, so `Math.Round`'s banker's rounding never matters. Say so in a comment; it is the obvious trap if someone adds a lenient mode later.
- **Duplicate keys: detected by the walker, not the parser.** `JSON.parse` keeps the last value silently, so the TS validator can't see them; the server rejects them (§6.2 rule 12). `JsonDocumentOptions.AllowDuplicateProperties = false` exists but its `JsonException` carries no path, so it can't report `breaks[0].stars`. Parse with the default options (duplicates kept); `EnumerateObject()` yields every occurrence, and the walker's object reader (ordinal dictionary, last value wins) finds them. Postgres `jsonb` also keeps the last value silently, so this check is the only place a duplicate is ever seen. Deliberate asymmetry, covered by server-only fixtures (§12.4); the client can never produce one (`JSON.stringify` can't).
- **Invalid UTF-8 and unpaired surrogates.** `JsonDocument.Parse` accepts both raw invalid UTF-8 (`0xFF`, CESU `ED A0 80`) and lone surrogate escapes (`"\ud800"`); they only fail later, as an `InvalidOperationException` (a 500) from `GetString()`, from `JsonProperty.Name`, and for some inputs (`"\udc00\ud800"`) from `ValueEquals`. So:
  - Gate the whole body with `System.Text.Unicode.Utf8.IsValid` before parsing; invalid UTF-8 is `("", not-json)` (§2.6). Escaped lone surrogates are valid UTF-8 and pass this gate.
  - Wrap every `ValueEquals` in try/catch; a throw means "no match" (`enum`, or for `kind` see §2.6).
  - `name`: catch the `GetString` failure and unescape the raw token (`GetRawText()`) in a small fallback that keeps lone surrogates, then run the normal §6.4 pipeline. `"Pe\ud800ony"` is `name-format`; `"\ud800"` is `missing`.
  - Property names: read them through the same raw-token fallback (never `JsonProperty.Name` unguarded). A name with a lone surrogate can't equal any schema key or pass the key pattern (both are ASCII), so it is `unknown-property` (or `key-format` in `shells`), at the path from §6.2 rule 11 with the surrogate written as U+FFFD. The TS side gets the same name from `JSON.parse` with the lone surrogate in it and applies the same rule 11 replacement.
- **Regex anchors: `\z`, never `$`.** In .NET, `$` also matches before a final `\n`: with `$`, `"s2\n"` passed as a shell key, `"c1\n"` as a cue id, and the share-code route matched `abcdefgh%0A` and reached the action. Use `^…\z` for the share code, shell keys, cue ids and the rule 11 identifier pattern, and don't use `RegexOptions.IgnoreCase` on them (it lets `[A-Za-z]` match the Kelvin sign U+212A). JS `$` without the `m` flag doesn't have this problem.
- **Read the body yourself; don't bind `[FromBody] JsonElement`.** Measured: with binding, unparseable JSON returns MVC's ModelState ProblemDetails (not our `{ message, errors }`), an empty body returns "A non-empty request body is required.", and invalid UTF-8 binds successfully and throws later in the walker. The write actions take `[Consumes("application/json")]` (without it the manual action accepted `text/plain`), read `Request.Body` into a buffer (the `[RequestSizeLimit]` 413 still applies), and run §2.6. The request records (`CreateCreationRequest(string Kind, JsonElement Document)` and the others) are built by that envelope walk, so they still state what the API accepts.
- **Canonical output.** Re-serialize the walked DTO: camelCase, `sky` and cue `burstHeight` omitted when absent (`WhenWritingNull`), never `null`. Store that, not the request text. STJ's escaped output (`<`, escaped emoji) is accepted by `jsonb` (measured). Postgres 18 rejects `\u0000` and lone surrogate escapes in `jsonb`; neither can reach it, because names are cleaned (§6.4) and every other stored string is matched against a fixed set or the ASCII key pattern.
- **Route constraint.** Anchor the share-code regex with `^` and `\z` (§9). The reference's `CustomMovesController.cs` explains why an unanchored `RegexInlineRouteConstraint` matches substrings; `$` is not enough either, as above.

### 6.6 Client-side specifics (Luigi)

- Maps built by the walker (`shells`) must not inherit from `Object.prototype`: build them with `Object.create(null)` or a `Map`, and test membership with `Object.hasOwn`. Otherwise a cue with `"shell": "constructor"` finds `Object.prototype.constructor` and passes. The key pattern's leading letter also rules out `__proto__`.
- Paths for unknown property names follow §6.2 rule 11 (bracket form, U+FFFD for unpaired surrogates). Shipped: `dropUnknown` in `engine/model/normalize.ts` (l.676–724) builds `parent["name"]`, and the `unknown-key-*` fixtures pass.
- The fixture runner reads repo-root `schema/fixtures/**` from Vitest under the Angular builder. Shipped: `schema-fixtures.spec.ts` runs every fixture with no extra builder config.
- **Docker context.** `schema/` is test input only: the `Dockerfile` copies only `src/web/fireworks-web/` and `src/api/`, and nothing at runtime reads `schema/`. It still sits in the build context because `.dockerignore` doesn't list it. Whether to add it there is Bowser's Phase 4 call; if Phase 4 makes the API read `limits.json` at runtime (for example as an embedded resource) instead of only in a test, it must stay in the context and be copied.

---

## 7. Never persisted

These are device or session state. They never appear in a ShellDocument or ShowDocument, and a document that has them is invalid (`unknown-property`; lenient mode drops them):

- `starBudget` and `persistence` (`QualitySettings`, `QUALITY_LIMITS`). Note: `starBudget` changes RNG draws, so two devices play a creation identically only at the same `starBudget` (§13).
- `reduceFlashing` and every other display setting.
- Playback `mode` (`loop`, `manual`, `show`; `PLAYBACK_MODES`).
- Designer state: `activeBreak`, `shellDirty`, `skyDirty`, and the Phase 5 `source` link from a working copy to its saved record (§11). These live in the draft (`fireworks.draft.v1`), never in a document.

---

## 8. Version policy

### 8.1 Rules

- Each kind has its own version: `SHELL_VERSION = 1`, `SHOW_VERSION = 1`. The envelope's `schemaVersion` is the document's `version`.
- **Writes accept only the current version** of their kind. Anything else is `version`; a missing `version` is `missing`.
- **The server stores `schema_version` and never upgrades or rewrites stored documents.** It has no upgraders. It never needs to read a stored document again, because every derived column (`name`, `schema_version`, `palette`) is computed at write time.
- **The client upgrades older documents** step by step, then normalizes (§8.3).
- **A version bump is for a change to the document's shape, and only that** (Skyler, Q2). Shape changes: removing or renaming a field, changing a field's type, making an optional field required, tightening a range, removing an enum value, or changing what a stored value means so that old documents would need their values rewritten to keep the author's intent (the upgrader that rewrites them needs a version to key on). Any shell bump also bumps the show version, because shows embed shells.
- **No bump:** a new optional field whose absence means today's behavior, a new enum value, a loosened range, a changed lenient default (stored documents are strict, so they never rely on one), and every change to how a document plays.
- **Share links are not locked** (Skyler, Q2). A valid v1 document is guaranteed to keep loading and validating, not to play identically forever. Sim, firing-rule (§4.4) and renderer improvements may change how existing links play. The prototype goldens stay as regression guards: a sim change that moves a golden is either a bug or an intentional change, and an intentional one updates the goldens in a reviewed change (Toad checks it), with no schema version bump and no old code path kept.
- **Known cost of "no bump":** a browser tab still running an older bundle doesn't know a new optional field; its lenient normalize drops it, and if that tab re-saves the record, the field is lost. Accepted because the API and SPA ship in one container (`Dockerfile`), so the window is a stale tab. The trigger to revisit: the first time a stale tab's save loses a field in a reported bug, add a `minClientSchema` check to `api/me`.

### 8.2 `engine/model/upgrade.ts`

```ts
export type UpgradeResult =
  | { readonly ok: true; readonly document: unknown; readonly from: number }
  | { readonly ok: false; readonly error: ShellIssue }; // code 'version', path 'version'

export function upgradeShell(raw: unknown): UpgradeResult;
export function upgradeShow(raw: unknown): UpgradeResult;
```

- Works on raw parsed JSON, before normalize. Each step is a pure function `vN → vN+1` registered by its from-version; steps are never deleted.
- A missing `version` is passed through untouched while the current version is 1, so normalize still reports it (`defaulted`, strict `missing`). Once v2 exists, a missing version means v1 and the v1→v2 step sets it.
- A version above the current one fails with `version`: the data is newer than this bundle, and the UI should say "reload to open this". A non-integer version fails the same way.
- Steps must not fail on fields they don't touch, and must leave unknown keys for normalize to report.
- In v1 both functions are identity plus the version checks, and the spec asserts the chain has `SHELL_VERSION − 1` steps. Each future step comes with fixture pairs under `schema/fixtures/upgrade/<kind>/v1-to-v2/`.

### 8.3 Where untrusted documents enter the client

Always **parse → upgrade → normalize** (lenient) to play or edit, and **validate** (strict) before saving:

| Entry | Path |
|---|---|
| Player `/s/:code` | GET → upgrade → `normalizeShell`/`normalizeShow` → play |
| Working copy `/c/:code` | GET → upgrade → normalize → designer (§11) |
| JSON Apply | `JSON.parse` → upgrade → normalize |
| Draft restore | `readDraft` → upgrade → normalize |
| Update original, Save as new, non-owner Save | normalized document → `validateShell`/`validateShow` → PUT or POST (§11). A strict failure here is almost always a client bug; a stale tab (§8.1) can also reach it, so it still needs copy (§15, F10). |

**Shipped today, both of the last two rows skip upgrade.** `readDraft` (`designer-draft.ts`) goes `toEditable` → `normalizeShell`, and `applyJson` (`shell-designer.store.ts`) goes `JSON.parse` → normalize; nothing outside specs calls `upgradeShell` yet. That's harmless while v1 is the only version. **Luigi wires `upgradeShell` into both in Phase 5**, alongside the player and `/c/:code`, which are new code and take the full path from the start.

A current-version document from the API that needs any adjustment means the C# and TS validators disagree. The client logs a console warning with the adjustments, so drift shows up in use and not only in tests.

---

## 9. Share codes

- **Format:** 8 characters from the Base58 alphabet, `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`, which drops exactly the plan's look-alikes `0`, `O`, `I`, `l`. Case-sensitive. Regex: `^[1-9A-HJ-NP-Za-km-z]{8}$` in TS, and `^[1-9A-HJ-NP-Za-km-z]{8}\z` in C#, including the route constraint (§6.5: .NET `$` lets `abcdefgh\n` through). 58⁸ ≈ 1.3 × 10¹⁴ (about 47 bits).
- **Generation:** `RandomNumberGenerator.GetItems<char>(alphabet, 8)`. On a unique-index collision, re-check whether the desired state holds and retry with a new code, up to 5 attempts (`boo-race-guards-check-desired-state.md`), then fail with 500. At this keyspace a retry is an event worth a log line.
- **Storage:** `share_code varchar(12)` unique (Phase 4), which leaves room to lengthen codes without a migration. Comparison is ordinal and case-sensitive: Postgres's default deterministic collation and SQLite's `BINARY` both are.
- **Lookups:** a code that doesn't match the regex is a 404 from the route constraint, with no database query. The client checks the same regex before fetching.
- A share code is the creation's public identifier and access key. It is never reused after a delete.

---

## 10. Ownership and identity (plan §3.4)

- Every creation has `owner_user_id` (uuid, FK to `users`, required, cascade on delete). It is always `ICurrentUser.UserId` at create or remix, never a request field.
- **Reads by share code are public**: no identity needed, unlisted, no gallery (OQ4).
- **Writes are owner-only and gated by `CanWrite`.** Every create, update, delete and remix path checks `CanWrite && UserId != null` first and returns `Forbidden` (403) when that fails; then update and delete filter on `id AND owner_user_id` in one query, and a creation the user doesn't own is **404**, so a non-owner can't tell "exists" from "doesn't". Remix needs `CanWrite` but not ownership of the source.
- **"My creations" follows the write switch**: `GET api/me/creations` returns 403 when `CanWrite` is false, the same gate as the writes (`yoshi-phase1-plan-followups.md`).
- **Client:** nothing when `!canWrite`. Otherwise the Save rule in §11: a working copy of an owned record offers "Update original" (PUT) or "Save as new" (remix); anything else saves as new. Before Phase 8 every visitor is the default user, so `isOwner` is always true in the running app (§11.5).
- **Phase 8 needs no schema change.** Replace the `ICurrentUser` registration with a claims-based one, add a `CanWrite` authorization policy on top of the service gate, and add `external_provider`/`external_subject` to `users` (`User.cs` already describes that migration). `owner_user_id`, the documents, the envelope and this file stay as they are. An anonymous visitor then has `UserId == null`, so `isOwner` is false and `canWrite` is false. What happens to creations saved as the default user during test windows is a Phase 8 question (for example, a runbook statement that reassigns them to Skyler's account).

---

## 11. Phase 5: links, working copies and Save

Skyler, 2026-11-13 (L1–L3, §14):
- L1: "A link never opens the saved record for editing. It always loads a new, unsaved (dirty) form populated with exactly the saved settings: a working copy."
- L2: if the working copy came from a creation the current user owns, Save offers "Update original" (PUT, which changes what its share link plays) or "Save as new"; otherwise Save creates a new creation with `remixedFrom` set to the source. There is no separate edit-in-place route, and Remix just opens the working copy.
- L3: opening a link over unsaved designer changes asks first, only when the shell or sky is dirty (the same rule as Apply with `sky`).

### 11.1 One link model (Peach F8)

| Link | Does |
|---|---|
| `/s/:code` | The player. Plays the creation, never edits it. Overlay: the name and **Remix**. Share always copies this link. |
| `/c/:code` | **The only link that opens a creation for editing**, always as a working copy. Dispatches on the envelope's `kind`: a shell opens in the designer at `/`, a show in the Show Builder (Phase 6). |
| Player **Remix** | Navigates to `/c/:code`. It makes no API call; the remix happens only if and when the visitor saves (§11.4). |
| My creations **Open** | `/c/:code`. |

There is no `/shows/:code/edit` and no edit-in-place route for either kind. The Show Builder lives at its own route (plan Phase 6) and holds its working copy in its own draft.

`/c/:code` loads and then redirects; it isn't a page the visitor stays on: GET → upgrade → normalize → the §11.3 confirm if needed → write the working copy into the draft → navigate to the editor with `replaceUrl`. Why: the draft is what survives a reload (standing designer-draft decision). If the designer stayed at `/c/:code`, a reload would fetch again and offer to replace the visitor's edits with the saved record; after the redirect a reload restores the edited copy, and Back doesn't re-run the load. Whether it's built as a guard, a resolver or a component is Luigi's call; the behavior is the contract. A code that fails the §9 regex or returns 404 shows the same not-found page as the player, and the draft is untouched.

### 11.2 The working copy

- **Built from exactly the saved settings:** GET → upgrade → normalize → `editableFrom(shell, DEFAULT_SKY)`. **The fallback sky is `DEFAULT_SKY`, not the visitor's current sky**, so the copy plays the way the share link plays. A saved shell without `sky` then gains an explicit `{160, 0}` when it's saved back. That plays the same and is accepted. A show has a required `sky`, so it has no fallback.
- **It loads dirty** (L1): `shellDirty` and `skyDirty` are both set, so a preset, an Apply or another link right after loading one asks first. This is the one load that sets dirty. It doesn't break "app-made changes never set dirty", because the visitor chose to open the link.
- **The draft remembers its `source`:** `{ shareCode, kind, isOwner, updatedAt } | null`, client state only (§7). A link load sets it, and a successful save sets it to the record just written (§11.4). Nothing else changes it: a preset or an Apply on a working copy is an edit to that copy, so "Update original" would save it. A fresh designer with no link and no save has `source: null`.
- `isOwner` in `source` is a snapshot that picks which Save choice to show. The server decides: a PUT on a record the user no longer owns, or one that was deleted, is 404 (§10). The client then offers "Save as new" (copy: F10, §15).

### 11.3 Opening a link over unsaved changes (L3)

- Ask first **only when `shellDirty || skyDirty`**. Display settings and the active tab never count, as for presets and Apply.
- **Cancel:** the current draft stays as it was, the link isn't loaded, and the visitor lands in the editor.
- **Confirm:** the working copy replaces the draft; the old draft isn't kept.
- Because a loaded copy is dirty (§11.2), opening a second link straight after the first also asks. Whether Save clears the dirty flags, which would change that, is F4 (§15).
- A show link applies the same rule to the Show Builder's own dirty state (Phase 6).

### 11.4 Save (L2)

Only when `canWrite` (§10). Every save sends the copy as the document, after `validateShell`/`validateShow`.

| Working copy | Save offers | Request | Afterward |
|---|---|---|---|
| `source` is `null` (fresh work, never saved) | **Save** | `POST api/creations` | a new record; `source` = it, `isOwner: true` |
| `source.isOwner` is true | **Update original** | `PUT api/creations/{source.shareCode}` | same share code; its share link plays the change; `source.updatedAt` refreshed |
| | **Save as new** | `POST api/creations/{source.shareCode}/remix` | a new record with `remixedFrom` = the source; `source` = the new record |
| `source.isOwner` is false | **Save** (no choice) | `POST api/creations/{source.shareCode}/remix` | the same as Save as new |

- **"Save as new" goes through `…/remix`, not a plain POST** (Yoshi's call: L2 names the choice but not the request). It records the lineage, and the owner of both records is the only one who can see it (§2.1). It also makes "Remix it" observable before Phase 8 (§11.5).
- After the first save of fresh work, `source` is that record, so the next Save offers the two choices. That follows from L2 ("came from a creation the current user owns") and replaces the plan's earlier "Save: POST the first time, then PUT".
- How the choice is presented (split button, menu or dialog) is Rosalina's Phase 5 design-review call.

### 11.5 What the running app can show before Phase 8

Every visitor is the default user, so `isOwner` is always true (§10).

- **Observable:** a first Save is a POST with a new share code; **Update original** is a PUT, and the share link plays the change; **Save as new** creates a new share code whose GET has `remixedFrom` set to the original (the visitor owns the remix, so it's visible); the player's Remix opens a dirty working copy; opening a link over unsaved changes asks first, and Cancel keeps the draft; a reload after a link load keeps the edited copy.
- **Not observable:** the non-owner row of §11.4 (Save with no choice, straight to remix), and `remixedFrom: null` for a non-owner. The server side is covered by Phase 4's two-user service tests. The client side needs a Phase 5 spec with a stubbed `isOwner: false` response that asserts the complete call ledger: exactly one `POST …/remix`, no PUT (`toad-exact-call-ledger-over-positive-assertions.md`).
- **No dev-only second user before Phase 8** (this settles the question plan Phase 5 left to Yoshi and Bowser): the stubbed spec and the two-user service tests cover both sides without new identity code that Phase 8 would have to remove. Trigger to revisit: the first bug in the non-owner path that reaches the running app past those specs.

---

## 12. Shared fixtures (for Toad)

### 12.1 Layout and format

```
schema/
  limits.json                     §5.2
  fixtures/
    valid/shell/*.json
    valid/show/*.json
    invalid/shell/*.json
    invalid/show/*.json
    server-only/*.json            wire-level cases the TS validator can't see (§12.4)
    upgrade/                      empty in v1; one folder per future step
```

Each fixture file:

```jsonc
{
  "description": "stars above the maximum",
  "kind": "shell",
  "document": { /* the document under test */ },
  "errors": [ { "path": "breaks[0].stars", "code": "out-of-range" } ]   // invalid only: the COMPLETE multiset
}
```

`{ kind, document }` is a valid `POST api/creations` body as-is, so the C# harness posts the file minus `description` and `errors`. A valid fixture must pass strict validation with zero issues on both sides and return 201. An invalid fixture must produce **exactly** its `errors` multiset (sorted by path, then code; nothing missing, nothing extra) from `validateShell`/`validateShow`, from the C# validator, and in the harness's 400 body.

- **One translation in the harness:** `invalid/shell/root-array.json` and `root-string.json` expect `("", not-object)` from the validators, and `(document, not-object)` from the harness, because the envelope walk rejects a non-object `document` before the validator runs (§2.6 step 5). No other fixture is translated.
- **The C# harness posts the document's raw text** (`GetRawText()` of `document`), never a re-serialization: re-serializing would lose `1.0`, `1e2`, `1e400` and the own `__proto__` key, and `GetString` throws on the lone surrogates some fixtures contain.

Server-only fixtures (Toad's format) are `{ description, body, status, errors? }`: `body` is the raw request text, because these cases aren't representable after `JSON.parse`; `status` is 400 or 413; `errors` is present exactly when `status` is 400. They have no top-level `kind`. Their paths follow §2.6: envelope issues at envelope paths, document issues relative to the document.

**What the shared fixtures can't see.** They run strict mode only, and some lenient rules give the same strict code either way: a fractional `seed` is `not-integer` whether lenient rounded it or refused it. Those rules are covered by TS unit specs on `normalizeShow` instead (§12.5).

Unless a case says otherwise, an invalid fixture is the Peony preset with one change, so each file tests one rule.

### 12.2 Valid

| File | What it proves |
|---|---|
| `shell/preset-<slug>.json` ×10 | Every preset, value for value from `presets.ts`, with `version: 1` and **no `sky`**: absent sky is valid. |
| `shell/with-sky.json` | A present `sky` is valid. |
| `shell/four-breaks-all-enums.json` | 4 breaks; together they use every pattern, trail and effect, `rainbow` in `color1`, `none` and a palette color in `color2`. |
| `shell/at-minimums.json` | Every numeric field (shell, break, sky) at its min. |
| `shell/at-maximums.json` | Every numeric field at its max (`burstHeight` 0.85, `stars` 400, `wind` 80…). |
| `shell/negative-wind.json` | `wind: -80`. |
| `shell/number-forms.json` | `version: 1.0`, `stars: 1e2`, `angleJitter: 4.5`: integer fields by value; `angleJitter` is not an integer field. |
| `shell/off-step-values.json` | `burstHeight: 0.333`, `speed: 61`: values off the slider step are valid. |
| `shell/name-80-astral.json` | Name of 80 emoji (160 UTF-16 units): length is code points. |
| `shell/name-one-char.json` | Name `"a"`. |
| `shell/name-interior-space.json` | `"Big  Red One"`: interior whitespace is kept. |
| `shell/name-interior-bom.json` | `"Pe﻿ony"`: U+FEFF is trimmed only at the edges. |
| `show/minimal.json` | 1 shell, 1 cue, no cue `burstHeight`. |
| `show/cue-burst-height.json` | A cue with its own `burstHeight`. |
| `show/cue-at-duration.json` | Cue `t` equal to `duration`; another at `t: 0`. |
| `show/same-step-cues.json` | Two cues with `t` 1.0 and 1.004 (same step), ids out of array order. |
| `show/seed-extremes.json` | Seeds −2147483648 and 2147483647, and `1293847.0`. |
| `show/unreferenced-shell.json` | A shell no cue uses. |
| `show/key-edges.json` | Shell key and cue id of 12 characters, using `-` and `_`. |
| `show/at-minimums.json` | `duration`, `sky` and every cue numeric at its minimum; one shell and one cue (Toad, §5.2 item 4). |
| `show/at-maximums.json` | 32 shells × 4 breaks, 1000 cues, `duration` 600, long numbers. Generated by a script Toad keeps next to it. Also the input to the 413-boundary test: it must be under 256 KiB compact. |

### 12.3 Invalid (expected multiset)

**Shell: structure**

| File | Change | Expected `(path, code)` |
|---|---|---|
| `root-array.json` | document is `[]` | `("", not-object)` |
| `root-string.json` | document is `"peony"` | `("", not-object)` |
| `breaks-missing.json` | no `breaks` | `(breaks, break-count)` |
| `breaks-empty.json` | `breaks: []` | `(breaks, break-count)` |
| `breaks-not-array.json` | `breaks: {}` | `(breaks, break-count)` |
| `breaks-five.json` | 5 valid breaks | `(breaks, break-count)` |
| `breaks-five-one-bad.json` | 5 breaks, one with `stars: 9999` | `(breaks, break-count)` only: breaks aren't walked |
| `break-not-object.json` | `breaks: [1]` | `(breaks[0], not-object)` |
| `break-empty.json` | `breaks: [{}]` | 12 × `missing`: `breaks[0].pattern`, `.stars`, `.speed`, `.color1`, `.color2`, `.changeAt`, `.burn`, `.drag`, `.size`, `.trail`, `.effect`, `.delay` |
| `sky-not-object.json` | `sky: "calm"` | `(sky, not-object)` |
| `sky-null.json` | `sky: null` | `(sky, missing)` |
| `sky-empty.json` | `sky: {}` | `(sky.gravity, missing)`, `(sky.wind, missing)` |

**Shell: version**

| File | Change | Expected |
|---|---|---|
| `version-99.json` | `version: 99` | `(version, version)` |
| `version-string.json` | `version: "1"` | `(version, version)` |
| `version-fraction.json` | `version: 1.5` | `(version, version)` |
| `version-bool.json` | `version: true` | `(version, version)` |
| `version-missing.json` | no `version` | `(version, missing)` |
| `version-null.json` | `version: null` | `(version, missing)` |

**Shell: unknown and never-persisted properties**

| File | Change | Expected |
|---|---|---|
| `unknown-root.json` | `"foo": 1` | `(foo, unknown-property)` |
| `unknown-break.json` | break has `"glow": true` | `(breaks[0].glow, unknown-property)` |
| `unknown-sky.json` | `sky.turbulence: 3` | `(sky.turbulence, unknown-property)` |
| `never-persisted.json` | root has `starBudget`, `persistence`, `mode`, `reduceFlashing` | 4 × `unknown-property` at those paths |
| `wrong-case-key.json` | break has `"Stars": 100` and no `stars` | `(breaks[0].Stars, unknown-property)`, `(breaks[0].stars, missing)` |
| `unknown-key-dot.json` (new) | root has `"a.b": 1` | `(["a.b"], unknown-property)` (§6.2 rule 11) |
| `unknown-key-empty.json` (new) | root has `"": 1` | `([""], unknown-property)`: never the root path `""` |
| `unknown-key-quote.json` (new) | break has `"a\"b": 1` | `(breaks[0]["a\"b"], unknown-property)`, the path text being `breaks[0]["a\"b"]` |
| `unknown-key-lone-surrogate.json` (new) | break has `"st\ud800ars": 1` beside `stars` | `(breaks[0]["st�ars"], unknown-property)`, with U+FFFD in the path |
| `unknown-value-not-walked.json` (new) | root has `"glow": {"stars": 9999}` | `(glow, unknown-property)` only: an unknown value isn't walked |

**Shell: enums**

| File | Change | Expected |
|---|---|---|
| `pattern-unknown.json` | `pattern: "willow"` | `(breaks[0].pattern, enum)` |
| `pattern-case.json` | `pattern: "Peony"` | `(breaks[0].pattern, enum)` |
| `trail-unknown.json` | `trail: "smoke"` | `(breaks[0].trail, enum)` |
| `effect-unknown.json` | `effect: "glitter"` | `(breaks[0].effect, enum)` |
| `color1-none.json` | `color1: "none"` | `(breaks[0].color1, enum)` |
| `color2-rainbow.json` | `color2: "rainbow"` | `(breaks[0].color2, enum)` |
| `color-hex.json` | `color1: "#ff0000"` | `(breaks[0].color1, enum)` |
| `pattern-number.json` | `pattern: 1` | `(breaks[0].pattern, enum)` (the shipped walker treats a non-string enum value as `enum`) |

**Shell: numbers**

| File | Change | Expected |
|---|---|---|
| `stars-401.json` | `stars: 401` | `(breaks[0].stars, out-of-range)` |
| `stars-3.json` | `stars: 3` | `(breaks[0].stars, out-of-range)` |
| `stars-400-4.json` | `stars: 400.4` | `(breaks[0].stars, out-of-range)`: range is tested on the raw value |
| `stars-fraction.json` | `stars: 120.5` | `(breaks[0].stars, not-integer)` |
| `stars-string.json` | `stars: "120"` | `(breaks[0].stars, type)` |
| `stars-bool.json` | `stars: true` | `(breaks[0].stars, type)` |
| `break-numbers-strings.json` | all 7 break numerics as strings | 7 × `type` |
| `break-numbers-out.json` | `speed` 405, `changeAt` 0.96, `burn` 5.1, `drag` −0.01, `size` 0.39, `delay` 2.55 | 6 × `out-of-range` |
| `break-numbers-out-other-side.json` | `speed`, `changeAt`, `burn`, `delay` below their minimums; `drag`, `size` above their maximums | 6 × `out-of-range` |
| `burst-height-high.json` | `burstHeight: 0.8500000000000001` | `(burstHeight, out-of-range)` |
| `burst-height-low.json` | `burstHeight: 0.29` | `(burstHeight, out-of-range)` |
| `burst-height-infinite.json` | `burstHeight: 1e400` | `(burstHeight, type)` |
| `angle-jitter-21.json` | `angleJitter: 21` | `(angleJitter, out-of-range)` |
| `angle-jitter-negative.json` | `angleJitter: -1` | `(angleJitter, out-of-range)` |
| `angle-jitter-null.json` | `angleJitter: null` | `(angleJitter, missing)` |
| `gravity-39.json` | `sky: { gravity: 39, wind: 0 }` | `(sky.gravity, out-of-range)` |
| `gravity-401.json` | `sky.gravity: 401` | `(sky.gravity, out-of-range)` |
| `wind-81.json` | `sky: { gravity: 160, wind: 81 }` | `(sky.wind, out-of-range)` |
| `wind-minus-81.json` | `sky.wind: -81` | `(sky.wind, out-of-range)` |

**Shell: names**

| File | Change | Expected |
|---|---|---|
| `name-200.json` | 200 ASCII characters | `(name, too-long)` |
| `name-81-astral.json` | 81 emoji | `(name, too-long)` |
| `name-empty.json` | `""` | `(name, missing)` |
| `name-blank.json` | `"   "` | `(name, missing)` |
| `name-missing.json` | no `name` | `(name, missing)` |
| `name-number.json` | `name: 123` | `(name, type)` |
| `name-leading-space.json` | `" Peony"` | `(name, name-format)` |
| `name-trailing-newline.json` | `"Peony\n"` | `(name, name-format)` |
| `name-tab.json` | `"Pe\tony"` | `(name, name-format)` |
| `name-nul.json` | `"Pe\u0000ony"` | `(name, name-format)` (Postgres can't store it) |
| `name-only-controls.json` | `"\u0000\u0001"` | `(name, missing)`: one issue, `missing` wins |
| `name-bom.json` | `"﻿Peony"` | `(name, name-format)` (C# `Trim()` would miss this) |
| `name-nel.json` | `"\u0085Peony"` | `(name, name-format)` |
| `name-lone-surrogate.json` | `"Pe\ud800ony"` | `(name, name-format)` |
| `name-long-and-padded.json` | `" "` + 85 ASCII characters | `(name, too-long)`: one issue, `too-long` beats `name-format` |

**Shell: several at once**

| File | Change | Expected |
|---|---|---|
| `mixed.json` | `version: 99`, `stars: 401`, `"foo": 1` | `(version, version)`, `(breaks[0].stars, out-of-range)`, `(foo, unknown-property)`: errors and adjustments are both reported |

**Show**

Base: `valid/show/minimal.json` with one change.

| File | Change | Expected |
|---|---|---|
| `show-version-2.json` | `version: 2` | `(version, version)` |
| `show-sky-missing.json` | no `sky` | `(sky, missing)` |
| `show-duration-missing.json` | no `duration` | `(duration, missing)` |
| `show-duration-601.json` | `duration: 601` | `(duration, out-of-range)` |
| `show-duration-0.json` | `duration: 0` | `(duration, out-of-range)` |
| `show-never-persisted.json` | root `mode: "show"` | `(mode, unknown-property)` |
| `show-name-blank.json` | `name: " "` | `(name, missing)` |
| `show-sky-empty.json` (new) | `sky: {}` | `(sky.gravity, missing)`, `(sky.wind, missing)`: no defaults in a show's sky (§6.2 rule 9) |
| `shells-not-object.json` | `shells: []` | `(shells, not-object)` only: `unknown-shell` is not checked when `shells` wasn't walked (§6.2.8) |
| `shells-missing.json` (new) | no `shells` | `(shells, missing)` only, no `unknown-shell` |
| `shells-null.json` (new) | `shells: null` | `(shells, missing)` only |
| `shells-33.json` | 33 shells | `(shells, shell-count)` only |
| `shell-keys-two-bad.json` (new) | extra keys `"1abc"` and `"a b"` beside `s1` | 2 × `(shells, key-format)` |
| `cue-names-bad-key.json` (new) | extra key `"1abc"` beside `s1`; the cue's `shell` is `"1abc"` | `(shells, key-format)`, `(cues[0].shell, unknown-shell)` |
| `embedded-version-2.json` (new) | embedded shell has `version: 2` | `(shells.s1.version, version)` |
| `embedded-sky-bad-values.json` (new) | embedded shell has `sky: { gravity: 9999, wind: "x" }` | `(shells.s1.sky, unknown-property)` only |
| `shell-key-proto.json` | an extra key `"__proto__"` beside `s1` (write the file by hand: an object literal or spread in a generator would set the prototype instead of a key) | `(shells, key-format)` |
| `shell-key-digit.json` | key `"1abc"` | `(shells, key-format)` |
| `shell-key-13.json` | 13-character key | `(shells, key-format)` |
| `embedded-sky.json` | embedded shell has `sky` | `(shells.s1.sky, unknown-property)` |
| `embedded-version-missing.json` | embedded shell has no `version` | `(shells.s1.version, missing)` |
| `embedded-stars.json` | embedded `stars: 401` | `(shells.s1.breaks[0].stars, out-of-range)` |
| `embedded-not-object.json` | embedded shell `s1` is a number | `(shells.s1, not-object)` only: `s1` is still in the key set, so the cue raises no `unknown-shell` |
| `cues-not-array.json` | `cues: {}` | `(cues, cue-count)` |
| `cues-missing.json` (new) | no `cues` | `(cues, cue-count)`: same as `[]` |
| `cues-null.json` (new) | `cues: null` | `(cues, cue-count)` |
| `cues-empty.json` | `cues: []` (the minimal show's shell kept, now unreferenced) | `(cues, cue-count)` only (Q4) |
| `show-empty.json` | 0 shells, 0 cues (moved here from valid, Q4) | `(cues, cue-count)` only: no cue means no `unknown-shell` and no shell rule fires |
| `cues-1001.json` | 1001 cues | `(cues, cue-count)` |
| `cue-not-object.json` | `cues: [1]` | `(cues[0], not-object)` |
| `cue-empty.json` | `cues: [{}]` | `(cues[0].id, missing)`, `(cues[0].t, missing)`, `(cues[0].shell, missing)`, `(cues[0].x, missing)`, `(cues[0].seed, missing)` |
| `cue-unknown-key.json` | cue has `"color": "red"` | `(cues[0].color, unknown-property)` |
| `cue-id-format.json` | `id: "c 1"` | `(cues[0].id, key-format)` |
| `cue-id-duplicate.json` | three cues, all `id: "c1"` | `(cues[1].id, duplicate-id)`, `(cues[2].id, duplicate-id)` |
| `cue-id-duplicate-later.json` (new) | ids `c1`, `c2`, `c1` | `(cues[2].id, duplicate-id)` only: the first occurrence is clean |
| `cue-id-format-twice.json` (new) | two cues, both `id: "c 1"` | `(cues[0].id, key-format)`, `(cues[1].id, key-format)`, no `duplicate-id` |
| `cue-id-number.json` (new) | `id: 5` | `(cues[0].id, type)` only |
| `cue-shell-number.json` (new) | `shell: 5` | `(cues[0].shell, type)` only, no `unknown-shell` |
| `cue-unknown-shell.json` | `shell: "s9"` | `(cues[0].shell, unknown-shell)` |
| `cue-shell-constructor.json` | `shell: "constructor"` | `(cues[0].shell, unknown-shell)` (prototype-key trap, §6.6) |
| `cue-t-negative.json` | `t: -0.1` | `(cues[0].t, out-of-range)` |
| `cue-t-past-duration.json` | `duration: 10`, `t: 10.5` | `(cues[0].t, out-of-range)` |
| `cue-x-high.json` | `x: 1.01` | `(cues[0].x, out-of-range)` |
| `cue-x-negative.json` | `x: -0.01` | `(cues[0].x, out-of-range)` |
| `cue-burst-height-null.json` | `burstHeight: null` | `(cues[0].burstHeight, missing)` |
| `cue-burst-height-high.json` | `burstHeight: 0.9` | `(cues[0].burstHeight, out-of-range)` |
| `cue-burst-height-low.json` | `burstHeight: 0.29` | `(cues[0].burstHeight, out-of-range)` |
| `cue-seed-fraction.json` | `seed: 1.5` | `(cues[0].seed, not-integer)` |
| `cue-seed-overflow.json` | `seed: 2147483648` | `(cues[0].seed, out-of-range)` |
| `cue-seed-underflow.json` | `seed: -2147483649` | `(cues[0].seed, out-of-range)` |
| `cue-seed-string.json` | `seed: "1"` | `(cues[0].seed, type)` |

### 12.4 Server-only (C# harness; TS skips this folder)

| File | Body | Expected |
|---|---|---|
| `not-json.json` | `{"kind":"shell","document":{` | 400 `("", not-json)` |
| `duplicate-key.json` | the Peony preset with `"stars"` twice in break 0 | 400 `(breaks[0].stars, duplicate-key)` (path reported relative to the document) |
| `not-utf8.json` (new) | a valid shell body with one raw `0xFF` byte inside the name (the `body` string can't hold it: the harness builds it from `body`, replacing the `byteMarkers` entry `@@byte:ff@@` with the raw byte; see `schema/README.md`) | 400 `("", not-json)` |
| `empty-body.json` (new) | `""` | 400 `("", not-json)` |
| `body-not-object.json` (new) | `[]` | 400 `("", not-object)` |
| `duplicate-key-three.json` (new) | `"stars"` three times in break 0 | 400 `(breaks[0].stars, duplicate-key)`, once |
| `duplicate-key-last-wins.json` (new) | `"stars": 120` then `"stars": 401` | 400 `(breaks[0].stars, duplicate-key)`, `(breaks[0].stars, out-of-range)` |
| `duplicate-key-unknown.json` (new) | `"foo": 1` twice at the document root | 400 `(foo, duplicate-key)`, `(foo, unknown-property)` |
| `duplicate-key-inside-unknown.json` (new) | `"foo": {"a": 1, "a": 2}` at the document root | 400 `(foo, unknown-property)` only: an unknown value isn't walked |
| `duplicate-key-escaped.json` (new) | `"stars"` and `"stars"` in break 0 | 400 `(breaks[0].stars, duplicate-key)` |
| `duplicate-shell-key.json` (new) | show with `"s1"` twice in `shells` | 400 `(shells.s1, duplicate-key)` |
| `duplicate-key-envelope.json` (new) | `"kind": "shell"` twice, and a document with `stars: 401` | 400 `(kind, duplicate-key)` only: the document isn't walked (§2.6) |
| `kind-unknown.json` | `kind: "gallery"` | 400 `(kind, enum)` |
| `kind-missing.json` (new) | no `kind` | 400 `(kind, missing)` |
| `kind-number.json` (new) | `kind: 1` | 400 `(kind, enum)` |
| `document-not-object.json` | `document: 5` | 400 `(document, not-object)` |
| `document-missing.json` (new) | no `document` | 400 `(document, missing)` |
| `document-null.json` (new) | `document: null` | 400 `(document, missing)` |
| `envelope-unknown.json` (new) | an extra `"owner": "x"` beside a valid shell | 400 `(owner, unknown-property)` |
| `envelope-and-document.json` (new) | `kind: "gallery"` and a document with `stars: 401` | 400 `(kind, enum)` only |
| `kind-mismatch.json` | `kind: "shell"` with `valid/show/minimal.json` as the document | 400 `(duration, unknown-property)`, `(shells, unknown-property)`, `(cues, unknown-property)`, `(burstHeight, missing)`, `(angleJitter, missing)`, `(breaks, break-count)`. The show's `sky` is a valid shell `sky`, so it raises nothing. |
| `oversize.json` | 300 KiB of valid JSON whitespace around a valid shell | 413 |
| `wrong-content-type.json` (new) | a valid shell body sent as `text/plain` (`"contentType": "text/plain"` field on this fixture; the harness sends `application/json` unless a fixture says otherwise) | 415 |

Rows marked (new) were settled on 2026-11-13 from Bowser's probes and Toad's and Luigi's questions; all are generated by `schema/tools/generate-fixtures.mjs` (record `toad-phase3-server-only-wire-fields.md`).

### 12.5 Lenient-only rules (TS unit specs, not shared fixtures)

The server has no lenient mode, so these live in `normalize.spec.ts`, not in `schema/fixtures/`. Each asserts the lenient result (`ok`, and the adjustment kind when ok):

| Input (minimal show plus one change) | Lenient result |
|---|---|
| `seed: 1.5`, `seed: 2147483648`, `seed: -2147483649` | `ok: false` (hard error), never a `rounded` or `clamped` adjustment |
| cue without `id`, `t`, `shell`, `x` or `seed` | `ok: false` |
| show `sky: {}` | `ok: false` (no `DEFAULT_SKY` fill in a show) |
| `duration: 601`, cue `t: -1`, `x: 1.5`, `burstHeight: 0.9` | `ok: true` with a `clamped` adjustment at each path |
| shell `sky: null`, cue `burstHeight: null` | `ok: true`, a `defaulted` adjustment, and the key absent from the result |

---

## 13. Phase 6 inheritance

- **Driver seams** (2a record point 8, unchanged): `PlaybackDriver.beforeStep?(ctx, step)` called inside the fixed-step loop with an integer counter the loop owns; `PlaybackContext.fireSeeded(def, tx, ty, seed)`; `effectiveSky(shell, showSky?)`. `TimelineCue` (`timeline-driver.ts`) changes `burstHeight: number | null` to an optional `burstHeight?: number` to match §4.3.
- **What the schema gives the driver:** `t` at any double precision, resolved by §4.4's `Math.round(t * 120)`; one int32 seed per cue; a total firing order by `(fireStep, id)`.
- **Seek bound.** A cue's particles are all dead about 21 s after it fires at the current limits: rise ≤ √(2 × 0.85 × 760 / 40) ≈ 5.7 s, plus delays ≤ 3 × 2.5 = 7.5 s, plus burn ≤ 5 s with its size and drag tail (≈ 5.6 s), plus the crossette or glitter child tail (≈ 2.2 s). The formula depends on `SKY_LIMITS.gravity.min`, `SHELL_LIMITS.burstHeight.max`, `BREAK_LIMITS.delay.max`, `MAX_BREAKS` and `BREAK_LIMITS.burn.max`; changing any of them means recomputing it. **Caveat:** the bound is exact only while the 40k cap isn't reached. When it is, a cue fired more than 21 s before the seek target can still have changed how many stars a later cue got. So "fast-forward from T − 21 s" is not exactly "re-run from 0"; Phase 6 chooses between checkpointed snapshots and accepting the difference (Toad's determinism checks decide).
- **"Plays the same in two browsers"** (Phase 6 Done-when) covers the whole run, launch window plus tail (§4.5), and holds at equal `starBudget` (never persisted, §7) and in world-fraction terms: wind drifts in absolute units, so on a narrower window a shell drifts further relative to the width. The player should play shows at `starBudget` 1 unless Phase 7's automatic quality rules otherwise.

---

## 14. Rulings (Skyler, 2026-11-13)

| # | Question | Ruling | Where it lands |
|---|---|---|---|
| Q1 | Does a cue's `t` mean launch or burst? | **Launch time.** | §4.3 |
| Q2 | Does a saved link promise to play the same forever? | **No. Share links are not locked.** Improvements may change how existing links play; goldens are regression guards updated by reviewed change; version bumps are for document-shape changes only. | §4.4, §8.1 |
| Q3 | Who can see `remixedFrom`? | **Only the remix's owner**; everyone else gets `null`. | §2.1 |
| Q4 | Can an empty show be saved; are the caps right? | **No empty shows**: at least 1 cue. Caps of 32 shells, 1000 cues and 600 s accepted. | §4, §5.1, §6.2, §6.3, §12 |
| Q5 | Blank name on save: block, or "Custom"? | **Save as "Custom".** | §6.4 |
| L1 | What does a link open? (Peach F3, F8) | **Never the saved record for editing.** Always a new, unsaved (dirty) form with exactly the saved settings: a working copy. | §11.1, §11.2 |
| L2 | What does Save do on a working copy? (Peach Q1, F3) | **Owned source:** "Update original" (PUT, changes what the share link plays) or "Save as new". **Otherwise:** a new creation with `remixedFrom` set to the source. No edit-in-place route; Remix just opens the working copy. | §2.3, §11.1, §11.4, §11.5 |
| L3 | Opening a link over unsaved changes? (Peach Q2, F5) | **Ask first, only when the shell or sky is dirty** (same rule as Apply with `sky`). | §11.3 |
| L4 | Does a show stop at `duration`? (Peach Q3, F7) | **No. A show runs until the last particle fades.** `duration` is the launch window only; a cue at `t == duration` is valid and its burst is seen. | §4, §4.5, §6.2 rule 9 |

Boo still reviews the 256 KiB request limit (§2.5) and the `remixedFrom` rule in the Phase 4 and Phase 5 security reviews.

---

## 15. Changes this document asks for elsewhere

None of these are made by this document; each names its owner. F-numbers are Peach's (`acceptance/phase-3.md`).

**Done in Phase 3 (2026-11-13):**
- **Luigi:** walker exposes errors and adjustments together; `cleaned` kind and the §6.4 name pipeline; the §6.3 codes; `normalizeShow`; `validate.ts`; `upgrade.ts`; show and cue rows in `limits.ts`; `limits.spec.ts`; the fixture runner (`schema-fixtures.spec.ts`); prototype-safe maps (§6.6) (`luigi-phase3-ts-validator.md`). Bracket paths in `dropUnknown` (§6.2 rule 11; `normalize.ts` l.676–724). The §12.5 lenient specs (`normalize.spec.ts`, `describe('normalizeShow, lenient-only rules (schema.md §12.5)')`).
- **Toad:** `schema/limits.json` and every fixture in §12, including the rows marked (new), with negative controls (`toad-phase3-shared-fixtures.md`). Peach diffed §12 against the disk: nothing missing, nothing extra.
- **Yoshi:** plan §3.3 and Phases 3–6 match this document; `context.md` l.25 says `burstHeight` is 0.3..0.85 of the ground height.

**Phase 4:**
- **Bowser:** `JsonElement` walker instead of DTO deserialization with `Disallow`; 256 KiB request limit; structured 400 body; remix takes `{ document }`; `palette` column computed at write; the §2.6 envelope walk with a manual body read and `[Consumes]`; walker-detected duplicate keys (§6.2 rule 12); the §6.5 surrogate, UTF-8, `IsFinite` and `\z` rules; `CreationLimits.cs` checked against `limits.json`; the §2.2.1 paging contract (`CreationListPage`, the `kind` filter, the three-column index); whether `.dockerignore` lists `schema/` (§6.6). The probes are done (`bowser-phase3-validator-feasibility.md`).
- **Boo (security review):** the 256 KiB number, the manual body read, and Kestrel's global `MaxRequestBodySize` (§2.5).

**Phase 5:**
- **Luigi:** wire `upgradeShell` into draft restore and JSON Apply (§8.3; Peach F6, F14); `/c/:code` as load-then-redirect, the draft `source`, the §11.3 confirm and the §11.4 Save table; the stubbed non-owner call-ledger spec (§11.5).
- **Rosalina (design-review):** copy for the new codes in `issueReason`; whether `cleaned` appears in the Apply note; `missing` on an optional field meaning "remove the `null`" (§6.2 rule 13); how the Update original / Save as new choice is presented (§11.4).
- **F10, Rosalina (design-review brief):** copy for Save-time failures, none of which `issueReason` covers: a 400 on Save (a stale tab can reach it, §8.1), 403 (writes switched off mid-session), 404 on Update original (the original was deleted or isn't yours; offer Save as new, §11.2), 413, 429 (rate limited), and the upgrade error "newer than this app; reload" (§8.2).
- **F4, Rosalina and Luigi:** whether a successful Save clears `shellDirty`/`skyDirty`, and what the Phase 5 dirty indicator means (the flags today mean "changed since the last preset, Apply or link load", the replace-confirm rule). L1 settles the load half: a link load sets both (§11.2). Peach writes the criterion once they decide.
- **F11, Luigi (by Phase 6 at the latest):** `issueReason` renders a `type` issue with `options: ['integer']` (cue `seed`, `normalize.ts` l.566) as "must be text"; integer needs its own wording.
- **F12, Rosalina and Luigi:** `unknownKeyName` (`designer-copy.ts`) matches only `breaks[n].name`, so §6.2 rule 11 bracket paths (`["a.b"]`, `breaks[0]["a\"b"]`) show raw in the Apply note. Rosalina decides how an unprintable key reads; Luigi builds it.

**Phase 6:**
- **Mario and Rosalina (planning):** the Show Builder's route and its own draft, with show links going through `/c/:code` (§11.1; Peach F8). The timeline draws the tail past `duration` (§4.5). "My shells" follows the write switch like `/mine` and calls the list with `kind=shell` (Peach F9, §2.2.1).
- **Toad:** the `cue-at-duration.json` burst is seen in the playback check (§4.5).

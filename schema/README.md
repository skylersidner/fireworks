# schema/

The shared test data for the creation schema (`docs/fireworks-app/schema.md`, the contract). Both the TypeScript engine and the C# API validate documents against it, and both read these files, so the two validators are checked against one source of truth instead of against each other.

## Contents

| Path | What |
|---|---|
| `limits.json` | A mirror of the schema.md §5.1 table: every range and count as `{ min, max, integer }`. `cue.t.max` is the string `"show.duration"`. The source is `src/web/fireworks-web/src/engine/model/limits.ts`. |
| `fixtures/valid/{shell,show}/` | Documents that strict validation must accept with zero issues (and the API with 201). |
| `fixtures/invalid/{shell,show}/` | Documents that must produce exactly their `errors` (and 400). |
| `fixtures/server-only/` | Wire-level cases that `JSON.parse` can't represent (bad JSON, invalid UTF-8, duplicate keys, request-envelope errors, oversize, a wrong `Content-Type`). The C# harness only. |
| `fixtures/upgrade/` | Empty in v1. |
| `tools/generate-fixtures.mjs` | Writes every fixture. `--check` fails if the files on disk differ. |

## Fixture format

```jsonc
// valid/ and invalid/
{ "description": "stars above the maximum", "kind": "shell", "document": { … },
  "errors": [ { "path": "breaks[0].stars", "code": "out-of-range" } ] }   // invalid/ only

// server-only/
{ "description": "…", "body": "<raw request text>", "status": 400, "errors": [ … ] }  // errors only for 400
{ "description": "…", "contentType": "text/plain", "body": "…", "status": 415 }      // contentType only for 415
{ "description": "…", "body": "…@@byte:ff@@…", "byteMarkers": { "@@byte:ff@@": "ff" }, "status": 400, "errors": [ … ] }
```

- `errors` is the **complete multiset** of `(path, code)`, sorted by path and then code. Compare it exactly: nothing missing, nothing extra. Paths are relative to the document, and the root is `""`.
- `{ kind, document }` is a valid `POST api/creations` body as it stands.
- An invalid fixture is the Peony preset (shells), or `valid/show/minimal.json` (shows), with one change.
- Every non-ASCII character is written as a `\u` escape. A few files keep number text that `JSON.stringify` can't produce: `1.0` and `1e2` in `valid/shell/number-forms.json`, `1e400` in `invalid/shell/burst-height-infinite.json`, `1293847.0` in `valid/show/seed-extremes.json`, and the own key `"__proto__"` in `invalid/show/shell-key-proto.json`. Don't re-save these files through a JSON tool.
- Paths follow schema.md §6.2 rule 11. A name matching `^[A-Za-z_][A-Za-z0-9_-]*$` is written plainly (`breaks[0].stars`); any other name is written `["name"]`, with only `\` and `"` escaped and each unpaired surrogate written as U+FFFD (`["a.b"]`, `[""]`, `breaks[0]["a\"b"]`, `breaks[0]["st\ufffdars"]` in the file). A document may hold an unpaired surrogate (`name-lone-surrogate`, `unknown-key-lone-surrogate`); an expected path never does.
- `valid/show/at-maximums.json` is written compact. As a compact `{kind, document}` body it is 189,359 B as UTF-8 and 210,479 B with `\u` escapes, against the 262,144 B (256 KiB) request limit.

## The C# harness (Phase 4)

How `CreationApiHarness` turns a fixture into a request and checks the response:

- **valid/ and invalid/**: `POST api/creations` with `Content-Type: application/json` and the body `{"kind":<kind>,"document":<raw>}`, where `<raw>` is `GetRawText()` of the fixture's `document`. Never re-serialize it: that would lose `1.0`, `1e2`, `1e400` and the own `__proto__` key, and `GetString` throws on the documents that hold an unpaired surrogate. Expect 201 for valid/; for invalid/ expect 400 and compare the body's `errors` as a `(path, code)` multiset, exactly.
- **The one translation (schema.md §12.1):** `invalid/shell/root-array.json` and `invalid/shell/root-string.json` expect `("", not-object)` from the validators, but over HTTP they expect **`(document, not-object)`**, because the envelope walk (§2.6 step 5) rejects a non-object `document` before any validator runs. The validators keep giving `("", not-object)`, and the fixtures keep saying so. No other fixture is translated.
- **server-only/**: post `body` as is (it is the whole request text, envelope included), and expect `status`; for a 400, compare `errors` exactly. Envelope issues are at envelope paths (`kind`, `document`, `owner`), document issues relative to the document.
  - **`Content-Type`** is `application/json` unless the fixture has `contentType`, which is sent instead. Only `wrong-content-type.json` (415) has one. It's a fixture field rather than a harness-only case so that every wire case lives in one folder the harness iterates, and so the format spec checks it (present exactly on the 415, never `application/json`, body otherwise valid).
  - **`byteMarkers`** maps an ASCII marker in `body` to hex bytes. Encode `body` as UTF-8, then replace each marker's bytes with the listed bytes. Only `not-utf8.json` has one: `@@byte:ff@@` becomes a single raw `0xFF` inside the name. A JSON string can't hold that byte, and the fixture file itself stays valid UTF-8. The format spec checks that the body parses as text (so the byte is the only defect) and that the built bytes fail a strict UTF-8 decode.
  - **Duplicate keys** are plain text in `body` (`"stars":120,"stars":401`), which `JSON.parse` silently collapses. Read `body` as a string and send its bytes; never round-trip it through a JSON DOM. The format spec scans each body and checks that the names repeated in one object are exactly the names its `duplicate-key` errors point at (`duplicate-key-inside-unknown` repeats `a` inside an unknown value and expects no `duplicate-key`; `duplicate-key-escaped` spells the repeat `st\u0061rs`).
  - `empty-body.json` sends zero bytes with `Content-Type: application/json`.

## Who reads it

- **TypeScript** (Vitest, under `npm test` in `src/web/fireworks-web`):
  - `engine/model/schema-fixtures.spec.ts` runs `validateShell`/`validateShow` on every valid and invalid fixture.
  - `engine/model/schema-fixtures-format.spec.ts` checks the files themselves: the layout, the keys, `kind`, `errors` exactly under `invalid/`, rule 11 paths, codes from schema.md §6.3, presets, boundaries, the max-show size, and the server-only wire details (`byteMarkers`, `contentType`, repeated names).
  - `engine/model/limits.spec.ts` checks `limits.ts`, `limits.json` and the schema.md table against each other.
- **C#** (Phase 4, `dotnet test`): the validator tests and the `CreationApiHarness` post each fixture and expect 201 or 400 with the same multiset. `server-only/` posts `body` as raw text. `CreationLimits.cs` is checked against `limits.json`.

## Changing a fixture

Edit the tables in `tools/generate-fixtures.mjs` and run it (with Node 26 first on PATH, and `npm ci` done in `src/web/fireworks-web`). Don't hand-edit the output. Take expected `errors` from schema.md, **never from a validator's output**.

**A fixture change is a schema change. It needs the matching validator change on both sides (TS `validate.ts` and the C# validator) in the same change**, plus a schema.md update. A limit change also touches `limits.ts`, the §5.1 table, `limits.json` and `CreationLimits.cs` together (§5.2).

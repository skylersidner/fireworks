---
name: cross-language-validator-parity
description: How to specify (or review) one document validator implemented twice, in TypeScript and C#, so both accept and reject exactly the same inputs with the same paths and codes.
---

# One validator, two languages

Origin: Phase 3 schema (`docs/fireworks-app/schema.md` §6, record `yoshi-phase3-creation-schema.md`).

## Checklist
1. **One walk, two modes.** Lenient (fix and report adjustments) and strict (valid only with zero adjustments; each adjustment kind maps to one error code). The walker must return errors and adjustments together, or strict mode loses adjustments whenever a hard error exists.
2. **Fixtures carry the complete expected multiset of `(path, code)`**, not "contains an error at X". Then specify where the walk stops (root not an object, a count error on an array, a non-object element, a type error): if the two sides skip different subtrees, their multisets differ.
3. **Hunt the language traps; each one gets a fixture:**
   - Integers by value: C# `TryGetInt32` rejects `1.0`, and an `int` DTO property throws on it. Read doubles and test integrality.
   - Non-finite: `1e400` is `Infinity` in JS, and STJ `TryGetDouble` returns **true** with `Infinity` (measured, .NET 11). Check `double.IsFinite` explicitly. Both should be `type`.
   - Range before integrality: test the range on the raw value (`400.4` is out of range, not "not an integer").
   - Rounding: C# `Math.Round` is banker's; JS `Math.round` rounds half up. Keep rounding out of the server entirely.
   - Trim: C# `string.Trim()` uses `char.IsWhiteSpace` (misses U+FEFF, adds U+0085). Use an explicit set on both sides.
   - Length: JS `.length` and HTML `maxlength` count UTF-16 units; count code points (`Array.from`) and runes, after removing unpaired surrogates.
   - Postgres `jsonb` rejects `\u0000` and doesn't keep key order. Clean strings; never give key order meaning; compare parsed JSON in tests, not bytes.
   - Duplicate keys: `JSON.parse` keeps the last silently. Only the server can reject them: a server-only fixture folder.
   - Duplicate keys in C#: `AllowDuplicateProperties = false` throws a `JsonException` with no path. Parse with defaults (`EnumerateObject` yields both) and detect them in the walker, walking the last value like `JSON.parse`.
   - Unpaired surrogates and invalid UTF-8 in C#: `JsonDocument.Parse` accepts both; `GetString()`, `JsonProperty.Name` and sometimes `ValueEquals` throw `InvalidOperationException`. Gate the body with `Utf8.IsValid`, wrap `ValueEquals`, and give names a raw-token fallback.
   - Regex anchors: .NET `$` matches before a final `\n` (`"s1\n"` passes `^...$`, and so does a route constraint). Use `\z` in C#; JS `$` is fine.
   - Model binding: `[FromBody] JsonElement` returns MVC's ProblemDetails for bad JSON and lets invalid UTF-8 through. Read the body yourself when the error shape is a contract.
   - Prototype keys: a map keyed by user strings needs `Object.create(null)` or `Map`, and membership by `Object.hasOwn` (`"constructor"`, `"__proto__"`).
   - Paths built from user-supplied property names: `""`, `"a.b"` and lone surrogates make `parent.name` ambiguous or unserializable. Pick one tiny escaping rule both sides implement by hand (here: plain if `^[A-Za-z_][A-Za-z0-9_-]*$`, else `["…"]` with only `\\` and `\"` escaped and lone surrogates as U+FFFD). Never "use the JSON serializer": `JSON.stringify` and STJ escape differently.
4. **Don't validate by deserializing into DTOs** when paths and codes must match: STJ stops at the first unknown member and reports its own paths. Walk `JsonElement`, then build the DTO from the walk.
5. **Limits: one source, one mirror, checked from every side.** A JSON mirror that the TS spec, the C# test and the doc table are each compared with, plus boundary fixtures at min, max and just outside, so a validator that ignores its constants still fails.
6. **Derived columns are computed at write time** so the server never has to parse old stored versions.
7. **Settle every edge as a `(path, code)` pair, not a sentence.** Absent vs `null` vs empty for each collection, how many issues a repeated problem gives (per name, per occurrence), and what a cross-reference does when its target was rejected. Each one becomes a fixture; an edge without a fixture will be decided differently by each implementer.
8. **Wrapper and payload errors never mix.** If an envelope (`{kind, document}`) has any issue, don't walk the payload: their paths share a namespace (`kind` can be both). Then write down the one place the harness must translate a payload-level error into an envelope-level one (a non-object payload).
9. **Lenient-only rules can't be seen by strict fixtures.** If lenient "round" and lenient "refuse" both map to the same strict code, cover the rule with a unit spec on the lenient walker.

## Implementation notes (TS side, Phase 3)
- Fixture runner: `engine/model/schema-fixtures.spec.ts`. It guards against a vacuous pass (both groups and both kinds must be present), checks folder kind against the file's `kind`, and compares sorted `"path :: code"` ledgers.
- Negative controls worth keeping: walker drops adjustments on error (killed by `mixed.json`), plain-object `in` membership (`cue-shell-constructor.json`), `MIN_SHOW_CUES = 0` (limits drift and `cues-empty.json`), and a validator that always says ok (78 failures).
- A "use `String.prototype.trim`" mutant is **equivalent in JS**, so TS tests can't kill it. The explicit trim set only matters for the C# side; its fixtures (`name-bom`, `name-nel`) are the C# controls.

## Writing the fixtures (Toad, Phase 3)
- Generate them from one script with a `--check` mode, and read presets and limits from their sources so boundary and preset fixtures can't drift. Splice in what `JSON.stringify` can't write (`1.0`, `1e400`, an own `"__proto__"` key) with sentinel strings, then assert in a spec that the text survived.
- `\u`-escape every non-ASCII character so U+FEFF, U+0085 and lone surrogates survive editors and diffs.
- Transcribe expected errors from the spec doc. Shape-check the files in their own spec (folder layout, exact keys, `errors` exactly under `invalid/`, codes parsed from the doc's code table, every code used at least once). A runner can't be its own shape check.
- **Wire cases that a JSON fixture file can't hold** (Phase 3 follow-up): keep them in the one server-only folder with a small, explicit escape hatch, and shape-check each hatch. Here: `byteMarkers` (an ASCII marker in `body` becomes raw bytes, for invalid UTF-8; the spec checks the text parses and the built bytes fail `TextDecoder('utf-8', { fatal: true })`), and `contentType` (only on the 415). Duplicate keys are plain text in `body`; the format spec runs a tiny repeated-name scanner over each body, because `JSON.parse` hides them, and compares the repeated names with the `duplicate-key` paths.
- Every generator splice goes through a `spliceOnce` that throws unless the target occurs exactly once. A no-op splice otherwise produces a fixture that silently tests nothing.
- Mutating the generator for negative controls: check that the mutant text is unique in the file *before* writing, or the reverse swap can't find its way back (`'"stars":120,'` occurs six times).

## Gating the fixtures (Mario, Phase 3 gate)

- **Independence check:** print each sampled fixture's `document` with `errors` deleted, derive the `(path, code)` multiset from schema.md §6.2/§6.3/§6.4 (and §2.6 for server-only), write it down, then print the fixture's `errors` and compare. Sample across shell, show and server-only, and include the skip rules (unknown value not walked, breaks over count, envelope-before-document) and a cross-kind case (`kind-mismatch`), where hand derivation is most error-prone.
- **Verify the verifiers in a scratch copy:** copy `schema/`, `docs/fireworks-app/schema.md` and the web project (symlink `node_modules`) so the repo-relative paths (`cwd/../../..`) still resolve; then (a) edit one fixture and add one extra file and confirm `generate-fixtures.mjs --check` exits 1 for each, (b) change one value in each of `limits.ts`, `limits.json` and the §5.1 table and confirm `limits.spec.ts` fails, (c) mutate the validator (e.g. keep `sky` in `EMBEDDED_SHELL_KEYS`) and confirm exactly the matching fixtures fail.
- **Derive the fixture set from §12's tables**, not from the folder: extract first-column names and `comm` them against disk basenames.

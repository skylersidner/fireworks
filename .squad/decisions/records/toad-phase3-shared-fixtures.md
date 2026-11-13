# Phase 3 shared fixtures: generated, transcribed from the doc, shape-checked separately

**Author:** Toad · **Date:** 2026-11-13 · **Status:** proposed

## What

1. Every file under `schema/fixtures/` is written by `schema/tools/generate-fixtures.mjs`; `--check` fails when the disk differs or has extra files. Nobody hand-edits a fixture or re-saves one through a JSON tool (some files keep number text and an own `__proto__` key that `JSON.stringify` can't produce).
2. Expected `errors` are transcribed from `docs/fireworks-app/schema.md`, never copied from a validator's output. Each is the complete `(path, code)` multiset, sorted by path then code.
3. `server-only/` fixtures are `{ description, body, status, errors? }`: `body` is the raw request text, `status` is 400 or 413, `errors` is present exactly for 400. They have no top-level `kind`.
4. Fixture shape is checked by its own spec (`engine/model/schema-fixtures-format.spec.ts`), separate from the validator runner (`schema-fixtures.spec.ts`), and the code vocabulary comes from the schema.md §6.3 table, not from the TS code union.
5. Boundary coverage follows §5.2 item 4 literally: every numeric field has a just-outside fixture on both sides. That added fixtures beyond the §12 list: `version-bool`, `break-numbers-out-other-side`, `angle-jitter-negative`, `gravity-401`, `wind-minus-81`, `embedded-not-object`, `cue-x-negative`, `cue-burst-height-low`, `cue-seed-underflow`, and valid `show/at-minimums`.

## Why

- A malformed fixture misleads the TS runner and the C# harness the same way, so a runner can't be its own shape check. The format spec's negative controls (17, all caught) include cases the runner can't see: `errors` added to a valid fixture, a preset drifting from `presets.ts`, a boundary drifting from `limits.json`, and an oversize body that's no longer oversize.
- Copying a validator's output makes fixtures agree with that validator by construction. With the expectations transcribed, Luigi's validator passing all 134 fixtures on its first run is real evidence.

## Boundary

- Binds anyone changing `schema/fixtures/**`, and Bowser's C# harness (the `server-only` format).
- Changing a fixture is a schema change. It needs the matching validator change on both sides and a schema.md update in the same change.

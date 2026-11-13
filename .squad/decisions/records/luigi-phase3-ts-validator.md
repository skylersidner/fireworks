# Phase 3 TS validator: result shape, show walk choices

**Author:** Luigi · **Date:** 2026-11-13 · **Status:** proposed

## What
1. `normalizeShell`/`normalizeShow` always return `adjustments`, on both branches. `ok: false` keeps `errors`. Callers that only read `errors` are unaffected.
2. `validateShell`/`validateShow` (`engine/model/validate.ts`) return `{ ok: true, document } | { ok: false, errors }`, where `errors` is hard errors plus every adjustment mapped by `STRICT_CODE`.
3. Choices the schema doc leaves open, which the C# walker must copy: `shells` absent or `null` is a hard `(shells, missing)`; `cues` absent is `(cues, cue-count)`; show `sky` absent is a hard `missing`, and inside a show's `sky` a missing `gravity`/`wind` is a hard `missing` (no defaults); a cue `shell` naming a malformed key is `unknown-shell` (malformed keys are never in the key set); a cue `t`/`x`/`burstHeight` or `duration` out of range is clamped leniently (strict `out-of-range`), while `seed` is never adjusted.
4. Firing order lives in `engine/model/show.ts` (`cueFireStep`, `orderCues`); normalize keeps cues in array order and never sorts the document.

## Why
1–2: strict needs the union (fixture `mixed.json`). 3: each needs one answer on both sides, or the multisets differ; these follow the nearest stated rule (breaks missing → count error; "only version and name default in a show"). 4: sorting would make normalize change a valid document without an adjustment.

## Boundary
Binds Bowser's C# walker (Phase 4) on point 3, and Phase 6 `TimelineDriver` on point 4. Yoshi may fold point 3 into schema.md §6.2.

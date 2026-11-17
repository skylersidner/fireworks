# Bowser: `ClientPlayback.WarmUpDelayMs`

**Date:** 2026-11-17 · **Status:** proposed · **Inputs:** Skyler's ruling on Q3 in `yoshi-end-review-cpu-cost.md` (option B), `bowser-phase6-client-playback-config.md`.

## What
- New knob `ClientPlayback:WarmUpDelayMs`: whole milliseconds, default **1000**, range **0–5000**. Warm-up starts, or restarts, only after this long with no edit and no seek.
- Bound and validated exactly like the other four. A `[Range]` message names the key (`ClientPlayback:WarmUpDelayMs must be between 0 and 5000 (milliseconds).`). The same validator runs eagerly at registration and on `ValidateOnStart`, so an out-of-range value stops startup before the database.
- Committed in `appsettings.json` only, equal to the class default.
- Served as `playback.warmUpDelayMs`, the last positional field of `ClientPlaybackConfig`. Wire shape: `{"playback":{"seekBudgetMs":25,"catchingUpDelayMs":300,"checkpointIntervalSeconds":10,"checkpointMemoryMiB":64,"warmUpDelayMs":1000},"loginProviders":[...]}`.
- README: a table row, the setting count, and the API-reference row.

## Why
- Q3 recommended serving the debounce as a knob that follows the existing pattern. A server that lacks the field leaves the client on its own default (1000).
- The range matches `CatchingUpDelayMs` (0–5000). At 0 the debounce is off, which is the old behaviour.

## Boundary
- The server only serves the value. The debounce, the client clamp to 0–5000 and the `PLAYBACK_LIMITS` row are Luigi's work.
- Until Luigi adds the field, `client-config.contract.spec.ts` fails on purpose, because it pins the C# record keys and ranges against the TypeScript side.
- The 12 ms and 6 ms warm-up caps and the 10 s checkpoint interval are unchanged. They are not served.

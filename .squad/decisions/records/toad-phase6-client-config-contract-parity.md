# Toad: the client clamps are pinned to the server's ranges as text

**Date:** 2026-11-15 · **Phase:** 6 follow-up (served `ClientPlayback` config, Boo F1 time-budgeted seek) · **Status:** proposed · **Inputs:** `bowser-phase6-client-playback-config.md`, `luigi-phase6-show-builder.md` point 13.

## What
- `src/web/fireworks-web/src/app/core/client-config.contract.spec.ts` reads the C# source of truth as text and checks the client against it:
  - `ClientConfigResponse` and `ClientPlaybackConfig` record parameters (camelCased) equal the TS keys exactly;
  - each `[Range(a, b, …)] public int X { get; init; } = d;` in `ClientPlaybackOptions.cs` equals `PLAYBACK_LIMITS[x]` (`min`, `max`, `fallback`);
  - the committed `appsettings.json` `ClientPlayback` section equals `DEFAULT_PLAYBACK`;
  - every knob passes through at `min` and `max` and clamps at one past either end;
  - exact importer ledgers: only `app.config.ts` imports or injects `ClientConfigLoader`, and the value importers of `core/client-config` are the loader, the stage, the builder store and the player page.
  Each parser has a negative control on a one-occurrence swap of the real text.
- `fireworks-stage.timeline.spec.ts` gains a spec where step cost jumps from 1/16 ms to 2 ms mid-frame: a frame is at most `budget + SEEK_CHUNK_MAX_STEPS × 2` ms. It kills the "no chunk cap" mutant, which every other spec let through (with a constant fake step cost the cap is unobservable).

## Why
- The server validates ranges at startup; the browser clamps "to the same ranges" only by a comment. If the server range widens to 4..200, Railway serves 150, and the client silently clamps it to 100. Nothing failed on that before.
- `designer-structure.spec.ts` scans `features/designer`, `features/show` and `shared`, not `features/player`, so "the player reads only the store" had no guard.
- Bowser's record says only the gated env-override test catches a missing Program.cs registration. Measured: the ungated `ClientConfigStartupTests` also kill it (6 failures: an out-of-range value no longer stops startup before Npgsql). The gated test is still the only one that shows a served in-range override (expected 40, got 25).

## Boundary
- A new knob needs a field in the C# record, a `[Range]` property with an initializer on one declaration line, an appsettings row and a `PLAYBACK_LIMITS` row, or this spec fails. A property written in another shape drops out of the parser and fails `toEqual` (by design, with a control).
- The spec reads `../../api/Fireworks.Api` from the web package, like the fixture specs read `../../../schema`. A web-only checkout cannot run it.

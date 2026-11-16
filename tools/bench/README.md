# Seek bench

`node tools/bench/bench.mjs [shows] [caps]` measures step cost, seek-to-end, and cold and warm random seeks for each show and particle cap, in Node, with no render (Toad, Phase 7 A3; record `toad-phase7-caps-and-seek.md`). It is report-only and never fails a run. Its first line records `uptime`. Numbers taken at load above 6 aren't comparable.

`shows.mjs` generates the realistic and preset shows. `gate-warm.mjs` in `tools/browser-gates/` uses it too. It needs `npm ci` in `src/web/fireworks-web` for esbuild.

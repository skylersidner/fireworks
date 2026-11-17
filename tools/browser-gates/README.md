# Browser gates

Playwright checks run against the built app with the real production CSP. This is Toad's tooling, moved out of the scratchpad on 2026-11-15. It isn't a dependency of the deployed app. Run `npm ci` here once. Chromium runs as the installed Google Chrome (`channel: 'chrome'`); Firefox and WebKit are Playwright 1.65.0's own builds.

Most of the time you don't run these scripts by hand. `node tools/test/run.mjs regular` runs `smoke.mjs`, and `node tools/test/run.mjs daily` runs `daily-steps.mjs`. Both start their own API (see the README's Testing section).

Every script reads the same settings:

| Variable | Meaning |
|---|---|
| `BASE` | the app origin |
| `ENGINES` | `chromium` (the default) or `chromium,firefox,webkit` |
| `CODES` | the saved share codes as JSON, or `SAVE` to post `lib/common.mjs` `SAVE_SET` to `BASE` first |
| `CODES_FILE` | a file holding the same JSON as `CODES` |
| `OUT_DIR` | where JSON results are written (default `test-results/browser-gates/`) |

Each script's header comment documents its usage and its negative controls (`NEG=…`, `MODE=none`, `TOAD_*`, `NEG_*`, `PAUSE=0`, `HEADERS_NEG=1`).

| Script | Checks | Tier |
|---|---|---|
| `headers.py` | caching, site headers, CSP, 304s, 413, 405, health, HSTS; phases `put`, `burst`, `dbdown` | smoke (`main`), daily |
| `gate-roundtrip.mjs` | builder edit, Save, Share, GET equal to POST, Show JSON round trip, real-time play (`SKIP_PLAY=1` skips it) | smoke (`SKIP_PLAY`), daily |
| `player-virtual-time.mjs` | the 10 s show to its end under `page.clock`, Replay, and the frozen-clock control | smoke, daily |
| `gate-csp.mjs` | zero CSP violations on nine pages; `MODE=none` is the control | smoke, daily |
| `gate-auth.mjs` | sign-in, in Chromium through the stub's real redirect flow (`PARTS`, default all): `csrf` (same-site and cross-site loopback pages get 403 or are blocked; session and list unchanged), `csp` (zero violations across `/signin` → stub → `/mine`), `walk` (two accounts can't edit, delete or list each other's creations), `save` (Save signed out opens the dialog with no write; after sign-in the draft is byte-identical, the toast shows, focus is on Save; then 201), `signout` (both drafts byte-identical across Sign out; the only write is the logout 204). Controls `NEG=csrf\|csp\|walk\|save\|signout`, each with its own `PARTS`. | smoke, daily (controls) |
| `notfound.mjs` | dotted and deleted links: h1 focus, API calls, violations | daily |
| `gate-keyboard.mjs`, `gate-touch.mjs`, `gate-reduced-motion.mjs`, `gate-follow.mjs` | Phase 7 keyboard, touch, reduced-motion and follow gates | daily, and phase gates that touch those surfaces |
| `gate-warm.mjs` | the warm-up and seek bars (7l.3, 7l.5); a measurement, report-only | daily |
| `fingerprints.mjs` | T2 show fingerprints computed in each engine on a blank page (no server, no CSP: it checks JS arithmetic, not the app) and compared with the committed goldens. Run step fails on a crash, launch failure or timeout; compare step (`MODE=compare`) fails in Chromium and is report-only in Firefox and WebKit. Controls: `FP_NEG=bump` (compare must say MISMATCH), `FP_NEG=crash` (run must say CRASH). See `tools/fingerprints/README.md`. | daily |

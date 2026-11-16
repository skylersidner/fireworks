# Mario: Phase 5 phase-gate (save, share, player, remix)

**Date:** 2026-11-14 · **Verdict:** PASS WITH NOTES · Railway items DEFERRED (deploy window, Skyler)

## What

All five Done-when round-trip steps and the local deep-link check pass. I verified them myself against the built Docker image (`fireworks:phase5-gate`, fresh DB `fireworks_gate5`, both migrations applied in the log, `Identity__AllowAnonymousWrites=true`) and against the 4200 dev server proxied to that image.

| Done-when | Result | Evidence |
|---|---|---|
| 1 Save: a POST and a new code | PASS | ledger `["POST /api/creations"]`, 8-char base58 code in the draft `source`, indicator `Saved` |
| 2 Link plays in a private window | PASS | fresh context, ledger is one GET; dev: `launches 0` while the notice holds, then `launches 1, particles 69`; image: canvas frames stay static while held and change after Play |
| 3 Remix, then Save as new | PASS | Remix sends only GETs, gives a dirty copy, `Not saved`; ledger `["POST …/{A}/remix"]`; new code `remixedFrom === A`; A's document and `updatedAt` unchanged; the remix's player HTML never contains A's code (C10) |
| 4 Update original | PASS | `/c/{A}` with no dialog (just-saved copy); ledger `["PUT /api/creations/{A}"]`; code unchanged; `/s/{A}` plays the new name |
| 5 Link over an unsaved change asks first | PASS | dialog `Open "<name>"?` over the designer; Cancel leaves the draft byte-identical on `/` |
| Deep links (local, 5i.1) | PASS | image `curl -i`: `/s/<code>`, `/c/<code>`, `/mine`, `/s/a/b` all `200 text/html` (index.html); `/api/creations/abcdefgl` is the catch-all's empty 404 (`l` fails the route constraint, schema.md §2.7); a well-formed unknown code is the JSON 404 `{"message":"No creation has that share code."}` |
| Deep links on Railway (5i.2–5i.5) | DEFERRED | needs the Railway test window |

Also from my runs: `/mine` asks `?page=1&pageSize=24&kind=shell` and shows no canvas; the banner copy matches phase-5.md §2.4 word for word with `role="note"` on the designer, player and `/mine`; S1 under emulated reduced motion shows the player paused with a centered Play and `Reduce flashing is on. Press Play to start.` (or `Press Play to start.` when it's off); the stubbed non-owner spec exists (`core/creation-save.spec.ts:195`).

**Suites:** npm 1246/1246 in 41 files; `unsafe-sinks.spec.ts` alone 9/9; typecheck clean; `ng build` passes with main `main-VG3OIGPY.js`, the same hash as the image; prettier is clean over the `format` script's scope (`src/**/*.{ts,html,scss,css,json}`). Backend gated (`FIREWORKS_TEST_POSTGRES`) 565/565, and `git diff facf980 -- src/api` is empty. Toad's spec after Luigi's `prettier --write` differs from Toad's rig copy on one line only, line 58, the `bind-|bindon-` alternative. That line is a mutant in the rig, and the repo has the full form, so the substance is unchanged.

## Notes (not blocking)

1. **`/c/..%2Fme` in the image gets a bare 404, not the app's not-found page.** Kestrel keeps `%2F` encoded, and `MapFallbackToFile`'s `nonfile` constraint treats a last segment containing a dot as a file, so no SPA is served. On `ng serve` the same URL shows "Nothing plays at this link". This is safe (no `/api/me` reach) and only affects hand-crafted links. Bowser can decide whether it's worth fixing in Phase 7. Any dotted path under `/s/` or `/c/` behaves the same.
2. **`luigi-p5-donewhen.mjs` is stale against Luigi's own FSI/PDI fix (2c).** The title and confirm-heading comparisons don't strip U+2068/U+2069, and its playback check needs `window.ng`, which is dev-only. My patched copy is `scratchpad/smoke/mario-gate5.mjs`. Luigi should update the original if it stays in use.
3. Prettier `--check .` flags `angular.json`, `tsconfig.app.json`, `tsconfig.spec.json` and `golden/record-prototype-golden.mjs`. They are outside the `format` script's scope and untouched since Phase 3.
4. I did not re-run Toad's 21-fixture parsed-value round trip because of the write rate limit. Done-when 3 and 4 are covered by my own runs.

## Carried forward

- 5i.2–5i.5 (Railway deep links, round trip with writes on, switch-off, 413 through the edge, Boo S5), Boo C18 (Railway), S21: all in the Railway test window. Writes must be switched off afterward.
- Plan-carried F11 (`type` copy for integer fields) is due by Phase 6.
  > Superseded 2026-11-15 (Mario, `mario-phase7-planning.md` point 7): F11 was already closed in code (`designer-copy.ts:87`, Peach 5h). This carry was stale.

## Why

Each item was settled by a request ledger, the parsed draft, an API GET or `curl -i` against the built image, not by reports.

## Boundary

This passes Phase 5 for local and image evidence only. Railway deep links and the Railway round trip stay open until the deploy window, and Phase 5 isn't release-complete until 5i.2–5i.5 pass.

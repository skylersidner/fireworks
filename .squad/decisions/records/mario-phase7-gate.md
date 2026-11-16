# Phase 7 phase-gate (Mario)

**Date:** 2026-11-15 · **Phase:** 7, Polish and deploy hardening · **Verdict: PASS WITH NOTES** · Commits: not authorized (Skyler inspects and approves).

**Binding constraints applied (Skyler, 2026-11-15; plan 7.5):** Chromium only; real-time and measurement runs once, here; one agent (me), heavy runs serial; no mutants. Rulings: [R] DEFERRED; caps 40k/600 s; warm-up on every device; CSP `style-src 'unsafe-inline'` accepted; Show JSON Apply is one Undo step; 7l.5 paired rule.

## What

**Surfaces.** Image `fireworks:phase7-gate` (full three-stage `docker build`, created 2026-11-15T23:20:30Z; `main-BESCMADF.js` equals the local `ng build`). Run as `fw-gate7` on 127.0.0.1:18097 with `ASPNETCORE_ENVIRONMENT=Production` and `Identity__AllowAnonymousWrites=true`, against a fresh `fireworks_gate7` (both migrations applied at boot). Every check below ran on the image unless it is marked spec. Scripts and logs are in `scratchpad/gate7/` (`headers.py`, `notfound.mjs`, `*.log`). The browser scripts are Toad's, in `scratchpad/toad-c3/gate/`.

**Suites (serial):**
- web: 1640/1640 in 68 files (Phase 6 had 1433);
- `typecheck` clean, `ng build` clean, prettier `--check` on the format glob clean;
- `generate-fixtures.mjs --check`: 176 fixtures match;
- `dotnet test`: 661 passed and 12 skipped of 673;
- gated (`FIREWORKS_TEST_POSTGRES` on 5433, `fireworks_test`): 673/673;
- `docker build`: three stages, success.

| 7.2 item | Result | Evidence |
|---|---|---|
| 1 Caching | PASS | `headers.py main`, 287/287. `main`, `styles` and a chunk are `public, max-age=31536000, immutable` with an ETag and Last-Modified. `/`, `/index.html`, `/show`, `/mine`, `/s/<c>` and `/c/<c>` are `no-cache` and give 304 with an empty body on `If-None-Match`. `favicon.svg` and `3rdpartylicenses.txt` are `no-cache`. `/chunk-AAAAAAAA.js` and `/nope.js` are 404 `no-store`. The share GET's ETag equals `"`+raw `updatedAt`+`"` with `private, no-cache`; 404 is `no-store`. Tag, `W/`, list and `*` give 304; garbage gives 200; `If-Match` is ignored. `put` 2/2: the PUT ETag equals the body's quoted `updatedAt` with `no-store`, and the old tag gets 200 with the PUT's tag. Negative controls are on record (7a.8, Toad and Bowser). My own checker control (expect `unsafe-eval` and no immutable) fails. |
| 2 Headers and CSP | PASS (Chromium) | The exact P7-S1 set appears once each, with no Server and no CSP-Report-Only, on: index, deep links, a hashed asset, 304, `api/me` 200, `/api/nope` 404, 413, 429 (`burst` 12/12), 500 and `/health/ready` 503 (`dbdown` 25/25), 405 on `POST /show`, `/health/live`, `/health/ready` 200, the static misses and the dotted links. Kestrel's 400 (`Host: a b`) and 431 (40 KB header, raw socket) send no Server. HSTS `max-age=31536000` is present only with `X-Forwarded-Proto: https`. `index.html` has no inline script or `<style>`, no `data-beasties`, a plain stylesheet link and no meta CSP. **S13:** `gate-csp` real header: 0 violations, 0 errors, and stages `running` on `/`, `/show`, `/c/<show>`, `/s/<shell>`, `/s/<show>`, `/mine`, `/status`, `/s/ZZZZZZZZ` and `/nope/page`. `notfound.mjs` adds `/c/..%2Fme`, `/s/..%2Fme`, `/s/a.b` and `/s/abcdefgl` with 0 violations. The `MODE=none` control fails 9/9 pages, as it should. Firefox and WebKit: **not run** (daily run, not a gate criterion). |
| 3 Pipeline edges | PASS | `/health/ready` gives 200 text/plain `Healthy`. After `DROP DATABASE fireworks_gate7 WITH (FORCE)` it gives 503 text/plain `Unhealthy` with no exception text, while `/health/live` stays 200. `/health/ready/x` is the SPA (`no-cache`). The dotted links give 200 html `no-cache`; in the browser they render the not-found page with focus on the h1, no `api/creations` request, and per-surface buttons (`Make your own` under `/s/`, `Go to the designer` and the nothing-changed line under `/c/`). A chunked 300 KB POST gets 413 with `Connection: close`, and the next request on the same `http.client` object gets 200. No `Content-Encoding` with `Accept-Encoding: gzip, br`. |
| 4 Operations | PASS; [R] DEFERRED | The README takedown ran verbatim with the code substituted (`-d fireworks_gate7`, heredoc in place of `-it`). Step 1 dump; step 2 found 1 row and 0 remixes; step 3 `DELETE 1`; step 4: the code's count is 0 and the total went 2→1. `api/creations/KPJJGsJY` gives 404 `{"message":"No creation has that share code."}` `no-store`; the other code gives 200; `/s/KPJJGsJY` shows the not-found page. Backup and restore: a 6,625-byte dump restored into an empty `fireworks_gate7_restored` (rc 0, about 1 s). Both sides give `2 \| 2026-11-15 23:22:31.623056+00 \| 1`, and the restore has 2 migrations. The numbers are written into README §Backups and restore. The stale sentence is gone. |
| 5 Context loss | PASS (spec + record) | Peach C4 accepted 7e. The suite is green, including the `fireworks-stage.phase7.spec.ts` leak specs with Toad's recorded control. No browser rerun here (none was asked at the gate). |
| 6 DPR | PASS | `gate-touch` 7f.3: DPR 3 coarse gives 1.5 on the stage, ruler, lane and overview canvases; desktop DPR 2 fine gives 2 on all of them. Unit specs are in the suite. |
| 7 Accessibility | PASS | `gate-keyboard` 78/78 (7g.1 tab-walk on every page, 7g.2, K1–K9, 7c.3). Controls: `NEG=focus` 23/23 fail, `NEG=walk` 45/45 fail. 6 `nat` checks carry no control, by design. `gate-reduced-motion` 14/14; `NEG=1` 12/12 fail. Rosalina's C2 review and sign-off are on record (7g.25). |
| 8 Touch | PASS | `gate-touch` 18/18 (7i.1 on `/`, `/show`, `/s/<shell>` and `/s/<show>`, toast × 44×44 manipulation, 7i.2, 7i.5, C2-1 thumb 24×32 on a clear track). `NEG=1` 13/13 fail. Bowser's px fix holds on the image. Pinch is in spec (7j.1). |
| 9 Builder UX | PASS | `gate-roundtrip`: the builder save's GET deep-equals the POST. 7k.3 Copy→Apply in a fresh Chromium profile→Save gives 201, deep-equal. The player plays to the end (76.3 s wall, `1:06 / 1:06`, ended text and announcement, Replay works, 0 console errors). The `TOAD_JSON_TAMPER=1` control fails the deep-equal. `gate-follow` passes (a wheel stops Follow), and its `NEG=1` fails. Drag, badge, overview and end label are in spec (Peach C4). |
| 10 Caps | PASS | No cap diff in `schema/`; fixtures `--check` ok. **7l.3** (image, headless Chrome, load about 4.7): realistic 600 s cold seeks after warm-up p50 80 / p95 496 ms with 0 over 1 s, warm-up finished in 10,466 ms, 1 long task (54 ms) during it. The Done-when show gives p95 544 ms (bar 1,039 ms), warm-up 2,325 ms. **7l.5 paired:** realistic early p95 3,608 vs baseline 3,698 ms (it passes both ≤ 4,330 and ≤ 1.2×); Done-when early 238 vs baseline 880 ms. 0 missed targets in all four runs. The `nowarm-check` control: patched gives `off`, unpatched gives `running`. |
| 11 Cleanups | PASS | 7m.1–7m.8 accepted by Peach in C4, suite green. Carries below (7m.9). |
| 12 Suites | PASS | Counts above. Negative controls are recorded (7n.2) and rerun here for CSP, keyboard, reduced motion, touch, follow, Show JSON and warm-up. |
| 13 Railway | DEFERRED | Every 7o item (Q7.1). |

**Writes on the image:** 2 shells, 1 PUT and 6 shows (2 from `gate-warm` SAVE, 2 from each `gate-roundtrip` run), all paced under 20/min, plus the burst of reads. All were deleted by the takedown or the final `DROP DATABASE`.

## Why
- Image evidence only, per the skill `probe-the-published-build`. Boo's C1 used a `dotnet publish`, so 7a and 7b were re-proved here on the real image.
- `gate-csp` doesn't visit the dotted not-found pages that 7b.7 lists, so `notfound.mjs` closes that gap under the real header.

## Notes (non-blocking)
1. **Precompressed siblings in the image.** `wwwroot` holds `*.js.br` and `*.js.gz` (from the Web SDK's publish compression). They aren't negotiated (7c.5 passes with `Accept-Encoding`), but they're dead weight, and if anyone ever switches to `MapStaticAssets` they'd start serving `Content-Encoding`. Owner: Bowser, Phase 8 or a cleanup (turn off publish compression, or record that they're accepted).
2. **The 7l.5 margin on realistic-600 is thin** (3,608 ms against 4,330 ms): warm-up barely helps the first 1 s of scrubbing. It passes, and it's the right input for the end-of-project CPU review.
3. **No `chunk--*` file in this build**, so 7a.1's leading-dash case wasn't exercised. Hashes change every build; the rule is a regex covered in spec.
4. **A leftover DB, `fireworks_test_toad_c3`**, on the shared Postgres (Toad's, not created at this gate). Toad should drop it.

## Carried (7m.9), with owners
- **[R] DEFERRED** (Bowser leads the first window; Boo C18/C20; Toad the 21-fixture round trip and 2d Firefox/Safari): every 7o item, 7b.4 and 7c.4 through the edge, 7d.4 Railway backups, and the writes-off check.
- **Phase 8:** S18 `Vary` (Boo), `If-Match` → 412 using the `"<updatedAt>"` token (Yoshi design, Bowser).
- **End-of-project review:** automatic quality/`starBudget` reframed as CPU cost (Q7.2), and `unsafe-eval` CPU cost (Boo/Toad).
- **Post-Phase-7 testing interlude** (Toad, Yoshi): the fast show-testing strategy, and the daily multi-browser run that owns 7b.7, 7k.3 and 7j.4 in Firefox and WebKit.

## Boundary
- This verdict covers Chromium only. Firefox and WebKit are **not run**, not passing, until the daily run exists.
- Left running for Skyler: API on 5180 (Fireworks.Api PID 93618, Bowser's instance, not restarted; no `.cs` newer than its binary, serves `main-BESCMADF.js`) and `ng serve` on 4200 (PID 73241). My `ng build` rewrote `wwwroot` with identical hashes.

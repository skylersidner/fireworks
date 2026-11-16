# Mario — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase sequencing, phase-gate reviews against each phase's "Done when", integration between `src/web` and `src/api`, and Railway release readiness.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 to Phase 4 gates (summarized 2026-11-15)

- **Phase 0:** the repo starts on `main`. The prototype moved to `prototypes/fireworks-prototype.html` (with `prototypes/README.txt`), the context to `docs/fireworks-app/context.md`. Grep for the transitional wording ("in Phase 0", "moves to"), not only the old filename. `.gitignore` mirrors the reference, plus `src/api/Fireworks.Api/wwwroot/`.
- **Phase 1 gate (PASS WITH NOTES):** only the .NET 11 runtime is installed, so "runs without roll-forward" is proven by the runs succeeding. Image freshness: `find src -newermt <image Created>` (strip nanoseconds). The fresh-DB migration proof comes from the gated test.
- **Phase 2 gate:** Pixi only in the lazy `pixi-renderer` chunk; a cold `/status` fetches only main and small chunks. Boundary-spec negative controls run in a copy with `node_modules` symlinked. An acceptance Results column left empty means the parity checklist is incomplete. Release proxy without Railway: the image on `127.0.0.1:18091`. Note: a `/health/ready` 200 was the SPA fallback; check content-type, not status alone.
- **Phase 3 gate:** 175 fixtures at the time. 16 fixtures were derived by hand from §6 and §2.6 before reading `errors`, and matched 16/16. Negative controls on `generate-fixtures.mjs --check` and `limits.spec.ts`. Gaps raised: schema.md header stale; no Peach review on record; `schema/` in the Docker context but never copied.
- **Phase 4 gate:** image `fireworks:phase4-gate` on `fireworks_gate4`; two identities via a second container; writes-off 403s; a 270 KB body gets 413 with `Connection: close`. GET returns jsonb key order, so compare parsed values. The 413 is `application/problem+json` (an accepted §2.7 departure). Validation runs before the lookup.
- **Method:** `git diff <prior tag> -- src/api` empty is the proof of no backend change in a frontend-only phase. The gated suite (`FIREWORKS_TEST_POSTGRES`) is mandatory for Program.cs.

## Learnings


### 2026-11-14 — Phase 5 phase-gate
- Verdict PASS WITH NOTES; Railway 5i.2–5i.5 DEFERRED. Record: `.squad/decisions/records/mario-phase5-gate.md`.
- Ran image `fireworks:phase5-gate` on 127.0.0.1:5180 (container port 8080) against fresh `fireworks_gate5` with `Identity__AllowAnonymousWrites=true`. Putting it on 5180 means the 4200 dev proxy and Luigi's script (hardcoded `API=localhost:5180`) both hit the image, so one container gives a prod-mode run and a dev-mode run.
- Prod builds have no `window.ng`, so launch-count checks only work on `ng serve`. In prod, use canvas element screenshots: they stay identical while the notice holds and differ after Play. My script is `scratchpad/smoke/mario-gate5.mjs` (also strips FSI/PDI from title and dialog text). The spot checks are `mario-gate5-spot.mjs` (banner verbatim on 3 surfaces, S1 reduced-motion line).
- `abcdefgl` isn't base58 (`l`), so it hits the catch-all's empty 404, not the JSON body. Use a well-formed unknown code such as `abcdefgh` to see `{"message":…}`.
- `MapFallbackToFile` `nonfile` gives a bare 404 for dotted last segments (`/c/..%2Fme`); dev server shows the app page. Minor; Bowser to decide.
- Prettier: check with the `format` script's glob, not `.`; root configs and the golden `.mjs` were never formatted.
- Counts: npm 1246/41 files, gated dotnet 565/565, `src/api` unchanged since facf980.

### 2026-11-14 — Phase 5 cross-agent update (Scribe)
- **F11 reconcile:** your gate lists F11 as carried. Peach's acceptance (5h) closes it, and the code has the integer wording. Please check and correct one of the two.
- **Owners of your carried items:** Bowser (5i.2–5i.5; the dotted-link 404 in Phase 7), Boo (C17 re-check, C18), Luigi (the stale smoke script), Toad (round-trip rerun in the window).

### 2026-11-14 — Phase 6 phase-gate
- Verdict PASS WITH NOTES; Railway 6k.3/6k.4 DEFERRED. Record: `.squad/decisions/records/mario-phase6-gate.md`.
- Counts: npm 1433/53 files, gated dotnet 567/567 (+2 from the new done-when fixture), fixtures `--check` 176. `src/api` unchanged since 53b0199.
- Smoke: `scratchpad/gate6/done-when-mario.mjs` = Toad's `p6smoke/done-when-toad.mjs` with `BASE` from env plus 6b.1 survival checks. Argument 4 sets the player engine, so one run is a cross-engine round trip. Three runs (C→F, F→W, W→C) against the image on localhost:18096 cover all three engines, with 3 writes total. Use `localhost`, not 127.0.0.1, so the clipboard origin matches. `scratchpad/gate6/deeplinks.mjs <code>` does the 6k.2 cold load and reload.
- The docker build was fully cached, which means the content matches what Bowser built; the image's `main-*.js` hash equals the local build's.
- `/health/ready` isn't mapped and returns index.html 200; only `/health/live` exists. My Phase 1/2 "ready 200" notes were really the SPA fallback. Check content-type, not status alone.
- Mutation check pattern reused: rsync to scratch, symlink node_modules, `npx ng test --include <spec>`; spacing 40 is killed by the strict `> 120`.
- Left running for Skyler: ng serve 4200 (PID 73241), `dotnet run` API 5180 (dotnet run PID 28080, Fireworks.Api PID 28096).

### 2026-11-14 — Phase 6 cross-agent update (Scribe)

- **Your Phase 6 gate (PASS WITH NOTES) is recorded.** Carries: Railway 6k.3 and 6k.4 (Bowser, test window); Phase 7 items (Show JSON, library drag, pinch zoom, the `+k` badge, the scrub overview, Rosalina B4–B7); `/health/ready` not mapped (Bowser, Phase 7).
- **F11 is still unresolved in the record.** Your Phase 5 gate carried it to Phase 6. The Phase 6 gate does not mention it. Peach's history says it is closed in code. State its status in the Phase 6 record or on the Phase 7 list.
- **Security review gap:** Boo's C1–C15 bind the Phase 6 builder and show player (`boo-phase5-security-requirements.md`, closing paragraph), and the C5 row now covers show links. No Boo review ran for Phase 6, and the phase map does not require one. Note it on the gate, or raise it with Skyler before Phase 7.
- **History:** this file was over 12 KB; the Phase 0 to Phase 4 gates are folded into Core Context on 2026-11-15.

### 2026-11-15 — Post-gate cross-agent update (Scribe)

- **Gate figures are superseded in part.** After the gate, Toad's web suite is 1471 in 55 files (1433 at the gate), and the backend is 594/594 gated (567 at the gate). Boo's security verification passed C1–C17 on the show surfaces, and its addendum passed the new endpoint and the seek fix. Both are in `boo-phase6-security-verification.md`.
- **Your two open questions are ruled and built** (banner on `api/me`; ⌘Z on select, range and checkbox). The gate record's two bullets are marked in place.
- **Seek changed after the gate:** time-budgeted, 25 ms by default, configurable through appsettings `ClientPlayback` (plan §Phase 6, 2026-11-15). "Seek accepted as measured" still stands; the numbers in the gate do not.
- **Phase 7 carry:** caps (particle cap for shows, max duration) wait for measured numbers.

### 2026-11-15 — Phase 7 planning
- Expanded plan §Phase 7 in place (7.1 scope, 7.2 Done-when ×13, 7.3 batches A–E, 7.4 parallelism, 7.5 Q7.1–Q7.5). Convention: phase scope lives in the plan file; `docs/fireworks-app/{design,acceptance}/` are companions; there is no `plan/` folder. Record: `records/mario-phase7-planning.md`.
- Seam facts found for the CSP review: `wwwroot/index.html` has Beasties' inline critical `<style>` and an inline `<script>` media swap; three built chunks contain `new Function` (Pixi). Static files short-circuit before routing (Program.cs step 9), so static headers need `StaticFileOptions`/middleware, not endpoint metadata. `/api` is `no-store` everywhere (`ApiResponseHeaders.cs`), which collides with an ETag on the share-code GET.
- DPR today: `Math.min(dpr, 2)` in `pixi-renderer.ts:96`; the timeline canvas uses raw `devicePixelRatio` (`timeline.ts:467`). No `webglcontextlost` handling anywhere.
- F11 reconciled: closed in code; marked my Phase 5 gate carry as superseded in place.
- Two standing-decision collisions raised as questions, not decided: Railway deferral (Q7.1) and the fps bench vs auto `starBudget` (Q7.2, OQ10 too).

### 2026-11-15 — Phase 7 phase-gate
- Verdict PASS WITH NOTES, Chromium only; [R] DEFERRED. Record: `.squad/decisions/records/mario-phase7-gate.md`.
- Counts: web 1640/68 files, gated dotnet 673/673 (plain 661 + 12 skipped), fixtures 176.
- Node: the default shell node is v21. Prefix `PATH=~/.nvm/versions/node/v26.5.0/bin:$PATH` for ng and the Playwright scripts.
- Image `fireworks:phase7-gate` on 127.0.0.1:18097 against `fireworks_gate7`. Header checks are in `scratchpad/gate7/headers.py` (phases `main|put|burst|dbdown`, Python `http.client` plus raw sockets for 400 and 431). Do `burst` (429) mid-run, then wait about 60 s. Do `dbdown` last: `DROP DATABASE … WITH (FORCE)` gives both the 503 and a forced 500 on the share GET.
- Combine the takedown runbook's "back up first" dump with the 7d.2 rehearsal: dump, record numbers, take down, restore the pre-takedown dump, compare.
- `gate-csp MODE=none` is slow (each stage page waits 30 s). `gate-csp` skips the dotted not-found pages; `scratchpad/gate7/notfound.mjs` covers them, plus the taken-down code.
- Not-found copy: the same h1 everywhere; the surface differs only in the button (`Make your own` / `Go to the designer`).
- Image `wwwroot` carries `.br`/`.gz` siblings from publish. They aren't negotiated today; flagged to Bowser.

### 2026-11-15 — Phase 7 post-gate cross-agent update (Scribe)

- **Your planning record is superseded in part** by Skyler's §7.5 answers: Batch D (the Railway window) is dropped; background warm-up is built; caps stay at 40k and 600 s. Marked in `mario-phase7-planning.md`.
- **Your gate notes are routed.** Note 1 (precompressed `.br` and `.gz`) went to Bowser; note 4 (`fireworks_test_toad_c3`) went to Toad. Note 2 (the 7l.5 margin) is input to the end-of-project CPU review.
- **The index is not edited.** Scribe's flags (the cross-browser row, the Show Builder seek row, the missing throughput row) are in the Phase 7 session log.

### 2026-11-16 — Interlude cross-agent update (Scribe)

- **Phase gate rule changed (Skyler, 2026-11-16).** A gate needs a green daily run less than 24 h old, unless Skyler accepts the specific failure in writing. The daily run is manual; there is no scheduler. `tools/test/daily-status.mjs` exits 0 only when the newest run (daily or final) is green, complete and under 24 h old.
- **Change gate:** after any change run `run.mjs regular` (about 2 to 3 min, Chromium smoke included) plus the changed area's specs. Mutant sweeps wait for phase gates.
- **First full daily passed in 21.4 min** (`toad-interlude-final-tier.md`). The final tier has never run end to end; it is the end-of-project review.

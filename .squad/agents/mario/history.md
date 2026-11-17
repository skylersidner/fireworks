# Mario — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells, and shows since Phase 6. Owner: Skyler Sidner.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway (deferred, [R]).
- **Plan:** `plans/initial-implementation.md`, Phases 0–8. Identity model in §3.4 (Google sign-in from Phase 8). **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (mirror structure, never its domain). **Prototype:** `prototypes/fireworks-prototype.html` (parity oracle).
- **Your focus here:** phase sequencing, phase-gate reviews against each phase's "Done when", integration between `src/web` and `src/api`, and Railway release readiness.
- Carried over: the role only. Standing lessons are in `.squad/decisions/README.md`.

### Folded from Phase 0 to Phase 4 gates (summarized 2026-11-15)

- **Phase 0:** the repo starts on `main`. The prototype moved to `prototypes/fireworks-prototype.html` (with `prototypes/README.txt`), the context to `docs/fireworks-app/context.md`. Grep for transitional wording ("in Phase 0", "moves to"), not only old filenames. `.gitignore` mirrors the reference, plus `src/api/Fireworks.Api/wwwroot/`.
- **Phase 1 gate (PASS WITH NOTES):** only the .NET 11 runtime is installed, so "runs without roll-forward" is proven by the runs succeeding. Image freshness: `find src -newermt <image Created>` (strip nanoseconds).
- **Phase 2 gate:** Pixi only in the lazy `pixi-renderer` chunk. Boundary-spec negative controls run in a copy with `node_modules` symlinked. An acceptance Results column left empty means the checklist is incomplete. A `/health/ready` 200 was the SPA fallback: check content-type, not status alone.
- **Phase 3 gate:** 175 fixtures then. 16 fixtures were derived by hand from §6 and §2.6 before reading `errors`, and matched 16/16. Negative controls on `generate-fixtures.mjs --check` and `limits.spec.ts`.
- **Phase 4 gate:** image `fireworks:phase4-gate` on `fireworks_gate4`; two identities via a second container; writes-off 403s; a 270 KB body gets 413 with `Connection: close`. GET returns jsonb key order, so compare parsed values.
- **Method:** `git diff <prior tag> -- src/api` empty is the proof of no backend change in a frontend-only phase. The gated suite (`FIREWORKS_TEST_POSTGRES`) is mandatory for Program.cs.

### Folded from the Phase 5 to Phase 7 gates and planning (summarized 2026-11-15 and 2026-11-16)

- **Phase 5 gate (`mario-phase5-gate.md`):** image `fireworks:phase5-gate` on 127.0.0.1:5180 against `fireworks_gate5`. Putting it on 5180 means the 4200 dev proxy and Luigi's script hit the image. Prod builds have no `window.ng`, so launch-count checks only work on `ng serve`; use canvas screenshots in prod. `abcdefgl` isn't base58: use `abcdefgh` to see the `{"message"}` body. Railway 5i.2 to 5i.5 DEFERRED.
- **Phase 6 gate (`mario-phase6-gate.md`):** counts npm 1433, gated dotnet 567. The done-when smoke runs three times (C→F, F→W, W→C) to cover three engines. Use `localhost`, not 127.0.0.1, so the clipboard origin matches. `/health/ready` was not mapped then (Phase 7 mapped it). The docker build was fully cached, so the content matched Bowser's build.
- **Phase 7 planning (`mario-phase7-planning.md`):** phase scope lives in the plan file; `docs/fireworks-app/{design,acceptance}/` are companions. Seam facts: Beasties' inline style and script in `wwwroot/index.html`; three chunks contain `new Function`; static files short-circuit before routing (Program.cs step 9). Batch D (Railway) was dropped by Skyler's 7.5 answers; warm-up built; caps kept.
- **Phase 7 gate (`mario-phase7-gate.md`):** image `fireworks:phase7-gate` on 127.0.0.1:18097 against `fireworks_gate7`. Header checks in `scratchpad/gate7/headers.py`. Run `burst` (429) mid-run, then wait about 60 s; run `dbdown` last (`DROP DATABASE … WITH (FORCE)`). `gate-csp MODE=none` is slow. `wwwroot` `.br`/`.gz` siblings were routed to Bowser.

## Learnings

### 2026-11-16 — Interlude gate rule (Skyler, standing)

- **Gate rule:** a gate needs a green daily run under 24 h old, unless Skyler accepts the failure in writing. The daily run is manual; there's no scheduler. `tools/test/daily-status.mjs` exits 0 only when the newest run (daily or final) is green, complete and under 24 h old.
- **Change gate:** after any change, run `run.mjs regular` (about 2 to 3 min, Chromium smoke included) plus the changed area's specs. Mutant sweeps wait for phase gates.
- **Final tier:** the first full daily passed in 21.4 min (`toad-interlude-final-tier.md`). The final tier has never run end to end; it is the end-of-project review.

### 2026-11-17 — Phase 8 phase-gate

- Verdict PASS WITH NOTES, Chromium only; [R] DEFERRED. Record: `.squad/decisions/records/mario-phase8-gate.md`.
- Counts: regular 252.6 s; web 1778 in 79 files; dotnet with Postgres 862/862. Mutants: `phase8-auth` 20/20 (R1 on `fireworks_gate8_mut`, `FIREWORKS_MUTANT_POSTGRES`); `phase8-client` 17 KILLED and S3 equivalent (sweep exits 1 until Toad marks it).
- G1 and G2 driven by `scratchpad/gate8/g1g2.mjs` (`BASE`, `STUB`, `SUBJECT`); it imports `launchers` from `tools/browser-gates/lib/common.mjs` by absolute path. `cookie.mjs` and `cookie2.mjs <base> <subject>` print a session cookie for curl; `curl-checks.sh <base> <code> <cookie>`.
- Playwright `isVisible({timeout})` doesn't wait: wait for a landmark first, or the flashing notice stays up and takes focus on the sign-in return (correct per 8b.3, but it looks like a focus bug).
- A long-running 5190 stub may predate `/__next-subject` (404). Fall back to `Continue as <sub>` on its interactive page. (The coordinator has since restarted the stub.)
- Image as Testing: `-p 127.0.0.1:18098:8080`, authorize `localhost:5190`, token and userinfo `host.docker.internal:5190`. Production refusal exits 134 before "Now listening". macOS has no `timeout`: use `docker run -d` and inspect.

### 2026-11-17 — Cross-agent update (Scribe)

- **Your gate notes are routed.** S3 went to Toad (mark it equivalent or replace it). G1 and G2 as scripted gates are pending Skyler. N1 went to Luigi, N2 is unassigned (Bowser's area), A37 went to Bowser against Boo's trigger, and the leftover `fireworks_boo_race` on 5433 is Boo's to drop.
- **The stale 5190 stub is fixed.** The coordinator restarted it, so `/__next-subject` works now (your note 3).
- **Carried, unchanged:** the [R] items; the final tier's first end-to-end run; redundant-spec deletions (Skyler, once replacements kill the same mutants).

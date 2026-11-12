# Boo — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Security review of the Phase 1 pipeline, Phase 4 (ownership, rate limits, validation, size limits), Phase 5 (share-link exposure), Phase 7 (CSP and headers), and Phase 8 (authentication). Note: unlike the reference app, this one has per-user ownership (`owner_user_id`), so IDOR findings are real findings here.
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- Production writes are off until Phase 8 (OQ20). This is what makes OQ3 (share links show the latest edit, so a link can be rewritten) and OQ13 (owner-based deletion, which is effectively anyone's deletion under the interim identity) acceptable in the interim. Restate both as conditions in the Phase 4 and 5 security reviews.

### 2026-11-12 — Phase 1 security-review (pipeline)
- **Probe a clean publish, not the repo's build output.** Copy `src/api/Fireworks.Api` (minus bin/obj/wwwroot) to the scratchpad, `dotnet publish -c Release`, run it with `ASPNETCORE_ENVIRONMENT=Production`, `ASPNETCORE_URLS=http://127.0.0.1:5199`, `DOTNET_ROLL_FORWARD=Major` (only the .NET 11 runtime is installed here) and `--webroot` the real `wwwroot`. Skill: `.squad/skills/probe-the-published-build/SKILL.md`.
- **Other agents run mutants on the shared tree.** My first Release publish caught a Program.cs mutant in flight (MapHealthChecks deleted, Program.cs mtime 15:40:12 vs my dll 15:40:00), and `/health/live` served index.html. A clean republish was correct. Before reporting a pipeline regression, compare the source mtime with the dll and rebuild from a copy.
- Verified clean in the running Production build: `/health/live` and `/health/live/` give text/plain; `/api`, `/API/x`, `/api/nope.js`, `POST /api/me` give 404; Swagger 404s; no CORS headers for any Origin; a forced 500 (database dropped under the running app) returns bare ProblemDetails with no detail.
- **The Pkcs pin is correct but only for restore.** `System.Security.Cryptography.Pkcs` IS in `Microsoft.AspNetCore.App` (10.0.15 in the aspnet:10.0 image), so the runtime binds the framework copy and the package never ships. The negative control (pin removed) brings back both GHSA warnings.
- **EF Design's `PrivateAssets=all` keeps the Design dll out, but `BuildHost-net472/` and `BuildHost-netcore/` (about 4 MB of Roslyn MSBuild host) still land in the publish** through contentfiles/buildtransitive.
- `aspnet:10.0` runs as root (`User=[]`, `APP_UID=1654` available). The publish includes `appsettings.Development.json`, so setting `ASPNETCORE_ENVIRONMENT=Development` alone turns on writes, CORS, Swagger and the developer exception page.
- Phase 4 conditions I set (record `boo-phase1-pipeline-security-review.md`): `CanWrite` is checked in the service with an endpoint-enumerating 403 test; before Phase 8 the rate limiter partitions by IP, because every visitor has the same UserId; ForwardLimit stays 1; "My creations" in production is a public gallery of every share code while reads are ungated (question for Skyler).
- Phase 7 note: the prod `index.html` has an inline beasties `<script>` and an inline `<style>`, so a CSP needs hashes or `inlineCritical: false`.

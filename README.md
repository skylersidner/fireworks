# Fireworks Sandbox

A web app for designing, saving, sharing and playing fireworks shells (and later timed shows) in the browser. It is built from the single-file PixiJS prototype in `prototypes/fireworks-prototype.html`, on Angular 22 + PixiJS 8, a .NET 11 API and Postgres 18, deployed on Railway.

- **Plan:** [`plans/initial-implementation.md`](plans/initial-implementation.md) is the source of truth for phases, scope and "Done when" criteria.
- **Background:** [`docs/fireworks-app/context.md`](docs/fireworks-app/context.md).
- **Team:** work is coordinated as described in [`CLAUDE.md`](CLAUDE.md); the team is defined in `.claude/agents/` with its memory, decisions and skills in `.squad/`.

## Project structure

- `Fireworks.slnx` — the solution (API + API tests).
- `src/api/Fireworks.Api` — ASP.NET Core API (`net11.0`). Serves the Angular build from its own `wwwroot`, so production is a single origin.
- `src/api/Fireworks.Api.Tests` — xUnit backend tests (SQLite in memory, Kestrel harnesses, Postgres-gated tests).
- `src/web/fireworks-web` — Angular 22 app. Its production build is written straight into `src/api/Fireworks.Api/wwwroot`.
- `docker-compose.yml` — local Postgres 18 (`fireworks-postgres`, host port **5433**).
- `Dockerfile`, `railway.toml` — the shipping image and its Railway deploy config.
- `prototypes/` — the original prototype, the visual and behavioural parity reference. Not part of the image.

## Toolchain

- .NET SDK 11 (11.0.100 or later; the API and tests target `net11.0`, so the 11.0 runtime is all you need). EF Core stays on 10.x until Npgsql ships a stable 11.x; see the comment in `Fireworks.Api.csproj`.
- Node 26.5.0 (`.nvmrc`) and npm 11.
- Docker with Compose, for Postgres.
- `dotnet-ef` is a local tool pinned in `dotnet-tools.json`: run `dotnet tool restore` once.

## Local development

1. (Optional) Copy `.env.example` to `.env` and adjust the credentials. If you change them, change `ConnectionStrings:Postgres` in `src/api/Fireworks.Api/appsettings.Development.json` to match.
2. Start Postgres:
   - `docker compose up -d postgres`
3. Start the API (http://localhost:5180; it applies migrations and seeds the default user on startup):
   - `dotnet run --project src/api/Fireworks.Api`
4. Start the Angular dev server (see [Frontend](#frontend) for its commands):
   - `cd src/web/fireworks-web && npm start`
5. Open http://localhost:4200. The dev server proxies `/api` and `/health` to the API on 5180.

**This is the whole development loop. `docker build` is for shipping only and is never part of iterating.** `ng serve` gives hot reload, and the dev proxy makes the app single-origin, as it is in production.

> **Port 4200 is shared with Monster of the Week's frontend.** This app's Angular dev server stays on 4200 (decided, plan §5 OQ12), so don't run the two frontends at the same time. The API (5180) and Postgres (5433) ports don't collide with Monster of the Week, so those can run side by side.

> **Do not use `npm run watch` as a development loop.** It has no hot reload, doesn't refresh the browser, and, because `outputPath` points at the API's `wwwroot`, it overwrites the production build with an unoptimised development one. `ng serve` strictly dominates it.

> **If you delete `src/api/Fireworks.Api/wwwroot`, run `dotnet clean` (or delete `obj/` and `bin/`) as well.** The Web SDK records `wwwroot` as a content root in the generated static-web-assets manifest, and that manifest is read inside `WebApplication.CreateBuilder(...)`. A leftover manifest pointing at a directory you just removed makes the app fail to start with `System.IO.DirectoryNotFoundException`, before any application code runs. A fresh clone is unaffected; this only bites if you delete the directory after building with it present.

`wwwroot` is a build artifact: it is gitignored and excluded from the Docker build context.

### Identity (until Phase 8)

There is no login yet (plan §3.4). Every request acts as one configured default user, `Identity:DefaultUserId` in `appsettings.json`, which the API inserts into `users` on startup. `GET /api/me` returns `{ userId, displayName, isAuthenticated: false, canWrite }`.

`canWrite` is `Identity:AllowAnonymousWrites`: **`true` in Development and `false` in production** (decided, plan §5 OQ20). The client hides write controls when it is false. The API refuses to start if `DefaultUserId` is missing, blank, not a GUID, or the empty GUID.

> **Until sign-in exists (Phase 8), the deployed site has no accounts. Saving is normally off. When it is switched on for testing, anyone who can reach the site can see, change and delete every saved creation, and a share link can be changed to play something else. Don't save anything there you'd mind losing or having changed.**
>
> Now that `PUT` and `DELETE` exist, "writes on" means more than "people can save". With `Identity__AllowAnonymousWrites=true`, anyone who reaches the site (not only people you give the URL to; new `*.up.railway.app` hostnames show up in certificate-transparency logs within minutes) can list every creation saved in any test window, overwrite what any existing share link plays (including links already sent to people), rename it to any 80-character text, delete everything, and create up to 300 rows a day per IP, each up to 256 KiB. Take a [backup](#backups-and-restore) before every window, and follow [Test windows](#test-windows-switching-writes-on) every time.

### Creations API (Phase 4)

The contract is `docs/fireworks-app/schema.md` (§2 envelope and status codes, §6 validation, §9 share codes); `src/api/Fireworks.Api/Fireworks.Api.http` exercises every endpoint.

| Endpoint | Does | Status codes |
|---|---|---|
| `POST api/creations` | body `{ kind, document }`; creates a creation owned by the current user | 201, 400, 403, 413, 415, 429 |
| `GET api/creations/{shareCode}` | public; no identity needed; `ETag` and `If-None-Match` (below) | 200, 304, 404, 429 |
| `PUT api/creations/{shareCode}` | body `{ document }`; owner only, validated against the stored kind | 200, 400, 403, 404, 413, 415, 429 |
| `DELETE api/creations/{shareCode}` | owner only | 204, 403, 404, 429 |
| `POST api/creations/{shareCode}/remix` | body `{ document }` (the edited working copy); a new creation with `remixedFrom` set; any source | 201, 400, 403, 404, 413, 415, 429 |
| `GET api/me/creations?page&pageSize&kind` | the current user's creations, `updatedAt` desc then `shareCode` | 200, 400, 403, 429 |

- **Order of checks on a write:** rate limit (429), the `CanWrite` gate (403, before the body is touched), `Content-Type` (415, missing or non-JSON), size (413, over 256 KiB), the envelope and parse (400), the lookup (404), the document walk (400). A creation you don't own is a 404, byte-identical to an unknown code.
- **400 body:** exactly `{ message, errors: [{ path, code, message }], truncated }`, at most 100 issues.
- **Rate limits** (per client IP, IPv6 per /64, in memory per replica, reset on deploy): writes 20 a minute and 300 a day; reads (`api/creations/{code}`, `api/me/creations`, `api/me`, unknown `/api` paths) 120 a minute. `/health/live`, static files and the SPA are never limited. Override with `RateLimits__Writes__PerMinute`, `RateLimits__Writes__PerDay` and `RateLimits__Reads__PerMinute`; production needs none of them. **The limiter is only as good as the client IP behind Railway's edge, which is unverified until the first deploy** (checklist step 5).
- **Body limits:** Kestrel's global limit is 64 KiB; the three write actions raise it to 256 KiB. Clients send compact JSON (a pretty-printed worst-case show is 290 KB). A body sent with `Transfer-Encoding: chunked` has its chunk framing counted toward the limit too, so a chunked body somewhat under 256 KiB of JSON can still get 413 (Boo F2). Browsers' `fetch` sends a `Content-Length` for these bodies, so this is information only.
- **ETag:** every response carrying a creation (the GET, POST, PUT and remix) sends the strong tag `ETag: "<updatedAt>"`, the body's `updatedAt` string exactly as serialized (schema.md §2.1.1). The GET answers `If-None-Match` (any listed tag by weak comparison, or `*`) with a bodiless 304 carrying the same `ETag` and `Cache-Control`. The lookup and the read limit come first. `If-Match` is not read yet (Phase 8, schema.md §11.4).
- **Caching:** the share-code GET's 200 and 304 are `Cache-Control: private, no-cache`: kept out of shared caches, revalidated on every view, so an Update original shows up on the next load. Every other `/api` response (that GET's 404 and 429 included) is `no-store`.
- **No form binding:** MVC's form value providers are removed for the whole API (`AddFireworksControllers`). With them, a `multipart/form-data` or large urlencoded body was parsed during model binding, before the write gate, and got MVC's 400 instead of 403 or 415 (Boo F1).

### Playback tuning (`ClientPlayback`)

Four settings in `src/api/Fireworks.Api/appsettings.json` tune how the Show Builder seeks and catches up. The API serves them at `GET /api/client-config` as `{ playback: { seekBudgetMs, catchingUpDelayMs, checkpointIntervalSeconds, checkpointMemoryMiB } }`. That endpoint is anonymous and read-only, sends `Cache-Control: no-store`, and counts toward the 120-a-minute read limit. Production and Development use the same values, so the section is only in `appsettings.json`.

Treat the timings below as rough. They come from the team's measurement runs, and an older machine will be slower. "The 60 s show" is the 50-cue fixture `schema/fixtures/valid/show/done-when-60s-50.json`. "The extreme show" is 600 s with 1000 cues at the particle cap.

| Setting | Default | Range | What it adjusts | Higher | Lower |
|---|---|---|---|---|---|
| `SeekBudgetMs` | 25 | 4–100 | Milliseconds of simulation the builder runs in each animation frame while it seeks (a scrub, a jump, or catching up after an edit). The rest of the frame goes to drawing and input. | A seek finishes sooner, but the page gets choppier while it runs. 25 ms is about 30 fps while catching up, and the total time is about what the old fixed 480-step slice took (about 1.5 s to the end of the 60 s show). Near 100 the page stalls on a slow machine, which is what the old slice did on the extreme show (about 2 s per frame, frozen for about 2.5 minutes). | The page stays smooth, but a seek takes longer. At 8 ms, seeking to the end of the 60 s show took about 3.3 s at about 60 fps, and the extreme show took about 6 minutes, smooth throughout. |
| `CatchingUpDelayMs` | 300 | 0–5000 | How long a seek must run before the "Catching up…" notice appears. | Short seeks never flash the notice, but a long one goes unexplained for longer. At 2000 a 1.5 s seek shows no notice at all. | The notice appears sooner. At 0 it flickers on for every seek, even ones that end in the next frame. |
| `CheckpointIntervalSeconds` | 10 | 1–60 | Show time between the snapshots the builder takes, so that a later seek can start from the nearest snapshot instead of from 0 s. This is TimelineDriver's `checkpointSteps` divided by 120. | Fewer snapshots and less memory, but a seek can have up to this much show time left to simulate after it lands on one. | Seeks land closer to their target, so they finish faster, but there are more snapshots and more memory, and the cap below is reached sooner. |
| `CheckpointMemoryMiB` | 64 | 8–512 | The memory cap for those snapshots (TimelineDriver's `checkpointBytes`). When the snapshots would go over it, the builder spaces them further apart. One snapshot is at most about 2.56 MB. | More snapshots fit before spacing widens, so busy shows seek faster, but the tab can hold more memory. | Less memory, but busy shows get sparser snapshots and slower seeks. Under 64 MiB the extreme show widened its spacing from 10 s to 40 s and peaked at 35.6 MiB; a lower cap widens it further. |

Once snapshots exist, the median seek was about 0.14 s for 600 s of presets and about 3.6 s for the extreme show.

**Changing a setting.**

- **Locally:** edit the value in `appsettings.json` and restart the API. To try a value without editing the file, set an environment variable for that run, using `__` between the section and the key:
  ```bash
  ClientPlayback__SeekBudgetMs=40 dotnet run --project src/api/Fireworks.Api
  ```
- **On Railway:** add a service variable, for example `ClientPlayback__SeekBudgetMs` = `40`. Saving it redeploys, and the new value applies once the deploy is live. Remove the variable to go back to the committed value.
- **Then reload the page.** The SPA reads these settings once, when the page loads, so an open tab keeps the old values until it is reloaded. If the values arrive late in a tab that is already open, the two checkpoint values (`CheckpointIntervalSeconds`, `CheckpointMemoryMiB`) apply only to shows opened after they arrive; a show already open keeps its snapshot spacing until it is reopened (`yoshi-phase7-architecture-rulings.md` §2).

**Out-of-range values.** The API refuses to start if any value is outside its range or isn't a whole number. It exits before it touches the database, with a message that names the key, for example `ClientPlayback:SeekBudgetMs must be between 4 and 100 (milliseconds per frame).` On Railway that shows up as a failed deploy, and the previous deploy keeps serving. The browser also clamps each value to the same range, so a bad value can't reach the builder even if it gets through.

### Migrations

Migrations live in `src/api/Fireworks.Api/Data/Migrations` and are applied automatically on startup, so there is no separate migration step. To add one, run from the API project directory, because the design-time factory reads `appsettings*.json` from the current directory:

```bash
cd src/api/Fireworks.Api
dotnet ef migrations add <Name> --output-dir Data/Migrations
```

### Frontend

Run these from `src/web/fireworks-web`, with Node 26.5.0 first on your PATH (`nvm use`; the repo's `.nvmrc` pins it):

```bash
npm ci
npm start                    # http://localhost:4200, proxies /api and /health to :5180
npm test -- --watch=false
npm run typecheck            # type-checks app and spec tsconfigs separately (the root tsconfig checks nothing)
npm run build                # writes src/api/Fireworks.Api/wwwroot (emptied at the start of every build)
npm run format
```

- **Pixi canary:** the home page at `/` draws a small Pixi canvas. Pixi is only in the lazily loaded canary chunk, never in the initial bundle.
- **Never ship a build made with `--stats-json`.** It writes `browser-stats.json` into `wwwroot`, where it would be served publicly.

## Testing

```bash
# Backend: everything except the Postgres-gated tests, which report as Skipped
dotnet test Fireworks.slnx

# Backend, including the Postgres-gated tests (needs `docker compose up -d postgres`)
FIREWORKS_TEST_POSTGRES="Host=localhost;Port=5433;Database=fireworks_test;Username=fireworks_app;Password=fireworks_dev_password" \
  dotnet test Fireworks.slnx

# Only the Postgres-gated tests
FIREWORKS_TEST_POSTGRES="..." dotnet test Fireworks.slnx --filter "Category=Postgres"
```

**Point `FIREWORKS_TEST_POSTGRES` at its own database (`fireworks_test` above), never at the dev `fireworks` database.** The Postgres-gated tests drop and recreate whatever database the string names.

**Run the Postgres-gated tests before calling backend work done.** They are the only tests that apply the real migrations, and the only ones that run the real `Program.cs` pipeline (`ProgramOnPostgresTests` launches the built API as a child process). The Kestrel harness in `Controllers/FireworksApiHarness.cs` repeats Program.cs's pipeline rather than running it, so a line deleted from `Program.cs` (the `/api/{**rest}` 404, the health check mapping) passes a plain `dotnet test` and fails only the gated run. That was measured; see the table below.

Frontend test commands are in [Frontend](#frontend).

### Restoring a mutated file: reset its timestamp

Mutation testing here is manual: copy the file aside, break it, run the suite, restore, confirm green. After restoring a copy, **`touch` the file.** A copy that preserves the original timestamp leaves the source older than the assembly built from the mutant, MSBuild skips the rebuild, and the next `dotnet test` runs the mutant against your restored source.

```bash
f=src/api/Fireworks.Api/Program.cs
cp "$f" /tmp/Program.cs.bak     # back up
# ...mutate $f, dotnet test, observe which tests fail...
cp /tmp/Program.cs.bak "$f"     # restore
touch "$f"                      # REQUIRED, or the mutant still runs
dotnet test Fireworks.slnx
```

### Verify the verifier

Every command above is a verification step, and a check that has never been seen failing may not be checking anything (standing decision, `.squad/decisions/records/toad-verify-the-verifier.md`). **Each one needs a recorded negative control: make it fail on purpose and keep the result.** Run them at adoption, and again whenever a command's configuration changes.

| Command | Negative control | Result |
|---|---|---|
| `dotnet build Fireworks.slnx` | add a C# file containing `int x = "str"` | `error CS0029`, `Build FAILED`, exit 1 (2026-11-12, Bowser; .NET 11 SDK, net10.0 target). **Re-run by Toad 2026-11-12:** same result. **Re-run on net11.0 (Bowser 2026-11-12):** same |
| `dotnet test Fireworks.slnx` | `DefaultUserCurrentUser.CanWrite => true` | 1 failed (`Me_reports_…canWrite_from_config(False)`), 25 passed, 3 skipped (2026-11-12, Bowser). **Re-run by Toad 2026-11-12:** same result. **Re-run on net11.0 (Bowser 2026-11-12):** same |
| `dotnet test Fireworks.slnx` | accept `Guid.Empty` in `IdentityRegistration.ReadDefaultUserOptions` | 2 failed (the unit rule and the real-Program startup test), 24 passed (2026-11-12, Bowser). **Re-run on net11.0 (Bowser 2026-11-12):** same |
| `dotnet test Fireworks.slnx` | delete the `/api/{**rest}` line from the test harness | 1 failed (`Unknown_api_path_is_404_and_not_the_spa_index`), 25 passed (2026-11-12, Bowser). **Re-run on net11.0 (Bowser 2026-11-12):** same |
| `dotnet test` with `FIREWORKS_TEST_POSTGRES` | delete `app.Map("/api/{**rest}", …)` from `Program.cs` | 1 failed (`ProgramOnPostgresTests`: expected NotFound, got OK), 28 passed. **A plain `dotnet test` passes this mutant.** (2026-11-12, Bowser). **Re-run on net11.0 (Bowser 2026-11-12):** same, both runs |
| `dotnet test` with `FIREWORKS_TEST_POSTGRES` | delete `app.MapHealthChecks("/health/live")` from `Program.cs` | 1 failed (expected `text/plain`, got `text/html`), 28 passed (2026-11-12, Bowser). **Re-run by Toad 2026-11-12:** same; and the same mutant under a plain `dotnet test` passes 26, skips 3. **Re-run on net11.0 (Bowser 2026-11-12):** same, both runs |
| `dotnet test` with `FIREWORKS_TEST_POSTGRES` | skip `EnsureDefaultUserExistsAsync` in `FireworksDbInitializer.InitializeAsync` | 3 failed, 26 passed (2026-11-12, Bowser). **Re-run on net11.0 (Bowser 2026-11-12):** same |
| `dotnet test Fireworks.slnx` | Phase 4 creation mutants, each in a scratch copy (2026-11-13, Bowser). Failed counts out of 530 run, 10 skipped | key pattern `\z`→`$`: 1 · drop `double.IsFinite`: 4 · no gate in `UpdateOwnedAsync`: 3 · DELETE without the owner predicate: 2 · PUT load without the owner predicate: 1 · duplicate keys never reported: 7 · envelope duplicates unreported: 1 · no `COLLATE "C"`: 1 (pending model changes) · `stars` max 401: 11 · `remixedFrom` for everyone: 2 · `string.Trim()`: 3 · no 100-issue cap: 2 · `regex(...)` route constraint back: 2 · body check always "is JSON" (the `[Consumes]` gap): 4 · list offset in `int`: 5 · a `GlobalLimiter`: 175 |
| `dotnet test Fireworks.slnx` | Phase 4 QA re-run and new mutants, each in a scratch copy (2026-11-13, Toad). Failed counts out of 530 (533 after Toad's 3 tests), 10 skipped | Bowser's re-run, same counts: DELETE without the owner predicate: 2 · no gate in `UpdateOwnedAsync`: 3 · `remixedFrom` for everyone: 2 · list offset in `int`: 5. New: `updatedAt` not stamped on Modified: 3 · remix owned by the source owner: 2 · retry returns false on a non-unique failure: 1 · remix without `RemixedFromId`: 1. **Survived the original suite, plain and Postgres:** palette not recomputed on PUT, list without `.ThenBy(ShareCode)` (the index already yields ordinal ties), no `DbUpdateConcurrencyException` catch on PUT, service ignoring a null update. Each now fails 1 (`CreationUpdateEdgeTests`, `CreationListOrderSqlTests`) |
| `dotnet test` (fixture harness) | in a scratch copy, edit one `server-only/` expectation: drop one of two errors, repeat one error, change a path, remove `byteMarkers`, remove `contentType`, 413 to 400 | each fails its fixture's theory row (the last also fails the status-coverage fact) (2026-11-13, Toad) |
| `dotnet test` with `FIREWORKS_TEST_POSTGRES` | delete `app.UseRateLimiter()` from `Program.cs` | 1 failed (`Real_program_rate_limits_writes…`), 539 passed. **A plain `dotnet test` passes this mutant**, because the harness has its own pipeline (2026-11-13, Bowser) |
| `dotnet test` with `FIREWORKS_TEST_POSTGRES` | drop the `Connection: close` on the reader's 413 | 4 failed (3 harness 413 tests, plus the real-Program fixture run, where the next request after `oversize` got "response ended prematurely"), 536 passed (2026-11-13, Bowser) |
| `npm test` | delete the `if (this.destroyed) { handle.destroy(); return; }` guard in `PixiCanaryComponent.start()` | 1 failed (`destroyed while init is pending…`), 26 passed (2026-11-12, Luigi). **Re-run by Toad 2026-11-12:** same |
| `npm test` | `SessionService.canWrite` true for any loaded user (`this.user() !== null`) | 3 failed (2 `session.spec`, 1 `home.spec`), 24 passed (2026-11-12, Luigi). **Re-run by Toad 2026-11-12:** same |
| `npm test` | `app.config.ts` initializer stops calling `SessionService.load()` | 1 failed (`App cold start (real appConfig)` ledger), 27 passed (2026-11-12, Toad). Before `app.startup.spec.ts` existed, every spec passed this mutant |
| `npm test` | home page constructor also calls `session.load()` (a duplicate `api/me`) | 3 failed (2 `home.spec` via `verify()`, 1 cold-start ledger), 25 passed (2026-11-12, Toad) |
| `npm test` | template typo `session.canWriteTypo()` in `home.html` | build step fails, `TS2551 … Did you mean 'canWrite'?`, exit 1 (2026-11-12, Toad) |
| `npm run typecheck` | `export const toadMutant: number = 'str'` appended to an app file (`core/health.ts`) | `TS2322` from `tsconfig.app.json`, exit 2 (2026-11-12, Toad; Luigi reported the same with his own break) |
| `npm run typecheck` | the same line appended to a spec file (`core/health.spec.ts`) | `TS2322` from `tsconfig.spec.json`, exit 2 (2026-11-12, Toad; Luigi reported the same with his own break) |
| `npm run typecheck` | template typo `session.canWriteTypo()` in `home.html` | **passes (exit 0).** `tsc` does not see templates; `npm test` and `npm run build` catch it. Known limit, not a defect (2026-11-12, Toad) |
| `npm run build` | template typo `session.canWriteTypo()` in `home.html` | `[ERROR] TS2551`, exit 1 (2026-11-12, Toad) |

A verification command with no negative control is an assumption, not a check.

## Shipping

The repo-root `Dockerfile` has three stages:

1. `node:26-alpine` builds the Angular app into `src/api/Fireworks.Api/wwwroot`.
2. `dotnet/sdk:11.0` publishes **`src/api/Fireworks.Api/Fireworks.Api.csproj`, never `Fireworks.slnx`**. The solution also contains the test project, which would drag SQLite and the test packages into the image.
3. `dotnet/aspnet:11.0` runs it as the image's non-root `app` user (`USER $APP_UID`), with Kestrel bound to `${PORT:-8080}` over HTTP. TLS ends at the platform edge.

`appsettings.Development.json` is excluded from publish (`CopyToPublishDirectory="Never"`), so an image started with `ASPNETCORE_ENVIRONMENT=Development` fails at startup instead of turning anonymous writes on.

To check the image locally against the compose Postgres:

```bash
docker build -t fireworks-api .
docker run --rm -p 8080:8080 \
  -e ASPNETCORE_ENVIRONMENT=Production \
  -e "ConnectionStrings__Postgres=Host=host.docker.internal;Port=5433;Database=fireworks;Username=fireworks_app;Password=fireworks_dev_password" \
  fireworks-api
curl -i http://localhost:8080/health/live    # 200 text/plain "Healthy"
curl -i http://localhost:8080/health/ready   # 200 text/plain "Healthy"; 503 "Unhealthy" when the database is unreachable
```

(Host port 8080 is often taken on a dev machine; map `-p 127.0.0.1:18080:8080` instead.)

### Health checks

- **`/health/live`** runs no checks. It is Railway's probe (`railway.toml`) and restarts the app when it fails, so it never depends on the database. Never rate limited.
- **`/health/ready`** opens one database connection, gives up after 3 s, and answers `200 Healthy` or `503 Unhealthy`, text/plain, status word only. Point an uptime monitor here, not at the probe path. It counts toward the read limit (120 a minute per IP).
- Both are answered by the health checks, never by the SPA fallback. Any near-miss path (`/health`, `/health/ready/x`) gets `index.html` with 200, so a monitor must use the exact path and expect `text/plain`.

### Response headers and caching (Phase 7)

One middleware sets these on every response, including static files, the SPA, `/api`, health and errors (`Services/ResponseHeaders.cs`; requirements in `.squad/decisions/records/boo-phase7-security-requirements.md`):

- An **enforced** `Content-Security-Policy`: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`. Scripts are strict (no inline script, no `eval`); the SPA build complies because Pixi loads `pixi.js/unsafe-eval` and `inlineCritical` is off. **Widening any directive needs a decision record with the violation as evidence.**
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and USB. No `Server` header (off in Kestrel, so its own 400 and 431 don't send it either).
- `Strict-Transport-Security: max-age=31536000` only when the request is HTTPS (behind the edge, `X-Forwarded-Proto: https`) and the environment isn't Development.

| Response | `Cache-Control` |
|---|---|
| Hashed bundles (`main-`, `chunk-`, `styles-`, `polyfills-` + an 8-character hash) | `public, max-age=31536000, immutable` |
| `index.html`, every SPA deep link, other static files (`favicon.svg`, `3rdpartylicenses.txt`) | `no-cache` (revalidated with the ETag, so usually a 304) |
| `GET api/creations/{code}` 200 and 304 | `private, no-cache` |
| Every other `/api` response, a static miss (`/nope.js`), a 405 | `no-store` |
| `/health/live`, `/health/ready` | `no-store, no-cache` (the framework's) |

`/s/<anything>` and `/c/<anything>` always get the app, even with a dot in the last segment (`/c/..%2Fme`), so a mangled link shows the app's not-found page. Other dotted paths that aren't files are a bare 404.

**Never add response compression or request decompression to the app.**

Two log lines on a **first** boot against an empty database are expected, not errors. Don't chase them on Railway either:

- `Cannot load library libgssapi_krb5.so.2` means Npgsql is probing for Kerberos support, which the `aspnet` image doesn't ship. Password authentication doesn't use it.
- `fail: Microsoft.EntityFrameworkCore.Database.Command[20102] … FROM "__EFMigrationsHistory"` is EF checking for its history table before the first migration has created it. It's followed by `Applying migration '…_InitialCreate'`.

### Deploying to Railway (deferred)

Phase 1d is deferred: nothing has been created on Railway yet. When it happens, this is the checklist.

1. Create a Railway project from this repository. Railway reads `railway.toml`: it builds with the `Dockerfile`, probes **exactly** `/health/live`, and restarts on failure. A near-miss probe path such as `/health` is answered by the SPA fallback with 200 text/html and would pass forever.
2. Add the **Postgres** service to the project.
3. On the app service, set these variables:

   | Variable | Value |
   |---|---|
   | `ASPNETCORE_ENVIRONMENT` | `Production` |
   | `ConnectionStrings__Postgres` | `Host=${{Postgres.PGHOST}};Port=${{Postgres.PGPORT}};Database=${{Postgres.PGDATABASE}};Username=${{Postgres.PGUSER}};Password=${{Postgres.PGPASSWORD}}` |
   | `Identity__AllowAnonymousWrites` | **Leave unset** (it means `false`). Set it to `true` only during a [test window](#test-windows-switching-writes-on), then delete it again (decided, plan §5 OQ20). While true, anyone who reaches the URL can list, overwrite and delete every creation. |

   Compose the connection string from the Postgres service's individual variables as shown. **Do not use `${{Postgres.DATABASE_URL}}`**: it is a `postgresql://` URI, and Npgsql can't parse that form. `ConnectionStrings__Postgres` is deliberately absent from `appsettings.json`, so a deploy that forgets it fails at startup with `ConnectionStrings:Postgres must be configured.` instead of half-starting.
4. Push to the connected branch. Migrations apply themselves on startup, so a bad migration is a failed deploy rather than a manual recovery. **Run one replica.** Every replica migrates on start, with no lock between them, so two replicas starting against an empty (or behind) database can race the same migration and one crashes with Postgres `42P07` (relation already exists) (Boo F5). The rate limiter is per replica as well. Scaling out needs a migration lock or a separate migrate step first.
5. Verify on the Railway URL (Phase 1 "Done when"):
   - `/health/live` returns `200`, `text/plain`, `Healthy`; `/health/ready` returns the same (and is what an uptime monitor should watch).
   - Every Phase 7 header and cache check passes through the edge ([Response headers and caching](#response-headers-and-caching-phase-7)), including HSTS over HTTPS and `Connection: close` on a chunked over-limit write.
   - A deep link such as `/designer` returns `index.html`.
   - `/api/nope` returns `404`.
   - `/api/me` returns `canWrite: false`.
   - The Pixi canary renders.
   - The deploy log shows `Applying migration '…_InitialCreate'` and `'…_AddCreations'` on the first boot.
   - **Client IP behind the edge** (Boo S21, closes Phase 1 condition 4). (a) From one machine, send 121 `GET /api/creations/abcdefgh`, each with a different forged `X-Forwarded-For: 203.0.113.N`; the 121st must be `429` (the forged header doesn't change the partition). (b) Right after, from a second network (a phone hotspot), one GET must be `404`, not `429` (the partition isn't one global bucket). If either fails, stop and raise it: the limiter is spoofable or a global kill switch.
   - **The edge's own body limit** (Boo S5) with writes off: a 200 KiB JSON body to `POST /api/creations` must reach the app and get `403`, not an edge `413`. The 413 itself is checked in the first test window (below).

### Test windows (switching writes on)

Production writes stay off until Phase 8 (plan §5 OQ20). To test saving on Railway:

1. **Back up first** ([Backups and restore](#backups-and-restore)), and note the creations row count and `max(updated_at)`.
2. Set `Identity__AllowAnonymousWrites=true` on the app service. The deploy log then shows `Anonymous writes are ON`, so every window is visible in the logs.
3. Test. In the first window, also check the 413 through the edge (Boo S5): `curl -sv -H 'Content-Type: application/json' --data-binary @300k.json https://<host>/api/creations`, with and without `-H 'Transfer-Encoding: chunked'`. Record what the client sees (413 ProblemDetails, an edge-generated error, or a reset) and confirm a compact `schema/fixtures/valid/show/at-maximums.json` body (about 190 KB) gets 201.
4. **Delete the variable** (don't set it to `false` and forget it) and let Railway redeploy.
5. Confirm `GET /api/me` reports `canWrite: false` and `GET /api/me/creations` returns `403`.
6. Compare the creations row count and `max(updated_at)` with what the window should have produced. If they differ, restore from the dump.
7. Never post the URL publicly during a window.

### Backups and restore

Rehearsed locally against the compose database (2026-11-15: dump, restore into an empty database, then the same creations row count, `max(updated_at)`, user count and migration count). Phase 7 gate rehearsal (2026-11-15, Mario), on the gate image's database `fireworks_gate7`: a 6,625-byte custom-format dump, restored into an empty `fireworks_gate7_restored` in about 1 s. Source and restore both gave 2 creations, `max(updated_at)` `2026-11-15 23:22:31.623056+00`, 1 user and 2 applied migrations. Railway's own scheduled backups are not switched on yet: Railway is deferred, so that part is **[R]**.

**Back up** (custom format, restorable into any empty database):

```bash
# Local compose database. pg_dump runs inside the container, so its version matches the server.
docker exec fireworks-postgres pg_dump -U fireworks_app -d fireworks --format=custom --no-owner > fireworks-$(date +%Y%m%d-%H%M).dump

# Railway [R]: use the Postgres service's public connection URL (DATABASE_PUBLIC_URL in its
# Variables tab; never commit or paste it anywhere). Run pg_dump 18 from the postgres:18 image.
docker run --rm postgres:18 pg_dump "$RAILWAY_DATABASE_PUBLIC_URL" --format=custom --no-owner > fireworks-railway-$(date +%Y%m%d-%H%M).dump
```

Then record what the dump should contain:

```bash
docker exec fireworks-postgres psql -U fireworks_app -d fireworks -Atc \
  "select (select count(*) from creations), (select max(updated_at) from creations), (select count(*) from users)"
```

**Restore** into an **empty** database, never over a live one:

```bash
docker exec fireworks-postgres psql -U fireworks_app -d postgres -c "CREATE DATABASE fireworks_restored"
docker exec -i fireworks-postgres pg_restore -U fireworks_app -d fireworks_restored --no-owner --exit-on-error < fireworks-YYYYMMDD-HHMM.dump
docker exec fireworks-postgres psql -U fireworks_app -d fireworks_restored -Atc \
  "select (select count(*) from creations), (select max(updated_at) from creations), (select count(*) from users)"
```

The three numbers must match the ones recorded at backup time. To put the restored data into service, point `ConnectionStrings__Postgres` at the restored database (on Railway: restore into the service's database only after stopping the app, or into a new Postgres service and switch the variable). The app migrates on start, so a dump from an older schema is brought forward automatically; a dump from a newer schema than the deployed code is not supported.

### Takedown runbook

Use this to remove one creation, for example a share link reported as abusive. Writes being off doesn't matter: this runs in SQL, not through the API.

1. **Back up first** (above). A takedown can't be undone otherwise.
2. **Look at it, and at its remixes.** Remixes are separate creations with their own codes, and they may carry the same content. Deleting the original sets their `remixed_from_id` to null, so list them first. Replace `abcd2345` with the reported code (share codes are case-sensitive):

   ```sql
   SELECT share_code, kind, name, owner_user_id, created_at, updated_at
   FROM creations WHERE share_code = 'abcd2345';

   SELECT share_code, name FROM creations
   WHERE remixed_from_id = (SELECT id FROM creations WHERE share_code = 'abcd2345');
   ```

3. **Delete exactly that row, in a transaction:**

   ```sql
   BEGIN;
   DELETE FROM creations WHERE share_code = 'abcd2345' RETURNING share_code, name;
   -- Exactly one row must come back. If it's 0 or more than 1, ROLLBACK and stop.
   COMMIT;
   ```

   Locally: `docker exec -it fireworks-postgres psql -U fireworks_app -d fireworks`. On Railway **[R]**: the Postgres service's Data tab, or `psql "$RAILWAY_DATABASE_PUBLIC_URL"`. Repeat for any remix that also has to go.
4. **Verify:**
   - `SELECT count(*) FROM creations WHERE share_code = 'abcd2345';` is 0, and the total row count went down by exactly one per deleted code.
   - `curl -i https://<host>/api/creations/abcd2345` is `404` with `{"message":"No creation has that share code."}` and `Cache-Control: no-store`.
   - `https://<host>/s/abcd2345` in a browser shows the app's "not found" page. A browser that had the creation cached gets the 404 too: the share-code GET is `private, no-cache`, so every view revalidates, and no shared cache holds it.

If `AllowedHosts` is ever tightened from `*`, keep `healthcheck.railway.app` in the list: Railway's deploy probe sends that Host header, and a 400 means the deploy never goes live.

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
```

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
   | `Identity__AllowAnonymousWrites` | **Leave unset** (it means `false`). Set it to `true` only while testing saves, then delete it again (decided, plan §5 OQ20). While true, anyone who reaches the URL can edit or delete every creation — don't share the URL during that window. |

   Compose the connection string from the Postgres service's individual variables as shown. **Do not use `${{Postgres.DATABASE_URL}}`**: it is a `postgresql://` URI, and Npgsql can't parse that form. `ConnectionStrings__Postgres` is deliberately absent from `appsettings.json`, so a deploy that forgets it fails at startup with `ConnectionStrings:Postgres must be configured.` instead of half-starting.
4. Push to the connected branch. Migrations apply themselves on startup, so a bad migration is a failed deploy rather than a manual recovery.
5. Verify on the Railway URL (Phase 1 "Done when"):
   - `/health/live` returns `200`, `text/plain`, `Healthy`.
   - A deep link such as `/designer` returns `index.html`.
   - `/api/nope` returns `404`.
   - `/api/me` returns `canWrite: false`.
   - The Pixi canary renders.
   - The deploy log shows `Applying migration '…_InitialCreate'` on the first boot.

If `AllowedHosts` is ever tightened from `*`, keep `healthcheck.railway.app` in the list: Railway's deploy probe sends that Host header, and a 400 means the deploy never goes live.

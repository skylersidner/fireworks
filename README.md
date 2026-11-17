# Fireworks Sandbox

A web app for designing, saving, sharing and playing fireworks shells and timed shows in the browser. It grew out of the single-file PixiJS prototype in `prototypes/fireworks-prototype.html` and runs on Angular 22 + PixiJS 8, a .NET 11 API and Postgres 18. It is meant to be deployed on Railway.

Anyone can design and play without an account. Saving, "My creations" and every other write need a Google sign-in.

| Page | What it is |
|---|---|
| `/` | The Shell Designer |
| `/show` | The Show Builder (a timeline of cues) |
| `/s/<code>` | The player for a shared shell or show |
| `/c/<code>` | Opens a shared creation as an editable working copy, then redirects to `/` or `/show` |
| `/mine` | My creations (needs sign-in) |
| `/signin` | The sign-in page |
| `/status` | API and session status |

- **Plan:** [`plans/initial-implementation.md`](plans/initial-implementation.md), the source of truth for scope.
- **Background:** [`docs/fireworks-app/context.md`](docs/fireworks-app/context.md).
- **Creation schema and API contract:** [`docs/fireworks-app/schema.md`](docs/fireworks-app/schema.md).
- **Team:** work is coordinated as described in [`CLAUDE.md`](CLAUDE.md). The team is defined in `.claude/agents/`, and its memory, decisions and skills are in `.squad/`.

## Project structure

- `Fireworks.slnx`: the solution (API and API tests).
- `src/api/Fireworks.Api`: the ASP.NET Core API (`net11.0`). It serves the Angular build from its own `wwwroot`, so production is a single origin.
- `src/api/Fireworks.Api.Tests`: xUnit backend tests (SQLite in memory, Kestrel harnesses, Postgres-gated tests).
- `src/web/fireworks-web`: the Angular 22 app. Its production build is written straight into `src/api/Fireworks.Api/wwwroot`.
- `schema/`: the shared validation fixtures and limits used by both test suites.
- `tools/`: the test runner, browser gates, stub OAuth server, mutant runner, fingerprints and benchmarks. None of it ships.
- `docker-compose.yml`: local Postgres 18 (container `fireworks-postgres`, host port **5433**, loopback only).
- `Dockerfile`, `railway.toml`: the shipping image and its Railway deploy config.
- `prototypes/`: the original prototype, the visual and behavioural reference. Not part of the image.

## Toolchain

- .NET SDK 11 (11.0.100 or later). The API and tests target `net11.0`. EF Core stays on 10.x until Npgsql ships a stable 11.x; the comment in `Fireworks.Api.csproj` explains why.
- Node 26.5.0 (pinned in `.nvmrc`; `package.json` requires `>=26.5.0 <27`) and npm 11.
- Docker with Compose, for Postgres.
- `dotnet-ef` is a local tool pinned in `dotnet-tools.json`. Run `dotnet tool restore` once.

## Quick start

1. (Optional) Copy `.env.example` to `.env` and adjust the credentials. If you change them, change `ConnectionStrings:Postgres` in `src/api/Fireworks.Api/appsettings.Development.json` to match.
2. Start Postgres:
   `docker compose up -d postgres`
3. In its own terminal, start the stub sign-in server, a local stand-in for Google (see [Sign-in](#sign-in)):
   `node tools/fake-oauth/server.mjs --interactive`
4. Start the API on http://localhost:5180. It applies migrations on startup:
   `dotnet run --project src/api/Fireworks.Api`
5. Start the Angular dev server (more commands in [Frontend](#frontend)):
   `cd src/web/fireworks-web && npm ci && npm start`
6. Open http://localhost:4200. The dev server proxies `/api` and `/health` to the API on 5180.

**That is the whole development loop.** `ng serve` gives hot reload, and the proxy makes the app single-origin, as it is in production. `docker build` is for shipping only and is never part of iterating.

| Port | Used by |
|---|---|
| 4200 | `ng serve` |
| 5180 | the API (`launchSettings.json`, `http` profile; the `https` profile adds 7180) |
| 5190 | the stub OAuth server, on 127.0.0.1 |
| 5433 | Postgres (compose) |
| 8080 | the Docker image (`$PORT`, default 8080); map it to 18080 if 8080 is taken |

> **Port 4200 is shared with Monster of the Week's frontend,** so don't run the two frontends at the same time. The API (5180) and Postgres (5433) ports don't collide with it.

> **Don't use `npm run watch` as a development loop.** It has no hot reload, doesn't refresh the browser, and, because `outputPath` points at the API's `wwwroot`, it overwrites the production build with an unoptimised development one.

> **If you delete `src/api/Fireworks.Api/wwwroot`, also run `dotnet clean` (or delete `obj/` and `bin/`).** The Web SDK records `wwwroot` in the generated static-web-assets manifest, which is read inside `WebApplication.CreateBuilder(...)`. A manifest pointing at a missing directory makes the app fail at startup with `System.IO.DirectoryNotFoundException`. A fresh clone is unaffected.

`wwwroot` is a build artifact. It is gitignored and excluded from the Docker build context.

### Frontend

Run these from `src/web/fireworks-web`, with Node 26.5.0 first on your `PATH` (`nvm use`):

```bash
npm ci
npm start                    # http://localhost:4200, proxies /api and /health to :5180
npm run test:regular         # every spec except *.daily.spec.ts and *.final.spec.ts
npm run typecheck            # type-checks the app and spec tsconfigs separately (the root tsconfig checks nothing)
npm run build                # writes src/api/Fireworks.Api/wwwroot (emptied at the start of every build)
npm run format               # prettier --write; format:check only checks
npm run fixtures:check       # the shared schema fixtures match their generator
```

- Pixi is never in the initial bundle or a page chunk. The stage loads it through its own dynamic import, as a separate lazy chunk, only when a stage mounts.
- **Never ship a build made with `--stats-json`.** It writes `browser-stats.json` into `wwwroot`, where it would be served publicly.

### Migrations

Migrations live in `src/api/Fireworks.Api/Data/Migrations` and apply automatically on startup; there is no separate migration step. To add one, run from the API project directory, because the design-time factory reads `appsettings*.json` from the current directory:

```bash
cd src/api/Fireworks.Api
dotnet ef migrations add <Name> --output-dir Data/Migrations
```

## Sign-in

Sign-in is **Google only**, with a cookie session. The API stores only `external_provider = 'google'`, Google's `sub` and the display name, never an email, picture or token. It asks Google for the `openid` and `profile` scopes only.

**The session.** The cookie is `__Host-fw.session` outside Development and `fw.session` in Development (plain http, so no `Secure`). It is `HttpOnly`, `SameSite=Lax`, lasts 30 days and slides (it is renewed once more than half its life has passed). It holds one claim, your `users.id`. The key ring that protects it is stored in the `data_protection_keys` table, so a restart doesn't sign anyone out. Signing out deletes this browser's cookie; a copied cookie stays valid until it expires.

### Local development: the stub (default)

`appsettings.Development.json` points Google at the stub, `tools/fake-oauth/server.mjs`, on `127.0.0.1:5190`. The committed pair `fireworks-stub-client` / `stub-secret-not-a-credential` is a placeholder, not a credential. The stub really checks the client, the redirect URI, PKCE and single-use codes, so a green sign-in means something.

- `--interactive` shows a page with "Continue as dev-alice", "Continue as dev-bob" and "Cancel", so you can try two accounts in two browser profiles.
- Without the flag it signs in as `dev-user` straight away (or as `FAKE_OAUTH_SUBJECT`).
- `--port <n>` changes the port; the API's endpoint settings must then match.
- At startup the API logs `Sign-in uses stub OAuth endpoints (127.0.0.1:5190). Never in production.` whenever it uses the stub. If no Google client is configured at all (possible only in Development and Testing), it logs that sign-in isn't configured and saving is unavailable.

The sign-in round trip goes through the `ng serve` proxy. The proxy keeps the `Host` header (there is no `changeOrigin` in `proxy.conf.json`, and none may be added; a contract spec fails if one is), so the redirect URI and the CSRF check both see `localhost:4200`.

### Local development: your own Google client (optional)

1. Open https://console.cloud.google.com and create a project (for example "Fireworks dev").
2. Go to **Google Auth Platform** (menu → APIs & Services → OAuth consent screen) → **Get started**. Enter an app name and your email as the support address, choose the **External** audience, add your email as the contact, and accept the policy.
3. In **Audience**, leave the publishing status on **Testing** and add your Google account under **Test users**. Only test users can sign in while the app is in testing.
4. In **Data access**, add the scopes `openid` and `…/auth/userinfo.profile`. Don't add `email`. Both are non-sensitive, so no verification is needed.
5. In **Clients** → **Create client**, choose **Web application** and add these **Authorized redirect URIs**, exactly, including the port (Google accepts plain `http` only for `localhost`):
   - `http://localhost:4200/api/auth/callback/google` (the `ng serve` loop)
   - `http://localhost:5180/api/auth/callback/google` (the API on its own)
   - `http://localhost:8080/api/auth/callback/google` (the Docker image; use the host port you map)
   - when you deploy: `https://<domain>/api/auth/callback/google`

   No JavaScript origins are needed.
6. Copy the client ID and client secret. The console shows the secret once, so download the JSON as well.
7. Store them as user-secrets, and blank the stub endpoints (an empty value means Google's default):

   ```bash
   cd src/api/Fireworks.Api
   dotnet user-secrets set "Auth:Providers:Google:ClientId" "<id>.apps.googleusercontent.com"
   dotnet user-secrets set "Auth:Providers:Google:ClientSecret" "<secret>"
   dotnet user-secrets set "Auth:Providers:Google:AuthorizationEndpoint" ""
   dotnet user-secrets set "Auth:Providers:Google:TokenEndpoint" ""
   dotnet user-secrets set "Auth:Providers:Google:UserInformationEndpoint" ""
   ```

   To go back to the stub, run `dotnet user-secrets clear`. Never put a real secret in a committed file; a test fails if one appears.

## Testing

### Test tiers

There are four tiers, all started from one entry point. The design and its reasoning are in [`docs/fireworks-app/testing-strategy.md`](docs/fireworks-app/testing-strategy.md). Run from the repo root with Node 26.5.0 first on your `PATH` (`nvm use`). The runner checks this before any step: if `node --version` doesn't satisfy `engines.node` in `src/web/fireworks-web/package.json` (`>=26.5.0 <27`), it exits 2 and says so. The browser steps need `npm ci` once in `tools/browser-gates` (Playwright 1.65.0, pinned; Chromium runs as the installed Google Chrome). Every tier except `quick` needs Postgres (`docker compose up -d postgres`) and exits 2 without it.

```bash
node tools/test/run.mjs quick      # dev loop, not a gate
node tools/test/run.mjs regular    # every change
node tools/test/run.mjs daily      # manual, before a sign-off
node tools/test/run.mjs final      # end-of-project review: daily + benchmarks, at-maximums, uncached docker build
node tools/test/daily-status.mjs   # is the newest daily (or final) run green, complete and < 24 h old?
node tools/test/run.mjs <tier> --list   # print a tier's steps (daily and final also list the browser steps)
```

| Tier | What it runs | Expected time |
|---|---|---|
| `quick` | `prettier --check` on changed web files, `npm run typecheck`, `ng test --include` on the specs impacted by your changes (sibling specs plus the folder map in `tools/test/impact.json`), and `dotnet build` plus `dotnet test --filter` on the matching test classes when C# changed | 15–30 s for a leaf change; about 100 s when the change touches the engine |
| `regular` | `format:check`, `fixtures:check`, typecheck, `test:regular`, `ng build`, `dotnet build`, the Postgres-gated `dotnet test`, then the [Chromium smoke](#the-chromium-smoke) | about 3–4 min |
| `daily` | everything in `regular` except the smoke, then `test:daily` (`*.daily.spec.ts`) and the browser steps in `tools/browser-gates/daily-steps.mjs`: the header checks, the Chromium gates with their negative controls (CSP, keyboard, touch, reduced motion, follow, `gate-auth`, virtual-time player, real-time 66 s round trip), the CSP and round-trip gates and the fidelity walks in Firefox and WebKit, and the T2 fingerprints in three engines | about 21–22 min. Keep the machine awake (`caffeinate -dims`): a closed lid can stall a run for hours of timeouts |
| `final` | everything in `daily`, plus `test:final` (`*.final.spec.ts`), the `at-maximums` fingerprint in three engines, the report-only benchmarks (`gate-warm`, `tools/bench/bench.mjs`) and an uncached `docker build` | about 32 min (32.4 min on the first full run, 2026-11-17). Keep the machine awake, as for `daily` |

How the runner behaves:
- It prints one line per step with its time, and a summary table at the end. Every step's full output, plus `run.log` and `summary.json`, goes under `test-results/<tier>/<stamp>/` (gitignored).
- `quick` and `regular` stop at the first failing step (unless `--keep-going`); `daily` and `final` run every step.
- Exit codes: 0 means every gating step passed, 1 means one failed, 2 means a usage or setup error (for example, Postgres not running, or the wrong Node version).
- Options: `--list`, `--only a,b`, `--skip a,b`, `--keep-going`, and `--hook` (quick only).
- **There are no automatic retries.** A test that fails and then passes on an unchanged tree is logged in `tools/test/quarantine.json` with an owner and a cause. It keeps running in the daily tier until it is fixed or deleted.
- `unit-web` prints the slowest spec file and warns about any file over 30 s or any test over 5 s. These are warnings; they never fail the run.

**Databases and servers.** Each run gets its own databases and drops them at the end: `fireworks_test_<tier>_<pid>` for the Postgres `dotnet test`, and `fireworks_smoke_<tier>_<pid>` for the browser steps. The dev database `fireworks` is never touched. The browser steps start their own API on a free port on 127.0.0.1: the built `Fireworks.Api.dll`, serving the `ng build` output from `wwwroot`, as **`ASPNETCORE_ENVIRONMENT=Testing`**. Testing has every non-Development behaviour (the real headers and CSP, `Secure` `__Host-` cookies) but still allows the stub, which Production refuses. Sign-in points at a fresh `tools/fake-oauth` stub on 127.0.0.1. The runner stops that API when the steps finish and doesn't touch anything else that is running (the dev API on 5180, `ng serve` on 4200). To use a server that is already running, set `SMOKE_BASE=http://127.0.0.1:<port>`; it must run as Testing with the stub configured, or the header checks fail.

### The Chromium smoke

`tools/browser-gates/smoke.mjs` is the last step of the regular tier, about 80–90 s including the API start. It signs in through the stub (in Node for the HTTP checks, and through the real redirect flow in Chromium), then runs these steps in Chromium with the real CSP. Every step must pass.

| Step | Script | Checks | About |
|---|---|---|---|
| `headers` | `headers.py main` | about 290 header and caching checks: site headers, CSP, `Cache-Control`, 304s, 413, health | 1 s |
| `roundtrip` | `gate-roundtrip.mjs` with `SKIP_PLAY=1` | builder edit, Save, Share, GET equals POST, and the Show JSON round trip | 20 s |
| `player-vt` | `player-virtual-time.mjs` | the 10 s show played to its end under Playwright virtual time, Replay to its end, then the frozen-clock negative control | 13 s |
| `csp` | `gate-csp.mjs` | zero CSP violations on all nine pages | 17 s |
| `csp-neg` | `gate-csp.mjs` with `MODE=none` | the negative control on three pages: each must show a blocked script | 7 s |
| `auth` | `gate-auth.mjs` | CSRF from same-site and cross-site loopback pages (a no-cors POST, a cross-origin DELETE and a form POST to logout each get 403 or are blocked by the browser; the session and the list are unchanged); zero CSP violations across the real `/signin` → stub → `/mine` flow; the two-account walk (`walk-alice` and `walk-bob` can't edit, delete or list each other's creations, through the browser); the signed-out Save path (Save opens the sign-in dialog with focus on the Google button and writes nothing; after sign-in through the stub the draft is byte-identical, the "Signed in as" toast shows, focus is on Save and nothing is written; then Save gets 201); and Sign out (both local drafts byte-identical, the only write the logout 204). Its negative controls run in `daily`. | 35 s |

Run a subset with `SMOKE_ONLY=headers,auth`.

### Running the daily suite

It runs only when you start it; there is no scheduler and no CI.
1. Start Postgres and leave the machine otherwise idle (one heavy job at a time; the final tier's benchmarks are only comparable at load ≤ 6).
2. Run `node tools/test/run.mjs daily`. The result goes to `test-results/daily/<stamp>/summary.json`.
3. Check it with `node tools/test/daily-status.mjs`.

How daily steps are judged:
- **Fail the run:** every Chromium gate and its negative control; the Firefox and WebKit runs of `gate-csp` (each page loads with no violations or errors and the stage runs) and `gate-roundtrip` (save, share, Show JSON, and the real-time play to the end); every fingerprint run step (a crash or timeout) and the Chromium fingerprint compare; in `final`, also the uncached `docker build`.
- **Report only:** the Firefox and WebKit keyboard, reduced-motion and follow walks (fidelity, not "does it run"); the Firefox and WebKit fingerprint compares; in `final`, the benchmarks.

WebKit stores no `Secure` cookie on plain http, so it can't sign in on the Testing instance. Its round trip plays a show saved from Node and copies its Show JSON anonymously; a fresh Chromium profile applies and saves it.

To re-run only the browser half against a server you started yourself, use `BASE=… node tools/browser-gates/daily.mjs` (add `TIER=final` for the final-only browser steps).

**The 24-hour rule.** A sign-off needs a daily (or final) run that is green, complete and less than 24 h old, unless the project owner accepts the specific failure in writing. `daily-status.mjs` exits 0 only in that case. It reads the newest run across `daily` and `final`, so a later red or partial run is never hidden behind an older green one. A run started with `--only` or `--skip` is marked incomplete and never counts. The output shows the commit the run used, and says so if `HEAD` has moved since. A complete, green `final` run also satisfies the rule, because it runs every daily step.

### Mutants, benchmarks and the pre-commit hook

**Mutants** (`tools/mutants/run.mjs`; details in [`tools/mutants/README.md`](tools/mutants/README.md)) run when a test is replaced, before signing off a change to the code a set covers, and at the final review. They don't run daily, and they run serially.
- `--list` shows the sets and their mutants.
- `--check <set>` reports which mutants no longer apply to the current code.
- `<set> [ids]` copies the repo into `test-results/mutants/` (the shared tree is never mutated), checks that a baseline passes, then runs each exact-swap mutant against only the specs that can kill it.
- **A timeout is never a kill:** a run whose only failures are timeouts is reported as `TIMEOUT`, not `KILLED`.
- A mutant marked `postgres: true` runs only when `FIREWORKS_MUTANT_POSTGRES` names a database ending in `_mut` or `_test`; otherwise it reports `SKIPPED` and the run exits 3.

**The seek benchmark** is `node tools/bench/bench.mjs [shows] [caps]` ([`tools/bench/README.md`](tools/bench/README.md)). It runs in Node with no render and is report-only; in the tiers it runs only in `final`. Record `uptime` with every number.

**The pre-commit hook is opt-in** and never installed automatically. `sh tools/test/install-hook.sh` installs it. On each commit it runs `run.mjs quick --hook`: `prettier --check` on the staged web files, then typecheck (about 15 s). It never runs `ng test`. Skip it once with `git commit --no-verify`, or remove it with `rm .git/hooks/pre-commit`.

### Backend test commands

```bash
# Everything except the Postgres-gated tests, which report as Skipped
dotnet test Fireworks.slnx

# Including the Postgres-gated tests (needs `docker compose up -d postgres`)
FIREWORKS_TEST_POSTGRES="Host=localhost;Port=5433;Database=fireworks_test;Username=fireworks_app;Password=fireworks_dev_password" \
  dotnet test Fireworks.slnx

# Only the Postgres-gated tests
FIREWORKS_TEST_POSTGRES="..." dotnet test Fireworks.slnx --filter "Category=Postgres"
```

**Point `FIREWORKS_TEST_POSTGRES` at its own database (`fireworks_test` above), never at the dev `fireworks` database.** The Postgres-gated tests drop and recreate whatever database the string names.

**Run the Postgres-gated tests before calling backend work done.** They are the only tests that apply the real migrations, and the only ones that run the real `Program.cs` pipeline (`Data/ProgramOnPostgresTests.cs` launches the built API as a child process). The Kestrel harness in `Controllers/FireworksApiHarness.cs` repeats Program.cs's pipeline rather than running it, so deleting a line from `Program.cs` (the `/api/{**rest}` 404, a health check mapping, `UseRateLimiter()`) passes a plain `dotnet test` and fails only the gated run. The regular tier always runs the gated tests.

**After restoring a mutated C# file, `touch` it.** A copy that preserves the original timestamp leaves the source older than the assembly built from the mutant, MSBuild skips the rebuild, and the next `dotnet test` runs the mutant against your restored source. (`tools/mutants/run.mjs` works on its own copy, so this is for manual mutation only.)

```bash
f=src/api/Fireworks.Api/Program.cs
cp "$f" /tmp/Program.cs.bak     # back up
# ...mutate $f, dotnet test, observe which tests fail...
cp /tmp/Program.cs.bak "$f"     # restore
touch "$f"                      # REQUIRED, or the mutant still runs
dotnet test Fireworks.slnx
```

### Verify the verifier

A check that has never been seen failing may not be checking anything. **Every verification command needs a recorded negative control: make it fail on purpose and keep the result.** Run it when the check is adopted, and again whenever its configuration changes. A verification command with no negative control is an assumption, not a check.

Where the controls live:
- **Browser gates:** each script's header comment documents its controls (`NEG=…`, `MODE=none`, `NEG_*`, `TOAD_*`, `PAUSE=0`, `HEADERS_NEG=1`), and the daily tier runs them as steps that must exit 1 and print their catch. `node tools/test/run.mjs daily --list` marks them `control`. See [`tools/browser-gates/README.md`](tools/browser-gates/README.md).
- **Fingerprints:** `FP_NEG=bump` and `FP_NEG=crash` ([`tools/fingerprints/README.md`](tools/fingerprints/README.md)).
- **Unit and API tests:** the mutant sets in `tools/mutants/sets/`.

Two known limits worth remembering:
- A plain `dotnet test` doesn't catch a line deleted from `Program.cs`; only the Postgres-gated run does (above).
- `npm run typecheck` doesn't see templates. A template typo such as `session.canWriteTypo()` passes it; `npm test` and `npm run build` catch it.

## Configuration

Settings come from `appsettings.json`, `appsettings.Development.json` (local only; never published), user-secrets in Development, and environment variables, which use `__` between levels (`Auth__Providers__Google__ClientId` is `Auth:Providers:Google:ClientId`).

| Key | Where it's set | Notes |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | `launchSettings.json` (Development); the deployment (`Production`) | `Testing` is used by the test runner and for checking the image locally |
| `ConnectionStrings__Postgres` | `appsettings.Development.json` locally; a variable in a deployment | An Npgsql `key=value` string, **not** a `postgresql://` URI. Deliberately absent from `appsettings.json`, so a deploy that forgets it fails at startup with `ConnectionStrings:Postgres must be configured.` |
| `Auth__Providers__Google__ClientId`, `__ClientSecret` | the stub pair in `appsettings.Development.json`; user-secrets for a real dev client; variables in a deployment | Required outside Development and Testing |
| `Auth__Providers__Google__AuthorizationEndpoint`, `__TokenEndpoint`, `__UserInformationEndpoint` | `appsettings.Development.json` (the stub) | Stub overrides, honoured only in Development and Testing. Blank means Google's default |
| `ClientPlayback__*` | `appsettings.json` | See [Playback tuning](#playback-tuning-clientplayback) |
| `RateLimits__Writes__PerMinute` (20), `RateLimits__Writes__PerDay` (300), `RateLimits__Reads__PerMinute` (120), `RateLimits__Auth__PerMinute` (20) | code defaults | Tests change them; production needs none. Each must be positive |
| `AllowedHosts` | `appsettings.json` (`*`) | If it is ever tightened, keep `healthcheck.railway.app` in the list: Railway's deploy probe sends that `Host`, and a 400 means the deploy never goes live |

**The API refuses to start**, before it touches the database, with a message naming the key, when:
- `ConnectionStrings:Postgres` is missing;
- outside Development and Testing, the Google client id or secret is missing or is the stub placeholder, or any stub endpoint override is set;
- any `Identity__*` variable is present (that section no longer exists; delete such variables);
- a `ClientPlayback` value is out of range or not a whole number, or a `RateLimits` value isn't positive.

### Playback tuning (`ClientPlayback`)

Five settings in `src/api/Fireworks.Api/appsettings.json` tune how the Show Builder seeks, catches up and warms up. The API serves them at `GET /api/client-config` (see [API reference](#api-reference)). Production and Development use the same values, so the section is only in `appsettings.json`.

Treat the timings below as rough: they come from measurement runs on one machine, and an older machine will be slower. "The 60 s show" is the 50-cue fixture `schema/fixtures/valid/show/done-when-60s-50.json`. "The extreme show" is 600 s with 1000 cues at the particle cap.

| Setting | Default | Range | What it adjusts | Higher | Lower |
|---|---|---|---|---|---|
| `SeekBudgetMs` | 25 | 4–100 | Milliseconds of simulation the builder runs in each animation frame while it seeks (a scrub, a jump, or catching up after an edit). The rest of the frame goes to drawing and input. | A seek finishes sooner, but the page gets choppier while it runs. At 25 ms the page runs at about 30 fps while catching up, and seeking to the end of the 60 s show takes about 1.5 s. Near 100 the page stalls on a slow machine (on the extreme show, about 2 s per frame). | The page stays smooth, but a seek takes longer. At 8 ms, seeking to the end of the 60 s show took about 3.3 s at about 60 fps, and the extreme show took about 6 minutes, smooth throughout. |
| `CatchingUpDelayMs` | 300 | 0–5000 | How long a seek must run before the "Catching up…" notice appears. | Short seeks never flash the notice, but a long one goes unexplained for longer. At 2000 a 1.5 s seek shows no notice at all. | The notice appears sooner. At 0 it flickers on for every seek, even ones that end in the next frame. |
| `CheckpointIntervalSeconds` | 10 | 1–60 | Show time between the snapshots the builder takes, so that a later seek can start from the nearest snapshot instead of from 0 s. | Fewer snapshots and less memory, but a seek can have up to this much show time left to simulate after it lands on one. | Seeks land closer to their target, so they finish faster, but there are more snapshots and more memory, and the cap below is reached sooner. |
| `CheckpointMemoryMiB` | 64 | 8–512 | The memory cap for those snapshots. When the snapshots would go over it, the builder spaces them further apart. One snapshot is at most about 2.56 MB. | More snapshots fit before spacing widens, so busy shows seek faster, but the tab can hold more memory. | Less memory, but busy shows get sparser snapshots and slower seeks. Under 64 MiB the extreme show widened its spacing from 10 s to 40 s and peaked at 35.6 MiB; a lower cap widens it further. |
| `WarmUpDelayMs` | 1000 | 0–5000 | How long the builder waits, with no edit and no seek, before it starts warming up: simulating the rest of the show in the background so that later seeks start from a nearby snapshot. Each edit or seek restarts the wait. | Less background CPU while you edit in bursts, but the first seeks after a pause are cold for longer. | Warm-up starts sooner after each change, but during continuous editing it keeps restarting and spends CPU on snapshots the next edit throws away. At 0 it starts at once, with no wait. |

Once snapshots exist, the median seek was about 0.14 s for 600 s of presets and about 3.6 s for the extreme show.

**Changing a setting.**

- **Locally:** edit the value in `appsettings.json` and restart the API. To try a value without editing the file, set an environment variable for that run:
  ```bash
  ClientPlayback__SeekBudgetMs=40 dotnet run --project src/api/Fireworks.Api
  ```
- **On Railway:** add a service variable, for example `ClientPlayback__SeekBudgetMs` = `40`. Saving it redeploys, and the new value applies once the deploy is live. Remove the variable to go back to the committed value. An out-of-range value stops startup with a message such as `ClientPlayback:SeekBudgetMs must be between 4 and 100 (milliseconds per frame).`; on Railway that is a failed deploy, and the previous deploy keeps serving.
- **Then reload the page.** The SPA reads these settings once, when the page loads, so an open tab keeps the old values until it is reloaded. If the values arrive late in a tab that is already open, the two checkpoint settings apply only to shows opened after they arrive.

The browser also clamps each value to the same range, so a bad value can't reach the builder even if it gets past the API.

## API reference

The contract is [`docs/fireworks-app/schema.md`](docs/fireworks-app/schema.md): §2 for the envelope, status codes and rate limits, §6 for validation, §9 for share codes, §11 for links and Save. `src/api/Fireworks.Api/Fireworks.Api.http` exercises the endpoints. Swagger UI is available in Development only.

### Identity and sign-in

| Endpoint | What it does |
|---|---|
| `GET /api/auth/login/google?returnUrl=/show` | A top-level navigation (never a form or `fetch`): 302 to Google. `returnUrl` must be a safe internal path, else `/`. Any other provider id is an empty 404. 20 a minute per IP. |
| `/api/auth/callback/google` | Answered by the Google handler. Success sets the session cookie and 302s to `returnUrl`. Cancel goes to `/signin?error=cancelled&returnUrl=…`; any other failure to `/signin?error=failed&returnUrl=…` (`returnUrl` is left out when the login state can't be read). |
| `POST /api/auth/logout` | Always 204, with a deleting `Set-Cookie`. 20 a minute per IP, shared with login. |
| `GET /api/me` | Anonymous allowed. `{ userId, displayName, isAuthenticated, canWrite, signedInWith }`; signed out it is `null, null, false, false, null`. `canWrite` always equals `isAuthenticated`; `signedInWith` is `"google"` or `null`. |
| `GET /api/client-config` | Anonymous, read-only, `no-store`. `{ playback: { seekBudgetMs, catchingUpDelayMs, checkpointIntervalSeconds, checkpointMemoryMiB, warmUpDelayMs }, loginProviders: [{ "id": "google", "name": "Google" }] }`. `loginProviders` is empty only in Development or Testing with no Google client configured. |

**Writes.** Every unsafe request (any method except GET, HEAD, OPTIONS and TRACE) on any path is refused with **403** when the browser says it came from another origin (`Sec-Fetch-Site` other than `same-origin`, or a foreign `Origin`). There is no CORS policy in any environment. Every write, and `GET api/me/creations`, needs a session: signed out, it is **401** (never a redirect).

### Creations

| Endpoint | Does | Status codes |
|---|---|---|
| `POST api/creations` | body `{ kind, document }`; creates a creation owned by you | 201, 400, 401, 403, 413, 415, 429 |
| `GET api/creations/{shareCode}` | public, no sign-in needed; `ETag` and `If-None-Match` (below) | 200, 304, 404, 429 |
| `PUT api/creations/{shareCode}` | body `{ document }`; owner only, validated against the stored kind; needs `If-Match` | 200, 400, 401, 403, 404, 412, 413, 415, 428, 429 |
| `DELETE api/creations/{shareCode}` | owner only | 204, 401, 403, 404, 429 |
| `POST api/creations/{shareCode}/remix` | body `{ document }` (the edited working copy); a new creation owned by you with `remixedFrom` set; any source | 201, 400, 401, 403, 404, 413, 415, 429 |
| `GET api/me/creations?page&pageSize&kind` | your creations, `updatedAt` descending, then `shareCode` | 200, 400, 401, 429 |

- **Order of checks on a write:** the cross-origin guard (403), sign-in (401), the rate limit (429), `If-Match` missing on a PUT (428), `Content-Type` (415, missing or non-JSON), size (413, over 256 KiB), the envelope and parse (400), the lookup (404), the document walk (400), then the `If-Match` comparison on a PUT (412). A creation you don't own is a 404, byte-identical to an unknown code: `{"message":"No creation has that share code."}`. A malformed share code is the empty `/api` 404.
- **400 body:** exactly `{ message, errors: [{ path, code, message }], truncated }`, with at most 100 issues.
- **`If-Match` on PUT:** send the `ETag` you last read. Without it: **428**. Stale, `*`, a list, a weak tag or a `-p` tag: **412**, with the current `ETag`.
- **ETag:** every response carrying a creation (the GET, POST, PUT and remix) sends a strong tag built from the body's `updatedAt` string exactly as serialized: `"<updatedAt>"` for the owner, `"<updatedAt>-p"` for everyone else. The GET answers `If-None-Match` (any listed tag by weak comparison, or `*`) with a bodiless 304 carrying the same `ETag` and `Cache-Control`. The lookup and the read limit come first.
- **Caching:** the share-code GET's 200 and 304 are `Cache-Control: private, no-cache` with `Vary: Cookie`: kept out of shared caches and revalidated on every view, so an "Update original" shows up on the next load. Every other `/api` response, that GET's 404 and 429 included, is `no-store`.
- **Body limits:** Kestrel's global limit is 64 KiB; the three write actions raise it to 256 KiB. Clients send compact JSON: the largest valid show is about 185 KB compact and over 256 KiB pretty-printed. A response to a body the server can't drain (a declared length over the limit, or a chunked body) carries `Connection: close`. A chunked body has its framing counted toward the limit, so one somewhat under 256 KiB of JSON can still get 413; browsers send `Content-Length`, so this rarely matters.
- **No form binding:** MVC's form value providers are removed for the whole API (`AddFireworksControllers`), so a `multipart/form-data` or urlencoded body is never parsed before the write checks.

### Rate limits

Fixed windows, in memory, per replica, reset on deploy. Reads and writes are keyed by user when signed in, otherwise by client IP (IPv6 by its /64); login and logout are always by IP. A 429 carries `Retry-After`.

| Policy | Limit | Endpoints |
|---|---|---|
| Writes | 20 a minute **and** 300 a day | `POST api/creations`, `PUT` and `DELETE api/creations/{code}`, `POST …/remix` |
| Reads | 120 a minute | `GET api/creations/{code}`, `api/me/creations`, `api/me`, `api/client-config`, `/health/ready`, and unknown `/api` paths |
| Auth | 20 a minute per IP | `GET api/auth/login/{provider}`, `POST api/auth/logout` |
| None | never limited | `/health/live`, static files, the SPA |

**Behind a proxy, the limiter is only as good as the client IP it sees.** Forwarded headers are trusted one hop deep outside Development; check it on the first deploy ([checklist](#deploying-to-railway), step 5).

### Health checks

- **`/health/live`** runs no checks. It is Railway's probe (`railway.toml`) and restarts the app when it fails, so it never depends on the database. Never rate limited.
- **`/health/ready`** opens one database connection, gives up after 3 s, and answers `200 Healthy` or `503 Unhealthy`, text/plain, the status word only. Point an uptime monitor here, not at the probe path. It counts toward the read limit.
- Both are answered by the health checks, never by the SPA fallback. A near-miss path (`/health`, `/health/ready/x`) gets `index.html` with 200, so a monitor must use the exact path and expect `text/plain`.

### Response headers and caching

One middleware (`src/api/Fireworks.Api/Services/ResponseHeaders.cs`) sets these on every response, including static files, the SPA, `/api`, health and errors:

- An **enforced** `Content-Security-Policy`: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`. Scripts are strict (no inline script, no `eval`); the SPA build complies because Pixi loads `pixi.js/unsafe-eval` and `inlineCritical` is off. **Widening any directive needs a decision record with the violation as evidence.**
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and USB. No `Server` header (it's off in Kestrel, so Kestrel's own 400 and 431 don't send it either).
- `Strict-Transport-Security: max-age=31536000`, only when the request is HTTPS (behind the edge, `X-Forwarded-Proto: https`) and the environment isn't Development.

| Response | `Cache-Control` |
|---|---|
| Hashed bundles (`main-`, `chunk-`, `styles-`, `polyfills-` + an 8-character hash) | `public, max-age=31536000, immutable` |
| `index.html`, every SPA deep link, other static files (`favicon.svg`, `3rdpartylicenses.txt`) | `no-cache` (revalidated with the ETag, so usually a 304) |
| `GET api/creations/{code}` 200 and 304 | `private, no-cache` |
| Every other `/api` response, a static miss (`/nope.js`), a 405, a handled exception | `no-store` |
| `/health/live`, `/health/ready` | `no-store, no-cache` (the framework's) |

`/s/<anything>` and `/c/<anything>` always get the app, even with a dot in the last segment (`/c/..%2Fme`), so a mangled link shows the app's not-found page. Other dotted paths that aren't files are a bare 404.

**Never add response compression or request decompression to the app.**

## Operations

### The shipping image

The repo-root `Dockerfile` has three stages:

1. `node:26-alpine` builds the Angular app into `src/api/Fireworks.Api/wwwroot`.
2. `dotnet/sdk:11.0` publishes **`src/api/Fireworks.Api/Fireworks.Api.csproj`, never `Fireworks.slnx`**. The solution also contains the test project, which would drag SQLite and the test packages into the image.
3. `dotnet/aspnet:11.0` runs it as the image's non-root `app` user (`USER $APP_UID`), with Kestrel bound to `${PORT:-8080}` over HTTP. TLS ends at the platform edge.

`appsettings.Development.json` is excluded from publish, so an image started with `ASPNETCORE_ENVIRONMENT=Development` fails at startup instead of pointing sign-in at the stub. `.dockerignore` keeps `wwwroot`, `tools/`, `schema/`, docs and team files out of the build context.

To check the image locally against the compose Postgres, run it as **Testing** with the stub. (Production refuses the stub; Production with real Google needs your own client, set up as above.) The browser goes to the stub's authorize page on `localhost:5190`; the container makes the token and userinfo calls through `host.docker.internal`:

```bash
docker build -t fireworks-api .
node tools/fake-oauth/server.mjs &        # 127.0.0.1:5190
docker run --rm -p 8080:8080 \
  -e ASPNETCORE_ENVIRONMENT=Testing \
  -e "ConnectionStrings__Postgres=Host=host.docker.internal;Port=5433;Database=fireworks;Username=fireworks_app;Password=fireworks_dev_password" \
  -e Auth__Providers__Google__ClientId=fireworks-stub-client \
  -e Auth__Providers__Google__ClientSecret=stub-secret-not-a-credential \
  -e Auth__Providers__Google__AuthorizationEndpoint=http://localhost:5190/authorize \
  -e Auth__Providers__Google__TokenEndpoint=http://host.docker.internal:5190/token \
  -e Auth__Providers__Google__UserInformationEndpoint=http://host.docker.internal:5190/userinfo \
  fireworks-api
curl -i http://localhost:8080/health/live    # 200 text/plain "Healthy"
curl -i http://localhost:8080/health/ready   # 200 text/plain "Healthy"; 503 "Unhealthy" when the database is unreachable
```

If host port 8080 is taken, map `-p 127.0.0.1:18080:8080` and use 18080. Sign in on that image in **Chromium or Firefox**: they store `Secure` `__Host-` cookies from `http://localhost` and `http://127.0.0.1`, and WebKit stores none.

Two log lines on a **first** boot against an empty database are expected, not errors, locally and on Railway:

- `Cannot load library libgssapi_krb5.so.2`: Npgsql probing for Kerberos support, which the `aspnet` image doesn't ship. Password authentication doesn't use it.
- `fail: Microsoft.EntityFrameworkCore.Database.Command[20102] … FROM "__EFMigrationsHistory"`: EF checking for its history table before the first migration has created it. It's followed by `Applying migration '…_InitialCreate'`.

### Backups and restore

The procedure below has been rehearsed locally: dump, restore into an empty database, then compare the creations row count, `max(updated_at)`, the user count and the migration count. When you deploy to Railway, also switch on Railway's scheduled backups for the Postgres service.

> **A backup is a credential.** The `data_protection_keys` table holds the unencrypted key ring that protects session cookies, so anyone with a dump can forge a session for any user. Keep dumps on your machine, and don't share or upload them. Encrypt the keys (`ProtectKeysWith*`) before backups leave the machine or Railway, before a second person or app gets database read access, and before anything sensitive is stored.

**Back up** (custom format, restorable into any empty database):

```bash
# Local compose database. pg_dump runs inside the container, so its version matches the server.
docker exec fireworks-postgres pg_dump -U fireworks_app -d fireworks --format=custom --no-owner > fireworks-$(date +%Y%m%d-%H%M).dump

# Railway: use the Postgres service's public connection URL (DATABASE_PUBLIC_URL in its
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

The three numbers must match the ones recorded at backup time. To put the restored data into service, point `ConnectionStrings__Postgres` at the restored database (on Railway: restore into the service's database only after stopping the app, or restore into a new Postgres service and switch the variable). The app migrates on start, so a dump from an older schema is brought forward automatically; a dump from a newer schema than the deployed code is not supported.

### Takedown runbook

Use this to remove one creation, for example a share link reported as abusive. It runs in SQL, not through the API, so it works whoever owns the creation.

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

   Locally: `docker exec -it fireworks-postgres psql -U fireworks_app -d fireworks`. On Railway: the Postgres service's Data tab, or `psql "$RAILWAY_DATABASE_PUBLIC_URL"`. Repeat for any remix that also has to go.
4. **Verify:**
   - `SELECT count(*) FROM creations WHERE share_code = 'abcd2345';` is 0, and the total row count went down by exactly one per deleted code.
   - `curl -i https://<host>/api/creations/abcd2345` is `404` with `{"message":"No creation has that share code."}` and `Cache-Control: no-store`.
   - `https://<host>/s/abcd2345` in a browser shows the app's "not found" page. A browser that had the creation cached gets the 404 too: the share-code GET is `private, no-cache`, so every view revalidates, and no shared cache holds it.

### Claiming legacy creations (local databases only)

A database created before Google sign-in existed holds creations owned by a legacy default user, `6933f933-a9e9-443b-b7c7-6e3e01901a34`. No sign-in can ever resolve to that user, so those creations are read-only: their links still play, and nobody can edit or delete them. A fresh database, including a new Railway one, has none, so skip this there. To make them yours:

1. Take a [backup](#backups-and-restore).
2. Sign in, open `/api/me` in the same browser, and copy your `userId`.
3. Run this in a transaction, and commit only if the counts match:

   ```sql
   BEGIN;
   SELECT count(*) FROM creations WHERE owner_user_id = '6933f933-a9e9-443b-b7c7-6e3e01901a34';
   UPDATE creations SET owner_user_id = '<your userId>' WHERE owner_user_id = '6933f933-a9e9-443b-b7c7-6e3e01901a34';
   -- the UPDATE's count must equal the SELECT's; otherwise ROLLBACK
   COMMIT;
   ```

   Open psql with `docker exec -it fireworks-postgres psql -U fireworks_app -d fireworks`. Leave the old `users` row in place. Cached copies revalidate on their own, because the `ETag` changes from the non-owner `-p` form to the owner form.

## Deploying to Railway

Nothing has been created on Railway yet. When you deploy, follow this checklist.

1. Create a Railway project from this repository. Railway reads `railway.toml`: it builds with the `Dockerfile`, probes **exactly** `/health/live` (300 s timeout), and restarts on failure (up to 10 retries). A near-miss probe path such as `/health` would be answered by the SPA fallback with 200 text/html and pass forever.
2. Add the **Postgres** service to the project.
3. Create a production Google client (or add to your dev one) with the redirect URI `https://<domain>/api/auth/callback/google`, following the [Google client steps](#local-development-your-own-google-client-optional). To let people other than the listed test users sign in, publish the app in **Audience**.
4. On the app service, set these variables:

   | Variable | Value |
   |---|---|
   | `ASPNETCORE_ENVIRONMENT` | `Production` |
   | `ConnectionStrings__Postgres` | `Host=${{Postgres.PGHOST}};Port=${{Postgres.PGPORT}};Database=${{Postgres.PGDATABASE}};Username=${{Postgres.PGUSER}};Password=${{Postgres.PGPASSWORD}}` |
   | `Auth__Providers__Google__ClientId` | the Google web client's id |
   | `Auth__Providers__Google__ClientSecret` | its secret, as a secret variable |

   Don't set any `Identity__*` variable or any `Auth__Providers__Google__*Endpoint` override: startup refuses both. **Don't use `${{Postgres.DATABASE_URL}}`**: it is a `postgresql://` URI, and Npgsql can't parse that form.
5. Push to the connected branch. Migrations apply themselves on startup, so a bad migration is a failed deploy rather than a manual recovery. **Run one replica.** Every replica migrates on start with no lock between them, so two replicas starting against an empty (or behind) database can race the same migration, and one crashes with Postgres `42P07` (relation already exists). The rate limiter is per replica as well. Scaling out needs a migration lock or a separate migrate step first.
6. Verify on the Railway URL:
   - `/health/live` returns `200`, `text/plain`, `Healthy`; `/health/ready` returns the same, and is what an uptime monitor should watch.
   - Every header and cache rule in [Response headers and caching](#response-headers-and-caching) holds through the edge, including HSTS over HTTPS and `Connection: close` on a chunked over-limit write. (`tools/browser-gates/headers.py` checks the same rules locally, on 127.0.0.1 only; through the edge, check them with `curl -i`.)
   - A deep link such as `/show` returns `index.html`, and `/api/nope` returns `404`.
   - `/api/me` returns `isAuthenticated: false, canWrite: false` anonymously. Sign-in round-trips through real Google, the session cookie keeps `Secure` and the `__Host-` name through the edge, and the log shows no `stub OAuth` warning.
   - The designer at `/` renders its stage.
   - The deploy log shows `Applying migration '…_InitialCreate'`, `'…_AddCreations'` and `'…_AddExternalIdentity'` on the first boot.
   - **Client IP behind the edge.** (a) From one machine, send 121 `GET /api/creations/abcdefgh`, each with a different forged `X-Forwarded-For: 203.0.113.N`; the 121st must be `429` (the forged header doesn't change the bucket). (b) Right after, from a second network (a phone hotspot), one GET must be `404`, not `429` (the bucket isn't global). If either fails, stop and raise it: the limiter is spoofable, or it is a global kill switch.
   - **The edge's own body limit.** An anonymous 200 KiB JSON body to `POST /api/creations` must reach the app and get `401`, not an edge `413`. Signed in, a 300 KB body gets the app's 413, and the compact `schema/fixtures/valid/show/at-maximums.json` document (about 185 KB) gets 201.
7. Switch on Railway's scheduled backups for the Postgres service, and take a first manual [backup](#backups-and-restore).

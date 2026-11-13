# Bowser — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phase 1a, 1c and 1d (API skeleton, identity foundation, Docker, compose, Railway), Phase 4 (creation persistence), and Phase 7 operations (caching, backups, runbook).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- OQ20 ruling: `Identity:AllowAnonymousWrites` is false in `appsettings.json` and true in Development. Railway env var `Identity__AllowAnonymousWrites` is toggled on only for testing. `api/me` includes `canWrite`.
- `.dockerignore` must exclude `.squad/`, `.claude/`, `plans/`, and `prototypes/`.
- `CreationListItem` carries the derived palette.
- Angular stays on port 4200. The API stays on 5180.

### 2026-11-12 — Phase 1a + 1c (API skeleton, identity foundation, containers)
- **Layout:** `Fireworks.slnx`; `src/api/Fireworks.Api/{Controllers/MeController.cs, Services/{ServiceResults.cs, MeService.cs, Identity/{IdentityOptions,ICurrentUser,DefaultUserCurrentUser,IdentityRegistration}.cs}, Repositories/UserRepository.cs, Contracts/ApiContracts.cs, Data/{FireworksDbContext,FireworksDbContextFactory,FireworksDbInitializer}.cs, Data/Entities/{ITimestamped,User}.cs, Data/Migrations/*_InitialCreate.cs}`. Tests: `src/api/Fireworks.Api.Tests/{Controllers/FireworksApiHarness.cs, Controllers/SkeletonEndpointTests.cs, Services/IdentityConfigurationTests.cs, Startup/{ProgramStartupTests,CommittedConfigurationTests}.cs, Data/{PostgresFactAttribute,PostgresCollection,InitialCreatePostgresTests,ProgramOnPostgresTests}.cs, Support/{ApiProcess,TempWebRoot,TestIdentity}.cs}`.
- **`ICurrentUser` carries `CanWrite`** (beyond the plan's two members). Phase 4 write endpoints gate on it. Record: `bowser-phase1-identity-foundation.md`.
- **Identity config is validated eagerly in `AddFireworksIdentity`**, before the DB is touched; not `ValidateOnStart()`.
- **Name collisions in the shared framework:** `IdentityServiceCollectionExtensions` (Microsoft.Extensions.DependencyInjection) is ambiguous (CS0433), so ours is `IdentityRegistration`. `IdentityOptions` also exists in Microsoft.AspNetCore.Identity (not imported); rename ours if Phase 8 adopts ASP.NET Identity.
- **Default user id** `6933f933-a9e9-443b-b7c7-6e3e01901a34` in appsettings.json; display name constant `FireworksDbInitializer.DefaultUserDisplayName = "Default user"`. Test id is deliberately different (`TestIdentity.UserId`).
- **Security pin:** EF Design 10.0.0 drags `System.Security.Cryptography.Pkcs` 9.0.0 (GHSA-2fmv-rv2c-59x7, GHSA-846f-f764-76mx). Pinned 10.0.13 in the API csproj, the lowest clean version (measured).
- **Tool manifest:** SDK 11's `dotnet new tool-manifest` wrote `dotnet-tools.json` at the repo root (not `.config/`). `dotnet-ef` 10.0.0 runs under `DOTNET_ROLL_FORWARD=Major` until the 10 runtime is installed.
- **Measured:** the harness re-implements the pipeline, so Program.cs mutants (dropping `/api/{**rest}` or `MapHealthChecks`) pass a plain `dotnet test`. Only `ProgramOnPostgresTests` (child process, real Program) catches them. Skill: `.squad/skills/real-program-process-test/SKILL.md`. Always run the gated suite before reporting done.
- **Postgres tests** use `Database=fireworks_test` on the compose server (5433); they drop whatever the string names.
- **Docker CLI here is 20.10**, which uses the classic builder unless `DOCKER_BUILDKIT=1`.

### 2026-11-12 — Phase 1 fix round (Boo, Yoshi, Toad findings)
- **Renamed** `IdentityOptions` → `DefaultUserOptions` (file `Services/Identity/DefaultUserOptions.cs`) and `IdentityRegistration.ReadIdentityOptions` → `ReadDefaultUserOptions`. Config section `Identity` and keys unchanged. Only identity module, initializer, Program.cs and tests reference it (Yoshi's boundary).
- **Dockerfile:** `USER $APP_UID` before CMD. Measured with a stub-frontend image: uid 1654 (`app`), binds 8080 and `PORT=9090` fine.
- **csproj:** `<Content Update="appsettings.Development.json" CopyToPublishDirectory="Never" />`. Published output with `ASPNETCORE_ENVIRONMENT=Development` dies on `ConnectionStrings:Postgres must be configured.`, and with a connection string supplied dies on `Cors:AllowedOrigins must be configured.` Fail closed both ways.
- **Pkcs** is in the Microsoft.AspNetCore.App shared framework (checked the 11.0.0 runtime dir); the pin is restore-graph/audit hygiene only.
- **`BuildHost-*` in publish** comes from `Microsoft.CodeAnalysis.Workspaces.MSBuild` contentFiles. Dropping `contentfiles` from EF Design's IncludeAssets does NOT remove it (measured), so it's not a one-liner; left alone.
- **Compose** binds `127.0.0.1:5433:5432`. `host.docker.internal` from a container still reaches it on Docker Desktop (measured).
- **ForwardLimit = 1** is now explicit in Program.cs, with the append-vs-overwrite deploy check noted.
- **macOS here has no `timeout`/`gtimeout`.** Use a background PID with a perl-sleep loop. zsh doesn't word-split `$var`, and `VAR=x;y cmd` with semicolons needs `env`.
- **Mutant hygiene:** trial changes go in an rsync copy under the scratchpad (excluding bin/obj/node_modules), never in the shared tree.

### 2026-11-12 — Retarget to .NET 11 (Skyler's ruling)
- **TFM `net11.0`** for API and tests; Docker `sdk:11.0` / `aspnet:11.0`. Only the 11.0.0 runtimes are installed here; nothing needs `DOTNET_ROLL_FORWARD` any more.
- **EF Core stays 10.x** because `Npgsql.EntityFrameworkCore.PostgreSQL` had no stable 11.x on 2026-11-12 (newest 11.0.0-rc.3; 10.0.3 depends on EF Core `[10.0.4, 11.0.0)`). Chosen: Npgsql EF 10.0.3, EF Design 10.0.15, EF Sqlite 10.0.15, dotnet-ef 10.0.15. Bump all four together when Npgsql 11 is stable. Microsoft EF 11.0.0 IS stable, so don't let anyone bump EF alone.
- **Swashbuckle 11.0.1** (has a net11.0 group). Program.cs uses only `AddSwaggerGen`/`UseSwagger`/`UseSwaggerUI`, so the Microsoft.OpenApi 2.x namespace change doesn't bite yet; it will if anyone adds `OpenApiInfo` etc.
- **Pins dropped:** `System.Security.Cryptography.Pkcs` (EF Design 10.0.15 no longer depends on it at all, per `dotnet nuget why`) and `SQLitePCLRaw.lib.e_sqlite3` 2.1.12 (EF Sqlite 10.0.15 brings 2.1.13, and the old pin then fails restore with NU1605 downgrade). Vulnerable-transitive audit is clean for both projects.
- **Likely correction to an earlier entry:** dotnet-ef 10.0.15's own runtimeconfig is `net8.0` with `rollForward: Major` (checked in ~/.nuget/packages), so it runs on the 11 runtime with no env var (10.0.0 probably did too; not re-checked); the manifest's `"rollForward": false` only governs tool-version roll-forward. Migration `ProductVersion` annotations still say 10.0.0; harmless (has-pending-model-changes reports none) and rewritten by the next `migrations add`.
- **Docker VM contention is real here:** about 1.4 of 1.9 GiB is held by other projects' containers (supabase/trivia/kraken), so `dotnet publish` inside `sdk:11.0` stalled for over 8 minutes after restore, and running gated Postgres tests during a build produced Npgsql read timeouts (false failures). Run the gated suite and mutants only when no build is running. For image checks while memory is short, publish on the host and wrap the output in an `aspnet:11.0`-only Dockerfile. Host port 8080 is taken by localstack, so map the container to 127.0.0.1:18080.
- Record: `.squad/decisions/records/bowser-net11-retarget.md`.

### 2026-11-12 — Phase 1 cross-agent update (Scribe)
- Railway (1d) is deferred by Skyler. Boo's condition 4 (whether the edge appends to or overwrites a client-sent `X-Forwarded-For`) needs a real deploy, so it is open. Phase 4's IP-partitioned limiter must not ship until it is checked.
- Luigi's rule "never ship a `--stats-json` build" is not enforced. Stage 1 of the Dockerfile copies all of `wwwroot` into stage 2, so a stray `browser-stats.json` would be served publicly. Consider a guard in the build (with Boo's Phase 7 CSP and headers review in mind).
- `history.md` line 24 still names `IdentityOptions`. The file is `Services/Identity/DefaultUserOptions.cs` since the fix round.

### 2026-11-13 — Phase 2 cross-agent update (Scribe)
- Phase 3 validator rule (Yoshi, `decisions/records/yoshi-phase2a-engine-boundaries.md`): a shell is valid only when the normalize walk returns `ok` with zero `adjustments`. Each adjustment becomes an error at the same path. Mirror the walk, the paths (`breaks[1].color1`, `sky.wind`, `name`, `version`) and the kinds (`defaulted | clamped | rounded | truncated | dropped`) exactly.
- The 80-character name limit counts code points, not UTF-16 units. In C#, count with `string.EnumerateRunes()`. `string.Length` is wrong for astral characters.
- Luigi's `ShellIssue.code` is TypeScript-side and open for Yoshi's schema doc. Don't add it to the C# model until Yoshi rules.

### 2026-11-13 — Phase 3 validator feasibility (scratch probes only)
- Record: `.squad/decisions/records/bowser-phase3-validator-feasibility.md`. Skill updated: `.squad/skills/cross-language-validator-parity/SKILL.md` (C# traps).
- **Measured on .NET 11.0.0:** `TryGetDouble` returns true with Infinity for `1e400` (check `double.IsFinite`); `AllowDuplicateProperties=false` throws with no path (detect dups in the walker instead, last value wins); `JsonDocument.Parse` accepts lone-surrogate escapes and invalid raw UTF-8; `GetString`, `JsonProperty.Name` and sometimes `ValueEquals` (`"\udc00\ud800"`) throw `InvalidOperationException`.
- **.NET `$` matches before a trailing `\n`**: key pattern and the share-code route constraint must end in `\z`. Route probe: `abcdefgh%0A` reached the action with `$`.
- **Body handling for creation writes:** read `Request.Body` in the action (`[Consumes("application/json")]`, `Utf8.IsValid`, then parse), not `[FromBody] JsonElement` (MVC ProblemDetails for bad JSON; invalid UTF-8 binds). `[RequestSizeLimit(262144)]` still gives 413 for Content-Length and chunked under `UseExceptionHandler` + `AddProblemDetails`.
- **Postgres 18.6 jsonb:** rejects `\u0000` and lone surrogate escapes, silently dedupes keys (last wins), keeps `1.0` as written (so store re-serialized DTO output). `varchar(n)` counts characters, so `name varchar(80)` fits 80 emoji.
- Compose Postgres user is `fireworks_app` (no `postgres` role): `docker exec -i fireworks-postgres psql -U fireworks_app -d postgres`.
- The Write tool turned some `\uXXXX` escapes in C# source into literal characters (U+2028 inside a char literal broke the build). Keep probe source ASCII and build non-ASCII from code points.
- Worst-case-ish show (1000 cues, 32×4 shells) is 78.9 KB and validates in about 5–8 ms.

# Bowser — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 1 and 3 are done. Next: Phase 4 (creation persistence and the C# validator), and Phase 7 operations (caching, backups, runbook).
- **Validator traps (Phase 3, summarized):** name length counts code points (`string.EnumerateRunes()`), never `Length`. The C# walker must mirror normalize's paths, kinds and codes exactly. Schema §6.3 now defines `code` on issues.
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

### 2026-11-13 — Phase 3 validator feasibility (scratch probes only)
- Record: `.squad/decisions/records/bowser-phase3-validator-feasibility.md`. The C# traps are in `.squad/skills/cross-language-validator-parity/SKILL.md`.
- **Measured on .NET 11.0.0:** `TryGetDouble` returns true with Infinity for `1e400` (check `double.IsFinite`). `AllowDuplicateProperties=false` throws with no path, so detect duplicates in the walker (last value wins). `GetString`, `JsonProperty.Name` and `ValueEquals` can throw on lone surrogates, so gate the body with `Utf8.IsValid` first.
- **.NET `$` matches before a trailing `\n`:** anchor key patterns and the share-code route constraint with `\z`.
- **Body:** read `Request.Body` in the action with `[Consumes("application/json")]`, not `[FromBody] JsonElement`.
- **Postgres 18.6 `jsonb`:** rejects `\u0000` and lone surrogate escapes; keeps the last value on duplicate keys; `varchar(80)` counts characters. The compose Postgres user is `fireworks_app` (no `postgres` role).
- Keep probe source ASCII. Worst-case show (1000 cues, 32×4 shells) is 78.9 KB and validates in 5–8 ms.

### 2026-11-13 — Phase 3 cross-agent update (Scribe)
- **Property-name paths overrule the raw-escape wording** (Yoshi addendum 1, point 6; schema.md §6.2 rule 11): plain names stay bare; others are `parent["name"]`, escaping only `\` and `"`, with unpaired surrogates as U+FFFD. Match `childPath` in `normalize.ts` and the rule-11 list in `src/web/fireworks-web/src/engine/model/normalize.spec.ts` (`describe('property names in paths (schema.md §6.2 rule 11)')`, around l.316).
- **Server-only wire format (Toad):** `schema/fixtures/server-only/*.json` is `{ description, body, status, errors?, contentType?, byteMarkers? }`; `status` is 400, 413 or 415. Send `contentType` when present, else `application/json`. Replace each `byteMarkers` key in `body` (UTF-8 encoded) with its hex bytes. Send the body bytes as read, never re-serialized, so duplicate keys survive. `schema/README.md` has the harness rules.
- **Phase 4 open for you:** the `.dockerignore` decision for `schema/` (Mario's gate note; Yoshi's boundary), and the paging contract (Yoshi addendum 2, point 7: `page` and `pageSize`, default 24, clamped 1..100; optional `kind`; order `updatedAt` desc then `shareCode`; index `(owner_user_id, updated_at desc, share_code)`). The 256 KiB limit, the manual body read and Kestrel's global limit are Boo's review.

### 2026-11-13 — Phase 4 (creations persistence)
- **Layout:** `Controllers/CreationsController.cs`; `Services/Creations/{CreationService,CreationDocumentValidator,CreationEnvelopeReader,JsonWalk,CreationDocuments,CreationLimits,CreationListQuery,ShareCodeGenerator,ShareCodes,ICreationRequestBody,CreationsRegistration}.cs`; `Services/RateLimiting/FireworksRateLimiting.cs`; `Services/{KestrelLimits,ApiResponseHeaders}.cs`; `Repositories/CreationRepository.cs`; `Data/Entities/Creation.cs`; migration `20261113202016_AddCreations`. Contracts: `Contracts/CreationContracts.cs`, plus `ValidationIssue`/`ValidationErrorResponse` in `ApiContracts.cs`. Record: `decisions/records/bowser-phase4-creations-persistence.md`. Skill: `skills/aspnet-write-endpoint-traps/SKILL.md`.
- **Tests:** `Validation/` (validator vs every fixture, rule-11 parity list, limits mirror), `Creations/` (fixture harness over HTTP, endpoint tests, enumerated write gate, rate limits), `Services/CreationServiceTests.cs` (fake repo + fake user, two users), `Repositories/CreationRepositoryTests.cs` (real predicates on SQLite), `Data/CreationsPostgresTests.cs` + `ProgramOnPostgresTests` (real Program, every fixture, limiter), `Startup/SourceGuardTests.cs`. Support: `Support/{SchemaFixtures,JsonSemantics,RepoPaths,SqliteTestDatabase,CreationRepositoryDoubles}.cs`. Harness gained `configuration`, `configureServices`, `clientIpOverride` (`X-Test-Client-Ip`, set on the connection, never XFF).
- **Measured traps (all would have passed SQLite and curl):** Postgres default collation `en_US.utf8` sorts `'a' < 'B'` (share_code needs `COLLATE "C"`); EF SQLite can't ORDER BY DateTimeOffset (model-only UTC-ticks converter on SQLite); after a 413 with an unread body, HttpClient's next pooled request got "response ended prematurely" until the 413 sent `Connection: close`; `cond ? null : bytes` into `ReadOnlyMemory<byte>?` is an EMPTY memory, not null.
- **Boo's findings I'd have shipped without him:** `[Consumes]` + the `/api/{**rest}` catch-all = 404 not 415 (and no Content-Type passes); the `regex()` route constraint is case-insensitive (`l`, `I`, `O`, Kelvin reach the action). The very first fixture run failed `wrong-content-type` exactly as S6 predicted.
- **Order on a write:** 429, gate 403, 415, 413, envelope 400, owner-filtered lookup 404, document 400. The body is passed unread to the service (`ICreationRequestBody`).
- **Skyler's S13 ruling:** `remixedFrom = isOwner ? source : null`, no CanWrite term (Boo's record still says `&& CanWrite`; overruled).
- **List query is read raw from `Request.Query`** (Yoshi): MVC turns `kind=` into null and `kind=shell&kind=show` into `shell`. `page` clamps to 1..int.MaxValue, literal past long clamps to its side's bound, non-integer is `type`.
- Mutants need the scratch copy of `Fireworks.slnx`, `dotnet-tools.json`, `schema/` and `src/api` (RepoPaths walks up to the slnx). Script kept at the session scratchpad `mutants.py` (replace must occur exactly once; restore and touch).

### 2026-11-13 — Phase 4 fix round (Boo F1/F2/F4/F5, Yoshi D1-D3, Toad)
- **`Services/ControllersRegistration.cs` `AddFireworksControllers()`** is the only `AddControllers()`; Program.cs and `FireworksApiHarness` both call it. It removes the three form value provider factories and adds the API assembly part (dedup-checked).
- **`ApiResponseHeaders` now sends `Connection: close`** on `/api` responses whose `Content-Length` exceeds the current `MaxRequestBodySize`. Found because the extended gate test failed 6/6 in isolation (passed in full suite by timing). Flagged for Boo.
- **`UpdateOwnedAsync` marks four properties** (not `State = Modified`); **`TryInsertAsync` returns `InsertOutcome`** with `RemixSourceGone` mapped to the fixed 404. Race tests: `Creations/CreationSourceDeletedMidWriteTests.cs` (SaveChangesInterceptor deleting the source). Form tests: `Creations/FormBodyGateTests.cs` (`FormBodies.All` shared with `CreationWriteGateTests`).
- Mutant script for this round: session scratchpad `mutants-p4fix.py` (copy at `p4fix/`). Counts: plain 555 + 10 skipped, gated 565.
- Lesson: run a newly extended test in isolation a few times, not only in the full suite; pooled-connection bugs hide behind timing.

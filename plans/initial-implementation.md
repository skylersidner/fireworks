# Fireworks Sandbox — Initial Implementation Plan

**Stack:** .NET 10 + Angular 22, mirroring `monster-of-the-week-net-angular`.
**Status:** Phase 0 complete (2026-11-12). Skyler has decided OQ1, 2, 4, 5, 11, 12, 17 and 20. Every other question in §5 uses its recommended default, except OQ19, which waits for Phase 8.

## 1. Overview

This plan turns `prototypes/fireworks-prototype.html` into a web app that can be deployed from a single origin, built the same way as the established SPA pattern:

- One ASP.NET Core API project serves the Angular production build from its own `wwwroot`.
- Postgres 18 sits behind EF Core.
- A three-stage Dockerfile builds the image, and Railway deploys it.

The work follows the requested order:

1. **Skeleton.** A deployable "hello world" that runs end to end on Railway. It includes a small Pixi test canvas (the "canary") so that problems with bundling Pixi or with WebGL show up early.
2. **UI.** Move the PixiJS engine into plain TypeScript (simulation, rendering and loop) that does not depend on Angular, with Angular components hosting it. Then build the Shell Designer UI until it matches the prototype.
3. **Backend.** A schema phase freezes the saved JSON format for a "creation". Then comes the backend that saves creations and shares them by short code, and the client integration: save, load, share, the player route and remix.

After that come the Show Builder (a timeline of shells, which the schema already allows for) and a polish/hardening phase.

---

## 2. Reference architecture summary (what is mirrored)

Reference root: `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`

| Concern | Reference | Mirror as |
|---|---|---|
| Solution | `MonsterOfTheWeek.slnx`, the XML solution format, with `/src/` and `/src/api/` folders and two projects | `Fireworks.slnx` |
| Layering | **A single API project, organized by folder**: `src/api/MonsterOfTheWeek.Api/{Controllers,Services,Repositories,Data,Data/Entities,Data/Migrations,Data/Seed,Contracts,Properties}` | `src/api/Fireworks.Api/` with the same folders |
| Tests | `MonsterOfTheWeek.Api.Tests`: xUnit 2.9, EF Core SQLite in memory, hand-written Kestrel harnesses (`Tests/Controllers/HunterApiHarness.cs`), fake repositories in service tests, and Postgres-only tests gated by `Tests/Data/PostgresFactAttribute.cs` | `Fireworks.Api.Tests`, same patterns; the gating env var becomes `FIREWORKS_TEST_POSTGRES` |
| .NET | `net10.0`; `Npgsql.EntityFrameworkCore.PostgreSQL 10.0.0`, `Microsoft.EntityFrameworkCore.Design 10.0.0`, `Swashbuckle.AspNetCore 9.0.6` | Same, without SkiaSharp. DataProtection.EF is dropped unless cookie auth is adopted |
| DB | Postgres 18 in compose. Explicit snake_case table and column mapping. `ITimestamped` with `ApplyTimestamps()` in a `SaveChanges` override. A design-time factory. A `DbInitializer` that runs `MigrateAsync()` on startup | `FireworksDbContext`, `FireworksDbContextFactory`, `FireworksDbInitializer` |
| Service and error shape | `Services/ServiceResults.cs` (`ServiceResult<T>`). Attribute-routed controllers with a private `ToActionResult` / `ToErrorResult` helper. Records in `Contracts/ApiContracts.cs` | `ServiceResults.cs` copied as is; same controller shape |
| Program.cs pipeline | `src/api/MonsterOfTheWeek.Api/Program.cs` | Same middleware order (listed in Phase 1a) |
| Config | No connection string in `appsettings.json`, so the startup null check (`?? throw`) fails fast in production; the dev connection string and CORS origins live in `appsettings.Development.json`; port 5225 | Same split, on port **5180** so both apps can run side by side |
| Angular | Angular 22.0.7 with standalone components and **no zone.js**. Signals for state. Per-page `@Injectable()` stores. Typed reactive forms. Folders `app/{core,shared,layout,features/<x>/{pages,shared},pages}`. Lazy-loaded routes | `src/web/fireworks-web`, same conventions |
| Styling | Tailwind 4.3 via `@tailwindcss/postcss`, `@theme static` design tokens in `src/styles.css`, SCSS per component, Prettier (width 100, single quotes) | Same toolchain, with a dark-only token set taken from the prototype's CSS variables |
| Hosting | `angular.json` outputs to `../../api/.../wwwroot`. `proxy.conf.json` forwards `/api` and `/health`. `apiBaseUrl: ''` (same origin). `core/api.ts` wraps HttpClient | Same |
| Client infrastructure | `core/health.ts`, `core/notifications.ts`, `core/http-error-interceptor.ts`, an "API unavailable" modal | Copied; the auth interceptors and guards are skipped |
| Web tests | `@angular/build:unit-test` (Vitest 4, jsdom); `npm run typecheck` runs tsc on both the app and spec tsconfigs; "drift" specs that fail when two copies of a rule stop matching | Same. Drift specs guard the engine's import rules and the schema fixtures |
| Toolchain pins | `.nvmrc` 26.5.0, `engines.node >=26.5.0 <27`, `npm@11.12.1`, TypeScript ~6.0.2 | Same |
| Docker | A three-stage Dockerfile at the repo root: `node:26-alpine` builds the client into wwwroot, `dotnet/sdk:10.0` publishes the **API csproj (not the slnx)**, and `dotnet/aspnet:10.0` runs it with `ASPNETCORE_HTTP_PORTS=${PORT:-8080}` | Same, renamed |
| Railway | `railway.toml` with the Dockerfile builder, `healthcheckPath = "/health/live"`, and restart on failure. `ConnectionStrings__Postgres` is assembled from the `${{Postgres.PGHOST}}`-style variables, not taken from `DATABASE_URL` | Same |
| Prototypes | `prototypes/` holds self-contained HTML concepts and is excluded from the Docker build context | The prototype moves to `prototypes/` and serves as the reference for visual parity |
| Auth | Single-user cookie auth with a global "authenticated users only" policy | **Deferred to Phase 8, with identity built in from Phase 1.** All saved data is owned by a `UserId` that `ICurrentUser` resolves. Until auth exists, `ICurrentUser` returns a configured default user (§3.4) |
| CI | None; Railway builds on every push | Same (OQ11) |

---

## 3. Prototype analysis

### 3.1 Engine pieces (by prototype line number)

- **Model (124–161):**
  - `COLORS`: 10 named colors plus two special values, `rainbow` for `color1` and `none` for `color2`.
  - Enums: `PATTERNS` (peony, ring, palm, heart), `TRAILS` (none, tail, glitter), `EFFECTS` (none, crackle, crossette, strobe).
  - `newBreak` / `newShell` factories and 10 `PRESETS`.
  - `world = {gravity, wind, persistence, starBudget}` is **module-global**.
- **Random numbers (166–173, 197–202):** a seeded generator (`mulberry32`) per shell, plus `prand(i)` streams per particle.
- **Simulation (179–384):**
  - World height is 800, ground is at 760, the fixed step is `1/120` s, and the cap is 40,000 particles.
  - Particles are stored as 19 parallel typed arrays (one array per field rather than one object per particle), with swap-remove `spawn` / `kill`.
  - Launch uses ballistic math. The 4 patterns live in `directions()`.
  - `burst()` handles multi-break shells. `onDeath()` handles crackle (pops spawned with negative age) and crossette (a 4-way split guarded by a generation counter).
- **Renderer (389–472, 530–568):**
  - A Pixi v8 `Application` with DPR capped at 2, a radial glow texture, and a `ParticleContainer` with additive blending.
  - A pooled `live[]` list of sprites. The tint cache is monkey-patched onto each sprite as `p._lastTint`.
  - The motion-blur trail is drawn into an `rgba16float` RenderTexture, with a fallback format.
  - A seeded skyline. The per-kind visual rules (strobe, glitter flicker) live in the renderer.
- **Loop (477–528):**
  - A fixed-step accumulator capped at 24 steps per frame.
  - Three modes: preview loop, manual, and random auto-show (uses `Math.random`, so it is not deterministic).
  - Seeds are `baseSeed + n*7919`. Replay re-fires `lastLaunch`.
  - The HUD writes to the DOM on every frame.
- **Input:** a click fires at the pointer position (ignored near the ground). Space launches unless a form field has focus.
- **Editor (573–712):**
  - Slider and select rows are built by imperative DOM code.
  - Up to 4 break tabs, world fields and preset buttons.
  - A JSON panel with Copy and Apply; Apply does very little validation.

### 3.2 Findings that shape the port

1. **Global state becomes instance state.** Use `FireworksSim` and `PixiRenderer` instances so a designer and a player can coexist and tests don't leak state between runs.
2. **Zoneless Angular.** `runOutsideAngular` isn't needed. The rule is that **no signal is set on every frame**: the HUD updates about 4 times a second or writes to a DOM element ref directly.
3. **What gets saved, and what makes playback repeatable:**
   - `starBudget` changes how many random numbers are drawn, so it is a viewer/device quality setting and is **not saved**.
   - `persistence` (motion blur) only affects visuals, so it is also a viewer setting.
   - `gravity` and `wind` change the physics, so they are saved in a `sky` block.
4. **Playback is not bit-exact across browsers.** Browsers compute `Math.sin`/`cos`/`exp` slightly differently, but positions never feed back into branching, so the differences stay below a pixel. Golden tests therefore check integer state (counts per particle kind at step N) plus position checksums within a tolerance.
5. **Show cues are scheduled in simulation time, never wall-clock time.** A slow device plays slower but still plays the same show.
6. **Prototype rough edges to clean up:**
   - `changed(false)` passes an argument the function ignores.
   - `jsonDirty` is never used.
   - The `p._lastTint` monkey-patch becomes a `Uint32Array`.
   - The HUD style is set on every frame.
   - JSON Apply needs real validation.
7. **Photosensitivity.** Strobe and burst flashes are flashing content, so the app honors `prefers-reduced-motion` (Phase 7).

### 3.3 Creation data model draft (v1)

The saved unit is an **envelope** with `kind: "shell" | "show"`.

```jsonc
// ShellDocument v1 (kind = "shell")
{
  "version": 1,
  "name": "Triple Break",                 // 1..80 chars
  "burstHeight": 0.55,                    // 0.30..0.85 (fraction of ground height, 760 units; prototype: GROUND - h*GROUND)
  "angleJitter": 4,                       // 0..20 degrees
  "sky": { "gravity": 160, "wind": 0 },   // optional; defaults applied on load
  "breaks": [                             // 1..4
    { "pattern": "peony", "stars": 80, "speed": 170, "color1": "blue", "color2": "none",
      "changeAt": 0.6, "burn": 1.2, "drag": 0.9, "size": 1, "trail": "none",
      "effect": "none", "delay": 0.6 }
  ]
}
// Break ranges (= prototype slider ranges): stars 4..400, speed 60..400, changeAt 0.1..0.95,
// burn 0.3..5, drag 0..4, size 0.4..3, delay 0.1..2.5 (ignored for break 0).
// color1 ∈ palette ∪ {rainbow}; color2 ∈ palette ∪ {none}.

// ShowDocument v1 (kind = "show"). Schema frozen in Phase 3, built in Phase 6.
{
  "version": 1,
  "name": "Finale",
  "sky": { "gravity": 160, "wind": 0 },
  "duration": 45.0,                       // seconds, <= 600
  "shells": { "s1": { /* embedded ShellDocument */ } },
  "cues": [                               // <= 1000
    { "id": "c1", "t": 0.0, "shell": "s1", "x": 0.5, "burstHeight": null, "seed": 1293847 }
  ]                                        // x = fraction of world width; burstHeight null = shell default
}
```

The envelope the API returns is `{ shareCode, kind, name, schemaVersion, document, remixedFrom?, createdAt, updatedAt }`.

Each cue stores its own seed, so reordering or deleting cues never changes how the other cues play.

### 3.4 Identity model (decided)

- **Anonymous session for play.** Anyone can use the designer and player without logging in. Their working state lives in the browser: a localStorage draft and the current session's shells.
- **Persistence is tied to identity.** Every saved creation has an `owner_user_id`. Saving, listing "my creations", editing, deleting and remixing into your own library all act *as a user*. In the full product these need a login.
- **Interim default user.** Until the auth pass in Phase 8, the server resolves the current user through an `ICurrentUser` abstraction backed by a config setting, `Identity:DefaultUserId`. That user is seeded at startup.
  - Controllers and services never read the config directly; they only ask `ICurrentUser`.
  - Swapping in real auth later means replacing one DI registration with a claims-based implementation and adding `[Authorize]` / a fallback policy. The schema and service code don't change.
- **Reading share links stays public.** `GET` by share code needs no identity. Creations are unlisted: reachable only by link, with no public gallery.
- **Interim exposure, contained (decided, OQ20).** Before Phase 8, anyone who reaches the deployed site saves as the default user and could edit or delete any creation. So:
  - `Identity:AllowAnonymousWrites` is **`false` in `appsettings.json`** (production) and **`true` in `appsettings.Development.json`**.
  - On Railway, saving is switched on only while testing, via the `Identity__AllowAnonymousWrites=true` env var, then switched off again.
  - `GET api/me` reports `canWrite`, so the client hides Save, Remix and Delete when writes are off rather than letting them fail with 403.
  - Write endpoints are rate-limited.

---

## 4. Phases

### Phase 0: Repo bootstrap and decisions

- Run `git init`.
- Move the prototype to `prototypes/fireworks-prototype.html` and add a `prototypes/README.txt` that names it the visual parity reference.
- Move `fireworks-sandbox-context.md` to `docs/fireworks-app/context.md`. This plan stays in `plans/`.
- Resolve the open questions in §5.

**Done when:** the first commit exists and the open questions are resolved.

### Phase 1: Deployable skeleton (hello world, end to end)

**1a. API project**

Project files:
- `Fireworks.slnx`.
- `src/api/Fireworks.Api` (net10.0; Npgsql EF 10.0.0, EF Design, Swashbuckle 9.0.6).
- `src/api/Fireworks.Api.Tests` (xUnit 2.9.3, EF Sqlite, `SQLitePCLRaw.lib.e_sqlite3`).

`Program.cs` follows the reference order:
1. Null check on the connection string (`?? throw`).
2. Health checks, ProblemDetails, controllers, Swagger.
3. `AddDbContext` with Npgsql.
4. CORS for development only.
5. `Build()`.
6. Outside development: `UseForwardedHeaders`, with the known-network and known-proxy lists cleared.
7. `UseExceptionHandler`.
8. Development only: CORS and HTTPS redirection.
9. `UseDefaultFiles` / `UseStaticFiles`.
10. An explicit `UseRouting()`.
11. Swagger in development.
12. `FireworksDbInitializer.InitializeAsync` (runs the migrations).
13. `MapHealthChecks("/health/live")`.
14. `MapControllers`.
15. `/api/{**rest}` returns 404.
16. `MapFallbackToFile("index.html")`.

Data and service code:
- `FireworksDbContext` with the `ITimestamped` plumbing, a design-time factory, and the initializer.
- `ServiceResults.cs`, copied.
- **Identity foundation** (§3.4):
  - Entity `User : ITimestamped` (`id` uuid, `display_name`, `created_at`, `updated_at`). Leave room for `external_provider` / `external_subject` columns, added in Phase 8.
  - The `InitialCreate` migration creates `users`, so migrations run on startup from day one.
  - `IdentityOptions` bound from `Identity:DefaultUserId` and `Identity:AllowAnonymousWrites`.
  - `FireworksDbInitializer` upserts the default user row.
  - `ICurrentUser { Guid? UserId; bool IsAuthenticated; }` with an interim `DefaultUserCurrentUser` implementation, registered as scoped.
  - `GET api/me` returns `{ userId, displayName, isAuthenticated: false, canWrite }`. `canWrite` reflects `AllowAnonymousWrites` in the interim, and "is authenticated" after Phase 8.
  - Tests: the service resolves the configured ID, and startup fails fast if `DefaultUserId` is missing or invalid.
- The Angular side gets `core/session.ts`, which fetches `api/me` into a `currentUser` signal. Pages read identity only through this service.

Config:
- `appsettings.json` and `appsettings.Development.json`, split the same way as the reference.
- `launchSettings.json` (port 5180) and `Fireworks.Api.http`.

**1b. Angular app**

- Generate `src/web/fireworks-web` with Angular CLI 22: standalone, zoneless, SCSS, no SSR.
- Then copy these from the reference rather than relying on CLI defaults:
  - `angular.json` output path and test builder.
  - `proxy.conf.json` pointing at 5180.
  - The tsconfigs, the `typecheck` script, Prettier, PostCSS and Tailwind 4 config.
  - `package.json` `engines` and `packageManager`, and `.nvmrc`.
- Copy `core/api.ts`, `health.ts`, `notifications.ts`, `http-error-interceptor.ts`, `environment.ts`, and the root `App` with its toast host and "API unavailable" modal.
- In `styles.css`, define a dark-only `@theme` built from the prototype's variables (`--bg #04060c`, `--panel #0d111c`, `--panel2 #141a29`, `--line #232b40`, `--text #e6e9f2`, `--dim #8b93a8`, `--accent #ffb347`, `--accent2 #ff7a59`), mapped to semantic token names.
- **Pixi canary:**
  - Install `pixi.js` pinned to exactly `8.23.0` (ParticleContainer is experimental, so the version must not float).
  - A lazy-loaded home page shows the app title, the health status, and a small Pixi canvas with a few additive glow dots.
  - This proves that Pixi's lazily loaded code chunks build, get served with the right MIME type, and run under WebGL in the production image.

**1c. Containers and deploy config**

- `Dockerfile`: the reference's three stages, with paths renamed.
- `docker-compose.yml`: `postgres:18`, container `fireworks-postgres`, database `fireworks`, user `fireworks_app`, host port **5433**:5432 so it doesn't collide with the MotW container.
- `.env.example`, `.dockerignore` (also excludes `.squad/`, `.claude/`, `plans/` and `prototypes/`), and `railway.toml`. (`.gitignore` landed in Phase 0.)
- `README.md` covering:
  - The dev loop: `docker compose up -d postgres`, then `dotnet run`, then `npm start` and open :4200. The Angular dev server stays on 4200 (decided, OQ12), so don't run this app and Monster of the Week's frontend at the same time.
  - The warnings about the wwwroot folder and `dotnet clean`.
  - The test commands.
  - A table of negative controls ("verify the verifier"): deliberate breakages that each check must catch.

**1d. First deploy**

- Create the Railway project and add Postgres.
- Set `ASPNETCORE_ENVIRONMENT=Production` and the assembled `ConnectionStrings__Postgres`.
- Push.

**Done when:**
- Build, `dotnet test`, `npm test` and `typecheck` all pass, each with a negative control recorded in the README.
- On Railway:
  - `/health/live` returns `Healthy` as text/plain.
  - Deep links return `index.html`.
  - `/api/nope` returns 404.
  - The Pixi canary renders.
  - The startup log shows the migration being applied.

**Risks:**
- Generator defaults in Angular 22 / Node 26 may not match the reference. Copy the config files instead of trusting the generator.
- Pixi chunk loading under esbuild.
- Railway's `DATABASE_URL` trap. Avoid it by following the reference.

### Phase 2: Engine port and Shell Designer UI

**2a. Engine that doesn't depend on Angular** (`src/web/fireworks-web/src/engine/`)

- `model/`:
  - `colors.ts`, `enums.ts`.
  - `shell.ts` (types and factories), `presets.ts`.
  - `limits.ts`: the single source for ranges in TypeScript.
  - `normalize.ts`: clamps values, fills in defaults, and rejects unknown enum values.
- `sim/`:
  - `rng.ts`.
  - `particle-store.ts`: the parallel-array store, as a class.
  - `patterns.ts`.
  - `simulation.ts`: the `FireworksSim` class with `launch`, `step`, `clear`, `simTime`, `sky`, `starBudget`, `shellDuration` and `defaultTarget`.
  - `kinds.ts`.
- `render/`:
  - `pixi-renderer.ts`: `PixiRenderer` with `init(host)`, `render(sim)`, `resize`, `screenToWorld` and `destroy`. The tint cache becomes a `Uint32Array`.
  - `glow-texture.ts`, `trail-buffer.ts`, `skyline.ts`.
- `loop/`:
  - `engine-loop.ts`: the fixed-step accumulator, the 24-step cap and an fps average.
  - Playback modes as `PlaybackDriver` implementations: `PreviewLoopDriver`, `ManualDriver`, `RandomShowDriver` (kept as a mode that is never saved), and a `TimelineDriver` stub.
- Tests (Vitest, no DOM):
  - Golden tests for repeatable playback: counts per kind at steps 60, 240 and 600 for every preset at a fixed seed.
  - Pattern counts.
  - The crossette generation guard.
  - Crackle pops spawning with negative age.
  - Behavior at the particle cap.
  - `normalize` round-trips every preset.
- **Import-boundary drift spec:** `model/`, `sim/` and `loop/` import nothing from `@angular/*` or `pixi.js`, and only `render/` imports Pixi.

**2b. Angular host component**

- `features/designer/shared/fireworks-stage`. Each instance creates its own sim, renderer and loop; this is not a root service.
- Initialize in `afterNextRender`. Handle the case where the component is destroyed before Pixi's `init()` resolves.
- `DestroyRef` calls `app.destroy({ removeView: true }, { children: true, texture: true })`.
- Inputs: `shell`, `mode`, `sky`, `quality`. Outputs: `stats`, throttled to about 4 times a second.
- Methods: `launch()`, `replay()`, `clear()`. Click-to-fire uses `screenToWorld`.
- A fallback message when WebGL isn't available.

**2c. Shell Designer page**

- Route `/` lazy-loads `designer-page`.
- **Before 2c starts: forms spike (decided, OQ17).** Yoshi and Luigi check whether Angular Signal Forms are stable (not experimental or developer preview) in the installed Angular 22 version. If they are, the designer uses Signal Forms. If not, it uses typed reactive forms as below. Record the outcome as a decision record either way.
- **Design-review note:** the default mode is the preview loop, so `/` auto-plays bursts, including strobe, as soon as it opens. Rosalina decides whether the photosensitivity notice and reduced-motion handling move forward from Phase 7 to here.
- Layout: a 340px panel next to the stage, stacking vertically below 760px.
- `ShellDesignerStore` (an `@Injectable()` scoped to the page) holds the `shell`, `activeBreak`, `sky`, `quality` and `mode` signals. Its methods are `loadPreset`, `addBreak` (up to 4, copying the previous break), `removeBreak` and `applyJson`.
- The form (fallback if Signal Forms aren't stable) is a typed `NonNullableFormBuilder` with a `FormArray` of breaks. Either way, changes run through `normalize` and then go into `store.shell`.
- Presentational components: `playback-controls`, `preset-bar`, `shell-fields`, `break-tabs`, `break-fields`, `sky-fields`, `quality-fields`, `json-panel`, `hud`.
- Shared form controls (ControlValueAccessors): `range-row`, and `select-row` with color swatches and a rainbow gradient.
- The Space key fires, except when a form element has focus.
- The working draft autosaves to localStorage (`fireworks.draft.v1`), so nothing is lost before the backend exists.

**2d. Parity and performance pass**

- Compare side by side with the prototype: every preset, every mode, Replay, Clear, resize, and JSON Copy/Apply.
- Check fps at the 40k cap in Chrome, Firefox and Safari.
- Check explicitly whether `rgba16float` is supported, because on Safari the failure may only appear at render time.

**Done when:**
- The parity checklist is complete.
- Change detection doesn't run on every frame (confirmed in the DevTools profiler).
- Navigating away and back 20 times doesn't leak WebGL contexts.
- The engine tests and boundary spec are green.
- The app is deployed.

**Risks:**
- The ParticleContainer API changes. The version is pinned.
- Browsers limit WebGL contexts to about 16 per page, so only one live stage is allowed per page.
- Pixi adds about 500KB, but only to the lazy-loaded designer chunk.

### Phase 3: Creation schema design

- Write `docs/fireworks-app/schema.md` covering:
  - The envelope, ShellDocument v1 and ShowDocument v1.
  - The limits table.
  - Colors stored by name, not hex.
  - Version policy:
    - Writes accept only the current version.
    - The server stores `schema_version`.
    - The **client** upgrades older documents step by step (`engine/model/upgrade.ts`).
    - A new optional field with a default, or a new enum value, needs no version bump. Anything else does.
  - Fields that are never saved: `starBudget`, `persistence` and mode.
  - **Sky precedence in shows:** a ShowDocument has a show-level `sky`, and its embedded shells can carry their own. The schema must say which wins (recommended: the show's `sky` wins, and a shell's `sky` is stripped when it's embedded).
  - **Coordinates (decided, OQ5):** the prototype's model. The world is a fixed 800 units tall, width follows the window, and cue `x` is a fraction of the width.
  - The share code format: 8 characters from an alphabet without look-alikes (no 0/O/I/l).
  - The ownership model: creations belong to `owner_user_id`, reads by share code are public, and writes are owner-only (§3.4).
- **Shared fixtures** in the repo-root `schema/` folder, read by both the C# and the TypeScript tests:
  - `schema/fixtures/valid/*.json`: the presets, a 4-break shell and a minimal show.
  - `schema/fixtures/invalid/*.json`, one per rule: stars 401, 5 breaks, an unknown pattern, missing breaks, an unknown property, version 99, a 200-character name.
- `engine/model/validate.ts` with a spec that runs over every fixture.

**Done when:** the schema doc is reviewed, the fixtures are committed, and the TS validator passes all of them.

### Phase 4: Backend persistence

- **Entity `Creation : ITimestamped`:**
  - `id` (uuid) and `share_code` (varchar(12), unique).
  - `kind` (stored as a string) and `name` (varchar(80)).
  - `schema_version` and `document` (`jsonb`; tests on SQLite store it as TEXT).
  - `owner_user_id` (uuid, FK to `users`, required, cascade on delete).
  - `remixed_from_id` (self-reference, set to null when the original is deleted).
  - Timestamps.
  - An index on `(owner_user_id, updated_at desc)` for the "my creations" list, and an `AddCreations` migration.
- **Contracts** (`Contracts/CreationContracts.cs`):
  - Document types: `ShellDocumentDto`, `BreakDto`, `SkyDto`, `ShowDocumentDto`, `CueDto`.
  - Requests: `CreateCreationRequest(kind, JsonElement document)` and `UpdateCreationRequest`.
  - Responses: `CreationResponse` (includes `isOwner`, computed from `ICurrentUser`) and `CreationListItem` (`shareCode`, `kind`, `name`, `updatedAt`, plus a derived `palette`: the distinct break colors the My creations swatch cards need, so the list doesn't ship whole documents).
- **Validation** (`Services/Creations/CreationDocumentValidator.cs`):
  - Its own `JsonSerializerOptions`: camelCase, `UnmappedMemberHandling = Disallow` so unknown fields return 400, and a camelCase enum converter that applies only to these options.
  - Ranges come from `CreationLimits.cs`, which mirrors `limits.ts`.
  - The re-serialized, canonical JSON is what gets stored.
  - Failures return `ServiceResult.Validation` with messages that name the field path.
- **Repository and service:**
  - `ICreationRepository` / `ICreationService`.
  - `ShareCodeGenerator` uses `RandomNumberGenerator.GetItems` and retries if the code is already taken.
  - The service takes `ICurrentUser`. Writes require a resolved user, and edit/delete require `owner_user_id == currentUser.UserId`. Otherwise it returns `Forbidden`.
- **Controller** (`CreationsController`):

  | Method and route | Behavior |
  |---|---|
  | `POST api/creations` | Creates a creation owned by the current user; returns 201 |
  | `GET api/creations/{shareCode}` | Public; returns the creation |
  | `PUT api/creations/{shareCode}` | Owner only; returns 200, 400, 403 or 404 |
  | `DELETE api/creations/{shareCode}` | Owner only; returns 204, 403 or 404 |
  | `POST api/creations/{shareCode}/remix` | Creates a copy owned by the current user, with `remixedFrom` set |
  | `GET api/me/creations` | The current user's creations, paged, newest first |

  - Add a `Forbidden` error type, mapped in `ToErrorResult`.
  - Add `[RequestSizeLimit(65536)]`.
  - Write endpoints go through a `RequireWriteIdentity` policy or filter. In the interim it checks `AllowAnonymousWrites`; in Phase 8 it becomes `[Authorize]`.
- **Abuse controls:**
  - A fixed-window rate limiter on writes (for example 20 per minute and 300 per day), partitioned by user ID and falling back to client IP.
  - It depends on the forwarded-headers setup to see the real client IP.
- **Tests:**
  - Service tests with a fake repository and a fake `ICurrentUser`. Owner vs. non-owner paths are tested with two user IDs, so ownership is proven before real auth exists.
  - A `CreationApiHarness` (Kestrel and SQLite) covering model binding, 400 responses, 413 for oversized requests, and every fixture: valid ones return 201, invalid ones return 400.
  - A `[PostgresFact]` test that proves the `jsonb` column and the unique index.

**Done when:**
- All endpoints work through the `.http` file.
- The test suites are green, with negative controls.
- The migration applies itself on Railway.

**Risks:**
- The C# and TS limits drift apart. The shared fixtures guard against it.
- Anonymous users could spam writes. The rate limits and size caps cover the basics.

### Phase 5: Client integration (save, share, player, remix)

- `core/creations.ts` (a `CreationsService`), with hand-written TypeScript interfaces that mirror the C# records (the reference convention).
- **Designer:**
  - Save: POST the first time, then PUT.
  - "Save as new".
  - Share copies `/s/:code` to the clipboard and shows a toast.
  - A dirty indicator.
  - `/c/:shareCode` opens a creation in the designer. If `isOwner` is false, saving becomes a remix.
  - Anonymous play never needs the server. The localStorage draft keeps unsaved work. Save/remix controls appear based on `session.canWrite()`, which is always true in the interim and depends on login after Phase 8.
- **Player** at `/s/:shareCode`:
  - Full screen, lazy-loaded. It fetches the creation, upgrades it, normalizes it, and plays it.
  - An overlay shows the name and a "Remix" button.
  - Unknown codes get a 404 page.
- **My creations** at `/mine`:
  - Lists creations from `GET api/me/creations`, with open, share and delete.
  - Cards show palette swatches instead of live Pixi canvases.
- Saves that show validation errors inline use the reference's `SUPPRESS_ERROR_TOAST` HttpContext token.

**Done when:** the full round trip works:
1. Design a shell and save it.
2. Open the share link in a private window; it plays.
3. Remix it.
4. Edit the original as its owner; the change shows on the share link.

Deep links also work on Railway. The Railway round trip runs with writes switched on for the test, and they're switched off afterward.

**Known limit before Phase 8:** every visitor is the default user, so `isOwner` is always true in the running app, and the remix-on-save branch for non-owners can't be seen there. It's covered by the Phase 4 two-user service tests. Whether to add a dev-only second user is a question for Yoshi and Bowser in Phase 4.

### Phase 6: Show Builder (outline)

- Routes `/shows/new` and `/shows/:code/edit`.
- Screen layout:
  - A shell library sidebar (presets, my shells, the current draft).
  - A timeline of draggable cues, with time on the x axis.
  - A cue inspector and transport controls (play, pause, scrub).
- Scrubbing re-runs the simulation from t=0, in simulation time.
- `TimelineDriver` fires each cue when `simTime >= cue.t`, using the cue's seed and `x * worldWidth`.
- Shells are copied into the show when added. The show saves as `kind: "show"` through the same API.

**Done when:** a 60-second, 50-cue show saves, shares, and plays the same way in two browsers.

### Phase 7: Polish and deploy hardening

- **Cache headers:** hashed bundles are `immutable`, `index.html` is `no-cache`, and `GET` on a creation returns an ETag.
- **CSP and security headers:** test whether Pixi needs its `pixi.js/unsafe-eval` build.
- **Accessibility:**
  - `prefers-reduced-motion` turns off strobe and dims the burst flash.
  - A photosensitivity notice on the player.
  - Full keyboard access.
- **Rendering quality:** pick `starBudget` automatically from measured fps, add a touch-friendly layout, and cap DPR at 1.5 on mobile.
- **Operations:**
  - Railway Postgres backups.
  - A takedown runbook (SQL to delete a creation by share code).
  - Optionally a `/health/ready` check against the database.
- **Error handling:** handle WebGL context loss and restore.

### Phase 8: Authentication pass

- Choose a provider (OQ19): the reference's cookie auth extended to multiple users, ASP.NET Identity, or external OAuth/OIDC (Google, GitHub, Microsoft).
- Add `external_provider` / `external_subject` to `users` (unique together). Provision the user on first login.
- Replace `DefaultUserCurrentUser` with `ClaimsCurrentUser`. `RequireWriteIdentity` becomes `[Authorize]`. Remove `Identity:DefaultUserId` from production.
- Migrate the interim default user's creations. Either assign them to the owner's real account (a one-off SQL or admin step) or leave them as read-only legacy items.
- Client:
  - Login/logout UI.
  - `session.ts` reads real claims.
  - A guard on `/mine`.
  - The designer prompts for login when an anonymous user clicks Save. Their draft carries over through the localStorage draft.
- Add DataProtection key persistence (as in the reference) if cookie auth is used.

**Done when:**
- Anonymous users can play but get a login prompt when they try to save.
- Two real accounts can't edit each other's creations.
- The interim default-user code path is gone from production.

---

## 4a. Team assignments

The work is carried out by the Squad personas, defined as Claude Code subagents in `.claude/agents/`, with memory in `.squad/`. `CLAUDE.md` sets the main session up as the coordinator.

| Phase | Lead implementers | Reviewers and ceremonies |
|---|---|---|
| 0 Bootstrap | Mario | Peach (open questions) |
| 1 Skeleton | Bowser (API, identity foundation, Docker, Railway), Luigi (Angular, Pixi canary) | Toad (negative controls), Boo (security-review: pipeline), Yoshi (parity with reference), Mario (phase-gate) |
| 2 Engine + Designer | Luigi | Yoshi (engine boundaries), Rosalina (design-review before 2c), Toad (determinism, parity, WebGL leaks), Peach, Mario |
| 3 Schema | Yoshi | Toad (fixtures), Bowser and Luigi (validator feasibility), Peach, Mario |
| 4 Persistence | Bowser | Boo (security-review), Toad (harness, ownership tests), Yoshi, Mario |
| 5 Save/share/player | Luigi | Rosalina (design-review), Boo (share-link exposure), Toad (round-trip), Peach, Mario |
| 6 Show Builder | Luigi, Yoshi (TimelineDriver) | Rosalina (design-review), Toad (cross-browser), Peach, Mario |
| 7 Hardening | Bowser, Luigi | Boo (CSP and headers), Rosalina (accessibility), Toad, Mario |
| 8 Auth | Yoshi (design), Bowser, Luigi | Boo (lead), Toad, Peach, Mario |

Every phase ends with Mario's phase-gate. Koopa's retrospective is optional. Scribe logs after each batch, and Ralph reports status on request.

---

## 5. Open questions (with recommended defaults)

| # | Question | Recommended default |
|---|---|---|
| 1 | **Identity** | ✅ **Decided:** anonymous session for play, with persistence tied to a user ID from the start. A configured default user stands in until the auth pass (§3.4, Phase 8). |
| 2 | **Is a "creation" a shell only, or shells and shows?** | ✅ **Decided:** shells first (Phases 4–5), shows later (Phase 6). The schema for both is frozen in Phase 3. |
| 3 | **Do share links show the latest edit, or a fixed snapshot?** | Default accepted: **the latest edit** (the owner can update it). Remix creates a new creation owned by the remixer. Safe before Phase 8 because production writes are off (OQ20). |
| 4 | **Public gallery?** | ✅ **Decided: no.** Links are unlisted, and "My creations" is a server-side list per user. |
| 5 | **Coordinates across aspect ratios** | ✅ **Decided:** like the prototype. A fixed 800-unit height, width follows the window, and `x` is a fraction of the width. |
| 6 | **Are gravity and wind saved with a shell?** | Default accepted: **yes**, in an optional `sky` block. Motion blur and star budget aren't saved. Sky precedence inside shows is settled in Phase 3. |
| 7 | **Database** | Default accepted: Postgres 18 with `jsonb`, as in the reference. |
| 8 | **Landing route** | Default accepted: the designer at `/`. Rosalina confirms it at the design-review before 2c. |
| 9 | **Audio** | Default accepted: out of scope for now. It can be added later as an optional field. |
| 10 | **Mobile** | Default accepted: desktop first, with the stacked layout and touch-to-fire on small screens. Automatic quality comes in Phase 7. |
| 11 | **CI** | ✅ **Decided:** none, matching the reference. |
| 12 | **Naming and ports** | ✅ **Decided:** `Fireworks.slnx`, `Fireworks.Api`, `fireworks-web`, `fireworks-postgres`, API port 5180, host DB port 5433. The Angular dev server stays on 4200, and this app isn't run alongside Monster of the Week's frontend. |
| 13 | **Moderation** | Default accepted: an 80-character name limit, deletion by the owner, and a SQL takedown runbook. No content filter. Safe before Phase 8 because production writes are off (OQ20). |
| 14 | **List thumbnails** | Default accepted: palette swatch cards, fed by `CreationListItem.palette`. Rendered thumbnails come later. |
| 15 | **Copy the `.squad/` and `.claude/skills` tooling?** | ✅ **Resolved:** the Squad team was set up as `.claude/agents/` plus `.squad/`. The reference's `.claude/skills` aren't needed. |
| 16 | **Engine as a folder or as an ng-packagr library?** | Default accepted: a folder, plus the boundary spec. |
| 17 | **Typed reactive forms or Signal Forms?** | ✅ **Decided:** Signal Forms if they're stable in the installed Angular 22, otherwise typed reactive forms. Yoshi and Luigi check before 2c. |
| 18 | **Custom domain** | Default accepted: Railway's generated domain for now. |
| 19 | **Auth provider for Phase 8** | Deferred to Phase 8. Recommended: external OIDC (for example Google and GitHub) with cookie sessions. |
| 20 | **Allow saves on the public Railway deployment before Phase 8?** | ✅ **Decided:** off in production (`appsettings.json` false, Development true). Switched on in Railway only while testing. `api/me` reports `canWrite`, and the UI hides the write controls when it's false. |

---

## 6. Out of scope / future ideas

- Sound: launch thumps and burst booms delayed by distance, plus music sync.
- Video export, which works because playback is repeatable: step the simulation offline, then encode with WebCodecs or MediaRecorder.
- More patterns (willow, horsetail, pistil, kamuro, comet, mine, cake), custom hex colors, multi-color changes, and bloom via `pixi-filters`.
- Likes and a moderated public gallery.
- Open Graph previews for share links.
- Revision history and immutable snapshots.
- A WebGPU renderer and running the simulation in a worker with OffscreenCanvas.
- Queries inside `jsonb` (with a GIN index).

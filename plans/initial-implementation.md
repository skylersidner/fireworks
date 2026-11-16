# Fireworks Sandbox — Initial Implementation Plan

**Stack:** .NET 11 + Angular 22, mirroring `monster-of-the-week-net-angular`.
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
| .NET | `net10.0`; `Npgsql.EntityFrameworkCore.PostgreSQL 10.0.0`, `Microsoft.EntityFrameworkCore.Design 10.0.0`, `Swashbuckle.AspNetCore 9.0.6` | **`net11.0`** (decided 2026-11-12, a deliberate departure from the reference's net10.0, because .NET 11 is what's installed), with package majors to match. No SkiaSharp. DataProtection.EF is dropped unless cookie auth is adopted |
| DB | Postgres 18 in compose. Explicit snake_case table and column mapping. `ITimestamped` with `ApplyTimestamps()` in a `SaveChanges` override. A design-time factory. A `DbInitializer` that runs `MigrateAsync()` on startup | `FireworksDbContext`, `FireworksDbContextFactory`, `FireworksDbInitializer` |
| Service and error shape | `Services/ServiceResults.cs` (`ServiceResult<T>`). Attribute-routed controllers with a private `ToActionResult` / `ToErrorResult` helper. Records in `Contracts/ApiContracts.cs` | `ServiceResults.cs` copied as is; same controller shape |
| Program.cs pipeline | `src/api/MonsterOfTheWeek.Api/Program.cs` | Same middleware order (listed in Phase 1a) |
| Config | No connection string in `appsettings.json`, so the startup null check (`?? throw`) fails fast in production; the dev connection string and CORS origins live in `appsettings.Development.json`; port 5225 | Same split, on port **5180** so both apps can run side by side |
| Angular | Angular 22.0.7 with standalone components and **no zone.js**. Signals for state. Per-page `@Injectable()` stores. Typed reactive forms. Folders `app/{core,shared,layout,features/<x>/{pages,shared},pages}`. Lazy-loaded routes | `src/web/fireworks-web` on **Angular 22.2.x, exact pins** (22.2.6 at Phase 1), same conventions, with one deliberate departure: forms use **Signal Forms** (`@angular/forms/signals`, OQ17), not typed reactive forms |
| Styling | Tailwind 4.3 via `@tailwindcss/postcss`, `@theme static` design tokens in `src/styles.css`, SCSS per component, Prettier (width 100, single quotes) | Same toolchain, with a dark-only token set taken from the prototype's CSS variables |
| Hosting | `angular.json` outputs to `../../api/.../wwwroot`. `proxy.conf.json` forwards `/api` and `/health`. `apiBaseUrl: ''` (same origin). `core/api.ts` wraps HttpClient | Same |
| Client infrastructure | `core/health.ts`, `core/notifications.ts`, `core/http-error-interceptor.ts`, an "API unavailable" modal | Copied; the auth interceptors and guards are skipped |
| Web tests | `@angular/build:unit-test` (Vitest 4, jsdom 28); `npm run typecheck` runs tsc on both the app and spec tsconfigs; "drift" specs that fail when two copies of a rule stop matching | Same builder and scripts, on **Vitest 5.1.0 and jsdom 30.1.3** (exact pins). Drift specs guard the engine's import rules and the schema fixtures |
| Toolchain pins | `.nvmrc` 26.5.0, `engines.node >=26.5.0 <27`, `npm@11.12.1`, TypeScript ~6.0.2 | Same Node pins and TypeScript 6.0.x, with **`npm@11.17.0`** |
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

### 3.3 Creation data model (v1)

The saved unit is an **envelope** with `kind: "shell" | "show"`. The full contract (limits, validation codes, version policy, fixtures) is `docs/fireworks-app/schema.md`; this section is the summary.

```jsonc
// ShellDocument v1 (kind = "shell")
{
  "version": 1,
  "name": "Triple Break",                 // 1..80 code points after cleaning; blank saves as "Custom"
  "burstHeight": 0.55,                    // 0.30..0.85 (fraction of ground height, 760 units; prototype: GROUND - h*GROUND)
  "angleJitter": 4,                       // 0..20 degrees
  "sky": { "gravity": 160, "wind": 0 },   // optional; absent plays under DEFAULT_SKY
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
  "sky": { "gravity": 160, "wind": 0 },   // required; the show's sky wins, embedded shells have no sky
  "duration": 45.0,                       // seconds, 1..600: the launch window; playback runs until the last particle fades
  "shells": { "s1": { /* embedded ShellDocument without sky */ } },   // <= 32
  "cues": [                               // 1..1000: an empty show can't be saved
    { "id": "c1", "t": 0.0, "shell": "s1", "x": 0.5, "seed": 1293847 }
  ]   // t = launch time; x = fraction of world width; optional burstHeight (absent = shell's own, never null)
}
```

The envelope the API returns is `{ shareCode, kind, name, schemaVersion, document, isOwner, remixedFrom, createdAt, updatedAt }`. `remixedFrom` is always present and is visible only to the remix's owner; everyone else gets `null`. Before Phase 8 every visitor is the owner, so every visitor sees it: an interim exposure Skyler accepted (schema.md §2.1).

Each cue stores its own seed, and cues firing on the same step fire in `(fireStep, id)` order, so reordering or deleting cues never changes how the other cues play. Share links are not locked: improvements to the sim may change how a saved link plays, and version bumps are for document-shape changes only (schema.md §8.1).

### 3.4 Identity model (decided)

- **Anonymous session for play.** Anyone can use the designer and player without logging in. Their working state lives in the browser: a localStorage draft and the current session's shells.
- **Persistence is tied to identity.** Every saved creation has an `owner_user_id`. Saving, listing "my creations", editing, deleting and remixing into your own library all act *as a user*. In the full product these need a login.
- **Interim default user.** Until the auth pass in Phase 8, the server resolves the current user through an `ICurrentUser` abstraction backed by a config setting, `Identity:DefaultUserId`. That user is seeded at startup.
  - `ICurrentUser` has three members: `Guid? UserId`, `bool IsAuthenticated` and `bool CanWrite`. `CanWrite` is the single write switch: in the interim it reflects `Identity:AllowAnonymousWrites`, and after Phase 8 it means "is authenticated". `CanWrite` implies `UserId != null`.
  - Controllers and services never read the config directly; they only ask `ICurrentUser`. Only the identity module (`DefaultUserCurrentUser`, `IdentityRegistration`, `FireworksDbInitializer`, `Program.cs`) and tests may reference the options type.
  - Swapping in real auth later means replacing one DI registration with a claims-based implementation and adding an authorization policy. The schema, services and controllers don't change; the identity module and pipeline do (Phase 8 lists exactly what).
- **Reading share links stays public.** `GET` by share code needs no identity. Creations are unlisted: reachable only by link, with no public gallery.
- **"My creations" follows the write switch (decided by Skyler).** Before Phase 8, `GET api/me/creations` returns results only when `ICurrentUser.CanWrite` is true; otherwise it returns **403** (`ServiceErrorType.Forbidden`), the same answer the write endpoints give. The client hides the My creations entry when `canWrite` is false, and `/mine` never calls the endpoint in that state. Share-code GETs stay public either way.
  - Why 403 and not an empty 200: every interim visitor resolves to the same default user, so with writes off "your creations" has no honest owner to list for. An empty list would claim "you have saved nothing", which is false and would mask a misconfigured switch; a 403 says "listing is off" and is caught by the same enumerated gate test as the writes. The UX cost is nil because the client never makes the call when `canWrite` is false.
  - Without this rule, every share code saved during a test window would be listed to every visitor: a public gallery, which contradicts OQ4. While writes are switched on for testing, the list is visible to whoever is on the site; that exposure is part of the testing window.
- **Interim exposure, contained (decided, OQ20).** Before Phase 8, anyone who reaches the deployed site saves as the default user and could edit or delete any creation. So:
  - `Identity:AllowAnonymousWrites` is **`false` in `appsettings.json`** (production) and **`true` in `appsettings.Development.json`**.
  - On Railway, saving is switched on only while testing, via the `Identity__AllowAnonymousWrites=true` env var, then switched off again.
  - `GET api/me` reports `canWrite`, so the client hides Save, Remix and Delete when writes are off rather than letting them fail with 403.
  - Write and read endpoints are rate-limited, partitioned by client IP (IPv6 by /64) until Phase 8 (Phase 4, abuse controls).

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
- `src/api/Fireworks.Api` (net11.0, decided; Npgsql EF, EF Design and Swashbuckle at versions that match).
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
  - An options class bound from `Identity:DefaultUserId` and `Identity:AllowAnonymousWrites`. It shipped as `IdentityOptions` and is renamed to `DefaultUserOptions` before Phase 4 (the `Identity` section and its keys stay), so it no longer shadows ASP.NET Core's `IdentityOptions` and Phase 8 can delete it whole.
  - `FireworksDbInitializer` upserts the default user row.
  - `ICurrentUser { Guid? UserId; bool IsAuthenticated; bool CanWrite; }` with an interim `DefaultUserCurrentUser` implementation, registered as scoped.
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

**1d. First deploy** (deferred by Skyler; the Railway items below wait for it)

- Create the Railway project and add Postgres.
- Set `ASPNETCORE_ENVIRONMENT=Production` and the assembled `ConnectionStrings__Postgres`.
- Push.
- Verify whether Railway's edge appends to or overwrites a client-sent `X-Forwarded-For` (send a spoofed header, read the logged `RemoteIpAddress`). The Phase 4 rate limiter relies on the answer.

**Done when:**
- Build, `npm test` and `typecheck` all pass, each with a negative control recorded in the README.
- The backend gate is the **Postgres-gated suite**: `dotnet test` with `FIREWORKS_TEST_POSTGRES` set (compose Postgres on 5433, database `fireworks_test`). A plain `dotnet test` reports the Postgres tests as Skipped and can't exercise `Program.cs`, because the real process migrates before it listens and only speaks Npgsql; deleting `MapHealthChecks` passes the plain run and fails the gated one. Plain `dotnet test` stays the fast loop. Reports and gates say which suite ran, with counts.
- The backend suite (including the Postgres-gated tests) and the API both run on the **.NET 11 runtime** (`net11.0`, decided), without `DOTNET_ROLL_FORWARD`, and the **full three-stage `docker build`** completes.
- On Railway (after 1d):
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
- **Import-boundary drift spec:** `model/`, `sim/` and `loop/` import nothing from `@angular/*` or `pixi.js`, and only `render/` imports Pixi, anywhere under `src/`. The spec has no allow-list. The Phase 1 canary (`pages/home/pixi-canary/canary-scene.ts`) imports `pixi.js` outside `engine/render`, so 2a either deletes the canary or moves its scene under `engine/render`.

**2b. Angular host component**

- `features/designer/shared/fireworks-stage`. Each instance creates its own sim, renderer and loop; this is not a root service.
- Initialize in `afterNextRender`. Handle the case where the component is destroyed before Pixi's `init()` resolves.
- `DestroyRef` calls `app.destroy({ removeView: true }, { children: true, texture: true })`.
- Inputs: `shell`, `mode`, `sky`, `quality`. Outputs: `stats`, throttled to about 4 times a second.
- Methods: `launch()`, `replay()`, `clear()`. Click-to-fire uses `screenToWorld`.
- A fallback message when WebGL isn't available.

**2c. Shell Designer page**

- Route `/` lazy-loads `designer-page`, and it **auto-plays** in preview-loop mode (decided 2026-11-12). Visitors whose OS asks for reduced motion start in Manual, and a non-blocking flashing notice appears on first visit (Rosalina's spec: `docs/fireworks-app/design/designer-2c.md`). The Phase 1 status page moves to **`/status`** without the canary (decided). It's also the route with no stage for the 2d leak check.
- **Forms (decided, OQ17):** the designer uses Angular **Signal Forms** (`@angular/forms/signals`), which are stable in Angular 22.
- **Design-review note:** the default mode is the preview loop, so `/` auto-plays bursts, including strobe, as soon as it opens. Rosalina decides whether the photosensitivity notice and reduced-motion handling move forward from Phase 7 to here. She also reviews three items Luigi left open in Phase 1:
  - The toast and success colors are placeholders; the prototype has no such tokens.
  - The semantic token names in `styles.css` need her review before 2c components depend on them.
  - When the API is down, the "API unavailable" modal and an error toast show at the same time. Decide whether one should suppress the other.
- Layout: a 340px panel next to the stage, stacking vertically below 760px.
- `ShellDesignerStore` (an `@Injectable()` scoped to the page) holds the `shell`, `activeBreak`, `sky`, `quality` and `mode` signals. Its methods are `loadPreset`, `addBreak` (up to 4, copying the previous break), `removeBreak` and `applyJson`.
- The form is a Signal Form over the shell model, with the breaks as an array field. Changes run through `normalize` and then go into `store.shell`. `range-row` and `select-row` are Signal Forms custom controls, not ControlValueAccessors.
- Presentational components: `playback-controls`, `preset-bar`, `shell-fields`, `break-tabs`, `break-fields`, `sky-fields`, `quality-fields`, `json-panel`, `hud`.
- Shared form controls (Signal Forms custom controls): `range-row`, and `select-row` with color swatches and a rainbow gradient.
- The Space key fires, except when a form element has focus.
- The working draft autosaves to localStorage (`fireworks.draft.v1`), so nothing is lost before the backend exists. **Decided:** the draft keeps the shell (including `sky`) *and* this device's display settings (mode, motion blur, star budget, Reduce flashing) and the active break tab. **Purpose of the draft (Skyler, 2026-11-13):** never lose the current state when you leave the sandbox for any reason (reload, `/status`, closing the tab). Form changes only set a **dirty** flag; nothing else is tracked for persistence. Loading a preset or applying JSON **asks for confirmation only when it would replace something the visitor changed** (Skyler, 2026-11-13). Only shell and sky changes count; display settings and the active tab are autosaved but never trigger the question. A preset (which keeps the sky) asks only if the shell changed. Apply asks if the shell changed, or if the JSON carries `sky` and the sky changed. Changes the app makes itself (forced Manual, OS-driven Reduce flashing) never count. No baseline snapshot. A preset, or JSON without `sky`, **keeps the current sky**; JSON with `sky` replaces it. Held Space fires **once**. The first-visit flashing notice **pauses playback until it's dismissed**. Under OS reduced motion the designer opens in **Manual on every load**, whatever mode the draft saved (decided). The draft belongs to the designer, not `core/session.ts`.

**2d. Parity and performance pass**

- Compare side by side with the prototype: every preset, every mode, Replay, Clear, resize, and JSON Copy/Apply.
- ~~fps at the 40k cap~~ **Benched until the end of the project (Skyler, 2026-11-13), tests included**, pending a re-evaluation of the requirement. Skyler's underlying concern is not overloading the browser's CPU, not visual frame rate. The measurement kit stays at `tools/fps-compare/`, but it isn't part of any gate. See §6.
- Check explicitly whether `rgba16float` is supported, because on Safari the failure may only appear at render time.

**Done when:**
- The parity checklist is complete.
- Change detection doesn't run on every frame (confirmed in the DevTools profiler).
- Navigating away and back 20 times doesn't leak WebGL contexts.
- The engine tests and boundary spec are green.
- The app is deployed. **Deferred with Railway (1d).** Firefox and Safari parity, the Safari trail-format check and the deployed checks run at the first Railway deploy (Skyler, 2026-11-13). Phase 2 closed on Chrome parity plus Mario's gate.

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
    - A version bump is for document-shape changes only. A new optional field, a new enum value, and any change to how a document plays need no bump.
    - **Share links are not locked** (Skyler, 2026-11-13): improvements may change how existing links play. The prototype goldens stay as regression guards, and an intentional sim change updates them in a reviewed change, with no version bump.
  - Fields that are never saved: `starBudget`, `persistence` and mode.
  - **Sky precedence in shows:** the show's required `sky` wins, and a shell's `sky` is stripped when it's embedded (an embedded `sky` is invalid).
  - **Cues:** `t` is the launch time (Skyler, 2026-11-13). A show needs at least 1 cue; caps are 32 shells, 1000 cues and 600 s.
  - **Coordinates (decided, OQ5):** the prototype's model. The world is a fixed 800 units tall, width follows the window, and cue `x` is a fraction of the width.
  - The share code format: 8 characters from an alphabet without look-alikes (no 0/O/I/l).
  - The ownership model: creations belong to `owner_user_id`, reads by share code are public, and writes are owner-only (§3.4).
- **Shared fixtures** in the repo-root `schema/` folder, read by both the C# and the TypeScript tests: `schema/limits.json` plus `schema/fixtures/{valid,invalid}/{shell,show}/*.json` and `schema/fixtures/server-only/*.json`. The full list, each invalid fixture's complete expected `(path, code)` multiset, and the format are in schema.md §12.
- `engine/model/validate.ts` with a spec that runs over every fixture.

**Done when:** the schema doc is reviewed, the fixtures are committed, and the TS validator passes all of them.

### Phase 4: Backend persistence

- **Entity `Creation : ITimestamped`:**
  - `id` (uuid) and `share_code` (varchar(12), unique).
  - `kind` (stored as a string) and `name` (varchar(80); Postgres counts characters, which are code points, so it matches the schema's 80-code-point limit).
  - `schema_version` and `document` (`jsonb`; tests on SQLite store it as TEXT).
  - `palette` (the swatch color names for `CreationListItem`).
  - `name`, `schema_version` and `palette` are **computed from the validated document at write time** and stored as columns, so the server never re-reads a stored document and needs no upgraders (schema.md §2.2, §8.1).
  - `owner_user_id` (uuid, FK to `users`, required, cascade on delete).
  - `remixed_from_id` (self-reference, set to null when the original is deleted). The response's `remixedFrom` is the source's share code only when the current user owns the remix (`isOwner`, with no `CanWrite` term); everyone else gets `null` (Skyler, 2026-11-13). Before Phase 8 every visitor is the owner and sees it; Skyler kept the rule knowingly over Boo's S13 (schema.md §2.1).
  - Timestamps.
  - An index on `(owner_user_id, updated_at desc, share_code)` for the "my creations" list (the tiebreak makes page boundaries stable), and an `AddCreations` migration.
- **Contracts** (`Contracts/CreationContracts.cs`):
  - Document types: `ShellDocumentDto`, `BreakDto`, `SkyDto`, `ShowDocumentDto`, `CueDto`. They are built by the validator's walk, not deserialized from the request.
  - Requests: `CreateCreationRequest(kind, JsonElement document)`, `UpdateCreationRequest(JsonElement document)` and `RemixCreationRequest(JsonElement document)`. The remix body is the visitor's edited working copy (Phase 5), validated against the source's `kind`.
  - Responses: `CreationResponse` (includes `isOwner`, computed from `ICurrentUser`) and `CreationListItem` (`shareCode`, `kind`, `name`, `updatedAt`, plus a derived `palette`: the distinct break colors the My creations swatch cards need, so the list doesn't ship whole documents). The list endpoint returns `CreationListPage(items, page, pageSize, totalCount)`, the reference's `PagedSearchResultResponse` shape (schema.md §2.2.1).
- **Validation** (`Services/Creations/CreationDocumentValidator.cs`):
  - **Walks a `JsonElement`** (parsed with the default `JsonDocumentOptions`) with the same walk order and skip rules as the TS validator, and builds the canonical DTO from the walk. The walker detects duplicate keys itself through `EnumerateObject()` and walks the last value, as `JSON.parse` does; `AllowDuplicateProperties = false` throws without a path (measured on .NET 11, `bowser-phase3-validator-feasibility.md`). Deserializing into DTOs with `UnmappedMemberHandling = Disallow` was rejected: it stops at the first unknown member, reports STJ's paths, and rejects a valid `120.0` for an `int` (schema.md §6.5).
  - Integers are tested by value (`TryGetDouble`, then `double.IsFinite`, because `TryGetDouble` returns true with `+Infinity` for `1e400`), never by format. The server never adjusts a document.
  - The body is gated with `Utf8.IsValid` (invalid is `not-json`); `ValueEquals` is wrapped in try/catch; names and property names have a raw-token fallback, because `GetString` and `JsonProperty.Name` throw on lone surrogates (schema.md §6.5).
  - Every C# regex for share codes, shell keys and cue ids is anchored `^…\z`, never `$` (.NET `$` matches before a final `\n`), with no `IgnoreCase`. The share-code route gate is not a regex at all (below).
  - `Services/Creations/CreationEnvelopeReader.cs` runs the envelope walk (schema.md §2.6): content type (`Request.HasJsonContentType()`, 415 when missing or not JSON), body bytes, `Utf8.IsValid`, parse (a `JsonException`, including depth over 64, is `("", not-json)`, never a 500), then `kind` and `document`. The document is walked only when the envelope has no issues. The service's write gate (403) runs before any of it.
  - Ranges come from `CreationLimits.cs`, which is checked against `schema/limits.json`.
  - The re-serialized, canonical JSON is what gets stored.
  - Failures return `ServiceResult.Validation` with the complete issue list, each with `path`, `code` and `message` (schema.md §2.4). `ServiceError` gains an optional issue list to carry it. The 400 body carries at most 100 issues plus `truncated` (always present); the cap is applied where the body is built, never in the validator.
- **Repository and service:**
  - `ICreationRepository` / `ICreationService`.
  - `ShareCodeGenerator` uses `RandomNumberGenerator.GetItems` and retries if the code is already taken.
  - The service takes `ICurrentUser`. **The write gate lives in the service:** every create, update, delete and remix path first checks `CanWrite` and a non-null `UserId`, and returns `ServiceErrorType.Forbidden` (new in `ServiceResults.cs`) when either fails. Client-side hiding and controller attributes are not the gate.
  - The owner is always `ICurrentUser.UserId`, never a request field. Updates and deletes filter on `id AND owner_user_id` in the same query, and a creation the current user doesn't own returns **404**, not 403, so a non-owner can't tell "exists" from "doesn't".
  - `GET api/me/creations` checks `CanWrite` the same way and returns `Forbidden` when it's false (§3.4, "My creations follows the write switch").
- **Controller** (`CreationsController`):

  | Method and route | Behavior |
  |---|---|
  | `POST api/creations` | Creates a creation owned by the current user; returns 201 |
  | `GET api/creations/{shareCode}` | Public; returns the creation |
  | `PUT api/creations/{shareCode}` | Owner only; returns 200, 400, 403 (writes off) or 404 (missing or not owned) |
  | `DELETE api/creations/{shareCode}` | Owner only; returns 204, 403 (writes off) or 404 (missing or not owned) |
  | `POST api/creations/{shareCode}/remix` | Body `{ document }`, the edited working copy. Creates a creation owned by the current user, with `remixedFrom` set; 201, 400, 403 (writes off) or 404 (unknown source). The client uses it for a non-owner's Save and for an owner's "Save as new" (schema.md §11.4) |
  | `GET api/me/creations?page&pageSize&kind` | The current user's creations as a `CreationListPage`: offset paging (`page` from 1, `pageSize` default 24, clamped to 1..100), `updatedAt` desc then `shareCode`, optional `kind` filter, past the end is an empty page with no `OFFSET` query (schema.md §2.2.1); 403 when `CanWrite` is false. The three parameters are read from `Request.Query`, not model-bound: integer literals of any size clamp, the offset is a `long`, `kind` is compared ordinally (`Shell`, `0`, `kind=` are 400 `(kind, enum)`), and a non-integer `page`/`pageSize` is 400 `type` in the §2.4 body |

  - Map `ServiceErrorType.Forbidden` to 403 in `ToErrorResult`.
  - `[RequestSizeLimit(262144)]` (256 KiB) on the three write endpoints, and Kestrel's global `MaxRequestBodySize` lowered to 65,536 (64 KiB) in `ConfigureKestrel`; the attribute raises it for those three (measured, Boo S1–S3). No middleware reads `Request.Body` before MVC, and no request decompression (S4). The size test runs on real Kestrel, because TestServer doesn't enforce `MaxRequestBodySize`. The 413 through Railway's edge is checked on the first deploy (S5).
  - **Write actions read `Request.Body` themselves and check the content type with `Request.HasJsonContentType()` (415 when missing or not JSON); no `[Consumes]`, and no `[FromBody] JsonElement`.** Binding returns MVC's ProblemDetails for bad JSON instead of `{ message, errors }`, and lets invalid UTF-8 through to throw later (measured). `[Consumes]` answers a wrong type with the `/api/{**rest}` catch-all's 404 and runs the action when `Content-Type` is missing (Boo S6, measured). The 413 from `[RequestSizeLimit]` still applies to the manual read.
  - The share-code route gate is a custom `ShareCodeRouteConstraint : IRouteConstraint` (`{shareCode:sharecode}`) that checks length 8 and each character ordinally against the Base58 alphabet. Not a `regex(...)` constraint: ASP.NET compiles those case-insensitively, so `l`, `I`, `O` and the Kelvin sign reached the action (Boo S14, measured). The service re-checks the code before querying.
  - **No `[Authorize(Policy)]` before Phase 8.** No authentication scheme is registered, so a failing policy has nothing to Forbid with and throws. The service-layer `CanWrite` check is the gate in the interim and stays after Phase 8, when `CanWrite` means "is authenticated" and Phase 8 adds the policy on top.
- **Abuse controls:**
  - Fixed-window rate limiters, `RejectionStatusCode = 429` with `Retry-After`, limits read from `RateLimits:*` configuration: **writes 20 per minute and 300 per day, chained** (POST, PUT, DELETE, remix); **reads 120 per minute** (share-code GET, `api/me/creations`, `api/me`, and the `/api/{**rest}` catch-all). **Partitioned by client IP** before Phase 8: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 by /64, no address as one `"unknown"` bucket. Every interim visitor resolves to the same default `UserId`, so a user-keyed partition would be one global bucket any single client could drain. Phase 8 partitions by user when `IsAuthenticated`, falling back to IP (schema.md §2.7, Boo S17–S19).
  - `UseRateLimiter()` after `UseRouting()`; `/health/live` uses `DisableRateLimiting()` and there's no `GlobalLimiter`, so Railway's probe is never throttled (S20).
  - It depends on the forwarded-headers setup to see the real client IP. `ForwardedHeadersOptions.ForwardLimit` stays 1 (the default) while the known lists are cleared, so the rightmost, edge-appended `X-Forwarded-For` entry wins. Don't rely on the limiter until Railway's edge behavior is confirmed: on Phase 4's first deploy, run Boo's black-box S21 check (121 share-code GETs with forged `X-Forwarded-For` values must hit 429; one GET from a second network straight after must not). If either fails, stop and raise it to Skyler.
- **Docker context:** `schema/` is test input only (the `Dockerfile` copies only `src/web/fireworks-web/` and `src/api/`), but `.dockerignore` doesn't list it. Bowser decides whether to add it; if the API reads `limits.json` at runtime, it stays in the context and is copied (schema.md §6.6).
- **Tests:**
  - A gate test that enumerates every non-GET endpoint from `EndpointDataSource` (the router, not a hand-written list) plus `GET api/me/creations`, and asserts each returns 403 with a valid body and an empty repository call ledger when `CanWrite` is false. The catch-all has no `HttpMethodMetadata` and is excluded by its pattern; the test fails if the set is empty (Boo S8).
  - The full test list for these controls is in `boo-phase4-security-requirements.md` (S1–S26), each with its negative control.
  - A reflection or grep test that only the identity module and tests reference the default-user options type (§3.4).
  - Service tests with a fake repository and a fake `ICurrentUser`. Owner vs. non-owner paths are tested with two user IDs, so ownership is proven before real auth exists.
  - A `CreationApiHarness` (Kestrel and SQLite) covering the body read, 400 responses with the exact `errors` multiset, the 100-issue cap and `truncated`, 413 for oversized requests, 415 for a non-JSON or missing content type, and every fixture: valid ones return 201, invalid ones return 400. It posts each document's raw text, and translates the two root-not-object fixtures to `(document, not-object)` (schema.md §12.1).
  - A `[PostgresFact]` test that proves the `jsonb` column and the unique index.

**Done when:**
- All endpoints work through the `.http` file.
- The test suites are green, with negative controls, including the Postgres-gated suite.
- The migration applies itself on Railway.

**Risks:**
- The C# and TS limits drift apart. The shared fixtures guard against it.
- Anonymous users could spam writes. The rate limits and size caps cover the basics.

### Phase 5: Client integration (save, share, player, remix)

- `core/creations.ts` (a `CreationsService`), with hand-written TypeScript interfaces that mirror the C# records (the reference convention).
- **Links and Save (Skyler, 2026-11-13; schema.md §11):**
  - **A link never opens the saved record for editing.** `/c/:shareCode` is the only editing link, for both kinds: it loads a **working copy** with exactly the saved settings, as a new, unsaved (dirty) form, then redirects to the editor (`/` for a shell) so a reload restores the edited copy from the draft. There's no edit-in-place route. The draft remembers the copy's `source` (`shareCode`, `kind`, `isOwner`, `updatedAt`) as client state.
  - **Opening a link over unsaved changes asks first,** only when the shell or sky is dirty (the same rule as Apply with `sky`). Cancel keeps the current draft.
  - **Save:** fresh work (no `source`) is `POST api/creations`. A working copy of a creation the current user owns offers **"Update original"** (PUT, which changes what its share link plays) or **"Save as new"** (`POST …/remix`, so `remixedFrom` is set). Any other working copy saves with `POST …/remix` and the copy as the body. A 404 from PUT or from `…/remix` means the source is gone, so its fallback is a plain `POST api/creations`, never another remix (schema.md §11.2). "Update original" is last-write-wins until a server precondition is added (schema.md §11.4 names the trigger). After any save, `source` is the record just written.
- **Designer:**
  - Share copies `/s/:code` to the clipboard and shows a toast.
  - A dirty indicator. Whether a successful Save clears the dirty flags is Rosalina's and Luigi's call at the Phase 5 design-review (Peach F4).
  - Draft restore and JSON Apply go through `upgradeShell` before normalize, like the player and `/c/:code` (Luigi; schema.md §8.3, Peach F6).
  - A blank name saves as "Custom"; Save is not blocked (Skyler, 2026-11-13).
  - Anonymous play never needs the server. The localStorage draft keeps unsaved work. Save/remix controls appear based on `session.canWrite()`, which reflects `Identity:AllowAnonymousWrites` in the interim (false in production unless switched on for testing) and depends on login after Phase 8.
- **Player** at `/s/:shareCode`:
  - Full screen, lazy-loaded. It fetches the creation, upgrades it, normalizes it, and plays it.
  - An overlay shows the name and a "Remix" button, which opens `/c/:shareCode`: a working copy, with no API call until the visitor saves.
  - Unknown codes get a 404 page.
- **My creations** at `/mine`:
  - Lists creations from `GET api/me/creations` (paged, schema.md §2.2.1), with open (`/c/:code`), share and delete.
  - Follows the write switch (§3.4): the nav entry is hidden when `session.canWrite()` is false, and a direct visit to `/mine` in that state shows a short "unavailable" notice (copy by Rosalina) without calling the endpoint, so the 403 never surfaces as an error toast.
  - Cards show palette swatches instead of live Pixi canvases.
- Saves that show validation errors inline use the reference's `SUPPRESS_ERROR_TOAST` HttpContext token.

**Done when:** the full round trip works (what each step can observe before Phase 8 is in schema.md §11.5):
1. Design a shell and Save it: a POST and a new share code.
2. Open the share link in a private window; it plays.
3. Remix it: the player's Remix opens a dirty working copy; change it and choose **Save as new**. A new share code is created, its GET has `remixedFrom` set to the original, and the original's link plays unchanged.
4. Edit the original as its owner: open it through `/c/:code` (or My creations), change it and choose **Update original**. The share code is unchanged and its link plays the change.
5. With an unsaved change in the designer, opening a link asks first, and Cancel keeps the draft.

Deep links also work on Railway. The Railway round trip runs with writes switched on for the test, and they're switched off afterward.

**Known limit before Phase 8:** every visitor is the default user, so `isOwner` is always true in the running app. The non-owner Save (straight to remix, no choice) and `remixedFrom: null` for non-owners can't be seen there. They're covered by the Phase 4 two-user service tests and a Phase 5 client spec with a stubbed `isOwner: false` response that asserts exactly one `POST …/remix` and no PUT. **No dev-only second user** (decided, Yoshi): revisit at the first non-owner bug that reaches the running app past those specs.

**Phase 5 rulings (Skyler, 2026-11-14):** the player's Remix always shows (only Save follows `canWrite`); display and flashing preferences are device-wide and a link load keeps `display`; "Remixed from" is not rendered before Phase 8; the test-mode banner (Boo C17) ships in Phase 5. Coordinator defaults: `/mine` lists `kind=shell` and a show link at `/s/` or `/c/` shows a "not supported yet" notice until Phase 6; Share on a dirty working copy is presented per Rosalina's spec.

**Phase 5 items carried from the Phase 3 review** (`acceptance/phase-3.md`): F10, copy for Save-time failures (400 from a stale tab, 403, 404 on Update original, 413, 429, the "newer than this app" upgrade error), Rosalina's design-review brief; F4, whether Save clears the dirty flags, Rosalina and Luigi; F11, `type` copy for integer fields, Luigi (by Phase 6 at the latest); F12, how bracket paths read in the Apply note, Rosalina and Luigi.

### Phase 6: Show Builder (outline)

- The Show Builder has its own route and its own draft. There's no `/shows/:code/edit`: a show link opens through `/c/:code`, which dispatches on `kind` and loads a working copy with the same Save rules as a shell (schema.md §11; Peach F8). The exact builder route is Mario's and Rosalina's Phase 6 planning call.
- Screen layout:
  - A shell library sidebar (presets, my shells, the current draft).
  - A timeline of draggable cues, with time on the x axis.
  - A cue inspector and transport controls (play, pause, scrub).
- Scrubbing re-runs the simulation from t=0, in simulation time.
- **A show runs until the last particle fades** (Skyler, 2026-11-13). `duration` is the launch window only and never stops playback; a cue at `t == duration` is valid and its burst is seen. The timeline shows the tail, at most about 21 s past the last launch (schema.md §4.5, §13).
- The "my shells" library calls `GET api/me/creations?kind=shell` and follows the write switch like `/mine` (Peach F9).
- `TimelineDriver` launches each cue at its `t` (launch time, Skyler 2026-11-13): before step `k`, every unfired cue with `Math.round(t * 120) <= k` fires in `(fireStep, id)` order via `fireSeeded`, using the cue's seed and `x * worldWidth` (schema.md §4.4). The timeline can draw the burst at `t + rise`.
- Shells are copied into the show, without their `sky`, when added. The show saves as `kind: "show"` through the same API. A show with no cues can't be saved (Skyler, 2026-11-13); how the builder presents that is Rosalina's call at the timeline design-review.

**Done when:** a 60-second, 50-cue show saves, shares, and plays the same way in two browsers, through to the last particle of its tail.

**Phase 6 rulings (Skyler, 2026-11-14):** cross-browser means the show *runs* in each browser (loads, plays to the end, no errors), not matching fidelity; exact launch-ledger determinism stays a same-engine test. The Show Builder has session-only Undo (⌘/Ctrl+Z, 50 steps). Shells in a show aren't edited in place in v1 (edit in the designer, add again). Seek performance is accepted as measured (worst case ~3.6 s with "Catching up…"), revisited if a seek on a saved show exceeds 1 s p95 in Chrome. Coordinator defaults: builder route `/show` (Rosalina's proposal; Mario confirms at the gate); the Done-when harness may seed the 50-cue fixture as long as the UI adds, moves and deletes at least one cue and Save goes through the builder; shows preview and play at `starBudget` 1 until Phase 7.

**Phase 6 build rulings (Skyler, 2026-11-14):** the Show Builder's fields use native controls instead of Signal Forms (one edit path for Undo and dirty; OQ17 departure for that page only, `records/luigi-phase6-show-builder.md`); Motion blur becomes a device-wide preference shared by designer, builder and player, stored like Reduce flashing; Show JSON Copy/Apply moves to Phase 7. Dragging a library shell onto the timeline moves to Phase 7 (Skyler, 2026-11-14; Rosalina's triage also moves pinch zoom, the `+k` zoom badge and the scrub overview to Phase 7).

**Phase 6 gate rulings (Skyler, 2026-11-14):** the "Can't reach the server" banner also appears when the `api/me` (save) check fails, not only when `/health/live` fails, in both the designer and the builder; ⌘/Ctrl+Z with focus on a select or range control stays with that control, like text fields. Boo runs a Phase 6 security review before the commit. Boo F1 (seek freeze on a crafted maximum show): fixed in Phase 6 with a per-frame time budget for seeks; whether to lower caps (particle cap for shows, max duration) is decided in Phase 7 with measured numbers (Skyler, 2026-11-15). The seek budget is 25 ms per frame and, with the other playback-tuning knobs, is configurable in `appsettings` (section `ClientPlayback`), served to the SPA at startup and documented in the README with higher/lower examples (Skyler, 2026-11-15). The allowed ranges stay as built (SeekBudgetMs 4–100, CheckpointMemoryMiB 8–512); Boo's suggestion to tighten them was declined (Skyler, 2026-11-15).

### Phase 7: Polish and deploy hardening

**Status:** expanded at the Phase 7 planning ceremony (Mario, 2026-11-15; record `records/mario-phase7-planning.md`). Scope below is settled by Skyler's answers to Q7.1–Q7.4 (2026-11-15, end of this section); Q7.5 waits on A3. Items marked **[R]** depend on Q7.1 (Railway), items marked **[P]** on Q7.2 (performance bench).

The original outline, kept for traceability: cache headers (hashed bundles `immutable`, `index.html` `no-cache`, ETag on a creation `GET`); CSP and security headers (does Pixi need `pixi.js/unsafe-eval`); accessibility (`prefers-reduced-motion` turns off strobe and dims the burst flash; the player's photosensitivity notice, already moved to Phase 5; full keyboard access); rendering quality (`starBudget` from measured fps, a touch-friendly layout, DPR capped at 1.5 on mobile); operations (Railway Postgres backups, a takedown runbook, optionally `/health/ready`); WebGL context loss and restore.

**Already done before Phase 7 (verify only, don't rebuild):** Reduce flashing defaults from `prefers-reduced-motion`, turns off the strobe blink, dims and shrinks the burst flash and raises the glitter floor (`engine/render/visual-rules.ts`, 2c), with flash spacing at 41 steps (Phase 6); it is device-wide (`core/device-preferences.ts`) on the designer, builder and player. The player's flashing notice shipped in Phase 5. `Cache-Control: no-store` and `nosniff` are on every `/api` response (`Services/ApiResponseHeaders.cs`, Boo S16). F11 (integer `type` copy) is closed in code (`designer-copy.ts:87`; Peach 5h); the Phase 5 gate's carry was stale.

#### 7.1 Scope

**In:**
- **Caching (Bowser).** Hashed `main-*`, `chunk-*`, `styles-*` get `public, max-age=31536000, immutable`; `index.html` and every SPA-fallback response get `no-cache`; unhashed static files (`favicon.svg`, `3rdpartylicenses.txt`) get a short or revalidating policy. `GET api/creations/{code}` returns an `ETag` and answers `If-None-Match` with 304. The ETag is the quoted `updatedAt` token (schema.md §2.1), so Phase 8's `If-Match` (§11.4) reuses it unchanged.
- **Security headers and CSP (Boo requirements, Bowser builds, Luigi makes the bundle comply).** CSP enforced (not report-only); `Referrer-Policy: same-origin` and `frame-ancestors 'none'` (Boo C20); `nosniff` site-wide; drop `Server: Kestrel`. Decide Pixi's `unsafe-eval` question from evidence (the built chunks contain `new Function`). Handle the two inline items in `wwwroot/index.html`: Beasties' critical `<style>` and its `<script>` media swap, plus Angular's runtime component `<style>` tags.
- **Pipeline edges (Bowser).** `/health/ready` mapped (a DB check, text/plain, 503 when the DB is down) and not answered by the SPA; a dotted last segment under `/s/` and `/c/` (`/c/..%2Fme`) serves the app's not-found page or the bare 404 is recorded as accepted; Boo's chunked-body `Connection: close` hardening (`ContentLength is null && CanHaveBody`).
- **Operations (Bowser).** A takedown runbook in the README (SQL to delete one creation by share code, with a before/after check); a backup and restore procedure rehearsed locally from `pg_dump`; Railway Postgres backups switched on **[R]**. The README's "There are no backups until Phase 7" sentence updated.
- **WebGL context loss and restore (Luigi; Yoshi on the engine boundary).** All stage surfaces (designer, builder, shell and show player) survive `webglcontextlost`/`webglcontextrestored`: the sim keeps its state, the renderer is rebuilt, and a stage that never gets its context back shows the existing no-WebGL message.
- **Mobile rendering (Luigi; Rosalina defines "mobile").** DPR capped at 1.5 on the mobile class (today `Math.min(dpr, 2)` everywhere, `pixi-renderer.ts:96`; the timeline canvas uses raw `devicePixelRatio`, `timeline.ts:467`). Touch-friendly layout at 760px and narrower, including two-finger pinch zoom on the timeline.
- **Accessibility (Rosalina design-review, Luigi builds).** A keyboard audit of every page (`/`, `/show`, `/s/:code`, `/mine`, `/status`, the not-found pages), including whether Save gets Ctrl/⌘+S (phase-5.md §12, deferred there). Rosalina B4–B7 (phase-6.md §19.2). The API banner's Try again moves to `aria-disabled` (`api-banner.ts:28`). A reduced-motion audit of what is already built (above) and anything non-canvas that still animates.
- **Builder UX carried from Phase 6 (Luigi; Rosalina's existing specs).** Show JSON Copy/Apply (phase-6.md §9.5), with show-path field labels in `labels.ts` (Peach's gap: `cues[3].seed` renders raw); library drag onto the timeline (§4.1); `+k` badge click-to-zoom (§6.2); the scrub-bar overview (§5.2); the moved end label no longer covering a `+k` badge (§19.1).
- **Caps decision with measured numbers (Toad measures, Skyler rules; Yoshi/Bowser/Luigi/Toad apply any change).** The show-only particle cap and the 600 s maximum duration (Skyler, 2026-11-15), plus the Chrome p95 seek on a saved show that the "Show Builder v1" row names as its revisit trigger (>1 s). Measured as wall time of real work (step cost, seek time, long tasks), not fps.
- **Cleanups.** TS `PlaybackClientConfig` renamed to match C# `ClientPlaybackConfig` (Luigi); Bowser's record sentence corrected per `toad-phase6-client-config-contract-parity.md` (Bowser); `doneWhenShow()` loads Toad's fixture `schema/fixtures/valid/show/done-when-60s-50.json` (Luigi); the designer save bar, status block and HUD move to `app/shared` if Yoshi says so; Boo F3 (`Object.hasOwn` or a null-prototype copy at every `shells[...]` lookup, plus Toad's `constructor`/`toString` round-trip spec); a late `ClientPlayback` config and the checkpoint interval, and the frame-past-end clamp (Yoshi rules; Luigi builds if needed); Boo re-checks Toad's F2/F5 closures (this also settles the Phase 5 "C2 name-only heuristic" item, which F2 replaced with a shape allowlist); Peach writes her closing note on the 6a/6b/6k rejections.
- **Railway window [R].** First deploy and one test window: Phase 1 Railway Done-when (health, deep links, `/api/nope`, canary, migrations in the startup log); Phase 2d Firefox/Safari parity and the Safari trail-format check; 5i.2–5i.5; 6k.3–6k.4; Boo C18 (S5 413 through the edge with and without chunked, S21 client IP, the S28 runbook with `pg_dump` before) and C20 on the Production build; Toad's 21-fixture round trip; every Phase 7 header and cache check repeated through the edge. Writes are switched on for the window and off afterward, confirmed by `canWrite: false` and a 403 on `GET api/me/creations`.

**Out of Phase 7:**
- `If-Match` → 412 on Update original: schema.md §11.4's trigger is the first lost update or Phase 8, whichever comes first. Phase 7 only makes the ETag the right token (Q7.4).
- Automatic `starBudget` from measured fps **[P]**: conflicts with the performance bench (Q7.2).
- Multi-select of cues, editing embedded shells in place, auditioning a shell (phase-6.md §13.2).
- The dense-flash warning on the timeline (phase-6.md §14.3, a creator aid) unless Skyler pulls it in (Q7.3).
- Background checkpoint warm-up, unless the Chrome p95 seek measurement trips the >1 s trigger (Q7.3).
- A custom domain (OQ18), a real `KnownProxies` entry (Phase 8, once the host is fixed), multi-replica migration locking (README: run one replica).

**Deferred to Phase 8 or later:** `If-Match`/412; the `/mine` nav-versus-page wording and the other §5 index wording flags (Skyler's promotion calls, not build work); everything in §6.

#### 7.2 Done when

Each item names its evidence. The gate runs them against the built image on a fresh database unless marked [R].

1. **Caching.** `curl -I` on the image: a hashed JS chunk and the stylesheet carry `immutable` with a one-year max-age; `/`, `/index.html` and a deep link `/s/<code>` carry `no-cache`; `favicon.svg` is not `immutable`. `GET api/creations/{code}` has an `ETag`; the same request with `If-None-Match` is 304 with no body; after a PUT the old tag gets 200 and a new tag. A recorded negative control (for example removing the immutable rule) fails the header test.
2. **Security headers and CSP.** Boo's header list is present on every response class (index, deep link, static asset, `/api` 200, `/api` 404, 413, `/health/live`, `/health/ready`). The CSP is enforced, and Playwright in Chromium, Firefox and WebKit logs **zero CSP violations** while the designer auto-plays, the builder seeks, a shell and a show play on `/s/`, and `/mine` lists. The `unsafe-eval` decision is recorded with the evidence that decided it.
3. **Pipeline edges.** `/health/ready` is `text/plain` and turns 503 when the database container is stopped (never `text/html`); `/c/..%2Fme` shows the app's not-found page, or Boo/Bowser's accepted-as-is note is recorded; the chunked over-limit request gets the agreed behavior in the Kestrel harness.
4. **Operations.** The README's takedown runbook, run against the gate database, deletes exactly the creation with that share code, after which its link is the app's 404. A local restore from a `pg_dump` into an empty database gives the same row count and `max(updated_at)`. **[R]** Railway backups are enabled and one backup is listed in the dashboard.
5. **Context loss.** On `/`, `/show`, `/s/<shell>` and `/s/<show>`, `WEBGL_lose_context.loseContext()` then `restoreContext()` leaves the stage drawing again (canvas frames change after restore), a show resumes at the same sim time, and no console errors appear. Without restore, the no-WebGL message shows. The Phase 2 20-navigation context-leak check still passes.
6. **DPR.** Under Rosalina's mobile definition with a device scale factor of 3, the stage renderer and the timeline canvas use 1.5; a desktop at DPR 2 is unchanged. Unit specs cover both, with a negative control.
7. **Accessibility.** Rosalina's keyboard inventory passes as a Playwright tab-walk on every page (each listed control reachable and operable, focus visible, no focus dropped to `body` by a disabling control). B4–B7 and the Try again fix have specs. Under emulated `prefers-reduced-motion: reduce`, each stage surface starts with Reduce flashing on, and the existing visual-rules specs still hold. Rosalina's post-implementation review passes.
8. **Touch.** At 390×844 with touch emulation the designer, builder and player follow Rosalina's touch spec, and pinch zoom changes the timeline's zoom.
9. **Builder UX.** Show JSON Copy in one engine and Apply in another gives a document that deep-equals the source (Toad's two-browser use, phase-6.md §9.5); Apply over a dirty show asks; an embedded shell's `sky` is dropped with the note. Library drag adds one cue at the drop time; a `+k` badge click zooms to that span; the scrub overview shows window, tail, cue ticks and view box; the end label never overlaps a badge.
10. **Caps.** Toad's numbers (step cost at the particle cap, seek to end on `at-maximums` and on a realistic saved show, p95 of 20 seeks on a saved show in Chrome) are recorded, and Skyler's caps ruling cites them. If a cap changes: schema.md, both validators, fixtures (`generate-fixtures.mjs --check`) and both suites agree. If the p95 is over 1 s, the trigger's outcome (warm-up built, or a new ruling) is recorded.
11. **Cleanups.** Each item in the cleanup bullet above is closed in code or in a record, or explicitly carried with an owner.
12. **Suites.** `npm test`, `typecheck`, `ng build`, the `format` check, `generate-fixtures.mjs --check`, the gated `dotnet test` (`FIREWORKS_TEST_POSTGRES`) and the full three-stage `docker build` all pass, with counts. New header, ETag and context-loss checks each have a recorded negative control.
13. **[R] Railway.** Every item in the Railway-window bullet above passes through the edge, writes are off afterward (`canWrite: false`, 403 on the list), and the row count and `max(updated_at)` match the window's expected writes.

#### 7.3 Batches

Every batch: commits are not authorized unless Skyler says so. Each brief names the files below and the question each must settle.

**Batch A: ceremonies and measurement (parallel).**
- **A1. Boo: security-review (CSP and headers).** Output: `records/boo-phase7-security-requirements.md`, the exact header set per response class, CSP directives, and verdicts on the pipeline edges.
  - `src/api/Fireworks.Api/Program.cs`: static files short-circuit before routing (step 9), so where can a header land on a static file, an SPA fallback and an `/api` response without three copies?
  - `Services/ApiResponseHeaders.cs`: `no-store` on every `/api` response vs an ETag on `GET api/creations/{code}`. Does the share-code GET become `no-cache` (revalidate) or stay `no-store` with a 304 path, given share codes must not sit in shared caches?
  - `wwwroot/index.html` (build output): the inline critical `<style>` and the Beasties `<script>`. Hash, `security.autoCsp`, or turn `inlineCritical` off?
  - `wwwroot/chunk-*.js` containing `new Function` and `engine/render/pixi-renderer.ts`: does a CSP without `unsafe-eval` render all three stage surfaces once `pixi.js/unsafe-eval` is imported, and what does that cost?
  - `records/boo-phase5-security-requirements.md` C20 and `boo-phase4-security-verification.md` item 2: the Referrer-Policy and `frame-ancestors` lines, and whether the chunked `Connection: close` hardening is still wanted.
  - `app/unsafe-sinks.spec.ts`, `features/designer/designer-structure.spec.ts`: do Toad's F2/F5 closures (rules 11–12, `toad-phase6-show-review.md`) hold?
- **A2. Rosalina: design-review (accessibility, reduced motion, touch).** Output: `docs/fireworks-app/design/phase-7.md` and a record.
  - Every page component under `features/**/pages` and `pages/`: the keyboard inventory, per control, and whether Ctrl/⌘+S comes in.
  - `engine/render/visual-rules.ts`, `core/device-preferences.ts`, `core/browser.ts`: is anything left for reduced motion beyond what 2c and Phase 6 built (UI transitions, Auto show)?
  - `features/designer/shared/api-banner/api-banner.ts`, `features/show/pages/show-builder-page/*`: B4–B7 and Try again, confirmed against phase-6.md §19.2.
  - `features/show/shared/timeline/timeline.ts`, `engine/render/pixi-renderer.ts`: the definition of "mobile" for the DPR cap (coarse pointer, width or both), the touch layout, pinch zoom, and how the end label avoids a `+k` badge.
  - phase-6.md §4.1, §5.2, §6.2, §9.5: are the library drag, scrub overview, badge zoom and Show JSON specs still right as written?
- **A3. Toad: caps and seek measurement.** Output: a record with the numbers, on the current tree, Chrome headless and headed. Step cost at the particle cap; seek to end on `at-maximums` and on Toad's done-when fixture once saved; p95 of 20 random seeks on a saved show; long tasks during each. Files: `app/shared/fireworks-stage/fireworks-stage.ts` (`seekSlice`), `engine/loop/drivers.ts`, `schema/fixtures/valid/show/*.json`. Question: does a saved show's p95 seek exceed 1 s?
- **A4. Yoshi: architecture rulings (short brief).** Output: a record. `engine/render/pixi-renderer.ts` and `stage-renderer.ts`: where does context loss live, the renderer or the stage host, and does the sim survive a renderer rebuild untouched? `TimelineDriver.inherit` and `records/luigi-phase6-show-builder.md` point 13: does a late config need to reset the checkpoint grid, and the frame-past-end clamp? `features/designer/shared/{save-bar,status,hud}`: move to `app/shared`? schema.md §2.1/§11.4: confirm the ETag token.
- **A5. Peach: Phase 7 acceptance.** Output: `docs/fireworks-app/acceptance/phase-7.md` from 7.2 and A2's spec (Show JSON was promised a Phase 7 criterion in `acceptance/phase-6.md`), plus her 6a/6b/6k closing note. Runs after A2 lands and after Skyler answers Q7.1–Q7.3.

**Batch B: implementation (parallel after A).**
- **B1. Bowser:** caching, ETag and 304, the headers per A1, `/health/ready`, the dotted-segment fallback, chunked `Connection: close`, the takedown runbook, the backup and restore procedure (rehearsed locally), the README updates, his record correction. Backend tests with negative controls. Inputs: A1's record, `Program.cs`, `ApiResponseHeaders.cs`, `Controllers/CreationsController.cs`, `README.md` §Shipping/§Test windows.
- **B2. Luigi (hardening):** CSP compliance in the bundle per A1 (`angular.json`, the Pixi import), context loss per A4, the DPR cap per A2, and the cleanups (config type rename, `doneWhenShow()`, F3, the shared-component move if A4 says so). Inputs: A1, A2, A4 records; `pixi-renderer.ts`; `fireworks-stage.ts`; `core/models.ts`; `testing/show-fixtures.ts`.
- **B3. Luigi (UX and accessibility):** keyboard fixes, B4–B7, Try again, touch layout and pinch zoom, Show JSON with `labels.ts`, library drag, badge zoom, scrub overview, the label collision. Starts after A2; can interleave with B2 but is a separate report. Inputs: `design/phase-7.md`, phase-6.md §19, `acceptance/phase-7.md`.
- **B4. Caps change (only if Skyler lowers a cap after A3):** Yoshi edits schema.md first, then Bowser (C# validator), Luigi (TS validator) and Toad (fixtures) in parallel.

**Batch C: reviews (parallel after B).**
- **C1. Boo:** security verification of the headers and CSP on the built image, three engines, zero violations.
- **C2. Rosalina:** post-implementation review of B3 and the DPR/touch parts of B2.
- **C3. Toad:** QA of B1–B3: header and ETag tests with negative controls, the context-loss Playwright check, the 20-navigation leak check, the tab-walk, the Show JSON two-browser round trip, F3's round-trip spec.
- **C4. Peach:** acceptance against `acceptance/phase-7.md` (payloads and stores, not only screens).
- Strict lockout on rejection: there is one backend and one frontend implementer, so a rejected B1, B2 or B3 goes to the coordinator to assign. The seam pieces are the exception: Bowser can take a rejected config rename or `index.html` CSP setting, and Luigi a rejected header rule that only the bundle can satisfy.

**Batch D [R]: the Railway window.** Bowser deploys and runs the window per the README; Boo checks C18, C20 and the headers through the edge; Toad reruns the 21-fixture round trip and the 2d Firefox/Safari checks; Mario observes 5i/6k and the switch-off. Skyler switches writes on and off, or authorizes Bowser to.

**Batch E: Mario's phase-gate**, then Koopa's retrospective (optional) and Scribe.

#### 7.4 Parallelism

- A1–A4 run together now; A5 waits for A2 and Skyler's answers.
- B1 and B2 run together once A1 (and A4 for context loss) land; B3 starts when A2 lands. B4 waits for A3 and Skyler's ruling and can overlap B1–B3 (different files, except the validators).
- C1–C4 run together once B is reported complete.
- D needs B1 and C1 at least (headers are what the edge must preserve) and can run before or alongside C2–C4. If Q7.1 keeps the deferral, D is dropped and the gate records [R] items as DEFERRED.

#### 7.5 Questions for Skyler

- **Q7.1 Railway: deploy in Phase 7, or keep deferring?** The standing ruling defers Railway; Phase 7 is "deploy hardening" and its outline names Railway backups, and 5i.2–5i.5, 6k.3–6k.4, Boo C18/S5/S21 and the 2d Safari checks have been carried for two phases. **Recommendation: make the first Railway deploy and one test window Phase 7's last batch (D).** Headers and caching can only be proven through the edge (`Connection` is hop-by-hop and an edge can rewrite or compress), backups need the host, and Phase 8's OAuth needs real redirect URIs. Alternative: keep the deferral; Phase 7 passes on image evidence, backups become a documented procedure only, and every [R] item is DEFERRED again.
- **Q7.2 Automatic `starBudget` from measured fps vs the performance bench.** The bench says no fps requirement until the end of the project and that the concern is CPU load; the outline (and OQ10's "automatic quality comes in Phase 7") wants an fps-driven setting. **Recommendation: drop the fps-driven `starBudget` from Phase 7 and move automatic quality to the end-of-project performance re-evaluation, reframed around CPU cost.** Keep the manual Star budget control and `starBudget` 1 for shows. Keep the DPR cap in Phase 7: it is a fixed rule, not a measurement. Confirm that A3's caps measurement (wall time of steps and seeks, not fps) is consistent with the bench; it is what your 2026-11-15 ruling asked for.
- **Q7.3 Optional builder items.** **Recommendation:** build the four Rosalina moved (library drag, pinch zoom, `+k` badge, scrub overview), the label fix and Show JSON; build background checkpoint warm-up **only if** A3's p95 seek on a saved show exceeds 1 s; leave the dense-flash warning and multi-select out.
- **Q7.4 `If-Match` → 412 now?** **Recommendation: no.** Keep schema.md §11.4's trigger (first lost update or Phase 8), and have Phase 7's ETag use the same `"<updatedAt>"` token so Phase 8 adds only the check.
**Answers (Skyler, 2026-11-15):** Q7.1 **keep deferring Railway**: batch D is dropped, Phase 7 passes on Docker-image evidence, Railway backups become a documented, locally rehearsed procedure only, and every [R] item is DEFERRED again. Q7.2 **as recommended**: no fps-driven `starBudget` in Phase 7; automatic quality moves to the end-of-project review framed around CPU cost; manual control and `starBudget` 1 for shows stay; the DPR cap ships; A3's wall-time caps measurement proceeds. Q7.3 **as recommended** (Rosalina's four, the label fix, Show JSON; warm-up only if p95 seek > 1 s; no dense-flash warning or multi-select). Q7.4 **as recommended**: no If-Match yet; the ETag uses the `"<updatedAt>"` token. Q7.5 **keep 40k particles / 600 s** (no B4 caps change; Toad's `records/toad-phase7-caps-and-seek.md`). **Further rulings (Skyler, 2026-11-15):** the >1 s seek trigger covers cold (first) seeks, so background checkpoint warm-up is built in Phase 7; CSP `style-src 'unsafe-inline'` is an accepted residual (scripts strict; reopen if any HTML-rendering path is added); Show JSON Apply is one Undo step. Warm-up runs on every device class, touch included (Skyler, 2026-11-15). Coordinator rulings on Peach's N1/N3/N4: after the 10 s context-loss timeout the renderer is destroyed and a later restore is ignored (Yoshi's version); warm-up starts after a `/c/` load, a draft restore and a Show JSON Apply, and resumes from an edit point; the F3 helper is `embeddedShell`. **Throughput constraints (Skyler, 2026-11-15, for the rest of the project):** mutation testing only on engine, save-path and security/guard code; at most two agents at once; three-browser and real-time measurement runs happen once, at the phase gate. **Amended (Skyler, 2026-11-15):** regular test runs, phase gates included, use one browser (Chromium); Firefox and WebKit move to a daily test run, to be defined in the post-Phase-7 testing interlude. Until that daily run exists, the other engines are not a gate criterion. The 7l.5 early-seek bar passes if p95 ≤ 4,330 ms or no worse than a same-load no-warm-up baseline + 20% (Skyler, 2026-11-15). Coordinator default: ⌘S with two save choices moves focus to `Update original` and sends nothing (Rosalina's recommendation).

- **Q7.5 Caps.** Not answerable yet: after A3, the coordinator brings Toad's numbers with a recommendation (keep, or lower the show particle cap and/or the 600 s maximum).

### Interlude after Phase 7: fast show-testing strategy (Skyler, 2026-11-15)

Before Phase 8 starts, find a way to test shows that doesn't depend on playing them in real time or seeking through them in a browser. Today's real-time runs and long seeks are too slow for future changes and impossible in a deployment pipeline. Owners: Toad (test strategy) and Yoshi (engine). It also defines the daily test run where Firefox and WebKit are evaluated (Skyler, 2026-11-15). Output: a proposal for Skyler, then adoption. The proposal must say which current real-time and browser checks it replaces, what it keeps, how long a pipeline run takes, and how confidence is preserved.

### Phase 8: Authentication pass

- Choose a provider (OQ19): the reference's cookie auth extended to multiple users, ASP.NET Identity, or external OAuth/OIDC (Google, GitHub, Microsoft).
- Add `external_provider` / `external_subject` to `users` (unique together). Provision the user on first login.
- **Server seam.** Services, controllers and the creations schema don't change; they already ask `ICurrentUser` and check `CanWrite`. The identity module and pipeline do:
  - Replace the `DefaultUserCurrentUser` registration with `ClaimsCurrentUser` (`CanWrite` = `IsAuthenticated`), and add an authorization policy (fallback or `[Authorize]` on write endpoints) now that a scheme exists.
  - Remove `Identity:DefaultUserId` from production. That means dropping the guard in `IdentityRegistration` that throws when it's missing, and deleting `DefaultUserOptions` whole.
  - Stop seeding: remove `FireworksDbInitializer.EnsureDefaultUserExistsAsync` and its call from `Program.cs` step 12.
  - Pipeline: `UseAuthentication()` and `UseAuthorization()` after `UseRouting()`, and `.AllowAnonymous()` on `/health/live`, the SPA fallback (`MapFallbackToFile`) and the share-code `GET`.
  - Rate limiting partitions by user when `IsAuthenticated`, then by IP (Phase 4); consider a real `KnownProxies` entry in place of the cleared lists.
  - "My creations" no longer depends on the interim switch: `CanWrite` now means signed in, so the §3.4 rule becomes "listing needs a login" with no code change.
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
| 4 | **Public gallery?** | ✅ **Decided: no.** Links are unlisted, and "My creations" is a server-side list per user. Before Phase 8 it follows the write switch: `GET api/me/creations` returns 403 and `/mine` is hidden when `canWrite` is false (§3.4). |
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
| 17 | **Typed reactive forms or Signal Forms?** | ✅ **Decided:** **Signal Forms** on Angular 22.2.x. They're stable (`@publicApi 22.0`) in the version we use, and they're the direction Angular is heading. Skyler expects them to be the pattern in the next LTS release. |
| 18 | **Custom domain** | Default accepted: Railway's generated domain for now. |
| 19 | **Auth provider for Phase 8** | Deferred to Phase 8. Recommended: external OIDC (for example Google and GitHub) with cookie sessions. |
| 20 | **Allow saves on the public Railway deployment before Phase 8?** | ✅ **Decided:** off in production (`appsettings.json` false, Development true). Switched on in Railway only while testing. `api/me` reports `canWrite`, and the UI hides the write controls when it's false. |

---

## 6. Out of scope / future ideas

- **Benched for end-of-project re-evaluation (Skyler, 2026-11-13): performance requirements.** The original Phase 2d fps bar (≥90% of the prototype's median, never below 30) and its tests are parked. The concern to re-evaluate is CPU/process load in the browser, not visual frame rate. The kit is at `tools/fps-compare/` (Toad's record `toad-fps-kit-measurement.md`).

- Sound: launch thumps and burst booms delayed by distance, plus music sync.
- Video export, which works because playback is repeatable: step the simulation offline, then encode with WebCodecs or MediaRecorder.
- More patterns (willow, horsetail, pistil, kamuro, comet, mine, cake), custom hex colors, multi-color changes, and bloom via `pixi-filters`.
- Likes and a moderated public gallery.
- Open Graph previews for share links.
- Revision history and immutable snapshots.
- A WebGPU renderer and running the simulation in a worker with OffscreenCanvas.
- Queries inside `jsonb` (with a GIN index).

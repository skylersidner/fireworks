# Bowser — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells and timed shows in the browser. Stack: Angular 22.2, PixiJS 8.23.0 (pinned), .NET 11 API with EF Core 10.x and Postgres 18 (`jsonb`), Docker, Railway (deferred). Owner: Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. **Reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (structure only, never its domain). **Parity oracle:** `prototypes/fireworks-prototype.html`.
- **Status:** Phases 0–7 built. Phase 8 B1 (server auth) built on 2026-11-16 (below). Open: the Railway window (deferred), Mario's note on the `.br`/`.gz` siblings in `wwwroot`, and Railway-only A31 checks.
- **Build and packaging:**
  - TFM `net11.0`. EF stays 10.x, and the EF packages are bumped together (`bowser-net11-retarget.md`). `DataProtection.EntityFrameworkCore` 10.0.15 sits on the same line. `Authentication.Google` is 11.0.0.
  - Docker `USER $APP_UID`. Publish excludes `appsettings.Development.json`. Compose binds `127.0.0.1:5433`. `ForwardLimit = 1`. Host port 8080 is taken, so use `127.0.0.1:18080`.
- **Environment:** no `timeout` on macOS. Trial changes go in an rsync copy under the scratchpad. Heavy runs are serial (Docker memory is tight). The dev API on 5180 runs with `dotnet run --project src/api/Fireworks.Api` and `ASPNETCORE_URLS=http://localhost:5180`, logging to `scratchpad/bowser-5180.log`.
- **Validator traps (Phase 3):**
  - Code points via `EnumerateRunes`. `TryGetDouble` accepts `1e400`, so check `IsFinite`.
  - Detect duplicate keys in the walker. Gate the string reads with `Utf8.IsValid`. Anchor with `\z`, not `$`.
  - Read `Request.Body` in the service, never `[FromBody]`. Postgres `jsonb` rejects `\u0000`.
  - See `bowser-phase3-validator-feasibility.md` and the skill `cross-language-validator-parity`.
- **Creations (Phases 4–6):**
  - `CreationsController`, `Services/Creations/*` and `CreationRepository`. `AddFireworksControllers()` removes the form value providers.
  - `UpdateOwnedAsync` marks four properties, never `State = Modified`. `share_code` is `COLLATE "C"`. The list reads `Request.Query` raw. SQLite needs a ticks converter to ORDER BY `DateTimeOffset`.
  - Race guards re-check the desired state. Run one replica (`42P07`).
  - Client playback knobs are `ClientPlayback`, validated eagerly. A new knob needs a record field, a `[Range]`, an appsettings row and a `PLAYBACK_LIMITS` row.
- **Phase 7 hardening:**
  - `Services/ResponseHeaders.cs` is the one header middleware (`no-store` only if unset; `Connection: close` for undrainable bodies). `SpaHosting` shares one `StaticFileOptions`. `HealthEndpoints`: live runs no checks, ready waits with `WaitAsync`. `KestrelLimits` sets `AddServerHeader = false`.
  - Writers of `Cache-Control`: static options, the share GET (`private, no-cache`), health, the exception handler (normalized to `no-store`), and since Phase 8 the cookie handler (`no-cache,no-store` plus `Pragma` on logout, accepted under A27). Any new writer needs a row in `ApiCacheControlLedgerTests`.
  - HttpClient re-serializes `Cache-Control`, so compare `NonValidated`. The README has §Backups (now "backups are credentials") and §Takedown.

## Learnings

### 2026-11-16 — Phase 8 B1: server authentication (record `bowser-phase8-server-auth.md`)

- **Layout:**
  - `Services/Identity/{IdentityRegistration, AuthProviderSettings, ClaimsCurrentUser, FireworksClaims, CrossOriginWriteGuard, SafeReturnUrl, UserProvisioning, ICurrentUser}.cs` and `Controllers/AuthController.cs`.
  - `Services/ApiNotFound.cs` (the catch-all, now anonymous) and `Services/Creations/IfMatchPrecondition.cs`.
  - Migration `20261116210109_AddExternalIdentity`. `DefaultUser*`, the seeding, CORS and every `Identity` section are deleted. Program and the harness call the same `AddFireworksIdentity(config, env)` and `UseFireworksIdentity()` (11a, before the limiter).
- **Probes:** P6 (PKCE defaults on; correlation `None`/`Always`; scopes include email), P7 (v3 `sub`), P8 (unknown or wrong-case scheme is a 500), P3 (Chromium and Firefox store `__Host-` on http localhost and 127.0.0.1; WebKit stores nothing).
- **Traps found by tests and the smoke:**
  - The fallback policy 401'd endpoint-less static misses, so an anonymous 404 endpoint is set before authorization.
  - A policy failure on an authenticated principal is a Forbid, mapped to 401 when the id is invalid.
  - Two layers rejecting the same bad id hid Boo's A18 mutant: one job per layer.
  - `[ApiController] NotFound()` gives ProblemDetails, so the allowlist uses `EmptyResult`.
  - A `+01:00` tag for the same instant matched in SQL, so `IfMatchPrecondition` requires `+00:00` and a byte-equal round trip.
  - An `OnCreatingTicket` throw arrives with null properties, so `returnUrl` is omitted.
  - The routing 405 endpoint is 401 when anonymous (accepted).
  - The skill `oauth-cookie-local-rig` has items 9–15.
- **Tests:**
  - `Support/{StubOAuthProvider, SessionClient}.cs`. The manual jar fixes `CookieContainer`'s `Secure` drop.
  - `FireworksApiHarness.StartAsync(signedIn:, withGoogle:, loggerProvider:)` starts a per-harness stub. `Owner`, `AnonymousClient`, `SignInAsync(subject)`, `SeedLegacyUserAsync()`.
  - `CreationApiHarness.SendRawAsync` auto-adds If-Match from a fresh GET for PUT (pass `ifMatch: null` to omit). Watch for it in call ledgers.
  - Auth suites live under `Auth/`. The If-Match race runs on Postgres (`IfMatchRacePostgresTests`, 25 rounds).
  - Mutant set `tools/mutants/sets/phase8-auth.mjs`. Its runner strips `FIREWORKS_TEST_POSTGRES`, so it can't run the race.
- **Tooling:**
  - `tools/fake-oauth/server.mjs` (mine for B1, Toad's from B3) provides `startStub`, `apiEnvFor` and `signIn`.
  - `lib.mjs startApi` runs as Testing with a fresh stub. `common.mjs` has `ensureSession`, `writeHeaders` and `signInContext`. `headers.py` reads `FW_SESSION_COOKIE`. `run.mjs` clears `FW_SESSION_COOKIE` per API instance.
- **Skyler's preferences shown this batch:** Google only, stub by default, never a dev-only login scheme. The README carries the exact Google console steps and the claim SQL as a runbook.

### 2026-11-16 — Phase 8 fix round (D1 G logo, message-page gap, R1 mutant)
- The G is now Google's bundle SVG at `public/brand/google-g.svg`, rendered through `<img>`. Google's zip is at `developers.google.com/static/identity/images/signin-assets.zip`. Unhashed `public/` files get `no-cache` from SpaHosting. Multi-file mutants use `swaps: []` plus `postgres: true`, and Toad's runner has to support that. An `old` anchor must also leave `new` absent, so pull in a nearby comment line when the replacement text already exists in the file.


### 2026-11-17 — Cross-agent update (Scribe)

- **Rosalina's B2 check rejected the G; your D1 fix closed it** (`rosalina-phase8-b2-design-check.md`, `bowser-phase8-server-auth.md` addendum). Google's sha1-matched asset is served as `<img alt="">`, and `message-page.ts` is `gap-[8px]` with a pinned test.
- **R1 is wired and measured.** Toad's runner has `postgres: true` and `swaps`, and your two-swap text is in `phase8-auth`. Mario's gate ran it KILLED (20/20) on `fireworks_gate8_mut`. Boo's F4 (the mutant missing from the set) is closed.
- **Open, yours:** N2, the stale `src/api/Fireworks.Api/bin/Release/net11.0/appsettings.json` with an `Identity` section (build output, dockerignored; a `dotnet run` from `bin/Release` hits the intended throw). Unassigned in the gate record. A37, no XML key encryptor (the warning appears on the image), needs a decision with Boo's A37 trigger.

### 2026-11-17 — End-review fix: `ClientPlayback.WarmUpDelayMs` (server side and README)

- **Built:** a fifth knob, `WarmUpDelayMs` 1000 (0–5000), int, `[Range]` with the key-naming message, in `ClientPlaybackOptions.cs`, `appsettings.json` (value and comment row), `ClientPlaybackConfig` (appended last, so positional order is seek, catchingUp, interval, memory, warmUp) and the controller projection. Wire name `warmUpDelayMs`. Skyler's Q3 ruling in `yoshi-end-review-cpu-cost.md`: warm-up waits until this long has passed with no edit and no seek.
- **Tests:** the shape, override, range-end, class-default and committed-config tests carry the fifth key. Registration (`-1`, `5001`) and process-startup (`-1`, `5001`) out-of-range cases were added, and the startup control sets 5000. The gated Postgres test asserts 1000 from appsettings. 36/36 across the three classes. **Negative control** (in an rsync copy, `[Range]` removed): 4 red, exactly the four new out-of-range cases.
- **Coupling to remember:** `client-config.contract.spec.ts` (Luigi's) parses `ApiContracts.cs`, the options `[Range]` lines and appsettings by regex, and pins `TS_KEYS` to four names. Any server-side knob turns it red until the client lands the field. Order the server change first and tell the coordinator.
- **The schema.md §2.8 entry doesn't list the playback fields**, so a knob needs no schema.md edit. The README needs three: the "N settings" sentence, the table row, and the `GET /api/client-config` row in the API reference.

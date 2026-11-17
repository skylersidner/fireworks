# Phase 8 B1: server-side authentication (Bowser)

**Date:** 2026-11-16 · **Status:** proposed (built, regular tier green). Binds B2 (Luigi) and B3 (Toad) on the contract below. Promotion to the index is Skyler's call.

**Inputs:** `boo-phase8-security-requirements.md` A1–A39 (binding), `docs/fireworks-app/design/phase-8-auth.md` §3 and §5 and `schema.md` §2.6, §2.8 and §11.4 (as adopted), `docs/fireworks-app/design/phase-8.md` §9.4, and plan §Phase 8 rulings (Google only, 30 days sliding, banner removed, stub refused in Production).

## What

1. **Probes (measured 2026-11-16, .NET 11, `Microsoft.AspNetCore.Authentication.Google` 11.0.0).**
   - **P6:** `UsePkce` defaults to true. The correlation cookie defaults to `SameSite=None` with `SecurePolicy=Always`. The default scopes are `openid profile email`.
   - **P7:** the default `UserInformationEndpoint` is v3 (`https://www.googleapis.com/oauth2/v3/userinfo`). `NameIdentifier` is mapped from both `id` and `sub`. Provisioning reads `sub` explicitly.
   - **P8:** `Challenge` with an unregistered scheme is a 500, and scheme names are case-sensitive (`google` is a 500 when the scheme is `Google`).
   - **P3:** Chromium and Firefox store and send `__Host-`, `Secure` and `SameSite=None; Secure` cookies from both `http://localhost` and `http://127.0.0.1`. WebKit stores none. The real redirect flow (login → stub → callback) also completes in Chromium on `http://127.0.0.1:<port>` in the smoke.
   - So the cookie is **`__Host-fw.session` outside Development and `fw.session` in Development**.
2. **Endpoints and shapes** (what Luigi matches):
   - `GET api/auth/login/google?returnUrl=` → 302 to Google. Any other provider id (`Google`, `github`) gets the catch-all's empty 404. The only route value is `google`.
   - `POST api/auth/logout` → always 204.
   - The failure landing page is `/signin?error=cancelled&returnUrl=<enc>` (Google's `access_denied`) or `/signin?error=failed&returnUrl=<enc>` (everything else). `returnUrl` is omitted when the login properties can't be read: a bad `state`, or an exception while creating the ticket (no `sub`, database down).
   - `GET api/me` → exactly `{ userId, displayName, isAuthenticated, canWrite, signedInWith }`, always 200. Anonymous is `null, null, false, false, null`.
   - `GET api/client-config` → `{ playback, loginProviders: [{ id: "google", name: "Google" }] }`. The list is empty only in Development or Testing without a client.
3. **Status order on a write** (schema §2.6): CSRF 403 (every unsafe method, every path) → 401 → 429 → service 403 → 428 (PUT, header only) → 415 → 413 → 400 envelope → 404 → 400 document → 412.
   - The If-Match comparison runs **in the UPDATE**: `updated_at` is an EF concurrency token, and its original value is set to the client's tag.
   - Unmatchable tags get 412 after the owner-filtered 404: `*`, a list, two header lines, a weak tag, a `-p` tag, an unparseable tag, and a tag for the same instant at a non-zero offset (strong means byte-equal; SQL alone would have matched `+01:00`).
4. **One job per layer for a bad identity.**
   - The cookie's `OnValidatePrincipal` (on `/api` only) checks only that the row exists for a parseable id (A12).
   - An unparseable id is the shared predicate's alone (`FireworksClaims.TryGetUserId`: policy and `ICurrentUser`). An authenticated principal that fails the policy is mapped from Forbid to **401** in `OnRedirectToAccessDenied`. There are no roles, so that is the only way to fail it (A21).
   - Without this split, dropping the policy's assertion (Boo's A18 control) was invisible.
5. **An unmatched request** (a static-file miss such as `/nope.js`, which the SPA fallback skips because of the dot) gets an anonymous empty 404 endpoint before `UseAuthorization`. Otherwise the fallback policy answered 401 to anonymous callers (measured in the first smoke run). This endpoint is not in `EndpointDataSource`, so A20's pinned set is unchanged.
6. **The routing 405 endpoint is not anonymous.** An anonymous `POST /show` is 401, and signed in it is 405. I accepted that, since both are body-less. Pinned in `PipelineEdgeTests.The_rule_is_scoped_to_api` and `headers.py`.
7. **Startup guards:**
   - Any `Identity:*` key throws.
   - Outside Development and Testing, a missing or blank client, the stub sentinel pair, or any `*Endpoint` override throws. Messages name keys, never values.
   - A Warning is logged when stub endpoints are active, or when sign-in isn't configured.
   - `<UserSecretsId>` is set in the csproj.
8. **Data:** migration `AddExternalIdentity` adds `users.external_provider` `varchar(32)` and `external_subject` `varchar(255)`, `ix_users_external_provider_subject` (unique), `ck_users_external_identity_both_or_neither`, and the `data_protection_keys` table. `FireworksDbInitializer` is `MigrateAsync` only.
9. **Rate limits:** read and write keys are `u:<id>` when signed in, else `ip:<addr or /64>`. The new `auth` policy (`RateLimits:Auth:PerMinute`, default 20) is by IP and covers login and logout.
10. **The server-stub contract** (C# `Support/StubOAuthProvider.cs`, Node `tools/fake-oauth/server.mjs`):
    - The API reads `Auth:Providers:Google:{ClientId=fireworks-stub-client, ClientSecret=stub-secret-not-a-credential, AuthorizationEndpoint, TokenEndpoint, UserInformationEndpoint}`.
    - The stub binds 127.0.0.1 only, enforces S256 PKCE, single-use codes, the exact `redirect_uri` and the client pair, takes the subject from `login_hint`, and counts token calls.
    - In Docker, the authorize URL is the browser's (`localhost:5190`) and token and userinfo go through `host.docker.internal:5190`.
11. **Test harness:**
    - `FireworksApiHarness` runs a per-harness C# stub, and its `Client` is signed in with `signedIn: true`.
    - `SessionClient` keeps its own jar (Boo's `CookieContainer`/`Secure` trap).
    - The smoke runs the API as **Testing** with a fresh Node stub. It signs in in Node (`FW_SESSION_COOKIE`) and through the real browser flow (`signInContext`).

## Why

Boo's A1–A39 bind B1. Items 3–6 are the places where a framework default or my first cut disagreed with them, and each was found by a test or the smoke. They are recorded so B2, B3 and the gate don't rediscover them.

## Boundary

- **Luigi (B2)** must match item 2 exactly.
  - Read `loginProviders` as optional (absent means `[]`) and `signedInWith` as optional (absent means `null`).
  - Send `If-Match: "<source.updatedAt>"` on PUT, and handle 428 and 412. A 412 carries the current `ETag`.
  - Treat 401 (no longer 403) as "signed out".
  - Note that `/signin` may arrive with no `returnUrl`.
- **Toad (B3)** owns `tools/fake-oauth/server.mjs` from here. I wrote the minimum the smoke needs, with the same checks as the C# stub, plus `--interactive` for dev and `/__calls`.
- **Equivalent mutants, not killed by design:** SafeReturnUrl's raw second-char check (the decoded check covers it), and the failure redirect's re-check of `returnUrl` (its input was checked at login and travels inside protected `state`).
- **Not decided here:** Railway `Host` forwarding, `KnownProxies` and the real-Google image run (A31, [R]), and key encryption at rest (A37 triggers).

## Addendum, 2026-11-16: Phase 8 fix round (Bowser, revising Luigi's G under strict lockout)

- **D1, the G:** `public/brand/google-g.svg` is Google's current `signin-assets.zip` Light / Square / no-text web SVG. I downloaded it again; it is byte-identical (sha1 `1a3104eb…`) to Rosalina's copy. The only changes are the two `M4 0.5H36…` chrome paths removed and `width/height 20, viewBox="10 10 20 20"` (identical to Rosalina's `pw/g-new.svg`). `google-sign-in-button.ts` renders `<img src="brand/google-g.svg" alt="" width="20" height="20" class="block flex-none">`. In the running app (Testing, built wwwroot, Chromium): the image is served as 200 `image/svg+xml` with `no-cache` (unhashed, so the SpaHosting revalidate rule applies) and `nosniff`. CSP `img-src 'self'` gives zero violations, and the image is 20×20 natural and rendered as the gradient G. `sign-in.spec.ts` now pins the `<img>` and asserts that no `svg`, `link` or `script` is present.
- **Spacing:** the `message-page.ts` action row is now `gap-[8px]`. The touch-px guard only checked coarse-pointer gaps, so it didn't cover this one. I added a pinned row test with a negative control (a reverted `gap-2` fails it).
- **R1:** `phase8-auth.mjs` R1 uses Boo's measured text as a two-swap mutant: `swaps: [{file, old, new}×2]`, `postgres: true`, filter `IfMatchRacePostgresTests`. The DbContext swap is anchored on the comment line above it, because the untokened `UpdatedAt` line already appears once elsewhere. Both swaps apply once, and their new text doesn't occur anywhere else. **Boundary:** the runner (Toad's) has to learn `swaps`/`postgres`. Until it does, `--check phase8-auth` and full set runs will throw on R1, because it has no `m.file`.

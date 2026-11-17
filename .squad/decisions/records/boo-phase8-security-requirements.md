# Phase 8 security requirements (Boo, 8.0a security-review)

**Date:** 2026-11-16 · **Status:** proposed. A1–A44 bind B1 (Bowser), B2 (Luigi) and B3 (Toad) once the coordinator forwards them. C1 (Boo) verifies. Promotion to the index is Skyler's call.

**Inputs, read as code:** `Program.cs`; `Services/Identity/{ICurrentUser,DefaultUserCurrentUser,DefaultUserOptions,IdentityRegistration}.cs`; `Services/ResponseHeaders.cs`; `Services/RateLimiting/FireworksRateLimiting.cs`; `Controllers/{Creations,Me,ClientConfig}Controller.cs`; `Services/MeService.cs`; `Services/Creations/CreationService.cs` (gate l.273–276, `ToResponse` l.340–355); `appsettings*.json`; `Fireworks.Api.Tests/Controllers/FireworksApiHarness.cs` (already runs as `"Testing"`); `tools/test/lib.mjs` l.129–138; `railway.toml` l.19; `src/web/fireworks-web/proxy.conf.json`. Design: `docs/fireworks-app/design/phase-8-auth.md`, `yoshi-phase8-auth-design.md`. Mine: `boo-phase4-security-requirements.md`, `boo-phase5-security-requirements.md`, `boo-phase7-security-requirements.md`.

**Verdict on Yoshi's design:** sound. I accept the provider choice, the seam, the fallback policy, no antiforgery tokens, `SameSite=Lax`, the stub approach, the `-p` ETag, `Vary`, and the If-Match placement. **Changes below:** correlation cookie `SameSite=Lax` (not the framework's `None`), the cookie-name rule, a shared user-id predicate for the policy, a CSRF guard on every unsafe request (not only `/api`), a provider allowlist before `Challenge`, a stricter `returnUrl` rule, Production fail-fast on missing Google config, `"Testing"` as the only non-Development home for the stub, and `If-Match: *` rejected. There is no nonce in this flow (the OAuth handler is not OIDC); drop "nonce cookies" from the design.

**Tiers.** "Harness" means the regular-tier C# suite on `FireworksApiHarness` with the C# stub. "Program" means a real-Program child process (`ProgramStartupTests` shape, regular tier). "Postgres" means `ProgramOnPostgresTests` (needs `FIREWORKS_TEST_POSTGRES`). "Smoke" means Toad's Chromium Playwright smoke with `tools/fake-oauth/server.mjs`. **[R] DEFERRED** means it needs real Google or Railway.

---

## 0. Google only: what to strip from the design (Yoshi, on adoption)

§0, §1.1 and §1.2: the GitHub handler, generic `AddOAuth("GitHub")`, the aspnet-contrib question, and the one-callback-URL note. §1.3 and §1.4: replace every `github` callback example with `google`, and the stub implements **Google's shape only** (authorize, token, userinfo). §3.3: GitHub's subject and display-name rules, and the "no account linking" note (trigger becomes "a second provider is added"). §3.4: `signedInWith` becomes `"google" | null`. §7 C1: "a real Google dev app". Q1 is answered. `{provider}` and `loginProviders` may stay, as one-entry lists (A9).

---

## 1. OAuth flow

**A1 (must-have). Handler: `AddGoogle` (OAuth, not OpenIdConnect), `SignInScheme` = cookie, `SaveTokens = false`, `UsePkce = true` set explicitly, `Scope.Clear()` then `openid` and `profile` only.** The Google defaults include `email`, so `Clear()` is needed.
*Verify (harness):* the stub records the authorize query: `scope == "openid profile"`, `code_challenge_method == "S256"` and a `code_challenge` is present. The stub's token endpoint **rejects** a missing or mismatched `code_verifier`, so a green sign-in proves PKCE end to end. *Negative control:* set `UsePkce = false`; sign-in must fail at the stub.

> Amended by yoshi-phase8-auth-design.md (Boundary) on 2026-11-16: the `/signin` failure target is `error=cancelled|failed` with a re-checked `returnUrl`. Confirmed by boo-phase8-security-verification.md, ruling 2.

**A2 (must-have). `state` and correlation are the framework's. Don't hand-roll either, and don't widen them.** `state` is the DataProtection-protected `AuthenticationProperties` (correlation id, PKCE verifier, `RedirectUri`). Nothing else may set `RedirectUri` after the login endpoint.
*Verify (harness):* (a) `state` with one flipped byte, (b) no correlation cookie, (c) a correlation cookie from a different login, and (d) replaying a completed callback each give 302 to `/signin?error=1`, no session cookie, and **no request to the stub's token endpoint** (the stub counts calls). So no outbound call happens without a valid state, which means the login limit (A30) also bounds back-channel traffic.

**A3 (must-have). Correlation cookie: `SameSite=Lax` in every environment; `SecurePolicy = Always` outside Development and `SameAsRequest` in Development, both set explicitly.** The framework default is `None` + `Always`. `None` without `Secure` is rejected by Chromium, so it would break the http dev loop, and `Lax` is sufficient: the return from Google is a top-level GET, which carries Lax cookies. Lax is also narrower than `None`. **This changes design §3.8's "framework default otherwise".**
*Verify (harness):* parse the challenge's `Set-Cookie` for `.AspNetCore.Correlation.*`: `HttpOnly; SameSite=Lax`, plus `Secure` when the environment is `Testing`, and no `Secure` in Development. Smoke: sign-in completes on `http://localhost:4200` (Development) in Chromium.

> Amended by yoshi-phase8-auth-design.md (Boundary) on 2026-11-16: the literal `/signin?error=1` becomes `error=cancelled` (`OnAccessDenied`) or `error=failed` (`OnRemoteFailure`). Confirmed by boo-phase8-security-verification.md, ruling 2.

**A4 (must-have). Callback `CallbackPath = /api/auth/callback/google`, answered inside `UseAuthentication` before any endpoint (Bowser's probe P1).** Handle **both** `OnAccessDenied` and `OnRemoteFailure`: `Response.Redirect("/signin?error=1")` plus `HandleResponse()`. Never reflect Google's `error`, `error_description` or `error_uri` into the redirect, a body or a log line above Debug.
*Verify (harness):* the stub answers authorize with `error=access_denied&error_description=<script>x</script>` → 302 `Location: /signin?error=1` exactly, and no session cookie. Unhandled (negative control: remove the handler) is a 500 (P2).

**A5 (must-have). `returnUrl` rule, server side, in one function (`SafeReturnUrl`) used by the login endpoint:** null, empty or longer than 2,048 chars → `/`. It must start with `/` and the second char must not be `/` or `\`. No `\` anywhere and no char below U+0020 or equal to U+007F (browsers strip tab and newline, so `/\t/evil` becomes `//evil`). It must not start with `/api` (no bouncing into auth endpoints). `Url.IsLocalUrl` must also be true. Anything else → `/`. The client's `isSafeInternalUrl` (the reference's) applies the same rule, but **the server is the authority**: the client passes `returnUrl` only as an encoded query value to `/api/auth/login/google` and never calls `location.assign(returnUrl)` itself.
*Verify (harness), the full stub round trip, asserting the final `Location`:* `//evil.example`, `/\evil.example`, `/` + TAB + `/evil.example`, `%2F%2Fevil.example` (query-decoded to `//`), `https://evil.example`, `javascript:alert(1)`, ` /x` (leading space), `/api/auth/logout`, a 3,000-char path → `/`. `/c/abcdefgh?x=1` → itself. *Negative control:* return the raw value; the `//evil.example` case must then fail. Client spec: the same table through `isSafeInternalUrl`.

**A6 (must-have). Sign-in is a top-level GET navigation (`location.assign`), never a `<form>` and never `fetch`.** `form-action 'self'` governs the redirect after a form submission, so a form would be blocked at the 302 to Google. COOP `same-origin` rules out a popup flow. **No CSP or header change in Phase 8**: the P7 policy stands as written.
*Verify (smoke, local):* the stub runs on another origin (`http://localhost:5190`), so a stub round trip is a real cross-origin navigation under the enforced CSP. A `securitypolicyviolation` listener records zero events across sign-in. Static: no template contains a `<form>` whose `action` mentions `api/auth`. This closes Yoshi's P4 locally; the Google-origin repeat is [R].

**A7 (must-have). The stub is a test double with real checks:** it binds `127.0.0.1` only (C# on port 0; Node on 5190, never `0.0.0.0`); requires the exact `client_id` and `client_secret`; requires `redirect_uri` at the token step to equal the one sent to authorize; issues single-use codes; enforces PKCE S256 (A1); and takes the subject from `login_hint`.
*Verify:* the stub's own unit checks (reused code → 400, wrong verifier → 400). The harness sign-in helper is green only through all of them.

**A8 (must-have). Probes before B1 code, added to Bowser's P1–P5:** **P6** the effective `UsePkce` and correlation-cookie defaults of the installed `Microsoft.AspNetCore.Authentication.Google`; **P7** which userinfo key carries the subject (`sub` on v3, `id` on v2) for the handler's default `UserInformationEndpoint`, so the stub mirrors it and provisioning reads that key explicitly; **P8** that `Challenge` with an unregistered scheme name throws (a 500), which A9 prevents.

**A9 (must-have). Provider route allowlist before `Challenge`.** `GET api/auth/login/{provider}` compares `provider` ordinally against the configured list (`google`). `Google`, `github` or anything else → the fixed 404 body, with no `Challenge` call.
*Verify (harness):* `google` → 302 to the stub; `Google`, `github` and `x` → 404 with the catch-all's body, and no `Set-Cookie`.

## 2. Session cookie

**A10 (must-have). Settings**, set explicitly (never the `.AspNetCore.Cookies` default):

| Setting | Value |
|---|---|
| Name | **`__Host-fw.session` outside Development, `fw.session` in Development**, if probe P3 shows Chromium stores a `__Host-` cookie from `http://localhost:8080` and `http://127.0.0.1:18080` (Docker as `Testing`). If P3 fails, `fw.session` everywhere, and `__Host-` is re-raised when a custom domain lands (OQ18). The prefix stops cookie tossing from a sibling subdomain: a tossed session would sign the victim into the attacker's account, so the victim's saves land there. |
| `HttpOnly` | true |
| `SecurePolicy` | `Always` outside Development; `SameAsRequest` in Development |
| `SameSite` | `Lax` (Strict breaks the return from Google and links opened from chat apps) |
| Path / Domain | `/`; no `Domain` |
| `ExpireTimeSpan` / `SlidingExpiration` | 30 days / true |
| `IsPersistent` | true on every sign-in (otherwise the browser holds it only for the session while the ticket says 30 days) |
| Ticket | exactly one claim, `NameIdentifier = users.id`; no provider claims; no `.Token.*` properties |

*Verify (harness):* parse the callback's `Set-Cookie`: name, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`, `Secure` (Testing), `expires` 30 days ± 1 minute ahead. Unprotect the ticket with the app's `IDataProtectionProvider` (`TicketDataFormat`): exactly one claim, and no property that starts with `.Token.`. Sliding: with a `TimeProvider` advanced 16 days, an `/api/me` call re-issues the cookie; at 14 days it doesn't (the framework renews only past half-life; Rosalina's "each visit extends it" copy is close enough). At 31 days idle → anonymous.
*Harness note (load-bearing):* .NET's `CookieContainer` won't send a `Secure` cookie over `http://`. The sign-in helper must keep its own jar: assert the attributes on every `Set-Cookie`, then replay `name=value` as a `Cookie` header. That way the regular tier runs the Production cookie flags over loopback http instead of quietly testing the Development flags.

**A11 (must-have). Logout: `POST api/auth/logout`, `AllowAnonymous`, always 204, behind the CSRF guard (A16), rate-limited by `auth` (A30).** It answers with a deleting `Set-Cookie` carrying the same name, `Path=/` and `Secure` (the deletion must match, or a `__Host-` cookie survives). `GET api/auth/logout` is the catch-all 404.
*Verify (harness):* sign in, then logout → 204 with an expired `Set-Cookie` for the same name, `Path=/` and `Secure`. Replaying the old jar after logout is still accepted (the stated residual, design §3.8; the test pins it so a future `session_epoch` flips it on purpose). Anonymous logout → 204.

**A12 (must-have). `OnValidatePrincipal` on `/api` requests: the `users` row must exist, otherwise `RejectPrincipal()` plus sign-out.** A cookie that outlives its row reads as anonymous on the same request (Bowser's P5).
*Verify (harness):* sign in, delete the row, then `GET api/me` → 200 anonymous with a deleting `Set-Cookie`; `POST api/creations` → 401, not a 500 FK violation.

## 3. CSRF

**Ruling: Yoshi's design is sufficient without antiforgery tokens, with the amendments in A13–A17.** Every current engine sends `Sec-Fetch-Site` or `Origin` on unsafe requests, so the guard alone stops browser CSRF. `Lax` plus the preflight wall cover older browsers. Tokens defend nothing that the guard and those two layers don't already cover here, and XSS bypasses all of them alike.

**A13 (must-have). The guard (`CrossOriginWriteGuard`) runs on every unsafe method (anything but GET, HEAD, OPTIONS and TRACE), on every path, not only `/api`.** Order: after `UseAuthentication` (so the remote-auth callback, which completes inside `UseAuthentication`, never reaches it) and before `UseAuthorization`.
- `Sec-Fetch-Site` present → allow only `same-origin`. `same-site`, `cross-site` and `none` → 403.
- Otherwise, `Origin` present → allow only when it equals `Request.Scheme + "://" + Request.Host` (ordinal, ignoring case). `Origin: null` → 403.
- Both absent → allow (non-browser clients aren't CSRF vectors).
- 403 `{ "message": … }`, `no-store`, not counted by the limiter.

*Verify (harness):* for each of POST create, PUT, DELETE, remix and logout, with a valid signed-in jar: `Sec-Fetch-Site: cross-site`, `same-site` and `none`; `Origin: http://evil.example`; `Origin: null` → 403, and the row count and the row's `updated_at` are unchanged. `same-origin` with a matching `Origin`, and both absent → reach the next gate. *Negative control:* unregister the guard; the five hostile cases must reach the service (201 or 200).
*Verify (smoke, local, real browser):* **ports don't make a different site, so `http://localhost:5190` is same-site with `http://localhost:4200`.** That is exactly the "sibling subdomain" case, reproducible locally. A page on the stub's origin, with the user signed in on 4200, (a) submits a `<form method=post action="http://localhost:4200/api/auth/logout">`, then (b) runs `fetch('http://localhost:4200/api/creations', {method:'POST', mode:'no-cors', credentials:'include', body:new Blob([json])})`. Expected: `api/me` is still signed in and no creation row was added. Add it to the regular smoke if it stays within budget, otherwise to daily.

**A14 (must-have). Delete the Development `FrontendDev` CORS policy, `UseCors`, and `Cors:AllowedOrigins`** (Program.cs l.62–76 and l.129, and `appsettings.Development.json`).
*Verify (harness, Development and Testing):* an `OPTIONS` preflight to `/api/creations` with `Origin: http://evil.example` and `Access-Control-Request-Method: PUT` gets no `Access-Control-Allow-*` header. Source guard: no `AddCors` or `UseCors` under `src/api/Fireworks.Api`.

**A15 (must-have). The dev proxy keeps `Host`.** `proxy.conf.json` has no `changeOrigin` (true today), so `Origin` matches `Host` through 4200.
*Verify:* a cheap spec that parses `proxy.conf.json` and asserts that no entry sets `changeOrigin`; the smoke's signed-in save through 4200 is the positive case.

**A16 (must-have). No GET or HEAD endpoint changes server state.** `Lax` sends the cookie on cross-site top-level GETs. The login GET sets only the correlation cookie. Login CSRF through it signs the victim into the victim's own Google account, which is harmless.
*Verify (harness):* the A20 endpoint enumeration also asserts that the GET and HEAD endpoint set equals {share GET, `api/me`, `api/me/creations`, `api/client-config`, health ×2, login, catch-all, SPA fallbacks}.

**A17 (must-have). Antiforgery-token triggers** (Yoshi's list, plus three): any CORS policy in any environment; a second origin that writes; an endpoint that accepts a CORS-safelisted content type or a form post; removal of, or an exemption added to, the guard; **any GET that changes state; relaxing the session cookie to `SameSite=None`; the guard allowing `same-site`.**

## 4. Authorization

**A18 (must-have). One predicate decides "signed in":** `FireworksClaims.TryGetUserId(ClaimsPrincipal, out Guid)` (a parseable, non-empty `NameIdentifier`). `ClaimsCurrentUser` uses it, and the fallback policy is `RequireAuthenticatedUser()` **plus** `RequireAssertion(ctx => TryGetUserId(ctx.User, out _))`. Without the assertion, a cookie with an unparseable id passes the policy and reaches the service's 403. With it, the policy and `ICurrentUser` can never disagree.
*Verify (harness):* a ticket minted with `NameIdentifier = "x"` (through the app's ticket format) → writes 401 and `api/me` anonymous. *Negative control:* drop the assertion; the write becomes 403.

**A19 (must-have). Schemes: `DefaultScheme`, `DefaultChallengeScheme` and `DefaultSignInScheme` are all the cookie scheme.** Google is challenged only by name, from the login endpoint. `OnRedirectToLogin` → 401 and `OnRedirectToAccessDenied` → 403, by mutating `options.Events`. If Google were the default challenge scheme, an anonymous POST would 302 to Google.
*Verify (harness):* an anonymous POST, PUT, DELETE or remix, and `GET api/me/creations`, → **401**, no `Location`, no `Set-Cookie`, `no-store`, and no stub call.

**A20 (must-have). The anonymous set is pinned from `EndpointDataSource`** (design §3.2's list): share GET, `api/me`, `api/client-config`, login, logout, `/health/live`, `/health/ready`, the `/api/{**rest}` catch-all, the three SPA fallbacks, and Swagger in Development only.
*Verify (harness, Testing and Development):* the exact sorted set of endpoints with `IAllowAnonymous`. *Negative control:* add `[AllowAnonymous]` to `Update`; the test must fail.

**A21 (must-have). 401 versus 403:** 401 means no valid identity (anonymous, tampered, expired, a deleted row, an unparseable id). 403 is only the CSRF guard and the service's defense-in-depth gate, which stays (`CanWrite && UserId != null`). No roles. Anonymous `GET api/me/creations` becomes 401 (it was 403); `mine-page.ts`'s `forbidden` branch becomes the 401 branch.

**A22 (must-have). Ownership is unchanged: owner from `ICurrentUser.UserId` only (S7), and PUT and DELETE filter by owner in one predicate with a byte-identical 404 (S9).**
*Verify (harness), the two-account suite through the stub (alice, bob):* bob's PUT and DELETE on alice's code → 404 bytes equal to a random code's; bob's remix → 201 owned by bob, with `remixedFrom` = alice's code for bob only; bob's GET of alice's → `isOwner: false`, `remixedFrom: null`; bob's `/mine` lacks alice's rows. Anonymous: GET works, every write 401. Exact call ledger on the repository fake for bob's PUT: one owner-filtered lookup, zero updates.

**A23 (must-have). Legacy default-user creations are unreachable for writes by construction.** Provisioning resolves only `WHERE external_provider = @p AND external_subject = @s`, both non-null (the check constraint), and never falls back to a display-name match, the first row, or a configured id.
*Verify (harness):* seed the legacy row and a legacy creation, then sign in as alice and bob: neither `api/me.userId` equals the legacy id; PUT and DELETE → 404; remix → 201; GET → `isOwner: false`, `remixedFrom: null`, `-p` ETag.

**A24 (must-have). The claim SQL is a README runbook step, never a migration or startup code.** Skyler signs in, reads `userId` from `GET /api/me` in his browser (the one legitimate use of `MeResponse.userId`), then runs `BEGIN; UPDATE creations SET owner_user_id = '<his id>' WHERE owner_user_id = '6933f933-a9e9-443b-b7c7-6e3e01901a34';` and checks that the row count is the expected number before `COMMIT`. The legacy `users` row stays. Interaction: before the claim he is a non-owner (Save remixes). After it, his cached `-p` copy revalidates to a 200 owner representation (A27), so no stale `isOwner` survives.
*Verify (Mario at the gate):* the README entry exists. Source guard: the legacy GUID appears only in the README, migrations and tests.

## 5. Caching and privacy of responses

**A25 (must-have). `Vary: Cookie` on the share GET's 200 and 304** (P7-S18).
*Verify (harness):* the header is present on both. *Negative control:* remove it.

**A26 (must-have). `-p` ETag:** the owner gets `"<updatedAt>"` and everyone else `"<updatedAt>-p"`. `If-None-Match` compares against the viewer's own tag.
*Verify (harness):* the owner's tag sent anonymously → 200 with `-p`; the `-p` tag sent as the owner → 200 with the plain tag; each identity's own tag → 304; `*` → 304 for either (the RFC rule; the body that follows is the viewer's own). *Negative control:* no `-p` branch.

**A27 (must-have). `no-store` everywhere else, including every response that carries `Set-Cookie`:** login 302, callback 302s (success and failure), logout 204, `api/me`, 401, 403, 412 and 428. The cookie handler's own `no-cache` plus `Pragma` survive under `ResponseHeaders`' "only if unset" rule. Accepted, as long as `no-store` is in the value.
*Verify (harness):* extend `ApiCacheControlLedgerTests` with every auth response; assert that `Cache-Control` contains `no-store` whenever `Set-Cookie` is present.

**A28 (must-have). Envelope keys unchanged (S12); no owner data in any share-code response.** No owner id, display name, `signedInWith` or provider subject in `CreationResponse` or list items. `remixedFrom` only to the remix's owner. `MeResponse` gains only `signedInWith`, and never the Google `sub` or an email.
*Verify (harness):* the S12 exact-keys test runs as anonymous, owner and non-owner. `MeResponse`'s exact keys are `userId, displayName, isAuthenticated, canWrite, signedInWith`.

**A29 (must-have). If-Match on PUT (design §5.3), with two amendments.** **`If-Match: *`, a list, or a weak tag → 412**, so "Overwrite" stays a deliberate GET-then-PUT. This is a deliberate deviation from RFC 9110 for `*`; Yoshi records it in `schema.md` §11.4. A missing header → 428 (header only, before the body). A mismatch → 412 with the current `ETag`, only after the owner-filtered 404. The check is in the UPDATE (`… AND updated_at = @tag`); on zero rows, re-check the desired state (owned and present → 412, otherwise 404).
*Oracle analysis (settled):* 428 fires whether or not the row exists, so it reveals nothing. 412 and the document 400 are reachable only by the owner. Non-owners see 404 for every tag.
*Verify (harness):* bob with no header → 428, and with alice's current tag → 404; alice with a stale tag → 412 plus `ETag`; with `*` → 412; with `W/"…"` → 412; with an unparseable tag → 412; with the current tag → 200. Race: two PUTs with the same tag → exactly one 200 and one 412, at a round count measured against a read-then-write mutant (`toad-api-harness-concurrency-…`).

## 6. Rate limits and proxies

**A30 (must-have). Partition `"u:" + userId` (from `ICurrentUser`, after `OnValidatePrincipal`) when signed in, otherwise `"ip:" + <today's key>`,** for the read and write policies. A new `auth` policy, 20 per minute per IP, covers login **and logout**. The limiter stays after `UseAuthorization`. Unlimited 401s and guard 403s are accepted: they touch no database. Stated residual: a signed-in cookie costs one primary-key lookup per request before the limiter.
*Verify (harness, low limits):* alice exhausts writes and bob, from the same IP, still writes; anonymous reads from one IP share a bucket; the 21st login in a minute → 429. *Negative control:* key by IP only; the alice/bob case fails.

**A31 [R] DEFERRED.** `KnownProxies` / `KnownIPNetworks` stay cleared until the first Railway deploy (S21). Don't enable `XForwardedHost` unless that deploy shows Railway rewrites `Host`; if it is enabled, `AllowedHosts` must name the public host plus `healthcheck.railway.app`. Also at that deploy: the Google redirect URI matches, the session cookie carries `Secure` through the edge, `ASPNETCORE_ENVIRONMENT=Production` and no stub warning (A35) appears in the log, and whether `up.railway.app` is on the Public Suffix List (it decides how much `__Host-` matters there).

## 7. Secrets and startup guards

**A32 (must-have). Google `ClientId` and `ClientSecret` come from `Auth:Providers:Google:*`: user-secrets in Development (add `<UserSecretsId>` to the csproj) and environment variables in Docker and Railway (`Auth__Providers__Google__ClientSecret`). Never in `appsettings.json`.** `appsettings.Development.json` may hold only the stub's endpoints and the sentinel pair `fireworks-stub-client` / `stub-secret-not-a-credential`. An **empty** override value means "use the handler default", so a user-secrets override to real Google can blank the stub endpoints.
*Verify (Program and a committed-config test):* `appsettings.json` has no `Auth:Providers:Google:ClientSecret`; any committed `ClientSecret` equals the sentinel; no file under `src/`, `tools/` or the repo root (excluding `node_modules`, `bin` and `obj`) contains `GOCSPX-` (Google's secret prefix). Startup error messages name keys, never values (test: a startup failure's stderr never contains the configured secret).

**A33 (must-have). Production fails fast:** startup throws when `ClientId` or `ClientSecret` is missing or blank, when either equals the stub sentinel, or when any `AuthorizationEndpoint`, `TokenEndpoint` or `UserInformationEndpoint` override is non-empty. Endpoint overrides are honoured only when the environment is `Development` or `Testing`. **This replaces design §3.4's "a provider with no ClientId is simply not offered"** for Production: with one provider, that would be a silently write-dead deploy. An empty `loginProviders` remains reachable only in Development and Testing.
*Verify (Program):* Production with an override → non-zero exit naming the key; Production with the sentinel → non-zero; Production with no ClientId → non-zero; Production with dummy non-sentinel values → starts; Testing with overrides → starts. *Negative control:* remove the environment check; the override case starts.

**A34 (must-have). Stale `Identity:*` configuration throws** (design §3.5), including `Identity__AllowAnonymousWrites` from the environment. Update `tools/test/lib.mjs` l.129–138 (today it runs the smoke API as **Production with `Identity__AllowAnonymousWrites=true`**; that becomes **Testing plus the stub**), `railway.toml` l.19, `Fireworks.Api.http`, the csproj comment and the README.
*Verify (Program):* each `Identity` key set alone → non-zero exit with the design's message. The source guard (design §3.5) also covers `tools/` and `railway.toml`.

**A35 (must-have). Whenever endpoint overrides are active, startup logs one Warning:** "Sign-in uses stub OAuth endpoints (…host…)". It is visible in any log, the way the anonymous-writes warning was.
*Verify (Program):* Testing with overrides → the line is on stdout; with no overrides it isn't.

**A36 (must-have). Docker-image verification runs as `ASPNETCORE_ENVIRONMENT=Testing`, with the stub as a compose sidecar.** Testing gets every non-Development behaviour (`Secure` cookies, forwarded headers, HSTS logic) except the stub allowance. That is where P3 (`Secure` and `__Host-` on `http://localhost` in Chromium) is measured. **Production with real Google on the image is [R] DEFERRED** (it needs a registered Google client).

**A37 (must-have; residual accepted with triggers). DataProtection keys in Postgres (`PersistKeysToDbContext`, `SetApplicationName("Fireworks")`) are stored unencrypted.** Anyone holding a database read or a **backup file** can forge a session for any user, which turns a read leak into account takeover. Accepted while the data is low-value. **The Phase 7 backup runbook must say backups are credentials.** Trigger for `ProtectKeysWith*` (a certificate from an env var): backups leave the machine or Railway; a second person or app gets read access to the database; or any sensitive field is stored (for example email). Don't suppress the "no XML encryptor" warning.
*Verify (Postgres):* sign in through the stub against the Program child process, restart the process, then the same jar → `api/me` is authenticated. *Negative control:* without `PersistKeysToDbContext` → anonymous after the restart.

## 8. Privacy

**A38 (must-have). Store only `external_provider = 'google'`, `external_subject = sub` (the key per P7), and `display_name` = Google `name` through the §6.4 pipeline (blank → `"User"`).** No email, picture, locale, given or family name, or tokens. The display name is shown only to its owner (`api/me`) and rendered as text (C1).
*Verify (harness):* the stub's userinfo also returns `email`, `picture` and `locale`. After sign-in, the `users` row has only the expected columns set, and the ticket holds one claim (A10).

**A39 (must-have). Logging: our code logs `users.id` on provisioning, and never logs the Google `sub`, the display name, `code`, `state`, the access token or the client secret at any level. `Microsoft.AspNetCore` stays at `Warning` in the committed config**, which keeps the hosting request line, with the callback's `?code=…&state=…`, out of the logs.
*Verify (harness):* a capturing logger provider at `Trace` for `Fireworks.*` during a stub sign-in: no message or scope contains the stub's subject, name, code or token strings. Committed-config test: `Microsoft.AspNetCore` ≥ `Warning` in both appsettings files.

## 9. Client rulings (re-rules of my Phase 5 record)

**A40 (must-have; re-rules C9).** **New C9:** write *requests* need `session.canWrite()`, never `isOwner` alone. Update original needs `canWrite && source.isOwner`; Delete on `/mine` needs `canWrite`. When `!canWrite` and `loginProviders` is non-empty, **a Save control may render whose only action is the sign-in prompt.** It sends no request other than the navigation, which comes after `flushDraft()`. Update original, Save as new and Delete do not render while `!canWrite`. With an empty `loginProviders` (Development or Testing only, A33), the Save bar follows Rosalina's "Sign-in isn't available" state and sends nothing. The player's Remix is unchanged (opens a working copy, with no write).
*Verify (client spec plus smoke):* call ledger. An anonymous click on Save in the designer, the builder and the player-to-working-copy path → zero `POST`, `PUT` and `DELETE`, and exactly one `location.assign` to `/api/auth/login/google?returnUrl=…`, preceded by one draft flush. *Negative control:* wire Save to `saveNew` while anonymous; the ledger must fail.

**A41 (must-have). Returning from sign-in never writes.** No auto-save, and no query flag (`?save=1` or similar) is honoured. Otherwise an attacker-started login navigation (A16) could make a victim save a planted draft into their own account. A 401 during a save reloads the session and does not retry.
*Verify (client spec):* restore after return → zero writes until a user click. A 401 on PUT → one `api/me` reload, zero retries.

**A42 (must-have; re-rules C17, per Skyler's ruling). The test-mode banner and `TEST_MODE_TEXT` are deleted. S28's blast-radius text is retired** from the README and `railway.toml`. It is replaced by a server invariant: `MeResponse.canWrite == MeResponse.isAuthenticated` for anonymous, signed-in, deleted-row and unparseable-id cookies (A12, A18).
*Verify (harness):* the four cases. *Negative control:* `CanWrite => true`; the anonymous case must fail.

**A43 (must-have; amends C10). `remixedFrom` renders only when `session.isAuthenticated() && response.isOwner`, as a `/s/<code>` link built only after the share-code regex (C4, C11), and as text otherwise.** C7 stands: `isOwner` never authorizes. The design §6.4 refresh of `source.isOwner` on restore changes only which Save options appear.
*Verify (client spec):* a stubbed `isOwner: true` with an anonymous session → not rendered; a malformed code (`../me`) → not rendered.

> Amended by yoshi-phase8-auth-design.md (Boundary) on 2026-11-16: the rule is page-level (the prompt in place, zero list calls while signed out or undecided), with no guard or redirect. Confirmed by boo-phase8-security-verification.md, ruling 2.

**A44 (must-have). The `/mine` guard awaits `session.settled()` and redirects to `/signin?returnUrl=/mine`.** The guard is UX only; the server's 401 (A19) is the control.
*Verify (client spec):* anonymous → UrlTree, and zero `api/me/creations` calls.

---

## Hardening suggestions (not required)

- **H1.** An absolute session cap (for example 180 days from the first sign-in, stored as a ticket property and checked in `OnValidatePrincipal`), so a stolen cookie that is used regularly doesn't live forever. Trigger: the same as `session_epoch` (account deletion or "sign out everywhere" is requested).
- **H2.** `Clear-Site-Data: "cache"` on logout, to drop cached owner representations on a shared browser. Vary plus `-p` already cover this; the header costs a re-download of the immutable bundles.
- **H3.** Chain an IP window onto authenticated writes. This is Yoshi's §3.6 trigger (100 new users a day or 10,000 in total); I agree with the trigger.

## Info

- `MeResponse.userId` (UUIDv7) reveals the account's creation time, to its owner only. Accepted; it serves the claim runbook.
- The localStorage draft survives sign-out on a shared browser. It is device-owned anonymous work by design; Rosalina may add copy.
- An exception thrown in `OnTicketReceived` (the database down during provisioning) is likely a ProblemDetails 500 at the callback URL rather than `/signin?error=1`. It is not a security issue, but Bowser should probe it with P2.

## Why

Phase 8 turns `isOwner`, `remixedFrom` and the 404 rule from interim theatre into real cross-user boundaries, and it adds the first ambient credential. Each requirement either pins a framework default that is wrong for this app (correlation `SameSite`, `Challenge` on an unknown scheme, `CookieContainer` and `Secure`, Google's default `email` scope, the default challenge scheme), or makes a design claim testable on localhost. The key local lever is that `localhost:5190` and `localhost:4200` are same-site, so the "same-site, cross-origin" CSRF gap is reproducible without a deploy.

## Boundary

- Binds B1, B2 and B3 once forwarded. Bowser implements A1–A39 (server); Luigi implements A5 (client half), A6 and A40–A44; Toad covers the stub's checks, the smoke cases (A3, A6, A13, A40) and the negative controls.
- **Supersedes in part** `boo-phase5-security-requirements.md` C9 (A40), C10 (A43) and C17 (A42), and `boo-phase4-security-requirements.md` S17 (A30) and S28 (A42). The records stay, marked by Scribe. The index rows for C17 and the Phase 5 summary are Skyler's to update.
- **Changes Yoshi's design** at §1.3/§3.8 (correlation cookie, A3), §3.2 (the predicate, A18), §3.4 (allowlist A9, `returnUrl` A5, Production fail-fast A33), §3.9 (the guard's scope, A13), §5.3 (`*`, A29), and §7 C1 (Testing image, A36). Yoshi folds these in when he edits `schema.md` and the design.
- Doesn't decide copy or placement (Rosalina) or the GitHub question (moot).

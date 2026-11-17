# Phase 8: authentication design

**Date:** 2026-11-16 · **Author:** Yoshi (design lead, plan Phase 8) · **Status:** adopted 2026-11-16. Skyler's rulings (§9), Boo's 8.0a amendments (`boo-phase8-security-requirements.md` A1–A44) and Rosalina's 8.0b rulings (`design/phase-8.md`) are folded in place; `schema.md` is updated (§5.5). Pending: Bowser's probe P3 (the `__Host-` cookie name, §3.8) · **Record:** `.squad/decisions/records/yoshi-phase8-auth-design.md`

**Inputs, read as code:**
- `src/api/Fireworks.Api/Services/Identity/{ICurrentUser,DefaultUserCurrentUser,DefaultUserOptions,IdentityRegistration}.cs`
- `Program.cs`
- `Data/{FireworksDbContext,FireworksDbInitializer}.cs`, `Data/Entities/User.cs`
- `Services/RateLimiting/FireworksRateLimiting.cs`, `Services/ResponseHeaders.cs`, `Services/MeService.cs`
- `Controllers/CreationsController.cs`: `ShareCodeGetCacheControl = "private, no-cache"` and `MatchesIfNoneMatch`
- `Services/Creations/CreationService.cs`: the write gate at l.273–276 and `isOwner` at l.342
- `Fireworks.Api.Tests/Controllers/FireworksApiHarness.cs` and `Support/TestIdentity.cs`
- Client: `core/session.ts`, `app.config.ts`, `app.routes.ts`, `shared/test-mode-banner.ts`, `features/designer/pages/designer-page/{designer-save,shell-designer.store}.ts`, `features/show/pages/show-builder-page/{show-save,show-builder.store}.ts`, `features/mine/pages/mine-page/mine-page.ts`, `proxy.conf.json`
- `schema.md` §2.1, §2.1.1, §2.6, §2.7, §10, §11
- `boo-phase7-security-requirements.md` P7-S18 and `boo-phase5-security-requirements.md` C7, C9, C10, C17
- The skill `aspnet-request-gates` (trap 8)
- The reference app:
  - `monster-of-the-week-net-angular/src/api/MonsterOfTheWeek.Api/{Program.cs,Controllers/AuthController.cs,Services/AuthService.cs,Data/MotwDbContext.cs}`
  - `src/web/monster-of-the-week-web/src/app/core/{auth,auth-guards}.ts`
  - `docs/authentication-update/architecture.md` §1 and §7, and `docs/simple-authentication-update/architecture.md` §2

**Hard constraint (Skyler):** the Railway deploy is still deferred. Everything below must work fully on `localhost` (the `ng serve` loop on 4200 and the API on 5180) and in the Docker image (`ASPNETCORE_ENVIRONMENT=Production`, HTTP on 8080, `README.md` l.278).

**A fact that shapes §4:** because Railway never shipped, **no production database exists**. The default user's creations exist only in local and dev databases.

---

## 0. Recommendation in one paragraph

**Sign-in uses Google OAuth (Skyler: Google only), and the session is the reference app's cookie** (`HttpOnly`, `SameSite=Lax`, `Secure` outside Development, keys persisted to Postgres).
- No passwords, email or Identity tables. `users` gains `external_provider` and `external_subject`. A login provisions a row on first use, and the cookie carries only our `users.id`.
- The seam change is exactly what plan §3.4 promised: one DI registration (`ClaimsCurrentUser`) plus a fail-closed fallback authorization policy. `owner_user_id`, the documents and the envelope don't change.
- CSRF is covered without antiforgery tokens: `SameSite=Lax`, the existing JSON-only, preflight-forcing write surface, and a small Fetch-Metadata/Origin check on every unsafe request (§3.9).
- Tests never touch a real provider. A stub OAuth server in Google's shape, reached through the same handler configuration, signs in as any number of fake accounts (§1.4). It is the default in local dev and tests, and Production refuses it at startup.

---

## 1. Provider options

### 1.1 Comparison

| | (a) Local accounts: ASP.NET Identity, email + password | (b) External OAuth: Google **(chosen; GitHub was dropped by Skyler)** | (c1) Passkeys (WebAuthn) | (c2) Magic link (email) |
|---|---|---|---|---|
| **What we build** | Register, login, logout, confirm email, forgot and reset password, change password. Password policy, lockout, enumeration-safe responses. An `IEmailSender`. Identity's tables mapped onto `users` (reference robust plan, `authentication-update/architecture.md` §1 option A, §5, §7). | A challenge endpoint, the handler callback, provisioning on first login, logout. No credential storage. | Identity (all of (a)'s storage) plus .NET 10+ Identity passkey APIs, client `navigator.credentials` flows, and a recovery path (which needs email, so (c2) as well). | A token table (single use, short TTL), send and verify endpoints, a send throttle, and an email vendor. |
| **Setup cost** | No vendor for login. An email vendor (and a sending domain with SPF/DKIM) is needed for confirmation and reset, and the custom domain is deferred (OQ18). | One Google Web client with several redirect URIs (`localhost:4200`, `localhost:8080`, later Railway) and an OAuth consent screen ("External"; only basic scopes are requested). | Like (a), plus an RP ID decision. A passkey is bound to its domain: **moving from `*.up.railway.app` to a custom domain later orphans every passkey.** | An email vendor plus a verified sending domain, which needs the deferred custom domain. |
| **Secrets and config** | Email API key. | `Auth:Providers:Google:ClientId/ClientSecret`. `dotnet user-secrets` locally, env vars for Docker and Railway (`Auth__Providers__Google__ClientSecret`); never in `appsettings.json` (Boo A32). Production refuses to start without them (A33). | As (a). | Email API key. |
| **Local dev** | Fully offline (a log-only email sender). | Works on plain `http://localhost`: Google accepts a loopback `http` redirect URI, so no TLS is needed locally (§1.3). Offline dev and tests use the stub (§1.4). | Works on `localhost` (a secure context), but local passkeys never carry over to the deployed domain. | Offline with a log-only sender. |
| **Security trade-offs** | We hold password hashes and own breach response, credential stuffing, lockout tuning, reset-token handling and account enumeration (the reference spent a whole section on it, §7). The largest attack surface of the four. | No secrets at rest beyond one client secret. MFA and credential hygiene are the provider's. Our risks are `state` and correlation (handled by the framework handler), an open redirect through `returnUrl` (validated, §3.4), and account takeover at the provider. We store no email: provider, subject and a display name only. | Phishing-resistant and the strongest option, but recovery falls back to email, the domain-binding problem is real while the domain is undecided, and it doesn't remove (a)'s storage. | Account security equals the mailbox's. Email bombing needs a throttle. Links opened on another device are a UX problem. Deliverability is a running cost. |
| **Tests without a real provider** | All in-process. | A stub OAuth server (authorize, token and userinfo endpoints, Google's shape) wired through the real handler's configurable endpoints: C# in-process and a Node script for Playwright (§1.4). Real `state`/correlation, provisioning and cookie code run in every test. | Server side needs attestation fixtures. Browser side uses a Chromium virtual authenticator (CDP). Heavier. | A capturing sender. |
| **Effort (estimate)** | Bowser 5–7 days, Luigi 3–4 days (five pages), Rosalina 1 day, plus the email vendor. | **Bowser 2.5–3 days** (incl. stub and migrations), **Luigi about 2 days**, Rosalina half a day. | (a) plus 4–6 days. | 3–4 days plus the vendor and domain. |
| **Verdict** | Rejected for now: the most work and the most risk, for a hobby app with no accounts yet. | **Chosen.** | Not now. **Trigger:** the custom domain is fixed (OQ18) **and** local accounts exist. Then add passkeys as a second method. | Not now. **Trigger:** a custom domain with a sending setup exists **and** a user without a Google account asks for one. |

**The plan's first option, "the reference's cookie auth extended to multiple users", is rejected as written.** `AuthService.cs` compares plaintext passwords (`string.Equals(user.Password, password)`) against rows inserted by SQL, and has no registration. Extended to strangers it needs hashing, registration and reset, which makes it option (a). **What we do mirror from the reference is its session layer:** `AddCookie` options, the 401/403 overrides, the fallback policy and DataProtection (§3).

### 1.2 Decision and why

**(b) with Google only** (Skyler, OQ19, 2026-11-16):
- **It is the least code that meets the Done-when.** "Anonymous users can play but get a login prompt when they try to save" and "two real accounts can't edit each other's creations" need an identity and a session, not credential storage.
- **It needs no email, so it doesn't depend on the deferred custom domain.**
- **It keeps the §3.4 promise literally.** The schema, services and controllers don't change. `users` gains the two columns `User.cs` already describes.
- **It doesn't close the door on (a), (c) or a second provider.** Each is another scheme in `AddAuthentication` that resolves to the same `users.id`. The provisioning service (§3.3) is the one place that maps an external identity to a row. `{provider}` in the routes and `loginProviders` stay as one-entry lists (Boo A9).

**Handler (Boo A1):** `Microsoft.AspNetCore.Authentication.Google` (`AddGoogle`), first-party.
- **The OAuth handler, not OpenIdConnect.** That handler fetches discovery and validates an `id_token` against Google's keys, which a stub has to fake as well. The OAuth handler uses three plain endpoints, and **there is no nonce** in this flow (only `state` and the correlation cookie).
- `SignInScheme` = the cookie scheme, `SaveTokens = false` (the provider's access token is never persisted), and `UsePkce = true` set explicitly (probe P6 checks the installed default).

**Scopes:** `Scope.Clear()`, then `openid` and `profile` only. The Google defaults include `email`, so `Clear()` is required. That is what makes Rosalina's privacy line ("keeps your name from Google, not your email address") true.

### 1.3 Redirect URIs, HTTPS and local dev

- **`CallbackPath = /api/auth/callback/{provider}`**, under `/api` on purpose, so `proxy.conf.json`'s existing `/api` entry already forwards it in the `ng serve` loop. The remote-authentication handler answers it inside `UseAuthentication()`, before any endpoint (including the `/api/{**rest}` catch-all) runs.
- The handler builds `redirect_uri` from `Request.Scheme` and `Host`:
  - **Dev loop:** the proxy has no `changeOrigin`, so the API sees `Host: localhost:4200` and the URI is `http://localhost:4200/api/auth/callback/google`. Register exactly that. **Never add `changeOrigin: true`**: it would change the redirect URI and break the Origin check (§3.9).
  - **Docker image:** `http://localhost:8080/api/auth/callback/google` (or whatever host port is mapped; the README suggests `127.0.0.1:18080` when 8080 is taken, and the redirect URI must then match that port).
  - **Railway, later:** `https://<domain>/api/auth/callback/google`. `UseForwardedHeaders` already makes the scheme `https`. **Probe on the first deploy:** whether Railway's edge passes the original `Host`. If it doesn't, the redirect URI is wrong and `ForwardedHeaders.XForwardedHost` must be added. Fold this into Boo's S21 first-deploy checks.
- **No HTTPS is needed locally.** Google accepts `http://localhost` redirect URIs, and Chromium treats `http://localhost` as a secure context, so it stores `Secure` cookies from it.
- **Correlation cookie (Boo A3):** `SameSite=Lax` in every environment, set explicitly (the framework default is `None`, which Chromium rejects without `Secure` and so would break the http dev loop). `SecurePolicy = Always` outside Development, `SameAsRequest` in Development. Lax suffices: the return from Google is a top-level GET.
- **Docker image caveat:** the image's stub runs are **`ASPNETCORE_ENVIRONMENT=Testing`** with the stub as a compose sidecar (Boo A36), so the session and correlation cookies are `Secure` over `http://localhost`. Chromium and Firefox accept them on `localhost`. **WebKit/Safari is expected not to**, so a local Docker sign-in is a Chromium/Firefox check. That matches the gate browsers (Chromium only). **Probe P3** confirms it. Production with real Google on the image is [R] deferred.
- **CSP:** sign-in is a top-level navigation (`location.assign('/api/auth/login/google?returnUrl=…')`), not `fetch`, so `connect-src 'self'` is not involved.
  - **It must not be a `<form>` POST.** `form-action 'self'` is enforced on the redirect that follows a form submission, so a 302 to `accounts.google.com` would be blocked. A GET navigation is not governed by `form-action`.
  - No provider avatars are shown, so `img-src 'self'` stays.
  - `Cross-Origin-Opener-Policy: same-origin` rules out a popup flow (it severs the opener), so the redirect flow is the only flow. No CSP or header change is needed for sign-in (Boo A6). **Probe P4** is closed locally by the smoke's zero `securitypolicyviolation` events across a stub round trip; the Google-origin repeat is [R]. (`font-src 'self'` for a self-hosted Google Sans is Rosalina's separate request to Boo, design `phase-8.md` §3.)

### 1.4 Testing without a real provider

- **The stub provider** is about 60 lines: `GET /authorize` redirects back to `redirect_uri` with `code` and the echoed `state`, `POST /token` returns an access token, and `GET /userinfo` (Google's shape; the subject key per probe P7) returns a subject chosen by the test through `login_hint`. **It is a test double with real checks** (Boo A7): it binds `127.0.0.1` only, requires the exact `client_id`, `client_secret` and `redirect_uri`, issues single-use codes and enforces PKCE S256.
  - **C# (regular tier):** `Fireworks.Api.Tests/Support/StubOAuthProvider.cs`, Kestrel on `127.0.0.1:0`. The harness sets `Auth:Providers:Google:{AuthorizationEndpoint,TokenEndpoint,UserInformationEndpoint}` to it.
  - A helper, `SignInAsync(HttpClient, subject)`, walks challenge → stub → callback with **its own cookie jar**, not a `CookieContainer` (which won't send a `Secure` cookie over `http://`): it asserts the attributes on every `Set-Cookie` and replays `name=value`, so the regular tier runs the non-Development cookie flags (Boo A10). That is three local hops, a few milliseconds, and real `state`, correlation, provisioning and cookie code.
  - Every ownership test signs in "alice" and "bob" this way.
- **Playwright (regular-tier smoke and daily):** `tools/fake-oauth/server.mjs` (Toad), with the dev API pointed at it the same way.
- **The endpoint overrides are honored only in Development and Testing** (Boo A33). **Production fails fast** when `ClientId` or `ClientSecret` is missing or blank, when either equals the stub sentinel (`fireworks-stub-client` / `stub-secret-not-a-credential`), or when any `*Endpoint` override is non-empty, so a production image can't be pointed at a stub by a stray variable, and can't start silently write-dead. Startup messages name keys, never values. Whenever overrides are active, startup logs one Warning, "Sign-in uses stub OAuth endpoints (…host…)" (A35). Program tests cover each case.
- **`Testing` is the only non-Development home for the stub:** the harness (already `Testing`), the smoke API in `tools/test/lib.mjs` (today Production plus `Identity__AllowAnonymousWrites=true`, which becomes Testing plus the stub, A34) and the Docker verification (A36).
- **Local dev without secrets** uses the same stub: `appsettings.Development.json` points Google at `http://localhost:5190` (the stub's port) with the sentinel client pair by default, and Skyler's real Google dev client overrides it through user-secrets (an **empty** override value means "use the handler default", so user-secrets can blank the stub endpoints, A32). **There is no dev-only login scheme and no dev-only code path.** Only configuration differs, which is what keeps Done-when 3 ("the interim default-user code path is gone from production") clean.
- **Rejected alternative:** a Development-only "sign in as" scheme. It is less setup, but it is a second authentication path that must never ship, and the stub gives the same convenience with zero production code.

---

## 2. What Phase 8 does and doesn't change (one table)

| Changes | Doesn't change |
|---|---|
| `Services/Identity/*`, `Program.cs` steps 1, 9–12 and 16, `FireworksDbInitializer`, `User.cs` plus one migration, `FireworksRateLimiting.PartitionKey`, the PUT path (If-Match), the share GET (Vary, `-p`), `MeResponse` (one optional field), `ClientConfig` (one optional field), the harness | `owner_user_id`, `creations`, every document, `CreationResponse`, the `CanWrite && UserId != null` service gate (it stays as defense in depth), the 404-for-not-owned rule, share-code reads |

---

## 3. The seam, concretely (Bowser, batch B1)

### 3.1 `ClaimsCurrentUser` replaces `DefaultUserCurrentUser`

```csharp
public sealed class ClaimsCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    // Only our own claim, issued by SignInAsync after provisioning (§3.3). A provider's "sub" never reaches here.
    // FireworksClaims.TryGetUserId: authenticated identity, parseable, non-empty NameIdentifier.
    // The fallback policy's assertion calls the same function (§3.2, Boo A18).
    public Guid? UserId =>
        accessor.HttpContext?.User is { } user && FireworksClaims.TryGetUserId(user, out var id) ? id : null;
    public bool IsAuthenticated => UserId is not null;
    public bool CanWrite => IsAuthenticated;
}
```

- **The registration is in one place.** `AddFireworksIdentity(IServiceCollection, IConfiguration, IHostEnvironment)` registers the cookie, the providers, the fallback policy, DataProtection and `ICurrentUser`. A new `UseFireworksIdentity(WebApplication)` adds `UseAuthentication()`, the CSRF check (§3.9) and `UseAuthorization()`.
  - Program.cs **and `FireworksApiHarness`** call both, so the test host binds auth the way the app does. That is the pattern `IdentityRegistration` already documents, and the "test hosts bind exactly what real call sites bind" standing decision.
- **`IsAuthenticated` is defined as `UserId is not null`,** not `Identity.IsAuthenticated`. A cookie whose `NameIdentifier` is unparseable then counts as anonymous everywhere at once, and `CanWrite ⇒ UserId != null` holds by construction.
- The `NameIdentifier` and `Name` claim types match the reference (`AuthController.cs`: "the claim types Identity uses by default"), so adding (a) later reads the same claim.

### 3.2 Authorization policy: fail closed, mirroring the reference

- `AddAuthorizationBuilder().SetFallbackPolicy(...)` with `RequireAuthenticatedUser()` **plus `RequireAssertion(ctx => FireworksClaims.TryGetUserId(ctx.User, out _))`** (Boo A18). The reference's `Program.cs` l.102 has only the first; without the assertion, a cookie with an unparseable id passes the policy and reaches the service's 403. With it, the policy and `ICurrentUser` share one predicate and can never disagree.
- **Schemes (A19):** `DefaultScheme`, `DefaultChallengeScheme` and `DefaultSignInScheme` are all the cookie scheme. Google is challenged only by name, from the login endpoint; otherwise an anonymous POST would 302 to Google.
- Cookie events copied from the reference: `OnRedirectToLogin` → **401** and `OnRedirectToAccessDenied` → 403, **mutating** `options.Events`, never assigning a new object.
- **Anonymous endpoints**, each `AllowAnonymous()` or `[AllowAnonymous]`:
  - `GET api/creations/{shareCode}`, `GET api/me`, `GET api/client-config`;
  - `GET api/auth/login/{provider}`, `POST api/auth/logout`;
  - `/health/live`, `/health/ready`;
  - the `/api/{**rest}` catch-all (a 404 must stay a 404, not become a 401 that tells a scanner a route exists);
  - every `MapFireworksSpaFallback` endpoint (`/`, `/s/{**rest}`, `/c/{**rest}`);
  - Swagger in Development.
- **The set is pinned by a test that asks the defining artifact** (`koopa-derive-sets-from-the-defining-artifact.md`). It enumerates `EndpointDataSource.Endpoints` on the real host and asserts that the exact sorted set of endpoints carrying `IAllowAnonymous` equals the list above. A new endpoint is authenticated unless someone edits that list.
- **Authenticated:** `POST api/creations`, `PUT` and `DELETE api/creations/{shareCode}`, `POST …/remix`, `GET api/me/creations`.
- **An anonymous call there is now 401**, not today's 403. The 403 stays reachable only for the service's defense-in-depth gate, which can no longer fire.
- Static files are middleware before `UseRouting` and stay anonymous with no configuration (Program.cs step 9 comment, the reference's §2.3).
- **Pipeline order:** `UseRouting` → `UseAuthentication` (the Google callback completes here) → CSRF check (§3.9, every unsafe request on every path) → `UseAuthorization` → `UseRateLimiter`. That is where the Program.cs step 11a comment already reserves the slot.
  - Consequence: an anonymous write is rejected with 401 **before** the limiter, so it isn't counted. That is acceptable, because a 401 touches no database.
  - Status order on a write becomes **(the §3.9 cross-origin 403, which runs first) → 401 → 429 → 403 → 428 → 415 → 413 → 400 envelope → 404 → 400 document → 412** (§5.3). `schema.md` §2.6 and §2.7 carry it.

### 3.3 Provisioning on first login

- **Migration `AddExternalIdentity`:**
  - `users.external_provider varchar(32) null` and `users.external_subject varchar(255) null`.
  - A unique index `ix_users_external_provider_subject` over the pair.
  - A check constraint that both are null or both are set. The legacy default row has neither.
  - SQLite and Postgres both allow many NULL pairs under a unique index.
- **Where:** `Services/Identity/UserProvisioning.cs` (`IUserProvisioning.ResolveAsync(provider, subject, displayName)`), called from the Google handler's `OnTicketReceived`.
  - It finds the row by `(provider, subject)`, or inserts one with `Id = Guid.CreateVersion7()`.
  - It refreshes `display_name` when the provider's has changed.
  - It then **replaces the principal** with a fresh `ClaimsIdentity(cookie scheme)` that carries only `NameIdentifier = users.id`. The provider's claims are dropped, so the cookie stays small and holds no third-party data.
- **Subject:** Google's `sub` (stable), read from the userinfo key probe P7 confirms (`sub` on v3, `id` on v2) explicitly, never by claim-type guesswork.
- **Display name (stored, Skyler 2026-11-16):** Google `name`, shown only to its owner (`api/me`). Run it through the C# name pipeline of `schema.md` §6.4 (strip Cc and lone surrogates, trim, cut at 80 code points; blank becomes `"User"`, not `"Custom"`). It is rendered as text only (Boo C1).
- **Race:** two first logins at once both miss and both insert. The loser's insert fails on the unique index; it re-queries by `(provider, subject)` and uses the winner's row, rethrowing only if the row still isn't there (`boo-race-guards-check-desired-state.md`, the same shape as `EnsureDefaultUserExistsAsync`).
- **No account linking.** With one provider there is nothing to link. **Trigger:** a second provider is added. Then add a `user_logins` table and move the two columns there.
- **Stored, exactly (A38):** `external_provider = 'google'`, `external_subject`, `display_name`. No email, picture, locale, given or family name, or tokens.
- **Logging (A39):** our code logs `users.id` on provisioning and never the Google `sub`, the display name, `code`, `state`, the access token or the client secret, at any level. `Microsoft.AspNetCore` stays at `Warning` in both committed appsettings files, which keeps the hosting request line (with the callback's `?code=…&state=…`) out of the logs. Google's `error`, `error_description` and `error_uri` are never reflected into a redirect, a body or a log line above Debug (A4).
- **Session validation:** `OnValidatePrincipal` checks that the `users` row exists, **on `/api` requests only** (HTML and the SPA fallback never touch the database for identity).
  - On a miss it calls `RejectPrincipal()` and signs out, so a cookie that outlived its row (a local database reset) reads as anonymous instead of a `MeService` 404 or an FK-violation 500 on save.
  - The cost is one primary-key lookup per authenticated API call.
  - **Trigger** to move to an interval (`ValidationInterval`, as the reference's robust plan does): that lookup shows above 5 ms p95 in the request log.

### 3.4 Auth endpoints (`Controllers/AuthController.cs`, mirroring the reference's shape)

| Endpoint | Does |
|---|---|
| `GET api/auth/login/{provider}?returnUrl=` | **Allowlist first (Boo A9):** `provider` is compared ordinally against the configured set (`google`). `Google`, `github` or anything else → the catch-all's fixed 404 body, no `Challenge` (an unregistered scheme would throw a 500, probe P8), no `Set-Cookie`. Then `returnUrl` goes through **`SafeReturnUrl`** (A5, one server function): null, empty or over 2,048 chars → `/`; it must start with `/` and the second char must not be `/` or `\`; no `\` anywhere; no char below U+0020 or equal to U+007F; it must not start with `/api`; `Url.IsLocalUrl` must also be true; anything else → `/`. Then `Challenge(new AuthenticationProperties { RedirectUri = returnUrl, IsPersistent = true }, "Google")`. Nothing else sets `RedirectUri` afterwards (A2). Rate-limited by the **`auth` policy: 20 per minute per IP**. |
| `/api/auth/callback/google` | Handled by the middleware inside `UseAuthentication` (probe P1). **Both `OnAccessDenied` and `OnRemoteFailure` are handled** with `HandleResponse()`; unhandled, the framework throws a 500 (P2). The redirect is **`/signin?error=cancelled&returnUrl=…`** for Google's `access_denied` (`OnAccessDenied`) and **`/signin?error=failed&returnUrl=…`** for everything else (Rosalina, design `phase-8.md` §9.4). `returnUrl` is the challenge's `AuthenticationProperties.RedirectUri`, re-checked with `SafeReturnUrl` and URL-encoded; when the properties can't be recovered (a tampered `state`, a missing correlation cookie) it is omitted and the page falls back to `/`. When the handler can't tell a cancel from a failure, it uses `failed`. **Nothing from Google is reflected** (A4): the error value is our fixed token, never `error`, `error_description` or `error_uri`. This replaces Boo A2/A4's literal `/signin?error=1`; the security properties (no session cookie, no stub token call without a valid state) are unchanged. |
| `POST api/auth/logout` | `AllowAnonymous`, always **204**, idempotent, behind the §3.9 check and the `auth` limit (A11). The deleting `Set-Cookie` carries the same name, `Path=/` and `Secure`, or a `__Host-` cookie survives. `GET api/auth/logout` is the catch-all 404. **A deliberate deviation** from the reference, which makes logout authenticated and then needs a client error path for an expired session (`auth.ts` `logout()` comment). |
| `GET api/me` | Unchanged route and shape, plus **`signedInWith: "google" \| null`**, read from `users.external_provider`; `null` for anonymous (`schema.md` §2.8). Exact keys `userId, displayName, isAuthenticated, canWrite, signedInWith` (A28). |
| `GET api/client-config` | Gains **`loginProviders: [{ id, name }]`**, the configured providers in a fixed order (today `[{ id: "google", name: "Google" }]`), so the client never hard-codes which button exists. **Empty is reachable only in Development and Testing**, because Production refuses to start without Google config (A33). The client shows "Sign-in isn't available right now" for an empty list or a failed load (design `phase-8.md` §5.3). |

### 3.5 Removing the interim default user (Done-when 3)

- **Delete** `DefaultUserCurrentUser.cs`, `DefaultUserOptions.cs`, `IdentityRegistration.ReadDefaultUserOptions`, `FireworksDbInitializer.EnsureDefaultUserExistsAsync` and `DefaultUserDisplayName`, the `IOptions<DefaultUserOptions>` lookup and the anonymous-writes warning in Program.cs step 12, and the `Identity` sections in both appsettings files.
- `InitializeAsync` becomes `MigrateAsync` only.
- `TestIdentity` becomes the stub's subjects.
- **Fail fast on stale configuration:** startup throws when any `Identity:*` key is present, with the message `"Identity:* was removed in Phase 8 (sign-in replaces the default user); delete Identity__DefaultUserId / Identity__AllowAnonymousWrites."`
  - A forgotten Railway variable then stops a deploy loudly rather than doing nothing silently, in the same style as the `ConnectionStrings:Postgres ?? throw` guard.
- **Also updated (A34):** `tools/test/lib.mjs` l.129–138 (the smoke API becomes `Testing` plus the stub), `railway.toml` l.19, `Fireworks.Api.http`, the csproj comment and the README. S28's blast-radius text is retired (A42).
- **A source-guard test** (extending `Startup/SourceGuardTests.cs`, also covering `tools/` and `railway.toml`) asserts that no file under `src/api/Fireworks.Api` mentions `DefaultUserId`, `AllowAnonymousWrites` or `DefaultUserCurrentUser`, outside migrations and the stale-config guard's message.
- **The `users` row the seeder inserted stays** in any database that has it. It is data, not a code path (§4).

### 3.6 Rate limiting by user

- `PartitionKey(HttpContext)` becomes `"u:" + userId` when `ICurrentUser.UserId` is set (resolved from `context.RequestServices`), and otherwise `"ip:" + <today's IP or /64 key>`. It is used by both the write and read policies.
- The prefixes keep a user bucket from ever colliding with an IP bucket.
- The limits are unchanged: 20 per minute and 300 per day for writes, 120 per minute for reads.
- **New `auth` policy:** 20 per minute per IP, on `GET api/auth/login/{provider}` **and `POST api/auth/logout`** (A30).
- The user id comes from `ICurrentUser` after `OnValidatePrincipal`, so a cookie for a deleted row partitions by IP.
- **Residual, stated:** free Google accounts multiply the per-user write budget. **Trigger:** more than 100 new `users` rows in a day, or more than 10,000 total. Then chain an IP window onto writes and cap provisioning per IP.
- **`KnownProxies`** stays cleared until the first Railway deploy, as now. Trigger: that deploy, folded into Boo's S21.

### 3.7 DataProtection keys (as in the reference)

- `AddDataProtection().PersistKeysToDbContext<FireworksDbContext>().SetApplicationName("Fireworks")`.
- `FireworksDbContext : IDataProtectionKeyContext`, with a `data_protection_keys` table (`id`, `friendly_name`, `xml`), named explicitly in snake_case as in `MotwDbContext.cs` l.524–530. Same migration as §3.3.
- Package `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore`, on the EF line the API already uses. **Bowser confirms the version.**
- **Why it is required, not optional:**
  - The cookie and the OAuth `state` (which carries the correlation id and the PKCE verifier) are DataProtection payloads.
  - The container's default key ring dies on every restart, which logs everyone out and breaks any sign-in that was in flight across a deploy.
  - Keys sit unencrypted in Postgres (the framework logs a "no XML encryptor" warning; don't suppress it). Accepted while the data is low-value, but **a database read or a backup file can forge a session for any user**, so the Phase 7 backup runbook must say backups are credentials (Boo A37). **Trigger** for `ProtectKeysWith*`: backups leave the machine or Railway; a second person or app gets read access to the database; or any sensitive field (for example email) is stored.

### 3.8 Cookie settings

| Setting | Value | Why |
|---|---|---|
| Name | **`__Host-fw.session` outside Development, `fw.session` in Development** (Boo A10), **pending Bowser's probe P3**: Chromium must store a `__Host-` cookie from `http://localhost:8080` and `http://127.0.0.1:18080` (Docker as `Testing`). If P3 fails, `fw.session` everywhere, and `__Host-` is re-raised when a custom domain lands (OQ18). | The prefix stops a sibling subdomain from tossing a cookie; a tossed session would sign the victim into the attacker's account, so the victim's saves would land there. It needs `Secure`, which Development (`SameAsRequest` over http) doesn't set. Never the `.AspNetCore.Cookies` default. |
| `HttpOnly` | true | The client never reads it; identity comes from `api/me`. |
| `SameSite` | **Lax** | **Not Strict.** The callback chain starts at accounts.google.com, and a Strict cookie isn't sent on the redirect back, so the user would land signed out. Share links opened from chat apps would also show an owner `isOwner: false`. |
| `SecurePolicy` | `Always` outside Development, `SameAsRequest` in Development | As in the reference (`Program.cs` l.73). The correlation cookie uses the same policy, with `SameSite=Lax` set explicitly (§1.3, Boo A3). |
| Lifetime | **30 days, sliding, `IsPersistent = true` on every sign-in, no absolute cap** (Skyler, 2026-11-16) | A hobby app with low-value sessions. The framework renews only past half-life (a visit after day 15 extends it). Without `IsPersistent` the browser would drop the cookie at session end while the ticket says 30 days. Cap trigger: the same as `session_epoch` below (Boo H1). |
| Ticket | exactly one claim, `NameIdentifier = users.id`; no provider claims; no `.Token.*` properties | `SaveTokens = false` (§1.2). |
| Path / Domain | `/`, no Domain | Host-only. |

**Revocation, stated:** sign-out deletes this browser's cookie, and a copied cookie stays valid until it expires. **Trigger** for a `users.session_epoch` column checked in `OnValidatePrincipal` (a "sign out everywhere" feature): account deletion or "sign out everywhere" is requested.

### 3.9 CSRF: is `SameSite=Lax` plus JSON-only enough, or is a token needed?

**No antiforgery token. Lax plus JSON-only is almost enough. Add one small check and the gap closes.**

**What already holds:**
1. **`SameSite=Lax`:** a cross-**site** POST, PUT or DELETE carries no cookie.
2. **Every state-changing creation endpoint forces a CORS preflight.**
   - POST and remix require `Content-Type: application/json`, checked by `HasJsonContentType()` (`schema.md` §2.6 step 1, which already calls itself "a precondition for Phase 8's CSRF design").
   - PUT and DELETE are non-simple methods.
   - Production has **no CORS policy**, so every preflight fails and the browser never sends the request.
3. **Form value providers are removed** (`AddFireworksControllers`, Boo F1, `aspnet-request-gates` trap 8), so a CORS-safelisted form body can't be parsed before the gates.

**The gaps without step 4:**
- **Same-site, cross-origin** requests carry a Lax cookie: a sibling subdomain, if `up.railway.app` were not on the Public Suffix List, or a custom domain's other subdomains.
- **Body-less POSTs** (`logout`, and any future one) need no preflight.
- **Any future endpoint** that accepts a safelisted content type would have no protection.

**4. The added check** (`Services/Identity/CrossOriginWriteGuard.cs`, in `UseFireworksIdentity` after `UseAuthentication` and before `UseAuthorization`; Boo A13):
- For **every** request with an unsafe method (anything but GET, HEAD, OPTIONS and TRACE), **on every path**, not only `/api`:
  - if `Sec-Fetch-Site` is present, allow only `same-origin`; `same-site`, `cross-site` and `none` → **403** `{ message }`, `no-store`, not counted by the limiter;
  - else if `Origin` is present and isn't `Request.Scheme + "://" + Request.Host` (ordinal, ignoring case, after forwarded headers), answer 403. `Origin: null` → 403;
  - else allow. Old browsers and non-browser clients aren't CSRF vectors, and the preflight wall still covers old browsers.
- The Google callback completes inside `UseAuthentication` and never reaches it (it is a GET anyway).
- **No GET or HEAD endpoint changes server state** (A16). The login GET sets only the correlation cookie; login CSRF through it signs a victim into their own Google account, which is harmless.
- **Dev loop:** the proxy keeps `Host: localhost:4200` and the browser sends `Origin: http://localhost:4200`, so they match.

**Why not the reference's antiforgery tokens** (`authentication-update/architecture.md` §7, layer 2):
- They add a bootstrap call (`GET api/auth/csrf`), an interceptor and a token pair bound to the claims identity, which must be reissued on login and logout (the reference's ⚠️ box: "every write fails after login").
- Against this app's surface they defend nothing that layers 2 and 4 don't. With OAuth, login CSRF is already stopped by the handler's `state` and correlation cookie.

**Also delete the Development `FrontendDev` CORS policy** and its `Cors:AllowedOrigins` guard:
- The client uses `apiBaseUrl: ''` through the proxy, so no cross-origin call exists.
- Leaving a policy that allows any header and method next to a cookie session is a trap, as the reference's §7 layer 3 says ("deleted rather than given `.AllowCredentials()`").

**Trigger to add antiforgery tokens** (Boo A17): any of these appear:
- a CORS policy (any environment);
- a second origin that must write;
- an endpoint that accepts a CORS-safelisted content type, or form posts;
- removal of the §3.9 check, or an exemption added to it;
- any GET that changes state;
- relaxing the session cookie to `SameSite=None`;
- the guard allowing `same-site`.

**Tests:** `Sec-Fetch-Site` `cross-site`, `same-site` and `none`, a foreign `Origin`, `Origin: null`, and both absent, each on POST, PUT, DELETE, remix and logout with a signed-in jar. Negative control: unregister the guard, and the hostile cases must reach the service. **Local real-browser case (Boo A13):** `localhost:5190` is same-site with `localhost:4200` (ports don't make a different site), so a page on the stub's origin reproduces the sibling-subdomain case without a deploy.

---

## 4. The interim default user's creations

**The facts:**
- No production database exists (Railway deferred), so this is about Skyler's local and dev databases only.
- After §3.5, no login can ever resolve to the default user's id: it has no `external_provider`, and `ClaimsCurrentUser` only issues ids that provisioning returned.

| Option | Effect | Cost |
|---|---|---|
| **A. Leave them as read-only legacy (recommended default)** | The row and its creations stay. Share links keep playing. Nobody can edit or delete them, by construction (owner-only writes). `/mine` shows them to nobody. | Zero code. |
| **B. Claim them for Skyler's account (optional runbook step on top of A)** | After Skyler's first sign-in: `UPDATE creations SET owner_user_id = '<skyler>' WHERE owner_user_id = '6933f933-a9e9-443b-b7c7-6e3e01901a34';` Then they are his in `/mine`, editable, and `remixedFrom` becomes visible to him. | A README runbook entry (Bowser), the same shape as the takedown runbook. Never automatic. |
| C. Automatic claim by the first account to sign in | Whoever signs in first gets everything. | **Rejected:** on any shared or deployed instance that's a takeover. |
| D. Delete them | Every link saved in test windows dies. | **Rejected:** destroys work for no gain. |

**Decided (Skyler, Q2): A, with B documented** as a README runbook step inside `BEGIN … COMMIT` with a row-count check (Boo A24), never a migration or startup code. The default user's id stays in the README, migrations and tests only, never in configuration. Provisioning matches only `(external_provider, external_subject)`, both non-null, and never falls back to a display-name match, the first row or a configured id (A23).

---

## 5. Schema and contract items

### 5.1 `Vary` (Boo P7-S18)

- `GET api/creations/{shareCode}` (200 and 304) sends **`Vary: Cookie`**.
- Its `Cache-Control` is `private, no-cache`, so the browser does store it and revalidate it.
- Without `Vary`, a shared browser that signs out could replay the owner's cached `isOwner: true` and `remixedFrom`.
- POST, PUT and remix are `no-store` and need no `Vary`.
- **Test:** the header on both the 200 and the 304. Negative control: remove it.

### 5.2 The `-p` ETag (`schema.md` §2.1.1, decided in Phase 7, lands now)

- The owner gets `ETag: "<updatedAt>"`. Anyone else gets `"<updatedAt>-p"`.
- **`MatchesIfNoneMatch` compares against the tag of the viewer's representation.** An owner's tag presented by an anonymous viewer gets a **200**, not a 304.
- **Tests:**
  - owner tag sent as anonymous → 200 with the `-p` tag;
  - `-p` tag sent as owner → 200 with the plain tag;
  - each identity's own tag → 304.
- Negative control: compute the tag without the `-p` branch.

### 5.3 If-Match → 412: confirmed, lands in Phase 8

**This isn't an open question.** `schema.md` §11.4 says: "**Add it when** the first lost update is reported, or at Phase 8 (when one person on two devices becomes real), whichever comes first." Phase 7's "no If-Match yet" was scoped to Phase 7.

| Rule | Detail |
|---|---|
| Where | `PUT api/creations/{shareCode}` only. DELETE stays unconditional. **Trigger** for DELETE: the first report of a deletion from a stale `/mine` list. |
| Missing header | **428** `{ message }`. It is required: no deployed client exists that would break. It comes after the 403 gate and before the body is read (header only). |
| Mismatch | **412** `{ message }`, with the current `ETag` header, and only for the owner. A not-owned or missing row is still the §10 404, checked first. That keeps the 404/412 split from becoming an existence oracle for non-owners. |
| Comparison | Strong (§2.1.1). A `-p` tag or a weak tag never matches. **`If-Match: *` or a list of tags → 412** (Boo A29), a deliberate deviation from RFC 9110 recorded in `schema.md` §11.4, so overwriting stays a deliberate GET-then-PUT. The check is **in the UPDATE statement** (`updated_at` as an EF concurrency token, or an explicit `WHERE … AND updated_at = @tag`), never a read followed by a write. On zero rows, re-check the desired state: the row exists and is owned → 412, otherwise 404. |
| Parse | Strip the quotes, then parse with the converter the body uses. A tag that doesn't parse is a mismatch (412), never a 400. |
| Client | Sends `If-Match: "` + `source.updatedAt` + `"`; a source with an empty `updatedAt` never sends a PUT (428 row, no request). On 412, `source` stays as it is, nothing is saved, and the status block offers **Save as new** (remix) and **Replace the newer version** (a fresh GET, then a PUT with that tag; Rosalina, design `phase-8.md` §9.2). |

### 5.4 `remixedFrom` in the UI

- **Skyler's ruling stands:** render only when `session.isAuthenticated() && response.isOwner` (and `remixedFrom !== null`).
  - After Phase 8, `isOwner` already implies a signed-in viewer. The `isAuthenticated` term is redundant on the server's terms and kept anyway as belt and braces (Boo A43).
- **Where (Rosalina, design `phase-8.md` §10): the player only**, as `Remixed from the original` under the name. Not on `/mine` cards (`CreationListItem` has no `remixedFrom`, and the list contract doesn't change for it) and not in the designer or builder (`source` doesn't carry it).
- It renders as a `/s/<code>` link built only after the share-code regex (Boo C4, C11), and nothing otherwise.
- The server rule (`schema.md` §2.1) is unchanged.

### 5.5 Edits to `schema.md` (made 2026-11-16)

- **§2.1:** the "accepted interim exposure" sentences are replaced by a one-line closure note.
- **§2.1.1:** the viewer-relative `-p` comparison, `Vary: Cookie`, `no-store` on every auth response.
- **§2.2.1:** the list gate is 401.
- **§2.5:** the callback is a GET (no `form_post`).
- **§2.6 and §2.7:** the new status order (§3.2), 401, 428 and 412, the CSRF 403, the `auth` rate-limit policy, and partitioning by user.
- **§2.8 (new):** `MeResponse.signedInWith`, `ClientConfigResponse.loginProviders`, the `canWrite == isAuthenticated` invariant.
- **§10:** `CanWrite` means signed in; the signed-out Save prompt; the read-only legacy rows and the claim runbook (§4).
- **§11.1:** "Remixed from" on the player only.
- **§11.2:** a fourth thing that changes `source` (§6.4), and the 412 Replace's 404.
- **§11.4:** If-Match is live, with the `*`/list/weak → 412 deviation and the 412/428 client rows.
- **§11.5:** retired.
- **§14 and §15:** this phase's rulings and owners.

---

## 6. Client (Luigi, batch B2)

### 6.1 `SessionService` and sign-in and sign-out

UI placement, the branded button, the dialog and every string are Rosalina's (`design/phase-8.md` §2–§9); this section is the wiring.

- **New members:**
  - `isAuthenticated = computed(() => user()?.isAuthenticated === true)`;
  - `displayName`;
  - `signedInWith` (absent reads as `null`, `schema.md` §2.8);
  - `settled(): Observable<void>`, a `shareReplay(1)` of the first `load()`. The return flow (design `phase-8.md` §6.1) and the §6.4 refresh wait on it.
- **The initializer keeps loading in the background.** This deliberately does **not** take the reference's blocking-initializer shape (`auth.ts` `initialize()`): the reference guards every route, and here only `/mine` and the save bar read identity, and both already wait on `session.status()`, so the designer at `/` shouldn't wait on `api/me` to paint.
- **Sign-in (Google only, one branded button):** the account control on the designer, the builder and `/mine` (`Sign in`, or `{name} · Sign out`), the signed-out Save, and `/mine`'s prompt each lead to Rosalina's dialog or page with one `Sign in with Google` button.
  - The button calls `flushDraft()` on that page's store, writes the `sessionStorage` intent flag `fireworks.signin.v1` (design `phase-8.md` §6.1; **confirmed**: it carries no identity or draft data, only `from`, `path` and `at`, and a blocked `sessionStorage` only loses the toast and focus move), then `location.assign('/api/auth/login/google?returnUrl=' + encodeURIComponent(path + search))`. It is not a `<form>` (§1.3) and not a routerLink. The client never calls `location.assign(returnUrl)` itself; the server's `SafeReturnUrl` is the authority, and the client's `isSafeInternalUrl` applies the same rule table (Boo A5).
  - **Sign out:** `POST api/auth/logout`, then `session.load()`, staying on the page. **The local draft is kept** (Skyler, 2026-11-16).
  - With an empty `loginProviders` (Development or Testing only) the dialog reads "Sign-in isn't available right now".
- **`/signin` page:** the landing page for the callback's failures, **`?error=cancelled|failed&returnUrl=…`** (§3.4), and for a direct visit. It is not a guard target (§6.3). It re-checks `returnUrl` with `isSafeInternalUrl` before using it for `Go back` or an already-signed-in `navigateByUrl`.
- **401 interceptor**, placed **after** `httpErrorInterceptor` in the array (the `app.config.ts` comment already reserves that slot):
  - a 401 from any `/api` call except `api/me` reloads the session once and swallows the generic toast, and **never retries the request** (A41);
  - the save flows map it to Rosalina's row: `Couldn't save: you've been signed out. Sign in to save; your {noun} is kept in this browser.` (design `phase-8.md` §9.1).

### 6.2 Save prompts sign-in, and the draft carries over

- **The save bar renders signed out once `session.status()` is `ready`:** one **Save** that opens the sign-in dialog and sends nothing (Rosalina R4). **Boo re-ruled C9 as A40:** write *requests* need `canWrite`; Update original needs `canWrite && source.isOwner`; Update original, Save as new and Delete never render while `!canWrite`. ⌘S signed out opens the same dialog (design `phase-8.md` §5.5).
- **The draft carries over because it is already in localStorage:**
  - `fireworks.draft.v1` and `fireworks.showDraft.v1`, debounced, and flushed on `pagehide` (`shell-designer.store.ts` l.301–310, `show-builder.store.ts` l.202–209).
  - The sign-in button also calls `flushDraft()` explicitly before `location.assign`. A bfcache-eligible `pagehide` is not something to rely on for the one navigation that must not lose work.
- **Lost on the round trip:** the Show Builder's session-only Undo history (50 steps, standing decision). That is accepted, because the draft is the contract and Undo was ruled session-only. The dialog says so only when history exists (design `phase-8.md` §5.3).
- **After return, no automatic save, and no query flag is honoured** (agreed by Rosalina R5; Boo A41: otherwise an attacker-started login navigation could make a victim save a planted draft into their own account). The page restores the draft, runs the §6.4 refresh, then focuses Save and toasts `Signed in as {name}.` (design `phase-8.md` §6.2).

### 6.3 `/mine` signed out: the prompt in place, no guard (confirmed)

**Rosalina's R7 is confirmed; my earlier guard-plus-redirect is withdrawn.** `/mine` has no `canActivate`. Signed out, the page renders its sign-in prompt in place (design `phase-8.md` §7).
- **Why:** a sign-out *on* `/mine`, and a 401 from the list or a delete, must swap the page to the signed-out state anyway, because guards don't re-run. A guard would add a second path to the same state, and the URL would stop matching what's on screen. The page already waits for `session.status()` before calling the list (phase-5.md §10.1, Peach N1), which is the ordering guarantee the guard's `settled()` wait gave.
- **What Boo's A44 protected is kept as a page-level rule:** while `status` isn't `ready`, or the session is signed out, the page sends **zero** `api/me/creations` calls. Verify (client spec): anonymous → the prompt renders and the call ledger has no list call. The server's 401 (A19) stays the control; neither the guard nor the prompt ever was. **Boo should confirm** that this restatement of A44 satisfies him (`yoshi-phase8-auth-design.md`).
- `mine-page.ts`'s `notice()` gains `'signed-out'`, replacing `'unavailable'`, and its `forbidden` branch becomes the 401 branch.
- `/signin` stays, as the failure landing page and for a direct visit (§6.1).

### 6.4 The draft's `source.isOwner` after an identity change (a fourth `source` writer)

- `source.isOwner` is a snapshot from whoever loaded the link. After an anonymous visitor signs in, a working copy of their own creation would still say `isOwner: false`, so Save would remix instead of offering Update original.
- **Rule:** when a page restores a draft with a non-null `source` and the session is authenticated, it sends one `GET api/creations/{source.shareCode}`.
  - It sets `source.isOwner` (and `name`) from the response, and **keeps `source.updatedAt`**, which is the base the visitor edited from. Refreshing it would defeat If-Match.
  - A 404 sets `source` to `null` (the original is gone).
  - Any other failure leaves `source` as it is.
- That makes four writers of `source`, so `schema.md` §11.2's "three things change `source`" becomes four (§5.5).
- **Test:** the call ledger. Exactly one GET per restore, and none when anonymous or when `source` is null (`toad-exact-call-ledger-over-positive-assertions.md`).

### 6.5 The test-mode banner

- **Deleted (Skyler, Q3; Boo A42 re-rules C17):** `TestModeBannerComponent`, `TEST_MODE_TEXT`, the `designer-save.spec.ts` match and the player's two wrapper divs (design `phase-8.md` §11). S28's blast-radius text is retired from the README and `railway.toml`.
- **Replaced by a server invariant test:** `MeResponse.canWrite == MeResponse.isAuthenticated` for anonymous, signed-in, deleted-row and unparseable-id cookies (A12, A18). Negative control: `CanWrite => true`.

### 6.6 Other client items

- `If-Match` on PUT, and the 401, 412 (Save as new, Replace) and 428 status rows in `save-copy.ts`; `SaveStatusAction` gains `'signIn'` and `'replace'` (§5.3, design `phase-8.md` §9).
- `remixedFrom` rendering, on the player only (§5.4).
- `models.ts`: `MeResponse.signedInWith` and `ClientConfigResponse.loginProviders`. Both are optional in the TypeScript model (the server always sends them), so the contract parity spec (`client-config.contract.spec.ts`) gains a row.

---

## 7. Batches, ceremonies and order (lean process: at most two agents, one heavy job)

| Step | Who | What | Heavy? |
|---|---|---|---|
| **8.0a security-review** (before; **done**, A1–A44) | **Boo** (lead) | Reviews this document. Rules on:<br>• §3.9 (no token);<br>• §6.2 (the C9 change);<br>• the cookie name (§3.8);<br>• the 428/412 oracle analysis (§5.3);<br>• the stub-override guard (§1.4).<br>Writes `boo-phase8-security-requirements.md`. | no |
| **8.0b design-review** (before, parallel with 8.0a; **done**, R1–R12) | **Rosalina** | Covers:<br>• where Sign in sits on each page;<br>• the provider list and `/signin`;<br>• the Save-prompts-sign-in copy, including "Undo history resets";<br>• post-return focus and announcement (§6.2);<br>• 401, 412 and 428 copy, and whether 412 offers Overwrite;<br>• where "Remixed from" renders (§5.4).<br>Writes `design/phase-8.md`. | no |
| **B1 server** | **Bowser** | Probes P1–P8 first (below), then §3.1–§3.9, §5.1–§5.3 and the §4 runbook, plus the stub provider and the harness sharing `AddFireworksIdentity` and `UseFireworksIdentity`. The two-account ownership suite runs through the stub. | **yes** (regular run) |
| **B2 client** | **Luigi** | §6, after B1's contract is merged, against the stub-backed dev API. | **yes**, after B1 |
| **B3 tooling** (can run alongside B2, since it isn't heavy until the run) | **Toad** | `tools/fake-oauth/server.mjs`. The Playwright smoke gains a sign-in: two accounts can't edit each other's links, and an anonymous Save prompts sign-in and keeps the draft. Negative controls for §3.2's anonymous-set test, §3.9, §5.1 and §5.2. | its run is heavy: serial after B2 |
| **C1 security verification** | **Boo** | Against the running Docker image as `Testing` with the stub sidecar (A36), plus a real Google dev client on Chromium where available ([R] otherwise). | no |
| **C2 acceptance** | **Peach** | Writes `acceptance/phase-8.md` from the Done-when and checks payloads, not documents. | no |
| **Gate** | **Mario** | Phase-gate. A green daily run under 24 h old. Mutants only on the changed security files (`ClaimsCurrentUser`, `CrossOriginWriteGuard`, `UserProvisioning`, the If-Match path, `PartitionKey`), one heavy job at a time. | yes |
| After | Scribe, and optionally Koopa | Logs; a retrospective if Skyler asks. | no |

**Bowser's probes, before he builds** ("an API claim in a spec is a hypothesis until a probe runs"; each goes in his record):
- **P1:** the remote-auth handler answers `/api/auth/callback/google` before the `/api/{**rest}` catch-all, in this app's pipeline.
- **P2:** an unhandled `OnRemoteFailure` is a 500 and a handled one redirects; also what an exception in `OnTicketReceived` (database down during provisioning) produces (Boo Info).
- **P3:** Chromium stores the `Secure` session cookie and the `SameSite=Lax; Secure` correlation cookie from `http://localhost:8080` and `http://127.0.0.1:18080` (the Docker image as `Testing`), and whether `__Host-` works there. **Decides the cookie name (§3.8).**
- **P4:** the GET navigation to the provider isn't blocked by the CSP (`form-action`, COOP).
- **P5:** `OnValidatePrincipal`'s cost, and that `RejectPrincipal` plus sign-out yields anonymous on the same request.
- **P6–P8 (Boo A8):** the installed Google handler's effective `UsePkce` and correlation-cookie defaults; which userinfo key carries the subject for the default `UserInformationEndpoint`; that `Challenge` with an unregistered scheme throws (A9 prevents it).

---

## 8. Done-when mapping

| Done-when | Shown by |
|---|---|
| Anonymous users can play but get a login prompt when they try to save | B2's prompt; Toad's smoke: anonymous Save → the provider list → stub sign-in → draft intact → Save → 201 |
| Two real accounts can't edit each other's creations | B1's two-account suite through the stub: PUT, DELETE and `/mine` across accounts → 404 and an empty list; remix allowed; `isOwner` and `remixedFrom` per viewer; the `-p` ETag and `Vary` |
| The interim default-user code path is gone from production | §3.5 deletions, the source-guard test, the stale-config startup throw, the `canWrite == isAuthenticated` invariant |

---

## 9. Skyler's rulings (2026-11-16)

| # | Question | Ruling |
|---|---|---|
| **Q1** (OQ19) | Which sign-in providers? | **Google only.** GitHub is dropped everywhere. Passkeys and magic link wait for their triggers (§1.1). |
| **Q2** | The default user's saved creations? | **Read-only legacy**, plus the optional claim SQL in the README runbook (§4). |
| **Q3** | Delete the test-mode banner? | **Deleted**, replaced by the `canWrite == isAuthenticated` server test (§6.5). |
| **Q4** | How long does a sign-in last? | **30 days, sliding. No absolute cap for now**; add one with sign-out-everywhere or account deletion (§3.8). |
| **Q5** | Stub sign-in as the local default? | **Yes** (coordinator default): stub in dev and tests, a real Google dev client as an optional override, refused in Production (§1.4). |
| Rosalina Q1 | Does signing out clear the browser's draft? | **No, it keeps the draft.** |
| — | Store the Google display name? | **Yes**, shown only to that user; no email, picture or tokens (§3.3). |

**Not questions (settled by existing wording):**
- If-Match lands now (§5.3, quoting `schema.md` §11.4).
- The `-p` ETag rule (§2.1.1, "decided now").
- `Vary` (P7-S18).
- `remixedFrom` renders only when `isAuthenticated && isOwner` (Skyler, 2026-11-14).

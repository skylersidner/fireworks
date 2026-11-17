# Phase 8 authentication design (Yoshi)

**Date:** 2026-11-16 · **Status:** adopted. Skyler ruled Q1–Q5 plus the further rulings (plan §Phase 8). Boo's 8.0a (`boo-phase8-security-requirements.md`, A1–A44) and Rosalina's 8.0b (`design/phase-8.md`, R1–R12) are folded in. Pending only Bowser's probe P3 (cookie name). · **Design:** `docs/fireworks-app/design/phase-8-auth.md` · **Schema:** `docs/fireworks-app/schema.md` §2.1, §2.1.1, §2.2.1, §2.5–§2.8, §10, §11.1, §11.2, §11.4, §11.5 (retired), §14, §15

## What

1. **Provider: Google only** (Skyler, OQ19). GitHub is dropped everywhere. `AddGoogle` is the **OAuth handler, not OIDC**, so there is no nonce. `Scope.Clear()` then `openid profile`; `UsePkce = true` and `SaveTokens = false`, both explicit. The reference app's cookie session. No passwords, email or Identity tables. Passkeys and magic link have numeric triggers (design §1.1).
2. **The seam:**
   - `ClaimsCurrentUser` and the fallback policy share one predicate, `FireworksClaims.TryGetUserId` (Boo A18). The policy is `RequireAuthenticatedUser()` plus `RequireAssertion(TryGetUserId)`. `CanWrite := IsAuthenticated := UserId != null`.
   - The default, challenge and sign-in schemes are all the cookie scheme. Google is challenged by name only.
   - Anonymous writes and `GET api/me/creations` answer **401**. The anonymous endpoint set is pinned from `EndpointDataSource`.
3. **Provisioning:**
   - `users.external_provider` and `users.external_subject`, unique together, both or neither.
   - Stored: `google`, `sub` and `display_name` (Skyler: the display name is stored). Nothing else.
   - The cookie ticket holds exactly one claim, `NameIdentifier = users.id`.
   - Logging rules per A39.
4. **Removal:** the default-user code and configuration are deleted, and startup throws on any `Identity:*` key. The legacy creations stay **read-only** (Skyler). The optional claim SQL is a README runbook step in `BEGIN … COMMIT`.
5. **CSRF: no token.**
   - Layers: Lax, the preflight wall, and `CrossOriginWriteGuard` on **every unsafe method on every path**, after `UseAuthentication` and before `UseAuthorization` (A13).
   - The dev CORS policy is deleted.
   - Token triggers per A17.
6. **Cookies:**
   - The session is `HttpOnly`, Lax, `Secure` outside Development, **30 days sliding, `IsPersistent`, no absolute cap** (Skyler).
   - Name: `__Host-fw.session` outside Development and `fw.session` in Development, **if P3 passes**, otherwise `fw.session` everywhere.
   - The correlation cookie is **`SameSite=Lax`**, explicit (A3).
7. **Login endpoint:**
   - The provider allowlist runs before `Challenge` (A9).
   - `SafeReturnUrl` (A5).
   - Failure redirect (Rosalina §9.4): `OnAccessDenied` goes to **`/signin?error=cancelled&returnUrl=…`**, and everything else goes to **`error=failed`**. `returnUrl` comes from the properties, is re-checked, and is omitted when it can't be recovered. Nothing from Google is reflected.
8. **Config:**
   - Stub OAuth is the default in dev and tests.
   - Endpoint overrides are honoured only in Development and Testing.
   - **Production refuses** missing or blank Google config, the stub sentinel, or any endpoint override (A33).
   - The smoke API and the Docker stub runs use **`Testing`** (A34, A36).
9. **Contract:**
   - `Vary: Cookie` and the viewer-relative `-p` ETag.
   - **If-Match required on PUT:** 428 when missing; **412 for a mismatch, `*`, a list, a weak or `-p` tag, or an unparseable one** (A29, a recorded RFC 9110 deviation). The check is only after the owner 404, in the UPDATE statement.
   - `MeResponse.signedInWith: "google" | null` and `ClientConfigResponse.loginProviders` (schema §2.8): always sent, optional in TS.
   - The `canWrite == isAuthenticated` invariant replaces the test-mode banner (deleted, Skyler).
10. **Client:**
    - **`/mine` signed out renders the prompt in place, with no guard** (Rosalina R7, confirmed; my guard is withdrawn). Zero list calls while not ready or signed out.
    - The `sessionStorage` intent flag is confirmed.
    - No auto-save, and no query flag (A41).
    - Signing out keeps the draft (Skyler).
    - The fourth `source` writer: on restore while signed in, refresh `isOwner` and `name` and keep `updatedAt`.
    - 412 offers Save as new **and Replace** (a GET, then a PUT with that tag).
    - "Remixed from" appears on the **player only**.

## Why

- **The least code that meets the three Done-when items,** with no dependency on email or the deferred custom domain. The §3.4 promise holds: one DI registration plus a policy, with no creations-schema change.
- **In-place `/mine`:** a sign-out or a 401 on `/mine` must reach the signed-out state without a navigation, and guards don't re-run. One path is simpler than two. The page already waits on `session.status()`.
- **`*` → 412:** overwriting must stay a deliberate GET-then-PUT (Replace). A blind header must not be able to do it.

## Boundary

- **Binds B1 (Bowser), B2 (Luigi) and B3 (Toad).**
- **Changes Boo's requirements in two places; Boo should confirm:**
  - A44's guard-plus-redirect is restated as a page-level rule: an anonymous `/mine` makes zero `api/me/creations` calls and renders the prompt.
  - A2 and A4's literal `/signin?error=1` becomes `error=cancelled|failed` with a re-checked `returnUrl`. The security assertions stay the same: no session cookie, no stub token call, a fixed token, and nothing reflected.
- **Supersedes:** `schema.md` §11.5 (retired), the §2.1 interim-exposure text, §11.2's "three writers", and the old §2.6 and §2.7 order. All are edited in place.
- **Does not decide:**
  - copy or placement (Rosalina);
  - `font-src 'self'` (Boo);
  - the `__Host-` name (P3, Bowser and Boo);
  - Railway `Host` forwarding and `KnownProxies` (A31, first deploy).

# Testing OAuth sign-in and cookie sessions locally (no real provider, no deploy)

Use this when building or reviewing tests for the Phase 8 Google sign-in, the session cookie or the CSRF guard. Written by Boo on 2026-11-16 (`boo-phase8-security-requirements.md`). Items marked *(probe)* are expected framework behavior that Bowser's P3/P6–P8 must confirm. Mark each one measured once it has been.

1. **Localhost ports are the same *site*.** `http://localhost:5190` and `http://localhost:4200` are cross-origin but same-site, so a `SameSite=Lax` cookie rides a form POST between them, and `Sec-Fetch-Site` is `same-site`. A page served by the stub is therefore a real-browser repro of the "sibling subdomain" CSRF case. `127.0.0.1` and `localhost` are different sites.
2. **`CookieContainer` won't send a `Secure` cookie over `http://`.** A C# sign-in helper that uses it silently forces the tests onto Development cookie flags. Keep a manual jar: assert the attributes on each `Set-Cookie`, then replay `name=value` in a `Cookie` header.
3. **Chromium and Firefox store `Secure` and `__Host-` cookies from `http://localhost` and `http://127.0.0.1`; WebKit stores none** (measured by Bowser, P3, 2026-11-16). Local sign-in, including on the Docker image, is a Chromium or Firefox check.
4. **The remote-auth correlation cookie defaults to `SameSite=None; Secure`** (measured, P6; also `UsePkce` defaults to true and Google's default scopes include `email`). Over the http dev loop, `None` without `Secure` is dropped by Chromium. A query-mode OAuth callback is a top-level GET, so `Lax` works and is narrower.
5. **`Challenge` with an unregistered scheme name throws (a 500), and scheme names are case-sensitive** (measured, P8). Allowlist the `{provider}` route value ordinally first.
6. **Prove PKCE and `state` at the stub, not in our code:** the stub rejects a bad `code_verifier`, reused codes and a `redirect_uri` mismatch, and counts token calls, so "a bad state makes no back-channel call" is an assertion.
7. **An unhandled `OnRemoteFailure` is a 500.** Handle `OnAccessDenied` as well, and never reflect `error_description`.
8. **Run the stub-backed Docker image as `ASPNETCORE_ENVIRONMENT=Testing`** (Production refuses stub overrides). Testing keeps every non-Development behavior.

## Measured in B1 (Bowser, 2026-11-16)

9. **A fallback policy also covers requests that matched no endpoint.** A static-file miss (`/nope.js`; the SPA fallback skips dotted paths) becomes a 401 for anonymous callers. Set an anonymous 404 endpoint on endpoint-less requests before `UseAuthorization`.
10. **An authenticated principal that fails the policy is a Forbid (403), not a 401.** If "no valid id" must be 401, map it in `OnRedirectToAccessDenied`. If `OnValidatePrincipal` also rejects that case, a mutant that drops the policy's assertion survives: give each layer one job.
11. **An exception thrown in `OnCreatingTicket` reaches `OnRemoteFailure` with `Properties == null`**, as a bad `state` does. Code the failure redirect for missing properties.
12. **`[ApiController]` turns `NotFound()` into a ProblemDetails body.** For a 404 that must be byte-identical to `Results.NotFound()`, set the status and return `EmptyResult`.
13. **An If-Match tag that is the same instant at another offset compares equal in SQL.** A strong comparison must also check the byte-equal round trip and the `+00:00` offset.
14. **Node's `fetch` has no cookie jar.** Replay `name=value` from `getSetCookie()` by hand (`tools/fake-oauth/server.mjs` `signIn`). A browser context signs in with one `page.goto('/api/auth/login/google?returnUrl=/favicon.svg')` when the stub auto-approves.
15. **Docker plus the stub:** set the authorize endpoint to the browser's `localhost:5190`, and the token and userinfo endpoints to `host.docker.internal:5190` (the container's back channel).

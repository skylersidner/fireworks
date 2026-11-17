# Phase 8 security verification (Boo, C1)

**Date:** 2026-11-16 · **Status:** proposed. It verifies `boo-phase8-security-requirements.md` A1–A44 against Bowser's B1 (`bowser-phase8-server-auth.md`) and Luigi's B2 (`luigi-phase8-client-sign-in.md`). Promotion to the index is Skyler's call.

**Verdict: PASS, with no product defects.** 43 PASS (A6 and A36 locally; their Google and image halves are [R]), 0 FAIL, 1 [R] DEFERRED (A31). The findings are 2 low and 3 info, all test or tooling gaps: A13 and A6 have no browser gate, there's no A15 spec, the race mutant was missing from the set, and my own A42 control was equivalent. None is exploitable.

## Surfaces and method

- **Code read:** `Program.cs`; `Services/Identity/*` (`IdentityRegistration`, `CrossOriginWriteGuard`, `SafeReturnUrl`, `FireworksClaims`, `ClaimsCurrentUser`, `AuthProviderSettings`, `UserProvisioning`); `Controllers/{Auth,Me,Creations}Controller.cs`; `Services/Creations/IfMatchPrecondition.cs`; `Repositories/CreationRepository.cs` (`UpdateOwnedAsync`); `appsettings*.json`; client `core/sign-in.ts`, `pages/signin/signin-page.ts`, `unsafe-sinks.spec.ts`, `designer-structure.spec.ts`, `client-config.contract.spec.ts`; `tools/mutants/sets/phase8-auth.mjs` and `run.mjs`.
- **Running app (Development, 4200 → 5180, stub on 5190):** HTTP probes with dev-alice and dev-bob (script `scratchpad/boo-p8/probe.mjs`), and Chromium (Chrome channel) for real sign-in, CSRF from a page on `http://localhost:5190`, `/signin` return-URL abuse and anonymous `/mine`. Every probe row I created was deleted.
- **Short-lived instances, stopped afterwards:** Production on 127.0.0.1:5197 for the startup guards; Testing on 127.0.0.1:5198 for the `__Host-` and `Secure` flags, and with the real `wwwroot` for sign-in under the enforced CSP.
- **Targeted mutants**, on a scratch copy of `src/api` plus `schema` (the shared tree was never mutated); the race test ran on a throwaway database, `fireworks_boo_race` on 5433. I didn't re-run `phase8-auth` or `phase8-client`: I read them and agree with their verdicts. My set covers only what theirs doesn't.

## Requirement verdicts

| # | Verdict | Evidence |
|---|---|---|
| A1 | PASS | Running app: the authorize query has `scope=openid profile`, `code_challenge_method=S256` and a `code_challenge`; the stub enforces the verifier. Mutant S4 (adds `email`) is killed. |
| A2 | PASS (as amended) | `SignInFlowTests.A_bad_state_or_correlation_fails_with_no_session_and_no_token_call` (four variants, counting stub token calls). The failure target is now `error=failed` (ruling 2). |
| A3 | PASS | Dev: the correlation cookie is `samesite=lax; httponly`, with no `secure`. Testing: `secure; samesite=lax; httponly`. Mutant S3 (`None`) is killed. |
| A4 | PASS (as amended) | The callback is answered inside `UseAuthentication`. `OnAccessDenied` gives `cancelled` and `OnRemoteFailure` gives `failed`, both fixed tokens; nothing from the provider is reflected (`A_provider_error_redirects_…_reflects_nothing`). The `/signin` copy is a fixed switch: `?error=<img src=x>` renders the default copy. |
| A5 | PASS | Running app, final `Location` after a full stub round trip: `//evil.example`, `/\evil.example`, `/`+TAB+`/evil.example`, `%2F%2Fevil.example`, `/%2F%2Fevil.example`, `/%5Cevil.example`, `https://…`, `javascript:…`, ` /x`, `/api/auth/logout` and 3,000 chars all give `/`; `/c/abcdefgh?x=1` gives itself. Bowser's R2–R8 are killed. On the client, `isSafeInternalUrl` mirrors the server rule. |
| A6 | PASS (local) | Testing instance with the real `wwwroot` and the enforced CSP: `/signin` → Google button → stub on 127.0.0.1:5190 → `/mine`, with **zero** `securitypolicyviolation` events or "Refused" console lines. No `<form>` in any template; the only browser navigation is `location.assign(url)` in `core/sign-in.ts`. The Google-origin repeat is [R]. See finding F3. |
| A7 | PASS | `The_stub_itself_rejects_a_reused_code_a_wrong_verifier_and_a_wrong_redirect_uri`; the stub binds only `127.0.0.1:5190` (lsof). |
| A8 | PASS | P6, P7 and P8 are recorded in `bowser-phase8-server-auth.md` item 1. |
| A9 | PASS | Running app: `login/Google`, `login/github` and `login/x` each give 404 with an empty body and no `Set-Cookie`. Bowser's P1 and P2 are killed. |
| A10 | PASS | Dev: `fw.session`, `path=/`, `samesite=lax`, `httponly`, no Domain, expiring 30 days ahead. Testing (curl and Chrome): `__Host-fw.session` with `secure`. Chrome stores it on `http://127.0.0.1` (P3 re-confirmed). Mutant S2 (`SameAsRequest` everywhere) is killed. |
| A11 | PASS | Logout gives 204 with `fw.session=; expires=1970…; path=/` (Dev), or `__Host-fw.session=; …; path=/; secure` (Testing), and `no-store`. `GET` logout is 404. Replaying the old jar after logout still deletes (the stated residual, pinned). |
| A12 | PASS | `A_cookie_that_outlives_its_row_…`; mutant S1 is killed. |
| A13 | PASS | Running app: a signed-in DELETE with `Sec-Fetch-Site` set to `same-site`, `cross-site` or `none`, or with `Origin` set to `http://localhost:5190` or `null`, gives 403 `no-store` and the row survives. Chrome on a `localhost:5190` page: the form POST to `/api/auth/logout` gives 403 and the session survives. A `no-cors` POST to `/api/creations` gives 403 at the server (curl with Chrome's headers), its opaque response is then blocked by CORP (`ERR_FAILED`), and the list is unchanged. Bowser's G1–G5 are killed. See finding F1. |
| A14 | PASS | A preflight with `Origin: http://evil.example` gives 404 with no `Access-Control-*` header (Testing); there's a source guard. |
| A15 | PASS (value) | `proxy.conf.json` has no `changeOrigin`; a same-origin save works through 4200. See finding F2. |
| A16 | PASS | `No_GET_or_HEAD_endpoint_outside_the_known_set_exists`. |
| A17 | PASS | No trigger has fired: no CORS, no form endpoints, the guard is unexempted, the cookie is Lax. |
| A18 | PASS | `A_ticket_with_an_unparseable_id_is_anonymous_everywhere_at_once`; Bowser's F1 and F5 are killed. |
| A19 | PASS | Anonymous `GET api/me/creations` gives 401 with no `Location`, no `Set-Cookie` and `no-store`. |
| A20 | PASS | `The_anonymous_endpoint_set_is_exactly_the_pinned_list` (Testing and Development); Bowser's F3 is killed. |
| A21 | PASS | 401 versus 403 as specified. The `/show` case is ruling 1. |
| A22 | PASS | Running app: bob's PUT and DELETE on alice's code give 404, byte-identical to a random code's; bob's GET gives `isOwner:false` and a `-p` tag; bob's `/mine` lacks alice's code. |
| A23 | PASS | `The_legacy_default_users_creations_are_read_only_for_every_account`. |
| A24 | PASS | README l.102–113 has the claim step (BEGIN, count, UPDATE, COMMIT); `The_legacy_default_user_id_appears_only_in_…`. |
| A25 | PASS | Running app: `Vary: Cookie` on the 200 and the 304. Mutant V1 is killed. |
| A26 | PASS | Running app: the owner's tag sent anonymously gives 200 with `-p`; the `-p` tag sent as the owner gives 200 with the plain tag; bob's own `-p` tag gives 304. Mutant E1 is killed. |
| A27 | PASS | `no-store` on the login 302, the callback 302 (`no-cache,no-store`), logout, 401 and 403; `ApiCacheControlLedgerTests`. |
| A28 | PASS | Running app: the share GET's keys are unchanged; the anonymous body holds no user id, subject or display name. `MeResponse` keys are exact. |
| A29 | PASS | Running app (alice): no header gives 428; `*`, `W/…`, a `-p` tag and `"garbage"` each give 412 with the current `ETag`. The race is in the UPDATE (a concurrency token whose original value is the client's tag). **Race measured:** see the mutant table and finding F4. |
| A30 | PASS | `The_write_budget_is_shared_…` (bob is unaffected on the same IP while alice is limited); `The_auth_policy_limits_login_and_logout_together_per_address`. |
| A31 | [R] DEFERRED | Railway: KnownProxies, `Host`, the redirect URI, `Secure` through the edge, and the PSL question. |
| A32 | PASS | `No_Google_client_secret_is_committed`; only the sentinel pair is in `appsettings.Development.json`; `<UserSecretsId>` is set. |
| A33 | PASS | Production: a TokenEndpoint override, the sentinel, or no client each give a non-zero exit with a message that names the key. Dummy real values get past auth to the database. The configured secret (`SECRETVALUE-123`) never appears in stderr. Mutant X1 is killed. |
| A34 | PASS | Production with `Identity__AllowAnonymousWrites=true` gives a non-zero exit. `tools/test/lib.mjs` runs the smoke as Testing with the stub and strips `Identity__*`. |
| A35 | PASS | The Dev and Testing logs carry "Sign-in uses stub OAuth endpoints (127.0.0.1:5190)". |
| A36 | PASS (local) | The Testing behaviour was verified on 5198. Production with real Google on the image is [R]. |
| A37 | PASS | README l.424 says "A backup is a credential"; the "No XML encryptor" warning is not suppressed. The Postgres restart test: see the mutant table. |
| A38 | PASS | `Provisioning_stores_only_provider_subject_and_cleaned_name_…`. |
| A39 | PASS | The running-app log after about 18 stub sign-ins holds only `Provisioned user <users.id>`: no `dev-alice`, display name, `code=`, `state=` or token. `Our_code_never_logs_…`; mutant L1 (log the subject) is killed. `Microsoft.AspNetCore: Warning` in both files. |
| A40 | PASS | Luigi's ledger specs and the `phase8-client` set (17 killed). The `/signin` button sends only the login navigation. |
| A41 | PASS | `save-session.ts` sends no POST, PUT or DELETE and reads no query flag; the auth interceptor never retries. |
| A42 | PASS | No `TEST_MODE_TEXT` or banner is shipped; `canWrite == isAuthenticated` (anonymous and signed in on the running app; harness for deleted-row and bad-id cookies). Mutant C1 (`CanWrite => true`) is killed. |
| A43 | PASS | Pinned by regex in `unsafe-sinks.spec.ts` C10/A43 (auth, owner and `isShareCode`, read once). |
| A44 | PASS (as amended) | Running app, anonymous `/mine`: the only API calls are `GET /api/me` and `GET /api/client-config`, with zero list calls. The server's 401 is the control. Ruling 2. |

## Targeted mutants (mine; scratch copy; serial)

Baselines were green: the Auth, ETag, cache-ledger and ProgramStartup suites (183 passed, 1 skipped), and the Postgres race (1 passed).

| Id | Mutant | Verdict | Killed by |
|---|---|---|---|
| V1 | `Vary: Cookie` removed | KILLED | `OwnershipTests` (2) |
| E1 | `-p` branch removed | KILLED | `OwnershipTests` (3) |
| S1 | `OnValidatePrincipal` no-op | KILLED | `A_cookie_that_outlives_its_row_…` |
| S2 | session and correlation cookies `SameAsRequest` everywhere | KILLED | cookie-attribute tests (3) |
| S3 | correlation cookie `SameSite=None` | KILLED | `The_correlation_cookie_is_HttpOnly_Lax_…` |
| S4 | `email` scope added | KILLED | `Sign_in_asks_for_openid_profile_with_S256_…` |
| X1 | stub allowed in every environment | KILLED | `ProgramStartupTests` (6) |
| L1 | provisioning logs the subject | KILLED | `Our_code_never_logs_…` |
| R1 | read-then-write If-Match (no concurrency token, C# pre-check), Postgres | KILLED | `Two_PUTs_with_the_same_tag_give_exactly_one_update` (failed in round 1 of 25) |
| C1 | `CanWrite => true` | SURVIVED, **equivalent** | every `CanWrite` read (`MeService`, `CreationService` l.307) sits behind a non-null `UserId`, and anonymous `api/me` returns the static `MeResponse.Anonymous`. My A42 negative control was mis-specified (F5). |

A37's Postgres restart test (`A_session_survives_a_restart_because_the_keys_are_in_Postgres`) also passed on the throwaway database.

## Rulings on the items raised for me

1. **Anonymous `POST /show` → 401 (was 405): accepted.** It is body-less, with no `Location` and no `Set-Cookie`, and every non-file SPA path answers the same way, so it reveals only "not signed in", which the caller already knows. It fails closed, and the CSRF guard still runs first (a hostile POST gives 403). Signed in, it's 405.
2. **Yoshi's A44, A2 and A4 changes: confirmed.** A44: the page-level rule (prompt in place, zero list calls while signed out or undecided) is equivalent for security, because the guard was always UX and the server's 401 is the control. I measured zero list calls on the running app. A2 and A4: `error=cancelled|failed` are fixed tokens chosen by our code, and `returnUrl` comes from the DataProtection-protected properties, re-checked by `SafeReturnUrl.From` and omitted when the state is unreadable. The client re-checks again, and `/signin` never navigates to it. I agree with Bowser that the server re-check is an equivalent mutant; keep it as defense in depth.
3. **Luigi's allowlist changes: exact and narrow.** `unsafe-sinks`: `BROWSER_NAVIGATION` is allowed in `core/sign-in.ts` only. The `location.assign(url)` and `loginUrl` shapes are pinned by regex, `returnUrl` may appear in two files only, `SAFE_NAVIGATION` gains only the literal `'/mine'`, and `SHIPPED_NAVIGATION` lists the three literal `/signin` calls. `designer-structure`: `auth-interceptor` and `save-session` join the banned set, and `account-control.ts` gets session only. `client-config.contract`: the three named importers are listed exactly.
4. **`/signin` Go back: consistent with C14.** `backTargetOf` gives only `'/'`, `'/show'` or `'/mine'`. On the running app, `//evil`, `javascript:`, `/\evil`, `https://evil` and `/%2F%2Fevil` all give Back `/` and a login `returnUrl=/`; `/show?x=1` gives Back `/show` and keeps the full query for the retry.
5. **`font-src`: unchanged.** The CSP is byte-identical to P7 (`default-src 'none'`, no `font-src`), and no violation was seen across sign-in.
6. **The Postgres-only If-Match race in the mutant runner: yes, opt-in only.** I measured it by hand: R1 (read-then-write) is killed in the first round on real Postgres, so 25 rounds is more than enough. Bowser's test cites a `phase8-auth R1` that doesn't exist in the set. Wire it in, but keep the runner's default strip, because the test calls `EnsureDeletedAsync` and would wipe whatever database it is pointed at. Proposal: a mutant may set `postgres: true`. It runs only when a separate variable, `FIREWORKS_MUTANT_POSTGRES`, is set and its `Database=` name ends in `_mut` or `_test`; otherwise it reports SKIPPED, never KILLED. R1 is two files (the repository and `FireworksDbContext.IsConcurrencyToken()`), so the runner needs multi-file swaps or a two-swap mutant. The runner and the set are Toad's; the mutant text is Bowser's.

## Findings

No real (exploitable) findings. Hardening and verification gaps:

- **F1 [low] `tools/browser-gates/` (no file) — the A13 real-browser CSRF case from `http://localhost:5190` isn't in any gate.** An attacker on a sibling subdomain (same-site) submits a form or a `no-cors` fetch → today it's 403 (I reproduced this by hand) → but if the guard ever regresses to allowing `same-site`, only the C# harness would notice. Fix (Toad, B3): add the route-fulfilled `localhost:5190` page (form POST to logout, plus a `no-cors` POST to creations), and assert `api/me` is still signed in and the list is unchanged; regular smoke if it fits, else daily. My script is `scratchpad/boo-p8/atk2.mjs`.
- **F2 [info] `src/web/fireworks-web/proxy.conf.json` — the A15 spec is missing.** The value is correct today. The impact of a regression is small, because the guard checks `Sec-Fetch-Site` before `Origin`, so `changeOrigin: true` would not open anything in current browsers. Fix (Toad): a short spec that parses the file and asserts no `changeOrigin`.
- **F3 [low] `tools/browser-gates/` — the A6 "zero CSP violations across sign-in" check isn't in a gate, and the 4200 dev server sends no CSP**, so a dev-loop run proves nothing. Passed by hand on the Testing instance with the real `wwwroot`. Fix (Toad, B3): add a `securitypolicyviolation` listener around `signInContext` (or a full button-click sign-in) in the Testing smoke.
- **F4 [info] `tools/mutants/sets/phase8-auth.mjs` and `run.mjs` l.120 — the race-test round count cites a mutant that isn't in the set.** It's measured now (above). Fix: ruling 6.
- **F5 [info] `boo-phase8-security-requirements.md` A42 — my negative control (`CanWrite => true`) is equivalent by construction.** It's not a code defect. A useful control would make `MeService` build the anonymous response from `currentUser.CanWrite`; the invariant test already pins the observable behaviour.

## Why

Phase 8 introduced the first ambient credential and made ownership real. Each A-requirement was checked against the payload or the running app rather than the records, and the mutants close the gaps where only a positive test existed.

## Boundary

- No product code changed. The findings are for Toad (F1–F4) and Bowser (the R1 mutant text); F5 is mine, under strict lockout.
- The [R] items (A31, the Google-origin half of A6, and real Google on the image for A36) wait for the Railway window, with C18 (S5, S21, S28).

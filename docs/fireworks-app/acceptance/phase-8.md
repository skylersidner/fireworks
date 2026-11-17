# Phase 8 acceptance criteria: authentication

Owner: Peach. Written 2026-11-17, after B1 to B3 and C1 were reported, in one pass (criteria and verdicts together, lean process). Mario's phase-gate runs the heavy steps; rows marked **gate** are his.

**Sources.** `plans/initial-implementation.md` §Phase 8 (Done-when and the rulings of 2026-11-16). Yoshi's `docs/fireworks-app/design/phase-8-auth.md`, cited as **Y§n**. Rosalina's `docs/fireworks-app/design/phase-8.md`, cited as **R§n**. `docs/fireworks-app/schema.md` §2.1, §2.6–§2.8, §11.2, §11.4. Records: `bowser-phase8-server-auth.md` (with the fix addendum), `luigi-phase8-client-sign-in.md`, `boo-phase8-security-verification.md` (cited as **A1–A44**), `rosalina-phase8-b2-design-check.md`, `toad-phase8-auth-gates.md`.

**Code read for this file:** `Services/Identity/IdentityRegistration.cs` (cookie name l.29, `SessionLifetime` 30 days l.34, `SlidingExpiration` l.75, `IsPersistent` l.159, stub warning l.209), `Services/Identity/AuthProviderSettings.cs` (the stale `Identity:*` throw, l.128), `Contracts/ApiContracts.cs` (`MeResponse`, l.10), `appsettings*.json`, `railway.toml`, `README.md` (§Sign-in l.49–117), client `core/models.ts` (`MeResponse`, l.12), `core/session.ts` (`signOut`), `core/sign-in.ts`, `shared/save-copy.ts` (l.198–224), `shared/sign-in/sign-in-copy.ts`, `pages/signin/signin-page.ts`, `features/player/pages/player-page/player-page.{ts,html}` (`lineage`, l.150), `features/mine/pages/mine-page/mine-page.ts`, `shared/sign-in/google-sign-in-button.ts`, `tools/browser-gates/{smoke,gate-auth}.mjs`, and the run summaries `test-results/regular/2026-11-16T214836/summary.json` and `test-results/daily/2026-11-17T063525/summary.json`.

### Surfaces

- **spec**: Vitest (web) or xUnit (API), named by test.
- **gate**: a scripted step in `tools/test/run.mjs` regular or daily, named by step.
- **app**: the running app in a real browser, by a named record's hand run.
- **file**: repo text.
- **[R] DEFERRED**: needs https or real Google, so it waits for the Railway window.

---

## 8a. Anonymous play and the Save prompt (Done-when 1)

| # | Criterion (pass condition) | Surface | Verdict and evidence |
|---|---|---|---|
| 8a.1 | **Anonymous play.** Signed out, `GET api/me` returns exactly `{ userId: null, displayName: null, isAuthenticated: false, canWrite: false, signedInWith: null }`. `/`, `/show` and `/s/<code>` play with no write request, and the share GET is 200 with no cookie. | spec; gate | **Accept.** `SessionTests.Anonymous_and_signed_in_api_me_hold_the_canWrite_invariant_with_the_exact_keys`; A20 pinned anonymous set; A28; the anonymous parts of the smoke (`roundtrip`, `player-vt`, `csp`) are green in regular 2026-11-16T214836. |
| 8a.2 | **Signed out, the save bar shows one `Save`** (even for a restored `source.isOwner: true`), with `aria-haspopup="dialog"`, no indicator, and the note `Sign in to save and get a share link. Your work is kept in this browser.` No bar while `api/me` is loading or unavailable. | spec | **Accept.** `designer-save.spec.ts` "signed out: one Save (even for an owned source)…"; `show-save.spec.ts` "signed out: prompt"; copy at `save-copy.ts` l.81. |
| 8a.3 | **Pressing Save opens the dialog and sends nothing.** Title `Sign in to save`, the R§5.3 body and privacy line, `Not now` then the Google button, initial focus on the Google button. The network ledger is empty. `Not now` closes it and focus returns to Save. ⌘S signed out opens the same dialog. The builder adds `Undo history starts fresh when you come back.` only when `canUndo() || canRedo()`. | spec | **Accept.** `designer-save.spec.ts` "signed out, Save: the dialog, zero writes…", "Not now…"; `show-builder-page.phase7.spec.ts` "⌘S signed out opens the sign-in dialog, with the Undo line only when there is history"; A40. |
| 8a.4 | **The Google button flushes the draft, then navigates exactly once** to `/api/auth/login/google?returnUrl=<encodeURIComponent(path+search)>`, after writing `sessionStorage['fireworks.signin.v1'] = { from, path, at }`. The button goes `aria-disabled`. `core/sign-in.ts` is the only file that calls `location.assign`. | spec | **Accept.** `designer-save.spec.ts` "the Google button flushes, then one navigation"; `unsafe-sinks.spec.ts` BROWSER_NAVIGATION allowlist (A5, Boo ruling 3). |
| 8a.5 | **The draft survives the round trip.** After sign-in returns, `fireworks.draft.v1` (or `fireworks.showDraft.v1`) holds the same shell or show as before the navigation, and the page renders it. Nothing is saved until the visitor presses Save (no POST, PUT or DELETE on return). | spec; app | **Accept, gate check.** Specs: the return cases in `designer-save.spec.ts` l.350–377 (A41: no write on return). App: Luigi's hand run "sign-in from Save, then Save (POST)". **No scripted gate drives the end-to-end path** (anonymous Save → dialog → stub → return → draft intact → Save → 201). Y§8 assigned it to Toad's smoke, but `gate-auth` starts at `/signin?returnUrl=/mine` and `walk-alice` saves already signed in. See G1. |
| 8a.6 | **Sign-in unavailable.** With `loginProviders: []`, Save opens the variant titled `Sign-in isn't available right now` with one `Close`, focused. | spec | **Accept.** `sign-in.spec.ts` (shared); copy `sign-in-copy.ts`. |

## 8b. The return from Google: toast and focus

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8b.1 | **The marker is read and deleted on load.** It is acted on only when `path` matches and `at` is under 10 minutes old. A stale or foreign marker is deleted and ignored. | spec | **Accept.** `designer-save.spec.ts` "a marker for another page, or an old one, is deleted and ignored"; `sign-in.spec.ts` (core). |
| 8b.2 | **Signed in on return:** the toast `Signed in as {name}.` (`Signed in.` for a blank name), announced once. Back signed out: nothing. | spec | **Accept.** `core/sign-in.ts` l.20; `designer-save.spec.ts` "back signed out (a refused cookie): nothing". |
| 8b.3 | **Focus.** `from: 'save'` puts focus on the save bar's first choice **after** the restore refresh settles (one move; `Update original` when the source is owned). `from: 'nav'` focuses the page `h1`. The flashing notice keeps focus if it's showing. While the refresh is in flight, save buttons are `aria-disabled` with `.btn-busy`. | spec | **Accept.** `designer-save.spec.ts` "the return from Save: the toast, then focus on the first choice after the refresh…", "the return from the nav: the toast and the h1"; Rosalina's §12.1 focus-table pass. |
| 8b.4 | **The restore refresh is exactly one GET**, only when signed in with a restored source. It updates `isOwner` and the name and keeps `updatedAt`. A 404 clears the source. Opening a `/c/` link signed in sends no extra GET. | spec | **Accept.** `designer-save.spec.ts` l.303 and l.344 (call ledger); Luigi's R2 regression mutant. |

## 8c. `/mine` signed out

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8c.1 | **The prompt in place, with no redirect.** The URL stays `/mine`, the `h1` `My creations` is focused, the body is R§7's, and the actions are the Google button (`returnUrl=/mine` plus `?page=`, `from: 'nav'`) and `Go to the designer`. | spec | **Accept.** `mine-page.spec.ts` l.117, l.135. |
| 8c.2 | **Zero list calls** while signed out or while `api/me` is pending. The only API calls are `GET /api/me` and `GET /api/client-config`. The server answers an anonymous `GET api/me/creations` with 401, no `Location`, no `Set-Cookie`, `no-store`. | spec; app | **Accept.** `mine-page.spec.ts` l.117; A19 and A44 (running app, zero list calls). |
| 8c.3 | **Sign out on `/mine`, a list 401, a delete 401:** one `api/me` reload, then the prompt with its `h1` focused, never a retry. A delete 401 toasts `You've been signed out, so nothing was deleted.` Providers empty: the unavailable body and only `Go to the designer`. | spec | **Accept.** `mine-page.spec.ts` l.154, l.179, l.206, l.440. |

## 8d. Error copy: 401, 412 Replace, 428, and `/signin`

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8d.1 | **401 on any save:** `Couldn't save: you've been signed out. Sign in to save; your {noun} is kept in this browser.` with `Sign in`. Exactly one `GET api/me` (the interceptor), no retry, no generic toast. The bar collapses to the signed-out `Save`, and focus moves there if its button was removed. The draft and `source` are untouched. | spec | **Accept.** `save-copy.ts` l.198; `designer-save.spec.ts` l.748; `show-save.spec.ts` l.323; `auth-interceptor.spec.ts`. |
| 8d.2 | **Update original sends `If-Match: "<source.updatedAt>"`.** A 412 shows R§9.2's text with `Save as new` and `Replace the newer version`. Replace is one `GET` then one `PUT` whose `If-Match` is that GET's tag. A GET that's 404 or `isOwner: false` shows row 404a with no PUT. While Replace runs, its button reads `Replacing…`. `Save as new` is the remix. | spec | **Accept.** `save-copy.ts` l.207; `designer-save.spec.ts` l.793, l.831, l.847; `show-save.spec.ts` l.290. |
| 8d.3 | **428:** R§9.3's text with `Reload`. A source with an empty `updatedAt` never sends a PUT. | spec | **Accept.** `save-copy.ts` l.218; `designer-save.spec.ts` l.862. |
| 8d.4 | **Server If-Match (schema §2.7, §11.4).** No header gives 428. `*`, a list, two header lines, `W/…`, a `-p` tag, garbage, or a same-instant tag at a non-zero offset gives 412 with the current `ETag`, always after the owner-filtered 404. Two PUTs with the same tag give exactly one update on Postgres. DELETE is unconditional. | spec | **Accept.** `IfMatchTests` (matrix, parse, `Two_PUTs_with_the_same_tag_give_exactly_one_update`, `A_delete_is_unconditional`); A29; Boo's R1 KILLED in round 1. |
| 8d.5 | **`/signin` copy.** `error=cancelled`: `Sign-in was cancelled` / `Nothing changed. Your work is still in this browser.` `error=failed`: `Sign-in didn't finish` / R§9.4's body. No error: `Sign in to Fireworks Sandbox`. Each has the Google button and `Go back` (`Go to the designer` for `/` or missing, `Back to the Show Builder` for `/show`). The `h1` is focused. An unknown `error` value renders the default copy and reflects nothing. A retry keeps the marker's `from`. | spec; app | **Accept.** `signin-page.ts` l.30–60; `signin-page.spec.ts` (l.95, l.111, l.118, l.129); A4; Luigi's hand run (Cancel → `/signin?error=cancelled`). |
| 8d.6 | **The server picks the error token.** Google's `access_denied` gives `/signin?error=cancelled&returnUrl=…`; anything else gives `error=failed`; `returnUrl` is omitted when the state can't be read; nothing from the provider is reflected. | spec | **Accept.** `SignInFlowTests.A_provider_error_redirects_to_signin_with_cancelled_or_failed_and_reflects_nothing`, `A_bad_state_or_correlation_fails…`; A2, A4. |

## 8e. Two accounts can't edit each other's creations (Done-when 2)

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8e.1 | **Across accounts:** bob's `GET` of alice's code says `isOwner: false` with a `-p` ETag. His PUT and DELETE are 404, byte-identical to a random code's. His `/mine` lacks her card and hers has it. Her row is unchanged. The reverse holds. Remix is allowed. | spec; gate | **Accept.** `OwnershipTests.Alice_and_bob_cannot_edit_each_others_creations`; gate `auth` (walk) green in regular and daily `25-auth-chromium.log`; negative control `auth-neg-walk` (bob signs in as alice) fails as expected in daily 2026-11-17T063525. |
| 8e.2 | **On `/c/<code>`,** the owner is offered `Update original` and `Save as new`; the non-owner only `Save`, with the note `Saves your own copy with a new link. The original isn't changed.` | gate; spec | **Accept.** `gate-auth` walk part (the choices); the note's text is in `designer-save.spec.ts`. |
| 8e.3 | **Per-viewer caching:** `Vary: Cookie` on the share GET's 200 and 304. The owner's tag sent anonymously gives 200 with `-p`, and vice versa. | spec | **Accept.** `OwnershipTests.If_None_Match_is_compared_against_the_viewers_own_tag`; A25, A26 (mutants V1 and E1 KILLED). |
| 8e.4 | **CSRF.** Signed in, a same-site or cross-site no-cors POST to `api/creations` and a form POST to `api/auth/logout` reach the server and get 403. A credentialed cross-origin DELETE dies at the preflight or gets 403. The session, the list (byte-identical) and the row survive. | spec; gate | **Accept.** `CrossOriginWriteGuardTests`; gate `auth` (csrf); `auth-neg-csrf` reports `CSRF LANDED` in daily, as required. |
| 8e.5 | **Rate limits partition by user when signed in** (`u:<id>`), otherwise by IP, and the `auth` policy (20 a minute per IP) covers login and logout. | spec | **Accept.** A30 tests. |
| 8e.6 | **Two real Google accounts** through the real provider. | [R] | **DEFERRED** (A31, A36). |

## 8f. The interim default-user code path is gone (Done-when 3)

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8f.1 | **No source under `src/api/Fireworks.Api`** mentions `DefaultUserId`, `AllowAnonymousWrites`, `DefaultUserCurrentUser`, `DefaultUserOptions` or `EnsureDefaultUserExistsAsync`, except migrations and the stale-config guard's message. Neither appsettings file has an `Identity` section. `FireworksDbInitializer` only migrates. | file; spec | **Accept.** My grep (2026-11-17): the only product hit is `AuthProviderSettings.cs` l.128 (the guard message). Other hits are tests, historical README mutant-ledger rows (l.293–298) and the stale `bin/Release/net11.0/appsettings.json` build output, which `.dockerignore` excludes (`**/bin/`), so it doesn't ship. `SourceGuardTests`. |
| 8f.2 | **Any leftover `Identity:*` key stops startup** with a message naming the keys. Production with `Identity__AllowAnonymousWrites=true` exits non-zero. | spec | **Accept.** `ProgramStartupTests`; A34. |
| 8f.3 | **The stub is refused in Production** (and anywhere outside Development and Testing): a missing or blank client, the sentinel pair, or any `*Endpoint` override exits non-zero before touching the database, and the secret never reaches stderr. Dev and Testing log `Sign-in uses stub OAuth endpoints`. | spec | **Accept.** `ProgramStartupTests` (mutant X1 KILLED); A33, A35. |
| 8f.4 | **`canWrite == isAuthenticated` on every path** (anonymous, signed in, a deleted row, an unparseable id). | spec | **Accept.** `SessionTests` l.39, l.58, l.85; A42. Note: Boo F5, the A42 mutant `CanWrite => true` is equivalent, so the invariant tests are the control. |
| 8f.5 | **The test-mode banner is removed.** No `test-mode-banner` component or `TEST_MODE_TEXT` in shipped code. The designer, builder, `/mine` and player render no `[data-testid="test-mode-banner"]`, and the player's two wrapper `div`s are gone. | file; spec | **Accept.** My grep: only the absence assertions in `mine-page.spec.ts` l.291, `designer-save.spec.ts` l.287 and `player-page.spec.ts` l.342; `shared/` has no banner directory except `api-banner`. Rosalina's B2 check. |
| 8f.6 | **Legacy creations are read-only.** No account can PUT or DELETE the default user's creations; their share links still play; `/mine` lists them for nobody. | spec | **Accept.** `OwnershipTests.The_legacy_default_users_creations_are_read_only_for_every_account`; A23. |

## 8g. Session, sign-out and stored identity

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8g.1 | **The cookie.** `__Host-fw.session` outside Development (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no Domain) and `fw.session` in Development (no `Secure`). One claim (`NameIdentifier = users.id`), no tokens. | spec; app | **Accept.** `SessionTests` cookie-attribute cases, `SignInFlowTests.The_session_cookie_has_the_A10_attributes_and_a_one_claim_ticket`, `Development_uses_fw_session_without_Secure`; A10. |
| 8g.2 | **30 days, sliding, with no absolute cap.** `Set-Cookie` expires 30 days ahead; a request past half-life renews it; after 30 idle days the session ends. `IsPersistent` is set on every sign-in. | spec | **Accept.** `SessionTests.The_session_slides_past_half_life_and_ends_after_30_idle_days`; `IdentityRegistration.cs` l.34, l.75, l.159. |
| 8g.3 | **Sign-out keeps the draft.** `Sign out` sends `POST api/auth/logout` (204, deleting cookie, `no-store`), then one `GET api/me`, then toasts `Signed out.` and focuses `Sign in`. `fireworks.draft.v1` and `fireworks.showDraft.v1` are byte-identical before and after. | spec; app | **Accept, gate check.** The ledger, toast and focus are pinned in `designer-save.spec.ts` l.250 and `mine-page.spec.ts` l.179; A11. The draft half rests on a code read: no shipped code removes a draft key (`removeItem` appears only for the sign-in marker in `core/sign-in.ts` l.107). **No spec asserts the draft bytes after sign-out.** See G2. |
| 8g.4 | **Stored identity.** A `users` row holds `external_provider = 'google'`, `external_subject` (Google's `sub`) and the cleaned display name (blank becomes `User`, at most 80 code points), never an email, picture or token. `(external_provider, external_subject)` is unique. Two simultaneous first sign-ins give one row. Logs never carry the subject, name, code, state or token. Scopes are `openid profile`. | spec | **Accept.** `SignInFlowTests.Provisioning_stores_only_provider_subject_and_cleaned_name…`, `Display_names_run_the_schema_name_pipeline…`, `Two_first_sign_ins_at_once_resolve_to_one_row`, `Our_code_never_logs…`; A1, A38, A39. |
| 8g.5 | **The display name is shown only to its owner,** as text in a `<bdi>` with `title="Signed in with Google as {name}"`. The share GET's body has no user id, subject or name. | spec | **Accept.** `designer-save.spec.ts` l.250; A28. |

## 8h. "Remixed from"

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8h.1 | **On the player only,** the muted line reads `Fireworks Sandbox · Remixed from the original`, where `the original` links to `/s/<remixedFrom>`. It renders only when `isAuthenticated && response.isOwner === true && isShareCode(remixedFrom)`. It's absent for anonymous visitors, non-owners, and a `null` (deleted original). It's absent on `/mine`, the designer and the builder. | spec; file | **Accept.** `player-page.ts` l.150 (`lineage`); `player-page.html` l.42, l.153; `unsafe-sinks.spec.ts` C10/A43 regex; A43. This closes the accepted interim exposure in the standing decision on `remixedFrom`, with no server change. |

## 8i. Runbooks and README

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8i.1 | **The claim SQL runbook** names the default user id, says to back up first, gets `userId` from `/api/me`, and runs `BEGIN; SELECT count(*) …; UPDATE creations SET owner_user_id = '<your userId>' …; COMMIT;` with the instruction to commit only when the counts match. It is never a migration or startup code. | file | **Accept.** `README.md` l.100–117; A24. |
| 8i.2 | **Google setup steps** in the README: create a project; set up the consent screen (External, Testing, test users); add the scopes `openid` and `userinfo.profile` and not `email`; create a Web client with the exact redirect URIs (`localhost:4200`, `:5180`, `:8080`, later `https://<domain>`); store the id and secret as user-secrets and blank the three endpoints; `dotnet user-secrets clear` returns to the stub. No real secret is committed. | file; spec | **Accept.** `README.md` l.73–98; `No_Google_client_secret_is_committed` (A32). Following the steps against real Google is [R] (8k). |
| 8i.3 | **The stub is documented as the local default,** with `--interactive` for two accounts. The Railway section lists `Auth__Providers__Google__ClientId` and `__ClientSecret`, and says not to set `Identity__*` or `*Endpoint`. Test windows are marked retired. | file | **Accept.** `README.md` l.67–71, l.404–407, l.422–424. |

## 8j. Evidence freshness and branding

| # | Criterion | Surface | Verdict and evidence |
|---|---|---|---|
| 8j.1 | **Regular tier green** under 5 minutes, and **daily green under 24 hours old** at gate time, both on the shipped tree. | gate | **Accept.** Regular `2026-11-16T214836`: green, 190.3 s. Daily `2026-11-17T063525`: green, complete, 21.7 min, including `auth-chromium`, `auth-neg-csrf`, `auth-neg-csp` and `auth-neg-walk`. No source file under `src/` is newer than the daily's `run.log`, and the G fix (2026-11-16 21:30) predates both runs. Both summaries record about 160 uncommitted paths on commit `4144608`. Mario re-confirms the age at the gate. |
| 8j.2 | **Zero CSP violations across the real sign-in chain** (`/signin` → Google button → stub → callback → `/mine`) with the enforced header, and a script-src CSP on both documents. | gate | **Accept.** Gate `auth` (csp); `auth-neg-csp` fails as expected in daily; A6 (local half). |
| 8j.3 | **The Google button** uses `<img src="brand/google-g.svg" alt="" width="20" height="20">`, which is byte-identical to the current `signin-assets.zip` Light / Square / no-text G (chrome paths removed, `viewBox="10 10 20 20"`). The image is served as 200 `image/svg+xml` with `nosniff`, with no `svg`, `link` or `script` in the button. | spec; app | **Accept.** `google-sign-in-button.ts` l.35; `sign-in.spec.ts`; Bowser's fix addendum (D1, sha1 match); Rosalina's D1 closed by that fix. |

## 8k. Deferred ([R])

| # | Item | Verdict |
|---|---|---|
| 8k.1 | **WebKit sign-in, Save and `/mine`.** WebKit stores no `Secure` cookie on the http Testing instance (P3, re-measured). `keyboard-webkit` skips its two sign-in parts with a NOTE, and `roundtrip-webkit` saves through Chromium. | **[R] DEFERRED** (needs https). |
| 8k.2 | **Real Google:** the sign-in round trip through accounts.google.com, the CSP on Google-origin documents (A6), the image in Production with a real client (A36), two real accounts (8e.6), and the README steps run end to end. | **[R] DEFERRED.** |
| 8k.3 | **Railway edge:** `KnownProxies`, `Host`, the redirect URI, `Secure` through the edge, and the PSL question (A31). | **[R] DEFERRED.** |

---

## Verdict

**Phase 8 accepted, with two gate checks (G1, G2).** Each Done-when item is met: 8a (with G1), 8e and 8f. No product defect was found.

### Gaps for Mario's gate

- **G1 (8a.5): `tools/browser-gates/` has no step for the end-to-end anonymous Save.** Only unit specs and Luigi's one hand run show the full path (Save signed out → dialog → Google button → stub → return → same draft on screen → toast → focus on Save → press Save → 201). At the gate, run it once in the running app (Testing image or dev stack, Chromium). Then decide whether Toad adds it to `gate-auth` as a fourth part; it would take about 10 s.
- **G2 (8g.3):** sign-out keeps the draft, but only a code read shows it. At the gate, check `fireworks.draft.v1` (on `/`) and `fireworks.showDraft.v1` (on `/show`) are unchanged across Sign out. A one-line spec assertion would close it for good (Luigi's area, or Toad's).
- **Mutants:** the gate sweep on the changed files (`phase8-auth`, `phase8-client`) includes R1 on a `_mut` Postgres database. That has been measured only by hand (Toad boundary; `run.mjs` exit 3 means some mutants were SKIPPED, not all KILLED).

### Info (no action needed for acceptance)

- **N1:** in `core/models.ts` l.17, `MeResponse.signedInWith` is typed `string | null`. schema §2.8 says `'google' | null`. It is read only for display, so this is harmless. Luigi can tighten it next time he's in the file.
- **N2:** `src/api/Fireworks.Api/bin/Release/net11.0/appsettings.json` (2026-11-12) still carries the old `Identity` section. It is a local build output and `.dockerignore` excludes it, but a `dotnet run` from `bin/Release` would hit the stale-config throw. That's the intended loud failure.

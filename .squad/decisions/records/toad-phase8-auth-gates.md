# Phase 8 B3: auth test tooling (Toad)

**Date:** 2026-11-16 · **Status:** proposed. Closes Boo's F1–F4 (`boo-phase8-security-verification.md`) and wires ruling 6. Promotion to the index is Skyler's call.

## What

1. **`tools/browser-gates/gate-auth.mjs`** (Chromium, real CSP, the real redirect flow through the API's stub), with three parts and one negative control each:
   - **csrf (F1, A13).** A victim signs in and saves a shell. Attacker pages come from a real loopback HTTP server on `127.0.0.1:<port>` (same-site) and `localhost:<port>` (cross-site). Each tries a no-cors POST to `api/creations`, a credentialed cross-origin DELETE and a form POST to `api/auth/logout`. The POST and the form must reach the server and get 403. The DELETE must die at the preflight or get 403. `Sec-Fetch-Site` must be the case's value. Afterwards the session, the byte-identical list and the row must all survive. Control `NEG=csrf`: the same requests from a real app document (`/status`, same-origin) must land (`CSRF LANDED`).
   - **csp (F3, A6).** `/signin?returnUrl=/mine` → Google button → login → stub authorize → callback → `/mine`, with a `securitypolicyviolation` listener in every document and "Refused/violates" console lines collected. Zero of either; a `script-src` CSP on both documents. Control `NEG=csp`: an inline script on `/mine` after the chain.
   - **walk (two accounts).** `walk-alice` saves with the designer's Save button. On `/c/<code>` she is offered Update original and bob only Save. Bob's GET says `isOwner: false`, his PUT and DELETE get 404, his `/mine` lacks the card and hers has it, and her row is unchanged. The reverse holds for bob's code. Control `NEG=walk`: "bob" signs in as alice.
   - **Tiers:** the positive gate is the smoke step `auth` (regular, about 30 s). The daily tier runs it plus `auth-neg-csrf`, `auth-neg-csp` and `auth-neg-walk`, each `expectExit: 1` with a `mustSay`.
2. **Stub (`tools/fake-oauth/server.mjs`, now mine):** `POST /__next-subject?sub=<s>` queues a one-shot subject for the next authorize without a `login_hint`. That's how a browser gate signs two accounts in through the real flow, because the API builds the authorize URL. It is Node-only test plumbing and the C# stub needs no equivalent.
3. **F2:** `src/app/core/proxy-config.contract.spec.ts`. `angular.json` serves exactly `proxy.conf.json`, and it is the only `proxy.conf.*`. There is no `changeOrigin` (any depth, any case) and no Origin/Host `headers` override. The negative controls are on mutated copies of the real text. The file has `export {}` so that its `declare const process` stays file-local.
4. **Ruling 6:** `tools/mutants/run.mjs` adds `postgres: true` (api only) and `swaps: [...]`, for several exact swaps restored together. A `postgres` mutant gets `FIREWORKS_TEST_POSTGRES = FIREWORKS_MUTANT_POSTGRES` only when the string has exactly one `Database=` matching `^[A-Za-z0-9_]+_(mut|test)$`. Otherwise both it and its baseline are SKIPPED. The default strip stays, and `FIREWORKS_MUTANT_POSTGRES` is stripped too. Exit codes: 0 means all KILLED, 3 means all that ran were KILLED but some were SKIPPED, 1 means anything else. Self-test: `MUTANT_PG_SELFTEST=1`.

5. **Gate scripts brought up to Phase 8 (found by the first pre-gate daily run).** The keyboard gate's `/mine` walk and K9 (My shells), and the touch gate's `/mine` card spacing, never signed in. Since Phase 8, an anonymous `/mine` shows the sign-in prompt and My shells makes no list call (A44), so those parts failed. They now sign in as `SAVE_SUBJECT` (`smoke-user`, the owner of the SAVE codes) via `signInContext(ctx, base, subject)`, which queues the subject at the stub. `signInContext` without a subject signs in as the stub's default `dev-user`, which owns nothing.
6. **WebKit can't hold a session on the http Testing instance** (probe P3, re-measured: no cookie stored; `phase-8-auth.md` already says local sign-in is a Chromium and Firefox check). So in WebKit:
   - `roundtrip-webkit` plays a Node-saved `codes.show` and copies its Show JSON anonymously. A fresh Chromium profile then applies and saves (`JSON_ENGINE=chromium`).
   - `keyboard-webkit` skips the two sign-in parts with a `NOTE` (53 checks instead of 79).
   - WebKit Save and `/mine` coverage needs https and is [R], with the Railway window.

## Why

- **`route.fulfill` attacker pages are a false pass in Chrome 157.** Local Network Access treats a fulfilled page as public and blocks its fetches to 127.0.0.1 before they leave the browser (`LocalNetworkAccessPermissionDenied`). A guard that allowed same-site would still have looked "blocked". That's why the gate also asserts that nothing failed with `LocalNetworkAccess`.
- **Playwright's `request.allHeaders()` omits `Sec-Fetch-*`, and a CORP- or CORS-blocked response never reaches the `response` event.** Without CDP (`requestWillBeSentExtraInfo`, `responseReceivedExtraInfo`), "the no-cors POST got 403 at the server" is unobservable, and a same-site case can't prove it was same-site.
- **The CSRF control can't be a scratch instance with the guard off** without a product mutation (G1–G5 already kill that at the C# level). The same-origin replay is what a broken guard looks like to the server: the cookie is sent and the write executes. So it proves the detectors (session, list, row, statuses) see a landed attack.

## Boundary

- Applies to any future browser gate that plays an attacker origin. Serve it from a real loopback server, read the headers and statuses over CDP, and assert the LNA check.
- Chromium only (CDP). Firefox and WebKit CSRF parity isn't claimed here.
- Not done here: a real run of R1 on a `_mut` database (Boo measured it KILLED in round 1 by hand). The runner is wired; running it is a phase-gate mutant step.

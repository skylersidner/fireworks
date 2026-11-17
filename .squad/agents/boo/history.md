# Boo — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells, and shows since Phase 6. Owner: Skyler Sidner.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway (deferred, [R]).
- **Plan:** `plans/initial-implementation.md`, Phases 0–8. Identity is Google sign-in on a cookie session since Phase 8 (§3.4). **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (mirror structure, never its domain). **Prototype:** `prototypes/fireworks-prototype.html` (parity oracle).
- **Your focus here:** security review of the pipeline, ownership, rate limits, validation, share-link exposure, CSP and headers, and authentication. Per-user ownership makes IDOR findings real here.
- Carried over: the role only. Standing lessons are in `.squad/decisions/README.md`.

### Folded from Phases 0 to 2 (summarized 2026-11-14, compacted 2026-11-15)

- **Phase 0 ruling (historical):** production writes were off until Phase 8 (OQ20). Phase 8 has removed that switch. Reviews before Phase 8 restated OQ3 and OQ13 as conditions.
- **Probe a clean publish, not the repo's build output** (skill `.squad/skills/probe-the-published-build/SKILL.md`): copy `src/api/Fireworks.Api` minus bin, obj and wwwroot to the scratchpad, `dotnet publish -c Release`, run Production on a scratch port. Before reporting a regression, compare source mtime with the dll.
- **Phase 1 pipeline:** Development settings are not published. `BuildHost-*` still lands in publish. Conditions: `CanWrite` checked in the service with an endpoint-enumerating 403 test; limiter by IP; ForwardLimit 1.
- **Phase 2:** no security review. The strict validator rejects any document the client would adjust.

### Folded from Phase 4 (summarized 2026-11-14)

- **Requirements:** `boo-phase4-security-requirements.md` (S1–S29). S13 was overruled by Skyler: `remixedFrom` depends on `isOwner` alone (interim exposure accepted; marked in place). S17 and S28 are superseded in part by Phase 8's A30 and A42 (marked 2026-11-16). Check every owner-only field against the interim identity.
- **Route and gate traps** (skill `.squad/skills/aspnet-request-gates/SKILL.md`): the `regex(...)` route constraint is case-insensitive (the Kelvin sign reaches the action), so the share code uses an ordinal `IRouteConstraint`. With the `/api/{**rest}` catch-all, `[Consumes]` gives 404; use `HasJsonContentType()`. The gate runs before the body read, so writes off gives 403, not 413. Limits: 189,359 B compact and 210,479 B escaped worst case; the 256 KiB limit stays.
- **Form bodies (F1):** MVC form value providers read multipart and urlencoded bodies before the gate; fixed in `AddFireworksControllers`. Test with a form-typed body too.
- **`Connection: close`:** Kestrel drops a connection whose unread body is over the limit. Reproduce with one `http.client` connection; curl reconnects and hides the failure.
- **Rig:** three instances on a scratch Postgres (writes off, user A, user B), started one at a time (two migrating at once race on `42P07`). Count queries with `Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command=Information`. zsh needs `env "K=V"` for dotted names. `FIREWORKS_TEST_POSTGRES` must name a throwaway database.

### Folded from Phases 5 to 7 (summarized 2026-11-15 and 2026-11-16)

- **Phase 5 (`boo-phase5-security-requirements.md`, C1–C20):** client-side traversal is real: `new URL` resolves `/api/creations/../me` and `%2e%2e`. Run the share-code regex before every URL build, and take `source.shareCode` from the response (C4). Don't render `remixedFrom` (C10). Gate write controls on `canWrite`, never `isOwner` (C9). Angular remaps `[innerHtml]` to `innerHTML`, and an interpolated `href` slipped past C2: mutation-test sink bans with alternate spellings (skill `.squad/skills/angular-unsafe-sink-ban/SKILL.md`). Names are isolated with `app/shared/bidi.ts` (C3). C9, C10 and C17 are superseded by Phase 8 A40, A43 and A42.
- **Phase 6 (`boo-phase6-security-verification.md`):** C1–C17 PASS on shows. F2 and F5 were closed by Toad's rules 11–12. F3 (info): `normalizeShow`'s null prototype is lost by spreads and `structuredClone`; probe `constructor`, `toString` and `valueOf`. F4 (info): `<option>` labels aren't isolated, accepted under C3. `GET api/client-config` is four integers with `no-store` and `nosniff`; Skyler kept the ranges as built.
- **Phase 7 (`boo-phase7-security-requirements.md`, P7-S1 to S18):** CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`. `style-src 'unsafe-inline'` is an accepted residual (Skyler, 2026-11-15). Pixi's `pixi.js/unsafe-eval` no-ops both probes and costs +1.6 KB gzip. A bundle grep is never a valid CSP check; only runtime `securitypolicyviolation` is. The share-code GET is `private, no-cache` with an ETag; everything else under `/api` is `no-store` (`Services/ResponseHeaders.cs`). Gates run in Chromium; Firefox and WebKit moved to the daily run.
- **Probing:** `curl -I`, not `-X HEAD` (which hangs). Kestrel answers 400 and 431 itself, so only `AddServerHeader=false` reaches them. Hung-DB rig: a Python TCP proxy in front of 5433 with a `hang` flag (`scratchpad/boo-c1/proxy.py`); watch sockets with `lsof -p <pid> -a -i tcp:<port>`. A single Playwright page across many paths stalls, so use one page per path.
- **Interlude (2026-11-16):** the T2 caller-pin exception in `show-fingerprint.ts` is safe, and the production `wwwroot` is clean. F6 (test-only as a comment) was fixed by Toad with an import rule; Boo's re-check is open. The daily carries the Firefox and WebKit CSP gates.

## Learnings

### 2026-11-16 — Phase 8 security requirements (8.0a, A1–A44)

- Accepted Yoshi's design with changes: correlation cookie `SameSite=Lax` everywhere (A3); `__Host-fw.session` outside Development if P3 passes (A10); a shared `TryGetUserId` predicate in the fallback policy (A18); the CSRF guard on every unsafe request, after `UseAuthentication` so the callback skips it (A13); the provider allowlist before `Challenge` (A9); a strict `SafeReturnUrl` (A5); Production throws on missing or sentinel Google config or endpoint overrides (A33); the stub lives in Development and `Testing` only (A36); `If-Match: *` gives 412 (A29). The OAuth handler has no nonce.
- Re-ruled C9 (A40: Save may render as a sign-in prompt and sends no write), C17 (A42: banner deleted, replaced by a `canWrite == isAuthenticated` invariant), C10 (A43), S17 (A30) and S28 (A42).
- Code facts: the harness already runs as `"Testing"`; `tools/test/lib.mjs` ran the smoke API as Production with `Identity__AllowAnonymousWrites=true`, which must move to Testing plus the stub; `Microsoft.AspNetCore: Warning` keeps the callback's code and state out of the logs. New skill `.squad/skills/oauth-cookie-local-rig/SKILL.md`: localhost ports are same-site, so the CSRF sibling case reproduces locally; `CookieContainer` drops `Secure` over http.

### 2026-11-16 — Phase 8 security verification (C1)

- A1–A44 pass (A31 is [R]); no product defects. Findings are test gaps: no browser gate for CSRF from 5190 or for CSP during sign-in (closed by Toad's B3); no A15 `changeOrigin` spec (closed); the If-Match race's 25 rounds were never measured, because the set had no R1 (wired by Toad, measured by Mario).
- **Rig facts:** the 4200 dev server serves the SPA without CSP, so a zero-violation run there proves nothing. For A6, run Testing from the project directory on 5198 with the real `wwwroot`. Chromium in Playwright needs `channel: 'chrome'`. A `no-cors` CSRF POST shows `ERR_FAILED` in Chrome because CORP blocks the opaque 403; confirm the 403 with curl using Chrome's headers.
- **Mutant rig without touching the tree:** rsync `src/api` (minus bin, obj and wwwroot) plus `schema` into the scratchpad and swap with a Python driver. The Postgres race test calls `EnsureDeletedAsync`, so only a throwaway database name is safe (`fireworks_boo_race`).
- **Rulings:** anonymous `POST /show` gives 401 (accepted); Yoshi's A44, A2 and A4 restatements are confirmed; Luigi's allowlists are exact. The equivalent mutant C1 (`CanWrite => true`) is Boo's F5: the invariant tests pin the observable behaviour.

### 2026-11-17 — Cross-agent update (Scribe)

- **F1 to F4 are closed by Toad's B3** (`toad-phase8-auth-gates.md`): `gate-auth` has the csrf part (real loopback attacker origins, CDP headers) and the csp part; `proxy-config.contract.spec.ts` covers F2; R1 is wired behind `FIREWORKS_MUTANT_POSTGRES` and a `_mut` database-name check. F4's mutant text is Bowser's, and it is in the set. Mario's gate ran it.
- **Your A44, A2 and A4 amendments are marked in place**: `boo-phase8-security-requirements.md` carries "Amended by yoshi-phase8-auth-design.md" under each. Your supersession marks are in `boo-phase5-security-requirements.md` (C9, C10, C17) and `boo-phase4-security-requirements.md` (S17, S28).
- **Carried for you:** `fireworks_boo_race` is still on 5433 (Mario's gate, note 5). It is yours to drop; Scribe did not. The A37 warning (no XML key encryptor on the image) is open with Bowser, against your A37 trigger.

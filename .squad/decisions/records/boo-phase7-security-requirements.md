# Phase 7 security requirements: CSP, headers, caching and pipeline edges (Boo, A1)

**Date:** 2026-11-15. **Status:** proposed. P7-S1 to P7-S18 bind B1 (Bowser, server) and B2 (Luigi, bundle) once the coordinator forwards them. C1 (Boo) and C3 (Toad) verify them. Promotion to the index is Skyler's call.
**Scope rulings applied (Skyler, 2026-11-15):** Railway stays deferred, so every requirement below has a check that runs on the local image or a clean publish, and anything that can only be checked through the edge is marked **[R] DEFERRED**. There is no If-Match yet, and the ETag is the quoted `updatedAt`.

## What

### 1. Evidence this record rests on (measured 2026-11-15, not inferred)

- **Baseline:** a clean `dotnet publish` from a copy, run in Production on 5199 against a throwaway database, serving the repo's `wwwroot`. Every response carries `Server: Kestrel`. Static files and the SPA fallback carry only `ETag` and `Last-Modified`, with no Cache-Control and no nosniff. `/api/*` responses carry `no-store` and `nosniff`. `/health/live` carries the framework's `no-store, no-cache`, `Pragma` and `Expires`. **`/health/ready` and `/health/ready/x` return 200 text/html (index.html).** **`/c/..%2Fme` and `/s/a.b` return a bare 404 with an empty body, and Chrome shows its own error page (`ERR_HTTP_RESPONSE_CODE_FAILURE`).** A non-GET request to a deep link gets 405 with `Allow: GET, HEAD`. Kestrel's own 400 (bad Host) and 431 (40 KB header) carry `Server` and `Connection: close`, and nothing else.
- **CSP feasibility, Chromium (Chrome channel), with the header injected through a Playwright route:**
  - **Current build, proposed policy:** each page logs one `script-src-elem inline` violation (Beasties' media-swap `<script>`, so the stylesheet would stay `media="print"`), and one `script-src eval` violation from `chunk-C7TGCyiC.js` (Pixi's `unsafeEvalSupported` probe). The stage then fails with "Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module".
  - **Scratch build with `import 'pixi.js/unsafe-eval'` and `inlineCritical: false`, with the exact policy in §3 (no `'unsafe-eval'`) and writes on:** **zero violations and no page errors** on `/`, `/show`, `/s/<shell>`, `/s/<show>`, `/c/<show>`, `/mine` (listing) and `/status`. Stages render: 1 canvas on the designer and player, 3 on the builder and `/c/`. The scratch build is `scratchpad/p7/web`; the repo is unchanged.
  - **Firefox and WebKit were not run:** the installed Playwright's browser builds are missing. C1 and C3 must install them (`npx playwright install firefox webkit`).
- **Pixi 8.23.0 source (`node_modules/pixi.js/lib`):** `new Function` is in four generators (`generateUniformsSync`, `GenerateShaderSyncCode`, `compileBufferSync` for UBOs, `generateParticleUpdateFunction`) and in the probe `utils/browser/unsafeEvalSupported.mjs`. The probe is called only from `AbstractRenderer._unsafeEvalCheck` and `UboSystem._systemCheck`. `lib/unsafe-eval/init.mjs` replaces both checks with no-ops and swaps all four generators for polyfills (`ParticleBuffer.generateParticleUpdate` included, which our `ParticleContainer` uses). `package.json` lists `./lib/unsafe-eval/init.*` under `sideEffects`, so the side-effect import survives tree-shaking.
- **The `new Function` text stays in the built chunks after the fix** (3 chunks in both builds). **Grepping the bundle for `new Function` is not a valid check;** only a runtime check is (P7-S13).
- **Cost of the import:** +10 KB raw and +1.6 KB gzip across all JS (1,154,097 B before, 1,164,098 B after). CPU cost: the particle polyfill makes one pass per attribute instead of one fused loop. It isn't measured and isn't gated (standing decision: performance is benched until the end of the project). It goes to the end-of-project CPU review as a line item.
- **Angular runtime styles:** two components ship styles (`fireworks-stage`, `static-skyline`), which Angular injects as `<style>` elements at runtime. Forms inject one more (`createAnimationStyle`). Templates carry static `style="…"` attributes (`timeline.ts:85`, `player-page.html:199`), and Angular writes those with `setAttribute('style', …)`. All of these need `style-src 'unsafe-inline'` or a nonce. Pixi's own style writes are CSSOM (`el.style.x`, `cssText`), which CSP doesn't govern.
- **No workers, blob: or data: URLs on our paths.** The glow texture is `Texture.from(canvas)`. Pixi's workers belong to `Assets`/compressed textures, which we don't use. `styles-*.css` has no `url(`. The only network calls are same-origin `fetch` (Angular `HttpClient`). The policy with `worker-src 'none'`, `img-src 'self'` and `connect-src 'self'` measured clean.

### 2. Decisions on Mario's four findings

1. **Inline `<style>` and `<script>` in index.html: turn `inlineCritical` off.** Hashes are rejected: the critical-CSS hash changes on every build, and the header would have to be regenerated from the build output. `security.autoCsp` is rejected: it emits a second, `<meta>`-delivered policy with `'strict-dynamic'` and its own inline loader script, it does nothing for styles, and a meta policy can't carry `frame-ancestors`, so we'd be reasoning about two policies to get less than `script-src 'self'` gives with no inline script at all. Cost: `styles-*.css` (24.6 KB) becomes a normal render-blocking stylesheet, one same-origin round trip on first load and immutable-cached after that.
2. **Pixi: no `'unsafe-eval'`.** Import `pixi.js/unsafe-eval`. Measured above.
3. **The share-code GET is `private, no-cache` with the ETag; every other /api response stays `no-store`.** `no-store` plus a 304 path is incoherent: with nothing stored, the browser never sends `If-None-Match`. `private` keeps share codes out of shared caches (the edge and proxies), and `no-cache` makes every view revalidate, so a PUT is seen on the next load (OQ3). The ETag reveals nothing new, because `updatedAt` is already in the body.
4. **Static files before routing.** The security headers come from one `OnStarting` middleware at step 6a, which covers static files, the fallback, /api, health and error responses with one copy. Cache-Control comes from one shared `StaticFileOptions.OnPrepareResponse`, passed to both `UseStaticFiles` and `MapFallbackToFile`, plus the /api default and one controller override. That makes two places, each the only writer for its class (§4).

### 3. The CSP (enforced, not report-only; one policy on every response)

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
```

- `script-src 'self'`: no `'unsafe-inline'`, no `'unsafe-eval'`, no `'wasm-unsafe-eval'`, no hashes, no nonces.
- `style-src 'unsafe-inline'` is an **accepted residual** (question 1 for Skyler). CSS injection needs markup injection, and C1/C2 ban every markup sink app-wide (`unsafe-sinks.spec.ts`, 22 of 22 passing today). Strict styles would need a per-request nonce in index.html (which turns static serving into templating), `ngCspNonce`, and the two static `style=` attributes rewritten as `[style.x]` bindings.
- No `font-src`, `media-src`, `manifest-src` or `frame-src`: `default-src 'none'` blocks them, and nothing uses them.
- No `upgrade-insecure-requests`: every URL is relative, and HSTS covers the transport.
- No `report-uri`/`report-to`: a reporting endpoint would be another anonymous write surface. Violations are found by the Playwright check.
- Adding to any directive (for example `data:` in `img-src` if C1 finds one in Firefox or WebKit) needs the violation as evidence and a line in this record. Never widen silently.

### 4. Header set per response class

**Site-wide on every app-pipeline response** (all classes in the table, set in `OnStarting`, overwriting):
`Content-Security-Policy` (§3) · `X-Content-Type-Options: nosniff` · `Referrer-Policy: same-origin` · `X-Frame-Options: DENY` · `Cross-Origin-Opener-Policy: same-origin` · `Cross-Origin-Resource-Policy: same-origin` · `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` · no `Server` header.
`Strict-Transport-Security: max-age=31536000` is sent only when `Request.IsHttps`, after forwarded headers (no `includeSubDomains`, no `preload`).

| Class | Example | Status | Cache-Control | Also |
|---|---|---|---|---|
| Hashed bundle | `/main-*.js`, `/chunk-*.js`, `/styles-*.css` (`^/(?:main\|chunk\|styles\|polyfills)-[A-Za-z0-9_-]{8}\.(?:js\|css)$`; note `chunk--30TBvoS.js`) | 200/304 | `public, max-age=31536000, immutable` | ETag and Last-Modified kept |
| index.html | `/`, `/index.html` | 200/304 | `no-cache` | ETag kept, so revalidation is a 304 |
| SPA fallback | `/s/<code>`, `/c/<code>`, `/show`, `/mine`, `/health/ready/x`, `/s/a.b` after P7-S7 | 200/304 | `no-cache` | same file, same options |
| Other static | `/favicon.svg`, `/3rdpartylicenses.txt` | 200/304 | `no-cache` | |
| API JSON | `api/me`, `api/client-config`, `api/me/creations`, writes, every 4xx/5xx under `/api` | any | `no-store` | |
| Share-code GET | `GET api/creations/{code}` | 200, 304 | `private, no-cache` | `ETag: "<updatedAt>"` |
| Share-code GET errors | same route | 404/429/5xx | `no-store` | |
| Health | `/health/live`, `/health/ready` | 200/503 | framework `no-store, no-cache` (keep) | text/plain |
| Everything else | static miss `/nope.js`, `/chunk-AAAAAAAA.js`, 405 on a deep link | any | `no-store` | |
| Kestrel-generated | malformed request 400, 431 | 400/431 | none | Accepted: empty body and `Connection: close`; only `AddServerHeader=false` reaches it |

### 5. Pipeline-edge verdicts

- **`/health/ready`: must be mapped (P7-S6).** Today a monitor pointed at it passes forever on index.html.
- **Dotted last segment under `/s/` and `/c/`: fix, don't accept (P7-S7).** Serving index.html there is safe, because C4 (the share-code regex before any URL is built) is verified for `/s/..%2Fme`. The app's not-found page replaces a browser error page. Dotted paths elsewhere stay a bare 404, now with headers and `no-store` (accepted).
- **Chunked `Connection: close`: still wanted (P7-S8).** It costs nothing for real clients, because browsers never send a chunked body over HTTP/1.1. Behind Railway it protects the edge's upstream pool, since `Connection` is hop-by-hop **[R]**.

### 6. Requirements

**Server (Bowser, B1).** Each check runs against `docker build` and `docker run` on a fresh database, or a clean publish (skill `probe-the-published-build`).

- **P7-S1. One site-wide header middleware** registered at step 6a (before `UseExceptionHandler` and `UseStaticFiles`). It sets the §4 site-wide headers in `OnStarting`, overwriting, on every response. *Verify:* `curl -sD-` on one example per §4 row, including a 413 (writes on, 300 KB declared body), a 429 (burst the read bucket), a forced 500 (drop the database, skill step 5), a 405 and a 304. Every header matches byte for byte. *Negative control:* remove the registration, and the header test fails on every class.
- **P7-S2. `options.AddServerHeader = false` in `KestrelLimits.Apply`**, so the harnesses get it too. *Verify:* no `Server:` on any class, including the 431 from a raw socket sending a 40 KB header and the 400 from `Host: a b`.
- **P7-S3. HSTS only over HTTPS, outside Development.** *Verify locally:* `curl -H 'X-Forwarded-Proto: https' -H 'Host: fireworks.example' /` has the header. Without the proto header it doesn't (with cleared proxy lists, loopback is trusted as the forwarder). If `UseHsts` is used, its default `ExcludedHosts` hides the header for localhost, so the non-localhost `Host` is needed. Through Railway's edge: **[R] DEFERRED.**
- **P7-S4. Cache-Control per §4, with one writer per class.** One `StaticFileOptions` instance (`OnPrepareResponse` matches the served file name: the hashed regex gives immutable, anything else gives `no-cache`) passed to `UseStaticFiles` and every `MapFallbackToFile`. `ApiResponseHeaders` sets `no-store` **only if Cache-Control is unset** (today it overwrites, which would erase the share-code value). The site-wide middleware defaults to `no-store` when nothing set it. *Verify:* the §4 table by curl. *Negative controls:* remove the immutable rule; restore the overwrite in `ApiResponseHeaders` (the share-code GET goes back to `no-store`); `/chunk-AAAAAAAA.js` (404) must not be immutable. `OnPrepareResponse` runs only when a file is served, and the test pins that.
- **P7-S5. ETag and 304 on `GET api/creations/{code}`.** A strong ETag: `"` + the body's `updatedAt` string exactly as serialized + `"`. `If-None-Match` uses weak comparison, accepts a comma list and `*`, and returns 304 with no body, the same `ETag`, `private, no-cache` and the site-wide headers. Still rate-limited. `If-Match` is ignored (Phase 8). *Verify (writes-on instance):* 200 gives tag T. The same request with `If-None-Match: T` gives 304 and 0 bytes. A PUT, then `If-None-Match: T`, gives 200 with a new tag. `W/T` gives 304. A garbage tag gives 200. *Exact ledger (Toad's rule):* enumerate every `/api` endpoint and status. Only this action's 200 and 304 may have a Cache-Control other than `no-store`.
- **P7-S6. `/health/ready`:** a database check (`Database.CanConnectAsync`) tagged `ready`, with a timeout of 3 s or less. `/health/live`'s predicate excludes it, because liveness stays dependency-free (Railway's probe, and a database blip must not restart the app). The body is text/plain with the status word only (no exception, no connection string). It returns 503 when unhealthy and sits under `ReadPolicy` (one DB round trip per request, partitioned by IP). *Verify:* 200 `Healthy` text/plain. Then `DROP DATABASE … WITH (FORCE)` on the instance's throwaway database: ready gives 503 `Unhealthy` text/plain, and live still gives 200. Never stop the shared `fireworks-postgres` container. *Negative control:* unmap it, and the test sees text/html and fails.
- **P7-S7. `/s/{**rest}` and `/c/{**rest}` fall back to index.html** with the shared options. *Verify:* `/c/..%2Fme`, `/s/..%2Fme` and `/s/a.b` give 200 text/html, `no-cache` and the headers. Playwright shows the app's not-found page and makes no API call (C4). `/nope.js` stays 404 with `no-store`.
- **P7-S8. `Connection: close` also when `ContentLength is null && IHttpRequestBodyDetectionFeature.CanHaveBody`** on `/api`. *Verify:* one Python `http.client` connection sends a chunked 300 KB POST `api/creations` (writes on: 413; writes off: 403). The response has `Connection: close`, and the next request on the same object succeeds. *Mutant:* without the branch, the second request fails (`RemoteDisconnected`/reset). An under-limit chunked write also gets `close`; that is accepted. Through the edge: **[R] DEFERRED** (C18/S5).
- **P7-S9. Never add response compression or request decompression** on the app (existing S2/S4 rule, restated because header work tends to bring in `UseResponseCompression`).

**Bundle (Luigi, B2).**

- **P7-S10. `import 'pixi.js/unsafe-eval';` as the first import of `engine/render/pixi-renderer.ts`.** It stays inside the engine boundary and in the lazy chunk (`engine-boundary.spec.ts` allows `pixi.js/*` there). Add a structure assertion that the import is present, as a browser-free negative control. *Verify:* P7-S13. *Negative control:* remove the import, and the probe violation `script-src eval` appears and the stage fails to start.
- **P7-S11. Production config:** `"optimization": { "scripts": true, "styles": { "minify": true, "inlineCritical": false }, "fonts": true }`. *Verify:* the built `index.html` has no `<script>` without `src`, no `<style`, no `data-beasties`, and a plain `<link rel="stylesheet">`. *Negative control:* restore `inlineCritical`, and the inline-script violation appears.
- **P7-S12. No `security.autoCsp`, no hashes, no nonces, no new inline `<script>` in `src/index.html`.**
- **P7-S13. Zero-violation check, on the built image with the real header (not route-injected):** Playwright in Chromium, Firefox and WebKit. **Superseded in part by plan §7.5 (Skyler, 2026-11-15, amended) on 2026-11-15:** regular runs and gates use Chromium only; Firefox and WebKit move to the daily run (post-Phase-7 interlude) and are not a gate criterion until it exists. An init script records `securitypolicyviolation` events, and console CSP messages are captured. Run it while the designer auto-plays, the builder seeks, `/c/<show>` loads, a shell and a show play on `/s/`, `/mine` lists (writes on), `/status` loads, and the not-found pages show. Zero violations, zero page errors, and a stage canvas on each stage page. The test's own negative control: serve with `script-src 'none'` (or omit P7-S10 in a scratch build), and the counter is nonzero.
- **P7-S14. Show JSON Apply (new in Phase 7) is a new untrusted-input path.** It goes only through `openShow`. Toad's `showEntryViolations()` ledger gains exactly that caller, by a reviewed change. Issue paths with shell names are isolated (C3), and everything renders as text only (C1).
- **P7-S15. Boo F3 closed:** one `shellOf(show, key)` helper with `Object.hasOwn`, which replaces the bare `shells[...]` lookups. Still open today: `show-builder-page.ts:287,289,364,666,742,827`, `show-builder-page.html:103,163`, `show-builder.store.ts:358,552`, `player-page.ts:166`, `show-edit.ts:113,216`. Add a structure rule that bans `shells[` outside the helper (exact ledger), plus Toad's round-trip spec with keys `constructor`, `toString` and `valueOf`.

**Standing and Phase 8 carries.**

- **P7-S16. No third-party origins (C20).** The CSP now enforces it. Any external origin needs a record first.
- **P7-S17. Interim exposure unchanged.** Writes are off in production. The C17 test-mode banner is what states the risk wherever a test-window URL is shared. `frame-ancestors 'none'` and `X-Frame-Options` close clickjacking on `/mine` Delete during windows.
- **P7-S18 (Phase 8, Yoshi and Bowser).** Once `isOwner` and `remixedFrom` vary by viewer, the share-code GET must send `Vary: Cookie` (or vary on whatever carries identity). Otherwise a 304 replays one viewer's cached `isOwner`/`remixedFrom` to another on a shared browser. This keeps the `"<updatedAt>"` ETag ruling intact.

### 7. Re-checks

- **Toad's F2 closure (`unsafe-sinks.spec.ts`, rule 11): holds.** The run is 22 of 22 across both specs. In my probes of 21 new spellings, C2 caught `'/s/' + p.name`, `routerLink="/s/{{ p.name }}"`, `[ROUTERLINK]`, `[attr.HREF]`, `[routerLink]="[p.name]"`, `.concat(...)`, `[src]` and `[action]`. `CODE_EXPR` accepts `p.name.code` and `cue.code`, but the exact `SHIPPED_URL_BINDINGS` ledger fails on any new binding whatever its shape. That ledger is what closes C2. C14 misses `router['navigateByUrl'](x)`, `navigateByUrl?.(x)`, `top.location = x`, `location.search = x` and a bare `open(x)`. The C2 list omits `ping`. All of these need deliberate obfuscation, so they're info for Toad, not a reopening.
- **Toad's F5 closure (`designer-structure.spec.ts`, rule 12): holds.** The real callers match the ledger exactly: `openShow` in `open-creation.ts:82` and `show-draft.ts:56,73`; `normalizeShow` in `open.ts`, `validate.ts` and `show-save.ts:71`.

## Why

- **Script injection is the threat a CSP buys down here.** `script-src 'self'` with no inline script and no eval is attainable at about 1.6 KB gzip and one config flag, and I measured it at zero violations on every surface in Chromium. Strict styles cost a templating server and template rewrites, and protect only against a markup injection that C1 already bans.
- **One writer per header class** removes the overwrite hazard that today's `ApiResponseHeaders` would create for the ETag. It also follows Toad's exact-ledger rule: a test can enumerate who may relax caching.
- Every check runs on the local image, as Skyler ruled. Edge-only behaviour (HSTS through TLS, hop-by-hop `Connection`, edge rewriting) is marked [R].

## Boundary

- Binds Phase 7 B1 and B2, and C1/C3 verification. It does not decide Phase 8 auth, cookies or CSRF beyond the P7-S18 pointer.
- Widening any CSP directive, or relaxing any /api cache rule beyond P7-S5, needs a new record with evidence.
- `style-src 'unsafe-inline'` holds only while no HTML-rendering path exists. If one is added, this record must be reopened first.
- Not decided here: copy for the not-found page (Rosalina), the CPU cost of the Pixi polyfills (end-of-project review), and caps (A3).

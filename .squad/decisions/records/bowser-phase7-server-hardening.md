# Phase 7 B1: server hardening (headers, caching, ETag, health, pipeline edges, operations)

**Date:** 2026-11-15 · **Status:** proposed · **Author:** Bowser · **Plan:** §Phase 7 7.3 B1 · **Implements:** `boo-phase7-security-requirements.md` P7-S1 to S9, `yoshi-phase7-architecture-rulings.md` §4 and the §2 README sentence, schema.md §2.1.1. Commits not authorized.

## What

1. **Three shared pipeline pieces, called by Program.cs and by `FireworksApiHarness`** (so a test host binds exactly what the app binds):
   - `Services/ResponseHeaders.cs`, `UseFireworksResponseHeaders()` at step 6a. This is the only header middleware. It **replaces `ApiResponseHeaders.cs`, which is deleted.** In `OnStarting` it sets Boo's §4 site-wide set (overwriting), HSTS when `!IsDevelopment && Request.IsHttps`, and `Cache-Control: no-store` **only when unset**. On `/api` it sends `Connection: close` for a declared length over the limit, or for `ContentLength is null && CanHaveBody` (chunked).
   - `Services/SpaHosting.cs`: `CreateStaticFileOptions()` gives one instance, passed to `UseFireworksStaticFiles` (step 9) and `MapFireworksSpaFallback` (step 16). `OnPrepareResponse` keys on `File.Name`. The `HashedBundle` regex gives immutable; anything else gives `no-cache`. The fallbacks are `/s/{**rest}`, `/c/{**rest}` and the default.
   - `Services/Health/HealthEndpoints.cs`: `AddFireworksHealthChecks()` and `MapFireworksHealthChecks()`. Live uses `Predicate = _ => false` and is exempt from rate limiting. Ready runs `DatabaseReadyHealthCheck` (tag `ready`, 3 s timeout) and is read-limited.
2. **Who may write Cache-Control.** Exactly four writers: the shared `StaticFileOptions`, `CreationsController.Get` (`ShareCodeGetCacheControl = "private, no-cache"` on 200 and 304 only), the health-check framework (`no-store, no-cache`), and the middleware's `no-store` default. A new writer needs a ledger row in `Hardening/ApiCacheControlLedgerTests`. **Superseded in part by `bowser-phase7-review-fixes.md` (Boo F1) on 2026-11-15:** there are five writers. The exception handler is the fifth, and a handled exception normalizes to `no-store`.
3. **The ETag** is `CreationsController.EntityTagFor(updatedAt, MVC JsonOptions)`, which is `JsonSerializer.SerializeToElement(...).GetString()` inside quotes. It is set on the GET, POST, PUT and remix. For `If-None-Match` it uses `EntityTagHeaderValue.TryParseList` plus a weak `Compare` or `Any`. A header that doesn't parse matches nothing, so the answer is 200. The 304 comes after the lookup, so a 404 stays a 404, and after the rate limiter. If-Match is not read.
4. **`AddServerHeader = false` lives in `KestrelLimits.Apply`** (it is the only switch that reaches Kestrel's own 400 and 431).
5. **The readiness timeout is enforced in the check, not trusted to Npgsql.** I measured this: against a server that accepts TCP and never answers, `CanConnectAsync(token)` ignored the cancelled token and took the connection string's full `Timeout` (30 s). The registration's 3 s timeout alone does nothing in that case. So the probe runs on its **own** `new FireworksDbContext(options)` inside `Task.Run`, and the check `await probe.WaitAsync(token)`. On timeout the orphaned probe finishes and disposes its own context within the connection timeout. The request's scoped context is never left running past its scope.
6. **The CSP is a constant.** `UseFireworksResponseHeaders(string csp = ContentSecurityPolicy)` takes an override for tests only, and Program.cs never passes one. Boo's P7-S13 negative control on the image therefore uses a scratch build (omit P7-S10), or a scratch image with the constant mutated. There is no config knob.
7. **README** (§Health checks, §Response headers and caching, §Backups and restore, §Takedown runbook, the late-config sentence in §Playback tuning, the ETag and caching bullets in §Creations API). "There are no backups until Phase 7" is replaced. The restore was rehearsed on the compose DB: 10 creations and the same `max(updated_at)`, 1 user and 2 migrations, before and after.

## Why

- One copy per header class removes the overwrite hazard: the old `/api` middleware would have erased the share-code value. It also gives Toad's exact ledger a closed set of writers.
- Shared extension methods stop the harness from drifting away from Program.cs. The gated `Real_program_serves_the_phase7_headers_caching_etag_and_readiness` covers Program.cs's own calls. The mutants M1, M15, M16 and M17 below each removed one Program.cs call, and that test killed each of them.
- Item 5: a readiness probe that hangs for the connection timeout defeats Boo's "≤ 3 s" and holds a monitor's request open.

**Mutants** (rsync copy `scratchpad/bowser-b1-mut`, script `scratchpad/bowser-b1-mutants.py`): every one is killed except M5b.
- **M1** removes the Program.cs header middleware. Killed by the gated test.
- **M2** keeps `Server`. Killed by 16 tests.
- **M3** sends HSTS on http. Killed by 12.
- **M4** puts back the `/api` no-store overwrite. Killed by 11 (the ledger and ETag tests).
- **M5** drops the immutable branch. Killed by 6.
- **M5b** keys on the request path. **It survives and is equivalent**: every fallback needs the `/s/` or `/c/` prefix or skips dotted names, so a request path and its served file never disagree about being hashed.
- **M6** drops the chunked branch. Killed by 2.
- **M7** builds the token with `ToString("O")`. M8 uses strong comparison. M9 sends a 304 without Cache-Control. M9b uses a weak tag. M9c answers 304 before the lookup. M9d leaves the ETag off PUT.
- **M10** unmaps ready. M11 lets live run the DB check. M12 trusts the timeout to the provider (30 s). M12b stops rate-limiting ready.
- **M13** drops the dotted fallbacks. M14 uses the fallback without the shared options.
- **M15, M16 and M17** are Program.cs-only (the default fallback, static files without options, plain `AddHealthChecks`). Each is killed by the gated test.

## Boundary

- **[R] DEFERRED:** HSTS through TLS at Railway's edge; the hop-by-hop `Connection: close` through the edge (C18/S5); every header and cache check repeated through the edge; Railway's scheduled backups and a listed backup.
- Accepted as Boo ruled: a chunked write under the limit is closed too. Kestrel's own 400 and 431 carry no security headers (only `AddServerHeader` reaches them).
- **Phase 8 (P7-S18):** when `isOwner` varies by viewer, add `Vary` on whatever carries identity to the share-code GET, plus the `"<updatedAt>-p"` non-owner tag (schema.md §2.1.1). If-Match and 412 still wait on §11.4's trigger.
- Widening the CSP or relaxing any `/api` cache rule needs a new record (Boo's boundary). Never add response compression or request decompression.

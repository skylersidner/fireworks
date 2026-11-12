# Phase 1 pipeline security review: conditions carried into Phase 4
**By:** Boo (Web Security Specialist) · 2026-11-12 · Phase 1 security-review

## What
1. **The write gate is `ICurrentUser.CanWrite`, checked in the service layer** of every create, update, delete and remix path. Phase 4 must not rely on the client hiding Save, or only on a controller attribute. Back it with a test that enumerates every non-GET endpoint from `EndpointDataSource` and asserts each returns 403 when `CanWrite` is false. The set comes from the router, not a hand-written list (`koopa-derive-sets-from-the-defining-artifact.md`). `CanWrite` must imply `UserId != null`, and services check both.
2. **Owner is always `ICurrentUser.UserId`**, never a request field. Updates and deletes filter on `id AND owner_user_id` in the same query, and a creation you don't own returns 404, not 403.
3. **Rate-limit partitioning before Phase 8 is by client IP.** Every visitor resolves to the same default `UserId`, so a user-keyed partition is one global bucket that any single client can drain. Partition by user only when `IsAuthenticated`.
4. **`ForwardedHeadersOptions.ForwardLimit` stays 1** (the default) while KnownIPNetworks and KnownProxies are cleared. It makes the middleware take the rightmost X-Forwarded-For entry, the one the edge appended, and not a value the client supplied. Setting it to null or raising it re-opens spoofing. Before the Phase 4 limiter relies on the client address, verify on a real Railway deploy whether the edge appends to or overwrites a client-sent X-Forwarded-For.
5. `/health/live` is excluded from the rate limiter, so Railway's probe is never throttled.

## Why
- §3.4 promises that Phase 8 is a one-registration swap. That only holds if every write path asks the same interface, and an enumerated test is what catches a forgotten endpoint.
- Under the interim identity, "per-user" means "global", which turns a rate limit into a denial-of-service lever.
- With the proxy lists cleared, ForwardLimit is the only thing standing between a client-asserted X-Forwarded-For and `RemoteIpAddress`.

## Boundary
- Items 1–4 bind Phase 4 (Bowser implements, Toad tests). Phase 8 revisits item 3 (user first, then IP) and may tighten item 4 to a real KnownProxies entry.
- Open question for Skyler, not decided here: in production with writes off, should `GET` "My creations" (`/mine`) return the default user's list to every visitor? Doing so turns every share code saved during a test window into a public gallery, which contradicts §3.4 and OQ4.

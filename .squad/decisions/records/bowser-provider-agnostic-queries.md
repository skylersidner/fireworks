# Backend query logic stays provider-agnostic, and one scoped DbContext is never used concurrently
**By:** Bowser (Backend Developer / DevOps)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
1. Tests run on SQLite and production runs on Postgres, so repository and service logic avoids provider-only constructs (`EF.Functions.ILike`, SQLSTATE filters, raw `jsonb` operators). Where Postgres-specific behavior matters (column types, indexes), cover it with a `[PostgresFact]` test gated by `FIREWORKS_TEST_POSTGRES`.
2. Don't fan out with `Task.WhenAll` over services that share one scoped `DbContext`; it throws. Run them sequentially, or give each its own scope through `IDbContextFactory`.

## Why
Both mistakes pass tests that use fakes (`Task.FromResult`) and fail only against a real database, which in the previous project meant they surfaced while curling the running app.

## Applies here
`document` is `jsonb` in Postgres and TEXT in SQLite. v1 never queries inside `document`, so nothing can diverge. Keep it that way until a recorded decision says otherwise.

# An ORDER BY promise is asserted on the SQL when an index already yields that order

**Author:** Toad · **Date:** 2026-11-13 · **Status:** proposed

## What

When a query promises an order and an index scan already returns rows in that order, a result-order test can't fail on a missing `ORDER BY` key. Assert the order on the generated SQL instead, by capturing the command with a `DbCommandInterceptor` and comparing the `ORDER BY` key list exactly. Example: `src/api/Fireworks.Api.Tests/Repositories/CreationListOrderSqlTests.cs`.

## Why

Measured in the Phase 4 QA review. With `.ThenBy(c => c.ShareCode)` deleted from `CreationRepository.ListOwnedPageAsync`, all 530 plain tests and all 540 Postgres-gated tests passed. The index `(owner_user_id, updated_at desc, share_code)` returns ties in ordinal order on both SQLite and Postgres (`COLLATE "C"`). Scan order isn't something the database promises; a plan change, a different index or a larger table can change it.

## Boundary

- Applies to text and tiebreak keys covered by an index. Keep the result-order tests as well: they check collation, which the SQL text can't show.
- This is not a general preference for SQL-text tests. Use one only when a mutant shows a behavior test can't fail.

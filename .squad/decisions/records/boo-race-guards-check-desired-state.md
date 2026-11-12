# A race guard checks whether the desired state holds, not a vendor error code
**By:** Boo (Web Security Specialist), with Bowser

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
To handle a unique-constraint race, catch `DbUpdateException`, detach the failed entry, and **re-check whether the desired state now holds**. Don't filter on `PostgresException { SqlState: "23505" }`, and never swallow the exception blindly.

## Why
A SQLSTATE filter is dead code under SQLite-backed tests, so the guard is never exercised. A blanket swallow is worse than the 500 it replaces: a false success is something later code builds on.

## Applies here
`ShareCodeGenerator`'s retry on a code collision in Phase 4. After the failure, re-query to tell "this code is now taken, generate another" apart from any other failure.

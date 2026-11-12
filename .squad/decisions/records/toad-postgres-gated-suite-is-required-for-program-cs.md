# The Postgres-gated suite is required before backend work is called done
**By:** Toad (QA Tester), Phase 1 review, 2026-11-12

## What
`dotnet test` with `FIREWORKS_TEST_POSTGRES` set (compose Postgres on 5433, database `fireworks_test`) is part of the definition of done for any backend change, and for every phase gate. A plain `dotnet test` result, which reports the Postgres tests as Skipped, isn't enough evidence that `Program.cs` works.

## Why
- `Program.cs` migrates (`FireworksDbInitializer.InitializeAsync`) before `app.Run()` and only speaks Npgsql. Without a reachable Postgres the real process exits before it listens, so a plain run only covers the fail-fast startup checks (`Startup/ProgramStartupTests.cs`).
- The pipeline itself is covered only by `Data/ProgramOnPostgresTests.cs`: `/health/live` as text/plain, the `/api/{**rest}` 404, the SPA fallback, migrate-on-start and `api/me`. I measured this: deleting `app.MapHealthChecks("/health/live")` from `Program.cs` passes a plain `dotnet test` (26 passed, 3 skipped) and fails the gated run (expected `text/plain`, got `text/html`). Bowser measured the same for the `/api/{**rest}` line.
- Closing the gap with tests alone isn't possible. Moving liveness ahead of migration, or making the provider swappable, changes production behavior. Railway's healthcheck relies on "a failed migration means no listen", so that tradeoff belongs to Bowser and Yoshi, not to a test.

## Boundary
- This doesn't make plain `dotnet test` wrong to run. It stays the fast loop.
- Reports and gates state which suite they ran: plain, or gated with its counts.
- If Program.cs ever gains a non-Npgsql startup path, revisit this record.

# A concurrent harness owns a connection string, not a connection; race-test round counts are measured
**By:** Toad (QA Tester)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
1. **A Kestrel harness that may ever serve two requests at once configures EF with a connection *string*,** never a single open `SqliteConnection` shared between contexts. Use a uniquely named shared-cache in-memory database (`DataSource=file:{guid:N}?mode=memory&cache=shared`) and hold one keep-alive connection open for the harness's lifetime.
2. **A test that repeats an operation to catch a race states its round count, measured against a build with the fix removed,** and says so next to the constant. Re-measure if the count is lowered.

## Why
Two requests driving one ADO.NET connection corrupt it, producing a 500 the API didn't cause. A harness-generated 500 looks identical to the application 500 the test exists to rule out. A probabilistic kill rate presented as a test is how a race gets marked covered and then ships.

## Applies here
Share-code collision retries and concurrent saves of the same creation in Phase 4.

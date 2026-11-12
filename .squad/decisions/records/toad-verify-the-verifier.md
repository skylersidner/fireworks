# Every check has a recorded negative control
**By:** Toad (QA Tester)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
Each verification command (`dotnet build`, `dotnet test`, `npm test`, `npm run typecheck`) is shown to **fail** on a deliberate, recorded break before its green result is trusted. The README keeps a table: command, the break used, the failure observed.

## Why
A check that has never been seen failing may not be checking anything. Common traps: a solution-style root `tsconfig.json` that type-checks nothing; a test project not referenced by the solution; a test filter that matches zero tests. Each one reports success.

## Boundary
Record the negative control once per check, and again whenever the check's configuration changes. It isn't needed for each individual test; for important tests, see the mutant rules in the other Toad records.

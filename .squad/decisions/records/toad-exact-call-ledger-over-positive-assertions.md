# Flows that can issue two calls for one intention get an exact call ledger
**By:** Toad (QA Tester)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
When one user action fans out into a batch of requests, the test asserts the **complete, sorted multiset** of calls the batch issues. It does not assert `toContain(the right one)` plus a negative check for one wrong one.

## Why
- Two positive assertions plus one negative still miss every call nobody thought to name. A **duplicate** call, the bug that lives in that blind spot, passes `toContain`. In the previous project a duplicate request failed a whole multi-step submit, and only an exact ledger could see it.
- An exact ledger needs nobody to anticipate the wrong call. A duplicate is an extra array element and fails the comparison.
- It costs almost nothing: the recorder is a few lines.

## How to make it honest
1. **Record at `subscribe`, not when the method is called:** `defer(() => { sent.push(...); return result(); })`. `HttpClient` observables are cold, so recording at call time counts observables that were never subscribed and over-reports.
2. **Sort both sides; never deduplicate either.** `forkJoin` order isn't part of the contract. Multiplicity is.

## Boundary
Use it where two code paths can reach the same endpoint, for example save versus save-as-new versus remix in Phase 5. A single-call flow gains nothing from it.

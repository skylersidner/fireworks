# Fake repositories mirror real return semantics; predicates get a real-database test
**By:** Toad (QA Tester)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
1. **A hand-written fake never hardcodes a success return** for a method whose real implementation reports how much work it did (row counts, found/not found). Fakes keep real backing state and derive their returns from it.
2. **A repository *predicate* is tested against the real repository and a real database; a service *branch* is tested against a fake.** A fake's predicate is usually copied from the implementation, so it agrees with itself and can't catch a bug in it.

## Why
In the previous project a fake delete returned `1` unconditionally, which made every round-trip assertion pass against a fake that deleted nothing. Separately, swapping two same-typed `Guid` arguments in real predicates left every service test green; only real-repository tests caught it. A test that passes against a broken implementation is worse than none, because it gets counted as coverage.

## Applies here
Owner checks (`owner_user_id == currentUser.UserId`), share-code lookups and the remix lineage are all predicates over same-typed IDs. Test them against the real repository on SQLite, and test ownership with two distinct user IDs.

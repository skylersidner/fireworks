# When you need a set, ask the artifact that defines it
**By:** Koopa (Retrospective Analyst)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
Counts and sets (files changed, call sites, records deleted, tests affected) are derived from the source that defines them (`git show --diff-filter=D <sha>`, `grep -o … | wc -l`, the compiler, the test runner), never from a filename pattern or a document that summarizes them.

## Why
In the previous project, a recovery effort found losses with a glob that encoded what the searcher expected. One deleted record wasn't named the way the glob assumed, so it stayed lost. A summary standing in for the thing it summarizes is the same failure in both directions. Also: `grep -c` counts matching *lines*, not matches.

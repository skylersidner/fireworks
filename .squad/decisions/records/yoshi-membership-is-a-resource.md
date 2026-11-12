# Membership is its own resource, never a field in a whole-object upsert body
**By:** Yoshi (Architect)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
A many-to-many membership (X belongs to Y) is modeled as its own resource with its own add and remove endpoints, never as a collection inside an `Upsert*Request`.

## Why
With whole-collection PUT semantics, the next save from a client that didn't load the collection unlinks everything.

## Applies here
Not yet: Phase 6 shows **embed copies** of shells rather than referencing them (plan §3.3), so there's no membership. If a show ever references a saved shell by share code, this rule applies.

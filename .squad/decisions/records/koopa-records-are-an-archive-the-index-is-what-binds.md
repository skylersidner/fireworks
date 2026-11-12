# Records are an archive; the index lists what binds; superseded records stay, marked
**By:** Koopa (Retrospective Analyst)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
- `.squad/decisions/records/` is an append-only archive. Agents write records there and never edit `.squad/decisions/README.md`.
- A decision is **standing** only when it's listed in the README index. Promotion is a deliberate act and Skyler's call. When in doubt, don't promote.
- Superseded records **stay**, marked in place with what superseded them. Nothing is deleted or merged into a summary.

## Why
In the previous project, a "tidy-up" compressed several records into a short summary and deleted the originals. One decision disappeared entirely and stayed invisible for months. A record nothing cites fails silently when it's deleted.

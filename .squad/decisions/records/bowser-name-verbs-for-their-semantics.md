# Name methods for what they do; same HTTP shape can mean opposite things
**By:** Bowser (Backend Developer / DevOps)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
Two endpoints with the same HTTP shape can have opposite semantics: a `PUT` that *adds* versus one that *replaces* or *moves*. Name the service method for its effect (`RemixAsync`, `ReplaceDocumentAsync`, `MoveTo…`), not after the HTTP verb or a vague "link" or "update".

## Why
In the previous project, a generically named verb silently did nothing when a design assumed it could move an entity, because the request record had no field for it. The design docs agreed with each other and were both wrong. Check the request record: it's what the API can actually accept.

# A write that partly fails is a success with a caveat, never an error
**By:** Rosalina (Designer)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
When the primary entity is saved but a follow-up step fails, show a success with a clear caveat about what didn't happen. Don't show an error state.

## Why
An error state leaves the user on a form whose only action creates a duplicate. Copy hedges honestly: from a failed batch you usually know *that one* call failed, not that all did.

## Applies here
For example: the creation saved but copying the share link to the clipboard failed. Say "Saved. Couldn't copy the link — copy it from the address below."

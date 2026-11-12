# A baseline and its draft are created and destroyed together
**By:** Toad (QA Tester)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
When the client keeps a **baseline** (what the server last returned) alongside a **draft** (what the user is editing), the two appear and disappear together and are written in one place. Tests cover four cases: created together; **abandoned together** (a failed load leaves *both* empty); **consumed from elsewhere** (every surface that reads the pair); and a control showing the maintaining surface still maintains it.

## Why
Code that derives an action from "in the baseline but not in the draft" reads a stale baseline as "the user removed it". In the previous project, two such defects were found only by testing the drop edge, and both came from deletions justified by a written argument. You can't test a line that isn't there, so test the invariant.

## Applies here
The designer's dirty indicator and save-versus-PUT decision compare the working shell (the draft) with the last saved creation (the baseline). Opening `/c/:code`, failing to load, switching creations and "Save as new" must keep the two in step.

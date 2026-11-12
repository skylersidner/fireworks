# A review brief names a code artifact and the question it must settle
**By:** Koopa (Retrospective Analyst), with Peach (Product Owner)

> **Carried over** on 2026-11-12 from monster-of-the-week-net-angular, generalized. The evidence that produced the lesson was in that project; the rule is what carries over.

## What
Every review pass (architecture re-review, acceptance, security, QA) gets a brief naming the **code artifacts** its reviewer must read, and **the claim each has to settle**. At planning time, the phase plan lists that feature's truth-holding artifacts. Reviewing design documents against each other is still worth doing for internal consistency, but it doesn't count as defect discovery.

## Why
In one measured feature, about fifty substantive findings came from reading code or running mutants, and four came from comparing documents. The decisive defect was one that two design documents **agreed** on, and that agreement is exactly why document review couldn't find it. Agreement between documents isn't evidence.

Peach's companion line: **"Check the payload, not just the entity."** Design docs describe entities; contracts describe payloads, and that's where the gaps are.

## Boundary
Design docs remain valuable for coordination and as a record. The change is only to stop briefing reviewers *at* them and counting the result as coverage. See `.squad/skills/review-brief-surfaces/SKILL.md`.

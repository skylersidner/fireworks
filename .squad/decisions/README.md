# Decisions

**`records/` is the archive. This file is the index of what still binds.**

- **A decision is standing when it's listed below.** If it isn't here, it's history: it explains a past choice and doesn't constrain a new one.
- **Every entry points at its record.** The record holds the reasoning; this file holds one line and a pointer, and should be readable in one sitting.
- **Don't silently contradict anything below.** If you think an entry is wrong, say so explicitly in your output and file a record arguing it.
- **Agents write records, never this file.** Drop new records at `.squad/decisions/records/{agent}-{slug}.md`. Promotion to this index is Skyler's call. When in doubt, don't promote.
- **Superseded records stay in `records/`, marked as superseded.** Nothing is deleted.

> Seeded on 2026-11-12 with general lessons carried over from monster-of-the-week-net-angular. Nothing domain-specific was brought across. Each record says how it applies here.

---

## 1. Process and review

| Decision | Record |
|---|---|
| **A review brief names a code artifact and the claim it must settle.** Agreement between documents isn't evidence. Check the payload, not just the entity. | `koopa-review-briefs-name-a-code-artifact.md` · skill: `.squad/skills/review-brief-surfaces/SKILL.md` |
| **When you need a set, ask the artifact that defines it**, never a pattern or a summary. | `koopa-derive-sets-from-the-defining-artifact.md` |
| **Records are an archive, this index is what binds, and superseded records stay, marked.** | `koopa-records-are-an-archive-the-index-is-what-binds.md` |

## 2. Testing

| Decision | Record |
|---|---|
| **Every check has a recorded negative control** (verify the verifier). | `toad-verify-the-verifier.md` |
| **Assert the complete sorted multiset of calls** wherever two code paths can reach one endpoint. | `toad-exact-call-ledger-over-positive-assertions.md` |
| **A fake repository mirrors the real one's return semantics.** Predicates get a real-database test; branches get a fake. | `toad-fake-repositories-must-mirror-real-return-semantics.md` |
| **Regression checks need an oracle, and test hosts bind exactly what real call sites bind.** After restoring a C# mutant, update its timestamp. | `toad-oracle-and-real-host-shapes.md` |
| **A concurrent harness owns a connection string, not a connection,** and race-test round counts are measured against a mutant. | `toad-api-harness-concurrency-and-measured-round-counts.md` |
| **A baseline and its draft share one lifecycle.** Test the drop edge, not only the create edge. | `toad-a-baseline-and-its-draft-share-one-lifecycle.md` |

## 3. Backend and API shape

| Decision | Record |
|---|---|
| **Query logic stays provider-agnostic** (SQLite tests, Postgres prod), and one scoped `DbContext` is never used concurrently. | `bowser-provider-agnostic-queries.md` |
| **A race guard checks whether the desired state holds,** not a vendor error code. | `boo-race-guards-check-desired-state.md` |
| **Name methods for what they do.** The same HTTP shape can mean opposite things; check the request record. | `bowser-name-verbs-for-their-semantics.md` |
| **Membership is its own resource,** never a collection inside an upsert body. | `yoshi-membership-is-a-resource.md` |

## 4. UX and copy

| Decision | Record |
|---|---|
| **A write that partly fails is a success with a caveat,** never an error. | `rosalina-partial-failure-is-success-with-caveat.md` |

## 5. Project decisions (fireworks)

| Decision | Where |
|---|---|
| **Anonymous play; persistence is owned by a user ID from day one,** resolved through `ICurrentUser`, with a configured default user until Phase 8. | `plans/initial-implementation.md` §3.4 |
| **Shells first, shows later. No public gallery. No CI.** | `plans/initial-implementation.md` §5 |

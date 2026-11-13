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
| **Production writes are off until Phase 8.** `AllowAnonymousWrites` is false in `appsettings.json` and true in Development, switched on in Railway only while testing. `api/me` reports `canWrite`. | plan §3.4, §5 OQ20 |
| **"My creations" follows the write switch before Phase 8:** `GET api/me/creations` returns 403 when `CanWrite` is false, and `/mine` is hidden. Share-code GETs stay public. | plan §3.4, Phase 4, Phase 5 · `records/yoshi-phase1-plan-followups.md` |
| **Stage coordinates follow the prototype:** a fixed 800-unit height, width follows the window, and cue `x` is a fraction of the width. | plan §5 OQ5 |
| **The backend targets .NET 11 (`net11.0`)**, a deliberate departure from the reference's .NET 10, because .NET 11 is what's installed. | plan §2 (.NET row) |
| **Flashing safety ships with each surface.** The designer at `/` auto-plays, with Rosalina's first-visit notice, a start in Manual under reduced motion, and a Reduce flashing toggle, all in 2c. The player gets the same in Phase 5. | plan Phase 2c, Phase 7 |
| **Designer draft exists so state is never lost on navigation.** It keeps the shell, display settings and active tab. Presets and Apply confirm only when they'd replace something the visitor changed (shell, or sky for JSON with sky); display settings and tab never count; app-made changes never set dirty. Links load a working copy of a saved record (Phase 5). Under reduced motion the designer opens in Manual on every load. Held Space fires once. The flashing notice pauses playback until dismissed. Presets and sky-less JSON keep the current sky. | plan Phase 2c, Phase 5 |
| **Performance/fps requirements are benched until the end of the project, tests included.** The concern to re-evaluate is browser CPU load, not visual frame rate. No gate checks fps. | plan Phase 2d, §6 |
| **Names and ports:** `Fireworks.*`, API 5180, DB 5433, Angular dev server on 4200 (not run alongside Monster of the Week). | plan §5 OQ12 |
| **Forms: Angular Signal Forms on Angular 22.** Stable there and the direction Angular is heading. This is a deliberate departure from the reference's reactive forms. | plan §5 OQ17 |

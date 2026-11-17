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
| **Phase 5 client security: text-only rendering app-wide, share-code regex before any URL, isOwner never authorizes, remixedFrom not rendered, test-mode banner.** | `boo-phase5-security-requirements.md` · `boo-phase5-security-verification.md` |

## 4. UX and copy

| Decision | Record |
|---|---|
| **A write that partly fails is a success with a caveat,** never an error. | `rosalina-partial-failure-is-success-with-caveat.md` |
| **Phase 5 save/share/player UX:** Save clears both dirty flags and a separate saved flag drives "Not saved"; the owner chooses with two visible buttons; save failures go in an inline status block; the player opens paused under reduced motion. | `rosalina-phase-5-design-review.md` · `docs/fireworks-app/design/phase-5.md` |

## 5. Project decisions (fireworks)

| Decision | Where |
|---|---|
| **Anonymous play; persistence is owned by a user ID,** resolved through `ICurrentUser` (claims from the Google cookie session since 2026-11-16; the interim default user is gone and its creations are read-only). | `plans/initial-implementation.md` §3.4, §Phase 8 |
| **Shells first, shows later. No public gallery. No CI.** | `plans/initial-implementation.md` §5 |
| **Writes require sign-in.** `canWrite` equals `isAuthenticated` (Google sign-in); the interim `AllowAnonymousWrites` switch and default user are gone (2026-11-16). | plan §Phase 8 · `records/bowser-phase8-server-auth.md` |
| **"My creations" needs sign-in:** `GET api/me/creations` returns 401 when signed out, and `/mine` shows a sign-in prompt in place with no list call. Share-code GETs need no sign-in (they are `private, no-cache` with `Vary: Cookie`). | plan §Phase 8 · `records/boo-phase8-security-requirements.md` A44 |
| **Stage coordinates follow the prototype:** a fixed 800-unit height, width follows the window, and cue `x` is a fraction of the width. | plan §5 OQ5 |
| **The backend targets .NET 11 (`net11.0`)**, a deliberate departure from the reference's .NET 10, because .NET 11 is what's installed. | plan §2 (.NET row) |
| **Flashing safety ships with each surface.** The designer at `/` auto-plays, with Rosalina's first-visit notice, a start in Manual under reduced motion, and a Reduce flashing toggle, all in 2c. The player gets the same in Phase 5. | plan Phase 2c, Phase 7 |
| **Designer draft exists so state is never lost on navigation.** It keeps the shell, display settings and active tab. Presets and Apply confirm only when they'd replace something the visitor changed (shell, or sky for JSON with sky); display settings and tab never count; app-made changes never set dirty. Links load a working copy of a saved record (Phase 5). Under reduced motion the designer opens in Manual on every load. Held Space fires once. The flashing notice pauses playback until dismissed. Presets and sky-less JSON keep the current sky. | plan Phase 2c, Phase 5 |
| **Performance/fps requirements are benched until the end of the project, tests included.** The concern to re-evaluate is browser CPU load, not visual frame rate. No gate checks fps. | plan Phase 2d, §6 |
| **Names and ports:** `Fireworks.*`, API 5180, DB 5433, Angular dev server on 4200 (not run alongside Monster of the Week). | plan §5 OQ12 |
| **Forms: Angular Signal Forms on Angular 22.** Stable there and the direction Angular is heading. This is a deliberate departure from the reference's reactive forms. | plan §5 OQ17 |
| **A cue's `t` is its launch time.** | `docs/fireworks-app/schema.md` §4.3 · `records/yoshi-phase3-creation-schema.md` |
| **Share links are not locked.** Improvements may change how existing links play; prototype goldens are regression guards updated by reviewed change; version bumps are for document-shape changes only. | schema.md §8.1 |
| **`remixedFrom` is visible only to the remix's owner;** everyone else gets `null`. The condition is `isOwner` alone, with no `CanWrite` term. **Accepted interim exposure (Skyler, 2026-11-13):** before Phase 8 every visitor is the default user and so the owner, so every visitor of a remix's link sees the original's share code. Closed by Phase 8: owners are real accounts, and the UI renders "Remixed from" only on the player when `isAuthenticated && isOwner` (A43). | schema.md §2.1, §14 · `records/yoshi-phase3-creation-schema.md` (addendum 3) |
| **An empty show can't be saved** (1..1000 cues); caps are 32 shells, 1000 cues, 600 s. | schema.md §4, §5.1 |
| **A blank name saves as "Custom".** | schema.md §6.4 |
| **A link never opens the saved record for editing.** `/c/:code` is the only editing link, for shells and shows; it loads a dirty working copy with exactly the saved settings. No edit-in-place route; the player's Remix just opens the working copy. | schema.md §11.1–11.2 · `records/yoshi-phase3-creation-schema.md` |
| **Save on a working copy:** an owned source offers "Update original" (PUT) or "Save as new" (remix); otherwise Save creates a new creation with `remixedFrom` set. Before Phase 8 `isOwner` is always true. | schema.md §11.4–11.5 |
| **Opening a link over unsaved changes asks first,** only when the shell or sky is dirty (same rule as Apply with `sky`). | schema.md §11.3 |
| **A show runs until the last particle fades.** `duration` is the launch window only; a cue at `t == duration` is valid and its burst is seen. | schema.md §4.5 |
| **Remix always shows on the player,** whatever `canWrite` is; only Save is hidden when writes are off (Skyler, 2026-11-14). | plan Phase 5 · `docs/fireworks-app/acceptance/phase-5.md` |
| **Display and flashing preferences are device-wide:** one flashing-notice dismissal and one Reduce flashing choice shared by the designer and the player; a link load keeps `display` and replaces shell, sky, tab, dirty flags and `source` (Skyler, 2026-11-14). | plan Phase 5 · `docs/fireworks-app/design/phase-5.md` |
| **"Remixed from" is not rendered before Phase 8;** after Phase 8 only when `isAuthenticated && isOwner` (Skyler, 2026-11-14). | `records/boo-phase5-security-requirements.md` C10 |
| **~~A test-mode banner is required in Phase 5~~ — superseded (Skyler, 2026-11-16):** the banner is removed; saving requires Google sign-in, pinned by the server invariant `canWrite == isAuthenticated`. | `records/boo-phase8-security-requirements.md` A42 |
| **Cross-browser means it runs in each browser,** not identical fidelity; exact determinism is a same-engine test (Skyler, 2026-11-14). | plan Phase 6 · `docs/fireworks-app/acceptance/phase-6.md` |
| **Show Builder v1:** session-only Undo (50 steps); embedded shells not edited in place; seek performance accepted as measured, revisit at >1 s p95 on a saved show in Chrome (Skyler, 2026-11-14). | plan Phase 6 · `records/yoshi-phase6-timeline-driver.md` · `docs/fireworks-app/design/phase-6.md` |
| **Show Builder fields use native controls, not Signal Forms** (OQ17 departure for that page only); **Motion blur is device-wide** like Reduce flashing; **Show JSON moves to Phase 7** (Skyler, 2026-11-14). | plan Phase 6 · `records/luigi-phase6-show-builder.md` |
| **The API banner also shows when the `api/me` check fails** (designer and builder); **⌘/Ctrl+Z on selects, range controls and checkboxes stays with the control** (Skyler, 2026-11-14). | plan Phase 6 · `records/mario-phase6-gate.md` · `records/luigi-phase6-show-builder.md` point 12 |
| **Builder seeks are time-budgeted: 25 ms per frame, configurable in appsettings `ClientPlayback`** (seek budget, catching-up delay, checkpoint interval, checkpoint memory), served at `GET /api/client-config`, documented in the README; ranges stay as built (4–100 ms, 8–512 MiB). Cap reductions are a Phase 7 decision with measured numbers (Skyler, 2026-11-15). | plan Phase 6 · `records/bowser-phase6-client-playback-config.md` · `records/luigi-phase6-show-builder.md` point 13 |
| **Phase 7 scope (Skyler, 2026-11-15):** Railway stays deferred (Phase 7 passes on image evidence; [R] items DEFERRED; backups are a documented local procedure); no fps-driven automatic quality (moves to the end-of-project CPU review; DPR cap ships); build Rosalina's four builder items, the label fix and Show JSON (warm-up only if p95 seek > 1 s); no If-Match yet, ETag is `"<updatedAt>"`. | plan §Phase 7 7.5 · `records/mario-phase7-planning.md` |
| **Caps stay 40k particles / 600 s; cold seeks count for the 1 s trigger, so background warm-up ships; CSP allows `style-src 'unsafe-inline'` only (scripts strict, no `unsafe-eval`); Show JSON Apply is one Undo step** (Skyler, 2026-11-15). | `records/toad-phase7-caps-and-seek.md` · `records/boo-phase7-security-requirements.md` · `docs/fireworks-app/design/phase-7.md` |
| **Throughput constraints (Skyler, 2026-11-15):** mutation testing only on engine, save-path and security/guard code; at most two agents at once; heavy runs serial; **regular runs and phase gates use Chromium only**, with Firefox and WebKit in a daily run defined by the post-Phase-7 testing interlude (this narrows the earlier "runs in each browser" row for gates). The 7l.5 early-seek bar passes at p95 ≤ 4,330 ms or ≤ 1.2× a same-load no-warm-up baseline. | plan §Phase 7 7.5 · `records/mario-phase7-gate.md` |
| **Test tiers (Skyler, 2026-11-16):** quick (dev); regular (< 5 min, every change and gate, includes a Chromium smoke); daily (~25–30 min, run manually once per phase before its gate); final (daily + benchmarks, at-maximums/extreme-show runs and the uncached Docker build, end-of-project review only). A gate needs a green daily or final run < 24 h old (`tools/test/daily-status.mjs`) unless Skyler accepts the failure in writing. Cross-browser fingerprint mismatches are report-only. Old tests are deleted only after their replacement kills the same mutants. | `docs/fireworks-app/testing-strategy.md` · `records/toad-interlude-final-tier.md` |
| **Lean process (Skyler, 2026-11-16, standing):** after a change run only the regular tier plus the changed area's specs; mutant sweeps only at phase gates, on changed files, one heavy job at a time with limited workers; a small fix is one agent with no review chain. This doesn't relax CLAUDE.md rule 6: rejected work is still revised by a different member. Show caps (600 s) and seeking stay. | plan "Interlude after Phase 7" |
| **Auth (Skyler, 2026-11-16):** Google sign-in only, with a cookie session (30 days, sliding); default-user creations are read-only, with an optional claim SQL; the test-mode banner is removed; If-Match lands in Phase 8; stub OAuth for local dev and tests, refused in Production. | plan §Phase 8 · `docs/fireworks-app/design/phase-8-auth.md` · `records/yoshi-phase8-auth-design.md` |
| **Redundant timeline tests deleted after mutant proof (Skyler, 2026-11-17):** 19 tests removed; every mutant they killed is still killed in the same tier; "seek clamps and floors" kept and strengthened (K1/K2). | `records/toad-redundant-spec-deletion.md` · `tools/mutants/sets/t3-redundancy.mjs` |
| **Final tier first full run passed (2026-11-17):** 75/75 steps, 32.4 min; must run on Node 26.5 (`.nvmrc`). | `records/toad-final-tier-run.md` |
| **End-review CPU rulings (Skyler, 2026-11-17):** render only when the frame changed and the lean particle upload now; a render-only quality governor (never `starBudget` or capacity) only if its trigger fires; keep the `pixi.js/unsafe-eval` polyfill and strict CSP; warm-up waits `ClientPlayback.WarmUpDelayMs` (default 1000 ms) after edits and seeks, and is skipped when the predicted cold run is ≤ 200 ms (lowered from 1 s via 700 ms after Toad measured the first-slice probe under-predicting ~4×). Verified: governor trigger does not fire; hand-fused upload not built; T23's dead run-key check removed; Reduce flashing switches sit in `@if` blocks so they render with their value; T27/T40 tests declined for now (Skyler, 2026-11-17). | `records/yoshi-end-review-cpu-cost.md` · `records/toad-end-review-verification.md` · `records/luigi-end-review-cpu-fixes.md` |

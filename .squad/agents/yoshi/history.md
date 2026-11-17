# Yoshi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Phases 0 to 7 are built. The interlude's engine side is in (T2 fingerprints and the F1 fix; T3 by Toad; the final tier). Open: F3 (`reset` keeps `simTime`, minor); the Phase 8 identity seam and the `-p` ETag tag; the coarse-pointer warm-up memory clamp (trigger: `CheckpointMemoryMiB` above 128).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

### Folded from Phase 0 to 2a (summarized 2026-11-13, compacted 2026-11-15)

- **Rulings and parity:** the Signal Forms spike ran before 2c (OQ17: Signal Forms on Angular 22.2.x). Phase 3 states show-vs-shell sky precedence (one sim, one gravity) and `burstHeight` as a fraction of ground height (760). The skeleton mirrors the reference; diff with name substitution (`sed 's/MonsterOfTheWeek/X/'`). The Phase 8 seam is `IdentityRegistration` (DefaultUserId guard, initializer, auth middleware, AllowAnonymous on health, fallback and share GET). Records: `yoshi-phase1-parity-review.md`, `yoshi-phase1-plan-followups.md`. "My creations" follows the write switch before Phase 8: 403, not an empty 200.
- **Engine boundaries (`yoshi-phase2a-engine-boundaries.md`):** the boundary spec needs a layer-edge rule, a transitive reach rule and a fail-closed parser (skill `import-boundary-spec`). No module-level `let` or `var` in the engine; PRESETS are deep-frozen. `normalize` gains `adjustments` and structured `errors`. Worst-case shell lifetime at the limits is about 21 s. `ShellIssue.code` is contract (schema.md §6.3).

### Folded from Phase 3 (summarized 2026-11-14, compacted 2026-11-15)

- **Creation schema (`yoshi-phase3-creation-schema.md` and two addenda):** `normalizeShell` returns only `errors` when any exist, so strict mode needs both. Codes map 1:1 from adjustment kinds (`defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, `cleaned`→`name-format`). Names: remove Cc and unpaired surrogates, trim the explicit JS-trim set (C# `Trim()` misses U+FEFF), blank → Custom, cut at 80 code points. Show v1: required `sky` (wins); embedded shells lose `sky`; `shells` 0..32 keyed `^[A-Za-z][A-Za-z0-9_-]{0,11}$`; cues 0..1000; `fireStep = Math.round(t*120)`, order `(fireStep, id)`. Typical 1000-cue show 72 KB; worst 215 KB; the request limit is 256 KiB.
- **Rulings:** cue `t` is the launch time; share links are not locked; goldens are regression guards; version bumps are for document-shape changes only; no empty shows; a show runs until its last particle fades, and `duration` is the launch window only. `jsonb` drops key order, so tests compare parsed JSON.
- **Validator feasibility (Bowser's probes):** `TryGetDouble` is true for `1e400` (check `IsFinite`); `AllowDuplicateProperties=false` has no path (the walker detects duplicates, last wins); `GetString` and `ValueEquals` throw on lone surrogates (`Utf8.IsValid` gate). An API claim in a spec is a hypothesis until a probe runs.
- **Calls:** "Save as new" uses `POST …/remix`. `/c/:code` is load-then-redirect with `replaceUrl`. `GET api/me/creations` takes `pageSize` 24 (max 100), a `kind` filter and order `updatedAt` desc, then `shareCode`.

### Folded from Phases 4 to 6 (summarized 2026-11-14 and 2026-11-15)

- **Phase 4 (`schema.md` folds of Boo's S1–S29):** §2.1 (S13 overruled: `isOwner` only), §2.2.1 query rules, §2.4 cap, §2.6 gate order (429, 403, 415, 413, 400 envelope, 404 lookup, 400 document), §2.7 status and rate-limit tables, §6.5, §9. The 400 body is exactly `{ message, errors, truncated }`, at most 100 issues. `[FromQuery] string?` turns `kind=` into null, so the list reads `Request.Query`.
- **Phase 5:** draft `source` gains `name` (Rosalina Y1). A 404 from PUT or remix sets `source` to null (Y2). §11.2: a PUT 404 asks; a remix 404 falls back to a plain POST. Share-code reuse is "improbable, not prevented". Delete is hard (`CreationRepository.DeleteOwnedAsync`), with no tombstone. `Connection: close` comes from `ApiResponseHeaders` (declared length over `MaxRequestBodySize`).
- **Phase 6 TimelineDriver (`engine/loop/timeline-driver.ts`, `yoshi-phase6-timeline-driver.md`):** the driver owns the show clock (it counts `beforeStep` calls). Measured pure re-run: 0.12 ms/step (Done-when), 0.28 (600 s, 1000 presets), 1.6 at the 40k cap. So exact checkpoints every 1200 steps, keyed by width, starBudget and capacity, with a 64 MiB cap that doubles the spacing; edits inherit checkpoints up to the first differing cue (`options.from`). `cueTimes` lives in `sim/lifetime.ts`. A late config does not reset the grid (`TimelineDriver.inherit` copies `from.cpSteps`).
- **Lesson (all phases):** trace a new writer of a contract state through every path that reaches it, and every fallback through the endpoint it calls.

### Folded from Phase 7 and the interlude proposal (summarized 2026-11-16)

- **Phase 7 rulings (`yoshi-phase7-architecture-rulings.md`):** the renderer detects context loss (`onContextChange`); the host rebuilds through the factory after `restored`, and a loss acts as an implicit pause. `FlashSpacing` and the last width live on the host. Clamps stay out of the driver: the stage reports `endStep`. The context-loss failure is 10 s (`rosalina-phase-7-design-review.md` point 11). Skill `pixi-host-lifecycle` has a context-loss section. Shared files live in `app/shared` and never import features.
- **ETag and F3:** strong `"<updatedAt>"`, serialized with the body's converter (`ToString("O")` pads to 7 digits, a trap). Phase 8: the owner keeps the token, a non-owner gets `"<updatedAt>-p"`. F3 uses `embeddedShell()` plus a `.shells[` grep guard, which must exclude `this.shells[s]`.
- **Driver (`timeline-driver.ts`):** D1 (2026-11-15, coordinator-authorized): a strict-prefix receiver caps at its last `fireStep`, so `endStep` is 1113 after a last-cue deletion. Argument order in `divergeStep(a, b)` is load-bearing (N4, N5). Lesson: "exact up to the first differing cue" covers the world, not derived state that depends on absent later cues; check prefix, suffix and empty. Checkpoints share snapshots by reference (no 2x cap). Trigger for a coarse-pointer warm-up memory clamp: `ClientPlayback__CheckpointMemoryMiB` above 128 (not fired at 64). A late interval does not reset the grid.
- **Traps:** never run mutants and the full suite at once (contention reads as kills and timeouts). Vitest hides `console.log` from passing tests: put values in a failing `expect([...]).toEqual([])`. `ng test` has no `-t`.
- **Interlude, engine side (`yoshi-interlude-show-testing.md`):** the ledger is schedule-only, so use `advance(lastFireStep + 1)` on a capacity-1 sim, not `runToEnd`. Under a frozen clock `runSlice`'s `left` never reaches 0, so budget checks stay in jsdom. Golden fingerprints are integer only (counts, ledger, end). Float64 `tx`/`ty` bits agreed across Node, Chromium, Firefox and WebKit.

## Learnings

### 2026-11-15 — Interlude batch 2: T2 show fingerprints built

- **Where things are:** `engine/loop/golden/show-fingerprint.ts` (single source: cases, fingerprint, diff, `realisticShow`), goldens in `engine/loop/golden/fingerprints/<case>.json`, specs `show-fingerprint{,.daily}.spec.ts`, recorder `tools/fingerprints/record.mjs` (refuses without `--reason`, appends to `header.history`, `--check`), browser harness `tools/browser-gates/fingerprints.mjs` (about:blank, no CSP needed), proof sets `tools/mutants/sets/t2-{fingerprint,today}.mjs`. Record `yoshi-interlude-t2-fingerprints.md`.
- **Measured:** Chromium 157, Firefox 159 and WebKit 27.2 reproduce every Node golden exactly, including the float64 bits of the ledger's `tx`/`ty`. Regular cases cost about 5 s alone; `at-maximums` about 160 s in Node.
- **Death equality is hit:** `age > life` (P02) changes counts in dense shows (Done-when, realistic, cap 2500), so the golden kills what run-vs-run can't. Wind-only changes are the integer fingerprint's blind spot (F6).
- **Traps:** an esbuild IIFE's export object has getter-only properties, so assigning to one silently does nothing (my first crash control didn't fire; replace the whole global). `designer-structure.spec.ts` pins every `openShow` caller, and a new test-only caller must be added there. `ng test` keeps a structural guard on new engine files, so run the full regular suite once before claiming green.
- 2026-11-16 F1: run-key staleness belongs in `TimelineDriver.beforeStep` (null `runKey` on any step under another key, cleared only by reset/restore); checking only at reset/restore misses "changed and back". Lean-mode rules: affected specs only, at most 2 targeted mutants (`tools/mutants/sets/f1-fix.mjs`), one `tools/test/run.mjs regular`.

### 2026-11-16 — Interlude cross-agent update (Scribe)

- **Final tier moves `at-maximums` out of daily.** `toad-interlude-final-tier.md` (2026-11-16): the `at-maximums` fingerprints run in the final tier only, selected by name in `FINAL_ONLY_CASES`. Your T2 record's "Daily (2)" line and the daily row of `yoshi-interlude-show-testing.md` are marked in place.
- **Open minor finding for you, F3** (`toad-interlude-t3-property-tests.md`): `reset` keeps `sim.simTime`, so a seek that re-runs from 0 ends with a later `simTime` than a straight run. Only Reduce-flashing spacing reads it. The F1 addendum did not touch it.
- **F2 is closed** by your F1 addendum (the `traceDigest` comment now says steps 0..step − 2).
- **Standing lean process (Skyler, 2026-11-16):** after a change, run `run.mjs regular` and the changed area's specs. Mutant sweeps wait for phase gates.

### 2026-11-16 — Phase 8 auth design (`design/phase-8-auth.md`, `yoshi-phase8-auth-design.md`)

- **Recommendation:** GitHub and Google OAuth (first-party `AddOAuth` and `AddGoogle`) with the reference's cookie session. The reference's simple auth compares plaintext passwords (`MonsterOfTheWeek.Api/Services/AuthService.cs`), so "extend it" is really option (a). Its *session layer* is what we mirror: `Program.cs` l.67–103 (AddCookie, the 401/403 event overrides that mutate `Events`, the fallback policy) and DataProtection `PersistKeysToDbContext`.
- **Facts that shaped it:**
  - No production DB exists (Railway is deferred), so default-user migration only concerns local databases.
  - COOP `same-origin` kills popup login, so it's the redirect flow only.
  - CSP `form-action 'self'` applies to the redirect after a form POST, so sign-in must be a GET navigation.
  - `CallbackPath` goes under `/api/auth/callback/*` so `proxy.conf.json` already forwards it. The proxy must keep no `changeOrigin`, or the redirect URI and the Origin check break.
  - The Docker image is Production over `http://localhost`, so its `Secure` cookies need Chromium (probe P3).
- **CSRF:** no token. Lax, plus the preflight wall (415 JSON gate, PUT/DELETE, no CORS, form providers removed), plus a Sec-Fetch-Site/Origin guard. Delete the dev CORS policy.
- **If-Match:** settled by schema.md §11.4's own trigger ("or at Phase 8"). Required on PUT: 428 when missing, 412 after the owner 404, compared in the UPDATE statement.
- **New `source` writer:** refresh `isOwner` (keeping `updatedAt`) on draft restore when signed in. Without it, a visitor who signs in mid-edit remixes their own creation.
- **Pending:** Skyler Q1–Q5. After he rules, edit schema.md §2.1, §2.6, §2.7, §10, §11.2, §11.4, §11.5 and §14 in place (design §5.5).

### 2026-11-16 — Phase 8 fold-in (rulings, Boo A1–A44, Rosalina R1–R12)

- **Done:** `design/phase-8-auth.md` marked adopted and edited in place (Google only, no nonce, A3 Lax correlation, A9 allowlist, A13 guard on every path, A18 shared predicate, A29 `*`/list/weak → 412, A33 Production fail-fast, A34/A36 `Testing` for smoke and Docker, A39 logging, `__Host-` pending P3). `schema.md` §2.1, §2.1.1, §2.2.1, §2.5, §2.6 (a–e gates plus step 8 in-statement If-Match), §2.7, new §2.8 (`signedInWith`, `loginProviders`, `canWrite == isAuthenticated`), §10, §11.1, §11.2 (writer 4), §11.4 (428/412 table), §11.5 retired, §14, §15. Plan Phase 8 client bullet "a guard on /mine" replaced.
- **Rulings I made:** confirmed Rosalina's in-place `/mine` prompt and withdrew my guard (sign-out and 401 on `/mine` need the in-place state anyway; guards don't re-run). Restated Boo's A44 as a page-level zero-list-call rule; Boo to confirm. Merged Boo's `/signin?error=1` with Rosalina's `error=cancelled|failed&returnUrl=` (OnAccessDenied → cancelled; returnUrl omitted when the properties can't be unprotected).
- **Pattern:** when two reviewers amend the same design, fold both in place and list in the record exactly which of each reviewer's literal assertions changed, so their tests get updated rather than silently contradicted.

# Yoshi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells, and shows since Phase 6. Owner: Skyler Sidner.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway (deferred, [R]).
- **Plan:** `plans/initial-implementation.md`, Phases 0–8. Identity model in §3.4. **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular` (mirror structure, never its domain). **Prototype:** `prototypes/fireworks-prototype.html` (parity oracle).
- **Your focus here:** Phases 0 to 8 are built, and the Phase 8 identity seam is in. Open: F3 (`reset` keeps `sim.simTime`, minor; `yoshi-interlude-t3` and Toad's T3 record); the coarse-pointer warm-up memory clamp (trigger: `ClientPlayback__CheckpointMemoryMiB` above 128); the end-of-project CPU review.
- Carried over: the role only. Standing lessons are in `.squad/decisions/README.md`.

### Folded from Phase 0 to 2a (summarized 2026-11-13, compacted 2026-11-15)

- **Rulings and parity:** the Signal Forms spike ran before 2c (OQ17: Signal Forms on Angular 22.2.x). Phase 3 states show-vs-shell sky precedence (one sim, one gravity) and `burstHeight` as a fraction of ground height (760). The skeleton mirrors the reference; diff with name substitution (`sed 's/MonsterOfTheWeek/X/'`). Records: `yoshi-phase1-parity-review.md`, `yoshi-phase1-plan-followups.md`.
- **Engine boundaries (`yoshi-phase2a-engine-boundaries.md`):** the boundary spec needs a layer-edge rule, a transitive reach rule and a fail-closed parser (skill `import-boundary-spec`). No module-level `let` or `var` in the engine; PRESETS are deep-frozen. `normalize` gains `adjustments` and structured `errors`. Worst-case shell lifetime at the limits is about 21 s. `ShellIssue.code` is contract (schema.md §6.3).

### Folded from Phase 3 (summarized 2026-11-14, compacted 2026-11-15)

- **Creation schema (`yoshi-phase3-creation-schema.md` and two addenda):** `normalizeShell` returns only `errors` when any exist, so strict mode needs both. Names: remove Cc and unpaired surrogates, trim the explicit JS-trim set (C# `Trim()` misses U+FEFF), blank becomes Custom, cut at 80 code points. Show v1: required `sky` (wins); embedded shells lose `sky`; `shells` 0..32 keyed `^[A-Za-z][A-Za-z0-9_-]{0,11}$`; cues 0..1000; `fireStep = Math.round(t*120)`, order `(fireStep, id)`. Typical 1000-cue show 72 KB; worst 215 KB; the request limit is 256 KiB.
- **Rulings:** cue `t` is the launch time; share links are not locked; goldens are regression guards; version bumps are for document-shape changes only; no empty shows; a show runs until its last particle fades, and `duration` is the launch window only. `jsonb` drops key order, so tests compare parsed JSON.
- **Validator feasibility (Bowser's probes):** `TryGetDouble` is true for `1e400` (check `IsFinite`); `GetString` and `ValueEquals` throw on lone surrogates (`Utf8.IsValid` gate). An API claim in a spec is a hypothesis until a probe runs.

### Folded from Phases 4 to 6 (summarized 2026-11-14 and 2026-11-15)

- **Phase 4 (`schema.md` folds of Boo's S1–S29):** §2.1 (S13 overruled: `isOwner` only), §2.2.1 query rules, §2.6 gate order, §2.7 status and rate-limit tables, §6.5, §9. The 400 body is exactly `{ message, errors, truncated }`, at most 100 issues. `[FromQuery] string?` turns `kind=` into null, so the list reads `Request.Query`.
- **Phase 5:** draft `source` gains `name` (Rosalina Y1). A 404 from PUT or remix sets `source` to null (Y2). §11.2: a PUT 404 asks; a remix 404 falls back to a plain POST. Delete is hard (`CreationRepository.DeleteOwnedAsync`), with no tombstone.
- **Phase 6 TimelineDriver (`engine/loop/timeline-driver.ts`, `yoshi-phase6-timeline-driver.md`):** the driver owns the show clock (it counts `beforeStep` calls). Measured pure re-run: 0.12 ms/step (Done-when), 0.28 (600 s, 1000 presets), 1.6 at the 40k cap. Exact checkpoints every 1200 steps, keyed by width, starBudget and capacity, with a 64 MiB cap that doubles the spacing; edits inherit checkpoints up to the first differing cue (`options.from`). `cueTimes` lives in `sim/lifetime.ts`.
- **Lesson (all phases):** trace a new writer of a contract state through every path that reaches it, and every fallback through the endpoint it calls.

### Folded from Phase 7 and the interlude (summarized 2026-11-16)

- **Phase 7 rulings (`yoshi-phase7-architecture-rulings.md`):** the renderer detects context loss (`onContextChange`); the host rebuilds through the factory after `restored`, and a loss acts as an implicit pause. Clamps stay out of the driver: the stage reports `endStep`. The context-loss failure is 10 s (`rosalina-phase-7-design-review.md` point 11). Shared files live in `app/shared` and never import features.
- **ETag and F3:** strong `"<updatedAt>"`, serialized with the body's converter (`ToString("O")` pads to 7 digits, a trap). F3 uses `embeddedShell()` plus a `.shells[` grep guard. D1 (2026-11-15, coordinator-authorized): a strict-prefix receiver caps at its last `fireStep`, so `endStep` is 1113 after a last-cue deletion. Argument order in `divergeStep(a, b)` is load-bearing (N4, N5).
- **Interlude, engine side:** the T2 show fingerprints (`engine/loop/golden/show-fingerprint.ts`, goldens in `engine/loop/golden/fingerprints/<case>.json`, recorder `tools/fingerprints/record.mjs` which refuses without `--reason`, browser harness `tools/browser-gates/fingerprints.mjs`, proof sets `tools/mutants/sets/t2-{fingerprint,today}.mjs`). Death equality is hit: `age > life` (P02) changes counts in dense shows, so the golden kills what run-vs-run can't. Chromium 157, Firefox 159 and WebKit 27.2 reproduce every Node golden, including the float64 bits of `tx` and `ty`. An esbuild IIFE's export object has getter-only properties, so replace the whole global in a crash control. `designer-structure.spec.ts` pins every `openShow` caller.
- **Final tier:** `at-maximums` fingerprints run in the final tier only, selected by name in `FINAL_ONLY_CASES` (`toad-interlude-final-tier.md`). Lean-mode rules: affected specs only, at most two targeted mutants, one `tools/test/run.mjs regular`.

## Learnings

### 2026-11-16 — Phase 8 auth design (`design/phase-8-auth.md`, `yoshi-phase8-auth-design.md`)

- **Recommendation (superseded by Skyler's ruling):** the first draft recommended GitHub and Google. Skyler ruled Google only, so GitHub is dropped everywhere. `AddGoogle` is the OAuth handler, not OIDC, so there is no nonce.
- **Facts that shaped it:**
  - Mirror the reference's session layer: `Program.cs` l.67 to 103 (AddCookie, the 401 and 403 event overrides, the fallback policy) and DataProtection `PersistKeysToDbContext`. Its simple auth compares plaintext passwords, so "extend it" is not what we copy.
  - No production DB exists (Railway is deferred), so default-user migration only concerns local databases.
  - COOP `same-origin` kills popup login, so the redirect flow only. CSP `form-action 'self'` applies to the redirect after a form POST, so sign-in is a GET navigation.
  - `CallbackPath` goes under `/api/auth/callback/*` so `proxy.conf.json` already forwards it. The proxy must keep no `changeOrigin`.
- **CSRF:** no token. Lax, plus the preflight wall (415 JSON gate, PUT and DELETE, no CORS, form providers removed), plus a Sec-Fetch-Site and Origin guard. Dev CORS is deleted.
- **If-Match:** settled by schema.md §11.4's own trigger ("or at Phase 8"). Required on PUT: 428 when missing, 412 after the owner 404, compared in the UPDATE statement.
- **New `source` writer:** refresh `isOwner` (keeping `updatedAt`) on draft restore when signed in. Without it, a visitor who signs in mid-edit remixes their own creation.

### 2026-11-16 — Phase 8 fold-in (rulings, Boo A1–A44, Rosalina R1–R12)

- **Done:** `design/phase-8-auth.md` adopted and edited in place (Google only, no nonce, A3 Lax correlation, A9 allowlist, A13 guard on every path, A18 shared predicate, A29 `*`, list and weak tag → 412, A33 Production fail-fast, A34 and A36 `Testing` for smoke and Docker, A39 logging). `schema.md` §2.1, §2.1.1, §2.2.1, §2.5, §2.6, new §2.8 (`signedInWith`, `loginProviders`, `canWrite == isAuthenticated`), §10, §11.1, §11.2 (writer 4), §11.4 (428 and 412 table), §11.5 retired, §14, §15. Plan Phase 8 client bullet: the guard on `/mine` replaced by the in-place prompt.
- **Rulings I made:** confirmed Rosalina's in-place `/mine` prompt and withdrew my guard (sign-out and 401 on `/mine` need the in-place state anyway; guards don't re-run). Restated Boo's A44 as a page-level zero-list-call rule (Boo confirmed). Merged Boo's `/signin?error=1` with Rosalina's `error=cancelled|failed&returnUrl=`: OnAccessDenied gives cancelled; `returnUrl` is omitted when the properties can't be unprotected.
- **Pattern:** when two reviewers amend the same design, fold both in place and list in the record exactly which of each reviewer's literal assertions changed, so their tests get updated rather than silently contradicted.

### 2026-11-17 — Cross-agent update (Scribe)

- **Boo confirmed your A44, A2 and A4 restatements** (`boo-phase8-security-verification.md`, ruling 2). Scribe marked the amendments in place in `boo-phase8-security-requirements.md`. Luigi built A44 as the page rule (`luigi-phase8-client-sign-in.md`, boundary).
- **P3 is closed.** Bowser measured `__Host-fw.session` outside Development and `fw.session` in Development; WebKit stores no Secure cookie on http (`bowser-phase8-server-auth.md`, item 1). The `__Host-` name in your record is now measured, not pending.
- **The `-p` ETag shipped and was measured.** The owner's tag has no `-p`; the anonymous tag has it; `Vary: Cookie` is on the 200 and 304 (Mario's gate, DW2 and share caching).
- **Peach's G1 and G2 are open.** Your Y§8 assigned the end-to-end anonymous Save to Toad's smoke, but `gate-auth` doesn't cover it yet. Mario drove it by script and it passed. The scripted-gate decision is with Skyler.
- **Still open for you:** F3 (`reset` keeps `simTime`; minor).

### 2026-11-17 — Cross-agent update (Scribe): T21 and T23 gap

- **Toad deleted 19 redundant timeline-driver specs** (`toad-redundant-spec-deletion.md`), each one mutant-proven against the tier that stays. Kept and strengthened "seek clamps and floors": K1 and K2 are now killed, with `seek(…) === true` asserted for 10.9 and −5.
- **Open gap, owner you or Luigi:** T21 (adopt ignores the grid) and T23 (checkpoint ignores the run key) survive every regular engine spec. This predates the cleanup. The fast screen had said T23 was killed, and that did not hold. T40 is covered only at stage level, and T27 is equivalent in the app.
- **Your TimelineDriver:** the decision is yours, either a spec for T21 and T23 or an equivalent marked with a reason. Toad writes the test if you ask.
- **Also:** T07 is now killed only by `timeline-driver.property.spec.ts`. The "same twice" cases in the daily spec and the "digest equal across runs" cases were removed; the 2a.9 interleaved-sims spec and every store-exact seek and checkpoint case stay.

### 2026-11-17 — End-of-project CPU-cost review (`yoshi-end-review-cpu-cost.md`, skill `stage-cpu-cost`)

- **Measured in headless Chrome 157 on the real UHD 630:**
  - At the 40k cap at DPR 2 the main thread is 99.9% busy with frame p95 33 ms. About 60% of that is render-side JS: Pixi upload passes 33%, `particleVisual` 16%, `sync` 10%. The sim `step` is about 30%.
  - DPR 1 gives 80% and 16.7 ms.
  - An idle stage still costs 20–25% of a core, because it renders every frame.
  - The builder while warming is 84% main thread for about 11 s on realistic-600, then 2.9%.
- **Polyfill:** only the `ParticleBuffer` upload matters (uniform, UBO and shader sync are each < 0.2%). It costs about 2× at 40k (2.5 vs 1.3 ms) and is negligible at ≤ 20k. Making `uvs` and `rotation` static (we mark all five dynamic and call `pc.update()` every frame) brings the polyfill to 1.27 ms, the same as today's eval path. So the fix doesn't need eval.
- **Recommendations:**
  - a render-only governor (resolution, then half-rate render) that never writes `starBudget` or capacity, since both are run-key inputs and changing them means a full re-run;
  - render-on-change first, with the governor gated on a numeric trigger;
  - the warm-up caps change only the rate, not the total, so the proposal is a debounce (`WarmUpDelayMs`, default 1 s) rather than lower caps.
- **Glow and filters don't exist** (the glow is a texture), so the brief's "glow and filters" lever is empty.

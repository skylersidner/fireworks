# Session log: Phase 8, authentication (2026-11-16 to 2026-11-17)

- **Ran (in order, record times UTC):** Rosalina (8.0b design review, 11-16 20:03); Boo (8.0a requirements, 20:04); Yoshi (design adopted, 20:56); Toad (gate-keyboard fix, interlude update, 11-16 19:23, bundled here by the manifest); Luigi (B2 client, 11-17 02:12); Rosalina (B2 design check, 02:18); Boo (C1 verification, 02:29); Bowser (B1 server, with the fix addendum, 02:36); Toad (B3 gates and pre-gate daily, 03:27); Peach (acceptance, 12:02); Mario (phase-gate, 12:28). Eleven orchestration entries.
- **Commits:** none. Commits were not authorized. Files written only; nothing staged; Scribe did not run git. The testing interlude is committed as 4144608; about 160 paths are uncommitted.
- **Rulings applied (Skyler, 2026-11-16):** Google sign-in only (OQ19); default-user creations read-only, with an optional claim SQL in a README runbook (never a migration); the test-mode banner removed, replaced by the `canWrite == isAuthenticated` invariant; 30-day sliding session with no absolute cap; sign-out keeps the draft; display name stored (no email, picture or tokens); stub OAuth for dev and tests, refused in Production; If-Match 412 and 428 in Phase 8. Checked by Mario, not re-decided.
- **Gate:** Mario, **PASS WITH NOTES**, Chromium only. Regular `2026-11-17T070313` PASS (252.6 s; web 1778 tests in 79 files; dotnet with Postgres 862/862). Daily `2026-11-17T063525` green, 0.1 h old at gate start. Mutants: `phase8-auth` 20/20 KILLED (R1 on a `_mut` database); `phase8-client` 17 KILLED and S3 SURVIVED as an equivalent mutant (sweep exits 1 until marked). Acceptance (Peach): accepted, with G1 and G2 as gate checks; both PASS in the gate.
- **Reviews and outcomes:**
  - Boo C1: PASS, 43 of 44 (A31 [R]); no product defects; test gaps F1 to F4 closed by Toad's B3; F5 is Boo's own equivalent control.
  - Rosalina B2: pass except the G, which was rejected; Bowser's fix round replaced it with Google's current asset (sha1 match), served as `<img>`.
  - Peach: accepted (8a to 8k), with [R] items 8k.1 to 8k.3 and 8e.6 deferred.
  - Mario: PASS WITH NOTES (see carried items).
- **Supersessions and amendments marked in place (2026-11-16, by Scribe):**
  - `boo-phase5-security-requirements.md`: C9 superseded by A40; C10 superseded in part by A43; C17 superseded by A42.
  - `boo-phase4-security-requirements.md`: S17 superseded in part by A30; S28 superseded in part by A42.
  - `bowser-phase1-identity-foundation.md`: points 1 and 2 (`DefaultUserCurrentUser`, the `Identity` validation) superseded in part by `bowser-phase8-server-auth.md`.
  - `luigi-phase5-save-share-player.md`: point 11 (test-mode banner) superseded by A42.
  - Amended, not superseded: `boo-phase8-security-requirements.md` A2, A4 and A44, amended by `yoshi-phase8-auth-design.md` (`/signin` failure target `error=cancelled|failed`; the page-level `/mine` rule). Boo confirmed in `boo-phase8-security-verification.md` ruling 2.
  - Not marked: `toad-interlude-final-tier.md` (the Firefox panel-stop boundary is closed by Luigi's B2, noted to Toad and Rosalina instead of marked in place); `yoshi-phase3-creation-schema.md` addendum 3 (`remixedFrom` text; the Phase 8 closure is in A43, a client rule).
- **Index check (`.squad/decisions/README.md`, not edited). Flags for Skyler:**
  1. **Contradiction, banner:** "A test-mode banner is required in Phase 5 whenever `canWrite && !isAuthenticated`" (under Phase 5 security, and in the §5 row for C17) is overruled by the 2026-11-16 ruling and A42. The banner is removed.
  2. **Contradiction, default user and switch:** "Production writes are off until Phase 8. `AllowAnonymousWrites` is false in `appsettings.json`…" and "Anonymous play; persistence owned by a user ID…with a configured default user until Phase 8" are now history. The switch and `DefaultUserOptions` are gone (A34, 8f.1). Mark them as interim, or retire them.
  3. **Stale row, "My creations":** "returns 403 when `CanWrite` is false" is true only before Phase 8. Phase 8 answers an anonymous list with 401 (A19, A44), and listing needs a login. The row needs a Phase 8 pointer.
  4. **Stale row, `remixedFrom`:** the "closes in Phase 8 with no code change" note is true only in part. Phase 8 closes it on the client (A43, player only, signed in and owner). Add the rule.
  5. **Gap:** the Phase 8 rulings made on 2026-11-16 are not indexed, apart from the one "Auth" row: no display-name rule, no draft-kept-on-sign-out rule, no no-cap rule, no legacy read-only rule. The Phase 8 gate verdict is not indexed. Promotion is Skyler's call.
  6. **Gap, minor:** the "Remixed from" row says `isAuthenticated && isOwner`. A43 adds `isShareCode` and "player only".
- **Plan status line (not edited):** the header of `plans/initial-implementation.md` still reads "Phase 0 complete (2026-11-12)". It does list OQ19 as Google (2026-11-16). There is no Phase 8 status line; the coordinator may want one.
- **Carried items (from the gate record and the acceptance file):**
  1. `[R]` items: WebKit sign-in (needs https; 8k.1); real Google accounts, the A6 Google-origin half, A36 in Production (8k.2, 8e.6); Railway edge, `KnownProxies`, `Host`, the PSL question (A31, 8k.3, C18); two real Google accounts. Waits for the Railway window.
  2. S3 equivalent-mutant marking in `tools/mutants/sets/phase8-client.mjs` (Toad). Until then the sweep exits 1.
  3. G1 and G2 as scripted gates, pending Skyler. Mario's script is `scratchpad/gate8/g1g2.mjs`. Owner if approved: Toad (gate-auth part four) and Luigi or Toad (draft-bytes spec).
  4. N1: `MeResponse.signedInWith` typed `string | null`, schema says `'google' | null` (Luigi, `core/models.ts` l.17).
  5. N2: stale `src/api/Fireworks.Api/bin/Release/net11.0/appsettings.json` with an `Identity` section (build output, dockerignored; a `dotnet run` from `bin/Release` hits the intended throw). Unassigned; Bowser's area.
  6. A37: no XML key encryptor; the warning appears on the image (Bowser, with Boo's A37 trigger).
  7. Leftover database `fireworks_boo_race` on 5433 (Boo to drop). Scribe did not drop it.
  8. The final tier has never run end to end (end-of-project review).
  9. Redundant-spec deletions deferred until replacements kill the same mutants (Skyler's review).
  10. The coordinator restarted the 5190 stub, so `/__next-subject` works; Mario's carried item on the stale stub is closed.
  11. Scheduling: the first daily (22:07, 11-16) ran 8.5 h with the lid closed. Runs now use `caffeinate`, recorded in Toad's history.
- **History folds (threshold 12,288 bytes; before to after, bytes):** Boo 13,779 to 9,448; Luigi 14,021 to 10,973; Mario 13,323 to 6,711 (heavier than needed: the Phase 5 to 7 gate detail is compacted to paths and rules); Peach 13,443 to 6,979; Rosalina 13,372 to 8,614; Toad 14,853 to 10,955; Yoshi 13,759 to 10,206. Each oldest Learnings block now sits in Core Context as a dated fold; paths and rules are kept. Bowser 6,770 is under the limit; its cross-agent note brings it to 7,662. Scribe 6,752 to 7,331 (under).
- **Records verified present in `.squad/decisions/records/`:** all 10 manifest records (`yoshi-phase8-auth-design`, `boo-phase8-security-requirements`, `boo-phase8-security-verification`, `rosalina-phase-8-design-review`, `rosalina-phase8-b2-design-check`, `bowser-phase8-server-auth` with the fix addendum, `luigi-phase8-client-sign-in`, `toad-phase8-auth-gates`, `mario-phase8-gate`, `toad-interlude-final-tier` with the 2026-11-16 keyboard update). Acceptance `docs/fireworks-app/acceptance/phase-8.md` present.

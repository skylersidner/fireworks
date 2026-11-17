# Phase 8 phase-gate (Mario)

**Date:** 2026-11-17 · **Phase:** 8, Authentication · **Verdict: PASS WITH NOTES** · Commits: not authorized (Skyler approves the commit).

**Binding rules applied:** lean process (plan "Interlude after Phase 7"); Chromium only; one agent (me), heavy jobs serial under `caffeinate`; mutants only on the changed security sets. Rulings of 2026-11-16 (Google only, cookie session 30 days sliding, legacy creations read-only, banner removed, sign-out keeps the draft, If-Match in Phase 8, stub refused in Production) were checked, not re-decided.

## What

**Freshness.** `daily-status.mjs`: OK, `daily/2026-11-17T063525`, green, 21.7 min, 0.1 h old at gate start (commit 4144608 + 160 uncommitted paths).

**Suites.** Regular `test-results/regular/2026-11-17T070313`: PASS, wall 252.6 s. Web 1778 tests in 79 files; `dotnet test` with Postgres 862/862; format, fixtures, typecheck, both builds and the Chromium smoke (including `gate-auth` csrf, csp and walk) green.

**Mutants (serial).**
- `phase8-auth`: 20/20 KILLED, exit 0. That includes R1, the read-then-write If-Match, on real Postgres via `FIREWORKS_MUTANT_POSTGRES` → throwaway `fireworks_gate8_mut` (dropped). Log: `test-results/mutants/phase8-auth-2026-11-17T12-18-21/`.
- `phase8-client`: 17 KILLED, 1 SURVIVED (S3), exit 1. I confirmed S3 equivalent by reading `core/sign-in.ts`: when `url[1]` is `/`, `path[1]` and `decoded[1]` are `/` too (`?`/`#` come later, and decoding can't change the first two characters), so the final `decoded[1]` check rejects the same inputs. This matches Luigi's record. Log: `test-results/mutants/phase8-client-2026-11-17T12-09-37/`.

**Image.** `fireworks:phase8-gate` (full `docker build`), run as `fw-gate8`, Testing, on 127.0.0.1:18098 against a fresh `fireworks_gate8` (migrated at boot, dropped afterwards), with the 5190 stub. Logged `Sign-in uses stub OAuth endpoints (localhost:5190)`. Chromium cookie: `__Host-fw.session`, Secure, HttpOnly, Lax, `/`, 30.00 days.

| Item | Result | Evidence |
|---|---|---|
| DW1 Anonymous play, sign-in prompt on Save | PASS | G1 below, on the dev stack and on the image. Anonymous `api/me` gives exactly the five null/false keys. Anonymous POST, DELETE and `api/me/creations` each give 401. The share GET is 200 with no cookie. |
| DW2 Two accounts can't edit each other's creations | PASS | Image, dev-alice saves `9RGD6pjp` via the UI. Signed in as dev-bob, `isOwner:false` with a `-p` ETag; PUT 404, 46 bytes, byte-identical to PUT on `abcdefgh`; DELETE 404; his `/api/me/creations` lacks the code. Alice's ETag is unchanged afterwards. Regular smoke `gate-auth` walk is green both directions; `OwnershipTests` is in the 862. Real Google accounts are [R]. |
| DW3 Default-user path gone from production | PASS | Grep of `src/api/Fireworks.Api` (excluding bin/obj): the only hit is the guard message `AuthProviderSettings.cs:128`. `ICurrentUser → ClaimsCurrentUser` (`IdentityRegistration.cs:194`). `FireworksDbInitializer` only migrates. No `Identity` section in appsettings. Production on the image with no secrets exits 134 (`Auth:Providers:Google:ClientId must be configured.`); Production with the stub pair and endpoint exits 134 (stub override refused). Neither reaches "Now listening", and the secret never appears in the logs. |
| G1 (8a.5) full anonymous Save | PASS | `scratchpad/gate8/g1g2.mjs`, Chromium, on 4200→5180 and on the image. One Save with `aria-haspopup=dialog` → dialog, focus on `google-sign-in`, zero writes → stub `Continue as dev-alice` → back on `/` → `fireworks.draft.v1` byte-identical, name field rendered, toast `Signed in as Stub dev-alice.`, marker deleted, focus `save-save`, zero writes on return → Save → POST 201. Incidental: on a run where the flashing notice was still up, focus went to `flash-turn-on`, which is the 8b.3 "notice wins" rule. |
| G2 (8g.3) drafts across Sign out | PASS | Same script, both surfaces: `fireworks.draft.v1` (581 B) and `fireworks.showDraft.v1` (280 B) byte-identical; logout 204 is the only write; toast `Signed out.`; focus `account-sign-in`; the designer still renders the draft. |
| Share caching | PASS | Image: `Vary: Cookie` and `private, no-cache` on 200 and 304; the owner tag has no `-p` and the anonymous tag has `-p`; anonymous `If-None-Match` with the `-p` tag → 304. `/health/live` and `/health/ready` are 200 text/plain. |

## Notes (carried)

1. **[R] DEFERRED:** WebKit sign-in (no Secure cookie on http), real Google (8k.2, A6 Google half, A36), Railway edge A31 and C18, two real Google accounts (8e.6).
2. **S3 equivalent, but the sweep exits 1.** Toad: mark S3 equivalent in `tools/mutants/sets/phase8-client.mjs` or replace it with a raw input that only the raw check catches, so the gate sweep can exit 0.
3. **Stale stub process.** The 5190 stub (PID 85807, started 2026-11-16 20:21) predates `/__next-subject` (file 21:34), so it returns 404. My drive used the interactive page instead. Restart it to get the queue endpoint. I left it running, as briefed.
4. **G1/G2 as scripted gates.** Peach's question: add G1 as a fourth `gate-auth` part and the draft-bytes assertion as a spec. My script is a ready starting point (Toad for the gate, Luigi or Toad for the spec).
5. **Leftover database** `fireworks_boo_race` on 5433 (Boo's Phase 8 race run). Not mine, so I didn't drop it.
6. **Still open:** redundant-spec deletions (only after replacements kill the same mutants), the end-of-project final tier, Peach N1 (`signedInWith` type) and N2 (stale `bin/Release` appsettings), and A37 (no XML encryptor; the warning appears on the image).

## Why

Every Done-when item has evidence from code, a test run or the running image, not from reports. G1 and G2 were the two items with no scripted coverage; both ran end to end on two surfaces.

## Boundary

This gate doesn't cover Railway or real Google. Those are [R] until the Railway window. It doesn't change any standing decision.

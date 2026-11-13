# Phase 3 acceptance: creation schema

**Reviewer:** Peach · **Date:** 2026-11-13 · **Input:** `docs/fireworks-app/schema.md` (Yoshi), plan §3.3 and Phases 3–6, the designer store and draft, `engine/model/*`, `schema/fixtures/**`, `.squad/decisions/README.md` §5, `docs/fireworks-app/acceptance/phase-2.md`. Mario's gate passed with notes.

## Verdict: ACCEPT WITH NOTES

The plan's Phase 3 Done-when holds:
- The schema doc is reviewed (this review plus the Phase 3 batch).
- Every fixture named in schema.md §12 exists under `schema/fixtures/`. I diffed the doc's file list against the disk: nothing is missing and nothing is extra. The counts are 21 valid shell, 9 valid show, 71 invalid shell, 51 invalid show and 23 server-only.
- The TS validator passes all of them. The `engine/model/**` specs ran at 627 of 627 under Node 26.5.

The fixtures aren't committed yet. That's the pending Phase 3 commit, not a defect.

Nothing below blocks the commit. Every note is either a doc cleanup for Yoshi, or a Phase 4–6 item that has to be on that phase's brief.

---

## 1. Saved shell: payload vs designer (settled: correct)

| Check | Result | Source |
|---|---|---|
| Everything a visitor can set is in the document | Yes. The designer binds 17 shell `[formField]`s: name, burstHeight, angleJitter, gravity, wind, and the 12 break fields. Every one is an `EditableShell` field (`version`, `name`, `burstHeight`, `angleJitter`, `sky`, `breaks`). Break count and order are `breaks`. | `shared/*/*.html`, `shared/designer-draft.ts` `EditableShell` |
| Device-only state excluded | Yes. `mode`, `persistence`, `starBudget` and `reduceFlashing` live in `DesignerDraft.display`. `activeBreak`, `shellDirty` and `skyDirty` are draft siblings of `shell`, never inside it. `never-persisted.json` and `show-never-persisted.json` reject them as `unknown-property`. | `designer-draft.ts` `DesignerDraft`, `serializeDraft`; schema.md §7 |
| What is saved is the normalized shell, not the raw form | Yes. `shell` is `toEditable(model)`, so a blank or padded name is already `"Custom"`, or trimmed, in the document that Save will send. The form model keeps the raw text. | `shell-designer.store.ts` `shell` linkedSignal; schema.md §6.4 |
| A saved designer shell always has `sky` | Yes. `EditableShell.sky` is required, and `editableFrom` fills it. | `designer-draft.ts` `editableFrom` |

## 2. Phase 4 contracts vs envelope (settled: agree, one gap)

They agree on these points:
- **`CreationResponse`:** the nine fields, `isOwner` from `ICurrentUser`, and `remixedFrom` set only for the owner and always present.
- **`CreationListItem`:** includes the stored `palette`, computed at write time.
- **Remix:** the body is `{ document }`, the edited copy, validated against the source's `kind`.
- **PUT:** a request `kind` is `unknown-property`.
- **`GET api/me/creations`:** 403 when `CanWrite` is false.

The plan entity's `remixed_from_id` (set null on delete) matches §2.1's "`null` … when the original is deleted". Sources: plan §3.3 and Phase 4 Contracts/Controller, schema.md §2.1–2.3 and §10, decisions §5.

- **F1 (plan Phase 4 controller table; schema.md §2.2):** `GET api/me/creations` is "paged, newest first" in the plan, but neither the plan nor the schema states the paging shape: the query parameters, the page size, and whether the body is a bare array or a page envelope. `/mine` and the Phase 6 "my shells" library both read this payload. **Owner: Bowser (mirror the reference's paging convention) and Yoshi (add it to §2.2) before Phase 4 starts.**
- **F2 (schema.md §2.2):** `palette` takes every embedded shell in a show, including shells no cue uses. That's acceptable. I'm noting it so Phase 6 acceptance doesn't treat it as a bug.

## 3. Phase 5 working copy (settled: buildable, with three Phase 5 items)

The schema supports each of these:
- **A link loads a working copy.** GET → upgrade → normalize → `editableFrom(shell, DEFAULT_SKY)` (§11, §8.3).
- **Remix posts the edited copy.** §2.3 and plan Phase 4.
- **A blank name saves as "Custom".** §6.4 step 3. The designer's `shell` already holds `"Custom"`, so `validateShell` passes and Save isn't blocked.
- **The draft field the working copy needs is client state.** `{ shareCode, isOwner, updatedAt }` is listed as never persisted (§7, §11). `DesignerDraft` doesn't have it yet, which is expected because it's Phase 5 work.

Three Phase 5 items:

- **F3 (plan Phase 5 Done-when step 3; schema.md §10):** Before Phase 8, `isOwner` is always true, so in the running app "saving becomes a remix" never happens. The Done-when step "Remix it" therefore depends on what the player's **Remix** button does, and no artifact says. If it opens `/c/:code` and the owner presses Save, that's a PUT that overwrites the original, and step 4 ("edit the original; the change shows on the share link") can't be told apart from step 3. **Question Q1.**
- **F4 (plan Phase 5 "A dirty indicator"; `shell-designer.store.ts` `shellDirty`/`skyDirty`):** The two existing flags mean "changed since the last preset or Apply", which is the replace-confirm rule. A Phase 5 dirty indicator means "differs from the saved record". The artifacts don't say whether Save clears `shellDirty`/`skyDirty`, or whether loading a link sets them. If neither happens, a visitor who just saved still gets the preset confirm. **Owner: Rosalina (Phase 5 design-review) and Luigi.** I'll write the criterion once they've decided.
- **F5 (schema.md §11 last bullet; decisions §5 designer-draft row):** Whether opening a link over a dirty draft asks first is deferred to Luigi and Rosalina. Skyler has ruled on every other replace path (preset, Apply), so this one is a product call in the same family. **Question Q2.**
- **F6 (schema.md §8.3 table; `designer-draft.ts` `readDraft`; `shell-designer.store.ts` `applyJson`):** The table says draft restore is `readDraft → upgrade → normalize`, but `readDraft` calls `toEditable` → `normalizeShell` with no `upgradeShell`. §8.3 says only that JSON Apply skips upgrade. Both are harmless while v1 is the only version, but the doc describes a path the code doesn't take. **Owners: Yoshi to correct the table to "today both skip upgrade", or Luigi to wire `upgradeShell` into both in Phase 5 alongside the player.**

## 4. Phase 6 Show Builder (settled: rulings hold; nothing missing is blocking)

The rulings hold in the doc, the code and the fixtures:
- **Launch-time `t`:** §4.3, plan Phase 6.
- **At least one cue:** `cues-empty.json` and `show-empty.json` are invalid, and `cue-count` covers empty, missing and null.
- **Caps of 32 shells, 1000 cues and 600 s:** the §5.1 table, `limits.ts`, `shells-33.json`, `cues-1001.json`, `show-duration-601.json` and `show/at-maximums.json`.
- **The show's sky wins:** `embedded-sky.json` and `embedded-sky-bad-values.json`.
- **Firing order is `(fireStep, id)`:** §4.4, `engine/model/show.ts` `cueFireStep`/`orderCues`, and `same-step-cues.json`.
- **`TimelineCue.burstHeight` is already optional:** `engine/loop/timeline-driver.ts` l.11–12.
- **The Phase 6 Done-when fits:** a 60 s, 50-cue show is well inside the caps.

Show name exists (`name`, same rule as a shell).

Fields a Show Builder user would want that v1 lacks:

| Missing | Needed for Phase 6 Done-when? | Can wait as a later optional field? |
|---|---|---|
| Per-cue color override | No. Workaround: a second library shell, within the 32 cap. | Yes. An optional cue field whose absence means "the shell's colors" is a no-bump change under §8.1. The accepted cost is that a stale tab drops it on re-save. |
| A link from an embedded shell to its source creation ("update from source") | No. Shells are snapshots by design (§4.2). | Yes, as an optional `source` share code. Same cost. |
| Filtering `GET api/me/creations` by `kind` for the "my shells" library | No. The client can filter. | Yes. It's an API query parameter, not a schema change. |

- **F7 (schema.md §6.2 rule 9 and §13; `valid/show/cue-at-duration.json`):** §6.2 rule 9 says "the Phase 6 driver plays to `duration`". A cue at `t == duration` is valid by fixture, but it launches at the end and bursts up to about 5.7 s later. If playback stops at `duration`, a valid cue is never seen to burst. That affects what "a 60-second show plays the same" means. **Question Q3.**
- **F8 (plan Phase 6 routes; plan Phase 5 `/c/:shareCode`):** Phase 6 still lists `/shows/:code/edit`, but Phase 5 makes `/c/:code` the "edit a working copy" link. Whether a show link opens through `/c/:code` (dispatching on `kind`) or through its own route is Phase 6 planning work for Mario and Rosalina. I'm flagging it now so the two link models don't diverge.
- **F9 (plan Phase 6 "my shells"; plan §3.4):** The library's "my shells" depends on `GET api/me/creations`, which returns 403 when writes are off. The "my shells" section must follow the write switch the same way `/mine` does. This is a Phase 6 acceptance criterion; no change is needed now.

## 5. Error copy (gaps; all but two are already Rosalina's)

The Apply surface is `designer-copy.ts` `issueReason` and `appliedNote`. `issueReason` has real copy for `enum`, `type`, `break-count`, `version` and `not-object`. Every other code falls through to the placeholder `` `${fieldLabel(path)} isn't valid` ``.

| Gap | Assigned? | Source |
|---|---|---|
| `missing`, `out-of-range`, `not-integer`, `too-long`, `unknown-property`, `name-format`, `shell-count`, `cue-count`, `key-format`, `duplicate-id`, `unknown-shell`: placeholder copy | Yes, Rosalina before Phase 5 (§15) | `designer-copy.ts` `issueReason` default branch |
| `cleaned` in the Apply note: `appliedNote` filters to clamped/rounded/truncated/dropped, so a trimmed name is applied silently | Yes, Rosalina decides (§6.3, §15) | `designer-copy.ts` `appliedNote` |
| `missing` on an optional field should say "remove the `null`" | Yes, Rosalina (§6.2 rule 13, §15) | schema.md §6.2 rule 13 |
| `not-json`, `duplicate-key` (server-only) | Not user-facing on Apply. They can reach a Save only from a client bug. Covered by F10. | schema.md §6.3 |
| **F10: Save-time outcomes have no owner.** A 400 on Save (the doc calls it "a client bug", but a stale tab can hit it, §8.1), 403 (writes switched off mid-session), 404 on PUT (original deleted), 413, 429 (rate limited), and the upgrade error "newer than this app; reload". §15 assigns Rosalina only the `issueReason` codes. | **No.** Add these to Rosalina's Phase 5 design-review brief. | schema.md §15, §8.2, §8.3; plan Phase 4 controller table |
| **F11: `type` copy bug.** `issueReason` renders `options[0] === 'number' ? 'a number' : 'text'`, so a `type` issue with `options: ['integer']` (cue `seed`, `normalize.ts` l.566) reads "must be text". It can't be reached from the shell designer today, but a show Apply will reach it. | **No.** Luigi, with Phase 6 at the latest. | `designer-copy.ts` `issueReason`; `engine/model/normalize.ts` l.566 |
| **F12: bracket paths in the Apply note.** `unknownKeyName` matches only `breaks[n].name`, so the §6.2 rule 11 paths display raw: `["a.b"]` and `breaks[0]["a\"b"]`. | **No.** Rosalina (how an unprintable key should read) and Luigi. | `designer-copy.ts` `unknownKeyName`; schema.md §6.2 rule 11 |

## 6. Consistency across plan, schema, decisions and Phase 2 acceptance

There are no contradictions between the plan, schema.md and decisions §5. Each §5 row I checked matches its section:
- `t` is the launch time.
- Share links are not locked.
- `remixedFrom` is visible only to the owner.
- No empty show, and the caps.
- A blank name saves as "Custom".
- My creations returns 403 when writes are off.

Plan Phase 3 lists the never-saved fields as `starBudget`, `persistence` and mode. Schema §7 adds `reduceFlashing` and designer state. The plan is narrower but not in conflict.

Drift found:

- **F13: schema.md header and §15 are stale (Mario's note). Yoshi fixes these.**
  - Line 3 still says **"Status: for review"**.
  - §15 lists three items as **still to do** that are done:
    1. **Bracket paths for non-plain property names in `dropUnknown` (§6.2 rule 11), owner Luigi.** Done: `engine/model/normalize.ts` l.676–724, which produces `parent["name"]` with U+FFFD for unpaired surrogates, and the `unknown-key-*` fixtures pass.
    2. **The §12.5 lenient specs, owner Luigi.** Done: `engine/model/normalize.spec.ts` l.361 onward, `describe('normalizeShow, lenient-only rules (schema.md §12.5)')`.
    3. **The rows marked (new) in §12 and the §12.5 specs, owner Toad.** Done: every (new) fixture is on disk, and the diff shows none missing.
  - Also stale: §6.6 bullet 2 still says the shipped `dropUnknown` "appends the raw name with a `.`". §6.6 bullet 3 still leaves the Vitest fixture runner as "Luigi's feasibility call", but `schema-fixtures.spec.ts` runs it.
- **F14 (schema.md §8.3):** See F6. The doc table implies an upgrade step on draft restore that the code doesn't run.
- **F15 (`acceptance/phase-2.md` 2a.6):** 2a.6 lists the adjustment kinds without `cleaned`, and describes `ok: false` as `errors[]` only. Both predate Phase 3, where `normalizeShell` now always returns `adjustments` (`luigi-phase3-ts-validator.md` point 1). Phase 2 is closed and the criterion was true when it was checked, so I'm leaving it unedited. Phase 3 and later criteria follow schema.md §6.
- **Fixed in this review (`acceptance/phase-2.md` P9):** the Check column now reads "the shell document has no mode field", and the old note in the Result column is replaced with a correction line.

Not schema, but seen during this review:
- **F16 (repro):** In this review the full `ng test` run under Node 26.5 was 952 passed and 1 failed. The failure was `fireworks-stage.reduce-flashing.spec.ts` "same launches and frames give the same particles…", which timed out at 5000 ms. It failed twice in a row in the full suite and passed when run alone in 3.6 s. That's a load-sensitive timeout, not a schema defect. **Owner: Toad.** The default shell `node` is v21.5, which Angular CLI refuses, so the run needed v26.5 from nvm.

---

## Questions for Skyler

| # | Question | Recommended default |
|---|---|---|
| Q1 | What does the player's **Remix** button do (F3)? | It opens the designer with a working copy whose **first Save always posts `…/remix`**, even for the owner, and then becomes an ordinary owned record. That way "Remix it" (Done-when step 3) makes a new share link in the running app before Phase 8, and `remixedFrom` is set. |
| Q2 | Opening a link (`/c/:code`) while the designer has unsaved changes: ask first (F5)? | Same rule as Apply with `sky`: ask only when the shell or the sky was changed; otherwise load silently. The current draft isn't kept after a confirmed load. |
| Q3 | Does a show stop at `duration` (F7)? | **No.** `duration` is the window in which cues launch. Playback runs on until the last particle is gone, and the timeline shows that tail. A cue at `t == duration` is visible. |

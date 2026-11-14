# Session log: Phase 3 creation schema (2026-11-13)

- **Ran:** Yoshi (schema doc, three passes), Bowser (C# feasibility probes), Luigi (TS validator), Toad (175 fixtures, limits, server-only wire fields, reduce-flashing timeout), Peach (acceptance: ACCEPT WITH NOTES), Mario (phase-gate: PASS WITH NOTES).
- **Commit:** `cb0f0ff` "Phase 3: creation schema, shared fixtures, TS validator" (226 files). Push is blocked (credentials). This batch's logs are not committed, per Skyler's instruction. They go into a later commit.
- **Skyler's rulings (Q1–Q5, L1–L4):** `t` is the launch time. Share links are not locked; goldens are regression guards; version bumps are for shape changes only. `remixedFrom` is owner-only. No empty shows; caps 32 / 1000 / 600 s. A blank name saves as "Custom". A link always opens a new dirty working copy, never an edit session. The owner chooses Update original or Save as new. Opening a link over unsaved shell or sky edits asks first. A show runs until the last particle fades.
- **Gate:** Phase 3 PASS WITH NOTES (Mario). Peach ACCEPT WITH NOTES. Mario's independence check matched 16 of 16. Suites: `npm test` 953/953; `dotnet test` 26 pass, 3 skip (Postgres-gated suite not rerun this batch).
- **Records present in `.squad/decisions/records/`:** `yoshi-phase3-creation-schema.md`, `bowser-phase3-validator-feasibility.md`, `luigi-phase3-ts-validator.md`, `toad-phase3-shared-fixtures.md`, `toad-phase3-server-only-wire-fields.md`. Peach and Mario wrote no records.
- **Partial supersession, marked in place (nothing wholly superseded):**
  1. `yoshi-phase2a-engine-boundaries.md`: point 8's firing formula (`Math.round(cue.t / STEP)`) is replaced by `Math.round(t * 120)` with `(fireStep, id)` ordering (Phase 3 record, point 5). Top-of-file marker added. The rest stands.
  2. `toad-phase3-shared-fixtures.md`: item 3's `server-only/` shape (status 400 or 413 only) is replaced by status 400, 413 or 415, with `contentType` and `byteMarkers` (wire-fields record). Top-of-file marker added. Items 1, 2, 4, 5 stand.
  3. `yoshi-phase3-creation-schema.md`, addendum 1 point 7: "the Phase 6 driver doesn't fire such a cue" is replaced by addendum 2 point 6 (playback doesn't stop at `duration`; a cue past a clamped `duration` fires). Inline marker added. The rest of point 7 stands.
- **Index check:** no new record contradicts a standing entry in `.squad/decisions/README.md`. The §5 rows for cue `t`, share links, `remixedFrom`, empty shows and caps, blank name, the link and Save rules, and show length match the records and schema.md §4.3, §4.5, §11. The index was not edited.
- **Open items (not in records):**
  - `docs/fireworks-app/design/designer-2c.md` §6.4 (around l.403–427) and l.464 still describe one `dirty` boolean. Carried from Phase 2; Rosalina to update before Phase 5.
  - Peach F15 (Phase 2): the split store is built, but `acceptance/phase-2.md` is not marked closed. Peach.
  - Peach F4: whether Save clears `shellDirty`/`skyDirty`. Rosalina and Luigi, Phase 5 design-review.
  - Peach F6/F14: `upgradeShell` is not in `readDraft` or `applyJson` yet. Luigi, Phase 5.
  - Peach F9, F10, F11, F12: owners in the Peach record, not recorded here.
  - Peach's error-copy table (acceptance §5) and Mario's note: a lenient `cleaned` name shows a plain "Applied." Rosalina decides the copy.
  - Phase 4 (in progress, not logged here): Boo's review of the 256 KiB limit, the manual body read and the Kestrel `MaxRequestBodySize`; Bowser's `.dockerignore` decision for `schema/`. The working tree has uncommitted Phase 4 edits under `src/api` (Bowser's `Contracts/CreationContracts.cs`, `ServiceResults.cs`, `ApiContracts.cs`). This batch doesn't stage or log them.
  - Phase 6: the Show Builder route is open (Mario and Rosalina). `/shows/:code/edit` is gone (L1).
  - Firefox golden drift is unmeasured (Toad). Firefox and Safari parity wait for Railway.
  - Resolved from Phase 2: `ShellIssue.code` is in the schema contract (schema.md §6.3).
- **Cross-agent updates (appended under `## Learnings`, dated 2026-11-13):** Bowser (rule-11 parity list in `normalize.spec.ts`; server-only wire format; Yoshi's path rule overrides the raw-escape wording), Rosalina (F10, F4, F12 copy for Phase 5), Luigi (F11, Phase 5 upgrade wiring, the `/c/:code` `replaceUrl` model, show length), Toad (show length and the Phase 5 non-owner call-ledger spec).
- **History summarization (12 KB = 12,288 bytes):** Luigi (14,755 B) and Toad (14,921 B) were over. Their Phase 0–2 learnings are folded into `## Core Context` with file paths and rules; they are now 10,508 B and 8,812 B. Bowser's Phase 3 probe bullets were condensed (the record holds the detail) and it is 11,700 B. Rosalina 9,321 B, Scribe 3,051 B. Peach (12,159 B) and Yoshi (12,036 B) are under 12,288 but over 12,000. They were not changed. Check them next batch.
- **Attribution:** none. No commit this batch.

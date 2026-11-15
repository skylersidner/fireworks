# Mario: Phase 6 phase-gate (Show Builder)

**Date:** 2026-11-14 · **Status:** proposed · **Verdict:** PASS WITH NOTES (Railway 6k.3/6k.4 DEFERRED)

## What
Done-when (plan Phase 6, with Skyler's 2026-11-14 rulings): a 60 s, 50-cue show saves, shares and plays to the last particle of its tail, and runs in each browser. All of the evidence below comes from my own runs, on the tree as it stands (no commit).

- **Suites:** npm 1433/1433 in 53 files; typecheck clean; `ng build` clean (main `main-XNY2HWA4.js`, initial total 298.40 KB; `show-builder-page` lazy, 78.94 KB); prettier `format` glob clean; `generate-fixtures.mjs --check` ok (176 fixtures); `dotnet build` 0/0; gated `dotnet test` 567/567. `git diff 53b0199 -- src/api` and `git status src/api` are both empty. The two extra backend tests come from the new fixture `schema/fixtures/valid/show/done-when-60s-50.json`.
- **Built image** `fireworks:phase6-gate` on a fresh `fireworks_gate6m` (both migrations applied, as the log shows); its `main-*.js` hash equals the local build's. Writes on.
- **Done-when smoke:** my copy of Toad's script, `scratchpad/gate6/done-when-mario.mjs` (it takes `BASE` from the env and adds 6b.1 survival checks: fixture shells, sky, duration, and untouched cues deep-equal). I ran it three times, each round trip crossing engines: Chromium→Firefox, Firefox→WebKit, WebKit→Chromium. Each run did the following:
  - seeded the fixture, moved c4, deleted c6, added c51 at 0:30, and saved through the builder: POST 201;
  - checked the POST body (all checks true);
  - clicked Share, which copied exactly `${origin}/s/{code}` with the toast and sent no request (in Chromium the real clipboard was read back);
  - confirmed that the GET `document` deep-equals the POST;
  - opened a fresh context in the other engine, played to `"Done-when 60s" has ended.` (66–72 s wall, meta 1:06 / 1:06), and ran Replay;
  - logged zero console errors.

  Negative control: `TOAD_HIDE_ENDED=1 TOAD_END_TIMEOUT_S=30` exits 1 with "timed out".
- **6k.2:** `curl -i` of `/show`, `/s/{code}` and `/c/{code}` returns 200 `text/html` with the app shell. A Playwright cold load and a reload of each render the right page: timeline, flash notice, and the timeline at `/show` (`replaceUrl`), with the builder draft holding 50 cues, `source` set to the code and `dirty` true, and no console errors.
- **Flash spacing:** `FLASH_SPACING_STEPS = 41` (`engine/render/visual-rules.ts:79`), matching phase-6.md §14.2. Mutant 40 on a scratch copy fails Toad's 3-per-second test ("expected 120 to be greater than 120").
- **Rosalina B1–B3 (Bowser):** fixed in code and specs (`show-builder-page.a11y.spec.ts`).
  - B1: the builder's banner sentence matches the §19.2 copy.
  - B2: Undo/Redo use `aria-disabled` with a page guard.
  - B3: the notice focuses its first button only when focus is on body.
- **Peach's rejected items** are closed by the evidence above (6a.4, 6a.8, 6b.1–6b.3, 6k.2) and by these specs:
  - 6c.3/6c.4: store ledger diffs run to the end, including the c2/c10 pair, with a per-edit seed check.
  - 6e.1–6e.3: `show-save.spec.ts`.
  - 6f.9: `show-save.spec.ts` Share.
  - 6h.2 unused strobe, with a positive control: `player-page.show.spec.ts`.
  - N6 (⌘ and Ctrl, with and without Shift, in Name, Duration and Launch time): `show-builder-page.spec.ts`.
- **Rulings checked in code:** route `/show` (confirmed); builder and player at `starBudget` 1; `fireworks.motionBlur.v1` is a device preference.

## Why
The plan's and the agents' claims were each re-derived from a file, a test run or the running image. Toad's smoke was a surface, so I read it line by line before reusing it, and I extended it where 6b.1's "still meets the fixture after edits" was only partly asserted.

## Boundary
- **Carried, not blocking:**
  - Railway 6k.3/6k.4 (Bowser, test window);
  - Phase 7: Show JSON, library drag, pinch zoom, the `+k` badge, the scrub overview, and Rosalina's B4–B7;
  - the builder banner follows `/health/live`, not `api/me`, the same as the designer (Rosalina/Luigi to rule);
  > Superseded by luigi-phase6-show-builder.md point 12 on 2026-11-14 (Skyler's ruling: the banner also shows when the `api/me` check fails).
  - ⌘Z with focus on a select or range undoes the show (Toad; N6 covers text and number fields only);
  > Superseded by luigi-phase6-show-builder.md point 12 on 2026-11-14 (Skyler's ruling: ⌘Z on select, range and checkbox controls stays with the control).
  - `app/testing/show-fixtures.ts` `doneWhenShow()` is still a stand-in for Toad's fixture (Luigi);
  - `/health/ready` isn't mapped and falls through to `index.html` 200 (pre-existing since Phase 1; Bowser, Phase 7).
- The smoke's reload of `/c/{code}` reloads `/show` after the redirect, which is the 6g.4 path. That is not a second GET of the link.

# Phase 6 acceptance criteria: Show Builder

Owner: Peach. Written 2026-11-14 at Phase 6 planning, before implementation.

**Revised 2026-11-14** for Skyler's Phase 6 rulings (plan Phase 6, "Phase 6 rulings"): §6a now means the show *runs* in each browser, not that it matches across them; Q1–Q3 are settled; Undo (6c.11), no in-place shell edits (6d.6) and seek performance (6i.4) are added; the p6-spec rows are resolved against `design/phase-6.md`.
Source: `plans/initial-implementation.md` Phase 6 and §3.3; `docs/fireworks-app/schema.md` §2.2, §2.2.1, §4 (cue §4.3, firing rule §4.4, end §4.5), §5.1, §7, §11, §13; `docs/fireworks-app/acceptance/phase-5.md` (format, and the coordinator defaults this phase replaces). Code read: `engine/loop/engine-loop.ts`, `engine/loop/playback-driver.ts`, `engine/loop/timeline-driver.ts` (still a stub when this was written; Yoshi is implementing it), `engine/model/show.ts` (`cueFireStep`, `orderCues`), `engine/sim/simulation.ts`, `engine/model/labels.ts`, `app/core/open-creation.ts`, `app/features/mine/pages/mine-page/mine.store.ts`, `app/features/designer/shared/designer-draft.ts`, `app/features/designer/shared/designer-copy.ts`.

The route, layout, copy and builder interactions come from Rosalina's `docs/fireworks-app/design/phase-6.md` (cited as **p6-spec**, with its section). Where a criterion quotes copy, the check is that the text shown matches p6-spec exactly; where it says "p6-spec copy" without quoting, the cited p6-spec section holds the text. The builder route is **`/show`** (p6-spec §2; coordinator default, Mario confirms at the gate).

Surfaces use the same names as `phase-5.md`. **Spec** means Vitest. **Running app** means `ng serve` or the built image in a real browser. **Railway** means deferred to the test window. **Grep/build** means a file or build check. **Ledger** means the exact request list. **Draft** means the parsed localStorage value. **Byte-identical** means the stored string is unchanged. "Builder draft" is the Show Builder's own localStorage key (the name is Luigi's call; plan Phase 6 says it has its own draft). "Designer draft" is `fireworks.draft.v1`.

**Engine terms used below.**
- **Launch ledger:** the ordered list of rows `(k, id, seed, x, tx, ty)`, one per cue fire. `k` is the step the cue fired before.
- **Count trace:** the live particle count per kind (`ParticleStore.countByKind()`), recorded after each step from 0 to the end step `E`.
- **End step `E`:** schema.md §4.5, the first step at which every cue has fired and the sim holds no live particle.

Before Phase 8, `isOwner` is always true in the running app (schema.md §11.5). Rows that need `isOwner: false` say **spec only**.

---

## 6a. What "plays in two browsers" means (the Done-when oracle)

Skyler, 2026-11-14: cross-browser means the show **runs** in each browser, not that it matches across them. Exact determinism is a same-engine property, proven by specs (6a.5–6a.7), and is not compared between browsers. No pixel, position, ledger or count comparison is made across browsers.

**Browsers:** Chromium, plus Firefox and WebKit through Playwright where they install on this machine. Any engine that won't install (the Chromium download stalled once, per the `headless-webgl-smoke` skill) is checked by hand in Safari against the same rows, and the run record says which engines ran headless and which by hand.

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6a.1 | **It loads.** In each browser, `/show` and `/s/{code}` for the Done-when show (6b.1) render the stage with a live WebGL canvas, and the player shows its flashing notice (6h.2) with no error page or load-failure status (phase-5.md §8.4). | running app, each browser |
| 6a.2 | **It plays to the end.** In each browser, after Play on `/s/{code}`, the ended state appears: `{name} has ended.` with a `Replay` button (p6-spec §11.2). The run waits at least the show's length plus its tail (schema.md §13 bound: last launch + 21 s) plus a load allowance Toad records; the ended state not appearing in that window fails. | running app, each browser |
| 6a.3 | **No console errors.** In each browser, from first navigation through the ended state (6a.2) and the builder steps (6a.4), the page records zero `pageerror` events and zero `console.error` messages. Warnings are allowed and listed in the run record. | running app, each browser |
| 6a.4 | **Save, Share and the player work.** In each browser, on `/show`: add, move and delete a cue through the UI (6b.2); Save sends `[POST api/creations]` with `kind: "show"` and gets 201 and a new code; Share then copies exactly `${origin}/s/${code}` (6f.9); opening that link plays to the ended state (6a.2). | running app, each browser (writes on) |
| 6a.5 | **Same-engine determinism (spec, not cross-browser).** Within one engine, the same show gives an identical launch ledger, per-kind count trace and end step across runs, whatever the frame size or cue array order, including at the 40k cap; a paused stage never advances the show clock. This is `engine/loop/timeline-driver.spec.ts` (Yoshi), "TimelineDriver firing rule", "determinism" and "seek" groups, kept green. | spec |
| 6a.6 | **Reduce flashing changes the renderer only.** With Reduce flashing on (including the p6-spec §14.2 flash spacing), the ledger and count trace are identical to a run with it off (`flashing-content-safety` skill, rule 6). | spec |
| 6a.7 | **Visitor input doesn't fire anything in the player.** In the show player, a click in the sky adds no ledger row, and Space only toggles Play/Pause (p6-spec §11.1). | spec, running app |
| 6a.8 | **No production ledger readout is required.** The cross-browser rows above are observed through the page itself (the ended-state DOM, the Network log, the console). A `data-*` hook on the built image is allowed only if a smoke step can't be observed otherwise, and then only the minimum that step needs (for example "ended"). **Negative controls (recorded):** an injected `console.error` fails 6a.3, and a show whose ended state is suppressed fails 6a.2 by timeout. | running app + recorded controls |

## 6b. The Done-when show and harness

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6b.1 | **The show.** Toad builds a fixture, `schema/fixtures/valid/show/done-when-60s-50.json`, and it passes both validators. It has `duration` 60 and exactly 50 cues. It includes:<ul><li>one cue at `t == 60`, the duration (§4.5);</li><li>one at `t == 0`;</li><li>at least two pairs that round to the same step, with array order the reverse of ordinal `id` order (for example `c10` and `c2`);</li><li>`x` at both 0 and 1;</li><li>at least one cue with `burstHeight` and one without;</li><li>non-zero `wind`;</li><li>at least 4 embedded shells, covering crossette, crackle, glitter, strobe and a 4-break shell, so child and long tails are exercised;</li><li>one embedded shell that no cue uses.</li></ul> | file, `schema-fixtures.spec.ts` |
| 6b.2 | **It goes through the builder.** The harness may seed the 50 cues into the builder draft. Before Save, at least one cue is added, one moved and one deleted through the UI, Save is pressed in the builder, and the posted document still meets 6b.1 (Q2, settled). | running app |
| 6b.3 | **The round trip.** Save in browser A gives `[POST api/creations]` with `kind: "show"` and a new code. In browser B, a fresh profile with no localStorage and, where installed, a different engine from A, `/s/{code}` makes a GET whose `document` deep-equals the one A posted. B plays it to the ended state with no console errors (6a.2, 6a.3). No ledger, count or position comparison is made between A and B. | running app (Done-when) |

## 6c. Builder: cues and timeline

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6c.1 | **Route and draft.** `/show` (p6-spec §2) is a lazy route chunk. It reads and writes only the builder draft. Using the builder leaves the designer draft byte-identical, and using the designer leaves the builder draft byte-identical. A reload of `/show` restores the cues, shells, sky, duration, name and `source`. | build stats, spec, running app |
| 6c.2 | **Add cue.** A new cue gets:<ul><li>an `id` matching `^[A-Za-z][A-Za-z0-9_-]{0,11}$` and unique in the show;</li><li>an int32 `seed`;</li><li>`t` in `0..duration`;</li><li>`x` in `0..1`;</li><li>`shell`, an own key of `shells`;</li><li>no `burstHeight` key unless the visitor sets one (never `null`).</li></ul>Gestures (p6-spec §4.1): **Add cue** puts it at the playhead rounded up to 0.1 s; a sky click uses the click's fraction of the stage width as `x`; a library drag onto the timeline also adds. `id` is `c{n}` from the draft's `nextCueId` counter, and `seed` is a random int32. While the flashing notice shows, a sky click adds nothing (p6-spec §14.1). | spec (draft), running app |
| 6c.3 | **Move cue.** Dragging or editing a cue changes only its `t` and/or `x` (or `burstHeight` and `shell` through the inspector). Its `id` and `seed` never change. `t` stays within `0..duration` and `x` within `0..1`, never stored out of range: a drag stops at 0 and at `duration`, and an out-of-range Launch time entry clamps on blur with the note `Launch time is between 0 and {duration} seconds.` (p6-spec §4.2, §8.1). Moving cue A leaves every other cue's ledger row unchanged (ledger compared before and after, with the cap not reached). | spec |
| 6c.4 | **Delete cue.** After deleting cue A, the ledger equals the old ledger minus A's row, and every other row is unchanged (§4.4 rule 4). A's `id` is not reused by a later Add within the same draft (see N4). | spec |
| 6c.5 | **Order independence.** Reversing or shuffling the `cues` array in the document gives an identical ledger and count trace. Two cues on the same step fire in ordinal `id` order (`c10` before `c2`). **Negative control:** a driver that fires in array order fails this. | spec + recorded mutant |
| 6c.6 | **Firing rule.** `fireStep` is `Math.round(t * 120)`, never `t / STEP`. Include a `t` where the two differ, if Yoshi finds one. Cues fire through `fireSeeded` with the cue's seed, and the loop's `launchCount` doesn't advance. Each cue fires exactly once per run. | spec |
| 6c.7 | **The tail is visible.** The timeline extends past `duration` to show the tail (schema.md §4.5): past `duration` the lane is hatched and labelled `Tail`, up to an `Ends about m:ss` marker (p6-spec §7.2). The cue at `t == duration` can be placed, and its burst is seen: `K_STAR` count is above 0 after its fire step plus its rise. | spec, running app |
| 6c.8 | **Transport.** The transport row has Play/Pause, `Back to start`, and a native range scrub bar with `aria-label="Playhead"` (p6-spec §5.2). Pause stops stepping (the step counter holds), and Play resumes at the same step with no backlog of fires. At the end, Play starts again from 0:00. While the flashing notice shows, Play is disabled. | spec, running app |
| 6c.9 | **Duration edits are blocked below the last launch** (p6-spec §9.3). An entry below the latest cue's `t` reverts on blur, the note reads `The last cue launches at {m:ss.s}, so the window can't end before it. Move or delete that cue first.`, and no cue moves. The builder never produces a Save body with `cue.t > duration`. | spec |
| 6c.10 | **Sky.** The show's `sky` is the only sky the sim uses while the builder previews or the player plays (`effectiveSky(shell, showSky)`). Changing an embedded shell can't change the sky. | spec |
| 6c.11 | **Undo (session only).** ⌘/Ctrl+Z undoes the last document change (cue add, move, duplicate, delete, inspector edit, New seed, shell add or remove, sky, duration or name). After a Delete then Undo, the cue is back with the same `id` and `seed`, and the ledger equals the one before the delete. At most 50 steps are kept: after 51 changes, 50 undos reach the state after the first change and a 51st does nothing. Selection, zoom, scroll and playhead are not undo steps. History is not persisted: it's in no localStorage value (the builder draft's key set is unchanged), a reload starts with nothing to undo, and a link load or New show clears it. An undo is a document change for 6f.8 (it sets dirty). Redo and the toolbar buttons follow p6-spec Q1's recommendation (see N6). | spec, running app |

## 6d. Builder: shell library

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6d.1 | **Copied in, with no sky.** Adding a library shell (a preset, one of my shells, or the current designer draft) writes an embedded shell into `shells` with no `sky` key and `version: 1`, deep-equal to the source shell minus `sky` after upgrade and normalize. Later edits or deletion of the source never change the show (snapshot, §4.2). Reading the current designer draft leaves it byte-identical. | spec |
| 6d.2 | **"My shells" needs one GET per shell.** A list item has no `document` (`CreationListItem` is `shareCode, kind, name, updatedAt, palette`, schema.md §2.2). Adding one of my shells sends exactly `[GET api/creations/{code}]`, then runs upgrade and normalize. A 404 shows `{name} was deleted, so it can't be added. Nothing changed.` inline under the item, removes the item from the list and adds nothing, with no generic toast (p6-spec §13.1). | spec (ledger) |
| 6d.3 | **Cap of 32 shells.** With 32 entries in `shells`, adding a 33rd distinct shell is blocked with `This show already holds 32 shells, the most it can. Use a shell that's already in it, or remove an unused one.` (p6-spec §9.2), and the draft is unchanged. A shell that deep-equals one already embedded reuses its key (p6-spec §4.1), so it still adds at the cap. `shells` never holds more than 32 entries. | spec |
| 6d.4 | **Cap of 1000 cues.** At 1000 cues, Add cue, `A`, Duplicate, sky clicks and drops add nothing, the toolbar status reads `1000 cues, the most a show can have. Delete a cue to add another.` (p6-spec §9.2), and no 1001st cue reaches the draft. | spec |
| 6d.5 | **Keys.** Embedded shell keys match the key pattern, and no key is `__proto__` or `constructor` (they're own keys, schema.md §6.6). | spec |
| 6d.6 | **Shells in a show aren't edited in place** (Skyler ruling; p6-spec §13.2). The builder has no control that changes an embedded shell's fields. The only changes to `shells` are a copy-in on add (6d.1) and removing an unused shell. To change one, the visitor edits it in the designer and adds it again, which embeds a new key unless it deep-equals an existing one. | spec, running app |

## 6e. "My shells" follows the write switch

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6e.1 | **canWrite true.** The library's first ledger is exactly `[GET api/me/creations?page=1&pageSize=24&kind=shell]`. `kind` is exactly `shell`, so no shows are listed. `Show more` requests the next page (`page=2`, same other params) and appends it (p6-spec §13.1). | spec, running app |
| 6e.2 | **canWrite false, or api/me failed.** There is no `GET api/me/creations` in the ledger, no toast and no notice: the My shells group isn't rendered (p6-spec §13.1). Presets and the current-draft entry still work, and a show can still be built and played. | spec, running app (writes off) |
| 6e.3 | **api/me pending.** No list request is sent and no "unavailable" notice shows until `session.status()` settles (the Phase 5 N1 lesson). Then a true result sends exactly one list GET, and a false result sends none. | spec |

## 6f. Save, Share and Remix for shows

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6f.1 | **Write switch.** With `canWrite` false, the builder has no Save, Update original or Save as new control, and it otherwise works. | spec, running app |
| 6f.2 | **An empty show can't be saved.** With 0 cues, the save buttons are visible and `disabled`, the note `A show needs at least one cue before it can be saved.` shows under the save bar, and no request is sent (the ledger is empty) (p6-spec §9.1; Skyler, Q4). | spec |
| 6f.3 | **Exact body.** The POST body keys are exactly `kind`, `document`, with `kind: "show"`. PUT and remix bodies are exactly `document`.<ul><li>`document` keys: exactly `version, name, sky, duration, shells, cues`.</li><li>Each cue's keys: exactly `id, t, shell, x, seed`, plus `burstHeight` only when set.</li><li>No embedded shell has `sky`.</li><li>No builder UI state is in the body (selection, zoom, playhead, dirty flags, `source`).</li><li>The JSON is compact (no newline). `validateShow` passes before the request is sent.</li></ul> | spec (body key sets), running app (Network) |
| 6f.4 | **Size.** `valid/show/at-maximums.json`, loaded into the builder and saved, is a compact body under 256 KiB and returns 201. | spec (byte length) + running app once |
| 6f.5 | **Fresh, owned and non-owner saves** follow schema.md §11.4, the same table as shells:<ul><li>Fresh: `[POST api/creations]`.</li><li>Update original: `[PUT api/creations/{code}]` (same code).</li><li>Save as new: `[POST api/creations/{code}/remix]`.</li><li>Non-owner (**spec only**): exactly `[POST …/remix]`, no PUT.</li></ul>After each, the builder draft's `source` has `kind: "show"` and the response's fields. | spec, running app |
| 6f.6 | **404 fallbacks, as Phase 5 5b.5 and 5b.6.** PUT 404 asks first (phase-5 copy with the p6-spec §10.2 show wording). Remix 404 falls back by itself. The ledger never has two remixes, and `source` becomes `null` and then the new record. | spec |
| 6f.7 | **Save-time failures** (400 with `truncated`, 403, 413, status 0, 429) show inline copy and leave the builder draft byte-identical. Issue paths read in field language: `cues[3].seed`, `duration` and `shells.s1.breaks[0].stars` read `Seed (Cue at {m:ss.s})`, `Duration` and `Stars ({shellName}, Break 1)` (p6-spec §15), never the raw path (finding N1). | spec |
| 6f.8 | **Dirty and saved.** These follow the Phase 5 F4 rule in the builder's own flags: Save clears dirty, and the separate `saved` flag drives the indicator. A cue add, move or delete, a shell add, or a sky, duration or name change sets dirty. Playhead, zoom and selection never do. | spec |
| 6f.9 | **Share** copies exactly `${origin}/s/${source.shareCode}` and makes no request. With no `source`, there's no Share button (as in 5c.2). | spec |
| 6f.10 | **Remix on a show's player** goes to `/c/{code}` with no write (ledger `[GET api/creations/{code}]` only). It always shows, whatever `canWrite` is. | spec, running app |

## 6g. `/c/:code` dispatch

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6g.1 | **Show.** `kind: "show"` loads a working copy into the builder draft. Its `shells`, `cues`, `sky`, `duration` and `name` deep-equal the response `document` after `upgradeShow` and `normalizeShow`. The copy loads dirty, `source` is from the response, and the app goes to `/show` with `replaceUrl`. The designer draft stays byte-identical. The Phase 5 "This show can't be played yet." page is gone (`open-creation.ts` `status: 'show'` removed or repurposed). | spec, running app |
| 6g.2 | **Shell.** Unchanged from 5d. The builder draft stays byte-identical. | spec |
| 6g.3 | **Confirm over unsaved changes.** A show link asks only when the **builder** draft is dirty (designer dirtiness is irrelevant, and the reverse holds for a shell link). Cancel leaves the builder draft byte-identical and lands on `/show` (§11.3). | spec, running app |
| 6g.4 | **Reload after load** restores the edited copy with no GET. | running app |
| 6g.5 | **Bad input.** A bad code or a 404, a newer `version` (p5-spec "newer" copy), or a show that fails `normalizeShow` leaves both drafts byte-identical with no redirect. | spec |

## 6h. Show player `/s/:code`

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6h.1 | **Plays.** `kind: "show"` plays with `TimelineDriver` at `starBudget` 1 (Q3, settled: shows preview and play at `starBudget` 1 until Phase 7), whatever the designer's display setting is. Its fetch ledger is `[GET api/creations/{code}]` plus `GET api/me`. It never writes the designer draft or the builder draft, except the device-wide flashing keys. The Phase 5 "can't be played yet" page is gone. | spec, running app |
| 6h.2 | **The flashing notice holds playback at step 0.** While the notice shows, the step counter is 0 and the ledger is empty. On Play, the first fire is at the first cue's `k`, with no burst backlog. "Strobe" is named only if a shell **used by a cue** has a strobe break, never for an unused embedded shell, and the notice names the length as `about {n} seconds` / `about {m} minutes` (p6-spec §11.3). The dismissal is device-wide (`fireworks.flashNotice.v1`). | spec, running app |
| 6h.3 | **Reduced motion.** Under OS `prefers-reduced-motion: reduce` the player opens paused at step 0 with the centered `Play` and the phase-5.md S1 lines (p6-spec §11.2). Reduce flashing reads `fireworks.reduceFlashing.v1` and obeys 6a.6. | spec, running app (emulated) |
| 6h.4 | **Ends.** At `E`, the stage is empty and the ended state shows a `Replay` button with `{name} has ended.` under it; focus doesn't move, and the polite region says `The show has ended.` (p6-spec §11.2). Replay starts again from step 0 and reproduces the same ledger and count trace (same engine). It never loops, and nothing stops at `duration`. | spec, running app |
| 6h.5 | **Text only.** The overlay shows `name` as text (a name `<b>x</b>` renders the characters). "Remixed from" is not rendered (Boo C10). | spec |

## 6i. Scrubbing

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6i.1 | **Re-run from t=0.** Scrubbing to time T gives the state of a straight run to step `round(T × 120)`:<ul><li>the count by kind is equal;</li><li>positions are bit-identical (same browser, same code);</li><li>the ledger so far is equal: each cue up to T appears once, with no double fire.</li></ul>This holds for scrubbing forward, backward and into the tail. | spec |
| 6i.2 | **Exact, even at the cap.** It holds even when the 40k cap is reached before T. If Phase 6 uses checkpoints instead of a full re-run (schema.md §13 caveat), they must be exact. "Fast-forward from T − 21 s" fails this criterion. **Negative control:** a seek that starts from T − 21 s fails on a capped fixture. | spec + recorded mutant |
| 6i.3 | **No side effects.** A scrub sets no dirty flag, writes no draft and makes no request. Play after a scrub continues from T with no backlog. | spec |
| 6i.4 | **Seek performance, accepted as measured** (Skyler ruling). A seek longer than 300 ms shows `Catching up to {m:ss.s}…` (`role="status"`) until it lands, and a newer seek replaces an older one (p6-spec §5.3). The measured worst case of about 3.6 s passes; there is no time limit on a seek at the gate. 6i.1 and 6i.2 exactness still hold. **Revisit trigger:** if a seek on a saved show exceeds 1 s p95 in Chrome, it's raised for Phase 7, not failed here. | running app (Chrome), recorded |

## 6j. `/mine` with shows

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6j.1 | **No kind filter.** The ledger is exactly `[GET api/me/creations?page=1&pageSize=24]`, with **no** `kind` (both kinds; this replaces Phase 5's `kind: 'shell'` in `mine.store.ts` l.47). Show cards render in response order with `name` as text, palette swatches (over all embedded shells, schema.md §2.2), the kind word as the marker (`Show · Updated …` or `Shell · Updated …`, p6-spec §12) and no `<canvas>`. | spec, running app |
| 6j.2 | **Card actions.** Open on a show goes to `/c/{code}` and then the builder (6g.1). Share copies `/s/{code}`. Delete works as 5g.6. | spec |
| 6j.3 | **Write switch.** Unchanged from 5g.1 and 5g.2. | spec |

## 6k. Carried and deploy

| # | Criterion (pass condition) | Surface |
|---|---|---|
| 6k.1 | **F11 is closed** (see the reconciliation below). It needs no further work for shells. N1 extends it to show paths (6f.7). | — |
| 6k.2 | **Built image.** A cold load and a reload of `/show`, `/s/{showCode}` and `/c/{showCode}` return 200 `text/html` and render the right page. | running app (built image), `curl -i` |
| 6k.3 | **Railway (deferred):** 6k.2 on the Railway URL. | Railway |
| 6k.4 | **Railway round trip (deferred).** With writes switched on for the window, 6b.3 runs on the Railway URL with browser B on a second device. Writes are switched off afterward, and the show's link still plays (5i.4 pattern). | Railway |
| 6k.5 | **Engine boundary.** `TimelineDriver` and anything it imports stay under `engine/` with no Angular import (`engine-boundary.spec.ts` is green). | spec |

---

## Done-when map

| Done-when part | Criteria | Runs where |
|---|---|---|
| A 60-second, 50-cue show | 6b.1, 6b.2 | file, running app |
| saves | 6f.2, 6f.3, 6f.5 | running app |
| shares | 6f.9, 6b.3 | running app; 6k.4 on Railway |
| plays in two browsers (runs in each; not matching fidelity) | 6a.1–6a.4, 6a.8, 6b.3; same-engine exactness 6a.5–6a.7 | running app: Chromium + Firefox + WebKit where installable, else Safari by hand |
| through to the last particle of its tail | 6a.2, 6c.7, 6h.4 | running app |

## F11 reconciliation

The code closes F11. `designer-copy.ts` l.85–88 returns `${field} must be a whole number` for `type` with `options[0] === 'integer'`. `save-copy.spec.ts` l.49 asserts `'Stars (Break 1) must be a whole number'`. My 5h verdict stands. Mario's gate line ("plan-carried F11 … due by Phase 6") is stale. It doesn't fail anything, so I'm recording it here instead of reopening it. A different gap does remain for shows, as finding N1.

## Questions settled (Skyler, 2026-11-14)

- **Q1 (second browser): settled.** The show must run in each browser; tests verify that it works, not matching fidelity. Chromium plus Firefox and WebKit through Playwright where installable, else Safari by hand (§6a). Exact ledger and digest determinism stays a same-engine spec (6a.5).
- **Q2 (built by hand?): settled, coordinator default.** The harness may seed the 50-cue fixture; the UI still adds, moves and deletes at least one cue, and Save goes through the builder (6b.2).
- **Q3 (`starBudget` for shows): settled, coordinator default.** The show player and the builder preview use `starBudget` 1 until Phase 7 (6h.1).
- **Show JSON (p6-spec §9.5): deferred to Phase 7** (Skyler, 2026-11-14). No criterion in this file covers it, so nothing here is marked deferred; Phase 7 acceptance picks it up.
- **Also ruled:** session-only Undo, 50 steps (6c.11); no in-place shell edits (6d.6); seek performance accepted as measured (6i.4); route `/show` (Mario confirms at the gate).

## Findings for the team

- **N1 (`engine/model/labels.ts` `fieldLabel`, Luigi and Rosalina).** Show issue paths don't map to field language:
  - `fieldLabel('cues[3].seed')` returns the raw path `cues[3].seed` (`seed` isn't in `FIELD_LABELS`);
  - `duration`, `t` and `x` have no labels;
  - `shells.s1.breaks[0].stars` returns plain `Stars`, losing which shell and which break, because the `breaks` regex is anchored at `^`.

  So the integer wording F11 fixed would read `cues[3].seed must be a whole number`. p6-spec should name the labels, and 6f.7 checks them.
- **N2 (`CreationListItem`, schema.md §2.2, Luigi).** The "my shells" library can't add a shell from the list alone, because the list item has no document. It costs one GET per added shell (6d.2). This is fine, but the plan doesn't say so.
- **N3 (withdrawn).** The production-build ledger readout is no longer required, because cross-browser checks no longer compare ledgers (6a.8). Phase 5's dev-only `window.ng` dependency stays a lesson for smoke tests: observe the page, not dev globals.
- **N4 (cue id reuse, Luigi).** Reusing a deleted cue's `id` doesn't change other cues (seeds are per cue), but a reused id with a new seed can make a before/after ledger diff misleading. 6c.4 asks for no reuse within a draft. Push back if that's costly.
- **N5 (resolved).** p6-spec landed. Route `/show`, transport (6c.8), the tail (6c.7), duration edits (6c.9: blocked), the empty show (6f.2), the library notice (6e.2: none, group hidden), the kind marker (6j.1), labels (6f.7) and caps (6d.3, 6d.4) now cite it. One correction to my own 6h.2: strobe is named only for shells used by a cue (p6-spec §11.3), which is the more accurate rule.
- **N6 (Undo details, Rosalina and Luigi).** p6-spec's Undo exists only as its Q1 recommendation (Redo on Shift+⌘/Ctrl+Z, two toolbar buttons, cleared by link load or New show). It doesn't say what ⌘/Ctrl+Z does while focus is in a text or number field (the browser's own field undo, or the show's). Recommended default: inside INPUT, TEXTAREA and SELECT the browser's field undo wins (the 2c §6.2 exclusion list). Rosalina should confirm in p6-spec; 6c.11 doesn't test that case until she does.

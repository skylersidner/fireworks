# Yoshi — History (fireworks)

## Core Context

- **Project:** Fireworks Sandbox. Design, save, share and play fireworks shells (and later timed shows) in the browser.
- **Stack:** Angular 22.2 (standalone, zoneless, signals, Signal Forms, Tailwind 4), PixiJS 8.23.0 (pinned), .NET 11 API with EF Core and Postgres 18 (`jsonb`), Docker, Railway.
- **Owner:** Skyler Sidner.
- **Plan:** `plans/initial-implementation.md`. Phases 0–8. Identity model in §3.4: anonymous play, persistence owned by a user ID, and a configured default user until the Phase 8 auth pass.
- **Architecture reference:** `/Users/skylerasidner/personal projects/monster-of-the-week-net-angular`. Mirror its structure and conventions; never its domain.
- **Prototype:** `prototypes/fireworks-prototype.html` is the visual and behavioral parity oracle. Background is in `docs/fireworks-app/context.md`.
- **Your focus here:** Engine module boundaries (Phase 2a), the creation schema and version policy (Phase 3, `docs/fireworks-app/schema.md`), the identity seam (`ICurrentUser`, plan §3.4), and auth architecture (Phase 8).
- Carried over from the previous project: the role only. No history was copied. General lessons from that project are seeded as standing decisions in `.squad/decisions/README.md`.

## Learnings


### 2026-11-12 — Phase 0 rulings (cross-agent update)
- Run the Signal Forms spike with Luigi before 2c (OQ17).
- Phase 3 schema must state two things: show-vs-shell sky precedence (one sim, one gravity) and `burstHeight` as a fraction of ground height (760), not of the 800 sky.
- Phase 4 may need a dev-only second user, to exercise the non-owner path (see §3.4 interim identity).

### 2026-11-12 — Phase 1 parity review
- Skeleton mirrors the reference closely: slnx, Dockerfile, railway.toml, .gitignore wwwroot rule, tsconfig.json/app, .postcssrc, .prettierrc are identical modulo names; Program.cs follows the 16 steps (identity registration added between 1 and 2). Diff the reference with name substitution (`sed 's/MonsterOfTheWeek/X/'`) to find real deviations fast.
- Unrecorded toolchain drift: npm 11.17.0 (ref 11.12.1), Vitest 5.1.0 (plan §2 says Vitest 4), jsdom 30. Only in Luigi's history, not a record.
- Phase 8 seam really touches the identity module too (IdentityRegistration's DefaultUserId guard, initializer seeding, auth middleware, AllowAnonymous on health/fallback/share GET). Services/controllers/schema stay untouched. Record: `yoshi-phase1-parity-review.md`.
- `ServiceErrorType` has no Forbidden; Phase 4 write gate needs it. `[Authorize(Policy)]` without an auth scheme throws on Forbid.
- Canary `canary-scene.ts` imports pixi.js outside engine/render: Phase 2a boundary spec must not allow-list it.
- OQ17 ruled by Skyler (via coordinator): Signal Forms on Angular 22.2.x. Installed @angular/forms 22.2.6 marks `./signals` @publicApi 22.0; only WebMCP pieces are @experimental.
- Running `dotnet list package` in the reference repo restores it (writes its obj/); harmless but note it.

### 2026-11-12 — Phase 1 follow-up plan edits
- Skyler ruled "My creations follows the write switch" before Phase 8. I settled 403 over empty 200 (honest, same gate test as writes; client never calls when canWrite false). Record: `yoshi-phase1-plan-followups.md`; README §5 row added on coordinator's instruction (Skyler's rulings go there).
- Plan now: §3.4 lists ICurrentUser's three members; Phase 4 has service-layer gate + Forbidden, 404 for non-owned, IP-partitioned limiter, EndpointDataSource gate test; Phase 8 lists the real identity-module seam; Phase 1 Done-when names the Postgres-gated suite; 2a boundary spec has no allow-list (canary moves or dies); 2c lists Luigi's open token/toast items for Rosalina.
- Shipped toolchain vs reference: npm 11.17.0 (ref 11.12.1), Vitest 5.1.0 (ref ^4.0.8), jsdom 30.1.3 (ref ^28), Angular 22.2.6 exact (ref ^22.0.7). `IdentityOptions` rename to `DefaultUserOptions` still pending (Bowser, before Phase 4).

### 2026-11-12 — Phase 1 cross-agent update (Scribe)
- The `IdentityOptions` to `DefaultUserOptions` rename is done (Bowser's fix round). Item 2 of `yoshi-phase1-parity-review.md` is closed, and the "rename still pending" line above is stale.
- Item 1's accepted `System.Security.Cryptography.Pkcs` 10.0.13 pin no longer exists. `decisions/records/bowser-net11-retarget.md` removed it, along with the `e_sqlite3` pin, when the backend moved to net11.0. Drop it from the accepted-deviation list. The record is not marked superseded, because its other items still bind.

### 2026-11-12 — Phase 2a engine-boundary review
- The boundary spec (`engine/engine-boundary.spec.ts`) checks direct package specifiers only. Bypasses: relative `sim -> ../render/pixi-renderer`, an `app/` static import of `pixi-renderer.ts` (Pixi leaves the lazy chunk), `` import(`pixi.js`) ``, `import('pixi.js', {with})`, `'a//b'` strings eating a line, `@pixi/*`, no `@angular` rule for `render/`. Fix: layer-edge rule, transitive reach rule, fail-closed parser. Skill: `.squad/skills/import-boundary-spec/SKILL.md`.
- Today's real edges are clean: model leaf; sim->model; loop->model,sim; render->model,sim; app dynamic-imports pixi-renderer only (`fireworks-stage.ts` l.59).
- No module-level `let`/`var` in the engine; PRESETS deep-frozen; DEFAULT_SKY/BREAK/QUALITY and COLORS are `Readonly` in type only.
- Ruled: `sky` absent stays absent (2a.6(f) means effective value). normalize gains `adjustments` (path/kind/from/to) and structured `errors`; Phase 3 strict validator = normalize + zero adjustments. Missing `version` must become a `defaulted` adjustment. Record: `yoshi-phase2a-engine-boundaries.md`.
- Phase 6 inheritance: TimelineDriver needs a per-step hook (`beforeStep`) with an integer step counter, plus `fireSeeded`. Worst-case shell lifetime at the limits is about 21 s (rise 5.7 + delays 7.5 + burn 5.6 + crossette/glitter tail about 2.2), which bounds the seek fast-forward window.
- Toolchain: `ng test` needs `export PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"`. The sustained-load cap spec takes about 2.6 s and hit the 5 s timeout once in a full engine run.

### 2026-11-13 — Phase 2 cross-agent update (Scribe)
- Luigi's `ShellIssue` (`engine/model/normalize.ts`) also carries `code` (`not-object | version | type | enum | break-count`), `value` and `options`, beyond your §4 shape (`path`, `message`). Luigi says the C# validator mirrors `path` and `AdjustmentKind`, not `code`. Decide in the Phase 3 schema doc: document `code` as a field, or drop it.
- Your Phase 3 rule (validator = normalize plus zero adjustments) stands and is the Phase 3 target. Peach's earlier note that normalize shipped `adjusted` with no `kind` is resolved: current normalize has `kind` and `adjustments`.

### 2026-11-13 — Phase 3 creation schema
- Wrote `docs/fireworks-app/schema.md` and record `yoshi-phase3-creation-schema.md`; skill `cross-language-validator-parity`.
- Shipped `normalizeShell` returns only `errors` when any exist (adjustments dropped) — strict mode needs both; told Luigi. Codes map 1:1 from adjustment kinds (`defaulted`→`missing`, `clamped`→`out-of-range`, `rounded`→`not-integer`, `truncated`→`too-long`, `dropped`→`unknown-property`, new `cleaned`→`name-format`).
- Names: remove Cc + unpaired surrogates, trim explicit JS-trim set, blank→Custom, cut at 80 code points; one issue per name. Postgres jsonb rejects `\u0000`; C# `Trim()` misses U+FEFF.
- Show v1: required `sky` (wins); embedded shells keep `version`, lose `sky`; `shells` map 0..32 keyed `^[A-Za-z][A-Za-z0-9_-]{0,11}$`; cues 0..1000; cue `burstHeight` optional not null; `fireStep = Math.round(t*120)`, order `(fireStep, id)` (supersedes 2a point 8 wording, noted in that record).
- Measured: typical 1000-cue show 72 KB, worst case 215 KB → request limit 256 KiB, not the plan's 64 KiB.
- Remix must take `{ document }` (Phase 5 "saving becomes a remix"). Palette/name/schema_version computed at write → server never re-reads documents, no server upgraders.
- jsonb drops key order: never give key order meaning; SQLite TEXT keeps it, so tests compare parsed JSON.
- Open for Skyler: Q1 cue t launch vs burst, Q2 playback-stability promise, Q3 remixedFrom visibility, Q4 empty shows/caps, Q5 blank-name save.
- Plan edits pending review/ruling: §3.3 cue burstHeight, Phase 4 (limit, JsonElement walker, remix body, palette column). `context.md` l.25 burstHeight description is stale.

### 2026-11-13 — Phase 3 rulings folded in
- Skyler: Q1 cue `t` = launch time; Q2 share links NOT locked (goldens are regression guards, intentional sim change updates them by reviewed change, bumps are for document shape only); Q3 `remixedFrom` owner-only, `null` for others; Q4 no empty shows (`cues: []` → `cue-count`; `show.cues.count` min 1; `shells` keeps min 0 since `unknown-shell` implies ≥1); Q5 blank name → "Custom".
- My reading of "shape only": a change in a stored value's *meaning* that needs values rewritten still bumps, because upgraders key on version. Changed lenient defaults and loosened ranges don't bump.
- Edited in place: schema.md (§2.1, §2.5, §4, §4.3, §4.4, §5.1, §6.2–6.4, §8.1, §12, §14 now "Rulings", §15), plan §3.3 and Phases 3–6, `context.md` l.25, my Phase 3 record. README §5 got 5 rows (coordinator-instructed).
- Postgres `varchar(n)` counts characters (code points), so `name varchar(80)` matches the 80-code-point rule.

### 2026-11-13 — Phase 3 validator feasibility folded in
- Bowser's .NET 11 probes overturned three §6.5 claims: `TryGetDouble` is true with +Infinity for `1e400` (need `IsFinite`); `AllowDuplicateProperties=false` has no path (walker detects via `EnumerateObject`, last wins); `GetString`/`JsonProperty.Name`/`ValueEquals` throw on lone surrogates (`Utf8.IsValid` gate, wrapped `ValueEquals`, raw-token fallback). Plus: manual body read with `[Consumes]`, `\z` not `$` in C#. Lesson: an API claim in a spec is a hypothesis until a probe runs; I'd written "verify with a probe" and it paid off.
- Settled (schema.md §2.6, §6.2 rules 7–13): envelope issues stop the document walk entirely; `shells` absent → missing, `cues` absent → cue-count; key set = keys passing key-format; one duplicate-key per name; bracket path form for non-identifier names with U+FFFD for lone surrogates (overruled Bowser's raw-escape path). Harness translates the two root-not-object fixtures to `(document, not-object)`.
- Luigi's TS walker (`normalize.ts`) already matched Bowser on every edge before I settled them; the remaining TS change is bracket paths in `dropUnknown`. Lenient-only rules (seed never rounded) need `normalize.spec.ts` specs because strict fixtures can't tell round from refuse.

### 2026-11-13 — Phase 3 final doc pass (rulings L1–L4)
- Skyler: links always open a dirty working copy (L1); owned source → "Update original" (PUT) / "Save as new", else remix (L2); link over dirty asks only if shell/sky dirty (L3); show runs until last particle fades, `duration` = launch window (L4). README §5 got 4 rows (coordinator-instructed).
- My calls: "Save as new" uses `POST …/remix` (lineage, and makes Done-when step 3 observable while `isOwner` is always true); `/c/:code` is load-then-redirect with `replaceUrl` so the draft carries the copy; draft `source` set only by link load or save; no dev-only second user (stubbed `isOwner:false` call-ledger spec instead).
- Reference paging convention: `SearchController.Get` + `PagedSearchResultResponse(Items, Page, PageSize, TotalCount)`, offset, 1-based, clamps silently but echoes the *requested* values (we echo effective). `GET api/me/creations` mirrors it with `pageSize` 24 (max 100), `kind` filter, order `updatedAt` desc + `shareCode`.
- `upgradeShell` has no non-spec caller yet; Dockerfile copies only `src/web/fireworks-web/` and `src/api/`, `schema/` isn't in `.dockerignore` (Bowser's Phase 4 call).
- Addendum 1 point 7 (driver doesn't fire a cue past clamped duration) superseded by L4.

### 2026-11-13 — Phase 4 security requirements folded into schema.md
- Boo's S1–S29 folded in place: §2.1 (S13 overruled by Skyler: `isOwner` only, interim exposure accepted), §2.2.1 query rules, §2.4 cap, §2.5 rewritten as settled, §2.6 order (429, 403 gate, 415, 413, 400 envelope, 404 lookup, 400 document), new §2.7 status/rate-limit tables, §6.5, §9; plan §3.3, §3.4, Phase 4; README §5 row edited in place.
- S25 adopted: 400 body is exactly `{ message, errors, truncated }`, ≤100 issues, `truncated` always present; cap at the 400-body builder, validators stay complete, so no fixture changes. Cap test is code-built in the harness, not a fixture (server-only format is a complete multiset).
- Probe finding (scratchpad, .NET 11): `[FromQuery] string?` turns `kind=`/`kind=%20` into null and takes the first of repeated values; `long?` gives ModelState ProblemDetails for `abc`/over-long. So the list query reads `Request.Query` directly. Added as trap 7 in `aspnet-request-gates` skill.
- Bowser's in-progress code (2026-11-13) still has `[Consumes]`, `regex(...)` route, `int page` binding; he has Boo's record but the query-reading rule and the cap are mine and new to him.

### 2026-11-13 — Phase 4 architecture review
- Backend conforms: gate order (limiter → `TryGetWriter` → `HasJsonContentType` → capped read → envelope → code re-check + lookup → document walk), `JsonWalk.ChildPath` is a line-for-line port of TS `childPath` (C# `\z` vs JS `$` equivalent), stored document is `CreationDocuments.Serialize(dto)`, name/version/palette from the DTO, remix `{document}`, PUT owner-filtered, `isOwner ? source : null`, no `[Authorize]`, services take identity only from `ICurrentUser`.
- Accepted Bowser's 5 departures; doc edits in schema.md §2.1 (µs timestamps, compare `updatedAt` as string), §2.6 (routing precedes gate; DELETE order), §2.7 (fixed 404 text, 415 is ProblemDetails — measured, 413 `Connection: close`), §9 ("C" collation: equality vs ordering), §11.2 (404 on PUT/remix → plain POST fallback), §11.4 (last-write-wins; `If-Match`→412 trigger). Plan Phase 5 Save bullet edited. Record `yoshi-phase4-architecture-review.md`.
- Defects for Bowser (reasoned, not probed): `UpdateOwnedAsync` `State = Modified` rewrites `remixed_from_id` → FK 500 if source deleted mid-request; remix insert after source delete → FK → `TryInsertAsync` rethrows → 500 (should be 404); stale doc comments in `CreationEnvelopeReader` (`[Consumes]`, "step 6") and controller (`{ message, errors }` without `truncated`).
- Probe pattern: rsync `src/api` + `schema/` + `Fireworks.slnx` into scratchpad, drop a throwaway xunit test using `FireworksApiHarness.StartAsync(writes, UnthrottledRateLimits)` and `CreationApiHarness.SendRawAsync`; `dotnet test --filter` runs in ~40 s. No `timeout` binary on this mac.
- Lesson: my own §11 said "offer Save as new" after a PUT 404 without checking that Save as new (remix) also looks the source up. Trace every fallback through the endpoint it calls.

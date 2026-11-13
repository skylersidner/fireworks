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

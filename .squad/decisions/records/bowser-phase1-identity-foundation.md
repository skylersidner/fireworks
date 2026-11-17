# Phase 1 identity foundation: ICurrentUser carries CanWrite, identity config is validated eagerly

> Superseded in part by bowser-phase8-server-auth.md on 2026-11-16: `DefaultUserCurrentUser` and the `Identity` section validation (points 1 and 2) are removed. Any `Identity:*` key now stops startup, and `ClaimsCurrentUser` replaces the interim implementation.
**By:** Bowser (Backend Developer / DevOps) · 2026-11-12 · Phase 1a

## What
1. **`ICurrentUser` has a third member, `bool CanWrite`,** next to the plan's `UserId` and `IsAuthenticated` (plan §3.4 lists only those two). The interim `DefaultUserCurrentUser` returns `Identity:AllowAnonymousWrites`; the Phase 8 claims implementation returns `IsAuthenticated`. `GET api/me` reports it, and **Phase 4 write endpoints gate on `ICurrentUser.CanWrite`**, not on `IdentityOptions`.
2. **The `Identity` section is read and validated while the host is being built** (`IdentityRegistration.AddFireworksIdentity`, called right after the connection-string guard in `Program.cs`), not with `ValidateOnStart()`. A missing, blank, non-GUID or empty-GUID `DefaultUserId`, or a non-boolean `AllowAnonymousWrites`, throws `InvalidOperationException` naming the key. A missing `AllowAnonymousWrites` means `false`.
3. **The default user's row is inserted if missing and never overwritten** (`FireworksDbInitializer.EnsureDefaultUserExistsAsync`). A duplicate-key race between two booting instances is resolved by re-checking that the row exists, not by matching a SQLSTATE.
4. **Program.cs is also tested as itself:** `ProgramStartupTests` (always runs) and `ProgramOnPostgresTests` (`[PostgresFact]`) launch the built `Fireworks.Api.dll` as a child process. The Kestrel harness re-implements the pipeline, and a measured mutant (deleting `/api/{**rest}` from Program.cs) passes everything except the process test.

## Why
1. "Services get identity only through `ICurrentUser`, never by reading config." If `CanWrite` weren't on the interface, every write service in Phase 4 would need `IOptions<IdentityOptions>`, which is config, and Phase 8 would have to touch each of them. With it there, Phase 8 stays a one-registration swap, as §3.4 promises.
2. `ValidateOnStart()` fires inside `app.Run()`, after `FireworksDbInitializer` has migrated the database and seeded a user from a value nobody checked. The plan says "fails fast"; eager validation stops the process before it opens a connection (proven by `ProgramStartupTests`, whose connection string points at a closed port).
3. A hand-edited display name surviving a restart is the least surprising behavior; the race guard follows `boo-race-guards-check-desired-state.md`.
4. `toad-oracle-and-real-host-shapes.md`: a test host should bind what the real call site binds. The harness can't run Npgsql, so the process test is the only way to test the real call site.

## Boundary
- Applies to the interim identity and to Phase 4 write gating. Phase 8 may change what `CanWrite` means but should keep it on `ICurrentUser`.
- The name `IdentityOptions` collides with `Microsoft.AspNetCore.Identity.IdentityOptions` (which is in the shared framework but not imported). If Phase 8 adopts ASP.NET Core Identity, rename ours. The registration class is `IdentityRegistration` because `IdentityServiceCollectionExtensions` already exists in `Microsoft.Extensions.DependencyInjection` and was ambiguous (CS0433).
- Boo should review `CanWrite` as the write gate in the Phase 4 security-review.

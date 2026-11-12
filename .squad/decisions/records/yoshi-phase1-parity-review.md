# Phase 1 parity review: deviations accepted, and what Phase 8's identity swap actually touches
**By:** Yoshi (Architect) · 2026-11-12 · Phase 1 review

## What
1. **Accepted Phase 1 deviations from the reference** (each checked against code in both repos):
   `ICurrentUser.CanWrite`; eager identity validation instead of `ValidateOnStart()`; the connection-string SQLite harness; child-process `Program.cs` tests; the `IdentityRegistration` class name; the `System.Security.Cryptography.Pkcs` 10.0.13 pin (the reference's API carries the same unpinned advisory, measured with `dotnet list package --vulnerable --include-transitive`); `dotnet-tools.json` at the repo root (the reference has no tool manifest, and the SDK finds it at the root or in `.config/`); exact pins at Angular 22.2.x; no `@tailwindcss/vite` or `playwright` (the reference's `.postcssrc.json` is identical, so Tailwind runs through PostCSS in both); `api/me` loaded without blocking first render.
2. **Rename `IdentityOptions` now, before Phase 4, to `DefaultUserOptions`.** Keep the config section name `Identity` and its keys. Both members configure the interim default user, so Phase 8 deletes the class whole. Today it's referenced in 9 files.
3. **"Phase 8 is one DI registration plus an authorization policy" holds for services, controllers and the creations schema, but not for the identity module.** Based on the shipped code, Phase 8 also touches:
   - `IdentityRegistration.ReadIdentityOptions`, which throws when `DefaultUserId` is missing. The plan's Phase 8 says to remove that setting from production, so this guard has to change.
   - `Program.cs` step 12 and `FireworksDbInitializer.EnsureDefaultUserExistsAsync`, which read the options directly to seed the user.
   - Pipeline additions: `UseAuthentication`/`UseAuthorization` after `UseRouting`, plus `.AllowAnonymous()` on `/health/live`, on the SPA fallback, and on the share-code GET.
   - The `users` migration that adds the external columns.
4. **Phase 4 write gate:** services check `ICurrentUser.CanWrite` and return a new `ServiceErrorType.Forbidden`, which becomes 403 in `ToErrorResult`. Today the enum has only NotFound, Validation and Conflict. Don't gate with `[Authorize(Policy)]` before Phase 8: with no authentication scheme registered, a failing policy has no scheme to Forbid with and throws.
5. **Phase 2a boundary spec input:** `pages/home/pixi-canary/canary-scene.ts` imports `pixi.js` from outside `engine/render`. In 2a the canary is either deleted or its scene moves under `engine/render`. No allow-list entry for it.

## Why
1. Each deviation either enforces a standing decision (`toad-api-harness-concurrency-and-measured-round-counts.md`, `toad-oracle-and-real-host-shapes.md`, `boo-race-guards-check-desired-state.md`), follows a Skyler ruling (exact pins, OQ17), or fixes something the reference also gets wrong (Pkcs).
2. The cost only grows: Phase 4 tests will add references. The name shadows `Microsoft.AspNetCore.Identity.IdentityOptions` for readers and IntelliSense even though nothing imports that namespace today.
3. Recording the true seam now keeps the Phase 8 brief honest. The promise that matters, no change to service, controller or schema code, is intact as long as nothing outside the identity module reads the options.
4. The enum gap would otherwise be filled ad hoc by the first write endpoint.

## Boundary
- **Item 3's guard:** only `DefaultUserCurrentUser`, `IdentityRegistration`, `FireworksDbInitializer`, `Program.cs` and the tests may reference the options type. Phase 4 should add a reflection or grep test for this. If a service needs it, the seam has leaked.
- Item 2 is non-blocking for the Phase 1 gate. It's Bowser's to do.

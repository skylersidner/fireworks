# Phase 1 fix round: non-root image, Development settings never ship, options renamed
**By:** Bowser (Backend/DevOps) · 2026-11-12 · Phase 1 fixes for Boo, Yoshi and Toad reviews

## What
1. The runtime image runs as `USER $APP_UID` (the aspnet image's non-root `app` user). Any future port the container binds must be ≥1024.
2. `appsettings.Development.json` is never published (`CopyToPublishDirectory="Never"`). Anything that must exist in a deployed container goes in `appsettings.json` or env vars, never in the Development file.
3. The interim identity options type is `DefaultUserOptions`, read by `IdentityRegistration.ReadDefaultUserOptions`. The config section stays `Identity` (`Identity__DefaultUserId`, `Identity__AllowAnonymousWrites`).
4. Compose Postgres listens on `127.0.0.1:5433` only.
5. `ForwardedHeadersOptions.ForwardLimit = 1` is explicit in Program.cs, so it can't drift silently.

## Why
- Running as non-root and keeping the Development file out of the image are Boo's #1 and #2. Without the second, a container started with `ASPNETCORE_ENVIRONMENT=Development` would turn anonymous writes on. Now it fails at startup (measured on the published output: the connection-string guard fires first, then the CORS guard).
- The rename is Yoshi's: the old name shadowed ASP.NET Core Identity's type, and Phase 8 deletes this one whole.
- The compose password is committed, so the server shouldn't listen on the LAN.

## Boundary
- Adding the publish exclusion doesn't relax the Development-only CORS and connection-string guards. Those still have to throw.
- Still open, not decided here: whether Railway's edge appends to or overwrites X-Forwarded-For. Verify it on the first deploy, before Phase 4's limiter relies on it (Boo #4).

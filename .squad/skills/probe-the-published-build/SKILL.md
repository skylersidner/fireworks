# Skill: Probe the published build, not the repo's build output

**Domain:** Security review, release checks
**Applies to:** any review question about "what would ship": pipeline order, headers, what's in the image, and production error bodies
**Confidence:** medium (Phase 1, 2026-11-12)

## Why
- The repo's `bin/` and `obj/` folders are shared with agents running mutation checks. A build there can contain a mutant that's in flight (this happened in Phase 1: `/health/live` served index.html from a Release build made while `MapHealthChecks` was deleted).
- The Docker runtime stage copies only `dotnet publish` output, so the publish folder is the image's app content.

## Steps
1. Copy `src/api/Fireworks.Api` to the scratchpad, excluding `bin`, `obj` and `wwwroot`. Run `dotnet publish -c Release -o <scratch>/pub`.
2. List `<scratch>/pub`. That is the image's `/app`, plus the SPA. Look for `appsettings.Development.json`, `BuildHost-*`, test dlls and any `*.json` stats file.
3. Run it with `env DOTNET_ROLL_FORWARD=Major ASPNETCORE_ENVIRONMENT=Production ASPNETCORE_URLS=http://127.0.0.1:5199 "ConnectionStrings__Postgres=...;Database=<throwaway>" dotnet Fireworks.Api.dll --webroot <repo wwwroot>`. Start it with the tool's background mode. Shell `&` processes die between calls, and `env` is needed for keys that contain dots.
4. Probe it with curl: `/health/live`, `/api/nope`, `/api`, odd case, `POST` on a GET route, Swagger paths, `Origin:` headers, and the deep links.
5. For an honest 500, drop the throwaway database while the app runs (`DROP DATABASE … WITH (FORCE)`). Then hit an endpoint that touches the database and check the ProblemDetails body.
6. If anything looks broken, compare the source's mtime with the dll's before reporting, and republish from a fresh copy.
7. Clean up: kill the port's listener and drop the throwaway databases.

## Docker-image variant (Mario, Phase 4 gate, 2026-11-13)
- `docker build -t fireworks:<tag> .`, `create database <fresh>` in `fireworks-postgres`, then `docker run --network fireworks_default -p 127.0.0.1:<port>:8080 -e 'ConnectionStrings__Postgres=Host=fireworks-postgres;Port=5432;Database=<fresh>;…'`. The log must show `Applying migration` for each migration. EF's one `fail:` on `SELECT … FROM "__EFMigrationsHistory"` on a fresh database is normal.
- **Second identity before Phase 8:** run a second container against the same database with `-e Identity__DefaultUserId=<another guid>`. Two default users give a real ownership test (PUT/DELETE on the other's code is 404, `isOwner` false, `remixedFrom` null for the non-owner).
- Writes on with `-e Identity__AllowAnonymousWrites=true`; rerun without it for the 403 checks (form bodies too) and `/api/me/creations` 403.

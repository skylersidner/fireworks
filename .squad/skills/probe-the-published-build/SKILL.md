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

# Skill: Test the real Program.cs as a child process

**Domain:** Backend tests (`Fireworks.Api.Tests`)
**Applies to:** startup fail-fast checks, middleware order, anything in `Program.cs` that a re-implemented Kestrel harness repeats instead of running
**Confidence:** high. Measured in Phase 1 (2026-11-12): deleting `app.Map("/api/{**rest}", …)` or `app.MapHealthChecks(...)` from `Program.cs` passed every harness test and failed only the process test.

## The pattern
The test project references the API project, so `Fireworks.Api.dll`, its `runtimeconfig.json`, `deps.json` and both `appsettings*.json` land in the test output folder. `Support/ApiProcess.cs` runs `dotnet Fireworks.Api.dll` from there:

- **Scrub the inherited environment** (`ASPNETCORE_*`, `DOTNET_ENVIRONMENT`, `ConnectionStrings__*`, `Identity__*`, `Cors__*`) and state the whole config in the test. Keep `DOTNET_ROLL_FORWARD` inherited.
- **Binary:** `DOTNET_HOST_PATH` (set by `dotnet test`) or `dotnet`. **Working directory:** the dll's folder, so the content root finds `appsettings.json`.
- **Port:** `ASPNETCORE_URLS=http://127.0.0.1:{free port}`; wait for `Now listening on` in the output.
- **wwwroot:** pass `--webroot <temp dir>` with an `index.html` holding a marker (`Support/TempWebRoot.cs`). Without a file the SPA fallback 404s by itself, and "/api/nope is 404" passes vacuously.
- **"Missing" config through the environment:** set the variable to an empty string (`Identity__DefaultUserId=`), which overrides the committed value.
- **"Before the database":** point `ConnectionStrings__Postgres` at `127.0.0.1:1` and assert the output does *not* mention `Npgsql`. Pair it with a control (valid config, same dead DB) that *does* mention it, so the absence means something.

## When to use the harness instead
For JSON shapes, model binding and per-endpoint behavior, use the SQLite Kestrel harness (`Controllers/FireworksApiHarness.cs`): it's faster and needs no Postgres. Use the process test for the pipeline itself, and run the gated suite (`FIREWORKS_TEST_POSTGRES`) before calling backend work done.

## Options validation and the database (2026-11-15)
- **`ValidateOnStart()` runs inside `app.Run()`, after Program.cs's migrate block.** A "fails before the database" test with only `ValidateOnStart` sees the Npgsql error first. Run the same `DataAnnotationValidateOptions<T>` eagerly in the registration method (see `ClientConfigRegistration`) and keep `ValidateOnStart` as the backstop.
- **`IOptions<T>` resolves with class defaults even if nothing registers it.** A test that only checks default values can't see a missing registration in Program.cs. Pair it with an environment-variable override (`Section__Key=...`) against the real program, and assert the overridden value comes back.
- Add the section's `Section__` prefix to `ApiProcess.ScrubbedPrefixes`, so a variable in your shell can't leak into a test.


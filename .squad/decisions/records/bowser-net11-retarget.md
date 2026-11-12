# .NET 11 target, EF Core held at 10.x until Npgsql 11 is stable

**Author:** Bowser · **Date:** 2026-11-12 · **Trigger:** Skyler's ruling to retarget the backend to .NET 11 (the installed SDK 11.0.100 / runtimes 11.0.0).

## What
- `Fireworks.Api` and `Fireworks.Api.Tests` target `net11.0`. The Docker stages use `mcr.microsoft.com/dotnet/sdk:11.0` and `aspnet:11.0`. Nothing needs `DOTNET_ROLL_FORWARD`.
- **EF Core stays on one 10.x major across the repo:** `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3, `Microsoft.EntityFrameworkCore.Design` 10.0.15, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.15 (tests), `dotnet-ef` 10.0.15 (tool manifest).
- `Swashbuckle.AspNetCore` 11.0.1.
- The `System.Security.Cryptography.Pkcs` and `SQLitePCLRaw.lib.e_sqlite3` pins are removed.

## Why
- On 2026-11-12 the NuGet flat-container index for `npgsql.entityframeworkcore.postgresql` ends at `11.0.0-rc.3`, with no stable 11.x. Its 10.0.3 nuspec depends on `Microsoft.EntityFrameworkCore[.Relational]` `[10.0.4, 11.0.0)`. Microsoft's EF Core 11.0.0 is stable, but using it would break the provider's range, so EF has to stay on 10.x. EF Core 10 packages run on net11.0 (build: 0 warnings; plain and Postgres-gated test suites green; the image migrates on start).
- `dotnet nuget why` shows that EF Design 10.0.15 no longer depends on Pkcs. EF Sqlite 10.0.15 brings e_sqlite3 2.1.13, so the old 2.1.12 pin now fails restore with a NU1605 downgrade error. `dotnet list package --vulnerable --include-transitive` is clean for both projects without either pin.

## Boundary
- **Don't bump EF Core alone.** Move Npgsql EF, EF Design, EF Sqlite and dotnet-ef to 11.x together, and only once a stable (non-preview, non-rc) Npgsql EF 11 exists. Then run `dotnet ef migrations has-pending-model-changes` and both test suites.
- Swashbuckle 10 and later use Microsoft.OpenApi 2.x namespaces. Program.cs only calls `AddSwaggerGen`/`UseSwagger`/`UseSwaggerUI`, so any code that adds OpenApi model types must use the 2.x API.
- The migration files' `ProductVersion` annotation (10.0.0) is left as generated. It doesn't affect the model diff.

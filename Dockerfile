# Shipping only. The development loop is `docker compose up -d postgres` + `dotnet run` + `npm start`
# — see README.md. `docker build` is never part of iterating.
#
# The stage boundary IS the sequencing: stage 1 finishes writing wwwroot before stage 2's MSBuild
# ever evaluates the project. That is what makes an MSBuild target unnecessary — and the Web SDK
# globs wwwroot/** into Content at evaluation time, so a target that populated it during the build
# would publish no SPA at all, silently.

# Stage 1 — build the SPA straight into the API project's wwwroot.
# node:26-alpine, NOT node:22 — .nvmrc pins 26.5.0 and package.json requires ">=26.5.0 <27".
FROM node:26-alpine AS frontend-build
WORKDIR /src/web/fireworks-web
# Manifests first, so `npm ci` is only re-run when dependencies actually change.
COPY src/web/fireworks-web/package.json src/web/fireworks-web/package-lock.json ./
RUN npm ci
COPY src/web/fireworks-web/ ./
# angular.json's outputPath sends this to /src/api/Fireworks.Api/wwwroot.
# The build target defaults to the production configuration, so bundles are content-hashed.
RUN npm run build

# Stage 2 — publish the API with wwwroot already populated.
FROM mcr.microsoft.com/dotnet/sdk:11.0 AS backend-build
WORKDIR /src
COPY src/api/ ./api/
# Only wwwroot crosses over; the Node stage never carries C# source.
COPY --from=frontend-build /src/api/Fireworks.Api/wwwroot ./api/Fireworks.Api/wwwroot
# Target the API .csproj directly, NEVER Fireworks.slnx — the solution also contains
# Fireworks.Api.Tests, which would drag the test project and its SQLite package into the image.
RUN dotnet publish api/Fireworks.Api/Fireworks.Api.csproj -c Release -o /out

# Stage 3 — runtime.
FROM mcr.microsoft.com/dotnet/aspnet:11.0
WORKDIR /app
COPY --from=backend-build /out ./
# Run as the image's non-root `app` user (APP_UID is set by the aspnet base image). Ports >= 1024
# need no privilege, so binding $PORT / 8080 is unaffected. Must come before CMD.
USER $APP_UID
# Railway assigns the port at runtime and the container must bind to it. Kestrel binds HTTP only;
# TLS is terminated at the platform edge.
CMD ["sh", "-c", "ASPNETCORE_HTTP_PORTS=${PORT:-8080} dotnet Fireworks.Api.dll"]

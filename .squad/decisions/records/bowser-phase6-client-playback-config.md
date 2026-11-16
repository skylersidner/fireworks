# Bowser: `ClientPlayback` options and `GET api/client-config`

**Date:** 2026-11-15 · **Phase:** 6 follow-up (Skyler's request) · **Status:** proposed · **Inputs:** coordinator contract for `ClientPlayback`, `boo-phase6-security-verification.md` F1, `luigi-phase6-show-builder.md` point 13.

## What
- `ClientPlayback` section in `appsettings.json` only (not Development): `SeekBudgetMs` 25 (4–100), `CatchingUpDelayMs` 300 (0–5000), `CheckpointIntervalSeconds` 10 (1–60), `CheckpointMemoryMiB` 64 (8–512). All whole numbers (`int`).
- `Services/ClientConfig/ClientPlaybackOptions.cs`: `[Range]` annotations whose messages name the key (`ClientPlayback:SeekBudgetMs must be between 4 and 100 (milliseconds per frame).`). Class defaults equal the committed values; `CommittedConfigurationTests` pins both.
- `ClientConfigRegistration.AddFireworksClientConfig`: `AddOptions().Bind().ValidateDataAnnotations().ValidateOnStart()` **and** the same `DataAnnotationValidateOptions` run eagerly at registration, throwing `OptionsValidationException`. Called in Program.cs step 1, next to `AddFireworksIdentity`, and in `FireworksApiHarness`.
- `Controllers/ClientConfigController.cs`: `GET api/client-config`, `[AllowAnonymous]`, `[EnableRateLimiting(ReadPolicy)]`, returns `ClientConfigResponse(ClientPlaybackConfig)` from `Contracts/ApiContracts.cs`. Exact JSON: `{"playback":{"seekBudgetMs":25,"catchingUpDelayMs":300,"checkpointIntervalSeconds":10,"checkpointMemoryMiB":64}}`. No service layer: it carries no identity and no data access.

## Why
- **Eager as well as `ValidateOnStart`.** The brief said Identity uses `ValidateOnStart`; it does not. `AddFireworksIdentity` validates eagerly because `ValidateOnStart` fires inside `app.Run()`, after step 12's migration. Measured: with only `ValidateOnStart`, `ClientPlayback__SeekBudgetMs=200` against a dead database printed an Npgsql error, not the range message (the "no-eager" mutant fails six process tests). Running the annotation validator at registration keeps the contract's mechanism and the project's "fail before the database" rule, with one validator so the two can't disagree.
- **`IOptions<T>` resolves even when nothing registers it**, with class defaults. So a missing registration in Program.cs serves 25/300/10/64 and looks right. Two tests catch it (corrected 2026-11-15, Phase 7 B1, from Toad's measurement in `toad-phase6-client-config-contract-parity.md`): the ungated `Startup/ClientConfigStartupTests` (6 failures: without the eager registration an out-of-range value no longer stops startup before Npgsql), and the gated real-program test with `ClientPlayback__SeekBudgetMs=40`, which is the only one that shows a served in-range override (expected 40, got 25). The earlier text said only the gated test catches it; that was wrong.
- `[AllowAnonymous]` now so a Phase 8 fallback policy can't 401 the SPA's page-load read.

## Boundary
- The endpoint stays anonymous, identity-free and read-limited. Anything user-specific goes on `api/me`, never here.
- New client knobs join this section with a `[Range]`, a README row, and a field in `ClientPlaybackConfig`; the browser clamps to the same ranges (Luigi's side).
- Values are read once per process (`IOptions`, not `IOptionsMonitor`): a change needs an API restart and a page reload.
- Also fixed: `ApiProcess` scrubbed `RateLimiting__`, but the section is `RateLimits`; it now scrubs `RateLimits__` and `ClientPlayback__` too.

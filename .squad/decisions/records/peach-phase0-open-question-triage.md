# Phase 0 open-question triage (Peach)

**Status:** proposal for the coordinator; Skyler's rulings supersede it.

## What
Plan §5 questions are sorted into three buckets: ask Skyler before Phase 1 (OQ12 naming/ports, OQ5 coordinates, OQ20 interim writes incl. the production value of `AllowAnonymousWrites`, OQ17 forms); accept the default now and re-check at the named phase (OQ3, 6, 7, 8, 9, 10, 13, 14, 16); defer to phase (OQ19 to Phase 8). OQ15 is stale because the tooling already exists.

## Why
Each "ask now" question changes a file Phase 1 or 2 writes (solution/namespace/ports, `appsettings.json`, `api/me` contract, renderer resize/`screenToWorld`, the designer form layer) or the Phase 3 schema freeze. The rest change only route config, optional schema fields, or Phase 4+ work.

## Boundary
This record sorts questions; it answers none of them. Accepted defaults stay defaults until Skyler rules, and the interactions with §3.4 (OQ3, OQ13, Phase 5 isOwner) must be restated in Phase 4/5 acceptance criteria.

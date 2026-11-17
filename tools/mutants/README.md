# Mutant runner

`node tools/mutants/run.mjs --list | --check <set> | <set> [ids…]`. The header of `run.mjs` explains how it works: it uses a private copy of the repo and an exact-swap mutant, checks a baseline first, and never counts a timeout as a kill. `node classify.mjs` self-checks the verdict rules.

It runs at test replacement, at phase gates whose phase touched the mutated code, and at the final review (Skyler, 2026-11-16). It doesn't run daily. Runs are serial, on an otherwise idle machine, and you record the load.

| Set | From | Status on 2026-11-15 (`--check`) |
|---|---|---|
| `c3-web` | Phase 7 C3 (`mut.py`) | 14 of 14 still apply |
| `c3-api` | Phase 7 C3 (`apimut.py`, `apimut2.py`) | 14 of 14 still apply |
| `p6-web` | Phase 6 QA (`toad-p6/mut.py`) | 56 of 65 still apply; 9 are STALE because the code moved, and need new old-text before the §7 step 6 mutant proof |
| `p6cfg-api` | Phase 6 post-gate ClientPlayback (`bmut.py`) | 8 of 8 still apply |

**Postgres mutants (ruling 6, Toad 2026-11-16).** An api mutant with `postgres: true` (today only `phase8-auth` R1, the If-Match race) runs only when `FIREWORKS_MUTANT_POSTGRES` is a connection string whose `Database=` ends in `_mut` or `_test`; the test drops and recreates that database. Otherwise it reports `SKIPPED` (never KILLED) and the run exits 3. Every other mutant still runs with `FIREWORKS_TEST_POSTGRES` stripped. A mutant may also be several exact swaps: `swaps: [{ file, old, new }, …]`, all applied and all restored.

```sh
FIREWORKS_MUTANT_POSTGRES="Host=localhost;Port=5433;Username=fireworks_app;Password=fireworks_dev_password;Database=fireworks_mut" \
  node tools/mutants/run.mjs phase8-auth R1
```

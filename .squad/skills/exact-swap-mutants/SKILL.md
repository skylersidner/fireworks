# Skill: Exact-swap mutants on a shared tree

**Domain:** Negative controls and mutation checks on files teammates may be editing at the same time.
**Confidence:** high. Used in Phase 3, 4 and 5 reviews.

## Rules
- Mutate with an exact one-occurrence swap and revert with the reverse swap. Never restore from a backup copy, which clobbers a parallel edit.
- **The reverse swap must also be unique.** Before mutating, refuse the mutant if its replacement text already occurs in the file. An empty replacement (deleting a line) can never be reversed this way, so replace with a marker comment instead (`/* toad-mut */`). A Phase 5 runner left `creation-save.ts` mutated because `return null;` occurred twice.
- Checksum the targets (`md5`) before the run and diff after it. An unexpected diff in a file you never mutated is a teammate's edit, so leave it alone.
- Put the revert in `finally`.
- Run only the specs that can kill it (`ng test --watch=false --include <spec>`; repeat `--include`).
- Read the first failure, not the count. Specs whose `afterEach` throws (for example `http.verify()` before `vi.restoreAllMocks()`) cascade one failure into the whole file.
- A survivor is either a missing test or an equivalent mutant. Prove which by reading the callee (for example `editableFrom(x)` without a fallback was equivalent because `normalizeSky(undefined)` is the default sky).
- If ng serve is running on the same tree, it rebuilds with your mutant. Don't run browser smokes during a mutant run.
- C#: after the revert, `touch` the file so MSBuild rebuilds it.

Script template: `scratchpad/toad-p5/mut.py` (MUTANTS dict of `(file, old, new, specs)`).

## Added in Phase 6
- **A build failure isn't a kill.** `&& false` (or `if (false)`) narrows a variable to `never`, so the TS compile fails and every spec "fails". Treat a `NO-SUMMARY` or `TS2xxx` result as a broken mutant. Use a type-preserving guard instead: `&& key === ''` or `&& this.code === ''`.
- **Copy rigs keep the repo's depth** when specs read `${cwd}/../../../schema`: put the copy at `<rig>/r/src/web/fireworks-web` and symlink `<rig>/r/schema` to the real schema (`scratchpad/toad-p6/mut.py`).
- **Report which tests killed a mutant.** A mutant that only your new test kills shows that the old test was vacuous; quote it as evidence (Phase 6: `player-replay-no-seek` passed Luigi's 6h.4 test).
- **Self-cancelling mutants.** An involution (`x ^ 1`, `!b`, a swap) applied once per edit cancels out across an even number of edits. If a test makes two edits and checks only at the end, assert after each edit (Phase 6: `move-reseeds` survived until then).

## Added in Phase 7 (C3)
- **Classify every failure: a timeout is never a kill.** Print each failing test's first `Error` line (`scratchpad/toad-c3/mut.py` does this). Under load 15–33, W3, W6, W8 and J1 each had a timeout among their failures, and W6's first "kill" was a timeout plus an unrelated spec. Re-run any mutant whose kill includes a timeout, and give heavy engine specs explicit timeouts (`vi.setConfig({ testTimeout })` per file).
- **A key-guarded cache needs a non-default key in its spec.** Warm-up checkpoints are protected by a run key (width, star budget, capacity). A shadow that ignores one of them is invisible at the default value (1280, budget 1) and silently useless at any other. Test the handoff at a non-default value and assert the work saved (seek steps 517, not 4117). This killed M10 and W9.
- **A cap needs its empty and boundary inputs.** D1's prefix cap (`?? 0`) had no spec for an empty receiver; `?? Infinity` survived until one was added.
- **"Overwrite" promises need a pre-set value.** A middleware that overwrites headers is indistinguishable from `TryAdd` until something writes a weaker value first. Use a minimal app whose endpoint pre-sets each header.
- **Drop a test that can't fail on its mutant.** If two attempts at a test both pass under the mutant, read the callee for equivalence (EF `CanConnectAsync` swallows provider exceptions, so the readiness probe's `catch` is unreachable) and record it as equivalent, not tested.

## Added in the interlude tooling batch (2026-11-15)
- **Use `tools/mutants/run.mjs`, not a scratchpad script.** Sets live in `tools/mutants/sets/<name>.mjs` as `{ kind: 'web' | 'api', mutants: [{ id, name, file, old, new | append, specs | filter }] }`.
- It works on a private copy of the repo (`test-results/mutants/…/repo`, with schema and `src/api` included, so specs that read `../../../` still resolve). So the shared tree is never mutated, and restoring from the copy's own original is safe *there*.
- It runs a baseline first, then the verdicts (TIMEOUT is separate from KILLED). For web it reads vitest's JSON reporter (`failureMessages` matching "Test timed out"); for API it reads `.trx` (`outcome="Timeout"` or a timeout message). Don't count failures from the console text.
- `--check <set>` lists STALE mutants (old text not exactly once) without running anything. Run it before any mutant proof, and refresh stale ones from the current code.
- TRX trap: passed results are self-closing `<UnitTestResult … />`. Match the self-closing form first. Otherwise a lazy `<UnitTestResult …>…</UnitTestResult>` match swallows every passed row up to the next failure, and the counts come out wrong (my first parse said 23 tests where there were 78).

## Added for test deletion (2026-11-17)
- **Prove a deletion per test, not per spec file.** Put every mutant on the code under test into one set (`tools/mutants/sets/t3-redundancy.mjs` imports the other sets), run it against the tier's specs *with* the candidates, and read each mutant's `<id>.vitest.json` in the rig (it survives the rig cleanup). A candidate can go when every mutant it failed on also failed a test that stays. Then re-run the same set on the reduced tree and diff the verdicts: nothing may go from killed to survived. For each mutant, list the failed tests whose status is not a timeout, split them into candidates and keepers, and flag any mutant where only candidates failed.
- **"Kills nothing" is vacuous until the pool has the right kind of mutant.** Run-twice and frame-size cases can't kill a deterministic mutant, because both runs carry the same bug. Add a cross-run leak (a module-level counter that perturbs output after N calls) before calling them redundant.
- **Mutate the documented contract, not only the pooled lines.** "seek clamps and floors" passed with the clamp and floor removed, because `advance` re-clamps internally; only `seek`'s return value changed. Its own mutant (K1, K2) showed the test couldn't fail on the behavior it names. Strengthen it, then keep it.
- A daily candidate's tier includes the regular unit-web step that the daily tier runs, so a mutant that survives the daily files alone (T07 here) still counts as covered if a kept regular spec kills it. Say so explicitly in the record.

## Added at the end-of-project review (2026-11-17)
- **A fix elsewhere can turn a killable mutant equivalent.** T23 (`takeCheckpoint` ignores the run key) was killed on 2026-11-16 at 02:29 and has survived every run since the F1 fix that day, which nulls the run key in `beforeStep`, the private method's only caller, right before the call. Before you write a test for an old survivor, compare the date of its last kill with the commits or fix records that touched its callers, and list every caller of the mutated code. If a guard upstream makes the line unreachable, mark the mutant `equivalent: '<why>'` (callers, the guard, the date of the last kill) instead of building a context no real host produces.
- **When a later filter hides a mutated filter, the only thing that changes is the count.** T21 (`adoptCheckpoints` adds off-grid checkpoints) is filtered out again on the next line, so only the documented return value ("the number added") moves. The smallest kill asserts that return value against a finer grid. A mutant like this is equivalent in the app (the stage ignores the return value) but not at the API, so test the contract and say both.

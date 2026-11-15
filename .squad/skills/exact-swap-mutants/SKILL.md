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

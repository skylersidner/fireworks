# Show fingerprints (T2)

Integer fingerprints of whole show runs, committed as goldens and compared in one run (testing interlude T2; record `.squad/decisions/records/yoshi-interlude-t2-fingerprints.md`).

| Piece | Path |
|---|---|
| The fingerprint, the case list, the diff (pure engine code) | `src/web/fireworks-web/src/engine/loop/golden/show-fingerprint.ts` |
| Goldens, one per case | `src/web/fireworks-web/src/engine/loop/golden/fingerprints/<case>.json` |
| Regular spec (11 cases, about 5 s alone) and the one-unit negative controls | `…/engine/loop/golden/show-fingerprint.spec.ts` |
| Daily spec (`realistic-600`, about 9 s) | `…/engine/loop/golden/show-fingerprint.daily.spec.ts` |
| Final spec (`at-maximums`, about 2.5–3 min; final tier only) | `…/engine/loop/golden/show-fingerprint.final.spec.ts` |
| Recorder | `tools/fingerprints/record.mjs` |
| Browser harness (Chromium, Firefox, WebKit) | `tools/browser-gates/fingerprints.mjs`, wired in `daily-steps.mjs` |
| Mutant proof | `tools/mutants/sets/t2-fingerprint.mjs` vs `t2-today.mjs` (shared list `mutants.mjs`) |

## Fields (all integers; hashes are uint32 FNV-1a)

`endStep`, `lastFireStep`, `launches`, `ledgerHash` (step, seed, id, shell, float64 bits of `tx` and `ty`), `traceDigest` (the driver's per-kind counts after every step), `populationDigest` (`n` and shells in flight after every step), `peakN`, `peakStep`, and `samples` every 600 steps (`n`, shells, counts per kind). No position or velocity: those pass through `Math.exp/sin/cos`, which engines approximate differently. **Blind spot:** a change that moves particles without changing any count, launch or end (for example dropping the show's wind) passes the fingerprint. Run-vs-run specs and the prototype golden's position sums cover positions.

## Updating a golden

Goldens change only by reviewed change (schema.md §8.1):

```
node tools/fingerprints/record.mjs --check                      # compare, write nothing (exit 1 on a difference)
node tools/fingerprints/record.mjs --reason "why the new numbers are right" [--only a,b] [--tier regular|daily]
```

Without `--reason` (10+ characters) it writes nothing and exits 2. Only changed cases are written, and the reason is appended to that file's `header.history` with the first differences. The golden's diff is what the reviewer reads.

## Negative controls

| Control | Expect |
|---|---|
| `show-fingerprint.spec.ts` "a one-unit change in any field fails" | every one of the 30 numeric fields, ±1, gives exactly one difference naming it |
| the same spec, missing / extra field and a dropped sample | each fails |
| `record.mjs` with no `--reason` | exit 2, no file written |
| `FP_NEG=bump MODE=compare node tools/browser-gates/fingerprints.mjs` | exit 1, `MISMATCH … fingerprint.ledgerHash` |
| `FP_NEG=crash FP_CASES=minimal FP_TAG=neg node tools/browser-gates/fingerprints.mjs` | exit 1, `CRASH chromium minimal … FP_NEG crash` |

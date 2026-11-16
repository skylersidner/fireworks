// Mutant verdicts (tools/mutants/run.mjs). A TIMEOUT IS NEVER A KILL (skill exact-swap-mutants,
// Phase 7 C3): under load a 5 s default timeout fails a test whether or not the mutant is caught.
//   failed: [{ test, timeout: boolean, why }]
//   node tools/mutants/classify.mjs   runs the self-check below (exit 1 if a rule is broken)
import { fileURLToPath } from 'node:url';

export function classify(status, failed, summary) {
  if (status === 0 && !failed.length) return { verdict: 'SURVIVED', detail: summary, failed };
  if (!failed.length) return { verdict: 'BROKEN', detail: `exit ${status} with no failing test (${summary})`, failed };
  const real = failed.filter((f) => !f.timeout);
  return { verdict: real.length ? 'KILLED' : 'TIMEOUT', detail: `${summary}; ${real.length} failed, ${failed.length - real.length} timed out`, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = (timeout) => ({ test: 'x', timeout, why: '' });
  const cases = [
    [[0, []], 'SURVIVED'],
    [[1, []], 'BROKEN'],
    [[1, [t(true)]], 'TIMEOUT'],
    [[1, [t(true), t(true)]], 'TIMEOUT'],
    [[1, [t(true), t(false)]], 'KILLED'],
    [[1, [t(false)]], 'KILLED'],
  ];
  let bad = 0;
  for (const [[status, failed], want] of cases) {
    const got = classify(status, failed, '').verdict;
    if (got !== want) { bad++; console.log(`FAIL classify(${status}, ${failed.map((f) => (f.timeout ? 'timeout' : 'fail')).join('+') || 'none'}) = ${got}, want ${want}`); }
  }
  console.log(bad ? `classify: ${bad} rule(s) broken` : `classify: ok (${cases.length} cases; a timeout-only failure is TIMEOUT, never KILLED)`);
  process.exitCode = bad ? 1 : 0;
}

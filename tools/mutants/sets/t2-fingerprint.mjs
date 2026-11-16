// T2 proof (Yoshi): the shared mutants in tools/fingerprints/mutants.mjs against the regular
// fingerprint spec alone. Compare with t2-today.
import { FINGERPRINT_SPEC, MUTANTS } from '../../fingerprints/mutants.mjs';
export default {
  kind: 'web',
  description: 'T2: sim/loop mutants vs the regular show-fingerprint spec alone',
  mutants: MUTANTS.map((m) => ({ ...m, specs: [FINGERPRINT_SPEC] })),
};

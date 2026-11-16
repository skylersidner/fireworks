// T2 proof (Yoshi): the shared mutants in tools/fingerprints/mutants.mjs against every regular
// spec except the fingerprint spec (and Toad's in-progress property specs). Compare with
// t2-fingerprint.
import { MUTANTS, todaySpecs } from '../../fingerprints/mutants.mjs';
const specs = todaySpecs();
export default {
  kind: 'web',
  description: `T2: sim/loop mutants vs the ${specs.length} other regular specs (pre-T2 coverage)`,
  mutants: MUTANTS.map((m) => ({ ...m, specs })),
};

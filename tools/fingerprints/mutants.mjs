// The T2 proof mutants (record yoshi-interlude-t2-fingerprints.md). Shared by two mutant sets that
// run the same swaps against different specs:
//   tools/mutants/sets/t2-fingerprint.mjs   the regular fingerprint spec alone
//   tools/mutants/sets/t2-today.mjs         every other regular spec (what ran before T2)
// A mutant that t2-today lets survive and t2-fingerprint kills is a kill only the golden gives.
// Every mutant is deterministic: two runs of the mutated engine agree, so run-vs-run specs can
// only catch it by an exact expected value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'web', 'fireworks-web');
const SIM = 'src/engine/sim/simulation.ts';
const DRV = 'src/engine/loop/timeline-driver.ts';

export const MUTANTS = [
  { id: 'F1', name: "death at age > life (Luigi's sim survivor P02)", file: SIM, old: 'if (P.age[i] >= P.life[i]) {', new: 'if (P.age[i] > P.life[i]) {' },
  { id: 'F2', name: "a cue's burstHeight override ignored", file: DRV, old: 'const burstHeight = cue.burstHeight ?? def.burstHeight;', new: 'const burstHeight = def.burstHeight;' },
  { id: 'F3', name: 'launch tx rounded to a whole unit', file: DRV, old: 'const tx = s.cue.x * ctx.worldWidth();', new: 'const tx = Math.round(s.cue.x * ctx.worldWidth());' },
  { id: 'F4', name: "trace digest skips step 1 (Luigi's T38)", file: DRV, old: 'if (this.digestOn) this.foldCounts(ctx.sim);', new: 'if (this.digestOn && k > 1) this.foldCounts(ctx.sim);' },
  { id: 'F5', name: 'cue seed perturbed at fire (ledger still shows the stored seed)', file: DRV, old: 'ctx.fireSeeded(s.def, tx, s.ty, s.cue.seed);', new: 'ctx.fireSeeded(s.def, tx, s.ty, s.cue.seed ^ 1);' },
  { id: 'F6', name: "show wind dropped (expected fingerprint SURVIVOR: wind moves positions only)", file: DRV, old: 'this.sky = { ...show.sky };', new: 'this.sky = { ...show.sky, wind: 0 };' },
  { id: 'F7', name: 'end reported one step late (calibration: today kills it too)', file: DRV, old: 'this._endStep = this.k;', new: 'this._endStep = this.k + 1;' },
  { id: 'F8', name: 'same-step ties in array order, not by id (calibration)', file: 'src/engine/model/show.ts', old: '.sort((a, b) => a.step - b.step || compareOrdinal(a.cue.id, b.cue.id))', new: '.sort((a, b) => a.step - b.step)' },
];

export const FINGERPRINT_SPEC = 'src/engine/loop/golden/show-fingerprint.spec.ts';

/**
 * Every regular spec except the fingerprint spec. Toad's T3 property specs
 * (*.property*.spec.ts) are left out while he builds them (the baseline must be green); his T3
 * proof covers them.
 */
export function todaySpecs() {
  const out = [];
  for (const f of fs.readdirSync(path.join(WEB, 'src'), { recursive: true })) {
    const rel = path.join('src', String(f));
    if (!rel.endsWith('.spec.ts') || rel.endsWith('.daily.spec.ts') || rel.endsWith('.final.spec.ts') || /\.property[^/]*\.spec\.ts$/.test(rel)) continue;
    if (rel.includes('/engine/loop/golden/')) continue;
    out.push(rel);
  }
  return out.sort();
}

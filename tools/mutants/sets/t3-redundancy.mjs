// Redundant-spec deletion proof (Toad, 2026-11-17; record toad-redundant-spec-deletion.md).
// Every mutant in the repo's sets that lands on the engine loop, show model or sim code
// (t3-engine T01-T40, c3-web W1-W7 and F1, p6-web td-inherit-none, f1-fix F1a-F1b, the T2
// fingerprint swaps), run against the engine loop specs of one tier. The runner keeps each
// mutant's <id>.vitest.json in the rig, so per-test attribution comes from those reports:
//   node tools/mutants/run.mjs t3-redundancy          regular engine loop specs
//   MUTANT_TIER=daily node tools/mutants/run.mjs t3-redundancy   the daily engine loop specs
//   MUTANT_TIER=all node tools/mutants/run.mjs t3-redundancy K1 K2   every regular spec file
// A spec named in the deletion record was deleted only when, for every mutant it failed on,
// some test that stays also failed. Re-run after the deletion: nothing may go killed -> survived.
import t3 from './t3-engine.mjs';
import c3 from './c3-web.mjs';
import p6 from './p6-web.mjs';
import f1 from './f1-fix.mjs';
import { MUTANTS as FP } from '../../fingerprints/mutants.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// K1, K2: the seek target's clamp and floor. No other set touches them; they decide whether
// "seek clamps and floors its target" is redundant.
const SEEK_K = 'const k = Math.max(0, Math.floor(target));';
const DRV = 'src/engine/loop/timeline-driver.ts';
const CLAMP = [
  { id: 'K1', name: 'seek target not clamped at 0', file: DRV, old: SEEK_K, new: 'const k = Math.floor(target);' },
  { id: 'K2', name: 'seek target not floored', file: DRV, old: SEEK_K, new: 'const k = Math.max(0, target);' },
];
// X1: state that leaks from one run into the next (a module-level counter perturbs every cue
// after the 50th fired in the process). Every pooled mutant above is deterministic per run, so
// only X1 measures what the "same show twice" cases are for.
const LEAK = [
  {
    id: 'X1', name: 'state leaks across runs (module-level fire counter)',
    swaps: [
      { file: DRV, old: 'ctx.fireSeeded(s.def, tx, s.ty, s.cue.seed);', new: 'ctx.fireSeeded(s.def, tx, s.ty, s.cue.seed ^ (LEAKED_FIRES++ >= 50 ? 1 : 0));' },
      { file: DRV, append: '\nlet LEAKED_FIRES = 0;\n' },
    ],
  },
];

const LOOP = 'src/engine/loop/';
const REGULAR = [
  `${LOOP}timeline-driver.spec.ts`,
  `${LOOP}timeline-driver.checkpoints.spec.ts`,
  `${LOOP}timeline-driver.property.spec.ts`,
  `${LOOP}timeline-driver.run-key.spec.ts`,
  `${LOOP}engine-loop.spec.ts`,
  `${LOOP}golden/show-fingerprint.spec.ts`,
];
const DAILY = [`${LOOP}timeline-driver.daily.spec.ts`, `${LOOP}golden/show-fingerprint.daily.spec.ts`];
/** MUTANT_TIER=all: every regular spec file (the whole unit-web step of the regular tier). */
function allRegular() {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'web', 'fireworks-web');
  return fs.readdirSync(path.join(web, 'src'), { recursive: true }).map((f) => path.join('src', String(f)))
    .filter((f) => f.endsWith('.spec.ts') && !/\.(daily|final)\.spec\.ts$/.test(f)).sort();
}
const TIER = process.env.MUTANT_TIER ?? 'regular';
const specs = TIER === 'daily' ? DAILY : TIER === 'all' ? allRegular() : REGULAR;
const engine = (m) => /^src\/engine\//.test(m.file ?? '');
const pool = [
  ...t3.mutants.filter(engine),
  ...c3.mutants.filter(engine).map((m) => ({ ...m, id: `C3-${m.id}` })),
  ...p6.mutants.filter((m) => m.id === 'td-inherit-none'),
  ...f1.mutants,
  ...FP.map((m) => ({ ...m, id: `FP-${m.id}` })),
  ...CLAMP,
  ...LEAK,
];
export default {
  kind: 'web',
  description: `Deletion proof: ${pool.length} engine mutants vs the ${TIER === 'all' ? `${specs.length} regular` : `${TIER} engine loop`} specs (per-test attribution in the rig's <id>.vitest.json)`,
  mutants: pool.map(({ specs: _s, ...m }) => ({ ...m, specs })),
};

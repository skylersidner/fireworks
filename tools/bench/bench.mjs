// Seek bench (Toad, Phase 7 A3; record toad-phase7-caps-and-seek.md): step cost, seek to end, cold
// and warm random seeks and drops per (show, cap), in Node with no render. Product code untouched.
// Report-only: it never fails a run. Record `uptime` with every number; load > 6 is not comparable.
//
// Usage: node tools/bench/bench.mjs [all|done-when-60,realistic-600,...] [40000,30000,20000]
//   SEEKS=warm40k   only warm seeks, only at cap 40000 (the quick realistic check)
//   DEMAND_CAP=n    the "uncapped" capacity for the demand pass (default 600000)
// Prints one JSON line per (show, cap). Shows: at-max-600, at-max-300, done-when-60, realistic-600,
// realistic-300, preset1000-600.
import { fixture, realistic, preset1000, scaled } from './shows.mjs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const WEB = fileURLToPath(new URL('../../src/web/fireworks-web', import.meta.url));
console.log(JSON.stringify({ uptime: execSync('uptime').toString().trim(), at: new Date().toISOString() }));
const { build } = await import(WEB + '/node_modules/esbuild/lib/main.js');
const b = await build({ entryPoints: [fileURLToPath(new URL('./bench-entry.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const E = await import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64'));
const WIDTH = 1422; // 800 * 16/9
const which = process.argv[2] ?? 'all';
const caps = (process.argv[3] ?? '40000,30000,20000').split(',').map(Number);
const SHOWS = {
  'at-max-600': () => fixture('at-maximums'),
  'at-max-300': () => scaled(fixture('at-maximums'), 300),
  'done-when-60': () => fixture('done-when-60s-50'),
  'realistic-600': () => realistic(600),
  'realistic-300': () => realistic(300),
  'preset1000-600': () => preset1000(600),
};
function mk(doc, cap, opts = {}) {
  const o = E.openShow(doc); if (!o.ok) throw new Error('invalid show: ' + JSON.stringify(o.errors.slice(0, 3)));
  const sim = new E.FireworksSim({ capacity: cap, starBudget: 1 });
  const drv = new E.TimelineDriver(o.show, opts);
  const loop = new E.EngineLoop(sim, undefined, { worldWidth: () => WIDTH, driver: drv });
  return { sim, drv, loop, show: o.show };
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Pass 1 (instrumented, not timed): drops and occupancy per step. */
function occupancy(doc, cap) {
  const { sim, drv, loop } = mk(doc, cap, { checkpointSteps: 0 });
  const P = sim.particles; const orig = P.spawn.bind(P); let drops = 0;
  P.spawn = (...a) => { const i = orig(...a); if (i < 0) drops++; return i; };
  let peak = 0, atCap = 0, totalDrops = 0, maxDrop = 0, maxDropStep = -1, busiest = 0;
  const end = drv.endBoundStep;
  for (let k = 0; k <= end && !drv.done; k++) {
    drops = 0; drv.advance(loop, 1);
    const n = P.n; if (n > peak) peak = n; if (n >= cap) atCap++;
    totalDrops += drops; if (drops > maxDrop) { maxDrop = drops; maxDropStep = k; }
  }
  return { steps: drv.step, endStep: drv.endStep, peak, stepsAtCap: atCap, secAtCap: r1(atCap / 120), totalDrops, maxDropsOneStep: maxDrop, maxDropAt_s: r1(maxDropStep / 120) };
}
/** Pass 2 (timed): seek 0 -> end in one call, then per-step cost split by occupancy. */
function seekToEnd(doc, cap, endStep) {
  const { sim, drv, loop } = mk(doc, cap);
  const t0 = performance.now(); drv.seek(loop, endStep); const total = performance.now() - t0;
  return { drv, loop, sim, totalMs: Math.round(total), msPerStep: r3(total / endStep), checkpoints: drv.checkpointSteps.length, cpMiB: r1(drv.checkpointBytes / 1048576), spacingS: drv.checkpointSteps.length > 1 ? (drv.checkpointSteps[1] - drv.checkpointSteps[0]) / 120 : null };
}
/** Step cost at the cap: run until n reaches cap (or the busiest point), then time 600 steps there. */
function stepAtCap(doc, cap) {
  const { sim, drv, loop } = mk(doc, cap, { checkpointSteps: 0 });
  const end = drv.endBoundStep; let k = 0;
  while (k < end && sim.particles.n < cap * 0.999) { drv.advance(loop, 1); k++; }
  if (sim.particles.n < cap * 0.999) return { reached: false };
  const per = []; let minN = Infinity;
  for (let i = 0; i < 600 && k < end; i++, k++) { const a = performance.now(); drv.advance(loop, 1); per.push(performance.now() - a); minN = Math.min(minN, sim.particles.n); }
  return { reachedAt_s: r1((k - per.length) / 120), minNDuring: minN, p50: r3(q(per, 0.5)), p95: r3(q(per, 0.95)), mean: r3(per.reduce((s, x) => s + x, 0) / per.length) };
}
/** 20 random seeks: cold (fresh driver, as a freshly opened saved show) and warm (after a full pass). */
function randomSeeks(doc, cap, endStep, n = 20) {
  const out = {};
  for (const mode of ['cold', 'warm']) {
    const { drv, loop } = mk(doc, cap);
    if (mode === 'warm') drv.seek(loop, endStep);
    const r = rng(20261115); const ms = [];
    for (let i = 0; i < n; i++) { const target = Math.floor(r() * endStep); const a = performance.now(); drv.seek(loop, target); ms.push(performance.now() - a); }
    out[mode] = { p50: Math.round(q(ms, 0.5)), p95: Math.round(q(ms, 0.95)), max: Math.round(Math.max(...ms)), first: Math.round(ms[0]) };
  }
  return out;
}
function randomSeeksWarm(doc, cap, endStep, n = 20) {
  const { drv, loop } = mk(doc, cap); drv.seek(loop, endStep); const r = rng(20261115); const ms = [];
  for (let i = 0; i < n; i++) { const target = Math.floor(r() * endStep); const a = performance.now(); drv.seek(loop, target); ms.push(performance.now() - a); }
  return { p50: Math.round(q(ms, 0.5)), p95: Math.round(q(ms, 0.95)), max: Math.round(Math.max(...ms)) };
}
const DEMAND_CAP = Number(process.env.DEMAND_CAP ?? 600000);
for (const [name, gen] of Object.entries(SHOWS)) {
  if (which !== 'all' && !which.split(',').includes(name)) continue;
  const doc = gen();
  const demand = occupancy(doc, DEMAND_CAP);
  console.log(JSON.stringify({ show: name, cues: doc.cues.length, duration: doc.duration, uncappedPeak: demand.peak, uncappedEnd_s: r1(demand.endStep / 120) }));
  for (const cap of caps) {
    const occ = occupancy(doc, cap);
    const se = seekToEnd(doc, cap, occ.endStep);
    const sc = stepAtCap(doc, cap);
    const rs = process.env.SEEKS === 'warm40k' ? (cap === 40000 ? { warm: randomSeeksWarm(doc, cap, occ.endStep) } : null) : randomSeeks(doc, cap, occ.endStep);
    console.log(JSON.stringify({ show: name, cap, occ, seekToEnd: { totalMs: se.totalMs, msPerStep: se.msPerStep, checkpoints: se.checkpoints, cpMiB: se.cpMiB, spacingS: se.spacingS }, stepAtCap: sc, seeks: rs }));
  }
}

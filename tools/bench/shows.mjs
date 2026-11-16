// Show generators for the seek bench and gate-warm (Toad, Phase 7 A3). Uses the product's PRESETS
// through an esbuild bundle (read-only). Needs `npm ci` in src/web/fireworks-web (for esbuild).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const WEB = ROOT + '/src/web/fireworks-web';
const { build } = await import(WEB + '/node_modules/esbuild/lib/main.js');
const b = await build({ entryPoints: [WEB + '/src/engine/model/presets.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { PRESETS } = await import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64'));
export const fixture = (n) => JSON.parse(readFileSync(`${ROOT}/schema/fixtures/valid/show/${n}.json`, 'utf8')).document;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const embedded = (s) => { const c = structuredClone(s); delete c.sky; return c; };
function presetShells() { const shells = {}; PRESETS.forEach((p, i) => { shells['p' + i] = embedded(p); }); return shells; }
/** Realistic preset-heavy show: a cue every 1-4 s (avg 2.5 s), a 30 s finale at one cue per 0.3 s. */
export function realistic(duration) {
  const r = rng(424242); const cues = []; let t = 0, id = 1; const finale = duration - 30;
  while (t < finale) { cues.push(t); t += 1 + r() * 3; }
  for (t = finale; t <= duration; t += 0.3) cues.push(t);
  return { version: 1, name: `Realistic ${duration}s`, sky: { gravity: 160, wind: 8 }, duration, shells: presetShells(),
    cues: cues.map((tt) => ({ id: 'c' + id++, t: Math.round(Math.min(tt, duration) * 100) / 100, shell: 'p' + Math.floor(r() * PRESETS.length), x: Math.round((0.1 + r() * 0.8) * 1000) / 1000, seed: (r() * 4294967296) | 0 })) };
}
/** Yoshi's "600 s, 1000 preset cues" shape (uniform, cycling presets), for reconciliation. */
export function preset1000(duration = 600) {
  const r = rng(777);
  return { version: 1, name: 'Preset 1000', sky: { gravity: 160, wind: 0 }, duration, shells: presetShells(),
    cues: Array.from({ length: 1000 }, (_, i) => ({ id: 'c' + (i + 1), t: Math.round((i * duration / 1000) * 100) / 100, shell: 'p' + (i % PRESETS.length), x: Math.round((0.1 + r() * 0.8) * 1000) / 1000, seed: (r() * 4294967296) | 0 })) };
}
/** at-maximums with every t scaled to fit a shorter maximum (worst case under that cap). */
export function scaled(doc, duration) { const f = duration / doc.duration; const d = structuredClone(doc); d.duration = duration; d.cues.forEach((c) => { c.t = Math.min(duration, c.t * f); }); return d; }

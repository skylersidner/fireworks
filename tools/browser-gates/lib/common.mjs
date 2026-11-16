// Shared helpers for the browser gates (testing-strategy.md §2, §3 item 12).
// Every script reads BASE, ENGINES and the saved codes the same way, so a run never depends on a
// scratchpad path or a hand-written codes.json.
//
//   BASE        the app origin (default http://localhost:5180). The smoke and daily runners pass
//               their own API instance here.
//   ENGINES     chromium (default) | chromium,firefox,webkit (the daily run).
//   CODES       '{"shell":"..","show":".."}' | SAVE (POST the fixtures below to BASE first).
//   CODES_FILE  a JSON file with the same shape (used when CODES is unset).
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(HERE, '..', '..');
export const SCHEMA_FIXTURES = path.join(ROOT, 'schema', 'fixtures');
export const BASE = process.env.BASE ?? 'http://localhost:5180';

const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export const launchers = {
  // The installed Google Chrome: Playwright's bundled Chromium silently falls back to no WebGL
  // headless (skill headless-webgl-smoke).
  chromium: () => chromium.launch({ channel: 'chrome', headless: true, args: CHROME_ARGS }),
  firefox: () => firefox.launch({ headless: true }),
  webkit: () => webkit.launch({ headless: true }),
};
export const engineTypes = { chromium, firefox, webkit };
export const engines = () => (process.env.ENGINES ?? 'chromium').split(',').map((s) => s.trim()).filter(Boolean);

/** A document from schema/fixtures (valid/<kind>/<name>.json) or from ./fixtures (<name>.json). */
export function fixtureDoc(name) {
  const local = path.join(HERE, 'fixtures', `${name}.json`);
  const file = fs.existsSync(local) ? local : path.join(SCHEMA_FIXTURES, 'valid', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')).document;
}

/**
 * What SAVE writes (6 rows on a fresh database; the write limit is 20 a minute):
 *   shell   gate shell A (headers' share GET, keyboard, touch, reduced motion, csp)
 *   shellB  gate shell B (headers' put phase renames it)
 *   show    the 60 s Done-when show (follow pages it; keyboard and csp open it)
 *   short   the 10 s cue-at-duration show (the virtual-time player smoke)
 */
export const SAVE_SET = {
  shell: ['shell', () => fixtureDoc('shellA')],
  shellB: ['shell', () => fixtureDoc('shellB')],
  show: ['show', () => fixtureDoc('show/done-when-60s-50')],
  short: ['show', () => fixtureDoc('show/cue-at-duration')],
};

export async function saveCodes(base = BASE, keys = Object.keys(SAVE_SET)) {
  const codes = {};
  for (const k of keys) {
    const [kind, doc] = SAVE_SET[k];
    const r = await fetch(`${base}/api/creations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, document: doc() }) });
    if (r.status !== 201) throw new Error(`SAVE ${k}: HTTP ${r.status} ${(await r.text()).slice(0, 200)} (writes off on ${base}?)`);
    codes[k] = (await r.json()).shareCode;
  }
  return codes;
}

export async function loadCodes(required = ['shell', 'show']) {
  let codes;
  if (process.env.CODES === 'SAVE') codes = await saveCodes();
  else if (process.env.CODES) codes = JSON.parse(process.env.CODES);
  else if (process.env.CODES_FILE) codes = JSON.parse(fs.readFileSync(process.env.CODES_FILE, 'utf8'));
  else throw new Error('Set CODES (JSON, or SAVE to post the fixtures to BASE) or CODES_FILE');
  const missing = required.filter((k) => !codes[k]);
  if (missing.length) throw new Error(`codes are missing ${missing.join(', ')}`);
  return codes;
}

/** Where a script writes its JSON results: OUT_DIR (the runners set it), else test-results/browser-gates (gitignored). */
export function outPath(file) {
  const dir = process.env.OUT_DIR ?? path.join(ROOT, 'test-results', 'browser-gates');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

/** Real-time poll through page.evaluate (waitForFunction is blocked by script-src without 'unsafe-eval'). */
export async function until(fn, ms, stepMs = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export const stageStatus = (page) => page.evaluate(() => document.querySelector('app-fireworks-stage')?.getAttribute('data-status') ?? null).catch(() => null);

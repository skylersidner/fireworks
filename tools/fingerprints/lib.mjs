// Shared by the T2 fingerprint recorder (record.mjs) and the browser harness
// (tools/browser-gates/fingerprints.mjs): one esbuild bundle of the product's own
// engine/loop/golden/show-fingerprint.ts, the fixture reader and the golden files.
// Record: .squad/decisions/records/yoshi-interlude-t2-fingerprints.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB = path.join(ROOT, 'src', 'web', 'fireworks-web');
export const ENTRY = path.join(WEB, 'src', 'engine', 'loop', 'golden', 'show-fingerprint.ts');
export const GOLDEN_DIR = path.join(WEB, 'src', 'engine', 'loop', 'golden', 'fingerprints');
export const SHOW_FIXTURES = path.join(ROOT, 'schema', 'fixtures', 'valid', 'show');

/**
 * The fingerprint module bundled with the web app's own esbuild (the compiler `ng build` uses).
 *   format 'esm'   imported into Node (the recorder)
 *   format 'iife'  evaluated in a blank browser page; defines globalThis.__fp
 */
export async function bundle(format) {
  const { build } = await import(path.join(WEB, 'node_modules', 'esbuild', 'lib', 'main.js'));
  const b = await build({
    entryPoints: [ENTRY], bundle: true, write: false, format, target: 'es2022', logLevel: 'silent',
    platform: 'neutral', ...(format === 'iife' ? { globalName: '__fp' } : {}),
  });
  return b.outputFiles[0].text;
}

export async function importBundle() {
  return import('data:text/javascript;base64,' + Buffer.from(await bundle('esm')).toString('base64'));
}

export const readFixture = (name) => {
  const file = path.join(SHOW_FIXTURES, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

export const goldenPath = (name) => path.join(GOLDEN_DIR, `${name}.json`);
export const readGolden = (name) => (fs.existsSync(goldenPath(name)) ? JSON.parse(fs.readFileSync(goldenPath(name), 'utf8')) : null);

/** The fields of a golden a run must reproduce: the case itself, the input digest, the fingerprint. */
export const comparable = (g) => ({ case: g.case, inputDigest: g.inputDigest, fingerprint: g.fingerprint });

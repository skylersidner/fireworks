// The Node version check shared by the test entry points: tools/test/run.mjs (every tier),
// tools/browser-gates/daily.mjs and web runs of tools/mutants/run.mjs. Node only, no dependencies.
//
// One source: `engines.node` in src/web/fireworks-web/package.json (">=26.5.0 <27"). That range is
// the requirement; `.nvmrc` (26.5.0) is only the version `nvm use` picks, and it is checked to lie
// inside the range so the hint below never points at a Node that would be refused.
//
// Why it exists (toad-final-tier-run.md): under nvm's default v21.5.0 every `ng` step exits 3 in
// about a second, and daily/final keep going, so the browser steps then test a stale wwwroot.
// Exit 2 (setup error) before any step starts.
//
//   node tools/test/node-version.mjs              prints the verdict for this Node; exit 0 or 2
//   node tools/test/node-version.mjs --selftest   the range parser's own control; exit 0 or 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_JSON = path.join(ROOT, 'src', 'web', 'fireworks-web', 'package.json');
const NVMRC = path.join(ROOT, '.nvmrc');

/** "v26.5.0" or "26.5" → [26, 5, 0]; a missing part is 0. Null when it isn't a plain version. */
export function parseVersion(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(text).trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Whether `version` satisfies `range`: space-separated comparators (>=, >, <=, <, =, or a bare
 * version), all of which must hold. Anything else (||, ^, ~, x-ranges, pre-releases) throws, so an
 * edit to `engines` that this parser can't read fails loudly instead of passing every Node.
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) throw new Error(`not a plain version: ${version}`);
  const parts = String(range).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error('empty range');
  return parts.every((p) => {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(p);
    const bound = m && parseVersion(m[2]);
    if (!bound) throw new Error(`unsupported comparator "${p}" in "${range}"`);
    const c = cmp(v, bound);
    return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0, undefined: c === 0 }[m[1]];
  });
}

/** { ok, range, nvmrc, message }. `message` says what is wrong and what to run. */
export function checkNode(version = process.version) {
  const range = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).engines?.node;
  if (!range) return { ok: false, message: `no engines.node in ${path.relative(ROOT, PACKAGE_JSON)}` };
  const nvmrc = fs.existsSync(NVMRC) ? fs.readFileSync(NVMRC, 'utf8').trim() : null;
  if (nvmrc && !satisfies(nvmrc, range)) {
    return { ok: false, range, nvmrc, message: `.nvmrc (${nvmrc}) is outside engines.node "${range}": fix one of them` };
  }
  if (satisfies(version, range)) return { ok: true, range, nvmrc, message: `node ${version} satisfies engines.node "${range}"` };
  return {
    ok: false, range, nvmrc,
    message: `node ${version} does not satisfy engines.node "${range}" (src/web/fireworks-web/package.json). ` +
      `Run \`nvm use\` (.nvmrc: ${nvmrc ?? 'missing'}) so a Node in that range is first on PATH, then re-run.`,
  };
}

/** Exits 2 with the reason when this Node is refused. Call it before any step starts. */
export function requireNode(label) {
  let r;
  try { r = checkNode(); }
  catch (e) { r = { ok: false, message: `cannot check the Node version: ${e.message}` }; }
  if (r.ok) return r;
  console.error(`${label}: refusing to start: ${r.message}`);
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) {
    const R = '>=26.5.0 <27';
    const cases = [
      ['v26.5.0', R, true], ['v26.5.1', R, true], ['v26.99.0', R, true], ['v26.4.9', R, false],
      ['v21.5.0', R, false], ['v27.0.0', R, false], ['v27.1.0', R, false], ['v25.9.9', R, false],
      ['26.5.0', '26.5.0', true], ['26.5.1', '=26.5.0', false], ['26.5.0', '>26.5.0', false], ['26.5.0', '<=26.5', true],
    ];
    let bad = 0;
    for (const [v, r, want] of cases) if (satisfies(v, r) !== want) { bad++; console.log(`FAIL satisfies(${v}, "${r}") should be ${want}`); }
    for (const r of ['^26.5.0', '>=26 || >=28', '~26.5', '26.x', '']) {
      try { satisfies('v26.5.0', r); bad++; console.log(`FAIL satisfies accepted unsupported range "${r}"`); } catch { /* refused: right */ }
    }
    console.log(bad ? `node-version selftest: ${bad} case(s) wrong` : `node-version selftest: ok (${cases.length} cases, 5 refused ranges)`);
    process.exit(bad ? 1 : 0);
  }
  const r = requireNode('node-version');
  console.log(r.message);
}

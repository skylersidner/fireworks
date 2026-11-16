// T2 show fingerprints in real browser engines (testing interlude; record
// .squad/decisions/records/yoshi-interlude-t2-fingerprints.md). Daily tier.
//
//   ENGINES=chromium,firefox,webkit node fingerprints.mjs             run: compute, write results
//   ENGINES=firefox MODE=compare node fingerprints.mjs                 compare results with goldens
//
// Run mode bundles engine/loop/golden/show-fingerprint.ts (the same source the Node specs and
// the recorder run) with the web app's esbuild, injects it into a blank page (about:blank) in
// each engine, runs each case there and writes OUT_DIR/fingerprints-<engine>[-<FP_TAG>].json.
// It exits 1 only when an engine fails to launch, a case throws, or a case times out (CRASH):
// "it doesn't run" fails the daily run. A mismatch is NOT a failure in run mode.
// Compare mode reads that file and exits 1 when any case differs from its golden (MISMATCH).
// daily-steps.mjs makes that step report-only for Firefox and WebKit (Skyler 2026-11-16) and
// failing for Chromium: Chromium is V8, as is the Node that recorded the goldens, so a Chromium
// mismatch means the harness is broken and the Firefox and WebKit verdicts mean nothing.
//
// Why a blank page and not the production app under its CSP: what this checks is the JS engine's
// arithmetic on the engine code, which needs no DOM, renderer or server. The production build has
// no fingerprint readout, and adding one would ship test code (the cross-browser skill: a readout
// is real cost). The production CSP is gate-csp's job in all three engines, and that step fails
// the run. about:blank has no CSP, so the injected bundle runs as it is.
//
//   FP_CASES   default: every regular case plus realistic-600; 'all' adds at-maximums (about
//              2.5–3 min in Node, longer in Firefox/WebKit); or a comma list of case names
//   FP_TIMEOUT_S  per case (default 900)
//   FP_TAG     suffix for the results file (the controls use their own)
//   FP_NEG=bump   compare mode: add 1 to one golden field first; must report MISMATCH
//   FP_NEG=crash  run mode: the page throws inside the first case; must report CRASH
//   OUT_DIR    default test-results/fingerprints
import fs from 'node:fs';
import path from 'node:path';
import { engines, launchers, ROOT } from './lib/common.mjs';
import { bundle, comparable, readFixture, readGolden } from '../fingerprints/lib.mjs';

const MODE = process.env.MODE ?? 'run';
const NEG = process.env.FP_NEG ?? '';
const OUT_DIR = process.env.OUT_DIR ?? path.join(ROOT, 'test-results', 'fingerprints');
const TIMEOUT_MS = Number(process.env.FP_TIMEOUT_S ?? 900) * 1000;
const resultFile = (e) => path.join(OUT_DIR, `fingerprints-${e}${process.env.FP_TAG ? `-${process.env.FP_TAG}` : ''}.json`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const code = await bundle('iife');
// The case list and the diff come from the same bundle, run once in Node, so nothing is retyped.
const fp = await import('data:text/javascript;base64,' + Buffer.from(await bundle('esm')).toString('base64'));
const pick = process.env.FP_CASES ?? '';
const cases = fp.FINGERPRINT_CASES.filter((c) =>
  pick === 'all' ? true : pick ? pick.split(',').includes(c.name) : c.tier === 'regular' || c.name === 'realistic-600');
if (!cases.length) { console.error(`fingerprints: no cases match FP_CASES=${pick}`); process.exit(2); }

if (MODE === 'compare') {
  let bad = 0;
  for (const e of engines()) {
    const file = resultFile(e);
    if (!fs.existsSync(file)) { console.log(`MISMATCH ${e}: no results (${path.relative(ROOT, file)}); the run step did not finish`); bad++; continue; }
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    let first = true;
    for (const row of r.cases) {
      if (row.error) { console.log(`MISMATCH ${e} ${row.name}: did not run (${row.error})`); bad++; continue; }
      const g = readGolden(row.name);
      if (!g) { console.log(`MISMATCH ${e} ${row.name}: no golden`); bad++; continue; }
      const want = comparable(g);
      if (NEG === 'bump' && first) { want.fingerprint = { ...want.fingerprint, ledgerHash: want.fingerprint.ledgerHash + 1 }; first = false; }
      const diff = fp.diffFingerprint(want, { case: row.case, inputDigest: row.inputDigest, fingerprint: row.fingerprint });
      if (diff.length) { bad++; console.log(`MISMATCH ${e} ${row.name}: ${diff.length} differences; ${diff.slice(0, 5).join('; ')}`); }
      else console.log(`match    ${e} ${row.name}`);
    }
    console.log(`${e}: ${r.browserVersion}, ${r.cases.length} cases, results from ${r.at}`);
  }
  console.log(bad ? `fingerprints compare: ${bad} MISMATCH` : 'fingerprints compare: every case matches its golden');
  process.exit(bad ? 1 : 0);
}

let crashed = 0;
for (const e of engines()) {
  const t0 = Date.now();
  const out = { engine: e, at: new Date().toISOString(), browserVersion: null, cases: [] };
  let browser;
  try {
    browser = await launchers[e]();
    out.browserVersion = browser.version();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.addScriptTag({ content: code });
    if (NEG === 'crash') await page.evaluate(() => { globalThis.__fp = { ...globalThis.__fp, fingerprintShow: () => { throw new Error('FP_NEG crash'); } }; });
    for (const c of cases) {
      const t = Date.now();
      const fx = 'fixture' in c.input ? readFixture(c.input.fixture) : null;
      try {
        const res = await Promise.race([
          page.evaluate(([cc, f]) => {
            const doc = globalThis.__fp.caseInput(cc, () => f);
            return { inputDigest: globalThis.__fp.inputDigest(doc), fingerprint: globalThis.__fp.fingerprintShow(doc, cc.run) };
          }, [c, fx]),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS)),
        ]);
        out.cases.push({ name: c.name, ms: Date.now() - t, case: c, ...res });
        const g = readGolden(c.name);
        const diff = g ? fp.diffFingerprint(comparable(g), { case: JSON.parse(JSON.stringify(c)), ...res }) : ['no golden'];
        console.log(`${diff.length ? 'differs' : 'ran    '} ${e} ${c.name.padEnd(28)} ${String(Date.now() - t).padStart(7)} ms${diff.length ? `  (${diff.length} differences; MODE=compare reports them)` : ''}`);
      } catch (err) {
        crashed++;
        out.cases.push({ name: c.name, ms: Date.now() - t, error: String(err.message ?? err).slice(0, 300) });
        console.log(`CRASH   ${e} ${c.name}: ${String(err.message ?? err).slice(0, 200)}`);
        if (/timed out/.test(String(err))) break; // the page is still busy; later cases would queue behind it
      }
    }
    if (pageErrors.length) { crashed++; console.log(`CRASH   ${e}: page errors: ${pageErrors.slice(0, 3).join(' | ')}`); }
  } catch (err) {
    crashed++;
    out.cases.push({ name: '(launch)', error: String(err.message ?? err).slice(0, 300) });
    console.log(`CRASH   ${e}: could not run (${String(err.message ?? err).split('\n')[0]})`);
  } finally {
    await browser?.close().catch(() => {});
  }
  fs.writeFileSync(resultFile(e), JSON.stringify(out, null, 2) + '\n');
  console.log(`${e}: ${out.browserVersion ?? 'no browser'}; ${out.cases.length} cases in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, resultFile(e))}`);
}
console.log(crashed ? `fingerprints run: ${crashed} CRASH` : 'fingerprints run: every case ran');
process.exit(crashed ? 1 : 0);

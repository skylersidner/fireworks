// The browser half of the daily suite on its own, against a server that is already running.
// `node tools/test/run.mjs daily` is the real daily run (it starts its own API and writes the
// summary.json that the gate rule reads); this is for re-running the browser steps by hand.
//
// Usage: BASE=http://127.0.0.1:5190 [CODES=...] [ONLY=csp-chromium,follow-neg] [TIER=final] node daily.mjs
//   TIER=final adds the final-tier browser steps (benchmarks, at-maximums fingerprints).
//   Without CODES it saves the gate fixtures first (writes must be on). Steps: daily-steps.mjs.
//   Logs go to test-results/browser-daily/<stamp>/.
import path from 'node:path';
import fs from 'node:fs';
import { Runner, ROOT, stampNow, load, fmtS } from '../test/lib.mjs';
import { BASE, ensureSession, loadCodes, saveCodes, writeHeaders, HERE } from './lib/common.mjs';
import { dailySteps } from './daily-steps.mjs';

const dir = path.join(ROOT, 'test-results', 'browser-daily', stampNow());
const runner = new Runner('browser-daily', dir);
await ensureSession(BASE);
const codes = process.env.CODES || process.env.CODES_FILE ? await loadCodes(['shell', 'shellB', 'show', 'short']) : await saveCodes(BASE);
const r = await fetch(`${BASE}/api/creations`, { method: 'POST', headers: writeHeaders(), body: JSON.stringify({ kind: 'shell', document: JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'shellA.json'), 'utf8')).document }) });
const gone = (await r.json()).shareCode;
await fetch(`${BASE}/api/creations/${gone}`, { method: 'DELETE', headers: writeHeaders() });
runner.say(`browser-daily: BASE ${BASE} codes ${JSON.stringify(codes)} gone ${gone} load ${load()}`);
const only = process.env.ONLY?.split(',');
const port = new URL(BASE).port;
const t0 = Date.now();
for (const st of dailySteps({ codes, gone, tier: process.env.TIER ?? 'daily' })) {
  if (only && !only.includes(st.name)) continue;
  await runner.run({ ...st, args: st.args.map((a) => a.replace('$BASE', BASE).replace('$PORT', port)), env: { ...st.env, BASE, CODES: JSON.stringify(codes), OUT_DIR: dir }, envShown: st.env });
}
runner.summaryTable();
const failed = runner.failed();
runner.say(`browser-daily: ${failed.length ? `FAIL (${failed.map((x) => x.name).join(', ')})` : 'PASS'} | wall ${fmtS(Date.now() - t0)} | load ${load()}`);
process.exitCode = failed.length ? 1 : 0;

// The regular-tier Chromium smoke (testing-strategy.md §2.2 step 8; Skyler 2026-11-16: part of
// the regular tier). About a minute against a server that is already up; `tools/test/run.mjs
// regular` starts its own Production-mode API and passes BASE.
//
// Usage: BASE=http://127.0.0.1:5190 [CODES=...|CODES_FILE=...] node smoke.mjs
//   Without CODES it saves the gate fixtures first (lib/common.mjs SAVE_SET), signed in through the
//   server's stub OAuth (Phase 8), so the server must be Testing (or Development) with the stub.
//   headers.py needs a non-Development server on 127.0.0.1 (no Server header; HSTS only when forwarded).
// Steps (each must pass; every step runs, and the exit code is 1 if any failed):
//   headers      headers.py main: caching, site headers, CSP, 304s, 413, health (≈1 s)
//   roundtrip    gate-roundtrip chromium with SKIP_PLAY=1: builder edit, Save, Share, GET equals
//                POST, Show JSON copy/apply/save (≈15–20 s)
//   player-vt    player-virtual-time: the 10 s show to its end, Replay to its end, and the
//                frozen-clock control (≈12 s)
//   csp          gate-csp, real header, all nine pages, polling instead of fixed waits (≈20 s)
//   csp-neg      gate-csp MODE=none on three pages: each must show a blocked script (≈6 s)
//   auth         gate-auth (Phase 8 B3): same-site and cross-site CSRF from a :5190 page, zero
//                CSP violations across the real /signin -> stub -> /mine flow, and the
//                walk-alice / walk-bob ownership walk. Its negative controls run in daily.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { BASE, HERE, ensureSession, loadCodes, saveCodes } from './lib/common.mjs';

const t0 = Date.now();
await ensureSession(BASE);
const codes = process.env.CODES || process.env.CODES_FILE ? await loadCodes(['shell', 'shellB', 'show', 'short']) : await saveCodes(BASE);
console.log(`smoke: BASE ${BASE}; codes ${JSON.stringify(codes)}; load ${os.loadavg().map((x) => x.toFixed(1)).join(' ')}`);
const port = new URL(BASE).port || '80';
// headers.py also checks one lazy chunk's caching (as at the Phase 7 gate): find one in main-*.js.
const indexHtml = await (await fetch(`${BASE}/`)).text();
const mainJs = indexHtml.match(/main-[A-Za-z0-9_-]{8}\.js/)?.[0];
const chunk = mainJs ? (await (await fetch(`${BASE}/${mainJs}`)).text()).match(/chunk-[A-Za-z0-9_-]{8}\.js/)?.[0] : null;
const env = { ...process.env, BASE, CODES: JSON.stringify(codes), ENGINES: 'chromium' };
const steps = [
  ['headers', 'python3', ['-I', 'headers.py', port, codes.shell, codes.shellB, 'main', ...(chunk ? [chunk] : [])], {}],
  ['roundtrip', process.execPath, ['gate-roundtrip.mjs', 'chromium'], { SKIP_PLAY: '1' }],
  ['player-vt', process.execPath, ['player-virtual-time.mjs'], {}],
  ['csp', process.execPath, ['gate-csp.mjs'], {}],
  ['csp-neg', process.execPath, ['gate-csp.mjs'], { MODE: 'none', PATHS: '/,/show,/s/<show>' }],
  ['auth', process.execPath, ['gate-auth.mjs'], {}],
];
const only = process.env.SMOKE_ONLY?.split(',');
const rows = [];
for (const [name, cmd, args, extra] of steps) {
  if (only && !only.includes(name)) continue;
  const a = Date.now();
  const p = spawnSync(cmd, args, { cwd: HERE, env: { ...env, ...extra }, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  const out = (p.stdout ?? '') + (p.stderr ?? '');
  const ok = p.status === 0;
  rows.push({ name, ok, s: (Date.now() - a) / 1000 });
  console.log(`\n--- smoke ${name}: ${ok ? 'ok' : `FAIL (exit ${p.status}${p.signal ? ' ' + p.signal : ''})`} in ${((Date.now() - a) / 1000).toFixed(1)} s`);
  // Pass: the verdict lines only. Fail: the whole output.
  const lines = out.trimEnd().split('\n');
  console.log((ok ? lines.filter((l) => /PASS|FAIL|ok, \d+ fail|caught|frozen|ended after|7k\.3|saved|gate-auth/.test(l)).slice(-8) : lines).join('\n'));
}
const bad = rows.filter((r) => !r.ok);
console.log(`\nsmoke: ${bad.length ? 'FAIL' : 'PASS'} in ${((Date.now() - t0) / 1000).toFixed(1)} s | ${rows.map((r) => `${r.name} ${r.ok ? 'ok' : 'FAIL'} ${r.s.toFixed(1)}s`).join(' | ')}`);
process.exitCode = bad.length ? 1 : 0;

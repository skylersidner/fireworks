#!/usr/bin/env node
// The single entry point for the test tiers (docs/fireworks-app/testing-strategy.md §2; adopted by
// Skyler 2026-11-16). Node only, no dependencies.
//
//   node tools/test/run.mjs quick      dev loop, not a gate: format + typecheck on what changed,
//                                      the impacted specs (≈15–30 s)
//   node tools/test/run.mjs regular    every change and every phase gate (< 5 min); stops at the
//                                      first failure
//   node tools/test/run.mjs daily      run MANUALLY (no scheduler), once per phase before its gate;
//                                      about 25–30 min; runs every step and writes
//                                      test-results/daily/<stamp>/summary.json, which
//                                      `node tools/test/daily-status.mjs` reads for the gate rule
//   node tools/test/run.mjs final      the end-of-project review only (Skyler 2026-11-16): daily
//                                      plus the benchmarks (gate-warm, the seek bench), the
//                                      at-maximums runs (*.final.spec.ts, FP_CASES=at-maximums in
//                                      three engines) and the uncached docker build; writes
//                                      test-results/final/<stamp>/summary.json
//
// Options:
//   --list              print the tier's steps and exit
//   --only a,b          run only these steps (a daily run with --only or --skip is marked
//                       incomplete and never counts as green for a gate)
//   --skip a,b          skip these steps
//   --keep-going        regular/quick: run every step even after a failure (daily always does)
//   --hook              quick only: what the opt-in pre-commit hook runs (format on staged files
//                       and typecheck)
// Environment:
//   SMOKE_BASE=http://… use a running server for the smoke and browser steps instead of starting
//                       one (it must be Production mode with writes on, on 127.0.0.1, for headers)
//   FIREWORKS_TEST_PG   Npgsql base string without Database= (default: the compose Postgres on 5433)
// Exit codes: 0 all gating steps passed; 1 a gating step failed; 2 usage or setup error.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WEB, GATES, Runner, dropDb, fmtS, git, load, pgConn, pgUp, stampNow, startApi } from './lib.mjs';

const argv = process.argv.slice(2);
const tier = argv[0];
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const flag = (name) => argv.includes(name);
if (!['quick', 'regular', 'daily', 'final'].includes(tier)) {
  console.error('usage: node tools/test/run.mjs quick|regular|daily|final [--list] [--only a,b] [--skip a,b] [--keep-going] [--hook]');
  process.exit(2);
}
const only = opt('--only')?.split(',');
const skip = opt('--skip')?.split(',') ?? [];
const LONG = tier === 'daily' || tier === 'final';
const keepGoing = LONG || flag('--keep-going');
const stamp = stampNow();
const dir = path.join(ROOT, 'test-results', tier, stamp);
const npm = 'npm';
const npx = 'npx';
const tag = `${tier}_${process.pid}`;
const testDb = `fireworks_test_${tag}`;
const smokeDb = `fireworks_smoke_${tag}`;
const SLOW_FILE_S = 30;
const SLOW_TEST_S = 5;

// ---- Changed files (quick tier) ---------------------------------------------------------------
function changedFiles({ staged }) {
  const out = staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']) : [git(['diff', '--name-only', 'HEAD', '--diff-filter=ACMR']), git(['ls-files', '--others', '--exclude-standard'])].join('\n');
  return [...new Set((out ?? '').split('\n').filter(Boolean))].filter((f) => fs.existsSync(path.join(ROOT, f)));
}
const WEB_REL = 'src/web/fireworks-web/';
const TIERED_SPEC = /\.(daily|final)\.spec\.ts$/;
const FORMAT_RE = /^src\/web\/fireworks-web\/src\/.*\.(ts|html|scss|css|json)$/;
function impactedSpecs(files) {
  const impact = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'test', 'impact.json'), 'utf8')).web;
  const specs = new Set();
  for (const f of files.filter((x) => x.startsWith(WEB_REL + 'src/'))) {
    const rel = f.slice(WEB_REL.length);
    if (TIERED_SPEC.test(rel)) continue;
    if (rel.endsWith('.spec.ts')) { specs.add(rel); continue; }
    if (/\.(ts|html)$/.test(rel)) {
      const dirAbs = path.join(WEB, path.dirname(rel));
      const stem = path.basename(rel).replace(/\.(ts|html)$/, '');
      for (const s of fs.readdirSync(dirAbs)) if (s.startsWith(stem + '.') && s.endsWith('.spec.ts') && !TIERED_SPEC.test(s)) specs.add(path.join(path.dirname(rel), s));
    }
    for (const [prefix, globs] of Object.entries(impact)) if (rel.startsWith(prefix)) globs.forEach((g) => specs.add(g));
  }
  return [...specs].sort();
}
function impactedDotnetFilter(files) {
  const names = new Set();
  for (const f of files.filter((x) => x.startsWith('src/api/') && x.endsWith('.cs'))) {
    const n = path.basename(f, '.cs');
    names.add(n.endsWith('Tests') ? n : `${n}Tests`);
  }
  return [...names].map((n) => `FullyQualifiedName~${n}`).join('|');
}

// ---- Step definitions ----------------------------------------------------------------------------
const S = (name, cmd, args, o = {}) => ({ name, cmd, args, cwd: o.cwd ?? ROOT, env: o.env, envShown: o.envShown ?? o.env, timeoutS: o.timeoutS ?? 900, gate: o.gate, expectExit: o.expectExit, mustSay: o.mustSay, after: o.after });
const vitestJson = path.join(dir, 'vitest-regular.json');

function regularSteps() {
  return [
    S('format', npm, ['run', 'format:check'], { cwd: WEB, timeoutS: 120 }),
    S('fixtures', npm, ['run', 'fixtures:check'], { cwd: WEB, timeoutS: 120 }),
    S('typecheck', npm, ['run', 'typecheck'], { cwd: WEB, timeoutS: 300 }),
    S('unit-web', npm, ['run', 'test:regular', '--', '--reporters=default', '--reporters=json', `--output-file=${vitestJson}`], { cwd: WEB, timeoutS: 600, after: slowReport }),
    S('build-web', npm, ['run', 'build'], { cwd: WEB, timeoutS: 300 }),
    S('build-dotnet', 'dotnet', ['build', 'Fireworks.slnx', '--nologo', '-v', 'q'], { timeoutS: 300 }),
    S('test-dotnet-pg', 'dotnet', ['test', 'Fireworks.slnx', '--no-build', '--nologo'], { env: { FIREWORKS_TEST_POSTGRES: pgConn(testDb) }, envShown: { FIREWORKS_TEST_POSTGRES: `…;Database=${testDb}` }, timeoutS: 600 }),
    { name: 'smoke', special: 'smoke' },
  ];
}
function quickSteps() {
  const files = changedFiles({ staged: flag('--hook') });
  const fmt = files.filter((f) => FORMAT_RE.test(f)).map((f) => f.slice(WEB_REL.length));
  const steps = [
    fmt.length ? S('format-changed', npx, ['prettier', '--check', ...fmt], { cwd: WEB, timeoutS: 120 }) : { name: 'format-changed', skipBecause: 'no changed web source files' },
    S('typecheck', npm, ['run', 'typecheck'], { cwd: WEB, timeoutS: 300 }),
  ];
  if (flag('--hook')) return steps;
  const specs = impactedSpecs(files);
  steps.push(specs.length ? S('unit-impacted', npx, ['ng', 'test', '--no-watch', '--exclude=**/*.daily.spec.ts', '--exclude=**/*.final.spec.ts', ...specs.flatMap((s) => ['--include', s])], { cwd: WEB, timeoutS: 600 }) : { name: 'unit-impacted', skipBecause: 'no impacted spec files' });
  const filter = impactedDotnetFilter(files);
  if (filter) {
    steps.push(S('build-dotnet', 'dotnet', ['build', 'Fireworks.slnx', '--nologo', '-v', 'q'], { timeoutS: 300 }));
    steps.push(S('test-dotnet-impacted', 'dotnet', ['test', 'Fireworks.slnx', '--no-build', '--nologo', '--filter', filter], { timeoutS: 600 }));
  } else steps.push({ name: 'test-dotnet-impacted', skipBecause: 'no changed C# files' });
  return steps;
}
const specsOf = (suffix) => fs.readdirSync(path.join(WEB, 'src'), { recursive: true }).filter((f) => String(f).endsWith(suffix));
function dailySteps() {
  const steps = [
    ...regularSteps().filter((s) => s.name !== 'smoke'),
    specsOf('.daily.spec.ts').length ? S('unit-web-daily', npm, ['run', 'test:daily'], { cwd: WEB, timeoutS: 1800 }) : { name: 'unit-web-daily', skipBecause: 'no *.daily.spec.ts files' },
  ];
  // final = daily + the at-maximums specs + the final-only browser steps + the uncached build.
  if (tier === 'final') steps.push(specsOf('.final.spec.ts').length ? S('unit-web-final', npm, ['run', 'test:final'], { cwd: WEB, timeoutS: 1800 }) : { name: 'unit-web-final', skipBecause: 'no *.final.spec.ts files' });
  steps.push({ name: 'browser', special: 'browser-daily' });
  if (tier === 'final') steps.push(S('docker-build-nocache', 'docker', ['build', '--no-cache', '-t', 'fireworks:final', '.'], { timeoutS: 1800 }));
  return steps;
}

/** Vitest JSON → files over 30 s and tests over 5 s. A warning, never a failure (§4.8). */
function slowReport(runner) {
  if (!fs.existsSync(vitestJson)) return;
  const r = JSON.parse(fs.readFileSync(vitestJson, 'utf8'));
  const files = (r.testResults ?? []).map((f) => ({ f: path.relative(WEB, f.name), s: (f.endTime - f.startTime) / 1000 })).sort((a, b) => b.s - a.s);
  const tests = (r.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).map((t) => ({ t: `${path.basename(f.name)} > ${t.title}`, s: (t.duration ?? 0) / 1000 }))).sort((a, b) => b.s - a.s);
  const slowF = files.filter((x) => x.s > SLOW_FILE_S), slowT = tests.filter((x) => x.s > SLOW_TEST_S);
  runner.say(`        slowest file ${files[0]?.f} ${files[0]?.s.toFixed(1)} s; ${r.numTotalTests} tests in ${files.length} files`);
  for (const x of slowF) runner.say(`        warn: file over ${SLOW_FILE_S} s: ${x.f} ${x.s.toFixed(1)} s`);
  for (const x of slowT.slice(0, 10)) runner.say(`        warn: test over ${SLOW_TEST_S} s: ${x.t.slice(0, 110)} ${x.s.toFixed(1)} s`);
  if (slowT.length > 10) runner.say(`        warn: … ${slowT.length - 10} more tests over ${SLOW_TEST_S} s`);
}

// ---- The browser steps: our own API instance unless SMOKE_BASE is set ---------------------------
async function withApi(runner, label, fn) {
  if (process.env.SMOKE_BASE) {
    runner.say(`        ${label}: using SMOKE_BASE=${process.env.SMOKE_BASE} (not started or stopped by this run)`);
    return fn(process.env.SMOKE_BASE.replace(/\/$/, ''));
  }
  const t = Date.now();
  let api;
  try { api = await startApi({ db: smokeDb, logFile: path.join(dir, `api-${label}.log`) }); }
  catch (e) { runner.rows.push({ name: `${label}-api-start`, ok: false, gate: 'fail', ms: Date.now() - t, why: e.message }); runner.say(`  FAIL  ${`${label}-api-start`.padEnd(28)} ${fmtS(Date.now() - t).padStart(8)}  ${e.message}`); return; }
  runner.say(`        ${label}: started the API (Production, writes on) at ${api.base}, pid ${api.pid}, db ${api.db}, in ${fmtS(Date.now() - t)}`);
  try { return await fn(api.base); }
  finally {
    const err = await api.stop();
    runner.say(`        ${label}: stopped pid ${api.pid}; ${err ? `could not drop ${api.db}: ${err}` : `dropped ${api.db}`}`);
  }
}

async function smoke(runner) {
  await withApi(runner, 'smoke', (base) => runner.run(S('smoke', process.execPath, ['smoke.mjs'], { cwd: GATES, env: { BASE: base, OUT_DIR: path.join(dir, 'browser') }, timeoutS: 600 })));
}

async function browserDaily(runner) {
  const { dailySteps: gateSteps } = await import('../browser-gates/daily-steps.mjs');
  const { saveCodes } = await import('../browser-gates/lib/common.mjs');
  await withApi(runner, 'daily', async (base) => {
    const codes = await saveCodes(base);
    // notfound's "deleted" link: save one shell, then delete it.
    const r = await fetch(`${base}/api/creations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'shell', document: JSON.parse(fs.readFileSync(path.join(GATES, 'fixtures', 'shellA.json'), 'utf8')).document }) });
    const gone = (await r.json()).shareCode;
    await fetch(`${base}/api/creations/${gone}`, { method: 'DELETE' });
    runner.say(`        daily: codes ${JSON.stringify(codes)}, deleted ${gone}`);
    const port = new URL(base).port;
    for (const st of gateSteps({ codes, gone, tier })) {
      if (only && !only.includes(st.name) && !only.includes('browser')) continue;
      if (skip.includes(st.name)) { runner.skip(st.name, '--skip'); continue; }
      const args = st.args.map((a) => a.replace('$BASE', base).replace('$PORT', port));
      await runner.run({ ...st, args, env: { ...st.env, BASE: base, CODES: JSON.stringify(codes), OUT_DIR: path.join(dir, 'browser') }, envShown: st.env });
    }
  });
}

// ---- Main -------------------------------------------------------------------------------------------
const steps = tier === 'quick' ? quickSteps() : tier === 'regular' ? regularSteps() : dailySteps();
if (flag('--list')) {
  for (const s of steps) console.log(`${s.name}${s.skipBecause ? `  (would skip: ${s.skipBecause})` : ''}${s.cmd ? `  ${s.cmd} ${s.args.join(' ')}` : ''}`);
  if (LONG) { const { dailySteps: g } = await import('../browser-gates/daily-steps.mjs'); for (const s of g({ codes: {}, gone: '', tier })) console.log(`  browser: ${s.name} (${s.gate}${s.expectExit ? ', control' : ''})`); }
  process.exit(0);
}
const runner = new Runner(tier, dir);
const commit = git(['rev-parse', '--short', 'HEAD']);
const dirty = (git(['status', '--porcelain']) ?? '').split('\n').filter(Boolean).length;
const started = Date.now();
const startedAt = new Date().toISOString();
runner.say(`${tier}: ${stamp} | commit ${commit}${dirty ? ` + ${dirty} uncommitted paths` : ''} | node ${process.version} | load ${load()}`);
runner.say(`log dir: ${path.relative(ROOT, dir)}`);
if (tier !== 'quick' && !pgUp()) { runner.say('Postgres (fireworks-postgres on 5433) is not up: docker compose up -d postgres'); process.exit(2); }

const selected = (s) => (!only || only.includes(s.name)) && !skip.includes(s.name);
for (const s of steps) {
  if (!keepGoing && runner.failed().length) break;
  if (s.special === 'browser-daily') {
    const { dailySteps: g } = await import('../browser-gates/daily-steps.mjs');
    const names = g({ codes: {}, gone: '', tier }).map((x) => x.name);
    if (skip.includes('browser')) { runner.skip('browser', '--skip'); continue; }
    if (only && !only.includes('browser') && !only.some((o) => names.includes(o))) { runner.skip('browser', 'not selected'); continue; }
    await browserDaily(runner);
    continue;
  }
  if (!selected(s)) { runner.skip(s.name, only ? 'not selected' : '--skip'); continue; }
  if (s.skipBecause) { runner.skip(s.name, s.skipBecause); continue; }
  if (s.special === 'smoke') { await smoke(runner); continue; }
  await runner.run(s);
  s.after?.(runner);
}
if (tier !== 'quick') { const err = dropDb(testDb); if (err) runner.say(`could not drop ${testDb}: ${err}`); }

const wall = Date.now() - started;
runner.summaryTable();
const failed = runner.failed();
const notes = runner.rows.filter((r) => !r.ok && r.gate === 'report');
const incomplete = !!(only || skip.length) || runner.rows.some((r) => r.skipped && !/^no \*\.(daily|final)\.spec\.ts files$/.test(r.why ?? '') && !r.why?.startsWith('no changed') && !r.why?.startsWith('no impacted'));
const green = failed.length === 0;
runner.say(`${tier}: ${green ? 'PASS' : `FAIL (${failed.map((r) => r.name).join(', ')})`} | wall ${fmtS(wall)} | load ${load()}${notes.length ? ` | report-only notes: ${notes.map((r) => r.name).join(', ')}` : ''}${incomplete ? ' | INCOMPLETE (steps skipped)' : ''}`);
const summary = {
  tier, stamp, startedAt, finishedAt: new Date().toISOString(), wallMs: wall, commit, uncommittedPaths: dirty,
  green, complete: !incomplete, only, skip, node: process.version, loadAtEnd: load(),
  failed: failed.map((r) => r.name), reportOnlyNotes: notes.map((r) => r.name),
  pending: [],
  steps: runner.rows.map(({ text, ...r }) => r),
};
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
runner.say(`summary: ${path.relative(ROOT, path.join(dir, 'summary.json'))}`);
process.exitCode = green ? 0 : 1;

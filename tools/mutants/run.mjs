#!/usr/bin/env node
// Exact-swap mutant runner (skill .squad/skills/exact-swap-mutants/SKILL.md; testing-strategy.md
// §2.3, §7 step 6). Generalised from Toad's Phase 7 C3 scratchpad runners (mut.py, apimut.py,
// apimut2.py).
//
//   node tools/mutants/run.mjs <set> [mutant ids...]     e.g.  node tools/mutants/run.mjs c3-web W1 W3
//   node tools/mutants/run.mjs --list
//   node tools/mutants/run.mjs --check <set>     does each mutant still apply to the current tree?
//
// When (Skyler, 2026-11-16): at test replacement, at phase gates whose phase touched that code, and
// at the final review. Not daily. Serial only, on an otherwise idle machine; record the load.
//
// How it works:
//   1. The repo is copied into a rig (test-results/mutants/<set>-<stamp>/repo), keeping the repo
//      layout, schema/fixtures included, so specs that read ../../../schema or ../../../src/api still
//      resolve. The web app's node_modules is symlinked, never copied. The shared tree is never
//      mutated, so a teammate's parallel edit can't be clobbered.
//   2. A baseline run (no mutant) of the set's specs must pass, or the run stops.
//   3. Each mutant is an exact one-occurrence swap (old must occur once, new must not occur), run
//      against only the specs that can kill it, then restored in `finally` and touched (MSBuild
//      must see the restored C# file as newer than the mutant's build).
//   4. Verdicts. A TIMEOUT IS NEVER A KILL:
//        KILLED     at least one test failed with a non-timeout failure
//        TIMEOUT    every failure was a test timeout, or the process hit its limit: re-run it alone
//        SURVIVED   the specs passed
//        BROKEN     the build failed (a compile break is not a kill: use a type-preserving mutant)
//        STALE      old text is not in the file exactly once (the code moved on: update the set)
//      Exit 0 when every mutant was KILLED; 1 otherwise.
//
// A set is tools/mutants/sets/<name>.mjs exporting { kind: 'web' | 'api', description, mutants }.
//   web mutant: { id, name, file (relative to src/web/fireworks-web), old, new, specs: [...] }
//   api mutant: { id, name, file (relative to src/api/Fireworks.Api), old, new, filter ('' = all) }
//   Either kind may use { append: text } instead of old/new (a line added at the end of the file).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify } from './classify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const SETS = path.join(HERE, 'sets');

if (!args.length || args[0] === '--list') {
  for (const f of fs.readdirSync(SETS).filter((f) => f.endsWith('.mjs')).sort()) {
    const set = (await import(pathToFileURL(path.join(SETS, f)))).default;
    console.log(`${f.replace(/\.mjs$/, '')} (${set.kind}, ${set.mutants.length} mutants): ${set.description}`);
    for (const m of set.mutants) console.log(`  ${m.id}  ${m.name}`);
  }
  process.exit(args.length ? 0 : 2);
}

const check = args[0] === '--check';
const [setName, ...only] = check ? args.slice(1) : args;
const set = (await import(pathToFileURL(path.join(SETS, `${setName}.mjs`)))).default;
const chosen = set.mutants.filter((m) => !only.length || only.includes(m.id));
if (!chosen.length) throw new Error(`no mutants match ${only.join(' ')}`);
if (check) {
  // --check <set>: no tests, no rig. Does each mutant still apply to the CURRENT tree?
  let stale = 0;
  for (const m of chosen) {
    const file = path.join(ROOT, set.kind === 'web' ? 'src/web/fireworks-web' : 'src/api/Fireworks.Api', m.file);
    const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const nOld = src === null ? 0 : m.append ? 1 : src.split(m.old).length - 1;
    const nNew = src === null || m.append || m.new === '' ? 0 : src.split(m.new).length - 1;
    const ok = nOld === 1 && nNew === 0;
    if (!ok) stale++;
    console.log(`${ok ? 'applies' : 'STALE  '} ${m.id}${ok ? '' : `  (${src === null ? 'file missing' : `old ${nOld}×, new ${nNew}×`} in ${m.file})`}`);
  }
  console.log(`${setName}: ${chosen.length - stale} apply, ${stale} stale`);
  process.exit(stale ? 1 : 0);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RIG = path.join(ROOT, 'test-results', 'mutants', `${setName}-${stamp}`);
const REPO = path.join(RIG, 'repo');
const WEB = path.join(REPO, 'src', 'web', 'fireworks-web');
const API = path.join(REPO, 'src', 'api', 'Fireworks.Api');
const TIMEOUT_MS = Number(process.env.MUTANT_TIMEOUT_S ?? 1200) * 1000;
const log = (...a) => { const line = a.join(' '); console.log(line); fs.appendFileSync(path.join(RIG, 'mutants.log'), line + '\n'); };

fs.mkdirSync(RIG, { recursive: true });
const load = () => os.loadavg().map((x) => x.toFixed(1)).join(' ');
log(`set ${setName} (${set.kind}): ${chosen.length} mutants; rig ${REPO}; load ${load()}`);

// 1. The rig: a copy of the repo without build output, dependencies or git.
const rsync = spawnSync('rsync', ['-a', '--delete',
  '--exclude=.git', '--exclude=node_modules', '--exclude=bin', '--exclude=obj', '--exclude=.angular',
  '--exclude=/test-results', '--exclude=/src/api/Fireworks.Api/wwwroot', `${ROOT}/`, `${REPO}/`], { stdio: 'inherit' });
if (rsync.status !== 0) throw new Error('rsync failed');
fs.symlinkSync(path.join(ROOT, 'src', 'web', 'fireworks-web', 'node_modules'), path.join(WEB, 'node_modules'));

function runWeb(specs, tag) {
  const out = path.join(RIG, `${tag}.vitest.json`);
  fs.rmSync(out, { force: true });
  const p = spawnSync('npx', ['ng', 'test', '--no-watch', '--reporters=default', '--reporters=json', `--output-file=${out}`, ...specs.flatMap((s) => ['--include', s])],
    { cwd: WEB, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28, env: { ...process.env, CI: '1' } });
  const text = (p.stdout ?? '') + (p.stderr ?? '');
  fs.writeFileSync(path.join(RIG, `${tag}.log`), text);
  if (p.error?.code === 'ETIMEDOUT' || p.signal) return { verdict: 'TIMEOUT', detail: `process limit ${TIMEOUT_MS / 1000} s` };
  if (!fs.existsSync(out)) return { verdict: p.status === 0 ? 'SURVIVED' : 'BROKEN', detail: (text.match(/error TS\d+[^\n]*/) ?? [`exit ${p.status}, no report`])[0] };
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  const failed = [];
  for (const file of r.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      if (t.status !== 'failed') continue;
      const msg = (t.failureMessages ?? []).join('\n');
      failed.push({ test: `${path.basename(file.name)} > ${t.fullName}`, timeout: /Test timed out|timed out in \d+ ?ms|Hook timed out/i.test(msg), why: msg.split('\n').find((l) => /Error|expected/i.test(l))?.trim().slice(0, 160) ?? '?' });
    }
    if (file.status === 'failed' && !(file.assertionResults ?? []).some((t) => t.status === 'failed')) failed.push({ test: path.basename(file.name), timeout: false, suiteError: true, why: (file.message ?? '').split('\n')[0].slice(0, 160) });
  }
  return classify(p.status, failed, `${r.numPassedTests}/${r.numTotalTests} passed`);
}

function runApi(filter, tag) {
  const trxDir = path.join(RIG, `${tag}-trx`);
  fs.rmSync(trxDir, { recursive: true, force: true });
  const env = { ...process.env };
  delete env.FIREWORKS_TEST_POSTGRES; // the copy never touches a real database
  const p = spawnSync('dotnet', ['test', path.join(REPO, 'src', 'api', 'Fireworks.Api.Tests', 'Fireworks.Api.Tests.csproj'), ...(filter ? ['--filter', filter] : []), '--logger', 'trx;LogFileName=r.trx', '--results-directory', trxDir],
    { cwd: REPO, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28, env });
  const text = (p.stdout ?? '') + (p.stderr ?? '');
  fs.writeFileSync(path.join(RIG, `${tag}.log`), text);
  if (p.error?.code === 'ETIMEDOUT' || p.signal) return { verdict: 'TIMEOUT', detail: `process limit ${TIMEOUT_MS / 1000} s` };
  const trx = path.join(trxDir, 'r.trx');
  if (!fs.existsSync(trx)) return { verdict: p.status === 0 ? 'SURVIVED' : 'BROKEN', detail: (text.match(/error CS\d+[^\n]*/) ?? [`exit ${p.status}, no trx`])[0] };
  const xml = fs.readFileSync(trx, 'utf8');
  const failed = [];
  let passed = 0, total = 0;
  const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  // Self-closing results first, so a passed test's `/>` is never read as the start of a body.
  for (const m of xml.matchAll(/<UnitTestResult\b([^>]*?)\/>|<UnitTestResult\b([^>]*)>([\s\S]*?)<\/UnitTestResult>/g)) {
    const attrs = m[1] ?? m[2];
    const outcome = /outcome="([^"]+)"/.exec(attrs)?.[1];
    if (outcome === 'NotExecuted') continue;
    total++;
    if (outcome === 'Passed') { passed++; continue; }
    const msg = unxml(/<Message>([\s\S]*?)<\/Message>/.exec(m[3] ?? '')?.[1] ?? '');
    failed.push({ test: unxml(/testName="([^"]+)"/.exec(attrs)?.[1] ?? '?'), timeout: outcome === 'Timeout' || /timed out|Timeout|TaskCanceledException/i.test(msg.split('\n')[0]), why: msg.split('\n')[0].trim().slice(0, 160) });
  }
  return classify(p.status, failed, `${passed}/${total} passed`);
}


const run = (m, tag) => (set.kind === 'web' ? runWeb(m.specs, tag) : runApi(m.filter, tag));
const fileOf = (m) => path.join(set.kind === 'web' ? WEB : API, m.file);

// 2. Baseline: every distinct spec group (or filter) passes unmutated.
const groups = new Map();
for (const m of chosen) groups.set(set.kind === 'web' ? m.specs.join('|') : m.filter, m);
let i = 0;
for (const m of groups.values()) {
  const r = run(m, `baseline-${++i}`);
  log(`baseline ${i}/${groups.size} (${set.kind === 'web' ? m.specs.length + ' specs' : m.filter || 'all tests'}): ${r.verdict === 'SURVIVED' ? 'green' : r.verdict} ${r.detail}`);
  if (r.verdict !== 'SURVIVED') { log('BASELINE NOT GREEN: no mutant result would mean anything. Stopping.'); for (const f of r.failed ?? []) log(`    ${f.test} :: ${f.why}`); process.exit(1); }
}

// 3. Mutants.
const tally = {};
for (const m of chosen) {
  const file = fileOf(m);
  const src = fs.readFileSync(file, 'utf8');
  const nOld = m.append ? 1 : src.split(m.old).length - 1, nNew = m.append || m.new === '' ? 0 : src.split(m.new).length - 1;
  let r;
  if (nOld !== 1 || nNew !== 0) r = { verdict: 'STALE', detail: `old occurs ${nOld}×, new occurs ${nNew}× in ${m.file}` };
  else {
    fs.writeFileSync(file, m.append ? src + m.append : src.replace(m.old, () => m.new));
    try { r = run(m, m.id); }
    finally {
      fs.writeFileSync(file, src); // the rig is private, so restoring its own copy can't clobber anyone
      const t = new Date(); fs.utimesSync(file, t, t); // MSBuild must see the restore as newer
      if (fs.readFileSync(file, 'utf8') !== src) throw new Error(`${m.id}: the revert did not restore ${m.file} exactly`);
    }
  }
  tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  log(`${m.id} ${r.verdict.padEnd(8)} ${m.name} | ${r.detail} | load ${load()}`);
  for (const f of (r.failed ?? []).slice(0, 6)) log(`    ${f.timeout ? '[timeout] ' : ''}${f.test.slice(-150)} :: ${f.why}`);
}
log(`summary ${setName}: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}; log ${path.join(RIG, 'mutants.log')}`);
if (!process.env.KEEP_RIG) fs.rmSync(REPO, { recursive: true, force: true });
process.exitCode = (tally.KILLED ?? 0) === chosen.length ? 0 : 1;

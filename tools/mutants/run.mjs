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
//   Either kind may use { append: text } instead of old/new (a line added at the end of the file),
//   or { swaps: [{ file, old, new } | { file, append }, ...] } for a mutant that needs several
//   exact swaps (in one file or several) at once; every swap must apply, and all are restored.
//
// Postgres mutants (Boo's ruling 6, boo-phase8-security-verification.md; Toad B3). An api mutant
// may set `postgres: true`: its tests then run with FIREWORKS_TEST_POSTGRES set to the value of
// FIREWORKS_MUTANT_POSTGRES, but only when that string's Database= name ends in `_mut` or `_test`
// (the Postgres tests call EnsureDeletedAsync on whatever database they are given). Otherwise the
// mutant (and its baseline) is SKIPPED, never KILLED. Every other mutant still runs with
// FIREWORKS_TEST_POSTGRES stripped, whatever the caller's environment says.
//   FIREWORKS_MUTANT_POSTGRES="Host=localhost;Port=5433;Username=fireworks_app;Password=…;Database=fireworks_mut" \
//     node tools/mutants/run.mjs phase8-auth R1
// Exit codes: 0 every mutant KILLED; 3 every mutant that ran was KILLED but some were SKIPPED (not
// a full result: say which); 1 anything else.
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
/** A mutant's swaps: `swaps`, or the single { file, old, new | append } form. */
const swapsOf = (m) => m.swaps ?? [{ file: m.file, old: m.old, new: m.new, append: m.append }];
/** How many times old and new occur (an append counts as old once, new never). */
function counts(src, sw) {
  if (src === null) return { nOld: 0, nNew: 0 };
  return { nOld: sw.append ? 1 : src.split(sw.old).length - 1, nNew: sw.append || sw.new === '' ? 0 : src.split(sw.new).length - 1 };
}
/**
 * Ruling 6: the Postgres string for a `postgres: true` mutant, or the reason it can't run. Only a
 * Database= name ending in _mut or _test is accepted; the tests drop and recreate it.
 */
export function mutantPostgres(value = process.env.FIREWORKS_MUTANT_POSTGRES) {
  if (!value) return { skip: 'FIREWORKS_MUTANT_POSTGRES is not set' };
  const db = /(?:^|;)\s*Database\s*=\s*([^;]*)/i.exec(value)?.[1]?.trim() ?? '';
  if (!db) return { skip: 'FIREWORKS_MUTANT_POSTGRES has no Database=' };
  if ([...value.matchAll(/(?:^|;)\s*Database\s*=/gi)].length > 1) return { skip: 'FIREWORKS_MUTANT_POSTGRES names Database= more than once' };
  if (!/^[A-Za-z0-9_]+_(mut|test)$/.test(db)) return { skip: `FIREWORKS_MUTANT_POSTGRES names database "${db}", which does not end in _mut or _test` };
  return { conn: value, db };
}
if (process.env.MUTANT_PG_SELFTEST) {
  // node tools/mutants/run.mjs <any set> with MUTANT_PG_SELFTEST=1: the ruling-6 gate's own control.
  const cases = [
    [undefined, false], ['', false], ['Host=x;Database=fireworks', false], ['Host=x;Database=fireworks_dev', false],
    ['Host=x;Database=fireworks_mut', true], ['Host=x;database = fireworks_test ;Port=1', true],
    ['Host=x;Database=fireworks_mut;Database=fireworks', false], ['Host=x;Database=fireworks_mut_x', false],
    ['Host=x;Database=a-b_test', false], ['Host=x', false],
  ];
  let bad = 0;
  for (const [v, ok] of cases) { const r = mutantPostgres(v); if (!!r.conn !== ok) { bad++; console.log(`FAIL mutantPostgres(${JSON.stringify(v)}) = ${JSON.stringify(r)}`); } }
  console.log(bad ? `mutantPostgres: ${bad} case(s) wrong` : `mutantPostgres: ok (${cases.length} cases)`);
  process.exit(bad ? 1 : 0);
}
if (check) {
  // --check <set>: no tests, no rig. Does each mutant still apply to the CURRENT tree?
  let stale = 0;
  for (const m of chosen) {
    const problems = [];
    for (const sw of swapsOf(m)) {
      const file = path.join(ROOT, set.kind === 'web' ? 'src/web/fireworks-web' : 'src/api/Fireworks.Api', sw.file);
      const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const { nOld, nNew } = counts(src, sw);
      if (nOld !== 1 || nNew !== 0) problems.push(`${src === null ? 'file missing' : `old ${nOld}×, new ${nNew}×`} in ${sw.file}`);
    }
    if (problems.length) stale++;
    console.log(`${problems.length ? 'STALE  ' : 'applies'} ${m.id}${m.postgres ? ' (postgres)' : ''}${problems.length ? `  (${problems.join('; ')})` : ''}`);
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

function runApi(filter, tag, pg = null) {
  const trxDir = path.join(RIG, `${tag}-trx`);
  fs.rmSync(trxDir, { recursive: true, force: true });
  const env = { ...process.env };
  delete env.FIREWORKS_TEST_POSTGRES; // the copy never touches a real database...
  delete env.FIREWORKS_MUTANT_POSTGRES;
  if (pg) env.FIREWORKS_TEST_POSTGRES = pg.conn; // ...except a postgres: true mutant's _mut/_test one
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


if (set.kind === 'web' && chosen.some((m) => m.postgres)) throw new Error('postgres: true is for api mutants only');
const PG = mutantPostgres();
const pgFor = (m) => (m.postgres && PG.conn ? PG : null);
const skipped = (m) => (m.postgres && !PG.conn ? PG.skip : null);
const run = (m, tag) => (set.kind === 'web' ? runWeb(m.specs, tag) : runApi(m.filter, tag, pgFor(m)));
const fileOf = (sw) => path.join(set.kind === 'web' ? WEB : API, sw.file);
if (chosen.some((m) => m.postgres)) log(`postgres mutants: ${PG.conn ? `run on database ${PG.db} (FIREWORKS_MUTANT_POSTGRES)` : `SKIPPED: ${PG.skip}`}`);

// 2. Baseline: every distinct spec group (or filter, with or without Postgres) passes unmutated.
const groups = new Map();
for (const m of chosen) if (!skipped(m)) groups.set(set.kind === 'web' ? m.specs.join('|') : `${m.postgres ? 'pg:' : ''}${m.filter}`, m);
let i = 0;
for (const m of groups.values()) {
  const r = run(m, `baseline-${++i}`);
  log(`baseline ${i}/${groups.size} (${set.kind === 'web' ? m.specs.length + ' specs' : m.filter || 'all tests'}${m.postgres ? ', Postgres' : ''}): ${r.verdict === 'SURVIVED' ? 'green' : r.verdict} ${r.detail}`);
  if (r.verdict !== 'SURVIVED') { log('BASELINE NOT GREEN: no mutant result would mean anything. Stopping.'); for (const f of r.failed ?? []) log(`    ${f.test} :: ${f.why}`); process.exit(1); }
}

// 3. Mutants.
const tally = {};
for (const m of chosen) {
  // Swaps apply in order, each to the file as the previous swaps left it; originals are kept per file.
  const originals = new Map();
  const mutated = new Map();
  const stale = [];
  for (const sw of swapsOf(m)) {
    const f = fileOf(sw);
    if (!originals.has(f)) { const t0 = fs.readFileSync(f, 'utf8'); originals.set(f, t0); mutated.set(f, t0); }
    const src = mutated.get(f);
    const { nOld, nNew } = counts(src, sw);
    if (nOld !== 1 || nNew !== 0) { stale.push(`old occurs ${nOld}×, new occurs ${nNew}× in ${sw.file}`); continue; }
    mutated.set(f, sw.append ? src + sw.append : src.replace(sw.old, () => sw.new));
  }
  let r;
  if (skipped(m)) r = { verdict: 'SKIPPED', detail: `${skipped(m)} (not a kill)` };
  else if (stale.length) r = { verdict: 'STALE', detail: stale.join('; ') };
  else {
    try {
      for (const [f, t] of mutated) fs.writeFileSync(f, t);
      r = run(m, m.id);
    } finally {
      for (const [f, src] of originals) {
        fs.writeFileSync(f, src); // the rig is private, so restoring its own copy can't clobber anyone
        const t = new Date(); fs.utimesSync(f, t, t); // MSBuild must see the restore as newer
        if (fs.readFileSync(f, 'utf8') !== src) throw new Error(`${m.id}: the revert did not restore ${path.relative(REPO, f)} exactly`);
      }
    }
  }
  tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  log(`${m.id} ${r.verdict.padEnd(8)} ${m.name} | ${r.detail} | load ${load()}`);
  for (const f of (r.failed ?? []).slice(0, 6)) log(`    ${f.timeout ? '[timeout] ' : ''}${f.test.slice(-150)} :: ${f.why}`);
}
log(`summary ${setName}: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}; log ${path.join(RIG, 'mutants.log')}`);
if (!process.env.KEEP_RIG) fs.rmSync(REPO, { recursive: true, force: true });
const killed = tally.KILLED ?? 0, skips = tally.SKIPPED ?? 0;
if (skips) log(`NOTE: ${skips} mutant(s) SKIPPED (${chosen.filter(skipped).map((m) => m.id).join(', ')}): not killed, not run. Exit 3 unless something else failed.`);
process.exitCode = killed === chosen.length ? 0 : killed + skips === chosen.length ? 3 : 1;

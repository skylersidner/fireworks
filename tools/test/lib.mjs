// Shared plumbing for tools/test/run.mjs and tools/browser-gates/daily.mjs: step execution with
// logs and timings, the per-run Postgres database, and the smoke API instance. Node only, no
// dependencies.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB = path.join(ROOT, 'src', 'web', 'fireworks-web');
export const API_PROJECT = path.join(ROOT, 'src', 'api', 'Fireworks.Api');
export const API_DLL = path.join(API_PROJECT, 'bin', 'Debug', 'net11.0', 'Fireworks.Api.dll');
export const GATES = path.join(ROOT, 'tools', 'browser-gates');

// Node 26 first on PATH for every child (npm, npx, ng), whatever shell started the runner.
const NODE26 = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v26.5.0', 'bin');
export const baseEnv = () => ({ ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', PATH: [path.dirname(process.execPath), fs.existsSync(NODE26) ? NODE26 : null, process.env.PATH].filter(Boolean).join(':') });

export const load = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');
export const stampNow = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
export const fmtS = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function git(args) {
  const p = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return p.status === 0 ? p.stdout.trim() : null;
}

/** Runs one step: output to `<dir>/<nn>-<name>.log`, one console line per step, a tail on failure. */
export class Runner {
  constructor(tier, dir) {
    this.tier = tier;
    this.dir = dir;
    this.rows = [];
    fs.mkdirSync(dir, { recursive: true });
    this.logFile = path.join(dir, 'run.log');
  }
  say(line) {
    console.log(line);
    fs.appendFileSync(this.logFile, line + '\n');
  }
  /**
   * step: { name, cmd, args, cwd, env, timeoutS, gate ('fail'|'report'), expectExit, mustSay }
   * Returns the row. `ok` means the step met its expectation (for a negative control: it caught).
   */
  async run(step) {
    const n = String(this.rows.length + 1).padStart(2, '0');
    const log = path.join(this.dir, `${n}-${step.name}.log`);
    const started = Date.now();
    const loadBefore = load();
    const head = `$ (cd ${path.relative(ROOT, step.cwd ?? ROOT) || '.'}) ${[step.cmd, ...(step.args ?? [])].join(' ')}\n# env ${JSON.stringify(step.envShown ?? {})} load ${loadBefore}\n`;
    fs.writeFileSync(log, head);
    const res = await new Promise((resolve) => {
      const child = spawn(step.cmd, step.args ?? [], { cwd: step.cwd ?? ROOT, env: { ...baseEnv(), ...(step.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
      const out = fs.openSync(log, 'a');
      let text = '';
      const take = (b) => { fs.writeSync(out, b); if (step.mustSay || step.capture) text += b.toString(); };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, (step.timeoutS ?? 900) * 1000);
      child.on('error', (e) => { fs.writeSync(out, `\nspawn error: ${e.message}\n`); });
      child.on('close', (code, signal) => { clearTimeout(timer); fs.closeSync(out); resolve({ code: code ?? (signal ? 128 : 1), signal, timedOut, text }); });
    });
    const ms = Date.now() - started;
    const expect = step.expectExit ?? 0;
    let ok = !res.timedOut && res.code === expect;
    let why = res.timedOut ? `timed out after ${step.timeoutS ?? 900} s` : res.code === expect ? '' : `exit ${res.code}${expect ? ` (control expected exit ${expect})` : ''}`;
    if (ok && step.mustSay && !step.mustSay.test(res.text)) { ok = false; why = `exit ${res.code} but no ${step.mustSay} in the output: the control did not show its catch`; }
    const row = { name: step.name, ok, gate: step.gate ?? 'fail', control: !!expect, ms, exit: res.code, why, log: path.relative(ROOT, log), loadBefore, loadAfter: load(), text: step.capture ? res.text : undefined };
    this.rows.push(row);
    const tag = ok ? 'ok  ' : row.gate === 'report' ? 'note' : 'FAIL';
    this.say(`  ${tag}  ${step.name.padEnd(28)} ${fmtS(ms).padStart(8)}${row.gate === 'report' ? '  (report-only)' : ''}${why ? `  ${why}` : ''}`);
    if (!ok) {
      const tail = fs.readFileSync(log, 'utf8').trimEnd().split('\n').slice(-30);
      for (const l of tail) this.say(`        | ${l}`);
      this.say(`        log: ${row.log}`);
    }
    return row;
  }
  skip(name, reason) {
    const row = { name, ok: true, skipped: true, gate: 'fail', ms: 0, why: reason };
    this.rows.push(row);
    this.say(`  skip  ${name.padEnd(28)} ${''.padStart(8)}  ${reason}`);
    return row;
  }
  failed() { return this.rows.filter((r) => !r.ok && r.gate !== 'report'); }
  summaryTable() {
    const total = this.rows.reduce((s, r) => s + r.ms, 0);
    this.say('');
    this.say(`  step                           time  result`);
    for (const r of this.rows) this.say(`  ${r.name.padEnd(28)} ${fmtS(r.ms).padStart(8)}  ${r.skipped ? 'skipped' : r.ok ? (r.control ? 'ok (control caught)' : 'ok') : r.gate === 'report' ? 'noted (report-only)' : 'FAIL'}`);
    this.say(`  ${'sum of steps'.padEnd(28)} ${fmtS(total).padStart(8)}`);
  }
}

// ---- Postgres: one database per run, dropped at the end (testing-strategy.md §4.6) -------------
const PG = process.env.FIREWORKS_TEST_PG ?? 'Host=localhost;Port=5433;Username=fireworks_app;Password=fireworks_dev_password';
export const pgConn = (db) => `${PG};Database=${db}`;
export function dropDb(db) {
  if (!/^[a-z0-9_]+$/.test(db)) throw new Error(`refusing to drop ${db}`);
  if (db === 'fireworks') throw new Error('refusing to drop the dev database');
  const p = spawnSync('docker', ['exec', process.env.FIREWORKS_PG_CONTAINER ?? 'fireworks-postgres', 'psql', '-U', 'fireworks_app', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`], { encoding: 'utf8' });
  return p.status === 0 ? null : (p.stderr || p.stdout || 'docker exec failed').trim();
}
export function pgUp() {
  const p = spawnSync('docker', ['exec', process.env.FIREWORKS_PG_CONTAINER ?? 'fireworks-postgres', 'pg_isready', '-U', 'fireworks_app'], { encoding: 'utf8' });
  return p.status === 0;
}

// ---- The smoke API: the built API in Production mode, writes on, on a free port -----------------
export async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/**
 * Starts `dotnet Fireworks.Api.dll` from the last `dotnet build`, serving the last `ng build`'s
 * wwwroot, in Production (the real headers: no Server, HSTS only behind https) with
 * Identity__AllowAnonymousWrites=true and its own database (migrations apply at boot).
 * Returns { base, port, db, stop() }. stop() kills only this process and drops only this database.
 */
export async function startApi({ db, logFile }) {
  if (!fs.existsSync(API_DLL)) throw new Error(`${path.relative(ROOT, API_DLL)} is missing: run dotnet build first`);
  if (!fs.existsSync(path.join(API_PROJECT, 'wwwroot', 'index.html'))) throw new Error('wwwroot/index.html is missing: run ng build first');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const out = fs.openSync(logFile, 'a');
  const env = { ...baseEnv(), ASPNETCORE_ENVIRONMENT: 'Production', ASPNETCORE_URLS: base, ConnectionStrings__Postgres: pgConn(db), Identity__AllowAnonymousWrites: 'true' };
  delete env.ASPNETCORE_HTTP_PORTS;
  delete env.PORT;
  const child = spawn('dotnet', [API_DLL], { cwd: API_PROJECT, env, stdio: ['ignore', out, out] });
  let exited = null;
  child.on('exit', (code, sig) => { exited = { code, sig }; });
  const stop = async () => {
    if (!exited) {
      child.kill('SIGTERM');
      for (let i = 0; i < 100 && !exited; i++) await new Promise((r) => setTimeout(r, 100));
      if (!exited) child.kill('SIGKILL');
    }
    fs.closeSync(out);
    return dropDb(db);
  };
  const end = Date.now() + 90000;
  for (;;) {
    if (exited) { await stop(); throw new Error(`the API exited during startup (${JSON.stringify(exited)}); see ${path.relative(ROOT, logFile)}`); }
    const ok = await fetch(`${base}/health/ready`).then((r) => r.status === 200).catch(() => false);
    if (ok) break;
    if (Date.now() > end) { await stop(); throw new Error(`the API was not ready within 90 s; see ${path.relative(ROOT, logFile)}`); }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { base, port, db, pid: child.pid, stop };
}

// Shared helpers for the browser gates (testing-strategy.md §2, §3 item 12).
// Every script reads BASE, ENGINES and the saved codes the same way, so a run never depends on a
// scratchpad path or a hand-written codes.json.
//
//   BASE        the app origin (default http://localhost:5180). The smoke and daily runners pass
//               their own API instance here.
//   ENGINES     chromium (default) | chromium,firefox,webkit (the daily run).
//   CODES       '{"shell":"..","show":".."}' | SAVE (POST the fixtures below to BASE first).
//   CODES_FILE  a JSON file with the same shape (used when CODES is unset).
//   FW_SESSION_COOKIE  "__Host-fw.session=..." for writes (Phase 8: writes need a signed-in
//               session). ensureSession() signs in through the stub and sets it when unset.
import { chromium, firefox, webkit } from 'playwright';
import { signIn } from '../../fake-oauth/server.mjs';
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

/**
 * A signed-in session cookie for Node-side writes (Phase 8). Signs in through the API's configured
 * stub (tools/fake-oauth) as `subject` unless FW_SESSION_COOKIE is already set; sets it for children.
 */
export const SAVE_SUBJECT = 'smoke-user';
export async function ensureSession(base = BASE, subject = SAVE_SUBJECT) {
  if (!process.env.FW_SESSION_COOKIE) process.env.FW_SESSION_COOKIE = await signIn(base, subject);
  return process.env.FW_SESSION_COOKIE;
}

/** Headers for a Node-side write: JSON plus the session cookie (no Origin or Sec-Fetch-Site, so the CSRF guard passes). */
export const writeHeaders = (extra = {}) => ({ 'content-type': 'application/json', ...(process.env.FW_SESSION_COOKIE ? { cookie: process.env.FW_SESSION_COOKIE } : {}), ...extra });

/**
 * Signs a browser context in through the real redirect flow (login -> stub -> callback), landing on
 * a static file so no page boots. Proves the Secure __Host- cookie survives on http://127.0.0.1 in
 * this engine (probe P3). Throws if the context has no session cookie afterwards.
 * With `subject`, the stub is told (POST /__next-subject) to sign that account in; without it the
 * stub's default subject is used, which is NOT the account that owns the SAVE codes (SAVE_SUBJECT).
 */
export async function signInContext(context, base = BASE, subject = null) {
  if (subject) {
    const login = await fetch(`${base}/api/auth/login/google?returnUrl=%2F`, { redirect: 'manual' });
    if (login.status !== 302) throw new Error(`login: HTTP ${login.status}`);
    const q = await fetch(`${new URL(login.headers.get('location')).origin}/__next-subject?sub=${encodeURIComponent(subject)}`, { method: 'POST' });
    if (q.status !== 200) throw new Error(`stub /__next-subject: HTTP ${q.status}`);
  }
  const page = await context.newPage();
  await page.goto(`${base}/api/auth/login/google?returnUrl=${encodeURIComponent('/favicon.svg')}`);
  await page.close();
  const cookies = await context.cookies(base);
  if (!cookies.some((c) => c.name.endsWith('fw.session'))) throw new Error(`browser sign-in left no session cookie (have: ${cookies.map((c) => c.name).join(', ') || 'none'})`);
}

export async function saveCodes(base = BASE, keys = Object.keys(SAVE_SET)) {
  await ensureSession(base);
  const codes = {};
  for (const k of keys) {
    const [kind, doc] = SAVE_SET[k];
    const r = await fetch(`${base}/api/creations`, { method: 'POST', headers: writeHeaders(), body: JSON.stringify({ kind, document: doc() }) });
    if (r.status !== 201) throw new Error(`SAVE ${k}: HTTP ${r.status} ${(await r.text()).slice(0, 200)} (signed in on ${base}?)`);
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

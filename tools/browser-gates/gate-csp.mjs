// Phase 7 gate (Mario), 7b: zero CSP violations under the REAL header. Chromium by default
// (Skyler 2026-11-15: regular runs and the gate use one browser; the daily run sets ENGINES).
// No bypassCSP, no route injection, no waitForFunction (string predicates hit `script-src` without
// 'unsafe-eval' in some engines). Waits poll through page.evaluate.
//
// Usage: BASE=http://localhost:5180 CODES='{"shell":"...","show":"..."}'|SAVE node gate-csp.mjs
//   ENGINES=chromium (default) | chromium,firefox,webkit (the daily run)
//   PATHS=/,/show,...  only these paths (default: all nine; `<shell>` and `<show>` are replaced)
//   MODE=real (default) | none
//     none = negative control: route-injects `script-src 'none'`. A page counts as CAUGHT only on
//     positive evidence: a securitypolicyviolation event (or a "Refused to …" console line) AND
//     the stage never reaching data-status="running" within a short settle. Exit 0 only if EVERY
//     page is caught. NEG_SELFTEST=1 is the control's own control (see below). (Interlude fix, testing-strategy.md §3 item 8: this replaced a 30 s "wait for
//     running and expect a timeout" per page, which cost 488 s and would also have passed a page
//     that was merely slow.)
// Exit 0 (MODE=real) only if every page in every engine has 0 violations, 0 unexpected console
// errors, 0 page errors, and every stage page reaches data-status="running".
// Expected console error: the app's own 404 for /s/ZZZZZZZZ (and nothing else).
import { BASE, launchers, engines, loadCodes, until, stageStatus } from './lib/common.mjs';

const MODE = process.env.MODE ?? 'real';
if (!['real', 'none'].includes(MODE)) throw new Error('MODE must be real or none');
const codes = await loadCodes(['shell', 'show']);
const STAGE_PAGES = new Set(['/', '/show', `/c/${codes.show}`, `/s/${codes.shell}`, `/s/${codes.show}`]);
const ALL = ['/', '/show', `/c/${codes.show}`, `/s/${codes.shell}`, `/s/${codes.show}`, '/mine', '/status', '/s/ZZZZZZZZ', '/nope/page'];
const paths = process.env.PATHS ? process.env.PATHS.split(',').map((p) => p.replace('<shell>', codes.shell).replace('<show>', codes.show)) : ALL;
const EXPECTED_ERROR = /404|Not Found/i; // only on /s/ZZZZZZZZ
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 600); // late violations after the ready signal
const NEG_SETTLE_MS = Number(process.env.NEG_SETTLE_MS ?? 1500); // running must stay absent this long
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);

// Sanity: the header the app sends is the one Boo specified (7b.1).
const head = await fetch(`${BASE}/`);
const csp = head.headers.get('content-security-policy');
console.log('header', csp);
if (!/script-src 'self';/.test(csp ?? '')) throw new Error('no strict CSP header on /: wrong server?');

let bad = 0;
let caught = 0;
for (const name of engines()) {
  let browser;
  try { browser = await launchers[name](); } catch (e) { console.log(name, 'LAUNCH FAIL', e.message.split('\n')[0]); bad++; continue; }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {}
    window.__v = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__v.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
  });
  // NEG_SELFTEST=1 (MODE=none only): skip the injection, so the real header stays and nothing is
  // blocked. The control must then report NOT CAUGHT and exit 1: proof that it needs evidence.
  if (MODE === 'none' && !process.env.NEG_SELFTEST) {
    await ctx.route('**/*', async (route) => {
      const resp = await route.fetch();
      await route.fulfill({ response: resp, headers: { ...resp.headers(), 'content-security-policy': "default-src 'none'; script-src 'none'" } });
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content.Security|CSP|Refused to/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 200)));
  // Evidence for the control is a blocked SCRIPT, not any violation (default-src 'none' also blocks
  // the favicon, which would prove nothing about script-src).
  const scriptBlocked = () => page.evaluate(() => window.__v.some((v) => v.startsWith('script-src'))).catch(() => false);
  for (const path of paths) {
    try { await page.goto(BASE + path, { waitUntil: 'load' }); } catch (e) { errors.push('goto ' + e.message.slice(0, 120)); }
    let status = null;
    if (MODE === 'none') {
      // Positive evidence first: the blocked script reports itself.
      const evidence = await until(async () => (await scriptBlocked()) || errors.some((e) => /Refused to (load|execute) .*script/i.test(e)), 10000);
      await page.waitForTimeout(NEG_SETTLE_MS);
      status = await stageStatus(page);
      const v = await page.evaluate(() => window.__v.splice(0)).catch(() => []);
      errors.splice(0);
      const ok = !!evidence && status !== 'running';
      if (ok) caught++; else bad++;
      console.log(`[${secs()}s] none ${name} ${path} ${ok ? 'caught' : 'NOT CAUGHT'} violations=${v.length} status=${status}`, v.filter((x) => x.startsWith('script-src')).slice(0, 1));
      continue;
    }
    if (STAGE_PAGES.has(path)) {
      // The player waits behind the flashing notice when it shows; poll for either state instead of
      // a fixed 15 s click timeout.
      if (path.startsWith('/s/')) {
        const gate = await until(() => page.evaluate(() => (document.querySelector('[data-testid="flash-play"]') ? 'notice' : document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running' ? 'running' : null)).catch(() => null), 15000);
        if (gate === 'notice') await page.click('[data-testid="flash-play"]', { timeout: 5000 }).catch((e) => errors.push('flash-play ' + e.message.slice(0, 80)));
      }
      status = (await until(async () => (await stageStatus(page)) === 'running', 30000)) ? 'running' : await stageStatus(page);
    } else {
      await until(() => page.evaluate(() => !!document.querySelector('h1')).catch(() => false), 15000);
    }
    await page.waitForTimeout(SETTLE_MS);
    if (path === '/show' || path.startsWith('/c/')) {
      // The builder seeks and warms up; scrub far, wait for the seek to land, then open Show JSON.
      await page.fill('[data-testid="scrub"]', '50').catch((e) => errors.push('scrub ' + e.message.slice(0, 80)));
      await until(() => page.evaluate(() => !document.querySelector('[data-testid="catching-up"]')).catch(() => true), 20000);
      await page.waitForTimeout(SETTLE_MS);
      await page.click('[data-testid="show-json"] summary').catch((e) => errors.push('json ' + e.message.slice(0, 80)));
      await page.waitForSelector('[data-testid="show-json-text"]', { timeout: 5000 }).catch((e) => errors.push('json text ' + e.message.slice(0, 80)));
    }
    const v = await page.evaluate(() => window.__v.splice(0)).catch(() => ['(evaluate failed)']);
    const errs = errors.splice(0).filter((e) => !(path === '/s/ZZZZZZZZ' && EXPECTED_ERROR.test(e)));
    const stageBad = STAGE_PAGES.has(path) && status !== 'running';
    if (v.length || errs.length || stageBad) bad++;
    console.log(`[${secs()}s] ${MODE} ${name} ${path} status=${status} violations=${v.length} errors=${errs.length}`, v.slice(0, 3), errs.slice(0, 3));
  }
  await browser.close();
}
if (MODE === 'none') {
  const all = bad === 0 && caught > 0;
  console.log(all ? `none: negative control caught on all ${caught} page results (expected)` : `NEGATIVE CONTROL NOT CAUGHT on ${bad} page results: the check is blind there`);
  process.exitCode = all ? 0 : 1;
} else {
  console.log(`${MODE}: ${bad === 0 ? 'PASS' : 'FAIL'} (${bad} bad page results)`);
  process.exitCode = bad === 0 ? 0 : 1;
}

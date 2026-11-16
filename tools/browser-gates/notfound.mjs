// Mario Phase 7 gate: 7b.7 on the not-found pages gate-csp doesn't visit, 7c.3 browser half, 7d.1 browser half.
// Real header, Chromium. Usage: BASE=http://localhost:18097 GONE=<deleted code> node notfound.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE; const GONE = process.env.GONE;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  window.__v = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__v.push(`${e.effectiveDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
const errors = []; const apiReqs = [];
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('request', (r) => { if (r.url().includes('/api/creations')) apiReqs.push(r.url()); });
let bad = 0;
const rows = [];
for (const [path, expectApi] of [['/c/..%2Fme', false], ['/s/..%2Fme', false], ['/s/a.b', false], ['/s/abcdefgl', false], [`/s/${GONE}`, true]]) {
  apiReqs.length = 0; errors.length = 0;
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent?.trim(),
    focusH1: document.activeElement?.tagName === 'H1',
    buttons: [...document.querySelectorAll('[data-testid^="message-"]')].map((b) => b.textContent.trim()).filter(Boolean),
    v: window.__v.splice(0),
  }));
  const expErr = errors.filter((e) => !(expectApi && /404|Not Found/i.test(e)));
  const ok = r.v.length === 0 && expErr.length === 0 && r.focusH1 && (expectApi ? apiReqs.length === 1 : apiReqs.length === 0);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path} h1="${r.h1}" focusH1=${r.focusH1} buttons=${JSON.stringify(r.buttons)} api=${apiReqs.length} violations=${r.v.length} errors=${JSON.stringify(expErr)}`);
}
await browser.close();
console.log(bad ? `FAIL (${bad})` : 'PASS');
process.exitCode = bad ? 1 : 0;

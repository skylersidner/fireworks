// Phase 7 gate (Mario): 7h.1, 7h.2 and 7h.4 under emulated prefers-reduced-motion: reduce.
// Real header: no bypassCSP, no waitForFunction (polls with page.evaluate).
//
// Usage: BASE=http://localhost:5180 [CODES_FILE=codes.json] [ENGINES=chromium] [NEG=1] node gate-reduced-motion.mjs
//   ENGINES: chromium by default (Skyler 2026-11-15); the daily run may pass more.
//   NEG=1: negative control. The "reduce" contexts are opened with reducedMotion 'no-preference',
//          and an init script writes fireworks.reduceFlashing.v1 500 ms after load. Every reduce
//          check must then FAIL (the 7h.4 "without reduce" half is the control's own baseline and
//          is not counted). Exit 0 only if none of them passes.
// Checks:
//   7h.1  each stage surface (/, /show, /s/<shell>, /s/<show>) with EMPTY storage: the Reduce
//         flashing switch (role=switch) is checked, and the load writes no fireworks.reduceFlashing.v1.
//   7h.2  (notice already dismissed) / opens in Manual; the player opens paused with the centered
//         Play; /show opens paused.
//   7h.4  the knob doesn't slide under reduce: toggling the switch starts no CSS transition on
//         ::after (document.getAnimations()), and without reduce it starts one of 0.15 s. The
//         computed transition-property/-duration are reported too: the build reaches "no slide"
//         with transition-property: none (motion-reduce:transition-none), so the duration stays
//         0.15s, and 7h.4's literal "duration 0s" wording does not hold (Toad C4 finding).
import { chromium, firefox, webkit } from 'playwright';
import { loadCodes, outPath } from './lib/common.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://localhost:5180';
const NEG = !!process.env.NEG;
const codes = await loadCodes(['shell', 'show']);
const engines = {
  chromium: () => chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};
const only = (process.env.ENGINES ?? 'chromium').split(',');
const KEY = 'fireworks.reduceFlashing.v1';
const results = [];
function check(name, pass, detail = '', counted = true) {
  results.push({ name, pass: !!pass, counted });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
}
async function until(page, fn, arg, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await page.waitForTimeout(150);
  }
}
async function ctxFor(browser, { reduce, dismissed }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduce && !NEG ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(({ dismissed, neg, key }) => {
    try { if (dismissed) localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {}
    if (neg) setTimeout(() => { try { localStorage.setItem(key, 'true'); } catch {} }, 500);
  }, { dismissed, neg: NEG && reduce, key: KEY });
  return ctx;
}
async function knob(page) {
  return page.evaluate(async () => {
    const s = [...document.querySelectorAll('input.switch')].find((el) => el.getClientRects().length);
    const cs = getComputedStyle(s, '::after');
    const before = { property: cs.transitionProperty, duration: cs.transitionDuration };
    s.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const running = document.getAnimations().filter((a) => a.effect?.pseudoElement === '::after' && a.effect?.target === s);
    const out = { ...before, transitions: running.length, ms: running.map((a) => a.effect.getTiming().duration) };
    s.click(); // put the choice back
    return out;
  });
}
const surfaces = [['/', '/'], ['/show', '/show'], ['/s/<shell>', `/s/${codes.shell}`], ['/s/<show>', `/s/${codes.show}`]];

let launchFail = 0;
for (const name of only) {
  let browser;
  try { browser = await engines[name](); } catch (e) { console.log(name, 'LAUNCH FAIL', e.message.split('\n')[0]); launchFail++; continue; }
  console.log(`== ${name}${NEG ? ' (NEG)' : ''} ${BASE}`);

  // 7h.1: empty storage, one fresh context per surface.
  for (const [label, url] of surfaces) {
    const ctx = await ctxFor(browser, { reduce: true, dismissed: false });
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    const sw = await until(page, () => {
      const s = [...document.querySelectorAll('input[role="switch"]')].find((el) => el.getClientRects().length);
      return s ? { checked: s.checked, id: s.id || s.getAttribute('data-testid') } : null;
    }, null);
    await page.waitForTimeout(1500); // past the NEG write and any draft debounce
    const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
    const mq = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    check(`7h.1 ${label}: Reduce flashing switch is on under reduce`, sw?.checked === true, `${JSON.stringify(sw)} media=${mq}`);
    check(`7h.1 ${label}: the load does not write ${KEY}`, stored === null, `stored=${stored}`);
    await ctx.close();
  }

  // 7h.2: opening states (notice dismissed, so the opening state itself is visible).
  {
    const ctx = await ctxFor(browser, { reduce: true, dismissed: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await until(page, () => document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running', null);
    const mode = await page.getByLabel('Mode', { exact: true }).evaluate((el) => ({ value: el.value, text: el.selectedOptions?.[0]?.textContent.trim() })).catch((e) => ({ err: e.message.split('\n')[0] }));
    check('7h.2 /: opens in Manual', /manual/i.test(`${mode.value} ${mode.text}`), JSON.stringify(mode));

    for (const [label, url] of surfaces.slice(2)) {
      await page.goto(BASE + url);
      const st = await until(page, () => {
        const c = document.querySelector('[data-testid="player-center-play"]');
        const p = document.querySelector('[data-testid="player-pause"]');
        if (!c && !p) return null;
        return { center: !!c && !!c.getClientRects().length, centerText: c?.textContent.trim() ?? null, toggle: p?.textContent.trim() ?? null };
      }, null);
      await page.waitForTimeout(1000);
      const later = await page.evaluate(() => ({ center: !!document.querySelector('[data-testid="player-center-play"]'), toggle: document.querySelector('[data-testid="player-pause"]')?.textContent.trim() ?? null }));
      check(`7h.2 ${label}: the player opens paused with the centered Play`, st?.center && /Play/.test(st.centerText ?? '') && later.center && later.toggle !== 'Pause', `${JSON.stringify(st)} then ${JSON.stringify(later)}`);
    }

    await page.goto(BASE + '/show');
    await until(page, () => document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running', null);
    await page.waitForTimeout(1000);
    const play = await page.evaluate(() => document.querySelector('[data-testid="play"]')?.textContent.trim());
    // The builder opens paused on every load, so this row is a precondition, not a reduce check.
    check('7h.2 /show: opens paused', play === 'Play', `play button "${play}"`, false);

    // 7h.4 under reduce.
    const k = await knob(page);
    check('7h.4: under reduce, toggling the switch starts no ::after transition (the knob does not slide)', k.transitions === 0, JSON.stringify(k));
    await ctx.close();
  }
  {
    const ctx = await ctxFor(browser, { reduce: false, dismissed: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/show');
    await until(page, () => !!document.querySelector('.switch'), null);
    const k = await knob(page);
    check('7h.4: without reduce, toggling starts one 0.15 s ::after transition (the probe sees slides)', k.transitions === 1 && k.ms[0] === 150, JSON.stringify(k), false);
    await ctx.close();
  }
  await browser.close();
}
const counted = results.filter((r) => r.counted);
if (NEG) {
  const survivors = counted.filter((r) => r.pass);
  const base = results.filter((r) => !r.counted && !r.pass);
  console.log(`NEG: ${counted.length - survivors.length}/${counted.length} reduce checks failed as they should; survivors: ${survivors.map((r) => r.name).join(' | ') || 'none'}; baselines failed: ${base.length}`);
  process.exitCode = survivors.length === 0 && base.length === 0 && !launchFail ? 0 : 1;
} else {
  const failed = results.filter((r) => !r.pass);
  console.log(`${failed.length === 0 && !launchFail ? 'PASS' : 'FAIL'}: ${results.length - failed.length}/${results.length}`);
  process.exitCode = failed.length === 0 && !launchFail ? 0 : 1;
}

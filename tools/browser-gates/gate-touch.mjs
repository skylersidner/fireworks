// Phase 7 gate (Mario): touch and DPR checks in Chromium. 7i.1 (target sizes under coarse, on /,
// /show and /s/<code>), 7i.2 (≥ 8px spacing), 7i.5 (same dock Tab order at 390 and 1280, computed
// `order` 0), 7f.3 (canvas resolution: DPR 3 coarse → 1.5, desktop DPR 2 fine → 2, the stage and
// every timeline canvas including the ruler), and C2-1 (the scrub thumb is 24×32 on a clear track
// under coarse; 6×20 with a fine pointer).
// Real header: no bypassCSP, no waitForFunction.
//
// Usage: BASE=http://localhost:5180 [CODES_FILE=codes.json] [ENGINES=chromium] [NEG=1] node gate-touch.mjs
//   ENGINES: chromium by default (Skyler 2026-11-15). Coarse emulation is Chromium's isMobile+hasTouch.
//   NEG=1: negative control. "Coarse" contexts are opened with a fine pointer (no isMobile/hasTouch),
//          the desktop context at DPR 1, and at 390 the dock's Undo/Redo are swapped in the DOM and
//          one dock control gets `order: 1`. Every counted check must FAIL; baselines (fine-pointer
//          sizes, the fine thumb) are not counted. Exit 0 only if none passes.
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
const running = (page) => until(page, () => document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running', null, 30000);

const COARSE = () => (NEG
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }
  : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const FINE_NARROW = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 };
const DESKTOP = () => ({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: NEG ? 1 : 2 });

async function open(browser, opts, url, { neg390 = false } = {}) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((neg390) => {
    try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {}
    if (neg390) {
      const mess = () => {
        const u = document.querySelector('[data-testid="undo"]');
        const r = document.querySelector('[data-testid="redo"]');
        if (!u || !r || u.dataset.toad) return false;
        u.dataset.toad = '1';
        u.parentElement.insertBefore(r, u);
        r.style.order = '1';
        return true;
      };
      const id = setInterval(() => { if (mess()) clearInterval(id); }, 100);
    }
  }, neg390);
  const page = await ctx.newPage();
  await page.goto(BASE + url);
  return { ctx, page };
}

// 7i.1: computed sizes on one page (under the given pointer).
const sizes = () => {
  const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
  const out = { btn: 0, field: 0, sw: 0, link: 0, bad: [] };
  for (const el of document.querySelectorAll('.btn')) {
    if (!vis(el) || el.classList.contains('sr-only')) continue;
    out.btn++;
    const cs = getComputedStyle(el);
    if (px(cs.minHeight) < 44 || px(cs.minWidth) < 44 || cs.touchAction !== 'manipulation') out.bad.push(`btn ${el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 20)}: ${cs.minHeight}/${cs.minWidth}/${cs.touchAction}`);
  }
  for (const el of document.querySelectorAll('.field, select, input[type="number"]')) {
    if (!vis(el)) continue;
    out.field++;
    const cs = getComputedStyle(el);
    if (px(cs.minHeight) < 44 || cs.fontSize !== '16px') out.bad.push(`field ${el.getAttribute('aria-label') ?? el.id ?? el.tagName}: ${cs.minHeight}/${cs.fontSize}`);
  }
  for (const el of document.querySelectorAll('input[role="switch"]')) {
    if (!vis(el)) continue;
    out.sw++;
    const row = el.closest('label') ?? el.parentElement.closest('div');
    const h = row.getBoundingClientRect().height;
    if (h < 44 - 0.5) out.bad.push(`switch row ${el.id || el.getAttribute('data-testid')}: ${h}px`);
  }
  for (const el of document.querySelectorAll('a.touch-link, a[data-testid^="nav-"]')) {
    if (!vis(el)) continue;
    out.link++;
    const h = el.getBoundingClientRect().height;
    if (h < 44 - 0.5) out.bad.push(`link ${el.textContent.trim()}: ${h}px`);
  }
  for (const el of document.querySelectorAll('[data-testid="toast-dismiss"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 44 - 0.5 || r.height < 44 - 0.5) out.bad.push(`toast ×: ${r.width}x${r.height}`);
  }
  return out;
};

// 7i.2: consecutive targets in a group, bounding-box gap (same row: horizontal; wrapped: vertical).
const gaps = (sel) => {
  const groups = [];
  const pick = {
    zoom: () => [document.querySelector('[data-testid="zoom-group"]')].filter(Boolean).map((g) => [...g.querySelectorAll('button')]),
    topbar: () => { const r = document.querySelector('[data-testid="player-remix"]'); return r ? [[...r.parentElement.children].filter((c) => c.getClientRects().length)] : []; },
    card: () => [...document.querySelectorAll('[data-testid="mine-card"]')].slice(0, 3).map((c) => ['card-open', 'card-play', 'card-share', 'card-delete'].map((t) => c.querySelector(`[data-testid="${t}"]`)).filter((x) => x && x.getClientRects().length)),
  }[sel]();
  for (const g of pick) {
    const rs = g.map((el) => el.getBoundingClientRect());
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1], b = rs[i];
      const sameRow = b.top < a.bottom && a.top < b.bottom;
      groups.push(+(sameRow ? b.left - a.right : b.top - a.bottom).toFixed(2));
    }
  }
  return groups;
};

const canvases = () => [...document.querySelectorAll('canvas')].filter((c) => c.getClientRects().length).map((c) => {
  const r = c.getBoundingClientRect();
  const owner = c.getAttribute('data-testid') ?? c.closest('[data-testid]')?.getAttribute('data-testid') ?? c.parentElement.tagName.toLowerCase();
  return { owner, ratio: r.width ? +(c.width / r.width).toFixed(3) : null, w: c.width, cssW: +r.width.toFixed(1) };
});

// getComputedStyle(el, '::-webkit-slider-thumb') returns the input's own box in Chromium, so the
// thumb and track are read through CDP from the range's user-agent shadow tree (pseudo= nodes).
async function thumb(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const attrs = (n) => { const a = n.attributes ?? []; const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; return o; };
  const walk = (n, f) => { if (f(n)) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) { const r = walk(c, f); if (r) return r; } return null; };
  const input = walk(root, (n) => attrs(n)['data-testid'] === 'scrub');
  const find = (pseudo) => walk(input, (n) => attrs(n).pseudo === pseudo);
  const style = async (n) => { if (!n) return {}; const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: n.nodeId }); return Object.fromEntries(computedStyle.map((x) => [x.name, x.value])); };
  // The track carries pseudo=; the thumb inside it is id="thumb" (its shadow pseudo id isn't exposed).
  const track = find('-webkit-slider-runnable-track');
  const t = await style(track && walk(track, (n) => attrs(n).id === 'thumb'));
  const k = await style(track);
  await cdp.detach();
  return { thumbW: t.width, thumbH: t.height, radius: t['border-top-left-radius'], trackH: k.height, trackBg: k['background-color'] };
}

async function dockOrder(page) {
  await page.click('[data-testid="add-cue"]');
  await until(page, () => !!document.querySelector('[data-testid="inspector-new-seed"]'), null, 5000);
  return page.evaluate(() => {
    const dock = document.querySelector('[data-testid="dock"]');
    const sel = 'a[href], button, input, select, textarea, summary, [tabindex]';
    const list = [...dock.querySelectorAll(sel)].filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const orders = [...dock.querySelectorAll('*')].filter((el) => getComputedStyle(el).order !== '0').map((el) => `${el.getAttribute('data-testid') ?? el.tagName}:${getComputedStyle(el).order}`);
    return { list: list.map((el) => el.getAttribute('data-testid') ?? el.tagName.toLowerCase()), orders, first: list[0]?.getAttribute('data-testid') };
  });
}
async function tabOrder(page, first, n) {
  await page.evaluate((t) => document.querySelector(`[data-testid="${t}"]`).focus(), first);
  const seen = [await page.evaluate(() => document.activeElement.getAttribute('data-testid') ?? document.activeElement.tagName.toLowerCase())];
  for (let i = 1; i < n; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement.getAttribute('data-testid') ?? document.activeElement.tagName.toLowerCase()));
  }
  return seen;
}

let launchFail = 0;
for (const name of only) {
  let browser;
  try { browser = await engines[name](); } catch (e) { console.log(name, 'LAUNCH FAIL', e.message.split('\n')[0]); launchFail++; continue; }
  console.log(`== ${name}${NEG ? ' (NEG)' : ''} ${BASE}`);

  // 7i.1 under coarse, and the fine-pointer baseline at the same width.
  for (const [label, url] of [['/', '/'], ['/show', '/show'], ['/s/<shell>', `/s/${codes.shell}`], ['/s/<show>', `/s/${codes.show}`]]) {
    const { ctx, page } = await open(browser, COARSE(), url);
    await running(page);
    await page.waitForTimeout(500);
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const s = await page.evaluate(sizes);
    check(`7i.1 ${label}: targets under coarse (${s.btn} .btn, ${s.field} fields, ${s.sw} switch rows, ${s.link} links)`, coarse && s.btn > 0 && s.bad.length === 0, `coarse=${coarse} ${s.bad.slice(0, 6).join('; ')}${s.bad.length > 6 ? ` …(+${s.bad.length - 6})` : ''}`);
    await ctx.close();
    const f = await open(browser, FINE_NARROW, url);
    await running(f.page);
    const fine = await f.page.evaluate(() => [...document.querySelectorAll('.btn')].filter((el) => el.getClientRects().length).map((el) => getComputedStyle(el).minHeight));
    check(`7i.1 ${label}: fine pointer at 390 keeps desktop sizes (no .btn at min-height 44px)`, fine.length > 0 && !fine.includes('44px'), `${fine.length} .btn, min-heights ${[...new Set(fine)].join(',')}`, false);
    await f.ctx.close();
  }

  // 7i.2 spacing.
  for (const [label, url, sel] of [['/show zoom group', '/show', 'zoom'], ['/mine card actions', '/mine', 'card'], ['/s/<shell> top bar', `/s/${codes.shell}`, 'topbar']]) {
    const { ctx, page } = await open(browser, COARSE(), url);
    await until(page, (sel) => ({ zoom: '[data-testid="zoom-group"] button', card: '[data-testid="card-delete"]', topbar: '[data-testid="player-remix"]' })[sel] && !!document.querySelector(({ zoom: '[data-testid="zoom-group"] button', card: '[data-testid="card-delete"]', topbar: '[data-testid="player-remix"]' })[sel]), sel);
    await page.waitForTimeout(400);
    const g = await page.evaluate(gaps, sel);
    check(`7i.2 ${label}: adjacent targets ≥ 8px apart under coarse`, g.length > 0 && g.every((x) => x >= 7.5), `gaps ${g.join(', ')}`);
    if (sel === 'card') {
      // 7i.1's toast ×: a Share toast on /mine (the stage pages raise none on load).
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      await page.click('[data-testid="card-share"]');
      const r = await until(page, () => { const b = document.querySelector('[data-testid="toast-dismiss"]'); if (!b) return null; const x = b.getBoundingClientRect(); return { w: +x.width.toFixed(2), h: +x.height.toFixed(2), touch: getComputedStyle(b).touchAction }; }, null, 4000);
      check('7i.1 toast ×: ≥ 44×44 under coarse', r && r.w >= 43.5 && r.h >= 43.5, JSON.stringify(r));
    }
    await ctx.close();
  }

  // 7i.5 dock order at 1280 (fine) and 390 (coarse).
  {
    const wide = await open(browser, { viewport: { width: 1280, height: 800 } }, '/show');
    await running(wide.page);
    const w = await dockOrder(wide.page);
    const wTab = await tabOrder(wide.page, w.first, w.list.length);
    await wide.ctx.close();
    const narrow = await open(browser, COARSE(), '/show', { neg390: NEG });
    await running(narrow.page);
    await narrow.page.waitForTimeout(400);
    const n = await dockOrder(narrow.page);
    const nTab = await tabOrder(narrow.page, n.first, n.list.length);
    await narrow.ctx.close();
    const expected = w.list.filter((t) => t !== 'toolbar-duplicate').flatMap((t) => (t === 'add-cue' ? ['add-cue', 'edit-cue'] : [t]));
    check('7i.5: 390 dock Tab order = 1280 order minus Duplicate plus Edit cue', JSON.stringify(nTab) === JSON.stringify(expected) && JSON.stringify(wTab) === JSON.stringify(w.list), `1280 ${wTab.join(' ')} | 390 ${nTab.join(' ')}`);
    check('7i.5: no computed CSS order in the dock (both widths)', w.orders.length === 0 && n.orders.length === 0, `${w.orders.join(',')} | ${n.orders.join(',')}`);
  }

  // 7f.3 canvas resolution, and C2-1 the scrub thumb.
  {
    const m = await open(browser, COARSE(), '/show');
    await running(m.page);
    await m.page.waitForTimeout(800);
    const c = await m.page.evaluate(canvases);
    const owners = c.map((x) => x.owner);
    check('7f.3 DPR 3 coarse 390×844: every canvas (stage, ruler, lane, overview) is at 1.5', c.length >= 4 && c.every((x) => Math.abs(x.ratio - 1.5) <= 0.01) && owners.includes('timeline-ruler'), JSON.stringify(c));
    const t = await thumb(m.page);
    check('C2-1: under coarse the scrub thumb is 24×32 on a clear 32px track', t.thumbW === '24px' && t.thumbH === '32px' && t.trackH === '32px' && t.trackBg === 'rgba(0, 0, 0, 0)', JSON.stringify(t));
    await m.ctx.close();

    const d = await open(browser, DESKTOP(), '/show');
    await running(d.page);
    await d.page.waitForTimeout(800);
    const dc = await d.page.evaluate(canvases);
    check('7f.3 desktop DPR 2 fine: every canvas (stage, ruler, lane, overview) is at 2', dc.length >= 4 && dc.every((x) => Math.abs(x.ratio - 2) <= 0.01) && dc.some((x) => x.owner === 'timeline-ruler'), JSON.stringify(dc));
    const ft = await thumb(d.page);
    check('C2-1 baseline: fine pointer scrub thumb is 6×20 on a clear track', ft.thumbW === '6px' && ft.thumbH === '20px' && ft.trackBg === 'rgba(0, 0, 0, 0)', JSON.stringify(ft), false);
    await d.ctx.close();
  }
  await browser.close();
}
const counted = results.filter((r) => r.counted);
if (NEG) {
  const survivors = counted.filter((r) => r.pass);
  const base = results.filter((r) => !r.counted && !r.pass);
  console.log(`NEG: ${counted.length - survivors.length}/${counted.length} checks failed as they should; survivors: ${survivors.map((r) => r.name).join(' | ') || 'none'}; baselines failed: ${base.length}`);
  process.exitCode = survivors.length === 0 && base.length === 0 && !launchFail ? 0 : 1;
} else {
  const failed = results.filter((r) => !r.pass);
  console.log(`${failed.length === 0 && !launchFail ? 'PASS' : 'FAIL'}: ${results.length - failed.length}/${results.length}`);
  process.exitCode = failed.length === 0 && !launchFail ? 0 : 1;
}

// Phase 7 gate (Mario), 7l.3: the cold-seek warm-up bar on the production build (image).
// From Luigi's pw/luigi-warm.mjs (Toad's A3 seeds), with Toad's verdicts (C3). MEASUREMENT run:
// the context uses bypassCSP (waitForFunction needs it); the CSP itself is gate-csp.mjs's job.
// Usage: node gate-warm.mjs <base> <codes.json|SAVE> [after|early|cold|frames|nowarm-check]
//   SAVE: POSTs realistic-600 and done-when-60 (toad-a3/shows.mjs) to <base> first (writes on).
// Bars (acceptance 7l.3): realistic-600 after warm-up p95 < 1000 ms; done-when-60 after warm-up
// p95 <= 866 * 1.2 = 1039 ms. Record uptime with the result; a load over ~6 invalidates it.
// 7l.5 (MODE=early, Skyler 2026-11-15): per show, a PAIRED same-load run. First a no-warm-up
// baseline (the same build with the builder's compiled `warmUp` binding flipped to false by
// page.route; the patch must apply exactly once and data-warm-up must stay "off", or the run
// fails), then the early run (seeks start 1 s after load, warm-up on). Pass per show if
// early p95 <= 4330 ms OR early p95 <= 1.2 x the paired baseline p95, and every seek in both
// runs lands on its exact target (the scrub's bound value equals t after catch-up).
// MODE=nowarm-check: the baseline mechanism's own control (patch applied, attr stays off), no timing.
// Engine: Chromium only (Skyler 2026-11-15: regular runs and the gate use one browser).
import { chromium } from 'playwright';
import { outPath } from './lib/common.mjs';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const [BASE, CODES, MODE = 'after'] = process.argv.slice(2);
let codes;
if (CODES === 'SAVE') {
  const { fixture, realistic } = await import('../bench/shows.mjs');
  codes = {};
  for (const [k, doc] of Object.entries({ 'done-when-60': fixture('done-when-60s-50'), 'realistic-600': realistic(600) })) {
    const r = await fetch(`${BASE}/api/creations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'show', document: doc }) });
    if (!r.ok) throw new Error(`save ${k}: ${r.status} ${await r.text()}`);
    codes[k] = (await r.json()).shareCode;
  }
  console.log('saved', JSON.stringify(codes));
} else {
  codes = JSON.parse(fs.readFileSync(CODES, 'utf8'));
  delete codes['at-max-600']; // not part of the 7l.3 bar
}
console.log('uptime', execSync('uptime').toString().trim());
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const WARM_ON = '(`warmUp`,!0)', WARM_OFF = '(`warmUp`,!1)';
async function openPage(code, { noWarm = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, bypassCSP: true });
  const patched = { n: 0 };
  if (noWarm) {
    await ctx.route(/\.js(\?|$)/, async (route) => {
      const resp = await route.fetch();
      const body = await resp.text();
      const hits = body.split(WARM_ON).length - 1;
      if (!hits) return route.fulfill({ response: resp, body });
      patched.n += hits;
      await route.fulfill({ response: resp, body: body.split(WARM_ON).join(WARM_OFF) });
    });
  }
  await ctx.route('**/api/client-config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ playback: { seekBudgetMs: 25, catchingUpDelayMs: 0, checkpointIntervalSeconds: 10, checkpointMemoryMiB: 64 } }) }));
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {}
    window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    window.__seek = async (t) => {
      const s = document.querySelector('[data-testid="scrub"]');
      const t0 = performance.now();
      s.value = String(t); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
      let seen = false, frames = 0;
      for (let i = 0; i < 3 && !seen; i++) { if (document.querySelector('[data-testid="catching-up"]')) seen = true; else await raf(); }
      if (seen) while (document.querySelector('[data-testid="catching-up"]')) { await raf(); frames++; }
      await raf();
      const landed = Number(s.value);
      return { ms: performance.now() - t0, via: seen ? 'dom' : 'dom<=3f', frames, landed, exact: Math.abs(landed - t) < 1e-9, readout: document.querySelector('[data-testid="time"]')?.textContent?.trim() ?? null };
    };
    window.__frames = async (ms) => { const out = []; let last = performance.now(); const end = last + ms; while (performance.now() < end) { const t = await raf(); out.push(t - last); last = t; } return out; };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`${BASE}/c/${code}`);
  await page.waitForURL(/\/show$/, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running', null, { timeout: 60000 });
  return { ctx, page, errors, t0, patched };
}
const longs = async (page) => page.evaluate(() => { const l = window.__long; window.__long = []; return { n: l.length, max: Math.round(Math.max(0, ...l)), sumMs: Math.round(l.reduce((s, x) => s + x, 0)) }; });
async function randomSeeks(page, n = 20) {
  const max = await page.evaluate(() => Number(document.querySelector('[data-testid="scrub"]').max));
  const r = rng(20261115); const ms = []; const via = {}; const missed = [];
  await longs(page);
  for (let i = 0; i < n; i++) {
    const t = Math.round(r() * max * 10) / 10;
    const res = await page.evaluate((t) => window.__seek(t), t);
    ms.push(res.ms); via[res.via] = (via[res.via] ?? 0) + 1;
    if (!res.exact) missed.push({ t, landed: res.landed });
    await page.waitForTimeout(300);
  }
  return { p50: Math.round(q(ms, 0.5)), p95: Math.round(q(ms, 0.95)), max: Math.round(Math.max(...ms)), over1s: ms.filter((x) => x > 1000).length, via, missed, longTasks: await longs(page), all: ms.map(Math.round) };
}
const results = { base: BASE, mode: MODE, at: new Date().toISOString() };
async function earlyRun(code, noWarm) {
  const R = {};
  const { ctx, page, errors, patched } = await openPage(code, { noWarm });
  await page.waitForTimeout(1000);
  R.warmUpAtStart = await page.evaluate(() => document.querySelector('app-fireworks-stage')?.getAttribute('data-warm-up'));
  if (MODE !== 'nowarm-check') R.seeks = await randomSeeks(page);
  R.warmUpAtEnd = await page.evaluate(() => document.querySelector('app-fireworks-stage')?.getAttribute('data-warm-up'));
  R.patched = patched.n;
  R.errors = errors.slice(0, 5);
  await ctx.close();
  return R;
}
for (const [name, code] of Object.entries(codes)) {
  if (MODE === 'early' || MODE === 'nowarm-check') {
    // Paired, same load: baseline first, then the early run, back to back.
    const base = await earlyRun(code, true);
    const early = await earlyRun(code, false); // nowarm-check: no seeks, only the attribute
    results[name] = { baseline: base, early, uptime: execSync('uptime').toString().trim() };
    console.log(name, MODE, JSON.stringify(results[name]));
    continue;
  }
  const R = (results[name] = {});
  const { ctx, page, errors, t0 } = await openPage(code);
  if (MODE === 'after') {
    await page.waitForFunction(() => document.querySelector('app-fireworks-stage')?.getAttribute('data-warm-up') === 'finished', null, { timeout: 300000, polling: 50 });
    R.warmUpMsFromLoad = Date.now() - t0;
    R.warmUpLongTasks = await longs(page);
  } else {
    await page.waitForTimeout(1500);
  }
  if (MODE === 'frames') {
    await page.waitForTimeout(500);
    R.pausedFramesDuringWarmUp = await page.evaluate(async () => { const f = await window.__frames(2000); f.sort((a, b) => a - b); return { n: f.length, p50: Math.round(f[f.length >> 1]), p95: Math.round(f[Math.floor(f.length * 0.95)]) }; });
  } else {
    R.seeks = await randomSeeks(page);
  }
  R.warmUpAtEnd = await page.evaluate(() => document.querySelector('app-fireworks-stage')?.getAttribute('data-warm-up'));
  R.errors = errors.slice(0, 5);
  console.log(name, MODE, JSON.stringify(R));
  await ctx.close();
}
await browser.close();
results.uptimeAfter = execSync('uptime').toString().trim();
let pass = null;
if (MODE === 'after') {
  pass = true;
  const bars = { 'realistic-600': 1000, 'done-when-60': 866 * 1.2 };
  for (const [name, bar] of Object.entries(bars)) {
    const sk = results[name]?.seeks; const p95 = sk?.p95;
    const ok = typeof p95 === 'number' && p95 < bar && results[name].warmUpAtEnd === 'finished' && sk.missed.length === 0;
    if (!ok) pass = false;
    console.log(`${name}: p95 ${p95} ms (bar < ${Math.round(bar)}), missed ${sk?.missed?.length}, warm-up ${results[name]?.warmUpMsFromLoad} ms from load, ${ok ? 'ok' : 'FAIL'}`);
  }
} else if (MODE === 'early' || MODE === 'nowarm-check') {
  pass = true;
  for (const [name, R] of Object.entries(results)) {
    if (!R?.baseline) continue;
    const b = R.baseline;
    // The baseline is only a baseline if warm-up really was off on the same build.
    const baseValid = b.patched === 1 && b.warmUpAtStart === 'off' && b.warmUpAtEnd === 'off';
    if (!baseValid) { pass = false; console.log(`${name}: INVALID BASELINE (patched ${b.patched}, warm-up ${b.warmUpAtStart}->${b.warmUpAtEnd})`); continue; }
    if (MODE === 'nowarm-check') {
      // Control: the same page unpatched does warm up, so "off" above is the patch's doing.
      const on = R.early.warmUpAtStart !== 'off' && R.early.patched === 0;
      if (!on) pass = false;
      console.log(`${name}: baseline off (patched ${b.patched}); unpatched warm-up at 1 s = ${R.early.warmUpAtStart} ${on ? 'ok' : 'FAIL'}`);
      continue;
    }
    const e = R.early; const bp = b.seeks.p95; const ep = e.seeks.p95;
    const exact = b.seeks.missed.length === 0 && e.seeks.missed.length === 0;
    const warmRan = e.warmUpAtStart !== 'off'; // the early run must actually have warm-up on
    const ok = exact && warmRan && (ep <= 4330 || ep <= bp * 1.2);
    if (!ok) pass = false;
    console.log(`${name}: early p95 ${ep} ms vs paired baseline ${bp} ms (bar <= 4330 or <= ${Math.round(bp * 1.2)}), missed ${e.seeks.missed.length}+${b.seeks.missed.length}, warm-up at 1 s ${e.warmUpAtStart}, ${ok ? 'ok' : 'FAIL'} | ${R.uptime}`);
  }
}
const out = outPath(`gate-warm-${MODE}-${Date.now()}.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log(pass === null ? `(mode ${MODE}: no verdict)` : pass ? 'PASS' : 'FAIL', 'written', out, results.uptimeAfter);
process.exitCode = pass === false ? 1 : 0;

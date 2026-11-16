// Phase 7 gate (Mario), 7j / C2 ruling 3: a plain wheel scroll on the timeline stops Follow while
// playing (phase-6.md §5.1). Chromium, real header (no bypassCSP, no waitForFunction). ~30 s real time.
// The view is read from the draft (fireworks.showDraft.v1 → view.scroll), which Follow's paging
// (timeline viewChange → store.setView) and the wheel (manualView) both write.
//
// Usage: BASE=http://localhost:5180 [CODES_FILE=codes.json] [ENGINES=chromium] [NEG=1] node gate-follow.mjs
//   NEG=1: no wheel is sent (Follow keeps paging), so the "view stays put" check must FAIL.
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
const scrollOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('fireworks.showDraft.v1'))?.view?.scroll ?? null; } catch { return null; } });
async function until(page, fn, timeout) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await page.waitForTimeout(250); }
}
let ok = true;
for (const name of only) {
  const browser = await engines[name]();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/c/${codes.show}`);
  await until(page, () => page.evaluate(() => location.pathname === '/show' && document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running'), 30000);
  for (let i = 0; i < 5; i++) await page.click('[data-testid="zoom-in"]');
  await page.click('[data-testid="back-to-start"]');
  await page.waitForTimeout(600);
  const s0 = await scrollOf(page);
  await page.click('[data-testid="play"]');
  // Precondition: Follow pages the view while playing.
  const paged = await until(page, async () => { const s = await scrollOf(page); return s !== null && s !== s0 ? s : null; }, 20000);
  console.log(`${paged !== null ? 'ok  ' : 'FAIL'} precondition: Follow pages the zoomed view while playing (scroll ${s0} → ${paged})`);
  if (paged === null) { ok = false; await browser.close(); continue; }
  if (!NEG) {
    const box = await page.locator('[data-testid="timeline-lane"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -60); // scroll back toward the start, away from the playhead
  }
  await page.waitForTimeout(800);
  const s1 = await scrollOf(page);
  await page.waitForTimeout(10000); // longer than one view window at this zoom
  const s2 = await scrollOf(page);
  const playing = await page.evaluate(() => document.querySelector('[data-testid="play"]')?.textContent.trim());
  const stays = s1 === s2 && playing === 'Pause';
  console.log(`${stays ? 'ok  ' : 'FAIL'} 7j: after a wheel scroll the view stays put while playing (scroll ${paged} → wheel ${s1} → 10 s later ${s2}; button "${playing}")`);
  if (NEG ? stays : !stays) ok = false;
  await browser.close();
}
console.log(NEG ? (ok ? 'NEG PASS: the check failed without the wheel' : 'NEG FAIL') : ok ? 'PASS' : 'FAIL');
process.exitCode = ok ? 0 : 1;

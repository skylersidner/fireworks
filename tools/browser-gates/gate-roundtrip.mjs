// Phase 7 gate (Mario): Done-when round trip + Show JSON round trip (7k.3). Chromium by default
// (Skyler 2026-11-15: one browser for regular runs and the gate; the engine args stay for the daily run).
// JSON_ENGINE defaults to chromium (a fresh profile in the same engine); JSON_ENGINE=none skips it.
// From p6smoke/done-when-toad.mjs. Phase 7 changes (Toad, C3):
//  - BASE defaults to the production build with the real CSP (5180 / the image), not ng serve.
//  - Every context is a MEASUREMENT context (bypassCSP: true): page.waitForFunction is blocked by
//    script-src without 'unsafe-eval'. The CSP is checked separately by gate-csp.mjs.
//  - SKIP_PLAY=1 skips the real-time player run to the end (the long part).
//  - JSON_ENGINE=<engine>: after the save in <which>, open /c/<code> in <which>, Copy the Show JSON
//    text, Apply it in JSON_ENGINE (fresh profile), Save there; the POST body's document must
//    deep-equal the saved document (7k.3). Negative control: TOAD_JSON_TAMPER=1 edits one seed
//    before Apply, and the check must fail.
// Usage: BASE=http://localhost:5180 [SKIP_PLAY=1] [JSON_ENGINE=firefox] node gate-roundtrip.mjs <engine> [code|-] [playerEngine]
// Phase 6 Done-when smoke (Luigi; revised by Toad: 6b.2 move/delete on different cues, Share click): build a 60 s / 50-cue show in /show (seeded, then add, move and
// delete one cue through the UI), Save through the builder, open /s/{code} in a fresh context and
// play it to the end. Usage: node done-when.mjs [chromium|firefox|webkit] [code-to-replay]
import { chromium, firefox, webkit } from 'playwright';
import { SCHEMA_FIXTURES } from './lib/common.mjs';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const FIXTURE = JSON.parse(readFileSync(`${SCHEMA_FIXTURES}/valid/show/done-when-60s-50.json`, 'utf8'));

const which = process.argv[2] ?? 'chromium';
const reuseCode = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const playerEngine = process.argv[4] ?? which;
const BASE = process.env.BASE ?? 'http://localhost:5180';
const engines = { chromium, firefox, webkit };
const launchOpts =
  which === 'chromium'
    ? { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { headless: true };

const t0 = Date.now();
const log = (...a) => console.log(`[${which} ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

function shells() {
  return {
    s1: { version: 1, name: 'Crossette', burstHeight: 0.62, angleJitter: 6, breaks: [{ color1: 'green', trail: 'tail', stars: 28, speed: 210, burn: 1.0, drag: 1.0, effect: 'crossette', size: 1.2 }] },
    s2: { version: 1, name: 'Crackling Heart', burstHeight: 0.62, angleJitter: 6, breaks: [{ pattern: 'heart', color1: 'pink', stars: 90, speed: 200, burn: 1.5, drag: 1.0, effect: 'crackle' }] },
    s3: { version: 1, name: 'Willow', burstHeight: 0.62, angleJitter: 6, breaks: [{ color1: 'gold', trail: 'glitter', stars: 110, speed: 210, burn: 3.6, drag: 1.5, size: 0.8 }] },
    s4: { version: 1, name: 'Strobe', burstHeight: 0.62, angleJitter: 6, breaks: [{ color1: 'white', stars: 150, speed: 220, burn: 2.4, drag: 1.2, effect: 'strobe', size: 0.8 }] },
    s5: { version: 1, name: 'Four Break', burstHeight: 0.55, angleJitter: 6, breaks: [
      { color1: 'blue', stars: 80, speed: 170, burn: 1.2 },
      { pattern: 'ring', color1: 'gold', stars: 60, speed: 210, burn: 1.3, delay: 0.7 },
      { color1: 'white', stars: 120, speed: 240, burn: 1.0, effect: 'crackle', delay: 0.8 },
      { color1: 'purple', stars: 80, speed: 170, burn: 1.2, delay: 0.9 },
    ] },
    s6: { version: 1, name: 'Peony', burstHeight: 0.62, angleJitter: 6, breaks: [{ color1: 'red', color2: 'gold', changeAt: 0.65 }] },
  };
}
function cues() {
  const keys = ['s1', 's2', 's3', 's4', 's5'];
  const out = [];
  for (let i = 1; i <= 50; i++) {
    const c = { id: `c${i}`, t: Math.round(((i - 1) * 600) / 49) / 10, shell: keys[(i - 1) % 5], x: i === 1 ? 0 : i === 50 ? 1 : ((i * 37) % 101) / 100, seed: Math.imul(i, 2654435761 | 0) };
    if (i % 7 === 0) c.burstHeight = [0.5, 0.6, 0.7][i % 3];
    out.push(c);
  }
  out[1].t = out[9].t;
  out[2].t = out[19].t;
  return out;
}
const draft = {
  show: FIXTURE.document,
  nextCueId: 51, selectedCueId: null, activeShell: { kind: 'preset', index: 0 },
  view: { pxPerSecond: null, scroll: 0 }, dirty: true, saved: false, source: null,
};

const browser = await engines[which].launch(launchOpts);
const launchFor = (e) => (e === 'chromium' ? engines[e].launch(launchOpts.channel ? launchOpts : { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }) : engines[e].launch({ headless: true }));

/** 7k.3: Copy in engine A (`which`), Apply in engine B (fresh profile), Save in B. */
async function showJsonRoundTrip(code, engineB) {
  const saved = (await (await fetch(`${BASE}/api/creations/${code}`)).json()).document;
  // A: open the saved show as a working copy, open Show JSON, take the text.
  const ca = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
  await ca.addInitScript(() => { try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {} });
  const pa = await ca.newPage();
  watch(pa, 'json-A');
  await pa.goto(`${BASE}/c/${code}`);
  await pa.waitForURL(/\/show$/, { timeout: 60000 });
  await pa.click('[data-testid="show-json"] summary');
  let text = await pa.inputValue('[data-testid="show-json-text"]', { timeout: 10000 });
  await ca.close();
  if (!isDeepStrictEqual(JSON.parse(text), saved)) throw new Error('7k.2: A\'s Show JSON text is not the saved document');
  if (process.env.TOAD_JSON_TAMPER) { const d = JSON.parse(text); d.cues[0].seed += 1; text = JSON.stringify(d, null, 2); }
  // B: fresh profile in another engine; paste, Apply (clean builder: no dialog), Save.
  const bb = engineB === which ? browser : await launchFor(engineB);
  const cb = await bb.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
  await cb.addInitScript(() => { try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {} });
  const pbg = await cb.newPage();
  watch(pbg, 'json-B');
  await pbg.goto(`${BASE}/show`);
  await pbg.waitForSelector('app-fireworks-stage[data-status="running"]', { state: 'attached', timeout: 60000 });
  await pbg.click('[data-testid="show-json"] summary');
  await pbg.fill('[data-testid="show-json-text"]', text);
  await pbg.click('[data-testid="show-json-apply"]');
  // Applied (or an adjusted-values variant) before Save; anything else means Apply didn't take.
  await pbg.locator('[data-testid="show-json-note"]', { hasText: /Applied/ }).waitFor({ timeout: 10000 });
  const note = (await pbg.textContent('[data-testid="show-json-note"]')).trim();
  log('json B note', note);
  const resp = pbg.waitForResponse((r) => r.url().endsWith('/api/creations') && r.request().method() === 'POST', { timeout: 30000 });
  await pbg.click('[data-testid="save-save"]');
  const r = await resp;
  const body = r.request().postDataJSON();
  const ok = r.status() === 201 && body.kind === 'show' && isDeepStrictEqual(body.document, saved);
  log('7k.3 Show JSON', which, '->', engineB, JSON.stringify({ status: r.status(), deepEqual: isDeepStrictEqual(body.document, saved), ok }));
  await cb.close();
  if (bb !== browser) await bb.close();
  if (!ok) throw new Error('7k.3 Show JSON round trip differs');
}
const errors = [];
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
}
let code = reuseCode;
let posted = null;
try {
  if (!code) {
    const a = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
    if (which === 'chromium') await a.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    // Negative control for the share check: a clipboard that always rejects.
    if (process.env.TOAD_BLOCK_CLIPBOARD) await a.addInitScript(() => { if (navigator.clipboard) navigator.clipboard.writeText = () => Promise.reject(new Error('toad blocked')); });
    await a.addInitScript((d) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('fireworks.showDraft.v1', JSON.stringify(d));
      localStorage.setItem('fireworks.flashNotice.v1', '1');
    }, draft);
    const page = await a.newPage();
    watch(page, 'builder');
    const ledger = [];
    page.on('request', (r) => { if (r.url().includes('/api/')) ledger.push(`${r.method()} ${r.url().replace(BASE, '')}`); });
    await page.goto(`${BASE}/show`);
    await page.waitForSelector('app-fireworks-stage[data-status="running"]', { state: 'attached', timeout: 60000 });
    log('stage', await page.getAttribute('app-fireworks-stage', 'data-renderer'));
    const status = () => page.textContent('[data-testid="toolbar-status"]');
    log('status', await status());
    // 6b.2: move cue A and delete a *different* cue B, all from the focused timeline.
    // Home selects the first cue in firing order (c1, t 0, x 0); ArrowRight the next (A).
    const draftNow = async () => { await page.waitForTimeout(700); return JSON.parse(await page.evaluate(() => localStorage.getItem('fireworks.showDraft.v1'))); };
    await page.focus('[data-testid="timeline"]');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    const movedId = (await draftNow()).selectedCueId;
    const beforeMove = Number(await page.inputValue('[data-testid="inspector-t"]'));
    await page.focus('[data-testid="timeline"]');
    await page.keyboard.press('.');
    const movedCue = (await draftNow()).show.cues.find((c) => c.id === movedId);
    const afterMove = Number(await page.inputValue('[data-testid="inspector-t"]'));
    log('moved', movedId, beforeMove, '->', afterMove, JSON.stringify(movedCue));
    if (!movedId || movedId === 'c1' || Math.abs(afterMove - beforeMove - 0.1) > 1e-9 || movedCue.t !== afterMove) throw new Error('6b.2: move did not take');
    // Select another cue (two further in firing order) and delete it with Delete.
    // TOAD_SAME_CUE=1 is the 6b.2 negative control: Luigi's original path (delete the moved cue).
    if (!process.env.TOAD_SAME_CUE) {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
    }
    const deletedId = (await draftNow()).selectedCueId;
    if (!process.env.TOAD_SAME_CUE && (!deletedId || deletedId === movedId || deletedId === 'c1' || deletedId === 'c50')) throw new Error(`6b.2: bad delete target ${deletedId}`);
    await page.keyboard.press('Delete');
    const afterDelete = await draftNow();
    log('deleted', deletedId, 'cues', afterDelete.show.cues.length, await status());
    if (!process.env.TOAD_SAME_CUE && (afterDelete.show.cues.some((c) => c.id === deletedId) || !afterDelete.show.cues.some((c) => c.id === movedId))) throw new Error('6b.2: delete hit the wrong cue');
    // Add one: seek to 30 s with the scrub bar, pick Ring in Presets, Add cue.
    await page.fill('[data-testid="scrub"]', '30');
    await page.click('[data-testid="lib-preset-4"]');
    await page.click('[data-testid="add-cue"]');
    await page.waitForTimeout(300);
    log('after add', await status(), 'announce:', await page.textContent('[data-testid="announcer"]'));
    // Play 3 s, pause.
    await page.click('[data-testid="play"]');
    await page.waitForTimeout(3000);
    await page.click('[data-testid="play"]');
    log('time', await page.textContent('[data-testid="time"]'), 'hud', await page.textContent('app-hud').catch(() => ''));
    // Save.
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/creations') && r.request().method() === 'POST');
    await page.click('[data-testid="save-save"]');
    const r = await resp;
    const body = await r.json();
    posted = r.request().postDataJSON();
    code = body.shareCode;
    log('saved', r.status(), code, 'cues', posted.document.cues.length, 'keys', Object.keys(posted).join(','), Object.keys(posted.document).join(','));
    log('indicator', await page.textContent('[data-testid="save-indicator"]'));
    const d = posted.document;
    const ts = d.cues.map((c) => c.t);
    log('6b.1 after edits', JSON.stringify({ duration: d.duration, cues: d.cues.length, t0: ts.includes(0), t60: ts.includes(60), shells: Object.keys(d.shells).length }));
    // 6b.2 on the POST body: t 0 and x 0 kept, the moved cue survives as moved, the deleted one is gone.
    const byId = Object.fromEntries(d.cues.map((c) => [c.id, c]));
    const checks = {
      cues50: d.cues.length === 50,
      t0: d.cues.some((c) => c.t === 0),
      x0: d.cues.some((c) => c.x === 0),
      t60x1: d.cues.some((c) => c.t === 60 && c.x === 1),
      c1: byId.c1?.t === 0 && byId.c1?.x === 0,
      moved: byId[movedId]?.t === afterMove && isDeepStrictEqual({ ...byId[movedId], t: 0 }, { ...FIXTURE.document.cues.find((c) => c.id === movedId), t: 0 }),
      deletedGone: !(deletedId in byId),
      added: d.cues.some((c) => c.id === 'c51' && Math.abs(c.t - 30) < 0.05),
      kind: posted.kind === 'show',
      status201: r.status() === 201,
    };
    log('6b.2 POST checks', JSON.stringify(checks));
    if (Object.values(checks).some((v) => !v)) throw new Error('6b.2 POST checks failed');
    // 6a.4 / 6f.9: Share copies exactly origin + /s/{code}, sends nothing, and shows the toast.
    const sharedLedgerAt = ledger.length;
    await page.evaluate(() => {
      const c = navigator.clipboard;
      if (!c) return;
      const orig = c.writeText.bind(c);
      window.__toadCopied = [];
      c.writeText = (t) => { window.__toadCopied.push(t); return orig(t); };
    });
    await page.click('[data-testid="share"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-kind="success"] span, [data-testid="share-blocked"]')].some((e) => /Share link copied|Copy was blocked/.test(e.textContent)), null, { timeout: 10000 });
    const copied = await page.evaluate(() => window.__toadCopied);
    const toasts = await page.$$eval('[data-kind="success"] span', (es) => es.map((e) => e.textContent.trim()));
    const blocked = await page.$('[data-testid="share-link-field"]');
    const want = `${BASE}/s/${code}`;
    let realClip = null;
    if (which === 'chromium') realClip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `read failed: ${e.message}`);
    const shareOk = isDeepStrictEqual(copied, [want]) && toasts.includes('Share link copied.') && !blocked && ledger.length === sharedLedgerAt && (realClip === null || realClip === want);
    log('share', JSON.stringify({ copied, toasts, blocked: !!blocked, newRequests: ledger.slice(sharedLedgerAt), realClip, ok: shareOk }));
    if (!shareOk) throw new Error('6f.9 share failed');
    const got = await (await fetch(`${BASE}/api/creations/${code}`)).json();
    log('GET deep-equals POST', isDeepStrictEqual(got.document, posted.document), 'kind', got.kind);
    if (!isDeepStrictEqual(got.document, posted.document)) throw new Error('round trip differs');
    log('ledger', JSON.stringify(ledger));
    await a.close();
  }
  const jsonEngine = process.env.JSON_ENGINE ?? 'chromium';
  if (jsonEngine !== 'none') await showJsonRoundTrip(code, jsonEngine);
  if (process.env.SKIP_PLAY) { log('SKIP_PLAY: player run skipped'); }
  else {
  // Fresh context: the player (optionally another engine, 6b.3).
  const pb = playerEngine === which ? browser : await engines[playerEngine].launch(playerEngine === 'chromium' ? { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { headless: true });
  const b = await pb.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
  // 6a.8 negative controls: TOAD_INJECT_ERROR=1 logs a console.error in the player;
  // TOAD_HIDE_ENDED=1 removes the ended state as it appears (so the wait must time out).
  if (process.env.TOAD_INJECT_ERROR) await b.addInitScript(() => setTimeout(() => console.error('toad negative control'), 3000));
  if (process.env.TOAD_HIDE_ENDED) await b.addInitScript(() => new MutationObserver(() => document.querySelector('[data-testid="player-ended"]')?.remove()).observe(document, { childList: true, subtree: true }));
  const page = await b.newPage();
  watch(page, 'player');
  const ledger = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) ledger.push(`${r.method()} ${r.url().replace(BASE, '')}`); });
  await page.goto(`${BASE}/s/${code}`);
  await page.waitForSelector('[data-testid="flash-notice"]', { timeout: 60000 });
  log('notice', (await page.textContent('[data-testid="flash-notice-text"]')).replace(/\s+/g, ' ').trim());
  await page.click('[data-testid="flash-play"]');
  await page.waitForSelector('app-fireworks-stage[data-status="running"]', { state: 'attached', timeout: 60000 });
  log('player engine', playerEngine, 'playing; renderer', await page.getAttribute('app-fireworks-stage', 'data-renderer'));
  const started = Date.now();
  let last = '';
  while (true) {
    const ended = await page.$('[data-testid="player-ended"]');
    if (ended) break;
    const t = await page.textContent('[data-testid="player-time"]');
    if (t !== last && Date.now() - started > 0) { last = t; }
    if (Date.now() - started > Number(process.env.TOAD_END_TIMEOUT_S ?? 900) * 1000) throw new Error(`timed out at ${t}`);
    await page.waitForTimeout(2000);
    if ((Date.now() - started) % 20000 < 2100) log('player time', t);
  }
  log('ENDED after', ((Date.now() - started) / 1000).toFixed(1), 's wall; meta', await page.textContent('[data-testid="player-time"]'));
  log('ended text', (await page.textContent('[data-testid="player-ended"]')).replace(/\s+/g, ' ').trim());
  log('announcer', await page.textContent('[data-testid="player-announcer"]'));
  log('player ledger', JSON.stringify(ledger));
  // Replay starts from 0 again and ends again (6h.4).
  await page.click('[data-testid="player-ended-replay"]');
  await page.waitForTimeout(1500);
  log('after replay: ended gone', (await page.$('[data-testid="player-ended"]')) === null, 'meta', await page.textContent('[data-testid="player-time"]'));
  await b.close();
  if (pb !== browser) await pb.close();
  }
} finally {
  log('console errors', JSON.stringify(errors));
  if (errors.length) { log('FAIL: console errors (6a.3)'); process.exitCode = 1; }
  await browser.close();
}

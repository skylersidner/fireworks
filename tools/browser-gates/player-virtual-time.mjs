// Regular-tier player smoke under Playwright virtual time (testing-strategy.md §2.2, §3 item 15;
// skill .squad/skills/playwright-virtual-time/SKILL.md). Chromium, REAL production CSP (no bypassCSP).
//
// A 10 s show (`short`, the cue-at-duration fixture) plays to its end under a paused clock stepped
// with fastForward(100), then Replay restarts it from 0:00 and it ends again. No console errors.
// Then the frozen-clock negative control, in a fresh context: the clock is installed and paused
// and never advanced after the stage runs; over FROZEN_S real seconds the time readout must not move
// and the show must not end. Without pauseAt (PAUSE=0) that control must FAIL, because install()
// alone keeps real time (P1 trap 1); run it that way to re-verify the control.
//
// Usage: BASE=http://localhost:5180 CODES='{"short":".."}'|SAVE node player-virtual-time.mjs
//   PHASES=ff,frozen (default) | ff | frozen       FROZEN_S=3 (real seconds to watch)
//   MAX_FF=400 (fastForward(100) calls allowed per play: 40 s virtual for a ~14 s show)
//   NEG_HIDE_ENDED=1  control for the ff phase: the ended state never shows, so it must FAIL.
// Exit 0 only if every phase run passes.
import { BASE, launchers, loadCodes } from './lib/common.mjs';

const codes = await loadCodes(['short']);
const PHASES = (process.env.PHASES ?? 'ff,frozen').split(',');
const PAUSE = process.env.PAUSE !== '0';
const FROZEN_S = Number(process.env.FROZEN_S ?? 3);
const MAX_FF = Number(process.env.MAX_FF ?? 400);
const t0 = Date.now();
const log = (...a) => console.log(`[vt ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const T0 = new Date('2026-11-15T12:00:00Z');
const browser = await launchers.chromium();
let ok = true;
const fail = (msg) => { ok = false; log('FAIL', msg); };

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); // real CSP
  // NEG_HIDE_ENDED=1: the ended state is removed as it appears, so the ff phase must FAIL.
  if (process.env.NEG_HIDE_ENDED) await ctx.addInitScript(() => new MutationObserver(() => document.querySelector('[data-testid="player-ended"]')?.remove()).observe(document, { childList: true, subtree: true }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  await page.clock.install({ time: T0 });
  if (PAUSE) await page.clock.pauseAt(new Date(T0.getTime() + 1000));
  const resp = await page.goto(`${BASE}/s/${codes.short}`);
  if (!resp.headers()['content-security-policy']?.includes("script-src 'self'")) fail('no strict CSP header on the player');
  const has = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
  // Count virtual steps, not real seconds (skill rule 6). Each step: one fastForward(100).
  const stepUntil = async (fn, maxSteps) => { for (let i = 0; i < maxSteps; i++) { if (await fn()) return i; await page.clock.fastForward(100); } return (await fn()) ? maxSteps : -1; };
  // DOM clicks: page.click waits on animation frames, which stall while the clock is paused (rule 5).
  const domClick = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
  if ((await stepUntil(() => has('[data-testid="flash-notice"]'), 200)) < 0) throw new Error('no flash notice');
  if (!(await domClick('[data-testid="flash-play"]'))) throw new Error('no flash-play button');
  const running = () => page.evaluate(() => document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running');
  if ((await stepUntil(running, 200)) < 0) throw new Error('stage never reached running');
  return { ctx, page, errors, has, text, stepUntil, domClick };
}

if (PHASES.includes('ff')) {
  const { ctx, page, errors, has, text, stepUntil, domClick } = await open();
  log('renderer', await page.getAttribute('app-fireworks-stage', 'data-renderer'));
  const a = Date.now();
  const n1 = await stepUntil(() => has('[data-testid="player-ended"]'), MAX_FF);
  log('first play', n1 < 0 ? 'DID NOT END' : `ended after ${n1 * 100} ms virtual, ${Date.now() - a} ms real`, 'time', await text('[data-testid="player-time"]'));
  // The 10 s show plus its fade ends after ~14.2 s of virtual time (P1). Ending far sooner would
  // mean the end came from something other than playback.
  if (n1 < 0) fail('the show did not end under virtual time');
  else if (n1 < 100) fail(`ended after only ${n1 * 100} ms of virtual time (expected >= 10 s)`);
  if (!(await domClick('[data-testid="player-ended-replay"]'))) fail('no Replay button on the ended state');
  for (let i = 0; i < 5; i++) await page.clock.fastForward(100);
  const afterReplay = await text('[data-testid="player-time"]');
  const gone = !(await has('[data-testid="player-ended"]'));
  log('after Replay: ended gone', gone, 'time', afterReplay);
  if (!gone) fail('Replay did not clear the ended state');
  if (!/^0:00\b/.test(afterReplay ?? '')) fail(`Replay did not restart from 0:00 (time "${afterReplay}")`);
  const b = Date.now();
  const n2 = await stepUntil(() => has('[data-testid="player-ended"]'), MAX_FF);
  log('replay', n2 < 0 ? 'DID NOT END' : `ended after ${n2 * 100} ms virtual, ${Date.now() - b} ms real`);
  if (n2 < 0) fail('Replay did not play to the end');
  else if (n2 < 90) fail(`Replay ended after only ${n2 * 100} ms of virtual time`);
  if (errors.length) fail(`console errors: ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}

if (PHASES.includes('frozen')) {
  const { ctx, has, text, errors } = await open();
  const r0 = await text('[data-testid="player-time"]');
  await new Promise((r) => setTimeout(r, FROZEN_S * 1000));
  const r1 = await text('[data-testid="player-time"]');
  const ended = await has('[data-testid="player-ended"]');
  const frozen = r0 === r1 && !ended;
  log(`frozen-clock control (pauseAt ${PAUSE ? 'on' : 'OFF'}): time "${r0}" -> after ${FROZEN_S} s real "${r1}", ended ${ended}: ${frozen ? 'frozen' : 'MOVED'}`);
  if (!frozen) fail('the clock moved without fastForward: playback is not under virtual time');
  if (errors.length) fail(`console errors: ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}

await browser.close();
log(ok ? 'PASS' : 'FAIL');
process.exitCode = ok ? 0 : 1;

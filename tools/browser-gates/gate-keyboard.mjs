// Phase 7 gate (Mario): 7g.1 tab-walk, 7g.2 skip link (K8), the p7-spec §3.2 focus fixes K1–K9,
// and 7c.3 (not-found h1 has focus). Toad, Phase 7 C4 follow-up.
// Real header: no bypassCSP, no waitForFunction (polls with page.evaluate, which CSP does not block).
//
// Usage: BASE=http://localhost:5180 [CODES='{"shell":"..","show":".."}' | CODES_FILE=codes.json]
//        [ENGINES=chromium] [NEG=1] node gate-keyboard.mjs
//   ENGINES: chromium by default (Skyler 2026-11-15: regular runs and the gate use one browser);
//            the daily run may pass chromium,firefox,webkit.
//   NEG=focus: control for the focus-recovery checks (kind "focus"). The init script makes
//          HTMLElement.prototype.focus a no-op for the app (every programmatic recovery stops) and
//          mirrors aria-disabled="true" onto native `disabled` (the pre-K5/K9 defect).
//   NEG=walk: control for the tab-walk checks (kind "walk"): a tabindex="1" intruder (order, and
//          7g.2's first Tab), a first stop that removes itself on focus (focus drops to body), every
//          listed §3.1 control pulled out of the Tab order (tabindex=-1), and :focus-visible outlines
//          hidden.
//   Under NEG=<kind>, every check of that kind must FAIL; exit 0 only if none of them passes.
//   Kind "nat" checks need no focus move (K1 below the 4th break, the player's in-place toggles):
//   no init-script control can fail them, so they carry none and are listed as such.
// Exit 0 when every check passes (NEG: when every check fails). Writes keyboard-<engine>.json with
// each page's walk order for the §3.1 comparison.
import { chromium, firefox, webkit } from 'playwright';
import { loadCodes, outPath } from './lib/common.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://localhost:5180';
const NEG = process.env.NEG ?? ''; // '', 'focus' or 'walk'
if (NEG && !['focus', 'walk'].includes(NEG)) throw new Error('NEG must be focus or walk');
const codes = await loadCodes(['shell', 'show']);
if (!codes.shell || !codes.show) throw new Error('CODES must name a saved shell and a saved show');
const engines = {
  chromium: () => chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};
const only = (process.env.ENGINES ?? 'chromium').split(',');

const results = [];
// Every §3.1 control the walks list (NEG=walk pulls these out of the Tab order).
const LISTED = ['nav-show', 'nav-mine', 'launch', 'replay', 'clear', 'add-break', 'json-copy', 'json-apply', 'json-text', 'skip-link', 'nav-designer', 'new-show', 'show-name', 'show-duration', 'play', 'back-to-start', 'scrub', 'zoom-out', 'zoom-fit', 'zoom-in', 'add-cue', 'toolbar-delete', 'undo', 'redo', 'timeline', 'mine-retry', 'mine-more', 'player-remix', 'player-replay', 'card-open', 'card-play', 'card-share', 'card-delete', 'back-to-designer', 'message-home', 'mine-error-retry'];
// kind: 'focus' (programmatic recovery), 'walk' (native Tab), 'nat' (no move needed), 'pre' (setup).
function check(name, pass, detail = '', kind = 'focus') {
  if (kind === true) kind = 'pre';
  if (kind === false) kind = 'focus';
  results.push({ name, pass: !!pass, detail, kind });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
}

async function newCtx(browser, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...extra });
  await ctx.addInitScript(({ neg, listed }) => {
    try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch {}
    // The harness's own focus, kept even under NEG.
    window.__focus = HTMLElement.prototype.focus;
    if (neg === 'focus') {
      HTMLElement.prototype.focus = function () {};
      new MutationObserver((ms) => {
        for (const m of ms) {
          const el = m.target;
          if (el instanceof HTMLButtonElement && m.attributeName === 'aria-disabled') el.disabled = el.getAttribute('aria-disabled') === 'true';
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-disabled'] });
    }
    if (neg === 'walk') {
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '*:focus-visible, *:focus { outline: none !important; }';
        document.head.append(st);
        const intruder = document.createElement('button');
        intruder.textContent = 'toad intruder';
        intruder.tabIndex = 1;
        document.body.append(intruder);
        const dropper = document.createElement('button');
        dropper.textContent = 'toad dropper';
        dropper.addEventListener('focus', () => dropper.remove());
        document.body.prepend(dropper);
      });
      const pull = () => { for (const t of listed) for (const el of document.querySelectorAll(`[data-testid="${t}"]`)) if (el.tabIndex !== -1) el.tabIndex = -1; };
      new MutationObserver(pull).observe(document, { subtree: true, childList: true });
    }
  }, { neg: NEG, listed: LISTED });
  return ctx;
}

// Page-side helpers, installed per evaluate (no string eval anywhere).
const describe = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { body: true, desc: 'body' };
  const t = el.getAttribute('data-testid');
  const label = el.getAttribute('aria-label') || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return {
    body: false,
    desc: `${el.tagName.toLowerCase()}${t ? `[${t}]` : ''}${el.getAttribute('role') ? `{${el.getAttribute('role')}}` : ''} "${label}"`,
    testid: t,
    connected: el.isConnected,
    disabled: !!el.disabled,
    ariaDisabled: el.getAttribute('aria-disabled'),
    busy: el.classList.contains('btn-busy'),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    selected: el.getAttribute('aria-selected'),
  };
};
const active = (page) => page.evaluate(describe);

async function until(page, fn, arg, timeout = 15000, step = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await page.waitForTimeout(step);
  }
}
const present = (page, sel, timeout) => until(page, (s) => !!document.querySelector(s), sel, timeout);
const hfocus = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; window.__focus.call(el); return document.activeElement === el; }, sel);

// 7g.1: derive the focusables from the DOM, then Tab through exactly that many steps from the top.
async function tabWalk(page, label, mustReach) {
  if (NEG === 'walk') {
    // Re-arm per walk: a fresh self-removing first stop and a positive-tabindex intruder.
    await page.evaluate(() => {
      const dropper = document.createElement('button');
      dropper.textContent = 'toad dropper';
      dropper.addEventListener('focus', () => dropper.remove());
      document.body.prepend(dropper);
      if (!document.querySelector('[data-toad-intruder]')) {
        const i = document.createElement('button');
        i.textContent = 'toad intruder';
        i.tabIndex = 1;
        i.setAttribute('data-toad-intruder', '');
        document.body.append(i);
      }
    });
  }
  const dom = await page.evaluate(() => {
    const sel = 'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])';
    const seenRadio = new Set();
    const list = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.tabIndex < 0 || el.disabled || el.closest('[inert]')) continue;
      if (el instanceof HTMLInputElement && el.type === 'hidden') continue;
      const d = el.closest('details');
      if (d && !d.open && !(el.tagName === 'SUMMARY' && el.parentElement === d)) continue;
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
        if (seenRadio.has(el.name)) continue;
        const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
        const pick = group.find((r) => r.checked) ?? group[0];
        seenRadio.add(el.name);
        list.push(pick);
        continue;
      }
      list.push(el);
    }
    window.__walk = list;
    // Start point: a sentinel before everything, so the first Tab goes to the first focusable.
    const s = document.createElement('span');
    s.tabIndex = -1;
    document.body.prepend(s);
    window.__focus.call(s);
    s.addEventListener('blur', () => s.remove(), { once: true });
    return list.map((el) => el.getAttribute('data-testid') || el.tagName.toLowerCase());
  });
  const steps = [];
  let bodySteps = 0, invisible = 0, outOfOrder = 0;
  for (let i = 0; i < dom.length; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate((i) => {
      const el = document.activeElement;
      const cs = el && el !== document.body ? getComputedStyle(el) : null;
      return {
        body: !el || el === document.body,
        idx: window.__walk.indexOf(el),
        want: i,
        id: el?.getAttribute?.('data-testid') || el?.tagName?.toLowerCase(),
        outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : null,
        visible: cs ? cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 : false,
      };
    }, i);
    steps.push(s);
    if (s.body) bodySteps++;
    if (!s.visible) invisible++;
    if (s.idx !== i) outOfOrder++;
  }
  const reached = new Set(steps.map((s) => s.id));
  // A listed control that is natively disabled in this state (Zoom out at Fit, Replay last before a
  // launch) is not expected in the walk; one that is absent from the DOM is a miss.
  const state = await page.evaluate((ids) => Object.fromEntries(ids.map((t) => { const el = document.querySelector(`[data-testid="${t}"]`); return [t, !el ? 'absent' : el.disabled ? 'disabled' : 'enabled']; })), mustReach);
  const missing = mustReach.filter((t) => !reached.has(t) && state[t] !== 'disabled');
  check(`7g.1 ${label}: walk of ${dom.length} never lands on body`, dom.length > 0 && bodySteps === 0, `body steps ${bodySteps}`, 'walk');
  check(`7g.1 ${label}: walk order equals DOM order`, dom.length > 0 && outOfOrder === 0, outOfOrder ? steps.filter((s) => s.idx !== s.want).slice(0, 4).map((s) => `#${s.want}->${s.id}(${s.idx})`).join(' ') : '', 'walk');
  check(`7g.1 ${label}: every step has a visible focus indicator (outline >= 2px)`, dom.length > 0 && invisible === 0, invisible ? steps.filter((s) => !s.visible).slice(0, 4).map((s) => `${s.id}: ${s.outline}`).join('; ') : '', 'walk');
  const skipped = mustReach.filter((t) => state[t] === 'disabled');
  check(`7g.1 ${label}: reaches the §3.1 controls`, missing.length === 0, (missing.length ? `missing ${missing.map((t) => `${t}(${state[t]})`).join(', ')}` : '') + (skipped.length ? ` disabled here: ${skipped.join(', ')}` : ''), 'walk');
  return { label, order: steps.map((s) => s.id) };
}

// Press a key on the focused control, then sample focus: right after and once settled.
async function pressAndSample(page, key, settleMs = 400) {
  await page.keyboard.press(key);
  const now = await active(page);
  await page.waitForTimeout(settleMs);
  const later = await active(page);
  return { now, later };
}
const notBody = (a) => a && !a.body && a.connected !== false && !a.disabled;

async function stageRunning(page) {
  return until(page, () => document.querySelector('app-fireworks-stage')?.getAttribute('data-status') === 'running', null, 30000, 200);
}

// ---------------------------------------------------------------------------------------------
async function designer(browser, walks) {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await present(page, '[data-testid="add-break"]');
  await stageRunning(page);
  walks.push(await tabWalk(page, '/', ['nav-show', 'nav-mine', 'launch', 'replay', 'clear', 'add-break', 'json-copy', 'json-apply', 'json-text']));

  // K1: start from one break.
  for (let i = 0; i < 4; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('[role="tab"]').length);
    if (n <= 1) break;
    await page.click('[data-testid="remove-break"]');
  }
  const n0 = await page.evaluate(() => document.querySelectorAll('[role="tab"]').length);
  await hfocus(page, '[data-testid="add-break"]');
  const k1 = [];
  for (let i = n0; i < 4; i++) {
    const r = await pressAndSample(page, 'Enter');
    k1.push({ to: i + 1, ...r });
  }
  const mid = k1.filter((s) => s.to < 4);
  const last = k1.find((s) => s.to === 4);
  check('K1 / 7g.3: + Add at 1→2 and 2→3 keeps focus on + Add', n0 === 1 && mid.length === 2 && mid.every((s) => s.later.testid === 'add-break'), mid.map((s) => s.later.desc).join(' | '), 'nat');
  check('K1 / 7g.3: + Add at 3→4 moves focus to the newly active tab', !!last && last.later.role === 'tab' && last.later.selected === 'true' && /Break 4/.test(last.later.desc), last ? `${last.now.desc} then ${last.later.desc}` : `started at ${n0}`);

  // K2: Revert → the textarea.
  await page.fill('[data-testid="json-text"]', '{ "toad": "edited" }');
  const rev = await present(page, '[data-testid="json-revert"]', 3000);
  await hfocus(page, '[data-testid="json-revert"]');
  const k2 = await pressAndSample(page, 'Enter');
  check('K2 / 7g.4: Shell JSON Revert moves focus to the textarea', rev && k2.later.testid === 'json-text' && notBody(k2.now), `${k2.now.desc} then ${k2.later.desc}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
async function builderFresh(browser, walks) {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/show');
  await present(page, '[data-testid="skip-link"]');
  await stageRunning(page);
  // 7g.2 / K8: first Tab = the skip link, visible once focused; Enter → Play; no scroll.
  await page.evaluate(() => { const s = document.createElement('span'); s.tabIndex = -1; document.body.prepend(s); window.__focus.call(s); s.addEventListener('blur', () => s.remove(), { once: true }); });
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => {
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    return { testid: el.getAttribute('data-testid'), text: el.textContent.trim(), w: r.width, h: r.height };
  });
  check('7g.2: the first Tab on /show focuses "Skip to the timeline controls", visible', skip.testid === 'skip-link' && skip.text === 'Skip to the timeline controls' && skip.w > 20 && skip.h > 10, JSON.stringify(skip), 'walk');
  const y0 = await page.evaluate(() => [window.scrollY, document.querySelector('[data-testid="builder-panel"]').scrollTop]);
  const k8 = await pressAndSample(page, 'Enter', 300);
  const y1 = await page.evaluate(() => [window.scrollY, document.querySelector('[data-testid="builder-panel"]').scrollTop]);
  check('7g.2: Enter on the skip link focuses Play, without scrolling', (k8.later.testid === 'play' || k8.later.testid === 'back-to-start') && y0[0] === y1[0], `${k8.later.desc}; scrollY ${y0[0]}→${y1[0]}`);

  await page.reload();
  await present(page, '[data-testid="skip-link"]');
  await stageRunning(page);
  const walked = await tabWalk(page, '/show (fresh)', ['skip-link', 'nav-designer', 'new-show', 'show-name', 'show-duration', 'play', 'back-to-start', 'scrub', 'zoom-out', 'zoom-fit', 'zoom-in', 'add-cue', 'toolbar-delete', 'undo', 'redo', 'timeline']);
  walks.push(walked);
  // K5: Delete with the toolbar until nothing is selected; focus stays, aria-disabled, inert.
  // Fresh /show is empty: one Add cue gives the only cue, selected; Delete leaves nothing selected.
  await page.click('[data-testid="add-cue"]');
  await present(page, '[data-testid="inspector-new-seed"]', 3000);
  await hfocus(page, '[data-testid="toolbar-delete"]');
  const k5 = await pressAndSample(page, 'Enter');
  const snap = () => page.evaluate(() => ({
    status: document.querySelector('[data-testid="toolbar-status"]')?.textContent.trim(),
    undo: document.querySelector('[data-testid="undo"]').getAttribute('aria-disabled'),
    redo: document.querySelector('[data-testid="redo"]').getAttribute('aria-disabled'),
    selected: !!document.querySelector('[data-testid="inspector-new-seed"]'),
  }));
  const before = await snap();
  check('K5 / 7g.7: toolbar Delete keeps focus on the button', k5.later.testid === 'toolbar-delete' && notBody(k5.later), `${k5.later.desc} aria-disabled=${k5.later.ariaDisabled} disabled=${k5.later.disabled}`);
  if (!before.selected) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const after = await snap();
    const still = await active(page);
    check('K5 / 7g.7: activating aria-disabled Delete changes nothing, focus stays', k5.later.ariaDisabled === 'true' && still.testid === 'toolbar-delete' && JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} vs ${JSON.stringify(after)}; ${still.desc}`);
  } else {
    check('K5 / 7g.7: activating aria-disabled Delete changes nothing', false, 'a cue is still selected after Delete; state not reached');
  }

  await ctx.close();
}

async function builderFromLink(browser, walks) {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/c/${codes.show}`);
  const redirected = await until(page, () => location.pathname === '/show', null, 20000);
  check('/c/<show> redirects to /show', !!redirected, page.url(), true);
  await present(page, '[data-testid="add-cue"]');
  await stageRunning(page);
  await page.waitForTimeout(500);
  walks.push(await tabWalk(page, '/c/<show> → /show', ['skip-link', 'play', 'scrub', 'add-cue', 'toolbar-delete', 'undo', 'redo', 'timeline']));

  // K3: a button in the inspector has focus; ⌘/Ctrl+Z undoes the Add that selected the cue.
  await page.click('[data-testid="add-cue"]');
  await present(page, '[data-testid="inspector-new-seed"]', 3000);
  await hfocus(page, '[data-testid="inspector-new-seed"]');
  const k3 = await pressAndSample(page, 'ControlOrMeta+z');
  const gone = await page.evaluate(() => !document.querySelector('[data-testid="inspector-new-seed"]'));
  check('K3 / 7g.5: ⌘Z that removes the selected cue moves focus from the inspector to the timeline', gone && k3.later.testid === 'timeline', `${k3.now.desc} then ${k3.later.desc}`);

  // K4: Library Remove (unused shell) and Remove… → Remove shell and cues.
  const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="lib-remove-"]')].map((b) => ({ id: b.getAttribute('data-testid'), text: b.textContent.trim(), shell: b.parentElement.querySelector('button').getAttribute('data-testid') })));
  // Make an unused shell: activate a preset not in the show, add a cue with it, delete that cue.
  const presets = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="lib-preset-"]')].map((b) => b.getAttribute('data-testid')));
  const before4 = await rows();
  for (const p of presets.slice().reverse()) {
    await page.click(`[data-testid="${p}"]`);
    await page.click('[data-testid="add-cue"]');
    await page.waitForTimeout(200);
    if ((await rows()).length > before4.length) break;
    await page.click('[data-testid="toolbar-delete"]').catch(() => {});
  }
  await page.click('[data-testid="toolbar-delete"]');
  await page.waitForTimeout(200);
  let list = await rows();
  const unused = list.findIndex((r) => r.text === 'Remove');
  const expectAfter = (list, i) => (list[i + 1]?.shell ?? list[i - 1]?.shell ?? presets[0]);
  if (unused >= 0) {
    const want = expectAfter(list, unused);
    await hfocus(page, `[data-testid="${list[unused].id}"]`);
    const k4 = await pressAndSample(page, 'Enter');
    check('K4 / 7g.6: Remove (unused shell) moves focus to the next row, else previous, else first preset', k4.later.testid === want, `want ${want}, got ${k4.later.desc}`);
  } else {
    check('K4 / 7g.6: Remove (unused shell) moves focus to the next row, else previous, else first preset', false, `no unused shell row: ${JSON.stringify(list)}`);
  }
  list = await rows();
  const used = list.findIndex((r) => r.text === 'Remove…');
  if (used >= 0) {
    const want = expectAfter(list, used);
    await hfocus(page, `[data-testid="${list[used].id}"]`);
    await page.keyboard.press('Enter');
    const dlg = await present(page, 'dialog[open] [data-testid="confirm-accept"]', 3000);
    const acceptText = dlg ? await page.textContent('dialog[open] [data-testid="confirm-accept"]') : null;
    await hfocus(page, 'dialog[open] [data-testid="confirm-accept"]');
    const k4b = await pressAndSample(page, 'Enter', 500);
    check('K4 / 7g.6: Remove… → Remove shell and cues moves focus to the next row, else previous, else first preset', acceptText?.trim() === 'Remove shell and cues' && k4b.later.testid === want, `accept "${acceptText?.trim()}", want ${want}, got ${k4b.later.desc}`);
  } else {
    check('K4 / 7g.6: Remove… → Remove shell and cues', false, 'no used shell row');
  }
  await ctx.close();
}

// K9 / 7g.9a: My shells Try again and Show more, with the list served by page.route.
function fakeItems(from, n) {
  const A = 'abcdefghijkmnopqrstuvwxyz';
  return Array.from({ length: n }, (_, k) => {
    const i = from + k;
    return { shareCode: `Toadq${A[Math.floor(i / 625) % 25]}${A[Math.floor(i / 25) % 25]}${A[i % 25]}`, kind: 'shell', name: `Toad shell ${i + 1}`, updatedAt: '2026-11-15T00:00:00Z', palette: ['gold'] };
  });
}
async function builderK9(browser, walks) {
  const ctx = await newCtx(browser);
  const plan = [
    { status: 500, delay: 0 },
    { status: 500, delay: 1200 }, // Try again that fails: focus stays on Try again
    { status: 200, delay: 1200, page: 1, items: fakeItems(0, 24), total: 54 }, // Try again that succeeds
    { status: 200, delay: 1200, page: 2, items: fakeItems(24, 24), total: 54 }, // Show more
    { status: 200, delay: 1500, page: 3, items: fakeItems(48, 6), total: 54 }, // Show more, focus moved away meanwhile
  ];
  let served = 0;
  await ctx.route(/\/api\/me\/creations\?.*kind=shell/, async (route) => {
    const p = plan[Math.min(served++, plan.length - 1)];
    if (p.delay) await new Promise((r) => setTimeout(r, p.delay));
    if (p.status !== 200) return route.fulfill({ status: p.status, contentType: 'application/problem+json', body: JSON.stringify({ status: p.status, title: 'toad' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: p.items, page: p.page, pageSize: 24, totalCount: p.total }) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/show');
  const retry = await present(page, '[data-testid="mine-retry"]', 20000);
  if (!retry) { check('K9 / 7g.9a: My shells error shows Try again', false, 'no mine-retry'); await ctx.close(); return; }
  const busyOk = (a) => a.testid && a.ariaDisabled === 'true' && a.busy && !a.disabled;
  await stageRunning(page);
  walks.push(await tabWalk(page, '/show My shells error', ['skip-link', 'mine-retry', 'play', 'timeline']));
  const head = await page.evaluate(() => document.querySelector('[data-testid="mine-heading"]')?.getAttribute('tabindex'));
  check('K9 / 7g.9a: the My shells heading is a focus target (h3 tabindex="-1")', head === '-1', `tabindex ${head}`, 'pre');

  await hfocus(page, '[data-testid="mine-retry"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const f1 = await active(page);
  await until(page, () => !document.querySelector('[data-testid="mine-retry"]')?.classList.contains('btn-busy'), null, 5000);
  await page.waitForTimeout(200);
  const f1b = await active(page);
  check('K9 / 7g.9a: Try again stays rendered, aria-disabled + .btn-busy, with focus while loading', f1.testid === 'mine-retry' && busyOk(f1), f1.desc + ` aria-disabled=${f1.ariaDisabled} busy=${f1.busy}`);
  check('K9 / 7g.9a: a failed Try again leaves focus on Try again', f1b.testid === 'mine-retry' && f1b.ariaDisabled !== 'true', f1b.desc);

  await hfocus(page, '[data-testid="mine-retry"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const f2 = await active(page);
  await present(page, '[data-testid^="lib-mine-Toadq"]', 5000);
  await page.waitForTimeout(300);
  const f2b = await active(page);
  const first = fakeItems(0, 1)[0].shareCode;
  check('K9 / 7g.9a: Try again busy keeps focus (second press)', f2.testid === 'mine-retry' && busyOk(f2), f2.desc);
  check('K9 / 7g.9a: a successful Try again moves focus to the first My shells item', f2b.testid === `lib-mine-${first}`, f2b.desc);

  const more = await present(page, '[data-testid="mine-more"]', 3000);
  walks.push(await tabWalk(page, '/show My shells page 1', ['mine-more', `lib-mine-${first}`]));
  await hfocus(page, '[data-testid="mine-more"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const f3 = await active(page);
  await present(page, `[data-testid="lib-mine-${fakeItems(24, 1)[0].shareCode}"]`, 5000);
  await page.waitForTimeout(300);
  const f3b = await active(page);
  check('K9 / 7g.9a: Show more stays rendered, aria-disabled + .btn-busy, with focus while loading', more && f3.testid === 'mine-more' && busyOk(f3), f3.desc + ` aria-disabled=${f3.ariaDisabled} busy=${f3.busy}`);
  check('K9 / 7g.9a: Show more moves focus to the first newly loaded item', f3b.testid === `lib-mine-${fakeItems(24, 1)[0].shareCode}`, f3b.desc);
  // Bowser's rule (fix round): focus moves only if it's still on the pressed button or dropped to
  // body. The visitor moves on to the scrub during the load; the load must not pull focus back.
  await hfocus(page, '[data-testid="mine-more"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await hfocus(page, '[data-testid="scrub"]');
  await present(page, `[data-testid="lib-mine-${fakeItems(48, 1)[0].shareCode}"]`, 5000);
  await page.waitForTimeout(400);
  const f4 = await active(page);
  check('K9 / 7g.9a: a load that settles after the visitor moved on leaves focus where they put it', f4.testid === 'scrub', f4.desc, 'nat');
  check('K9 / 7g.9a: served the planned list requests', served === 5, `served ${served}`, true);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
async function player(browser, walks) {
  for (const [kind, code] of [['shell', codes.shell], ['show', codes.show]]) {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/s/${code}`);
    await present(page, '[data-testid="player-remix"]', 20000);
    await stageRunning(page);
    await page.waitForTimeout(500);
    walks.push(await tabWalk(page, `/s/<${kind}>`, ['player-remix', 'player-replay']));
    // Each player control's own press never drops focus (the spec's pass; re-proven here).
    for (const t of ['player-pause', 'player-center-play', 'player-replay']) {
      if (!(await page.$(`[data-testid="${t}"]`))) continue;
      await hfocus(page, `[data-testid="${t}"]`);
      const r = await pressAndSample(page, 'Enter');
      check(`player /s/<${kind}>: Enter on ${t} never drops focus`, notBody(r.now) && notBody(r.later), `${r.now.desc} then ${r.later.desc}`, 'nat');
    }
    await ctx.close();
  }
}

async function mine(browser, walks) {
  // Walk, then K7 (toast ×) with two Share toasts.
  const ctx = await newCtx(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  await page.goto(BASE + '/mine');
  const card = await present(page, '[data-testid="mine-card"]', 20000);
  check('/mine has at least one card (writes on)', !!card, '', true);
  walks.push(await tabWalk(page, '/mine', ['nav-designer', 'nav-show', 'card-open', 'card-play', 'card-share', 'card-delete']));
  await page.click('[data-testid="card-share"]');
  await page.click('[data-testid="card-share"]');
  const two = await until(page, () => document.querySelectorAll('[data-testid="toast-dismiss"]').length >= 2, null, 3000);
  await hfocus(page, '[data-testid="toast-dismiss"]');
  const k7a = await pressAndSample(page, 'Enter', 150);
  const k7b = await pressAndSample(page, 'Enter', 150);
  check('K7 / 7g.9: toast × moves focus to the next toast ×', two && k7a.later.testid === 'toast-dismiss', k7a.later.desc);
  check('K7 / 7g.9: the last toast × moves focus to the page h1', k7b.later.testid === 'mine-heading', k7b.later.desc);
  // A focused toast timing out (success toasts last 4 s) moves focus the same way.
  await page.click('[data-testid="card-share"]');
  await present(page, '[data-testid="toast-dismiss"]', 3000);
  await hfocus(page, '[data-testid="toast-dismiss"]');
  await until(page, () => !document.querySelector('[data-testid="toast-dismiss"]'), null, 9000);
  await page.waitForTimeout(200);
  const k7c = await active(page);
  check('K7 / 7g.9: a focused toast timing out moves focus to the page h1', k7c.testid === 'mine-heading', k7c.desc);
  await ctx.close();

  // K6: list error → Try again → the h1.
  const ctx2 = await newCtx(browser);
  let calls = 0;
  await ctx2.route(/\/api\/me\/creations(\?|$)/, async (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"status":500}' });
    await new Promise((r) => setTimeout(r, 800));
    return route.continue();
  });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/mine');
  const err = await present(p2, '[data-testid="mine-error-retry"]', 20000);
  await hfocus(p2, '[data-testid="mine-error-retry"]');
  const k6 = await pressAndSample(p2, 'Enter', 1500);
  check('K6 / 7g.8: /mine list-error Try again moves focus to the h1', err && notBody(k6.now) && k6.later.testid === 'mine-heading', `${k6.now.desc} then ${k6.later.desc}`);
  await ctx2.close();
}

async function statusAndNotFound(browser, walks) {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  const apiHits = [];
  page.on('request', (r) => { if (/\/api\/creations/.test(r.url())) apiHits.push(r.url()); });
  await page.goto(BASE + '/status');
  await present(page, '[data-testid="back-to-designer"]');
  walks.push(await tabWalk(page, '/status', ['back-to-designer']));

  // 7c.3: dotted last segments render the not-found page, its h1 focused, no api/creations call.
  for (const p of ['/s/a.b', '/s/..%2Fme', '/c/..%2Fme']) {
    apiHits.length = 0;
    await page.goto(BASE + p);
    const h = await until(page, () => document.activeElement?.getAttribute('data-testid') === 'message-heading' ? document.activeElement.textContent.trim() : null, null, 10000);
    await page.waitForTimeout(300);
    check(`7c.3 ${p}: the not-found h1 has focus, no api/creations request`, !!h && apiHits.length === 0, `h1 "${h}", api hits ${apiHits.length}`);
  }
  // Both not-found surfaces: the player's (bad code) and the copy surface's.
  for (const p of ['/s/abcdefgl', '/c/abcdefgl']) {
    await page.goto(BASE + p);
    const h = await until(page, () => { const a = document.activeElement; return a?.tagName === 'H1' ? a.textContent.trim() : null; }, null, 15000);
    check(`7c.3 ${p}: the page h1 has focus`, !!h, `h1 "${h}"`);
    walks.push(await tabWalk(page, `${p} (not found)`, ['message-home']));
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
let launchFail = 0;
for (const name of only) {
  let browser;
  try { browser = await engines[name](); } catch (e) { console.log(name, 'LAUNCH FAIL', e.message.split('\n')[0]); launchFail++; continue; }
  console.log(`== ${name} ${NEG ? '(NEG)' : ''} ${BASE}`);
  const walks = [];
  const sections = process.env.SECTIONS?.split(','); // e.g. SECTIONS=builderFresh,builderK9 (dev only; the gate runs all)
  for (const fn of [designer, builderFresh, builderFromLink, builderK9, player, mine, statusAndNotFound].filter((f) => !sections || sections.includes(f.name))) {
    try { await fn(browser, walks); } catch (e) { check(`${fn.name} ran`, false, e.message.split('\n')[0]); }
  }
  fs.writeFileSync(outPath(`keyboard-${name}${NEG ? '-neg' : ''}.json`), JSON.stringify(walks, null, 1));
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
const nat = results.filter((r) => r.kind === 'nat').map((r) => r.name);
if (NEG) {
  const target = results.filter((r) => r.kind === NEG);
  const survivors = target.filter((r) => r.pass);
  const preBad = results.filter((r) => r.kind === 'pre' && !r.pass);
  console.log(`NEG=${NEG}: ${target.length - survivors.length}/${target.length} ${NEG} checks failed as they should; survivors: ${survivors.map((r) => r.name).join(' | ') || 'none'}; preconditions failed: ${preBad.length}`);
  process.exitCode = target.length > 0 && survivors.length === 0 && preBad.length === 0 && !launchFail ? 0 : 1;
} else {
  console.log(`${failed === 0 && !launchFail ? 'PASS' : 'FAIL'}: ${passed}/${results.length} checks passed (${nat.length} "nat" checks carry no control: ${nat.join(' | ')})`);
  process.exitCode = failed === 0 && !launchFail ? 0 : 1;
}

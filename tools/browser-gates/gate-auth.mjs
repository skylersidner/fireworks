// Phase 8 B3 browser gates for sign-in (Toad; boo-phase8-security-verification.md F1 and F3, plus
// the two-account ownership walk). Chromium (Chrome channel), real CSP, the real redirect flow
// through the API's tools/fake-oauth stub. The server must be Testing (or Development) with the
// stub configured: `tools/test/run.mjs` starts one; or BASE=http://127.0.0.1:<port>.
//
//   BASE=… [PARTS=csrf,csp,walk,save,signout] [NEG=csrf|csp|walk|save|signout] node gate-auth.mjs
//
// Parts (each prints PASS or FAIL lines; exit 1 if any check failed):
//   csrf  Boo A13/F1. A victim signs in and saves one shell. Attacker pages come from a real
//         loopback server on http://127.0.0.1:<port> (same-site, cross-origin: ports don't make a
//         site) and http://localhost:<port> (cross-site); Boo's dev rig used :5190. Each tries a
//         no-cors POST to api/creations, a credentialed cross-origin DELETE of the victim's row and
//         a form POST to api/auth/logout. The POST and the form must reach the server and get 403,
//         the DELETE must be blocked by the browser (preflight) or get 403, the Sec-Fetch-Site seen
//         over CDP must be what the case claims, and afterwards the victim is still signed in, the
//         list is byte-identical and the row is there.
//   csp   Boo A6/F3. A fresh profile on /signin?returnUrl=/mine presses the Google button and
//         follows login -> stub authorize -> callback -> /mine under the enforced CSP, with a
//         securitypolicyviolation listener in every document and "Refused" console lines
//         collected. Zero of either, a CSP header with script-src on both documents, and a signed-in
//         /mine at the end.
//   walk  Two accounts through the browser (walk-alice, walk-bob, signed in by the real redirect
//         flow): alice saves from the designer's Save button; on /c/<code> alice is offered
//         Update original and bob only Save; bob's PUT and DELETE of alice's code get 404; bob's
//         /mine lacks the card and alice's has it; alice's row is unchanged. Then the reverse
//         (alice can't PUT or DELETE bob's).
//   save  Mario's G1, the anonymous Save path, in a fresh profile: Save signed out opens the dialog
//         (focus on the Google button, no write); sign-in through the stub (POST /__next-subject)
//         returns with the draft byte-identical, the "Signed in as" toast, focus on Save and no
//         write; Save then gets 201. The flashing notice is dismissed first (it rightly wins focus).
//   signout  G2: on /show, signed in, fireworks.draft.v1 and fireworks.showDraft.v1 are
//         byte-identical across Sign out, and the only write is the logout 204.
// Negative controls (each must exit 1 and print its catch; the daily tier runs them):
//   NEG=csrf  the same three requests from a real app document (/status, same-origin): the guard
//             (rightly) lets them through, so the detectors must see the write and the sign-out ("CSRF LANDED").
//   NEG=csp   an inline <script> is added to /mine after the redirect chain: the listener must
//             report a script-src violation on the landing page ("CSP VIOLATION").
//   NEG=walk  "bob" signs in as walk-alice: the ownership checks must fail ("OWNERSHIP NOT ENFORCED").
//   NEG=save  the return document's draft is rewritten and a POST sent before the app boots: the
//             byte check and the write ledger must both catch it ("SAVE PATH BROKEN").
//   NEG=signout  the show draft is rewritten as the logout answers ("DRAFT CHANGED ON SIGN OUT").
import http from 'node:http';
import { BASE, fixtureDoc, launchers } from './lib/common.mjs';

const PARTS = (process.env.PARTS ?? 'csrf,csp,walk,save,signout').split(',');
const NEG = process.env.NEG ?? '';
const failures = [];
const check = (part, ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${part}: ${what}${detail ? ` ${detail}` : ''}`);
  if (!ok) failures.push(`${part}: ${what}`);
  return ok;
};

// The stub's origin, from one login redirect (the API builds the authorize URL).
let stubBase = process.env.STUB_BASE ?? null;
async function stub() {
  if (stubBase) return stubBase;
  const r = await fetch(`${BASE}/api/auth/login/google?returnUrl=%2F`, { redirect: 'manual' });
  if (r.status !== 302) throw new Error(`login: HTTP ${r.status} (is ${BASE} Testing with the stub?)`);
  return (stubBase = new URL(r.headers.get('location')).origin);
}
/** Queues `subject` at the stub, then signs `context` in through the browser's redirect flow. */
async function signInAs(context, subject) {
  const q = await fetch(`${await stub()}/__next-subject?sub=${encodeURIComponent(subject)}`, { method: 'POST' });
  if (q.status !== 200) throw new Error(`stub /__next-subject: HTTP ${q.status} (an older stub?)`);
  const page = await context.newPage();
  await page.goto(`${BASE}/api/auth/login/google?returnUrl=${encodeURIComponent('/favicon.svg')}`);
  const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
  if (!me.isAuthenticated || me.displayName !== `Stub ${subject}`) throw new Error(`sign-in as ${subject} gave ${JSON.stringify(me)}`);
  return page; // left on /favicon.svg: a same-origin document for in-page fetches
}
const inPage = (page, fn, arg) => page.evaluate(fn, arg);
const api = (page, method, url, { body, headers } = {}) =>
  inPage(page, async ({ method, url, body, headers }) => {
    const r = await fetch(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, etag: r.headers.get('etag'), text, json };
  }, { method, url, body, headers });

const browser = await launchers.chromium();
try {
  // ---- csrf ---------------------------------------------------------------------------------
  if (PARTS.includes('csrf')) {
    const ctx = await browser.newContext();
    const home = await signInAs(ctx, 'csrf-victim');
    const made = await api(home, 'POST', '/api/creations', { body: { kind: 'shell', document: fixtureDoc('shellA') } });
    if (made.status !== 201) throw new Error(`csrf setup save: HTTP ${made.status} ${made.text.slice(0, 200)}`);
    const code = made.json.shareCode;
    const listBefore = (await api(home, 'GET', '/api/me/creations')).text;
    // The attacker pages come from a real loopback server, not route.fulfill: Chrome's Local
    // Network Access treats a fulfilled page as public and blocks its fetches to 127.0.0.1 before
    // they reach the server (LocalNetworkAccessPermissionDenied, measured 2026-11-16), which would
    // hide a guard regression. Ports don't make a site, so 127.0.0.1:<other> is same-site.
    const atkServer = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><title>attack</title><form id="f" method="post" action="${BASE}/api/auth/logout"></form>`); });
    await new Promise((r) => atkServer.listen(0, '127.0.0.1', r));
    const ap = atkServer.address().port;
    const cases = NEG === 'csrf'
      // The control: the same three requests from a real app document (same-origin; form-action 'self').
      ? [{ name: 'same-origin (NEG)', url: `${BASE}/status`, site: 'same-origin' }]
      : [{ name: 'same-site', url: `http://127.0.0.1:${ap}/attack`, site: 'same-site' }, { name: 'cross-site', url: `http://localhost:${ap}/attack`, site: 'cross-site' }];
    const landed = [];
    for (const c of cases) {
      const atk = await ctx.newPage();
      // CDP, because Playwright's allHeaders() omits Sec-Fetch-* and a CORP- or CORS-blocked
      // response never reaches Playwright's response event; the ExtraInfo events carry both.
      const cdp = await ctx.newCDPSession(atk);
      await cdp.send('Network.enable');
      const ev = new Map();
      const by = (id) => { if (!ev.has(id)) ev.set(id, {}); return ev.get(id); };
      cdp.on('Network.requestWillBeSent', (e) => { if (e.request.url.startsWith(BASE + '/api/')) Object.assign(by(e.requestId), { m: e.request.method, p: new URL(e.request.url).pathname }); });
      cdp.on('Network.requestWillBeSentExtraInfo', (e) => { const h = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k.toLowerCase(), v])); Object.assign(by(e.requestId), { site: h['sec-fetch-site'] ?? null }); });
      cdp.on('Network.responseReceivedExtraInfo', (e) => { by(e.requestId).s = e.statusCode; });
      cdp.on('Network.loadingFailed', (e) => { by(e.requestId).failed = [e.errorText, e.blockedReason, e.corsErrorStatus?.corsError].filter(Boolean).join(' '); });
      await atk.goto(c.url);
      if (NEG === 'csrf') await inPage(atk, (base) => { const f = document.createElement('form'); f.id = 'f'; f.method = 'post'; f.action = `${base}/api/auth/logout`; document.body.append(f); }, BASE);
      const doc = JSON.stringify({ kind: 'shell', document: fixtureDoc('shellB') });
      const post = await inPage(atk, ({ base, doc }) => fetch(`${base}/api/creations`, { method: 'POST', mode: 'no-cors', credentials: 'include', body: new Blob([doc], { type: 'text/plain' }) }).then((r) => `resolved ${r.type} ${r.status}`, (e) => `rejected ${e.name}`), { base: BASE, doc });
      const del = await inPage(atk, ({ base, code }) => fetch(`${base}/api/creations/${code}`, { method: 'DELETE', mode: 'cors', credentials: 'include' }).then((r) => `resolved ${r.type} ${r.status}`, (e) => `rejected ${e.name}`), { base: BASE, code });
      await inPage(atk, () => document.getElementById('f').submit());
      await atk.waitForTimeout(1500);
      await atk.close();
      const rows = [...ev.values()].filter((x) => x.m);
      const fmt = (x) => `${x.m} ${x.p} ${x.s ?? '-'}${x.site ? ` [${x.site}]` : ''}${x.failed ? ` (${x.failed})` : ''}`;
      console.log(`  ${c.name} from ${new URL(c.url).origin}: no-cors POST ${post}; DELETE ${del}; requests ${JSON.stringify(rows.map(fmt))}`);
      const unsafe = rows.filter((x) => x.m !== 'OPTIONS');
      const reached = unsafe.filter((x) => x.s !== undefined);
      const of = (m, p) => unsafe.find((x) => x.m === m && x.p === p);
      const create = of('POST', '/api/creations'), logout = of('POST', '/api/auth/logout'), deletion = of('DELETE', `/api/creations/${code}`);
      check('csrf', create?.s === 403, `${c.name}: the no-cors POST reached the server and got 403`, `(${create ? fmt(create) : 'not sent'})`);
      check('csrf', !deletion || deletion.s === undefined || deletion.s === 403, `${c.name}: the cross-origin DELETE was blocked by the browser or got 403`, `(${deletion ? fmt(deletion) : 'never sent'})`);
      check('csrf', logout?.s === 403, `${c.name}: the form POST to logout reached the server and got 403`, `(${logout ? fmt(logout) : 'not sent'})`);
      check('csrf', reached.length > 0 && reached.every((x) => x.site === c.site), `${c.name}: every request that reached the server carried Sec-Fetch-Site ${c.site}`, JSON.stringify([...new Set(reached.map((x) => x.site))]));
      check('csrf', rows.every((x) => !/LocalNetworkAccess/.test(x.failed ?? '')), `${c.name}: nothing was blocked by Local Network Access (it would hide the guard)`);
      if (reached.some((x) => x.s !== 403)) landed.push(`${c.name} got ${reached.filter((x) => x.s !== 403).map((x) => `${x.m} ${x.s}`).join(', ')}`);
    }
    atkServer.close();
    const me = await inPage(home, () => fetch('/api/me').then((r) => r.json()));
    const listAfter = (await api(home, 'GET', '/api/me/creations')).text;
    const row = await api(home, 'GET', `/api/creations/${code}`);
    const kept = check('csrf', me.isAuthenticated === true, 'the victim is still signed in');
    const same = check('csrf', listAfter === listBefore, 'the victim list is byte-identical');
    const there = check('csrf', row.status === 200, 'the victim row is still there', `(GET ${row.status})`);
    if (!kept || !same || !there || landed.length) console.log(`CSRF LANDED: ${[!kept && 'signed out', !same && 'list changed', !there && 'row deleted', ...landed].filter(Boolean).join(', ')}`);
    await ctx.close();
  }

  // ---- csp ----------------------------------------------------------------------------------
  if (PARTS.includes('csp')) {
    const ctx = await browser.newContext();
    const violations = [];
    await ctx.exposeBinding('__toadCsp', (_src, v) => violations.push(v));
    await ctx.addInitScript((neg) => {
      document.addEventListener('securitypolicyviolation', (e) => window.__toadCsp(`${location.origin}${location.pathname} ${e.effectiveDirective} ${e.blockedURI || '(inline)'}`));
      if (neg && location.pathname === '/mine') {
        // NEG=csp: an inline script on the landing page, after the whole redirect chain.
        addEventListener('DOMContentLoaded', () => { const s = document.createElement('script'); s.textContent = 'window.__toadNeg = 1'; document.head.append(s); });
      }
    }, NEG === 'csp');
    const page = await ctx.newPage();
    page.on('console', (m) => { if (/Refused|Content Security Policy/i.test(m.text())) violations.push(`console ${m.text().slice(0, 160)}`); });
    const navs = [];
    const docCsp = {};
    page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navs.push(r.url()); });
    page.on('response', (r) => { if (r.request().isNavigationRequest() && r.url().startsWith(BASE) && r.status() === 200) docCsp[new URL(r.url()).pathname] = r.headers()['content-security-policy'] ?? null; });
    await fetch(`${await stub()}/__next-subject?sub=csp-user`, { method: 'POST' });
    await page.goto(`${BASE}/signin?returnUrl=%2Fmine`);
    await page.getByRole('button', { name: /google/i }).first().click();
    await page.waitForURL(`${BASE}/mine`, { timeout: 15000 });
    await page.locator('[data-testid="mine-heading"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500); // late violations (lazy chunks, fonts) still arrive
    const me = await inPage(page, () => fetch('/api/me').then((r) => r.json()));
    const chain = navs.map((u) => { const x = new URL(u); return `${x.origin === BASE ? '' : x.origin}${x.pathname}`; });
    console.log(`  navigations ${JSON.stringify(chain)}`);
    const st = await stub();
    check('csp', chain[0] === '/signin' && chain.includes('/api/auth/login/google') && chain.includes(`${st}/authorize`) && chain.at(-1) === '/mine', 'the real redirect flow ran: /signin, login, stub authorize, callback, /mine');
    check('csp', ['/signin', '/mine'].every((p) => /script-src/.test(docCsp[p] ?? '')), 'both documents carried a CSP with script-src', JSON.stringify(Object.fromEntries(Object.entries(docCsp).map(([k, v]) => [k, v?.slice(0, 40) ?? null]))));
    check('csp', me.isAuthenticated === true && me.displayName === 'Stub csp-user', 'signed in on /mine as csp-user');
    if (!check('csp', violations.length === 0, 'zero CSP violations across sign-in', JSON.stringify(violations))) console.log(`CSP VIOLATION: ${violations.join(' | ')}`);
    await ctx.close();
  }

  // ---- walk ---------------------------------------------------------------------------------
  if (PARTS.includes('walk')) {
    const actx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const aHome = await signInAs(actx, 'walk-alice');
    const bHome = await signInAs(bctx, NEG === 'walk' ? 'walk-alice' : 'walk-bob');
    const bad = [];
    const own = (ok, what, detail) => { if (!check('walk', ok, what, detail)) bad.push(what); };
    // alice saves from the designer's Save button.
    const a = await actx.newPage();
    await a.addInitScript(() => { try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch { /* none */ } });
    await a.goto(`${BASE}/`);
    await a.waitForSelector('[data-testid="save-save"]:not([disabled])', { timeout: 60000 });
    const saved = a.waitForResponse((r) => r.url() === `${BASE}/api/creations` && r.request().method() === 'POST', { timeout: 30000 });
    await a.click('[data-testid="save-save"]');
    const sr = await saved;
    const codeA = (await sr.json()).shareCode;
    own(sr.status() === 201 && !!codeA, 'alice saved from the designer', `(${sr.status()} ${codeA})`);
    const rowA = await api(aHome, 'GET', `/api/creations/${codeA}`);
    // Save choices on the working copy: the owner gets Update original, the other account only Save.
    const choices = async (page) => {
      await page.goto(`${BASE}/c/${codeA}`);
      await page.waitForURL(`${BASE}/`, { timeout: 30000 });
      await page.waitForSelector('[data-testid="save-bar"] [data-testid="share"]', { timeout: 30000 });
      return page.$$eval('[data-testid="save-bar"] button[data-testid^="save-"]', (bs) => bs.map((b) => b.dataset.testid).sort());
    };
    const aChoices = await choices(a);
    const b = await bctx.newPage();
    await b.addInitScript(() => { try { localStorage.setItem('fireworks.flashNotice.v1', '1'); } catch { /* none */ } });
    const bChoices = await choices(b);
    check('walk', aChoices.includes('save-update'), 'alice is offered Update original on her code', JSON.stringify(aChoices));
    own(!bChoices.includes('save-update') && bChoices.includes('save-save'), 'bob is offered only Save on alice\'s code', JSON.stringify(bChoices));
    // bob's writes to alice's code.
    const bGet = await api(bHome, 'GET', `/api/creations/${codeA}`);
    own(bGet.status === 200 && bGet.json?.isOwner === false, 'bob reads alice\'s code as not his', `(${bGet.status} isOwner ${bGet.json?.isOwner})`);
    const bPut = await api(bHome, 'PUT', `/api/creations/${codeA}`, { body: { document: rowA.json.document }, headers: { 'if-match': bGet.etag ?? '"x"' } });
    own(bPut.status === 404, 'bob\'s PUT of alice\'s code is 404', `(${bPut.status})`);
    const bDel = await api(bHome, 'DELETE', `/api/creations/${codeA}`);
    own(bDel.status === 404, 'bob\'s DELETE of alice\'s code is 404', `(${bDel.status})`);
    // /mine through the page.
    const mineCodes = async (page) => {
      await page.goto(`${BASE}/mine`);
      await page.waitForSelector('[data-testid="mine-grid"], [data-testid="mine-empty"]', { timeout: 30000 });
      return page.$$eval('[data-testid="mine-card"] a[href]', (as) => [...new Set(as.map((x) => x.getAttribute('href')))]);
    };
    const bMine = await mineCodes(b);
    own(!bMine.some((h) => h.includes(codeA)), 'bob\'s My creations lacks alice\'s card', JSON.stringify(bMine));
    const aMine = await mineCodes(a);
    check('walk', aMine.some((h) => h.includes(codeA)), 'alice\'s My creations has her card', JSON.stringify(aMine));
    const rowA2 = await api(aHome, 'GET', `/api/creations/${codeA}`);
    own(rowA2.status === 200 && rowA2.json?.updatedAt === rowA.json?.updatedAt && rowA2.json?.name === rowA.json?.name, 'alice\'s row is unchanged', `(${rowA2.status})`);
    // The reverse: alice can't edit bob's.
    const madeB = await api(bHome, 'POST', '/api/creations', { body: { kind: 'shell', document: fixtureDoc('shellB') } });
    const codeB = madeB.json?.shareCode;
    const aGetB = await api(aHome, 'GET', `/api/creations/${codeB}`);
    const aPut = await api(aHome, 'PUT', `/api/creations/${codeB}`, { body: { document: fixtureDoc('shellB') }, headers: { 'if-match': aGetB.etag ?? '"x"' } });
    const aDel = await api(aHome, 'DELETE', `/api/creations/${codeB}`);
    own(madeB.status === 201 && aPut.status === 404 && aDel.status === 404, 'alice\'s PUT and DELETE of bob\'s code are 404', `(save ${madeB.status}, PUT ${aPut.status}, DELETE ${aDel.status})`);
    if (bad.length) console.log(`OWNERSHIP NOT ENFORCED: ${bad.join('; ')}`);
    await actx.close();
    await bctx.close();
  }

  // ---- save (G1) and signout (G2) -----------------------------------------------------------
  // One fresh profile: the full anonymous Save path, then (signed in) Sign out keeps both drafts.
  if (PARTS.includes('save') || PARTS.includes('signout')) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const origin = new URL(BASE).origin;
    // Every non-GET request the page sends to the app (navigations included): the write ledger.
    const writes = [];
    page.on('request', (r) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && r.url().startsWith(origin)) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    const raw = (key) => page.evaluate((k) => localStorage.getItem(k), key);
    const focusId = () => page.evaluate(() => { const a = document.activeElement; return a?.dataset?.testid ?? a?.tagName ?? null; });
    // Every toast the page ever shows (a success toast lives 4 s, so "still visible" is a race).
    const seen = [];
    await ctx.exposeBinding('__toadToast', (_src, t) => { seen.push(t); });
    await ctx.addInitScript(() => {
      const got = new Set();
      new MutationObserver(() => {
        for (const s of document.querySelectorAll('aside[aria-label="Notifications"] span')) {
          const t = s.textContent.trim();
          if (t && !got.has(t)) { got.add(t); window.__toadToast(t); }
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const toasts = () => [...seen];
    const draftHas = (key, text) => page.waitForFunction(([k, t]) => (localStorage.getItem(k) ?? '').includes(t), [key, text], { timeout: 15000 });
    if (NEG === 'save') {
      // NEG=save: on the return document (the sign-in marker is set), the draft is rewritten and a
      // write is sent before the app boots: the byte check and the write ledger must both catch it.
      await ctx.addInitScript((base) => {
        if (location.pathname !== '/' || !sessionStorage.getItem('fireworks.signin.v1')) return;
        const d = localStorage.getItem('fireworks.draft.v1');
        if (d) localStorage.setItem('fireworks.draft.v1', d.replace('G1 marker', 'G1 mutant'));
        fetch(`${base}/api/creations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
      }, BASE);
    }
    const SUBJECT = 'g1-saver';
    const marker = `G1 marker ${Date.now()}`;
    await page.goto(`${BASE}/`);
    // The flashing notice wins focus on a fresh profile (rightly); dismiss it as a visitor would.
    const flash = page.locator('[data-testid="flash-continue"]');
    await flash.waitFor({ timeout: 30000 });
    await flash.click();
    await page.waitForFunction(() => localStorage.getItem('fireworks.flashNotice.v1') !== null, null, { timeout: 5000 });
    const name = page.locator('[data-testid="designer-panel"] input[type="text"]').first();
    await name.fill(marker);
    await draftHas('fireworks.draft.v1', marker);
    if (PARTS.includes('save')) {
      const P = 'save';
      const bad = [];
      const g = (ok, what, detail) => { if (!check(P, ok, what, detail)) bad.push(what); };
      const me0 = await inPage(page, () => fetch('/api/me').then((r) => r.json()));
      check(P, me0.isAuthenticated === false, 'signed out at the start');
      await page.click('[data-testid="save-save"]');
      await page.locator('[data-testid="sign-in-dialog"]').waitFor({ timeout: 5000 });
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'google-sign-in', null, { timeout: 3000 }).catch(() => undefined);
      check(P, (await focusId()) === 'google-sign-in', 'Save signed out opens the dialog with focus on the Google button', String(await focusId()));
      g(writes.length === 0, 'pressing Save signed out wrote nothing', JSON.stringify(writes));
      const draftBefore = await raw('fireworks.draft.v1');
      const q = await fetch(`${await stub()}/__next-subject?sub=${SUBJECT}`, { method: 'POST' });
      if (q.status !== 200) throw new Error(`stub /__next-subject: HTTP ${q.status} (an older stub?)`);
      await page.click('[data-testid="google-sign-in"]');
      await page.locator('[data-testid="account-name"]').waitFor({ timeout: 30000 });
      const toast = `Signed in as Stub ${SUBJECT}.`;
      for (let i = 0; i < 50 && !seen.includes(toast); i++) await page.waitForTimeout(100);
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'save-save', null, { timeout: 3000 }).catch(() => undefined);
      const draftAfter = await raw('fireworks.draft.v1');
      g(!!draftBefore && draftBefore.includes(marker) && draftAfter === draftBefore, 'the draft is byte-identical after the sign-in round trip', `(${draftBefore?.length} -> ${draftAfter?.length} bytes)`);
      g((await name.inputValue()) === marker, 'the designer renders the same draft (name field)', await name.inputValue());
      check(P, toasts().includes(toast), `the toast "${toast}" shows`, JSON.stringify(toasts()));
      check(P, (await focusId()) === 'save-save', 'focus is on Save on return', String(await focusId()));
      g(writes.length === 0, 'nothing was written on return', JSON.stringify(writes));
      check(P, (await inPage(page, () => sessionStorage.getItem('fireworks.signin.v1'))) === null, 'the sign-in marker was deleted on load');
      const [resp] = await Promise.all([page.waitForResponse((r) => r.url() === `${BASE}/api/creations` && r.request().method() === 'POST', { timeout: 15000 }), page.click('[data-testid="save-save"]')]);
      check(P, resp.status() === 201, 'Save is POST api/creations 201', `(${resp.status()})`);
      if (bad.length) console.log(`SAVE PATH BROKEN: ${bad.join('; ')}`);
    } else {
      await signInAs(ctx, SUBJECT).then((p) => p.close());
      await page.reload();
      await page.locator('[data-testid="account-name"]').waitFor({ timeout: 30000 });
    }
    if (PARTS.includes('signout')) {
      const P = 'signout';
      await page.goto(`${BASE}/show`);
      const showName = `G2 show ${Date.now()}`;
      await page.locator('[data-testid="show-name"]').fill(showName);
      await draftHas('fireworks.showDraft.v1', showName);
      const keys = ['fireworks.draft.v1', 'fireworks.showDraft.v1'];
      const before = await Promise.all(keys.map(raw));
      check(P, before.every((v) => v), 'both drafts are present before Sign out', `(${before.map((v) => v?.length)} bytes)`);
      if (NEG === 'signout') {
        // NEG=signout: the show draft is rewritten as the logout answers (as a buggy "clear on
        // sign-out" would): the byte check must catch it.
        page.on('response', (r) => { if (r.url().endsWith('/api/auth/logout')) page.evaluate(() => localStorage.setItem('fireworks.showDraft.v1', '{}')).catch(() => undefined); });
      }
      const w0 = writes.length;
      const [lo] = await Promise.all([page.waitForResponse((r) => r.url() === `${BASE}/api/auth/logout`, { timeout: 15000 }), page.click('[data-testid="account-sign-out"]')]);
      await page.locator('[data-testid="account-sign-in"]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(500); // a late draft write would land here
      const after = await Promise.all(keys.map(raw));
      const changed = keys.filter((k, i) => after[i] !== before[i]);
      check(P, lo.status() === 204, 'logout is 204', `(${lo.status()})`);
      check(P, JSON.stringify(writes.slice(w0)) === '["POST /api/auth/logout"]', 'the only write is the logout', JSON.stringify(writes.slice(w0)));
      if (!check(P, changed.length === 0, `${keys.join(' and ')} are byte-identical across Sign out`, JSON.stringify(changed))) console.log(`DRAFT CHANGED ON SIGN OUT: ${changed.join(', ')}`);
    }
    await ctx.close();
  }
} catch (e) {
  failures.push(`crash: ${e.message}`);
  console.log(`FAIL crash: ${e.stack ?? e.message}`);
} finally {
  await browser.close();
}
console.log(`gate-auth${NEG ? ` NEG=${NEG}` : ''}: ${failures.length ? `FAIL (${failures.length}): ${failures.join(' | ')}` : `PASS (${PARTS.join(', ')})`}`);
process.exitCode = failures.length ? 1 : 0;

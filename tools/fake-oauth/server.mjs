#!/usr/bin/env node
// A Google-shaped stub OAuth server for local dev and the Playwright smoke (Phase 8; Boo A7).
// Same contract as the C# stub (src/api/Fireworks.Api.Tests/Support/StubOAuthProvider.cs). Node
// only, no dependencies. Written by Bowser in B1 so the smoke can sign in; Toad owns it from B3.
//
//   node tools/fake-oauth/server.mjs [--port 5190] [--interactive]
//
// Binds 127.0.0.1 only, never 0.0.0.0. Real checks, so a green sign-in means something:
//   GET  /authorize  response_type=code, client_id = the stub id, a redirect_uri, and
//                    code_challenge_method=S256 with a code_challenge, else 400. The subject is
//                    login_hint, else FAKE_OAUTH_SUBJECT, else "dev-user". With --interactive and no
//                    login_hint, a page offers two accounts and Cancel (error=access_denied).
//                    FAKE_OAUTH_ERROR=<code> answers every authorize with that error.
//   POST /token      the exact client id and secret, the authorize step's exact redirect_uri, a
//                    single-use code, and a code_verifier whose S256 is the challenge, else 400.
//   GET  /userinfo   Bearer token -> { sub, name, email, picture, locale, ... } (v3 shape; the API
//                    keeps only sub and name).
//   GET  /__calls    { authorize, token, tokenFailures, userinfo } counts, for tests.
//   POST /__next-subject?sub=<s>  (Toad, B3) queues a one-shot subject: the next authorize without
//                    a login_hint signs in as <s> (FIFO; it takes precedence over --interactive's
//                    page). It lets a browser gate sign two accounts in through the real redirect
//                    flow (the API builds the authorize URL, so the gate can't add login_hint).
//                    Test plumbing only: the C# stub has no equivalent and needs none.
//
// The API side (appsettings.Development.json, or env vars for Testing):
//   Auth__Providers__Google__ClientId=fireworks-stub-client
//   Auth__Providers__Google__ClientSecret=stub-secret-not-a-credential
//   Auth__Providers__Google__AuthorizationEndpoint=http://127.0.0.1:5190/authorize   (the browser goes here)
//   Auth__Providers__Google__TokenEndpoint=http://127.0.0.1:5190/token               (the API calls these two;
//   Auth__Providers__Google__UserInformationEndpoint=http://127.0.0.1:5190/userinfo   from Docker use host.docker.internal)
// Production refuses all of this at startup.
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLIENT_ID = 'fireworks-stub-client';
export const CLIENT_SECRET = 'stub-secret-not-a-credential';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.randomBytes(24));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createStub({ interactive = false, defaultSubject = process.env.FAKE_OAUTH_SUBJECT || 'dev-user', error = process.env.FAKE_OAUTH_ERROR || null } = {}) {
  const codes = new Map();
  const tokens = new Map();
  const calls = { authorize: 0, token: 0, tokenFailures: [], userinfo: 0 };
  const nextSubjects = [];
  const nameFor = (sub) => `Stub ${sub}`;

  const redirect = (res, url) => { res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' }); res.end(); };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/authorize') {
      calls.authorize++;
      const q = url.searchParams;
      const redirectUri = q.get('redirect_uri') ?? '';
      if (q.get('response_type') !== 'code' || q.get('client_id') !== CLIENT_ID || !redirectUri || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) {
        return json(res, 400, { error: 'invalid_request' });
      }
      const back = new URL(redirectUri);
      back.searchParams.set('state', q.get('state') ?? '');
      const deny = q.get('deny');
      if (error || deny) {
        back.searchParams.set('error', deny ? 'access_denied' : error);
        back.searchParams.set('error_description', '<script>x</script>');
        return redirect(res, back.toString());
      }
      const hint = q.get('login_hint') || nextSubjects.shift() || null;
      if (interactive && !hint) {
        const base = new URL(req.url, 'http://127.0.0.1');
        const link = (extra) => { const u = new URL(base); for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v); return esc(u.pathname + u.search); };
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Stub sign-in</title><body style="font:16px system-ui;margin:2rem">
<h1>Stub Google sign-in</h1><p>Not Google. Local development only.</p>
<p><a href="${link({ login_hint: 'dev-alice' })}">Continue as dev-alice</a></p>
<p><a href="${link({ login_hint: 'dev-bob' })}">Continue as dev-bob</a></p>
<p><a href="${link({ deny: '1' })}">Cancel</a></p></body>`);
      }
      const code = random();
      codes.set(code, { redirectUri, challenge: q.get('code_challenge'), subject: hint || defaultSubject });
      back.searchParams.set('code', code);
      return redirect(res, back.toString());
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      calls.token++;
      let body = '';
      for await (const chunk of req) body += chunk;
      const f = new URLSearchParams(body);
      const fail = (why) => { calls.tokenFailures.push(why); return json(res, 400, { error: 'invalid_grant' }); };
      if (f.get('grant_type') !== 'authorization_code') return fail('grant_type');
      if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== CLIENT_SECRET) return fail('client');
      const issued = codes.get(f.get('code') ?? '');
      codes.delete(f.get('code') ?? ''); // single use, whatever happens next
      if (!issued) return fail('code unknown or reused');
      if (f.get('redirect_uri') !== issued.redirectUri) return fail('redirect_uri');
      const verifier = f.get('code_verifier') ?? '';
      if (!verifier || b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest()) !== issued.challenge) return fail('pkce');
      const token = random();
      tokens.set(token, issued.subject);
      return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'openid profile' });
    }
    if (req.method === 'GET' && url.pathname === '/userinfo') {
      calls.userinfo++;
      const auth = req.headers.authorization ?? '';
      const sub = auth.startsWith('Bearer ') ? tokens.get(auth.slice(7)) : undefined;
      if (!sub) return json(res, 401, { error: 'invalid_token' });
      return json(res, 200, { sub, name: nameFor(sub), given_name: 'Given', family_name: 'Family', email: `${sub}@stub.example`, email_verified: true, picture: 'https://stub.example/p.png', locale: 'en' });
    }
    if (req.method === 'GET' && url.pathname === '/__calls') return json(res, 200, calls);
    if (req.method === 'POST' && url.pathname === '/__next-subject') {
      const sub = url.searchParams.get('sub') ?? '';
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(sub)) return json(res, 400, { error: 'sub must be 1-64 of [A-Za-z0-9._-]' });
      nextSubjects.push(sub);
      return json(res, 200, { queued: nextSubjects.length });
    }
    return json(res, 404, { error: 'not_found' });
  });
  return { server, calls };
}

/** Starts a stub on 127.0.0.1:<port> (0 = any free port). Resolves { base, port, calls, close() }. */
export function startStub({ port = 0, ...options } = {}) {
  const { server, calls } = createStub(options);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ base: `http://127.0.0.1:${actual}`, port: actual, calls, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** The API's environment variables for a stub at `base` (the server-stub contract). */
export const apiEnvFor = (base, { browserBase = base } = {}) => ({
  Auth__Providers__Google__ClientId: CLIENT_ID,
  Auth__Providers__Google__ClientSecret: CLIENT_SECRET,
  Auth__Providers__Google__AuthorizationEndpoint: `${browserBase}/authorize`,
  Auth__Providers__Google__TokenEndpoint: `${base}/token`,
  Auth__Providers__Google__UserInformationEndpoint: `${base}/userinfo`,
});

/**
 * Signs in against the API at `apiBase` through the stub as `subject`, with a manual cookie jar
 * (Node's fetch has none, and Secure cookies over http must still be replayed). Returns the
 * `Cookie` header value for the session, e.g. "__Host-fw.session=...".
 */
export async function signIn(apiBase, subject = 'smoke-user', returnUrl = '/') {
  const jar = new Map();
  const absorb = (r) => {
    for (const line of r.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*expires=/i.test(a) && Date.parse(a.split('=')[1]) <= Date.now());
      if (expired || !value) jar.delete(name); else jar.set(name, value);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const login = await fetch(`${apiBase}/api/auth/login/google?returnUrl=${encodeURIComponent(returnUrl)}`, { redirect: 'manual' });
  absorb(login);
  if (login.status !== 302) throw new Error(`login: HTTP ${login.status}`);
  const authorize = new URL(login.headers.get('location'));
  authorize.searchParams.set('login_hint', subject);
  const stub = await fetch(authorize, { redirect: 'manual' });
  if (stub.status !== 302) throw new Error(`stub authorize: HTTP ${stub.status} ${await stub.text()}`);
  const callback = await fetch(stub.headers.get('location'), { redirect: 'manual', headers: { cookie: cookie() } });
  absorb(callback);
  const session = [...jar.keys()].find((k) => k.endsWith('fw.session'));
  if (callback.status !== 302 || !session) throw new Error(`callback: HTTP ${callback.status} -> ${callback.headers.get('location')}`);
  return `${session}=${jar.get(session)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
  const stub = await startStub({ port: Number(arg('--port') ?? process.env.FAKE_OAUTH_PORT ?? 5190), interactive: process.argv.includes('--interactive') });
  console.log(`fake-oauth: listening on ${stub.base} (not Google; local development and tests only)`);
}

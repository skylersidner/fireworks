/**
 * Boo A15 / finding F2 (boo-phase8-security-verification.md; Toad, Phase 8 B3): the dev proxy
 * must forward the browser's own `Origin` and `Host`. `changeOrigin: true` would rewrite them to
 * the API's, so a cross-origin write through `ng serve` on 4200 would reach the API looking
 * same-origin. (Today the CSRF guard checks `Sec-Fetch-Site` first, so the impact is small; this
 * pins the value so the dev loop stays honest.)
 *
 * Pinned: angular.json serves exactly `proxy.conf.json`; no other `proxy.conf.*` file exists; no
 * entry carries `changeOrigin` (at any depth, any case) or a `headers` override of Origin or Host.
 * Each check has a negative control on a mutated copy of the real text, so a checker that matches
 * nothing can't pass.
 */
export {}; // a module: its `process`/`fs` declarations stay file-local

interface NodeFs {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };
const fs = process.getBuiltinModule('node:fs');
const WEB = process.cwd();
const PROXY_TEXT = fs.readFileSync(`${WEB}/proxy.conf.json`, 'utf8');
const ANGULAR = JSON.parse(fs.readFileSync(`${WEB}/angular.json`, 'utf8')) as Record<
  string,
  unknown
>;

/** Every `changeOrigin` key, and every Origin/Host header override, as a path (empty: clean). */
function proxyViolations(text: string): string[] {
  const found: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      const here = `${at}.${k}`;
      if (k.toLowerCase() === 'changeorigin') found.push(here);
      if (k.toLowerCase() === 'headers' && x && typeof x === 'object') {
        for (const h of Object.keys(x)) if (/^(origin|host)$/i.test(h)) found.push(`${here}.${h}`);
      }
      walk(x, here);
    }
  };
  walk(JSON.parse(text), '$');
  return found;
}

/** Every `proxyConfig` value anywhere in angular.json. */
function proxyConfigs(json: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'proxyConfig') out.push(x);
      walk(x);
    }
  };
  walk(json);
  return out;
}

describe('dev proxy keeps the browser Origin (Boo A15, F2)', () => {
  it('angular.json serves exactly proxy.conf.json, and it is the only proxy file', () => {
    expect(proxyConfigs(ANGULAR)).toEqual(['proxy.conf.json']);
    expect(fs.readdirSync(WEB).filter((f) => /^proxy\.conf\./i.test(f))).toEqual([
      'proxy.conf.json',
    ]);
  });

  it('proxy.conf.json has no changeOrigin and no Origin/Host header override', () => {
    expect(proxyViolations(PROXY_TEXT)).toEqual([]);
    // It still proxies the API (an emptied file would pass the check above vacuously).
    expect(Object.keys(JSON.parse(PROXY_TEXT) as object)).toContain('/api');
  });

  it('negative controls: the checkers catch a mutated copy', () => {
    const withFlag = PROXY_TEXT.replace(
      '"secure": false',
      '"secure": false,\n    "changeOrigin": true',
    );
    expect(withFlag).not.toBe(PROXY_TEXT);
    expect(proxyViolations(withFlag)).toEqual(['$./api.changeOrigin']);
    const oddCase = PROXY_TEXT.replace('"secure": false', '"secure": false, "ChangeOrigin": false');
    expect(proxyViolations(oddCase)).toEqual(['$./api.ChangeOrigin']);
    const header = PROXY_TEXT.replace(
      '"secure": false',
      '"secure": false, "headers": { "Origin": "http://localhost:5180" }',
    );
    expect(proxyViolations(header)).toEqual(['$./api.headers.Origin']);
    expect(proxyConfigs({ a: { serve: { options: { proxyConfig: 'proxy.other.js' } } } })).toEqual([
      'proxy.other.js',
    ]);
  });
});

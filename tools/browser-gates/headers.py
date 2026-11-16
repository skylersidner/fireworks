# Mario Phase 7 gate: 7a.1-7a.6, 7b.1-7b.5, 7c.2, 7c.3 (HTTP side), 7c.4, 7c.5 on the image.
# Moved into the repo from scratchpad gate7/ (testing-strategy.md §3 item 12). Standard library only.
# Usage: python3 -I headers.py <port> <codeA> <codeB> [phase] [chunk,chunk]
#   codeA, codeB: saved SHELL share codes (SAVE in the runners saves fixtures/shellA.json and
#                 shellB.json). The put phase renames B.
#   phase: main (default; the regular smoke) | put | burst (exhausts the read limit: run last) |
#          dbdown (only with the database stopped)
#   Expects a Production server (no Server header, HSTS only behind forwarded https) on 127.0.0.1.
#   Negative control (Mario, Phase 7 gate): expect `'unsafe-eval'` in CSP and `no-cache` on the
#   hashed assets; the main phase must then FAIL. HEADERS_NEG=1 applies exactly that.
import http.client, json, re, socket, sys

PORT = int(sys.argv[1]); A = sys.argv[2]; B = sys.argv[3]; PHASE = sys.argv[4] if len(sys.argv) > 4 else 'main'
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; "
       "connect-src 'self'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")
SITE = {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}
import os
if os.environ.get('HEADERS_NEG'):
    CSP = CSP.replace("script-src 'self';", "script-src 'self' 'unsafe-eval';"); SITE['content-security-policy'] = CSP
IMMUTABLE = 'no-cache' if os.environ.get('HEADERS_NEG') else 'public, max-age=31536000, immutable'
fails = []; passes = 0

def req(method, path, headers=None, body=None, host=None):
    c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=15)
    h = dict(headers or {})
    if host: h['Host'] = host
    c.request(method, path, body=body, headers=h)
    r = c.getresponse(); data = r.read()
    hs = {}
    for k, v in r.getheaders():
        hs.setdefault(k.lower(), []).append(v)
    c.close()
    return r.status, {k: ', '.join(v) for k, v in hs.items()}, data, hs

def check(label, cond, detail=''):
    global passes
    if cond: passes += 1; print(f'  ok   {label}')
    else: fails.append(f'{label} {detail}'); print(f'  FAIL {label} {detail}')

def site(label, h, raw):
    for k, v in SITE.items():
        n = len(raw.get(k, []))
        check(f'{label}: {k}', n == 1 and h.get(k) == v, f'got {raw.get(k)}')
    check(f'{label}: no CSP-Report-Only', 'content-security-policy-report-only' not in h)
    check(f'{label}: no Server', 'server' not in h, h.get('server', ''))
    check(f'{label}: no Content-Encoding', 'content-encoding' not in h, h.get('content-encoding', ''))

def show(label, s, h, data):
    print(f'{label}: {s} ct={h.get("content-type")} cc={h.get("cache-control")} etag={h.get("etag")} len={len(data)}')

if PHASE == 'main':
    # index and bundle names from the served index.html
    s, h, idx, raw = req('GET', '/')
    html = idx.decode()
    mains = re.findall(r'(main-[A-Za-z0-9_-]{8}\.js)', html)
    styles = re.findall(r'(styles-[A-Za-z0-9_-]{8}\.css)', html)
    print('index refs:', mains, styles)
    # 7b.5 inline code
    scripts = re.findall(r'<script\b[^>]*>', html)
    check('7b.5 every <script> has src', all('src=' in t for t in scripts), str(scripts))
    check('7b.5 no <style', '<style' not in html)
    check('7b.5 no data-beasties', 'data-beasties' not in html)
    check('7b.5 plain stylesheet link', bool(re.search(r'<link rel="stylesheet" href="styles-[A-Za-z0-9_-]{8}\.css"', html)), re.findall(r'<link[^>]*>', html))
    check('7b.2 no meta http-equiv CSP', 'http-equiv' not in html.lower())
    check('7i.3 viewport allows zoom', 'user-scalable=no' not in html and 'maximum-scale' not in html)

    # chunk names: one whose hash starts with '-' if any, else any
    import os
    chunks = sys.argv[5].split(',') if len(sys.argv) > 5 else []
    # 7a.1 immutable
    for p in ['/' + mains[0], '/' + styles[0]] + ['/' + c for c in chunks]:
        s, h, d, raw = req('GET', p); show(p, s, h, d)
        check(f'7a.1 {p} immutable', s == 200 and h.get('cache-control') == IMMUTABLE, h.get('cache-control'))
        check(f'7a.1 {p} ETag+Last-Modified', 'etag' in h and 'last-modified' in h)
        site(f'7b.1 asset {p}', h, raw)
    # 7a.2 shell revalidates
    for p in ['/', '/index.html', '/show', '/mine', f'/s/{A}', f'/c/{A}']:
        s, h, d, raw = req('GET', p); show(p, s, h, d)
        check(f'7a.2 {p} 200 html no-cache etag', s == 200 and h.get('content-type', '').startswith('text/html') and h.get('cache-control') == 'no-cache' and 'etag' in h, '')
        site(f'7b.1 {p}', h, raw)
        s2, h2, d2, raw2 = req('GET', p, {'If-None-Match': h.get('etag', '')})
        check(f'7a.2 {p} INM 304 empty', s2 == 304 and len(d2) == 0, f'{s2} {len(d2)}')
        if p == '/': site('7b.1 304 (index)', h2, raw2)
    # 7a.3 unhashed and misses
    for p in ['/favicon.svg', '/3rdpartylicenses.txt']:
        s, h, d, raw = req('GET', p); show(p, s, h, d)
        check(f'7a.3 {p} no-cache', s == 200 and h.get('cache-control') == 'no-cache')
    for p in ['/chunk-AAAAAAAA.js', '/nope.js']:
        s, h, d, raw = req('GET', p); show(p, s, h, d)
        check(f'7a.3 {p} 404 no-store', s == 404 and h.get('cache-control') == 'no-store')
        site(f'7b.1 static miss {p}', h, raw)
    # precompressed siblings must not be negotiated (7c.5)
    for p in ['/' + mains[0], '/', f'/api/creations/{A}']:
        s, h, d, raw = req('GET', p, {'Accept-Encoding': 'gzip, br'})
        check(f'7c.5 {p} with Accept-Encoding: no Content-Encoding', 'content-encoding' not in h, h.get('content-encoding', ''))
    # 7a.4 share GET token
    s, h, d, raw = req('GET', f'/api/creations/{A}'); show('GET A', s, h, d)
    upd = re.search(rb'"updatedAt":"([^"]+)"', d).group(1).decode()
    tag = h.get('etag')
    check('7a.4 ETag == quoted raw updatedAt', tag == f'"{upd}"', f'{tag} vs {upd}')
    check('7a.4 private, no-cache', h.get('cache-control') == 'private, no-cache', h.get('cache-control'))
    site('7b.1 api 200 share GET', h, raw)
    s, h, d, raw = req('GET', '/api/creations/abcdefgh'); show('GET unknown', s, h, d)
    check('7a.4 404 no-store', s == 404 and h.get('cache-control') == 'no-store')
    # 7a.5 304 forms
    for label, inm, want in [('tag', tag, 304), ('W/tag', 'W/' + tag, 304), ('list', f'"x", {tag}, "y"', 304), ('*', '*', 304), ('garbage', '"garbage"', 200)]:
        s, h, d, raw = req('GET', f'/api/creations/{A}', {'If-None-Match': inm})
        check(f'7a.5 INM {label} -> {want}', s == want and (len(d) == 0 if want == 304 else len(d) > 0), f'{s} {len(d)}')
        if label == 'tag':
            check('7a.5 304 same ETag, private no-cache', h.get('etag') == tag and h.get('cache-control') == 'private, no-cache', f"{h.get('etag')} {h.get('cache-control')}")
            site('7b.1 api 304', h, raw)
    s, h, d, raw = req('GET', f'/api/creations/{A}', {'If-Match': '"nope"'})
    check('7a.5 If-Match ignored (200)', s == 200, s)
    # 7b.1 other classes
    s, h, d, raw = req('GET', '/api/me'); show('api/me', s, h, d); print('   ', d[:120])
    check('api/me 200 no-store', s == 200 and h.get('cache-control') == 'no-store'); site('7b.1 api/me 200', h, raw)
    s, h, d, raw = req('GET', '/api/nope'); show('/api/nope', s, h, d)
    check('/api/nope 404 no-store', s == 404 and h.get('cache-control') == 'no-store'); site('7b.1 /api/nope 404', h, raw)
    body = json.dumps({'kind': 'shell', 'document': {'name': 'x' * 300000}}).encode()
    s, h, d, raw = req('POST', '/api/creations', {'Content-Type': 'application/json'}, body); show('413', s, h, d)
    check('413 on 300 KB declared', s == 413, s); site('7b.1 413', h, raw)
    s, h, d, raw = req('POST', '/show'); show('POST /show', s, h, d)
    check('405 on deep link no-store', s == 405 and h.get('cache-control') == 'no-store', f'{s} {h.get("cache-control")}'); site('7b.1 405', h, raw)
    for p in ['/health/live', '/health/ready']:
        s, h, d, raw = req('GET', p); show(p, s, h, d)
        check(f'{p} 200 text/plain Healthy', s == 200 and h.get('content-type', '').startswith('text/plain') and d == b'Healthy', d)
        site(f'7b.1 {p}', h, raw)
    s, h, d, raw = req('GET', '/health/ready/x'); show('/health/ready/x', s, h, d)
    check('7c.2 /health/ready/x is SPA', s == 200 and h.get('content-type', '').startswith('text/html') and h.get('cache-control') == 'no-cache')
    for p in ['/c/..%2Fme', '/s/..%2Fme', '/s/a.b']:
        s, h, d, raw = req('GET', p); show(p, s, h, d)
        check(f'7c.3 {p} 200 html no-cache', s == 200 and h.get('content-type', '').startswith('text/html') and h.get('cache-control') == 'no-cache')
        site(f'7b.1 {p}', h, raw)
    # 7b.4 HSTS
    s, h, d, raw = req('GET', '/', {'X-Forwarded-Proto': 'https'}, host='fireworks.example')
    check('7b.4 HSTS over forwarded https', h.get('strict-transport-security') == 'max-age=31536000', h.get('strict-transport-security'))
    s, h, d, raw = req('GET', '/', host='fireworks.example')
    check('7b.4 no HSTS without proto', 'strict-transport-security' not in h)
    # 7b.3 Kestrel 400 and 431 over a raw socket
    for label, payload in [('400 Host: a b', b'GET / HTTP/1.1\r\nHost: a b\r\n\r\n'),
                           ('431 40 KB header', b'GET / HTTP/1.1\r\nHost: localhost\r\nX-Big: ' + b'a' * 40960 + b'\r\n\r\n')]:
        sk = socket.create_connection(('127.0.0.1', PORT), timeout=10); sk.sendall(payload)
        resp = b''
        try:
            while b'\r\n\r\n' not in resp:
                chunk = sk.recv(65536)
                if not chunk: break
                resp += chunk
        except Exception as e: print('   sock', e)
        sk.close(); head = resp.split(b'\r\n\r\n')[0].decode(errors='replace')
        print(f'{label}: {head.splitlines()[0] if head else "(none)"}')
        check(f'7b.3 {label}: status and no Server', head.startswith('HTTP/1.1 ' + label[:3]) and 'server:' not in head.lower(), head[:200])
    # 7c.4 chunked over-limit closes, next request on the same client object succeeds
    c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=15)
    def gen():
        for _ in range(30): yield b'{"pad":"' + b'a' * 10000 + b'"}'
    c.request('POST', '/api/creations', body=gen(), headers={'Content-Type': 'application/json'}, encode_chunked=True)
    r = c.getresponse(); r.read(); conn = r.getheader('Connection')
    print('chunked 300 KB:', r.status, 'Connection:', conn)
    check('7c.4 chunked 413 + Connection: close', r.status == 413 and (conn or '').lower() == 'close', f'{r.status} {conn}')
    c.request('GET', '/health/live'); r2 = c.getresponse(); d2 = r2.read()
    check('7c.4 next request on same client object succeeds', r2.status == 200, r2.status)
    c.close()

elif PHASE == 'put':
    s, h, d, raw = req('GET', f'/api/creations/{B}'); T = h['etag']
    doc = json.loads(d)['document']; doc['name'] = 'Gate7 B edited'
    s, h, d, raw = req('PUT', f'/api/creations/{B}', {'Content-Type': 'application/json'}, json.dumps({'document': doc}).encode())
    upd = re.search(rb'"updatedAt":"([^"]+)"', d).group(1).decode()
    print('PUT', s, h.get('etag'), h.get('cache-control'))
    check('7a.6 PUT 200, ETag == quoted body updatedAt, no-store', s == 200 and h.get('etag') == f'"{upd}"' and h.get('cache-control') == 'no-store')
    putTag = h.get('etag')
    s, h, d, raw = req('GET', f'/api/creations/{B}', {'If-None-Match': T})
    check('7a.6 old tag gets 200 with new tag == PUT tag', s == 200 and h.get('etag') != T and h.get('etag') == putTag, f'{s} {h.get("etag")} {T}')

elif PHASE == 'burst':
    st = []
    for i in range(130):
        s, h, d, raw = req('GET', '/api/creations/abcdefgh'); st.append(s)
        if s == 429: break
    print('burst statuses tail', st[-3:], 'n', len(st))
    check('429 reached', st[-1] == 429); site('7b.1 429', h, raw)
    check('429 no-store', h.get('cache-control') == 'no-store', h.get('cache-control'))

elif PHASE == 'dbdown':
    s, h, d, raw = req('GET', '/health/ready'); show('/health/ready (db dropped)', s, h, d)
    check('7c.1 503 text/plain Unhealthy, no exception text', s == 503 and h.get('content-type', '').startswith('text/plain') and d == b'Unhealthy', d[:200])
    site('7b.1 /health/ready 503', h, raw)
    s, h, d, raw = req('GET', '/health/live'); check('7c.1 /health/live still 200', s == 200)
    s, h, d, raw = req('GET', f'/api/creations/{A}'); show('share GET (db dropped)', s, h, d); print('   ', d[:200])
    check('forced 500', s == 500, s); site('7b.1 500', h, raw)
    check('500 no-store (Boo F1)', h.get('cache-control') == 'no-store' and 'pragma' not in h and 'expires' not in h, f"{h.get('cache-control')} {h.get('pragma')}")
    check('500 body has no connection string / exception', b'Password' not in d and b'Npgsql' not in d and b'Exception' not in d)

print(f'\n{PHASE}: {passes} ok, {len(fails)} fail')
for f in fails: print('  FAIL', f)
sys.exit(1 if fails else 0)

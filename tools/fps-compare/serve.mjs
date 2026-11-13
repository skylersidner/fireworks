// fps comparison kit (plan Phase 2d): serves the production build of the port and the prototype
// from ONE origin, with Pixi served locally, so both run in the same browser, window and network
// conditions. Needs only Node (no dependencies). See README.md in this folder for the procedure.
//
//   node tools/fps-compare/serve.mjs [port]        (default port 4310)
//
// What it serves:
//   /                 the port's production build (src/api/Fireworks.Api/wwwroot), SPA fallback
//   /prototype.html   prototypes/fireworks-prototype.html with its jsDelivr Pixi URL rewritten to
//                     /vendor/pixi.min.mjs (the same pixi.js version the port bundles)
//   /health/live, /api/me   stubbed healthy (anonymous), so the port shows no "API unavailable"
//   /__fps/kit.js     the measuring overlay injected into both pages (add ?kit=0 to leave it out)
// Nothing is written to disk. It binds to 127.0.0.1 only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BUILD = path.join(ROOT, 'src/api/Fireworks.Api/wwwroot');
const WEB = path.join(ROOT, 'src/web/fireworks-web');
const PROTOTYPE = path.join(ROOT, 'prototypes/fireworks-prototype.html');
const PIXI_PKG = path.join(WEB, 'node_modules/pixi.js/package.json');
const PIXI_MJS = path.join(WEB, 'node_modules/pixi.js/dist/pixi.min.mjs');
const KIT = path.join(import.meta.dirname, 'kit.js');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4310);

function fail(message) {
  console.error(`fps-compare: ${message}`);
  process.exit(1);
}

// Preconditions: fail loudly rather than measure the wrong thing.
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Node ${process.versions.node} is too old; use Node 26 (see .nvmrc).`);
if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
  fail(`no production build at ${BUILD}.\n  Run: npm --prefix src/web/fireworks-web run build`);
}
if (!fs.existsSync(PIXI_MJS)) fail(`pixi.js is not installed.\n  Run: npm --prefix src/web/fireworks-web ci`);

const prototypeHtml = fs.readFileSync(PROTOTYPE, 'utf8');
const cdn = prototypeHtml.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/pixi\.js@([\d.]+)\/dist\/pixi\.min\.mjs/);
if (!cdn) fail('the prototype no longer imports Pixi from the expected jsDelivr URL; update serve.mjs.');
const localPixi = JSON.parse(fs.readFileSync(PIXI_PKG, 'utf8')).version;
if (cdn[1] !== localPixi) {
  fail(`the prototype pins pixi.js ${cdn[1]} but the port has ${localPixi}; the comparison would not be like for like.`);
}

// A stale build measures old code. Warn when any source file is newer than the build.
function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}
const buildTime = fs.statSync(path.join(BUILD, 'index.html')).mtimeMs;
const stale = newestMtime(path.join(WEB, 'src')) > buildTime;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function injectKit(html, url) {
  if (url.searchParams.get('kit') === '0') return html;
  return html.replace('</body>', '<script src="/__fps/kit.js"></script></body>');
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    if (p === '/health/live') return send(res, 200, 'text/plain', 'Healthy');
    if (p === '/api/me') {
      return send(res, 200, 'application/json',
        '{"userId":null,"displayName":null,"isAuthenticated":false,"canWrite":false}');
    }
    if (p.startsWith('/api/')) return send(res, 404, 'text/plain', 'Not found');
    if (p === '/__fps/kit.js') return send(res, 200, TYPES['.js'], fs.readFileSync(KIT));
    if (p === '/vendor/pixi.min.mjs') return send(res, 200, TYPES['.mjs'], fs.readFileSync(PIXI_MJS));
    if (p === '/prototype.html') {
      const html = fs.readFileSync(PROTOTYPE, 'utf8').replace(cdn[0], '/vendor/pixi.min.mjs');
      return send(res, 200, TYPES['.html'], injectKit(html, url));
    }
    // The port: a real file from the build, else index.html (Angular routes such as /status).
    let file = path.resolve(BUILD, '.' + decodeURIComponent(p));
    const inside = file === BUILD || file.startsWith(BUILD + path.sep);
    if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(BUILD, 'index.html');
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    const body = fs.readFileSync(file);
    if (file.endsWith('index.html')) return send(res, 200, type, injectKit(body.toString('utf8'), url));
    return send(res, 200, type, body);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`fps-compare serving on http://127.0.0.1:${PORT}`);
    console.log(`  prototype: http://127.0.0.1:${PORT}/prototype.html`);
    console.log(`  port:      http://127.0.0.1:${PORT}/`);
    console.log(`  pixi.js ${localPixi} served locally to both; build from ${new Date(buildTime).toLocaleString()}`);
    if (stale) {
      console.warn('  WARNING: source files are newer than the build. Rebuild first:');
      console.warn('    npm --prefix src/web/fireworks-web run build');
    }
    console.log('Ctrl+C to stop.');
  })
  .on('error', (e) => fail(e.code === 'EADDRINUSE' ? `port ${PORT} is in use; pass another: node tools/fps-compare/serve.mjs 4311` : String(e)));

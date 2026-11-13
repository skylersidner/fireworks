// fps-compare overlay, injected by serve.mjs into both the prototype and the port. It is dormant
// until you press one of its keys, and touches neither app's code or state.
//   A  toggle auto-Space: a Space keydown/keyup pair dispatched on <body> 10 times a second.
//      Both apps listen for Space on window/document, so this is the same input for both, and it
//      avoids the port's "held Space fires once" rule and macOS key-repeat differences.
//   R  record 10 s of requestAnimationFrame intervals and show the median fps.
// Keys are ignored while a text field, select or textarea has focus, or with a modifier held.
(() => {
  const PRESSES_PER_SECOND = 10;
  const RECORD_MS = 10000;
  const app = location.pathname.startsWith('/prototype') ? 'prototype' : 'port';
  let presser = null;
  const results = [];

  const badge = document.createElement('div');
  badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:2147483647;pointer-events:none;' +
    'font:11px/1.45 ui-monospace,Menlo,monospace;color:#e6e9f2;background:rgba(4,6,12,.82);' +
    'border:1px solid #3a4562;border-radius:6px;padding:6px 8px;white-space:pre;max-width:46ch';
  document.body.appendChild(badge);

  const particles = () => {
    const hud = document.querySelector('[data-testid="hud"]') ?? document.getElementById('hud');
    const m = (hud?.textContent ?? '').match(/([\d,.\s ]+)\s*particles/);
    return m ? Number(m[1].replace(/[^\d]/g, '')) : NaN;
  };

  function draw(status = '') {
    const lines = [
      `fps kit · ${app} · ${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
      `A auto-Space ${presser ? `ON (${PRESSES_PER_SECOND}/s)` : 'off'} · R record 10 s`,
    ];
    if (status) lines.push(status);
    for (const r of results.slice(-3)) lines.push(r.line);
    badge.textContent = lines.join('\n');
  }

  function space(type) {
    document.body.dispatchEvent(
      new KeyboardEvent(type, { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true }),
    );
  }

  function toggleAutoSpace() {
    if (presser) {
      clearInterval(presser);
      presser = null;
    } else {
      presser = setInterval(() => {
        space('keydown');
        space('keyup');
      }, 1000 / PRESSES_PER_SECOND);
    }
    draw();
  }

  let recording = false;
  function record() {
    if (recording) return;
    recording = true;
    const startParticles = particles();
    const stamps = [];
    draw('recording… keep the window still and in front');
    const step = (t) => {
      stamps.push(t);
      if (t - stamps[0] < RECORD_MS) return requestAnimationFrame(step);
      recording = false;
      const iv = stamps.slice(1).map((s, i) => s - stamps[i]).sort((a, b) => a - b);
      const q = (f) => iv[Math.min(iv.length - 1, Math.floor(iv.length * f))];
      const r = {
        app,
        browser: navigator.userAgent,
        viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
        frames: iv.length,
        medianFps: +(1000 / q(0.5)).toFixed(1),
        meanFps: +((iv.length * 1000) / (stamps.at(-1) - stamps[0])).toFixed(1),
        p95FrameMs: +q(0.95).toFixed(1),
        worstFrameMs: +iv.at(-1).toFixed(1),
        particlesAtStart: startParticles,
        particlesAtEnd: particles(),
        autoSpace: !!presser,
      };
      const atCap = r.particlesAtStart >= 39000 && r.particlesAtEnd >= 39000;
      r.line = `#${results.length + 1} median ${r.medianFps} fps · p95 ${r.p95FrameMs} ms · ` +
        `${r.particlesAtStart.toLocaleString()}→${r.particlesAtEnd.toLocaleString()}` +
        (atCap ? '' : '  NOT AT CAP: discard');
      results.push(r);
      console.log('[fps-compare]', JSON.stringify(r));
      draw();
    };
    requestAnimationFrame(step);
  }

  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !e.isTrusted) return;
    const el = document.activeElement;
    if (el && (el.matches('input, textarea, select') || el.isContentEditable)) return;
    if (e.code === 'KeyA') toggleAutoSpace();
    else if (e.code === 'KeyR') record();
  });
  addEventListener('resize', () => draw());
  draw();
})();

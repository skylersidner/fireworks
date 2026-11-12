import { Application, Container, Sprite, Texture } from 'pixi.js';

/**
 * The renderer Pixi actually picked. `preference: 'webgl'` is only a preference: when WebGL is
 * missing, Pixi 8 silently falls back to WebGPU and then to Canvas 2D, so "it drew" proves nothing
 * about WebGL. The canary reports which one won.
 */
export type CanaryRenderer = 'webgl' | 'webgpu' | 'canvas';

/** A running canary scene. `destroy()` is idempotent. */
export interface CanaryHandle {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: CanaryRenderer;
  destroy(): void;
}

export const CANARY_SIZE = 200;

/** Dot colors: the prototype's accent pair plus two of its burst-ish hues. */
const DOTS: readonly { x: number; y: number; color: number; scale: number; phase: number }[] = [
  { x: 0.5, y: 0.45, color: 0xffb347, scale: 1.6, phase: 0 },
  { x: 0.3, y: 0.62, color: 0xff7a59, scale: 1.1, phase: 1.3 },
  { x: 0.7, y: 0.6, color: 0x7ab8ff, scale: 1.2, phase: 2.1 },
  { x: 0.42, y: 0.28, color: 0xff6fd8, scale: 0.9, phase: 3.4 },
  { x: 0.62, y: 0.3, color: 0xfff1a8, scale: 0.8, phase: 4.6 },
];

/**
 * The prototype's soft dot texture (prototypes/fireworks-prototype.html, makeDotTexture): a 64px
 * white radial gradient that additive blending turns into a glow.
 */
function makeDotTexture(): Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) {
    throw new Error('2D canvas is unavailable.');
  }
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return Texture.from(c);
}

/**
 * Phase 1 canary: proves pixi.js bundles into a lazy chunk, loads with the right MIME type and
 * runs in the production image, and reports which renderer it got (WebGL is only proven when the
 * handle says `webgl`). A few additive glow dots that pulse gently. The
 * animation runs on Pixi's ticker and never touches Angular state.
 *
 * Init options follow the prototype's `start()`: WebGL preference (with Pixi's fallback, as in the
 * prototype), no antialias, DPR capped at 2.
 */
export async function startCanaryScene(): Promise<CanaryHandle> {
  const app = new Application();
  await app.init({
    width: CANARY_SIZE,
    height: CANARY_SIZE,
    background: '#04060c',
    antialias: false,
    preference: 'webgl',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  // Pixi 8.23's WebGLRenderer, WebGPURenderer and CanvasRenderer name themselves exactly these
  // three strings (typed `string` on AbstractRenderer; RendererType is @internal).
  const renderer = app.renderer.name as CanaryRenderer;

  const texture = makeDotTexture();
  const layer = new Container();
  layer.blendMode = 'add';
  const sprites = DOTS.map((dot) => {
    const sprite = new Sprite({ texture, anchor: 0.5 });
    sprite.position.set(dot.x * CANARY_SIZE, dot.y * CANARY_SIZE);
    sprite.tint = dot.color;
    sprite.scale.set(dot.scale);
    layer.addChild(sprite);
    return sprite;
  });
  app.stage.addChild(layer);

  let t = 0;
  app.ticker.add((ticker) => {
    t += ticker.deltaMS / 1000;
    sprites.forEach((sprite, i) => {
      const dot = DOTS[i];
      const pulse = 0.85 + 0.15 * Math.sin(t * 2 + dot.phase);
      sprite.scale.set(dot.scale * pulse);
      sprite.alpha = 0.7 + 0.3 * pulse;
    });
  });

  let destroyed = false;
  return {
    canvas: app.canvas,
    renderer,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      // removeView detaches the canvas; under WebGL, renderer destroy calls
      // WEBGL_lose_context.loseContext(), which is what releases the context (browsers cap live WebGL contexts per page).
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    },
  };
}

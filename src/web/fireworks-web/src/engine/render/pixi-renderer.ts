import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  type Texture,
} from 'pixi.js';
import type { FireworksSim } from '../sim/simulation';
import { screenToWorld, worldScale } from './coordinates';
import { createGlowTexture, GLOW_TEXTURE_SIZE } from './glow-texture';
import { drawSkyline } from './skyline';
import type {
  RendererName,
  StageRenderer,
  StageRendererOptions,
  TrailFormat,
} from './stage-renderer';
import { chooseTrailFormat, TrailBuffer } from './trail-buffer';
import { particleVisual, type ParticleVisual } from './visual-rules';

/** No 24-bit color equals this, so a fresh slot always gets its tint set. */
const NO_TINT = 0xffffffff;
const TEX_SCALE = 1 / GLOW_TEXTURE_SIZE;

/**
 * Pixi 8 renderer for one stage (prototype l.389-472 and `start`). One instance per stage: it
 * owns its Application, glow texture, ParticleContainer, trail buffer and skyline. Reads the sim's
 * typed arrays every frame and never writes them.
 */
export class PixiRenderer implements StageRenderer {
  readonly name: RendererName;
  readonly trailFormat: TrailFormat;

  private readonly dotTex: Texture;
  private readonly pc: ParticleContainer;
  private readonly worldLayer = new Container();
  private readonly worldRoot = new Container();
  private readonly trail: TrailBuffer;
  private readonly skyline = new Graphics();
  /** Particles in sim index order (also `pc.particleChildren`), plus a LIFO pool. */
  private readonly live: Particle[] = [];
  private readonly pool: Particle[] = [];
  /**
   * Last tint written per live slot (replaces the prototype's `p._lastTint` monkey-patch). Valid
   * because `live` and `pool` are both stacks moved top to top, so slot i always holds the same
   * Particle object; a newly created Particle resets its slot to NO_TINT.
   */
  private tintCache: Uint32Array = new Uint32Array(0);
  private readonly visual: ParticleVisual = { alpha: 0, px: 0, color: 0 };
  private readonly resizeObserver: ResizeObserver | null;
  private lastW = 0;
  private lastH = 0;
  private scale = 1;
  private destroyed = false;

  private constructor(
    private readonly app: Application,
    host: HTMLElement,
    options: StageRendererOptions,
  ) {
    this.name = app.renderer.name as RendererName;
    this.dotTex = createGlowTexture();
    this.pc = new ParticleContainer({
      texture: this.dotTex,
      dynamicProperties: { position: true, vertex: true, color: true, rotation: true, uvs: true },
    });
    this.pc.blendMode = 'add';
    this.worldLayer.addChild(this.pc);
    this.worldRoot.addChild(this.worldLayer);

    this.trailFormat = chooseTrailFormat(app.renderer, options.forceTrailFormat);
    this.trail = new TrailBuffer(app.renderer, this.trailFormat);
    app.stage.addChild(this.trail.sprite, this.skyline);

    // Pixi's resizeTo only listens to window resize; the host can also change size with layout.
    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => app.queueResize());
    this.resizeObserver?.observe(host);

    this.handleResize();
  }

  /** Creates and initializes a renderer sized to `host`. Does not attach the canvas. */
  static async create(
    host: HTMLElement,
    options: StageRendererOptions = {},
  ): Promise<PixiRenderer> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: '#04060c',
      antialias: false,
      preference: 'webgl',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    return new PixiRenderer(app, host, options);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  worldWidth(): number {
    return this.lastW / this.scale;
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    return screenToWorld(clientX, clientY, this.app.canvas.getBoundingClientRect(), this.scale);
  }

  start(onFrame: (deltaMS: number) => void): void {
    this.app.ticker.add((ticker) => {
      this.handleResize();
      onFrame(ticker.deltaMS);
    });
  }

  render(sim: FireworksSim, persistence: number, reduceFlashing = false): void {
    this.sync(sim, reduceFlashing);
    this.trail.draw(this.worldRoot, persistence);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.app.ticker.stop();
    // Off-stage objects first, while the renderer can still free their GPU resources.
    this.worldRoot.destroy({ children: true });
    this.trail.destroy();
    this.live.length = 0;
    this.pool.length = 0;
    // removeView detaches the canvas; under WebGL the renderer's destroy calls
    // WEBGL_lose_context.loseContext(), which releases the context (browsers cap them per page).
    this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    // The glow texture last: the particle pipe's shared shader keeps it bound until the renderer
    // is destroyed, and destroying it first logs Pixi's "[BindGroup] ... still bound" warning.
    this.dotTex.destroy(true);
  }

  private handleResize(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    this.scale = worldScale(h);
    this.worldLayer.scale.set(this.scale);
    this.trail.resize(w, h);
    drawSkyline(this.skyline, w, h, this.scale);
  }

  private sync(sim: FireworksSim, reduceFlashing: boolean): void {
    const P = sim.particles;
    const live = this.live;
    if (this.tintCache.length < P.capacity) {
      const grown = new Uint32Array(P.capacity).fill(NO_TINT);
      grown.set(this.tintCache);
      this.tintCache = grown;
    }
    const tints = this.tintCache;
    while (live.length < P.n) {
      const reused = this.pool.pop();
      if (!reused) tints[live.length] = NO_TINT;
      live.push(reused ?? new Particle({ texture: this.dotTex, anchorX: 0.5, anchorY: 0.5 }));
    }
    while (live.length > P.n) this.pool.push(live.pop()!);

    const v = this.visual;
    for (let i = 0; i < P.n; i++) {
      const p = live[i];
      particleVisual(P, i, v, reduceFlashing);
      p.x = P.x[i];
      p.y = P.y[i];
      p.scaleX = p.scaleY = v.px * TEX_SCALE;
      if (tints[i] !== v.color) {
        p.tint = v.color;
        tints[i] = v.color;
      }
      p.alpha = v.alpha;
    }
    this.pc.particleChildren = live;
    this.pc.update();
  }
}

/** Default `StageRendererFactory`; dynamically imported so Pixi stays in a lazy chunk. */
export function createPixiRenderer(
  host: HTMLElement,
  options?: StageRendererOptions,
): Promise<StageRenderer> {
  return PixiRenderer.create(host, options);
}

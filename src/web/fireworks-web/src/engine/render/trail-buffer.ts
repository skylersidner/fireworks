import {
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  type Renderer,
  type WebGLRenderer,
} from 'pixi.js';
import type { TrailFormat } from './stage-renderer';

/** Stage background, also the fade color (prototype `#04060c`). */
export const SKY_COLOR = 0x04060c;

/**
 * Whether a half-float render target will actually work, decided BEFORE the texture exists.
 * The prototype wrapped `RenderTexture.create` in try/catch, which never throws: an unsupported
 * format only fails at render time (notably Safari). WebGPU renders rgba16float natively; WebGL2
 * needs EXT_color_buffer_float or EXT_color_buffer_half_float; WebGL1 and Canvas 2D get 8 bits.
 */
export function chooseTrailFormat(renderer: Renderer, force?: TrailFormat): TrailFormat {
  if (force) return force;
  if (renderer.name === 'webgpu') return 'rgba16float';
  if (renderer.name === 'webgl') {
    const gl = renderer as WebGLRenderer;
    if (gl.context.webGLVersion !== 2) return 'rgba8unorm';
    const floatOk =
      !!gl.context.extensions.colorBufferFloat ||
      !!gl.gl.getExtension('EXT_color_buffer_half_float');
    return floatOk ? 'rgba16float' : 'rgba8unorm';
  }
  return 'rgba8unorm';
}

/**
 * The motion-blur buffer (prototype `trailRT`, `fadeRect`, `fadeRoot`): every frame a sky-colored
 * rect at alpha `1 - persistence` fades what is there, then the particles draw on top. Half-float
 * avoids the faint 8-bit "ghost" streaks a fading buffer leaves.
 */
export class TrailBuffer {
  readonly texture: RenderTexture;
  readonly sprite: Sprite;
  readonly format: TrailFormat;
  private readonly fadeRect = new Graphics();
  private readonly fadeRoot = new Container();

  constructor(
    private readonly renderer: Renderer,
    format: TrailFormat,
  ) {
    this.format = format;
    this.texture = RenderTexture.create({
      width: 16,
      height: 16,
      resolution: renderer.resolution,
      format,
    });
    this.sprite = new Sprite(this.texture);
    this.fadeRoot.addChild(this.fadeRect);
  }

  /** Resizes to the stage and clears to the sky color (prototype `handleResize`). */
  resize(w: number, h: number): void {
    this.texture.resize(w, h);
    this.fadeRect.clear().rect(0, 0, w, h).fill(SKY_COLOR);
    this.fadeRect.alpha = 1;
    this.renderer.render({ container: this.fadeRoot, target: this.texture, clear: true });
  }

  /** Fades the previous frame, then draws `world` on top. */
  draw(world: Container, persistence: number): void {
    this.fadeRect.alpha = 1 - persistence;
    this.renderer.render({ container: this.fadeRoot, target: this.texture, clear: false });
    this.renderer.render({ container: world, target: this.texture, clear: false });
  }

  /**
   * Destroys the off-stage fade container. The sprite and its RenderTexture are on the stage and
   * go with `app.destroy(..., { texture: true, textureSource: true })`. Call before that, while
   * the renderer is still alive.
   */
  destroy(): void {
    this.fadeRoot.destroy({ children: true });
  }
}

import type { FireworksSim } from '../../engine/sim/simulation';
import type {
  RendererName,
  StageRenderer,
  StageRendererOptions,
  TrailFormat,
} from '../../engine/render/stage-renderer';

/**
 * Stands in for the Pixi renderer in specs: jsdom has no WebGL, and the real factory's dynamic
 * import would pull pixi.js into the test bundle. Each factory call returns a promise the spec
 * resolves or rejects by hand, so destroy-before-init can be exercised deterministically, and each
 * renderer's frames are driven by hand through `frame(ms)`.
 */
export class FakeStageRenderers {
  readonly starts: {
    host: HTMLElement;
    options: StageRendererOptions | undefined;
    resolve: (name?: RendererName, trailFormat?: TrailFormat) => FakeStageRenderer;
    reject: (error: unknown) => void;
  }[] = [];
  readonly renderers: FakeStageRenderer[] = [];

  readonly factory = (host: HTMLElement, options?: StageRendererOptions): Promise<StageRenderer> =>
    new Promise<StageRenderer>((resolve, reject) => {
      this.starts.push({
        host,
        options,
        resolve: (name: RendererName = 'webgl', trailFormat: TrailFormat = 'rgba16float') => {
          const renderer = new FakeStageRenderer(name, trailFormat);
          this.renderers.push(renderer);
          resolve(renderer);
          return renderer;
        },
        reject,
      });
    });
}

export class FakeStageRenderer implements StageRenderer {
  readonly canvas = document.createElement('canvas');
  destroyCalls = 0;
  renderCalls = 0;
  lastPersistence: number | null = null;
  lastReduceFlashing: boolean | null = null;
  width = 1280;
  /** World point the next `screenToWorld` returns. */
  nextWorldPoint = { x: 640, y: 300 };
  private onFrame: ((deltaMS: number) => void) | null = null;

  constructor(
    readonly name: RendererName = 'webgl',
    readonly trailFormat: TrailFormat = 'rgba16float',
  ) {}

  worldWidth(): number {
    return this.width;
  }

  screenToWorld(_clientX: number, _clientY: number): { x: number; y: number } {
    return this.nextWorldPoint;
  }

  start(onFrame: (deltaMS: number) => void): void {
    this.onFrame = onFrame;
  }

  get started(): boolean {
    return this.onFrame !== null;
  }

  /** Drives `count` animation frames of `deltaMS` each (no-op once destroyed). */
  frame(deltaMS: number, count = 1): void {
    for (let k = 0; k < count && this.onFrame; k++) this.onFrame(deltaMS);
  }

  render(_sim: FireworksSim, persistence: number, reduceFlashing = false): void {
    this.renderCalls++;
    this.lastPersistence = persistence;
    this.lastReduceFlashing = reduceFlashing;
  }

  destroy(): void {
    this.destroyCalls++;
    this.onFrame = null;
    this.canvas.remove();
  }
}

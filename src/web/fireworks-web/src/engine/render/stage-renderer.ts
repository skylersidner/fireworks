import type { FireworksSim } from '../sim/simulation';

/**
 * The renderer Pixi actually picked. `preference: 'webgl'` is only a preference: Pixi 8 falls
 * back to WebGPU and then Canvas 2D silently, so the stage reports which one won.
 */
export type RendererName = 'webgl' | 'webgpu' | 'canvas';

/** Trail buffer format, chosen by an explicit capability check before the texture is created. */
export type TrailFormat = 'rgba16float' | 'rgba8unorm';

export interface StageRendererOptions {
  /** Force the 8-bit trail buffer (dev switch for the fallback check, acceptance 2d.5). */
  forceTrailFormat?: TrailFormat;
}

/**
 * What the stage host needs from a renderer. Declared here without importing Pixi, so Angular
 * code and fakes can depend on it while `pixi-renderer.ts` stays in a lazy chunk.
 */
export interface StageRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly name: RendererName;
  readonly trailFormat: TrailFormat;
  /** World width for the current stage size. */
  worldWidth(): number;
  /** CSS pixels to world units, against the canvas's current bounding rect. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number };
  /**
   * Starts calling `onFrame(deltaMS)` once per animation frame, after the renderer has checked
   * for a resize and before it draws.
   */
  start(onFrame: (deltaMS: number) => void): void;
  /**
   * Draws the sim into the trail buffer. `persistence` is the motion-blur setting (0..0.92);
   * `reduceFlashing` applies the Reduce flashing visual rules (render/visual-rules.ts).
   */
  render(sim: FireworksSim, persistence: number, reduceFlashing?: boolean): void;
  /** Idempotent. Releases the WebGL context and every texture. */
  destroy(): void;
}

/** Creates a renderer sized to `host`. The canvas is NOT attached; the caller appends it. */
export type StageRendererFactory = (
  host: HTMLElement,
  options?: StageRendererOptions,
) => Promise<StageRenderer>;

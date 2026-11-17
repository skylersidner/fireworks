import type { FireworksSim } from '../sim/simulation';
import type { FlashSpacing } from './visual-rules';

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
  /**
   * Canvas resolution (device pixels per CSS pixel). The host passes the app's rule
   * (`core/browser.ts` `canvasResolution`: 1.5 under a coarse pointer, else 2, never above the
   * device ratio); the engine never calls matchMedia. Absent: the device ratio capped at 2.
   */
  resolution?: number;
  /**
   * Reduce flashing spacing state, owned by the host so it survives a renderer rebuild after a
   * context loss (yoshi-phase7-architecture-rulings.md point 1). Absent: the renderer makes one.
   */
  flashSpacing?: FlashSpacing;
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
   * Starts calling `onFrame(deltaMS, resized)` once per animation frame, after the renderer has
   * checked for a resize. `resized` is true when the size changed this frame: the trail was cleared,
   * so the host must draw. Nothing reaches the screen in a frame without a `render` call (the host
   * renders only when the frame changed, yoshi-end-review-cpu-cost.md Q1).
   */
  start(onFrame: (deltaMS: number, resized: boolean) => void): void;
  /**
   * Draws the sim into the trail buffer and presents the frame. `persistence` is the motion-blur
   * setting (0..0.92); `reduceFlashing` applies the Reduce flashing visual rules
   * (render/visual-rules.ts). A frame with no call keeps the last presented picture.
   */
  render(sim: FireworksSim, persistence: number, reduceFlashing?: boolean): void;
  /**
   * Reports a WebGL context loss and restore of this renderer's canvas (WebGL only; Canvas can't
   * lose one, and Pixi restores WebGPU itself). On `lost` the renderer has already stopped its
   * frames. The listener is dropped before `destroy` runs, so the loss Pixi's own destroy causes
   * is never reported (yoshi-phase7-architecture-rulings.md point 1). One listener; a second call
   * replaces it.
   */
  onContextChange(listener: (state: 'lost' | 'restored') => void): void;
  /** Idempotent. Releases the WebGL context and every texture. */
  destroy(): void;
}

/** Creates a renderer sized to `host`. The canvas is NOT attached; the caller appends it. */
export type StageRendererFactory = (
  host: HTMLElement,
  options?: StageRendererOptions,
) => Promise<StageRenderer>;

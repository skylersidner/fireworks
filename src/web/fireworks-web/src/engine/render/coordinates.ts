import { WORLD_H } from '../sim/constants';

/** CSS pixels per world unit: the stage's CSS height over the 800-unit world height (OQ5). */
export function worldScale(cssHeight: number): number {
  return cssHeight / WORLD_H;
}

/** World width for a stage of the given CSS size. */
export function worldWidthFor(cssWidth: number, cssHeight: number): number {
  return cssWidth / worldScale(cssHeight);
}

/**
 * Pointer position to world units (prototype pointerdown handler). Uses CSS pixels throughout,
 * so the device pixel ratio never enters: `((clientX - left) / scale, (clientY - top) / scale)`.
 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  rect: { readonly left: number; readonly top: number },
  scale: number,
): { x: number; y: number } {
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

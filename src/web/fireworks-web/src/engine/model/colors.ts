/**
 * Named star colors (prototypes/fireworks-prototype.html, `COLORS`). Order matters: `PALETTE` is
 * the key order, and the rainbow color pick indexes it with the shell RNG, so reordering this
 * object changes every rainbow burst.
 */
import { deepFreeze } from './freeze';

export const COLORS = deepFreeze({
  red: 0xff3b30,
  orange: 0xff8a1f,
  gold: 0xffc94a,
  green: 0x3dff6e,
  cyan: 0x4de8ff,
  blue: 0x4a6bff,
  purple: 0xb05cff,
  pink: 0xff5cc8,
  white: 0xffffff,
  silver: 0xcfd8ff,
} as const);

export type PaletteColor = keyof typeof COLORS;

export const PALETTE: readonly PaletteColor[] = Object.freeze(
  Object.keys(COLORS) as PaletteColor[],
);

/** `color1` may also be `rainbow` (a random palette color per star). */
export const RAINBOW = 'rainbow';
/** `color2` may also be `none` (no color change). */
export const NO_COLOR = 'none';

export type Color1 = PaletteColor | typeof RAINBOW;
export type Color2 = PaletteColor | typeof NO_COLOR;

export const COLOR1_OPTIONS: readonly Color1[] = [...PALETTE, RAINBOW];
export const COLOR2_OPTIONS: readonly Color2[] = [NO_COLOR, ...PALETTE];

export function isPaletteColor(value: unknown): value is PaletteColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLORS, value);
}

/** Halfway to white, per channel (the burst flash color). */
export function lighten(c: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const m = (v: number) => Math.min(255, (v + 255) >> 1);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

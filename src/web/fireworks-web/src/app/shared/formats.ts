import { COLORS, RAINBOW, isPaletteColor } from '../../engine/model/colors';
import type { SwatchSpec } from './select-row';

/**
 * Value readouts (prototype `rangeRow` formats, l.606–653) and their screen-reader text
 * (designer-2c.md §3.3–3.5). Pure functions, passed to range-row.
 */
export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const percentText = (v: number) => `${Math.round(v * 100)} percent`;
export const degrees = (v: number) => `${v}°`;
export const degreesText = (v: number) => `${v} degrees`;
export const plain = (v: number) => String(v);
export const fixed2 = (v: number) => v.toFixed(2);
export const seconds1 = (v: number) => `${v.toFixed(1)}s`;
export const seconds1Text = (v: number) => `${v.toFixed(1)} seconds`;
export const seconds2 = (v: number) => `${v.toFixed(2)}s`;
export const delayText = (v: number) => `${v.toFixed(2)} seconds after the previous break`;
export const starsText = (v: number) => `${v} stars`;
export const changeAtText = (v: number) => `${Math.round(v * 100)} percent of burn time`;
/** Wind: `20, blowing left` · `calm` · `20, blowing right` (negative wind pushes left). */
export const windText = (v: number) =>
  v === 0 ? 'calm' : `${Math.abs(v)}, blowing ${v < 0 ? 'left' : 'right'}`;

/** Swatch for a color select value (prototype l.594–599): engine hex, rainbow gradient, or none. */
export function colorSwatch(value: string): SwatchSpec | null {
  if (value === RAINBOW) {
    return {
      background: 'conic-gradient(red, gold, lime, cyan, blue, magenta, red)',
      glow: '#ff5cc8',
    };
  }
  if (!isPaletteColor(value)) return null;
  const hex = `#${COLORS[value].toString(16).padStart(6, '0')}`;
  return { background: hex, glow: hex };
}

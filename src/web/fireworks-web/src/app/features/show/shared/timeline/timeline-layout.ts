import { COLORS, RAINBOW, isPaletteColor } from '../../../../../engine/model/colors';
import type { ShowCue, ShowDocument } from '../../../../../engine/model/show';
import { cueTimes } from '../../../../../engine/sim/lifetime';

/**
 * Timeline geometry (phase-6.md §5.1, §6.2), pure so it's specced without a canvas. The draw and
 * the hit test both read this one layout (§6.1).
 */

/** Zoom ceiling: one 1/120 s step is 1.7 px (§5.1). */
export const MAX_PX_PER_SECOND = 200;
/** Each zoom step (§5.1). */
export const ZOOM_STEP = 1.5;
/** Below this the lane draws compact cues (§6.2). */
export const DETAIL_PX_PER_SECOND = 20;
export const ROW_HEIGHT = 18;
export const RULER_HEIGHT = 22;
/** Hit radius in px (§6.1). */
export const HIT_PX = 6;

/** `0 … max(duration, end)` plus 2% on the right (§5.1). */
export function viewRangeEnd(duration: number, end: number): number {
  return Math.max(1, Math.max(duration, end) * 1.02);
}

export function fitPxPerSecond(width: number, rangeEnd: number): number {
  return Math.max(1e-3, width / rangeEnd);
}

/** The zoom actually used: Fit when null, never below Fit or above 200 px/s. */
export function effectivePxPerSecond(px: number | null, width: number, rangeEnd: number): number {
  const fit = fitPxPerSecond(width, rangeEnd);
  if (px === null) return fit;
  return Math.min(MAX_PX_PER_SECOND, Math.max(fit, px));
}

export function clampScroll(scroll: number, width: number, pps: number, rangeEnd: number): number {
  return Math.max(0, Math.min(scroll, Math.max(0, rangeEnd - width / pps)));
}

/** Ruler tick spacing in seconds: labels at least 60 px apart (§5.1). */
export function tickSeconds(pps: number): number {
  for (const s of [0.5, 1, 5, 10, 30, 60, 120]) if (s * pps >= 60) return s;
  return 300;
}

export interface CueLayout {
  readonly cue: ShowCue;
  /** Launch tick x, px in the lane. */
  readonly xLaunch: number;
  /** Burst dot x (break 1). */
  readonly xBurst: number;
  /** Later breaks' dots. */
  readonly xBreaks: readonly number[];
  readonly row: number;
  /** Break 1's color1, as CSS (or `rainbow`). */
  readonly color: string;
  readonly breakColors: readonly string[];
}

export interface LaneLayout {
  readonly cues: readonly CueLayout[];
  readonly detailed: boolean;
  /** `+k` badges: row-overflow counts at the left of their cluster. */
  readonly badges: readonly { readonly x: number; readonly count: number }[];
}

function cssColor(value: string): string {
  if (value === RAINBOW) return RAINBOW;
  if (!isPaletteColor(value)) return '#ffffff';
  return `#${COLORS[value].toString(16).padStart(6, '0')}`;
}

/**
 * Packs cues greedily in firing order into the first row whose last drawn extent they don't
 * overlap (+4 px). A cue that needs a further row goes in the last row and counts toward its badge.
 */
export function layoutLane(
  show: ShowDocument,
  ordered: readonly ShowCue[],
  pps: number,
  scroll: number,
  rows: number,
  override: { readonly id: string; readonly t: number } | null = null,
): LaneLayout {
  const detailed = pps >= DETAIL_PX_PER_SECOND;
  const rowEnds: number[] = Array.from({ length: Math.max(1, rows) }, () => -Infinity);
  const out: CueLayout[] = [];
  const badges: { x: number; count: number }[] = [];
  let badge: { x: number; count: number; end: number } | null = null;
  const x = (t: number) => (t - scroll) * pps;
  for (const original of ordered) {
    const cue = override && original.id === override.id ? { ...original, t: override.t } : original;
    if (!Object.hasOwn(show.shells, cue.shell)) continue;
    const shell = show.shells[cue.shell];
    const times = cueTimes(cue, shell, show.sky.gravity);
    const xLaunch = x(cue.t);
    const xBurst = x(times.bursts[0]);
    const xBreaks = times.bursts.slice(1).map(x);
    const start = detailed ? xLaunch : xBurst - 3;
    const end = (detailed ? (xBreaks.at(-1) ?? xBurst) + 4 : xBurst + 3) + 4;
    let row = rowEnds.findIndex((e) => e < start);
    if (row < 0) {
      row = rowEnds.length - 1;
      if (badge && start <= badge.end) {
        badge.count++;
        badge.end = Math.max(badge.end, end);
      } else {
        badge = { x: start, count: 1, end };
        badges.push(badge);
      }
    }
    rowEnds[row] = Math.max(rowEnds[row], end);
    out.push({
      cue,
      xLaunch,
      xBurst,
      xBreaks,
      row,
      color: cssColor(shell.breaks[0]?.color1 ?? 'white'),
      breakColors: shell.breaks.slice(1).map((b) => cssColor(b.color1)),
    });
  }
  return { cues: out, detailed, badges: badges.map(({ x: bx, count }) => ({ x: bx, count })) };
}

/** The nearest cue within `HIT_PX` of (px, row), the selected one first (§6.1). */
export function hitTest(
  layout: LaneLayout,
  px: number,
  py: number,
  selectedId: string | null,
): ShowCue | null {
  const row = Math.floor(py / ROW_HEIGHT);
  let best: { cue: ShowCue; d: number; selected: boolean; order: number } | null = null;
  layout.cues.forEach((c, order) => {
    if (c.row !== row) return;
    const points = layout.detailed ? [c.xLaunch, c.xBurst, ...c.xBreaks] : [c.xBurst];
    let d = Math.min(...points.map((p) => Math.abs(p - px)));
    if (layout.detailed && px > c.xLaunch && px < c.xBurst) d = 0;
    if (d > HIT_PX) return;
    const selected = c.cue.id === selectedId;
    if (
      !best ||
      (selected && !best.selected) ||
      (selected === best.selected && (d < best.d || (d === best.d && order > best.order)))
    ) {
      best = { cue: c.cue, d, selected, order };
    }
  });
  return (best as { cue: ShowCue } | null)?.cue ?? null;
}

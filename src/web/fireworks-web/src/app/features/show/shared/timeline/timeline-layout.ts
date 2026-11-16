import { COLORS, RAINBOW, isPaletteColor } from '../../../../../engine/model/colors';
import { embeddedShell, type ShowCue, type ShowDocument } from '../../../../../engine/model/show';
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
/** Hit radius in px for mouse and pen (§6.1). */
export const HIT_PX = 6;
/** Hit radius for a finger (phase-7.md §5.2 item 9). */
export const TOUCH_HIT_PX = 12;
/** The `+k` badge text: 11px type, drawn at `laneH - BADGE_BASELINE` (phase-7.md §7.2). */
export const BADGE_FONT_PX = 11;
export const BADGE_BASELINE = 3;
/** The badge hit box: the text bounds plus 4 px each side, at least this many CSS px square. */
export const BADGE_MIN_HIT = 24;
/** The lane-foot label box (the end label's fallback, §8): 14 px tall, 2 px off the foot. */
export const FOOT_LABEL_H = 14;

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

/** An axis-aligned box in CSS px, `x0 <= x1`, `y0 <= y1`. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function intersects(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** A `+k` badge (phase-6.md §6.2; phase-7.md §7.2). */
export interface LaneBadge {
  /** Text x, px in the lane. */
  readonly x: number;
  /** Cues in the cluster that didn't get a row of their own. */
  readonly count: number;
  /** The cluster's span in seconds: the earliest launch and the latest drawn extent. */
  readonly t0: number;
  readonly t1: number;
  /** The first hidden cue in firing order. */
  readonly firstHiddenId: string;
  /** The hit box (it wins over cue hits inside it). */
  readonly box: Box;
}

export interface LaneLayout {
  readonly cues: readonly CueLayout[];
  readonly detailed: boolean;
  /** `+k` badges: row-overflow counts at the left of their cluster. */
  readonly badges: readonly LaneBadge[];
}

/** Text width estimate for `+k` at 11 px (digits and `+` are about 0.62 em in system-ui). */
export function badgeTextWidth(count: number): number {
  return Math.ceil(`+${count}`.length * BADGE_FONT_PX * 0.62);
}

/** The badge's hit box: text bounds + 4 px, centered, at least 24x24. */
export function badgeBox(x: number, count: number, laneHeight: number): Box {
  const baseline = laneHeight - BADGE_BASELINE;
  const tw = badgeTextWidth(count);
  const text = { x0: x, y0: baseline - BADGE_FONT_PX, x1: x + tw, y1: baseline };
  const cx = (text.x0 + text.x1) / 2;
  const cy = (text.y0 + text.y1) / 2;
  const hw = Math.max(BADGE_MIN_HIT, text.x1 - text.x0 + 8) / 2;
  const hh = Math.max(BADGE_MIN_HIT, text.y1 - text.y0 + 8) / 2;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
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
  laneHeight: number = Math.max(1, rows) * ROW_HEIGHT,
): LaneLayout {
  const detailed = pps >= DETAIL_PX_PER_SECOND;
  const rowEnds: number[] = Array.from({ length: Math.max(1, rows) }, () => -Infinity);
  const out: CueLayout[] = [];
  interface Cluster {
    x: number;
    count: number;
    end: number;
    t0: number;
    t1: number;
    firstHiddenId: string;
  }
  const badges: Cluster[] = [];
  let badge: Cluster | null = null;
  const x = (t: number) => (t - scroll) * pps;
  for (const original of ordered) {
    const cue = override && original.id === override.id ? { ...original, t: override.t } : original;
    const shell = embeddedShell(show, cue.shell);
    if (!shell) continue;
    const times = cueTimes(cue, shell, show.sky.gravity);
    const xLaunch = x(cue.t);
    const xBurst = x(times.bursts[0]);
    const xBreaks = times.bursts.slice(1).map(x);
    const start = detailed ? xLaunch : xBurst - 3;
    const end = (detailed ? (xBreaks.at(-1) ?? xBurst) + 4 : xBurst + 3) + 4;
    let row = rowEnds.findIndex((e) => e < start);
    if (row < 0) {
      row = rowEnds.length - 1;
      const t1 = times.bursts.at(-1) ?? cue.t;
      if (badge && start <= badge.end) {
        badge.count++;
        badge.end = Math.max(badge.end, end);
        badge.t0 = Math.min(badge.t0, cue.t);
        badge.t1 = Math.max(badge.t1, t1);
      } else {
        badge = { x: start, count: 1, end, t0: cue.t, t1, firstHiddenId: cue.id };
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
  return {
    cues: out,
    detailed,
    badges: badges.map(({ x: bx, count, t0, t1, firstHiddenId }) => ({
      x: bx,
      count,
      t0,
      t1,
      firstHiddenId,
      box: badgeBox(bx, count, laneHeight),
    })),
  };
}

/** The badge whose hit box holds (px, py), or null. Badges win over cues (phase-7.md §7.2). */
export function badgeAt(layout: LaneLayout, px: number, py: number): LaneBadge | null {
  return (
    layout.badges.find(
      (b) => px >= b.box.x0 && px <= b.box.x1 && py >= b.box.y0 && py <= b.box.y1,
    ) ?? null
  );
}

/**
 * The nearest cue within `radius` of (px, row), the selected one first (§6.1). The radius is
 * `HIT_PX` for mouse and pen and `TOUCH_HIT_PX` for a finger (phase-7.md §5.2).
 */
export function hitTest(
  layout: LaneLayout,
  px: number,
  py: number,
  selectedId: string | null,
  radius: number = HIT_PX,
): ShowCue | null {
  const row = Math.floor(py / ROW_HEIGHT);
  let best: { cue: ShowCue; d: number; selected: boolean; order: number } | null = null;
  layout.cues.forEach((c, order) => {
    if (c.row !== row) return;
    const points = layout.detailed ? [c.xLaunch, c.xBurst, ...c.xBreaks] : [c.xBurst];
    let d = Math.min(...points.map((p) => Math.abs(p - px)));
    if (layout.detailed && px > c.xLaunch && px < c.xBurst) d = 0;
    if (d > radius) return;
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

/** Where the end label went (phase-7.md §8, R8): steps 1–4 in order, or 5 (not drawn). */
export interface LabelPlacement {
  readonly step: 1 | 2 | 3 | 4 | 5;
  /** `ruler` or `lane` coordinates; null at step 5. */
  readonly box: Box | null;
}

export interface LabelPlacementInput {
  /** Lane (and ruler) width. */
  readonly width: number;
  /** Lane height (the foot is at `laneHeight`). */
  readonly laneHeight: number;
  /** The end line's x. */
  readonly xEnd: number;
  /** The label's box width (text + 8). */
  readonly labelWidth: number;
  /** The window label's box in the ruler. */
  readonly windowBox: Box;
  /** Every badge hit box in the lane. */
  readonly badges: readonly Box[];
  /** The `Tail` / `Nothing launches here` pad in the lane. */
  readonly pad: Box;
}

/** The ruler label box (rulerLabel: 14 px tall, 1 px from the top). */
export const RULER_LABEL_TOP = 1;
export const RULER_LABEL_H = 14;

/**
 * The end label's place (phase-7.md §8): ruler right of the end line, ruler left, lane foot right,
 * lane foot left, else not drawn. Fits means inside `0 … width` and clear of the window label (in
 * the ruler) or of every badge and the pad (in the lane). Badges always win.
 */
export function labelPlacement(input: LabelPlacementInput): LabelPlacement {
  const { width: w, laneHeight: h, xEnd: xe, labelWidth: ew } = input;
  const inside = (b: Box) => b.x0 >= 0 && b.x1 <= w;
  const ruler = (x: number): Box => ({
    x0: x,
    y0: RULER_LABEL_TOP,
    x1: x + ew,
    y1: RULER_LABEL_TOP + RULER_LABEL_H,
  });
  const foot = (x: number): Box => ({ x0: x, y0: h - FOOT_LABEL_H - 2, x1: x + ew, y1: h - 2 });
  const rulerFits = (b: Box) => inside(b) && !intersects(b, input.windowBox);
  const laneFits = (b: Box) =>
    inside(b) && !intersects(b, input.pad) && input.badges.every((badge) => !intersects(b, badge));
  const tries: [LabelPlacement['step'], Box, (b: Box) => boolean][] = [
    [1, ruler(xe), rulerFits],
    [2, ruler(xe - ew), rulerFits],
    [3, foot(xe), laneFits],
    [4, foot(xe - ew), laneFits],
  ];
  for (const [step, box, fits] of tries) if (fits(box)) return { step, box };
  return { step: 5, box: null };
}

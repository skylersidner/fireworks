import { COLOR1_OPTIONS, COLOR2_OPTIONS, type Color1, type Color2 } from './colors';
import { EFFECTS, PATTERNS, TRAILS, type Effect, type Pattern, type Trail } from './enums';

/**
 * Display copy for schema values and fields (designer-2c.md D5, §3). Option VALUES stay the
 * lowercase schema values; only what people read changes. Kept here, next to enums.ts and
 * colors.ts, so no template re-types a label. Framework-free.
 */
export interface Option<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

export const PATTERN_LABELS: Readonly<Record<Pattern, string>> = {
  peony: 'Peony',
  ring: 'Ring',
  palm: 'Palm',
  heart: 'Heart',
};

export const TRAIL_LABELS: Readonly<Record<Trail, string>> = {
  none: 'None',
  tail: 'Tail',
  glitter: 'Glitter',
};

export const EFFECT_LABELS: Readonly<Record<Effect, string>> = {
  none: 'None',
  crackle: 'Crackle',
  crossette: 'Crossette',
  strobe: 'Strobe',
};

export const COLOR_LABELS: Readonly<Record<Color1 | Color2, string>> = {
  red: 'Red',
  orange: 'Orange',
  gold: 'Gold',
  green: 'Green',
  cyan: 'Cyan',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  white: 'White',
  silver: 'Silver',
  rainbow: 'Rainbow',
  none: 'No change',
};

function options<T extends string>(values: readonly T[], labels: Record<T, string>): Option<T>[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export const PATTERN_OPTIONS: readonly Option<Pattern>[] = options(PATTERNS, PATTERN_LABELS);
export const TRAIL_OPTIONS: readonly Option<Trail>[] = options(TRAILS, TRAIL_LABELS);
export const EFFECT_OPTIONS: readonly Option<Effect>[] = options(EFFECTS, EFFECT_LABELS);
export const COLOR1_SELECT_OPTIONS: readonly Option<Color1>[] = options(
  COLOR1_OPTIONS,
  COLOR_LABELS,
);
export const COLOR2_SELECT_OPTIONS: readonly Option<Color2>[] = options(
  COLOR2_OPTIONS,
  COLOR_LABELS,
);

/** Row labels by schema key (designer-2c.md §3.3–3.5). */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  version: 'Version',
  name: 'Name',
  burstHeight: 'Burst height',
  angleJitter: 'Angle jitter',
  sky: 'Sky',
  gravity: 'Gravity',
  wind: 'Wind',
  breaks: 'Breaks',
  pattern: 'Pattern',
  stars: 'Stars',
  speed: 'Burst speed',
  color1: 'Color',
  color2: 'Changes to',
  changeAt: 'Change at',
  burn: 'Burn time',
  drag: 'Air drag',
  size: 'Star size',
  trail: 'Trail',
  effect: 'Effect',
  delay: 'Delay',
};

/** Labels for any value an enum field can hold, keyed by field. */
const VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pattern: PATTERN_LABELS,
  trail: TRAIL_LABELS,
  effect: EFFECT_LABELS,
  color1: COLOR_LABELS,
  color2: COLOR_LABELS,
};

/**
 * A normalize path in field-label language: `breaks[1].stars` → `Stars (Break 2)`,
 * `sky.wind` → `Wind`, `burstHeight` → `Burst height`.
 */
export function fieldLabel(path: string): string {
  const m = /^breaks\[(\d+)\](?:\.(\w+))?$/.exec(path);
  if (m) {
    const n = Number(m[1]) + 1;
    return m[2] ? `${FIELD_LABELS[m[2]] ?? m[2]} (Break ${n})` : `Break ${n}`;
  }
  const leaf = path.split('.').pop() ?? path;
  return FIELD_LABELS[leaf] ?? path;
}

/** The display label for an enum value of the field at `path`, or the raw value. */
export function valueLabel(path: string, value: string): string {
  const leaf = path.split('.').pop() ?? path;
  return VALUE_LABELS[leaf]?.[value] ?? value;
}

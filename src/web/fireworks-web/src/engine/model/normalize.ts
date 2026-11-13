import { COLOR1_OPTIONS, COLOR2_OPTIONS, type Color1, type Color2 } from './colors';
import { EFFECTS, PATTERNS, TRAILS } from './enums';
import {
  BREAK_LIMITS,
  MAX_BREAKS,
  MIN_BREAKS,
  NAME_MAX_LENGTH,
  QUALITY_LIMITS,
  SHELL_LIMITS,
  SKY_LIMITS,
  type NumericRange,
} from './limits';
import {
  DEFAULT_BREAK,
  DEFAULT_QUALITY,
  DEFAULT_SHELL,
  DEFAULT_SKY,
  FALLBACK_NAME,
  SHELL_VERSION,
  type BreakDef,
  type QualitySettings,
  type ShellDocument,
  type SkySettings,
} from './shell';

export { FALLBACK_NAME } from './shell';

/**
 * What `normalizeShell` did to a value to make it fit (yoshi-phase2a-engine-boundaries.md §4):
 *  - `defaulted`: missing or `null` (or a blank name), so it took its default;
 *  - `clamped`:   a number outside its range, moved to the nearest limit;
 *  - `rounded`:   an integer field (`stars`) given a fraction, within range;
 *  - `truncated`: a name longer than 80 code points, cut to 80;
 *  - `dropped`:   a key the ShellDocument doesn't have, removed.
 * An absent `sky` is not an adjustment: absent stays absent (§6).
 */
export type AdjustmentKind = 'defaulted' | 'clamped' | 'rounded' | 'truncated' | 'dropped';

export interface ShellAdjustment {
  /** Shipped path form: `version`, `name`, `sky.wind`, `breaks[1].color1`. */
  readonly path: string;
  readonly kind: AdjustmentKind;
  readonly from?: unknown;
  readonly to?: unknown;
}

/** Which rule a rejected value broke. Lets a caller phrase it in its own words. */
export type ShellIssueCode = 'not-object' | 'version' | 'type' | 'enum' | 'break-count';

export interface ShellIssue {
  readonly path: string;
  /** Developer-facing message (paths, raw values). UIs build their own copy from `code`. */
  readonly message: string;
  readonly code: ShellIssueCode;
  /** The rejected value (`enum`, `version`), or the break count (`break-count`; null if not an array). */
  readonly value?: unknown;
  /** The allowed values (`enum`), or the expected type name (`type`). */
  readonly options?: readonly string[];
}

export type NormalizeResult =
  | {
      readonly ok: true;
      readonly shell: ShellDocument;
      readonly adjustments: readonly ShellAdjustment[];
    }
  | { readonly ok: false; readonly errors: readonly ShellIssue[] };

const SHELL_KEYS = ['version', 'name', 'burstHeight', 'angleJitter', 'sky', 'breaks'];
const SKY_KEYS = ['gravity', 'wind'];
const BREAK_KEYS = Object.keys(DEFAULT_BREAK);

interface Report {
  readonly errors: ShellIssue[];
  readonly adjustments: ShellAdjustment[];
}

/**
 * Turns untrusted input (pasted JSON, a localStorage draft, an API document) into a valid
 * ShellDocument v1, and reports every change it made (`adjustments`):
 *  - a missing or `null` field takes its default (one null rule, Yoshi L4: null is absent);
 *  - a number outside its range is clamped (and `stars` rounded);
 *  - a name longer than 80 code points is cut to 80; a missing or blank name becomes `Custom`;
 *  - unknown keys are dropped;
 *  - an unknown enum value, a non-number where a number belongs, an unsupported `version`, or a
 *    `breaks` array outside 1..4 is rejected, with every problem listed.
 *
 * Phase 3's strict validator is this plus "zero adjustments" (§5). Idempotent, every preset
 * round-trips unchanged with no adjustments, and it never mutates its input.
 */
export function normalizeShell(input: unknown): NormalizeResult {
  const report: Report = { errors: [], adjustments: [] };
  if (!isRecord(input)) {
    fail(report, '', 'not-object', 'The shell must be a JSON object.');
    return { ok: false, errors: report.errors };
  }
  dropUnknown(input, SHELL_KEYS, '', report);

  const version = input['version'];
  if (isAbsent(version)) {
    report.adjustments.push({
      path: 'version',
      kind: 'defaulted',
      from: version,
      to: SHELL_VERSION,
    });
  } else if (version !== SHELL_VERSION) {
    fail(
      report,
      'version',
      'version',
      `version: unsupported version ${JSON.stringify(version)} (expected 1).`,
      { value: version },
    );
  }

  const name = normalizeName(input['name'], report);
  const burstHeight = num(
    input['burstHeight'],
    SHELL_LIMITS.burstHeight,
    DEFAULT_SHELL.burstHeight,
    'burstHeight',
    report,
  );
  const angleJitter = num(
    input['angleJitter'],
    SHELL_LIMITS.angleJitter,
    DEFAULT_SHELL.angleJitter,
    'angleJitter',
    report,
  );

  let sky: SkySettings | undefined;
  const rawSky = input['sky'];
  if (rawSky === null) {
    // Null is absent (L4), and an absent sky stays absent (§6): nothing to fill in.
    report.adjustments.push({ path: 'sky', kind: 'defaulted', from: null });
  } else if (rawSky !== undefined) {
    if (isRecord(rawSky)) {
      dropUnknown(rawSky, SKY_KEYS, 'sky', report);
      sky = readSky(rawSky, 'sky', report);
    } else {
      fail(report, 'sky', 'not-object', 'sky: must be an object.');
    }
  }

  const breaks: BreakDef[] = [];
  const rawBreaks = input['breaks'];
  if (!Array.isArray(rawBreaks) || rawBreaks.length < MIN_BREAKS) {
    fail(report, 'breaks', 'break-count', 'breaks: needs a non-empty array.', {
      value: Array.isArray(rawBreaks) ? rawBreaks.length : null,
    });
  } else if (rawBreaks.length > MAX_BREAKS) {
    fail(
      report,
      'breaks',
      'break-count',
      `breaks: at most ${MAX_BREAKS} breaks (got ${rawBreaks.length}).`,
      { value: rawBreaks.length },
    );
  } else {
    rawBreaks.forEach((raw, k) => {
      const path = `breaks[${k}]`;
      if (isRecord(raw)) {
        dropUnknown(raw, BREAK_KEYS, path, report);
        breaks.push(readBreak(raw, path, report));
      } else {
        fail(report, path, 'not-object', `${path}: must be an object.`);
      }
    });
  }

  if (report.errors.length) {
    return { ok: false, errors: report.errors };
  }
  const shell: ShellDocument = { version: SHELL_VERSION, name, burstHeight, angleJitter, breaks };
  if (sky) {
    shell.sky = sky;
  }
  return { ok: true, shell, adjustments: report.adjustments };
}

/** Clamps sky values and fills defaults. Never fails: bad values fall back to defaults. */
export function normalizeSky(input: Partial<SkySettings> | null | undefined): SkySettings {
  return readSky(isRecord(input) ? input : {}, 'sky', null);
}

/** Clamps quality values and fills defaults. Never fails: bad values fall back to defaults. */
export function normalizeQuality(
  input: Partial<QualitySettings> | null | undefined,
): QualitySettings {
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  return {
    persistence: num(
      src['persistence'],
      QUALITY_LIMITS.persistence,
      DEFAULT_QUALITY.persistence,
      '',
      null,
    ),
    starBudget: num(
      src['starBudget'],
      QUALITY_LIMITS.starBudget,
      DEFAULT_QUALITY.starBudget,
      '',
      null,
    ),
    reduceFlashing:
      typeof src['reduceFlashing'] === 'boolean'
        ? src['reduceFlashing']
        : DEFAULT_QUALITY.reduceFlashing,
  };
}

export function clampToRange(value: number, range: NumericRange): number {
  const v = range.integer ? Math.round(value) : value;
  return Math.min(range.max, Math.max(range.min, v));
}

function readSky(src: Record<string, unknown>, path: string, report: Report | null): SkySettings {
  return {
    gravity: num(
      src['gravity'],
      SKY_LIMITS.gravity,
      DEFAULT_SKY.gravity,
      `${path}.gravity`,
      report,
    ),
    wind: num(src['wind'], SKY_LIMITS.wind, DEFAULT_SKY.wind, `${path}.wind`, report),
  };
}

function readBreak(src: Record<string, unknown>, path: string, report: Report): BreakDef {
  const d = DEFAULT_BREAK;
  const L = BREAK_LIMITS;
  return {
    pattern: oneOf(src['pattern'], PATTERNS, d.pattern, `${path}.pattern`, report),
    stars: num(src['stars'], L.stars, d.stars, `${path}.stars`, report),
    speed: num(src['speed'], L.speed, d.speed, `${path}.speed`, report),
    color1: oneOf<Color1>(src['color1'], COLOR1_OPTIONS, d.color1, `${path}.color1`, report),
    color2: oneOf<Color2>(src['color2'], COLOR2_OPTIONS, d.color2, `${path}.color2`, report),
    changeAt: num(src['changeAt'], L.changeAt, d.changeAt, `${path}.changeAt`, report),
    burn: num(src['burn'], L.burn, d.burn, `${path}.burn`, report),
    drag: num(src['drag'], L.drag, d.drag, `${path}.drag`, report),
    size: num(src['size'], L.size, d.size, `${path}.size`, report),
    trail: oneOf(src['trail'], TRAILS, d.trail, `${path}.trail`, report),
    effect: oneOf(src['effect'], EFFECTS, d.effect, `${path}.effect`, report),
    delay: num(src['delay'], L.delay, d.delay, `${path}.delay`, report),
  };
}

function normalizeName(value: unknown, report: Report): string {
  if (isAbsent(value)) {
    report.adjustments.push({ path: 'name', kind: 'defaulted', from: value, to: FALLBACK_NAME });
    return FALLBACK_NAME;
  }
  if (typeof value !== 'string') {
    fail(report, 'name', 'type', 'name: must be a string.', { options: ['string'] });
    return FALLBACK_NAME;
  }
  if (!value.trim()) {
    report.adjustments.push({ path: 'name', kind: 'defaulted', from: value, to: FALLBACK_NAME });
    return FALLBACK_NAME;
  }
  // Cut by code point so a surrogate pair is never split.
  const chars = Array.from(value);
  if (chars.length <= NAME_MAX_LENGTH) {
    return value;
  }
  const cut = chars.slice(0, NAME_MAX_LENGTH).join('');
  report.adjustments.push({ path: 'name', kind: 'truncated', from: value, to: cut });
  return cut;
}

/**
 * A missing or null value takes the default; a finite number is clamped (or rounded); anything
 * else is an error. With `report` null (sky/quality helpers), nothing is recorded.
 */
function num(
  value: unknown,
  range: NumericRange,
  fallback: number,
  path: string,
  report: Report | null,
): number {
  if (isAbsent(value)) {
    report?.adjustments.push({ path, kind: 'defaulted', from: value, to: fallback });
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (report) fail(report, path, 'type', `${path}: must be a number.`, { options: ['number'] });
    return fallback;
  }
  const result = clampToRange(value, range);
  if (result !== value && report) {
    const inRange = value >= range.min && value <= range.max;
    report.adjustments.push({
      path,
      kind: inRange ? 'rounded' : 'clamped',
      from: value,
      to: result,
    });
  }
  return result;
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
  path: string,
  report: Report,
): T {
  if (isAbsent(value)) {
    report.adjustments.push({ path, kind: 'defaulted', from: value, to: fallback });
    return fallback;
  }
  if (typeof value === 'string' && (options as readonly string[]).includes(value)) {
    return value as T;
  }
  fail(
    report,
    path,
    'enum',
    `${path}: unknown value ${JSON.stringify(value)} (expected one of ${options.join(', ')}).`,
    { value, options },
  );
  return fallback;
}

function dropUnknown(
  src: Record<string, unknown>,
  known: readonly string[],
  path: string,
  report: Report,
): void {
  for (const key of Object.keys(src)) {
    if (!known.includes(key)) {
      report.adjustments.push({
        path: path ? `${path}.${key}` : key,
        kind: 'dropped',
        from: src[key],
      });
    }
  }
}

function fail(
  report: Report,
  path: string,
  code: ShellIssueCode,
  message: string,
  extra: { value?: unknown; options?: readonly string[] } = {},
): void {
  report.errors.push({ path, message, code, ...extra });
}

/** The one null rule (Yoshi L4): `null` is treated exactly like a missing key. */
function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { COLOR1_OPTIONS, COLOR2_OPTIONS, type Color1, type Color2 } from './colors';
import { EFFECTS, PATTERNS, TRAILS } from './enums';
import {
  BREAK_LIMITS,
  CUE_LIMITS,
  KEY_PATTERN,
  MAX_BREAKS,
  MAX_SHOW_CUES,
  MAX_SHOW_SHELLS,
  MIN_BREAKS,
  MIN_SHOW_CUES,
  NAME_MAX_LENGTH,
  QUALITY_LIMITS,
  SHELL_LIMITS,
  SHOW_LIMITS,
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
import { SHOW_VERSION, type EmbeddedShell, type ShowCue, type ShowDocument } from './show';

export { FALLBACK_NAME } from './shell';

/**
 * What a lenient walk did to a value to make it fit (schema.md §6.3). Each kind maps to one strict
 * code (`validate.ts` `STRICT_CODE`):
 *  - `defaulted`: missing or `null` (or a blank name), so it took its default (strict `missing`);
 *  - `clamped`:   a number outside its range, moved to the nearest limit (`out-of-range`);
 *  - `rounded`:   an integer field (`stars`) given a fraction, within range (`not-integer`);
 *  - `truncated`: a name longer than 80 code points, cut to 80 (`too-long`);
 *  - `dropped`:   a key the document doesn't have, removed (`unknown-property`);
 *  - `cleaned`:   a name with control characters or unpaired surrogates removed, or edge
 *                 whitespace trimmed (`name-format`).
 * An absent shell `sky` is not an adjustment: absent stays absent (§3).
 */
export type AdjustmentKind =
  'defaulted' | 'clamped' | 'rounded' | 'truncated' | 'dropped' | 'cleaned';

export interface ShellAdjustment {
  /** Shipped path form: `version`, `name`, `sky.wind`, `breaks[1].color1`, `shells.s1.name`. */
  readonly path: string;
  readonly kind: AdjustmentKind;
  readonly from?: unknown;
  readonly to?: unknown;
}

/**
 * Which rule a value broke (schema.md §6.3). The first group are hard errors in both modes; the
 * second are what strict mode reports for an adjustment (and `missing`, `not-integer`,
 * `out-of-range` are also hard errors for show fields that have no default, such as cue fields).
 * `not-json` and `duplicate-key` are server-only and never produced here.
 */
export type IssueCode =
  | 'not-object'
  | 'type'
  | 'enum'
  | 'version'
  | 'break-count'
  | 'shell-count'
  | 'cue-count'
  | 'key-format'
  | 'duplicate-id'
  | 'unknown-shell'
  | 'missing'
  | 'out-of-range'
  | 'not-integer'
  | 'too-long'
  | 'unknown-property'
  | 'name-format';

/** @deprecated Phase 2 name; use `IssueCode`. */
export type ShellIssueCode = IssueCode;

export interface ShellIssue {
  readonly path: string;
  /** Developer-facing message (paths, raw values). UIs build their own copy from `code`. */
  readonly message: string;
  readonly code: IssueCode;
  /**
   * The rejected value (`enum`, `version`, `key-format`), or the count (`break-count`,
   * `shell-count`, `cue-count`; null when not an array/object).
   */
  readonly value?: unknown;
  /** The allowed values (`enum`), or the expected type name (`type`). */
  readonly options?: readonly string[];
}

export type SchemaIssue = ShellIssue;
export type SchemaAdjustment = ShellAdjustment;

/**
 * The walk always returns both lists (schema.md §6.1): strict mode reports their union, so a
 * document with an error and an adjustment (fixture `mixed.json`) reports both.
 */
export type NormalizeResult =
  | {
      readonly ok: true;
      readonly shell: ShellDocument;
      readonly adjustments: readonly ShellAdjustment[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly ShellIssue[];
      readonly adjustments: readonly ShellAdjustment[];
    };

export type ShowNormalizeResult =
  | {
      readonly ok: true;
      readonly show: ShowDocument;
      readonly adjustments: readonly ShellAdjustment[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly ShellIssue[];
      readonly adjustments: readonly ShellAdjustment[];
    };

const SHELL_KEYS = ['version', 'name', 'burstHeight', 'angleJitter', 'sky', 'breaks'];
/** An embedded shell has no `sky` (§4.1): a `sky` there is dropped like any unknown key. */
const EMBEDDED_SHELL_KEYS = SHELL_KEYS.filter((k) => k !== 'sky');
const SKY_KEYS = ['gravity', 'wind'];
const BREAK_KEYS = Object.keys(DEFAULT_BREAK);
const SHOW_KEYS = ['version', 'name', 'sky', 'duration', 'shells', 'cues'];
const CUE_KEYS = ['id', 't', 'shell', 'x', 'burstHeight', 'seed'];

/** A field with no default: absent or `null` is a hard `missing` error (show fields, §6.3). */
const REQUIRED = Symbol('required');

interface Report {
  readonly errors: ShellIssue[];
  readonly adjustments: ShellAdjustment[];
}

/**
 * Turns untrusted input (pasted JSON, a localStorage draft, an API document) into a valid
 * ShellDocument v1, and reports every change it made (`adjustments`):
 *  - a missing or `null` field takes its default (one null rule, Yoshi L4: null is absent);
 *  - a number outside its range is clamped (and `stars` rounded);
 *  - a name is cleaned and trimmed, cut to 80 code points, and becomes `Custom` when blank (§6.4);
 *  - unknown keys are dropped;
 *  - an unknown enum value, a non-number where a number belongs, an unsupported `version`, or a
 *    `breaks` array outside 1..4 is rejected, with every problem listed.
 *
 * Errors and adjustments are both returned either way. `validateShell` is this plus "zero
 * adjustments" (§6.1). Idempotent, every preset round-trips unchanged with no adjustments, and it
 * never mutates its input.
 */
export function normalizeShell(input: unknown): NormalizeResult {
  const report: Report = { errors: [], adjustments: [] };
  const shell = walkShell(input, '', report, SHELL_KEYS);
  if (report.errors.length || !shell) {
    return { ok: false, errors: report.errors, adjustments: report.adjustments };
  }
  return { ok: true, shell, adjustments: report.adjustments };
}

/**
 * ShowDocument v1, lenient (schema.md §4, §6.2). Only `version` and `name` take defaults; every
 * other missing show or cue field is a hard `missing` error, and a cue `seed` is never rounded or
 * clamped. Embedded shells are walked by the shell walker (with its defaults) under
 * `shells.<key>.`, and a `sky` in one is dropped. The `shells` map has no prototype.
 */
export function normalizeShow(input: unknown): ShowNormalizeResult {
  const report: Report = { errors: [], adjustments: [] };
  const fail = (): ShowNormalizeResult => ({
    ok: false,
    errors: report.errors,
    adjustments: report.adjustments,
  });
  if (!isRecord(input)) {
    issue(report, '', 'not-object', 'The show must be a JSON object.');
    return fail();
  }
  dropUnknown(input, SHOW_KEYS, '', report);
  readVersion(input['version'], SHOW_VERSION, 'version', report);
  const name = normalizeName(input['name'], 'name', report);

  let sky: SkySettings = { ...DEFAULT_SKY };
  const rawSky = input['sky'];
  if (isAbsent(rawSky)) {
    issue(report, 'sky', 'missing', 'sky: required in a show.');
  } else if (isRecord(rawSky)) {
    dropUnknown(rawSky, SKY_KEYS, 'sky', report);
    sky = readSky(rawSky, 'sky', report, true);
  } else {
    issue(report, 'sky', 'not-object', 'sky: must be an object.');
  }

  const rawDuration = input['duration'];
  const duration = num(rawDuration, SHOW_LIMITS.duration, REQUIRED, 'duration', report);
  // §6.2.8: `t`'s upper bound is `duration` only when `duration` itself is valid.
  const tMax = inRange(rawDuration, SHOW_LIMITS.duration) ? rawDuration : CUE_LIMITS.t.max;

  const shells: Record<string, EmbeddedShell> = Object.create(null);
  /** The well-formed keys of a walked `shells`; null when `shells` wasn't walked. */
  let shellKeys: Set<string> | null = null;
  const rawShells = input['shells'];
  if (isAbsent(rawShells)) {
    issue(report, 'shells', 'missing', 'shells: required in a show.');
  } else if (!isRecord(rawShells)) {
    issue(report, 'shells', 'not-object', 'shells: must be an object.');
  } else {
    const keys = Object.keys(rawShells);
    if (keys.length > MAX_SHOW_SHELLS) {
      issue(
        report,
        'shells',
        'shell-count',
        `shells: at most ${MAX_SHOW_SHELLS} shells (got ${keys.length}).`,
        { value: keys.length },
      );
    } else {
      shellKeys = new Set();
      for (const key of keys) {
        if (!KEY_PATTERN.test(key)) {
          issue(report, 'shells', 'key-format', `shells: bad key ${JSON.stringify(key)}.`, {
            value: key,
          });
          continue;
        }
        shellKeys.add(key);
        const shell = walkShell(
          rawShells[key],
          childPath('shells', key),
          report,
          EMBEDDED_SHELL_KEYS,
        );
        if (shell) shells[key] = shell;
      }
    }
  }

  const cues: ShowCue[] = [];
  const rawCues = input['cues'];
  if (!Array.isArray(rawCues) || rawCues.length < MIN_SHOW_CUES || rawCues.length > MAX_SHOW_CUES) {
    issue(
      report,
      'cues',
      'cue-count',
      `cues: needs an array of ${MIN_SHOW_CUES} to ${MAX_SHOW_CUES} cues.`,
      { value: Array.isArray(rawCues) ? rawCues.length : null },
    );
  } else {
    const seenIds = new Set<string>();
    rawCues.forEach((raw, k) => {
      const cue = readCue(raw, `cues[${k}]`, report, { tMax, shellKeys, seenIds });
      if (cue) cues.push(cue);
    });
  }

  if (report.errors.length) return fail();
  return {
    ok: true,
    show: { version: SHOW_VERSION, name, sky, duration, shells, cues },
    adjustments: report.adjustments,
  };
}

/** Clamps sky values and fills defaults. Never fails: bad values fall back to defaults. */
export function normalizeSky(input: Partial<SkySettings> | null | undefined): SkySettings {
  return readSky(isRecord(input) ? input : {}, 'sky', null, false);
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

/**
 * Code points U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F,
 * U+205F, U+3000 and U+FEFF: exactly JS `String.prototype.trim`'s set, written out so the C# side
 * can copy it (`string.Trim()` misses U+FEFF and adds U+0085; schema.md §6.4).
 */
const TRIM_SET =
  '[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]';
const NAME_TRIM_EDGES = new RegExp(`^${TRIM_SET}+|${TRIM_SET}+$`, 'g');

/**
 * schema.md §6.4 step 2: removes every Cc code point (U+0000–U+001F, U+007F–U+009F) and every
 * unpaired surrogate, then trims the explicit edge set. Interior whitespace is kept.
 */
export function cleanName(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) continue;
    out += value[i];
  }
  return out.replace(NAME_TRIM_EDGES, '');
}

/**
 * The shell walk, shared by `normalizeShell` (root, `prefix` "") and `normalizeShow` (embedded,
 * `prefix` `shells.<key>`, without `sky`). Returns the shell built from what it read, or undefined
 * when the input isn't an object or `breaks` couldn't be walked; the caller decides validity from
 * `report.errors`.
 */
function walkShell(
  input: unknown,
  prefix: string,
  report: Report,
  keys: readonly string[],
): ShellDocument | undefined {
  const at = (field: string) => childPath(prefix, field);
  if (!isRecord(input)) {
    issue(
      report,
      prefix,
      'not-object',
      prefix ? `${prefix}: must be an object.` : 'The shell must be a JSON object.',
    );
    return undefined;
  }
  dropUnknown(input, keys, prefix, report);
  readVersion(input['version'], SHELL_VERSION, at('version'), report);

  const name = normalizeName(input['name'], at('name'), report);
  const burstHeight = num(
    input['burstHeight'],
    SHELL_LIMITS.burstHeight,
    DEFAULT_SHELL.burstHeight,
    at('burstHeight'),
    report,
  );
  const angleJitter = num(
    input['angleJitter'],
    SHELL_LIMITS.angleJitter,
    DEFAULT_SHELL.angleJitter,
    at('angleJitter'),
    report,
  );

  let sky: SkySettings | undefined;
  if (keys.includes('sky')) {
    const rawSky = input['sky'];
    if (rawSky === null) {
      // Null is absent (L4), and an absent sky stays absent (§3): nothing to fill in.
      report.adjustments.push({ path: at('sky'), kind: 'defaulted', from: null });
    } else if (rawSky !== undefined) {
      if (isRecord(rawSky)) {
        dropUnknown(rawSky, SKY_KEYS, at('sky'), report);
        sky = readSky(rawSky, at('sky'), report, false);
      } else {
        issue(report, at('sky'), 'not-object', `${at('sky')}: must be an object.`);
      }
    }
  }

  const breaksPath = at('breaks');
  const rawBreaks = input['breaks'];
  if (!Array.isArray(rawBreaks) || rawBreaks.length < MIN_BREAKS) {
    issue(report, breaksPath, 'break-count', `${breaksPath}: needs a non-empty array.`, {
      value: Array.isArray(rawBreaks) ? rawBreaks.length : null,
    });
    return undefined;
  }
  if (rawBreaks.length > MAX_BREAKS) {
    issue(
      report,
      breaksPath,
      'break-count',
      `${breaksPath}: at most ${MAX_BREAKS} breaks (got ${rawBreaks.length}).`,
      { value: rawBreaks.length },
    );
    return undefined;
  }
  const breaks: BreakDef[] = [];
  rawBreaks.forEach((raw, k) => {
    const path = `${breaksPath}[${k}]`;
    if (isRecord(raw)) {
      dropUnknown(raw, BREAK_KEYS, path, report);
      breaks.push(readBreak(raw, path, report));
    } else {
      issue(report, path, 'not-object', `${path}: must be an object.`);
    }
  });

  const shell: ShellDocument = { version: SHELL_VERSION, name, burstHeight, angleJitter, breaks };
  if (sky) {
    shell.sky = sky;
  }
  return shell;
}

function readVersion(value: unknown, current: number, path: string, report: Report): void {
  if (isAbsent(value)) {
    report.adjustments.push({ path, kind: 'defaulted', from: value, to: current });
  } else if (value !== current) {
    issue(
      report,
      path,
      'version',
      `${path}: unsupported version ${JSON.stringify(value)} (expected ${current}).`,
      { value },
    );
  }
}

function readSky(
  src: Record<string, unknown>,
  path: string,
  report: Report | null,
  required: boolean,
): SkySettings {
  return {
    gravity: num(
      src['gravity'],
      SKY_LIMITS.gravity,
      required ? REQUIRED : DEFAULT_SKY.gravity,
      `${path}.gravity`,
      report,
    ),
    wind: num(
      src['wind'],
      SKY_LIMITS.wind,
      required ? REQUIRED : DEFAULT_SKY.wind,
      `${path}.wind`,
      report,
    ),
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

interface CueContext {
  readonly tMax: number;
  /** Null when `shells` wasn't walked: then `unknown-shell` isn't checked (§6.2.8). */
  readonly shellKeys: ReadonlySet<string> | null;
  readonly seenIds: Set<string>;
}

/** schema.md §4.3. Cue fields have no defaults; `burstHeight` is optional and absent stays absent. */
function readCue(raw: unknown, path: string, report: Report, ctx: CueContext): ShowCue | undefined {
  if (!isRecord(raw)) {
    issue(report, path, 'not-object', `${path}: must be an object.`);
    return undefined;
  }
  dropUnknown(raw, CUE_KEYS, path, report);

  const id = requiredString(raw['id'], `${path}.id`, report);
  if (id !== undefined) {
    if (!KEY_PATTERN.test(id)) {
      issue(report, `${path}.id`, 'key-format', `${path}.id: bad id ${JSON.stringify(id)}.`, {
        value: id,
      });
    } else if (ctx.seenIds.has(id)) {
      issue(report, `${path}.id`, 'duplicate-id', `${path}.id: ${JSON.stringify(id)} is used.`, {
        value: id,
      });
    } else {
      ctx.seenIds.add(id);
    }
  }

  const t = num(raw['t'], { ...CUE_LIMITS.t, max: ctx.tMax }, REQUIRED, `${path}.t`, report);

  const shell = requiredString(raw['shell'], `${path}.shell`, report);
  if (shell !== undefined && ctx.shellKeys && !ctx.shellKeys.has(shell)) {
    issue(
      report,
      `${path}.shell`,
      'unknown-shell',
      `${path}.shell: ${JSON.stringify(shell)} isn't a key of shells.`,
      { value: shell },
    );
  }

  const x = num(raw['x'], CUE_LIMITS.x, REQUIRED, `${path}.x`, report);

  let burstHeight: number | undefined;
  const rawBurst = raw['burstHeight'];
  if (rawBurst === null) {
    // Null is absent (L4): the cue plays at the shell's own burstHeight. Strict: `missing`.
    report.adjustments.push({ path: `${path}.burstHeight`, kind: 'defaulted', from: null });
  } else if (rawBurst !== undefined) {
    burstHeight = num(rawBurst, CUE_LIMITS.burstHeight, REQUIRED, `${path}.burstHeight`, report);
  }

  const seed = readSeed(raw['seed'], `${path}.seed`, report);

  if (id === undefined || shell === undefined) return undefined;
  const cue: ShowCue = { id, t, shell, x, seed };
  if (burstHeight !== undefined) cue.burstHeight = burstHeight;
  return cue;
}

function requiredString(value: unknown, path: string, report: Report): string | undefined {
  if (isAbsent(value)) {
    issue(report, path, 'missing', `${path}: required.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    issue(report, path, 'type', `${path}: must be a string.`, { options: ['string'] });
    return undefined;
  }
  return value;
}

/** int32, never adjusted (a changed seed silently changes the burst). Range before integrality. */
function readSeed(value: unknown, path: string, report: Report): number {
  if (isAbsent(value)) {
    issue(report, path, 'missing', `${path}: required.`);
    return 0;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issue(report, path, 'type', `${path}: must be an integer.`, { options: ['integer'] });
    return 0;
  }
  const { min, max } = CUE_LIMITS.seed;
  if (value < min || value > max) {
    issue(report, path, 'out-of-range', `${path}: ${value} is outside ${min}..${max}.`);
  } else if (!Number.isInteger(value)) {
    issue(report, path, 'not-integer', `${path}: ${value} isn't an integer.`);
  }
  return value;
}

/** §6.4. One issue per name at most: `type` > `missing` > `too-long` > `name-format`. */
function normalizeName(value: unknown, path: string, report: Report): string {
  if (isAbsent(value)) {
    report.adjustments.push({ path, kind: 'defaulted', from: value, to: FALLBACK_NAME });
    return FALLBACK_NAME;
  }
  if (typeof value !== 'string') {
    issue(report, path, 'type', `${path}: must be a string.`, { options: ['string'] });
    return FALLBACK_NAME;
  }
  const cleaned = cleanName(value);
  if (!cleaned) {
    report.adjustments.push({ path, kind: 'defaulted', from: value, to: FALLBACK_NAME });
    return FALLBACK_NAME;
  }
  // Cut by code point so a surrogate pair is never split (no unpaired ones are left).
  const chars = Array.from(cleaned);
  if (chars.length > NAME_MAX_LENGTH) {
    const cut = chars.slice(0, NAME_MAX_LENGTH).join('');
    report.adjustments.push({ path, kind: 'truncated', from: value, to: cut });
    return cut;
  }
  if (cleaned !== value) {
    report.adjustments.push({ path, kind: 'cleaned', from: value, to: cleaned });
  }
  return cleaned;
}

/**
 * A missing or null value takes the default (or, for a `REQUIRED` field, is a hard `missing`
 * error); a finite number is clamped (or rounded); anything else is a `type` error. With `report`
 * null (sky/quality helpers), nothing is recorded.
 */
function num(
  value: unknown,
  range: NumericRange,
  fallback: number | typeof REQUIRED,
  path: string,
  report: Report | null,
): number {
  const safe = fallback === REQUIRED ? range.min : fallback;
  if (isAbsent(value)) {
    if (fallback === REQUIRED) {
      if (report) issue(report, path, 'missing', `${path}: required.`);
    } else {
      report?.adjustments.push({ path, kind: 'defaulted', from: value, to: fallback });
    }
    return safe;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (report) {
      issue(report, path, 'type', `${path}: must be a number.`, { options: ['number'] });
    }
    return safe;
  }
  const result = clampToRange(value, range);
  if (result !== value && report) {
    // Range is tested on the raw value: `stars: 400.4` is out of range, not "not an integer".
    report.adjustments.push({
      path,
      kind: inRange(value, range) ? 'rounded' : 'clamped',
      from: value,
      to: result,
    });
  }
  return result;
}

function inRange(value: unknown, range: Pick<NumericRange, 'min' | 'max'>): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max
  );
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
  issue(
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
        path: childPath(path, key),
        kind: 'dropped',
        from: src[key],
      });
    }
  }
}

/** schema.md §6.2 rule 11: a name that can be written plainly after a `.` (or at the root). */
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const REPLACEMENT = String.fromCharCode(0xfffd);

/**
 * The path of property `name` under `parent` (`""` is the root), schema.md §6.2 rule 11:
 * `parent.name` (or `name`) for a plain name, otherwise `parent["name"]` with only `\` and `"`
 * escaped and each unpaired surrogate written as U+FFFD. Not `JSON.stringify` (STJ escapes
 * differently, and the server must produce the same text).
 */
export function childPath(parent: string, name: string): string {
  if (PLAIN_NAME.test(name)) return parent ? `${parent}.${name}` : name;
  let quoted = '';
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = name.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        quoted += name[i] + name[i + 1];
        i++;
      } else {
        quoted += REPLACEMENT;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      quoted += REPLACEMENT;
    } else if (c === 0x5c || c === 0x22) {
      quoted += '\\' + name[i];
    } else {
      quoted += name[i];
    }
  }
  return `${parent}["${quoted}"]`;
}

function issue(
  report: Report,
  path: string,
  code: IssueCode,
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

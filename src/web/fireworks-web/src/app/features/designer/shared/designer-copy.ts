import type { PlaybackMode } from '../../../../engine/model/enums';
import { DEFAULT_BREAK, SHELL_VERSION } from '../../../../engine/model/shell';
import { fieldLabel, valueLabel } from '../../../../engine/model/labels';
import {
  BREAK_LIMITS,
  MAX_BREAKS,
  MAX_SHOW_CUES,
  MAX_SHOW_SHELLS,
  MIN_BREAKS,
  MIN_SHOW_CUES,
  NAME_MAX_LENGTH,
  SHELL_LIMITS,
  SKY_LIMITS,
  type NumericRange,
} from '../../../../engine/model/limits';
import type { ShellAdjustment, ShellIssue } from '../../../../engine/model/normalize';
import { isolate } from '../../../shared/bidi';

/** Designer copy that depends on data (designer-2c.md §3.6). Strings are the spec's, verbatim. */
export const JSON_NOTE_DEFAULT =
  "This is the shell as it's saved. Edit it, then press Apply to load it.";
export const JSON_NOTE_EDITED = "You have edits that aren't applied yet. Apply them, or Revert.";
export const JSON_NOTE_COPIED = 'Copied to clipboard.';
export const JSON_NOTE_APPLIED = 'Applied.';

/** Names listed per sentence before `and {k} more` (§3.6). */
export const MAX_LISTED = 5;
/** Characters of an unknown key shown before `…` (§3.6). */
export const MAX_KEY_CHARS = 40;

export function copyBlockedNote(isApple: boolean): string {
  return `Copy was blocked. The text is selected; press ${isApple ? '⌘C' : 'Ctrl+C'} to copy it.`;
}

export function notJsonNote(parserMessage: string): string {
  return `Couldn't apply: this isn't valid JSON (${parserMessage}). Nothing changed.`;
}

export function invalidShellNote(errors: readonly ShellIssue[]): string {
  return `Couldn't apply: ${errors.map(issueReason).join('; ')}. Nothing changed.`;
}

/**
 * The Apply success note (§3.6 "Which adjustments count"): clamped, rounded and truncated values
 * count, by distinct path, in row order (shell fields, breaks, then sky); dropped keys get their
 * own sentence; defaulted values are never mentioned.
 */
export function appliedNote(adjustments: readonly ShellAdjustment[]): string {
  const adjusted = distinct(
    adjustments.filter(
      (a) => a.kind === 'clamped' || a.kind === 'rounded' || a.kind === 'truncated',
    ),
  ).sort((a, b) => rowOrder(a) - rowOrder(b));
  const dropped = distinct(adjustments.filter((a) => a.kind === 'dropped'));

  const parts: string[] = [];
  if (adjusted.length) {
    const n = adjusted.length;
    const names = list(adjusted.map((p) => fieldLabel(p)));
    parts.push(`Applied, with ${n} ${n === 1 ? 'value' : 'values'} adjusted: ${names}.`);
  }
  if (dropped.length) {
    const n = dropped.length;
    const names = list(dropped.map(unknownKeyName));
    const sentence = `${n} unknown ${n === 1 ? 'field was' : 'fields were'} ignored: ${names}.`;
    parts.push(parts.length ? sentence : `Applied. ${sentence}`);
  }
  return parts.length ? parts.join(' ') : JSON_NOTE_APPLIED;
}

/**
 * One rejection reason in field-label language (designer-2c.md §3.6; phase-5.md §11.2). Built from
 * the issue's `code` and `path` only: an issue from the server carries no value, and its `message`
 * is never shown (Boo C15). A `value` is shown only when it is a finite number (the client's own
 * strict check). Save failures never reach the `version` row: a `(version, version)` 400 has its
 * own message (phase-5.md §6 row 400a), and server issues carry no value anyway.
 */
export function issueReason(issue: ShellIssue): string {
  const field = fieldLabel(issue.path);
  switch (issue.code) {
    case 'enum': {
      const options = (issue.options ?? []).map((o) => valueLabel(issue.path, o)).join(', ');
      return `${field} ${JSON.stringify(issue.value)} isn't one of ${options}`;
    }
    case 'type': {
      const expected = issue.options?.[0];
      if (expected === 'integer') return `${field} must be a whole number`; // F11
      return `${field} must be ${expected === 'number' ? 'a number' : 'text'}`;
    }
    case 'break-count':
      return `a shell needs ${MIN_BREAKS} to ${MAX_BREAKS} breaks`;
    case 'version':
      // The visitor's own pasted value (2c §3.6). Shared-link pages never show this reason: they
      // word a version failure from the code alone (Boo C15).
      return `version ${JSON.stringify(issue.value)} isn't supported (expected ${SHELL_VERSION})`;
    case 'not-object':
      return issue.path === '' ? 'the shell must be a JSON object' : `${field} must be an object`;
    case 'missing':
      if (issue.path === 'name') return 'Name is blank';
      if (issue.path === 'sky' && issue.value === null)
        return `${field} is null; remove it instead`;
      return `${field} is missing`;
    case 'out-of-range': {
      const range = rangeFor(issue.path);
      const value =
        typeof issue.value === 'number' && Number.isFinite(issue.value) ? ` ${issue.value}` : '';
      return range
        ? `${field}${value} is outside ${range.min} to ${range.max}`
        : `${field}${value} is out of range`;
    }
    case 'not-integer':
      return `${field} must be a whole number`;
    case 'too-long':
      return `Name is longer than ${NAME_MAX_LENGTH} characters`;
    case 'unknown-property':
      return `${unknownKeyName(issue.path)} isn't a field this app knows`;
    case 'name-format':
      return 'Name has spaces at its ends or hidden characters';
    case 'shell-count':
      return `a show can have up to ${MAX_SHOW_SHELLS} shells`;
    case 'cue-count':
      return `a show needs ${MIN_SHOW_CUES} to ${MAX_SHOW_CUES} cues`;
    default:
      return serverOnlyReason(issue.code as string, field);
  }
}

/** Server-only codes (schema.md §6.3): they reach the client only in a 400 body. */
function serverOnlyReason(code: string, field: string): string {
  if (code === 'not-json') return "the data sent wasn't valid JSON";
  if (code === 'duplicate-key') return `${field} appears more than once`;
  // `key-format`, `duplicate-id`, `unknown-shell`: worded at the Phase 6 timeline review.
  return `${field} isn't valid`;
}

/** The numeric range for a shell path, for `out-of-range` copy. */
function rangeFor(path: string): NumericRange | null {
  const m = /^(?:breaks\[\d+\]\.|sky\.)?(\w+)$/.exec(path);
  if (!m) return null;
  const key = m[1];
  const table: Readonly<Record<string, NumericRange>> = path.startsWith('breaks[')
    ? BREAK_LIMITS
    : path.startsWith('sky.')
      ? SKY_LIMITS
      : SHELL_LIMITS;
  return Object.hasOwn(table, key) ? table[key] : null;
}

/** Replace confirmation copy (designer-2c.md §6.4, verbatim). */
export const CONFIRM_CANCEL_LABEL = 'Keep editing';
export const CONFIRM_APPLY_TITLE = 'Apply this JSON?';
export const CONFIRM_APPLY_ACTION = 'Apply JSON';

export function confirmPresetTitle(presetName: string): string {
  return `Load ${presetName}?`;
}

export function confirmPresetAction(presetName: string): string {
  return `Load ${presetName}`;
}

/** `{name}` is the current shell's name in curly quotes; a blank name drops it and its commas. */
export function confirmPresetBody(currentName: string): string {
  return `This replaces your current shell${quotedName(currentName, '')} and its breaks, and goes back to Break 1. Sky and display settings stay as they are.`;
}

/** Apply's body depends on whether the JSON has a `sky` key: the same check that replaces the sky. */
export function confirmApplyBody(currentName: string, jsonHasSky: boolean): string {
  return jsonHasSky
    ? `This replaces your current shell${quotedName(currentName, ',')} including its breaks and sky, with the shell in the JSON panel. Display settings stay as they are.`
    : `This replaces your current shell${quotedName(currentName, '')} and its breaks with the shell in the JSON panel. Sky and display settings stay as they are.`;
}

/** The quoted name with its commas; when blank, `blank` (what's left once they're dropped). */
function quotedName(name: string, blank: string): string {
  return name.trim() ? `, \u201c${isolate(name)}\u201d,` : blank;
}

/** Opening a link over shell or sky changes (phase-5.md §7.2, verbatim). */
export const CONFIRM_LINK_ACTION = 'Open copy';

export function confirmLinkTitle(linkName: string): string {
  return `Open \u201c${isolate(linkName)}\u201d?`;
}

/** A link replaces both shell and sky, so the body always names the sky. */
export function confirmLinkBody(currentName: string, linkName: string): string {
  return `This replaces your current shell${quotedName(currentName, ',')} including its breaks and sky, with a copy of \u201c${isolate(linkName)}\u201d. Display settings stay as they are.`;
}

/** Launch and Replay while the flashing notice holds playback (§7.2). */
export const PLAYBACK_HELD_TITLE = 'Close the flashing notice to start.';

const BREAK_FIELDS = Object.keys(DEFAULT_BREAK);
const SHELL_FIELDS = ['version', 'name', 'burstHeight', 'angleJitter'];

function distinct(items: readonly ShellAdjustment[]): string[] {
  return [...new Set(items.map((a) => a.path))];
}

/** Shell fields first, then breaks in order with fields in row order, then sky. */
function rowOrder(path: string): number {
  const m = /^breaks\[(\d+)\]\.(\w+)$/.exec(path);
  if (m) return 100 + Number(m[1]) * 100 + Math.max(0, BREAK_FIELDS.indexOf(m[2]));
  if (path.startsWith('sky.')) return 10_000 + (path === 'sky.gravity' ? 0 : 1);
  return Math.max(0, SHELL_FIELDS.indexOf(path));
}

/**
 * An unknown key for the Apply note (phase-5.md §11.1, F12). The last path segment is the key and
 * its container the qualifier (root: none; `sky`: ` (Sky)`; `breaks[n]`: ` (Break n+1)`). A plain
 * key shows as typed; a bracket-form key (schema.md §6.2 rule 11) shows in curly quotes with
 * invisible characters written as JSON escapes, so the visitor can find them and a bidi control
 * can't reorder the note. Cut at 40 code points after escaping, the `…` inside the quote.
 */
export function unknownKeyName(path: string): string {
  const m = KEY_PATH.exec(path);
  if (!m) return cut(path);
  const [, container, breakIndex, plain, bracketed] = m;
  const qualifier =
    container === 'sky'
      ? ' (Sky)'
      : breakIndex !== undefined
        ? ` (Break ${Number(breakIndex) + 1})`
        : '';
  if (plain !== undefined) return cut(plain) + qualifier;
  const key = bracketed.replace(/\\(["\\])/g, '$1');
  return `\u201c${cut(escapeInvisible(key))}\u201d${qualifier}`;
}

/** `[container.]plain` or `[container]["bracketed"]`, container `sky` or `breaks[n]`. */
const KEY_PATH =
  /^(?:(sky|breaks\[(\d+)\])(?:\.(?=[A-Za-z_])|(?=\[)))?(?:([A-Za-z_][A-Za-z0-9_-]*)|\["((?:[^"\\]|\\.)*)"\])$/s;

function cut(text: string): string {
  const chars = Array.from(text);
  return chars.length > MAX_KEY_CHARS ? chars.slice(0, MAX_KEY_CHARS).join('') + '\u2026' : text;
}

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '\n': '\\n',
  '\t': '\\t',
  '\r': '\\r',
  '\b': '\\b',
  '\f': '\\f',
};

/** §11.1 step 4: Cc, Cf, U+2028/9 and every space but U+0020 as escapes; `\` as `\\`. */
function escapeInvisible(key: string): string {
  let out = '';
  for (const ch of key) {
    if (ch === '\\') out += '\\\\';
    else if (SHORT_ESCAPES[ch]) out += SHORT_ESCAPES[ch];
    else if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch) || (/\p{Zs}/u.test(ch) && ch !== ' ')) {
      for (let i = 0; i < ch.length; i++) out += hexEscape(ch.charCodeAt(i));
    } else out += ch;
  }
  return out;
}

function hexEscape(unit: number): string {
  return '\\u' + unit.toString(16).padStart(4, '0');
}

function list(names: readonly string[]): string {
  if (names.length <= MAX_LISTED) return names.join(', ');
  return `${names.slice(0, MAX_LISTED).join(', ')}, and ${names.length - MAX_LISTED} more`;
}

/** The flashing notice's second sentence, live with the Mode select (designer-2c.md §7.2). */
export function flashNoticeModeSentence(mode: PlaybackMode): string {
  return mode === 'manual'
    ? 'You can launch fireworks once you close this notice.'
    : 'Fireworks start when you close this notice.';
}

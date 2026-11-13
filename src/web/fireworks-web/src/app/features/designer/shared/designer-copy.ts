import type { PlaybackMode } from '../../../../engine/model/enums';
import { DEFAULT_BREAK } from '../../../../engine/model/shell';
import { fieldLabel, valueLabel } from '../../../../engine/model/labels';
import { MAX_BREAKS, MIN_BREAKS } from '../../../../engine/model/limits';
import type { ShellAdjustment, ShellIssue } from '../../../../engine/model/normalize';

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

/** One rejection reason in field-label language (§3.6). */
export function issueReason(issue: ShellIssue): string {
  switch (issue.code) {
    case 'enum': {
      const options = (issue.options ?? []).map((o) => valueLabel(issue.path, o)).join(', ');
      return `${fieldLabel(issue.path)} ${JSON.stringify(issue.value)} isn't one of ${options}`;
    }
    case 'type':
      return `${fieldLabel(issue.path)} must be ${issue.options?.[0] === 'number' ? 'a number' : 'text'}`;
    case 'break-count':
      return `a shell needs ${MIN_BREAKS} to ${MAX_BREAKS} breaks`;
    case 'version':
      return `version ${JSON.stringify(issue.value)} isn't supported (expected 1)`;
    case 'not-object':
      return issue.path === ''
        ? 'the shell must be a JSON object'
        : `${fieldLabel(issue.path)} must be an object`;
    default:
      // Codes the lenient shell walk never raises as errors (strict-only and show codes).
      // Placeholder until Rosalina writes their copy (schema.md §6.3, §15).
      return `${fieldLabel(issue.path)} isn't valid`;
  }
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
  return name.trim() ? `, \u201c${name}\u201d,` : blank;
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

/** `breaks[0].sparkle` → `sparkle (Break 1)`, `theme` → `theme`; long keys are cut with `…`. */
function unknownKeyName(path: string): string {
  const m = /^breaks\[(\d+)\]\.(.*)$/s.exec(path);
  const key = m ? m[2] : path.replace(/^sky\./, '');
  const chars = Array.from(key);
  const shown = chars.length > MAX_KEY_CHARS ? chars.slice(0, MAX_KEY_CHARS).join('') + '…' : key;
  return m ? `${shown} (Break ${Number(m[1]) + 1})` : shown;
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

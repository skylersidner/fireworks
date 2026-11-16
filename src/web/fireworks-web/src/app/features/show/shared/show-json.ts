import { openShow } from '../../../../engine/model/open';
import type { ShellAdjustment, ShellIssue } from '../../../../engine/model/normalize';
import type { ShowDocument } from '../../../../engine/model/show';
import { isolate } from '../../../shared/bidi';
import {
  JSON_NOTE_APPLIED,
  JSON_NOTE_EDITED,
  MAX_LISTED,
  notJsonNote,
  unknownKeyName,
} from '../../designer/shared/designer-copy';
import {
  embeddedShellName,
  showFieldLabel,
  showIssueReason,
  type ShowForLabels,
} from './show-copy';

/**
 * Show JSON (phase-7.md §9, refined from phase-6.md §9.5): Copy and Apply for a whole show. Apply
 * is the one new show entry: parse here, then `openShow` (upgrade, then lenient normalize), the
 * schema.md §8.3 order every untrusted document takes (designer-structure.spec.ts pins this file
 * as its only caller under features/show besides the draft). Notes name paths with
 * `showFieldLabel` against the document as pasted, never bare `fieldLabel` (Peach N1).
 */

export const SHOW_JSON_NOTE_DEFAULT =
  "This is the show as it's saved. Edit it, then press Apply to load it.";
export const SHOW_JSON_NOTE_EDITED = JSON_NOTE_EDITED;
export const SHOW_JSON_NOTE_APPLIED = JSON_NOTE_APPLIED;
export const SHOW_JSON_SHELL_PASTED =
  "Couldn't apply: this is a shell, not a show. Paste it in the designer's Shell JSON, or add it to a show from the Library. Nothing changed.";
/** Reasons listed before `; and {k} more problems` (phase-7.md §9.2). */
export const MAX_REASONS = 5;

/** The confirmation over a dirty show (phase-7.md §9.3). */
export const SHOW_JSON_CONFIRM_TITLE = 'Apply this JSON?';
export const SHOW_JSON_CONFIRM_ACTION = 'Apply JSON';
export function showJsonConfirmBody(currentName: string): string {
  const name = currentName.trim() ? `, \u201c${isolate(currentName)}\u201d,` : '';
  return `This replaces your current show${name} including its cues, shells and sky. Display settings stay as they are.`;
}

/** The textarea text: the document exactly as Save sends it, 2-space pretty-printed. */
export function showJsonText(document: ShowDocument): string {
  return JSON.stringify(document, null, 2);
}

export type ShowJsonParse =
  | { readonly ok: false; readonly note: string }
  | { readonly ok: true; readonly show: ShowDocument; readonly note: string };

/** Parses pasted text into a show, or the note that says why not. Changes nothing. */
export function parseShowJson(text: string): ShowJsonParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, note: notJsonNote(error instanceof Error ? error.message : String(error)) };
  }
  if (isShell(parsed)) return { ok: false, note: SHOW_JSON_SHELL_PASTED };
  const labels: ShowForLabels = isRecord(parsed) ? parsed : {};
  const result = openShow(parsed);
  if (!result.ok) return { ok: false, note: invalidShowNote(result.errors, labels) };
  return { ok: true, show: result.show, note: showAppliedNote(result.adjustments, labels) };
}

/** `Couldn't apply: {reasons}. Nothing changed.`, at most 5 reasons (phase-7.md §9.2). */
export function invalidShowNote(errors: readonly ShellIssue[], pasted: ShowForLabels): string {
  const reasons = errors.map((e) => showIssueReason(e, pasted));
  const shown = reasons.slice(0, MAX_REASONS).join('; ');
  const more = reasons.length - MAX_REASONS;
  const tail = more > 0 ? `; and ${more} more ${more === 1 ? 'problem' : 'problems'}` : '';
  return `Couldn't apply: ${shown}${tail}. Nothing changed.`;
}

/**
 * The success note (phase-7.md §9.2): adjusted values, then ignored unknown fields, then the
 * embedded-`sky` caveat, each by distinct path in document order. `defaulted` and `cleaned` aren't
 * mentioned. A success with a caveat, never an error (standing decision).
 */
export function showAppliedNote(
  adjustments: readonly ShellAdjustment[],
  pasted: ShowForLabels,
): string {
  const adjusted = distinct(
    adjustments.filter(
      (a) => a.kind === 'clamped' || a.kind === 'rounded' || a.kind === 'truncated',
    ),
  );
  const dropped = distinct(adjustments.filter((a) => a.kind === 'dropped'));
  const skies = dropped.map(embeddedSkyKey).filter((k): k is string => k !== null);
  const unknown = dropped.filter((p) => embeddedSkyKey(p) === null);

  const parts: string[] = [];
  if (adjusted.length) {
    const n = adjusted.length;
    const names = list(adjusted.map((p) => showFieldLabel(p, pasted)));
    parts.push(`Applied, with ${n} ${n === 1 ? 'value' : 'values'} adjusted: ${names}.`);
  }
  if (unknown.length) {
    const n = unknown.length;
    const names = list(unknown.map((p) => showUnknownKeyName(p, pasted)));
    const sentence = `${n} unknown ${n === 1 ? 'field was' : 'fields were'} ignored: ${names}.`;
    parts.push(parts.length ? sentence : `Applied. ${sentence}`);
  }
  if (skies.length) {
    const names = skies.map((k) => embeddedShellName(pasted, k));
    const sentence =
      names.length === 1
        ? `Shells in a show play under the show's sky, so ${names[0]}'s own sky was removed.`
        : `Shells in a show play under the show's sky, so ${names.length} shells' own skies were removed: ${list(names)}.`;
    parts.push(parts.length ? sentence : `Applied. ${sentence}`);
  }
  return parts.length ? parts.join(' ') : SHOW_JSON_NOTE_APPLIED;
}

/** An unknown key with where it was: `sparkle (Cue at 0:12.5)`, `sparkle (Peony, Break 1)`. */
export function showUnknownKeyName(path: string, pasted: ShowForLabels): string {
  const m = /^(.*?)(\.[A-Za-z_][A-Za-z0-9_-]*|\["(?:[^"\\]|\\.)*"\])$/s.exec(path);
  if (!m) return unknownKeyName(path);
  const [, container, last] = m;
  const key = unknownKeyName(last.startsWith('.') ? last.slice(1) : last);
  const where = containerLabel(container, pasted);
  return where ? `${key} (${where})` : key;
}

function containerLabel(container: string, pasted: ShowForLabels): string {
  if (container === '') return '';
  if (container === 'sky') return 'Sky';
  const shell =
    /^shells(?:\.([A-Za-z_$][\w$-]*)|\["((?:[^"\\]|\\.)*)"\])(?:\.breaks\[(\d+)\])?$/s.exec(
      container,
    );
  if (shell) {
    const key = shell[1] ?? shell[2].replace(/\\(["\\])/g, '$1');
    const name = embeddedShellName(pasted, key);
    return shell[3] === undefined ? name : `${name}, Break ${Number(shell[3]) + 1}`;
  }
  return showFieldLabel(container, pasted);
}

/** `shells.<key>.sky` (or the bracket form): the embedded shell's key, else null. */
function embeddedSkyKey(path: string): string | null {
  const m = /^shells(?:\.([A-Za-z_$][\w$-]*)|\["((?:[^"\\]|\\.)*)"\])\.sky$/s.exec(path);
  if (!m) return null;
  return m[1] ?? m[2].replace(/\\(["\\])/g, '$1');
}

/** A shell pasted here: an object with `breaks` and no `cues` (phase-7.md §9.2). */
function isShell(value: unknown): boolean {
  return isRecord(value) && Object.hasOwn(value, 'breaks') && !Object.hasOwn(value, 'cues');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function distinct(adjustments: readonly ShellAdjustment[]): string[] {
  return [...new Set(adjustments.map((a) => a.path))];
}

function list(names: readonly string[]): string {
  if (names.length <= MAX_LISTED) return names.join(', ');
  return `${names.slice(0, MAX_LISTED).join(', ')}, and ${names.length - MAX_LISTED} more`;
}

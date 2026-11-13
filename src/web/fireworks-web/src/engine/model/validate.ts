import {
  normalizeShell,
  normalizeShow,
  type AdjustmentKind,
  type IssueCode,
  type ShellAdjustment,
  type ShellIssue,
} from './normalize';
import type { ShellDocument } from './shell';
import type { ShowDocument } from './show';

/**
 * Strict validation (docs/fireworks-app/schema.md §6.1): valid exactly when the lenient walk has
 * no errors and no adjustments. Every adjustment becomes an error at the same path, by this map.
 * The C# validator implements the same table; it never adjusts.
 */
export const STRICT_CODE: Readonly<Record<AdjustmentKind, IssueCode>> = {
  defaulted: 'missing',
  clamped: 'out-of-range',
  rounded: 'not-integer',
  truncated: 'too-long',
  dropped: 'unknown-property',
  cleaned: 'name-format',
};

export type ValidateResult<T> =
  | { readonly ok: true; readonly document: T }
  | { readonly ok: false; readonly errors: readonly ShellIssue[] };

/** For anything about to be saved. A failure on a designer-made shell is a client bug. */
export function validateShell(input: unknown): ValidateResult<ShellDocument> {
  const result = normalizeShell(input);
  const errors = strictErrors(result.ok ? [] : result.errors, result.adjustments);
  return result.ok && !errors.length ? { ok: true, document: result.shell } : { ok: false, errors };
}

export function validateShow(input: unknown): ValidateResult<ShowDocument> {
  const result = normalizeShow(input);
  const errors = strictErrors(result.ok ? [] : result.errors, result.adjustments);
  return result.ok && !errors.length ? { ok: true, document: result.show } : { ok: false, errors };
}

/** Hard errors plus every adjustment as its strict code: the complete `(path, code)` multiset. */
function strictErrors(
  errors: readonly ShellIssue[],
  adjustments: readonly ShellAdjustment[],
): ShellIssue[] {
  return [
    ...errors,
    ...adjustments.map((a): ShellIssue => ({
      path: a.path,
      code: STRICT_CODE[a.kind],
      message: strictMessage(a),
      value: a.from,
    })),
  ];
}

function strictMessage(a: ShellAdjustment): string {
  const at = a.path || '(root)';
  switch (a.kind) {
    case 'defaulted':
      return `${at}: required.`;
    case 'clamped':
      return `${at}: ${JSON.stringify(a.from)} is out of range.`;
    case 'rounded':
      return `${at}: ${JSON.stringify(a.from)} isn't an integer.`;
    case 'truncated':
      return `${at}: longer than 80 code points.`;
    case 'dropped':
      return `${at}: unknown property.`;
    case 'cleaned':
      return `${at}: has control characters, unpaired surrogates or edge whitespace.`;
  }
}

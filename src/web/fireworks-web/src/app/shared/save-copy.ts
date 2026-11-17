import type { CreationError } from '../core/creations';
import type { SavePlan } from '../core/creation-save';
import type { ShellIssue } from '../../engine/model/normalize';
import { isolate } from './bidi';
import { retryWhen } from './link-copy';

/**
 * Save, Share and save-failure copy (docs/fireworks-app/design/phase-5.md §2, §3.2, §5, §6),
 * verbatim. Every `{name}` is a creation name in curly quotes, rendered as text (Boo C1). Nothing
 * here reads a server `message` or a `version` value (Boo C15): failures are worded from the
 * status and the issue `code`s.
 */

export const SAVE_LABEL = 'Save';
export const UPDATE_LABEL = 'Update original';
export const SAVE_AS_NEW_LABEL = 'Save as new';
export const SAVING_LABEL = 'Saving…';
export const SHARE_LABEL = 'Share';
export const SAVED_TITLE = 'No changes since you saved.';

export const INDICATOR_SAVING = 'Saving…';
export const INDICATOR_SAVED = 'Saved';
export const INDICATOR_NOT_SAVED = 'Not saved';

export const FRESH_NOTE = 'Save to get a share link.';
export const NON_OWNER_NOTE = "Saves your own copy with a new link. The original isn't changed.";

/** A creation name in curly quotes, isolated inside them (Boo C3). */
export function quoted(name: string): string {
  return `“${isolate(name)}”`;
}

/** §2.2, owned working copy. Without the saved name (Y1 unavailable) it says "its share link". */
export function ownerNote(sourceName: string): string {
  const link = sourceName ? `the share link for ${quoted(sourceName)}` : 'its share link';
  return `Update original changes what ${link} plays. Save as new keeps it and makes a new link.`;
}

/** §3.2 success toasts. `name` is the name the server returned. */
export function savedToast(
  request: SavePlan['request'],
  isOwnerChoice: boolean,
  name: string,
): string {
  const n = quoted(name);
  if (request === 'create') return `Saved ${n}.`;
  if (request === 'update') return `Updated ${n}. Its share link plays this version now.`;
  return isOwnerChoice
    ? `Saved ${n} as a new creation with its own link.`
    : `Saved ${n} as your own copy.`;
}

/** §5 Share toasts. */
export const SHARE_COPIED = 'Share link copied.';
export const SHARE_COPIED_UNSAVED =
  'Share link copied. It plays the last saved version, not your unsaved changes.';

export function shareBlockedNote(isApple: boolean): string {
  return `Copy was blocked. The link is selected; press ${isApple ? '⌘C' : 'Ctrl+C'} to copy it.`;
}

/**
 * A button in the status block. `retry` repeats the save that failed; `signIn` opens the sign-in
 * dialog (Save variant); `replace` is 412's Replace the newer version (phase-8.md §9).
 */
export type SaveStatusAction = 'reload' | 'saveAsNew' | 'retry' | 'signIn' | 'replace';

export const SAVE_STATUS_ACTION_LABELS: Readonly<Record<SaveStatusAction, string>> = {
  reload: 'Reload',
  saveAsNew: 'Save as new',
  retry: 'Try again',
  signIn: 'Sign in',
  replace: 'Replace the newer version',
};

/** The Replace button's label while its GET and PUT run (phase-8.md §9.2). */
export const REPLACING_LABEL = 'Replacing…';

/** phase-8.md §5.1: the note under the signed-out bar (Save prompts sign-in). */
export const SIGNED_OUT_NOTE =
  'Sign in to save and get a share link. Your work is kept in this browser.';

/** One message in the status block (§6): an error, or a success with a caveat. */
export interface SaveStatus {
  readonly tone: 'error' | 'caveat';
  readonly text: string;
  readonly actions: readonly SaveStatusAction[];
}

/** What is being saved: the copy names it (phase-6.md §10.2: "Your show is kept in this browser."). */
export type SaveNoun = 'shell' | 'show';

/** Words an issue for the visitor; shows pass their §15 labels. */
export type ReasonOf = (issue: ShellIssue) => string;

const kept = (noun: SaveNoun) => `Your ${noun} is kept in this browser.`;
const KEPT = kept('shell');

/** §6 row 404b: the remix's source was gone, and the plain POST saved it. */
export function fellBackStatus(name: string): SaveStatus {
  return {
    tone: 'caveat',
    text: `Saved ${quoted(name)} as a new creation. The original it came from was deleted, so the two aren't linked.`,
    actions: [],
  };
}

/** §6 row 404a: Update original found nothing to update. */
export function updateGoneStatus(sourceName: string, noun: SaveNoun = 'shell'): SaveStatus {
  const what = sourceName ? quoted(sourceName) : 'the original';
  return {
    tone: 'error',
    text: `Couldn't update ${what}: the original was deleted or is no longer yours. Nothing was saved. Save as new to keep your ${noun} with a new share link.`,
    actions: ['saveAsNew'],
  };
}

/** §6 row 400b for the client's own strict check, which runs before any request (§3.1). */
export function invalidStatus(
  issues: readonly ShellIssue[],
  reasonOf: ReasonOf,
  truncated = false,
  noun: SaveNoun = 'shell',
): SaveStatus {
  return {
    tone: 'error',
    text: `Couldn't save: the server didn't accept this ${noun} (${reasons(issues, reasonOf, truncated)}). Reloading the page usually fixes this. ${kept(noun)}`,
    actions: ['reload'],
  };
}

/** §6 row 413, also the client-side size check (§3.1). */
export function tooLargeStatus(noun: SaveNoun): SaveStatus {
  return {
    tone: 'error',
    text: `Couldn't save: this ${noun} is larger than the 256 KB the server accepts. Nothing was saved. Your work is kept in this browser.`,
    actions: [],
  };
}
export const TOO_LARGE_STATUS: SaveStatus = tooLargeStatus('shell');

/**
 * The status block for a failed save (§6). A 404 from a remix never gets here (it falls back);
 * a 404 from a create is a server fault as far as the visitor can tell.
 */
export function saveFailureStatus(
  error: CreationError,
  request: SavePlan['request'],
  sourceName: string,
  reasonOf: ReasonOf,
  noun: SaveNoun = 'shell',
): SaveStatus {
  const KEPT = kept(noun);
  switch (error.kind) {
    case 'validation': {
      const issues: ShellIssue[] = error.errors.map((e) => ({
        path: e.path,
        code: e.code as ShellIssue['code'],
        message: '',
      }));
      if (issues.some((i) => i.code === 'version' && i.path === 'version')) {
        return {
          tone: 'error',
          text: `Couldn't save: this page is out of date. Reload to get the latest version, then save again. ${KEPT}`,
          actions: ['reload'],
        };
      }
      return invalidStatus(issues, reasonOf, error.truncated, noun);
    }
    case 'unauthorized':
      return signedOutStatus(noun);
    case 'precondition-failed':
      return changedElsewhereStatus(sourceName);
    case 'precondition-required':
      return outOfDateStatus(sourceName, noun);
    case 'not-found':
      if (request === 'update') return updateGoneStatus(sourceName, noun);
      return serverFault(noun);
    case 'too-large':
      return tooLargeStatus(noun);
    case 'rate-limited':
      return {
        tone: 'error',
        text: `Couldn't save: too many saves in a short time. Try again ${retryWhen(error.retryAfterSeconds)}. ${KEPT}`,
        actions: [],
      };
    case 'network':
      return {
        tone: 'error',
        text: `Couldn't save: can't reach the server. Check your connection and try again. ${KEPT}`,
        actions: ['retry'],
      };
    default:
      return serverFault(noun);
  }
}

/** phase-8.md §9.1: a 401 on any save. The 401 interceptor has reloaded the session. */
export function signedOutStatus(noun: SaveNoun): SaveStatus {
  return {
    tone: 'error',
    text: `Couldn't save: you've been signed out. Sign in to save; your ${noun} is kept in this browser.`,
    actions: ['signIn'],
  };
}

/** phase-8.md §9.2: 412 on Update original. Save as new is the remix; Replace re-reads, then PUTs. */
export function changedElsewhereStatus(sourceName: string): SaveStatus {
  const what = sourceName ? quoted(sourceName) : 'the original';
  return {
    tone: 'error',
    text: `Couldn't update ${what}: it was changed somewhere else (another tab or device) after you opened it. Nothing was saved. Save as new keeps both versions; Replace puts yours on its share link and discards the other changes.`,
    actions: ['saveAsNew', 'replace'],
  };
}

/** phase-8.md §9.3: 428, or a source with no token (no request is sent). */
export function outOfDateStatus(sourceName: string, noun: SaveNoun): SaveStatus {
  const what = sourceName ? quoted(sourceName) : 'the original';
  return {
    tone: 'error',
    text: `Couldn't update ${what}: this page is out of date. Reload, then save again. Your ${noun} is kept in this browser.`,
    actions: ['reload'],
  };
}

function serverFault(noun: SaveNoun): SaveStatus {
  return {
    tone: 'error',
    text: `Couldn't save: something went wrong on the server. Try again in a moment. ${kept(noun)}`,
    actions: ['retry'],
  };
}

/** Reasons listed before `, and {k} more` (§6 rules). */
export const MAX_REASONS = 3;

/** §6 `{reasons}`: at most 3 joined with `; `, then `, and {k} more`, or `, and more` when truncated. */
export function reasons(
  issues: readonly ShellIssue[],
  reasonOf: ReasonOf,
  truncated = false,
): string {
  const listed = issues
    .slice(0, MAX_REASONS)
    .map((i) => reasonOf(i))
    .join('; ');
  if (truncated) return `${listed}, and more`;
  const rest = issues.length - MAX_REASONS;
  return rest > 0 ? `${listed}, and ${rest} more` : listed;
}

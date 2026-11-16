import {
  CUE_LIMITS,
  MAX_SHOW_CUES,
  MAX_SHOW_SHELLS,
  SHOW_LIMITS,
} from '../../../../engine/model/limits';
import type { ShellIssue } from '../../../../engine/model/normalize';
import { CUE_FIELD_LABELS, fieldLabel } from '../../../../engine/model/labels';
import { isolate } from '../../../shared/bidi';
import { issueReason } from '../../designer/shared/designer-copy';

/**
 * Show Builder copy (docs/fireworks-app/design/phase-6.md), verbatim, and the time formats it
 * uses: `m:ss.s` where a visitor reads a time, spoken as `12.5 seconds` or `1 minute 2.5 seconds`.
 * Every `{name}` is text, isolated (Boo C1, C3).
 */

/** `0:12.5`, `10:00.0` (phase-6.md header). Negative times read as 0. */
export function formatTime(t: number): string {
  const tenths = Math.max(0, Math.round(t * 10));
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const s = Math.floor(rest / 10);
  return `${m}:${String(s).padStart(2, '0')}.${rest % 10}`;
}

/** `1:07`: whole seconds, for the ruler, the end estimate and the player's meta line. */
export function formatClock(t: number): string {
  const total = Math.max(0, Math.round(t));
  const m = Math.floor(total / 60);
  return `${m}:${String(total - m * 60).padStart(2, '0')}`;
}

/** `12.5 seconds`, `1 minute 2.5 seconds` (aria-valuetext). */
export function spokenTime(t: number): string {
  const tenths = Math.max(0, Math.round(t * 10));
  const m = Math.floor(tenths / 600);
  const sec = (tenths - m * 600) / 10;
  const secText = `${Number.isInteger(sec) ? sec : sec.toFixed(1)} ${sec === 1 ? 'second' : 'seconds'}`;
  if (m === 0) return secText;
  const minText = `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  return sec === 0 ? minText : `${minText} ${secText}`;
}

/** Whole-second spoken form for the scrub bar's "of about ..." part. */
export function spokenClock(t: number): string {
  return spokenTime(Math.round(t));
}

/** `{n} cues` / `1 cue`. */
export function cueCount(n: number): string {
  return `${n} ${n === 1 ? 'cue' : 'cues'}`;
}

export const BUILDER_SUBTITLE = 'Show Builder';
/** The API banner's sentence on the builder (phase-6.md §19.2 B1). */
export const BUILDER_API_BANNER =
  "Can't reach the server right now. You can keep building; your show is kept in this browser.";
export const NEW_SHOW_NAME = 'New show';
export const DEFAULT_DURATION = 60;

export const HINT_FINE = 'Click the sky to add a cue at the playhead \u00b7 Space to play';
export const HINT_COARSE = 'Tap the sky to add a cue at the playhead';

export const SKY_NOTE =
  'Every shell in the show plays under this sky. Gravity also changes how long shells take to rise, so burst markers move.';
export const DURATION_NOTE =
  'The launch window. The show keeps playing after it until the last spark fades.';
/** B7 (phase-7.md §10): a blank, non-number or out-of-range Duration entry. */
export const DURATION_RANGE_NOTE = `Duration is between ${SHOW_LIMITS.duration.min} and ${SHOW_LIMITS.duration.max} seconds.`;
export function durationBlockedNote(lastT: number): string {
  return `The last cue launches at ${formatTime(lastT)}, so the window can't end before it. Move or delete that cue first.`;
}

export const INSPECTOR_NONE = 'Select a cue on the timeline to edit it.';
export const INSPECTOR_EMPTY =
  'Add a cue to start: pick a shell in the Library, then press Add cue or click the sky.';
export const POSITION_NOTE = 'Where it bursts across the sky: 0% is the left edge.';
export const NEW_SEED_TITLE =
  'Pick a new random seed. The burst keeps its shell, time and place but scatters differently.';
export function launchTimeRangeNote(duration: number): string {
  return `Launch time is between 0 and ${trimNumber(duration)} seconds.`;
}
export function cueTimesNote(burst: number, fade: number): string {
  return `Bursts at ${formatTime(burst)} \u00b7 fades by about ${formatTime(fade)}`;
}

export const EMPTY_SAVE_NOTE = 'A show needs at least one cue before it can be saved.';
export const EMPTY_LANE =
  'No cues yet. Pick a shell in the Library, then press Add cue or click the sky.';
export const CUE_CAP = `${MAX_SHOW_CUES} cues, the most a show can have. Delete a cue to add another.`;
export const SHELL_CAP = `This show already holds ${MAX_SHOW_SHELLS} shells, the most it can. Use a shell that's already in it, or remove an unused one.`;
export function pastWindow(duration: number): string {
  return `The playhead is past the launch window, which ends at ${formatClock(duration)}. Move it back, or raise Duration.`;
}
export function earlyEndNote(end: number, duration: number): string {
  return `The show ends at about ${formatClock(end)}, before its launch window closes at ${formatClock(duration)}. Add cues later in the window, or lower Duration.`;
}
/** The library drag's short blocked labels (phase-7.md §7.1); the full sentence is announced. */
export const DROP_LABEL_CUE_CAP = `Show is full (${MAX_SHOW_CUES} cues)`;
export const DROP_LABEL_SHELL_CAP = `Show already has ${MAX_SHOW_SHELLS} shells`;
/** K8 (phase-7.md §3.2): the builder's bypass link. */
export const SKIP_TO_TRANSPORT = 'Skip to the timeline controls';
export const NOTICE_HOLDS_PLAY = 'Close the flashing notice on the stage to play.';
export const PLAY_HELD_TITLE = 'Close the flashing notice to play.';
export const TIMELINE_HELP =
  'Left and Right select cues. Comma and period move the selected cue. A adds, D duplicates, Delete removes. Plus and minus zoom.';
export const LIBRARY_NOTE =
  "New cues use the selected shell. Shells are copied into the show and play under the show's sky, not their own.";
export const MY_SHELLS_EMPTY = 'No saved shells yet. Save one in the designer to use it here.';

export function catchingUp(t: number): string {
  return `Catching up to ${formatTime(t)}\u2026`;
}

/** Builder flashing notice (phase-6.md §14.1). */
export const BUILDER_NOTICE_OFF =
  'You can play the show once you close this notice. Bursts flash, and some effects strobe. If flashing affects you, turn on Reduce flashing first. You can pause at any time.';
export const BUILDER_NOTICE_ON =
  'You can play the show once you close this notice. Reduce flashing is on, so strobe is off and burst flashes are dimmed and spaced out. You can change this under Display.';

/** Live-region sentences (phase-6.md §16.3). */
export function selectedAnnouncement(
  index: number,
  total: number,
  shellName: string,
  launch: number,
  burst: number,
  x: number,
): string {
  return `Cue ${index} of ${total}: ${isolate(shellName)}, launches ${formatTime(launch)}, bursts ${formatTime(burst)}, ${Math.round(x * 100)}% across.`;
}
export function addedAnnouncement(shellName: string, t: number): string {
  return `Added ${isolate(shellName)} at ${formatTime(t)}.`;
}
export function duplicatedAnnouncement(t: number): string {
  return `Duplicated to ${formatTime(t)}.`;
}
export function deletedAnnouncement(t: number, left: number): string {
  return `Deleted cue at ${formatTime(t)}. ${cueCount(left)}.`;
}
export const SHOW_ENDED = 'The show has ended.';

/** Confirm copy (phase-6.md §10.3, §4.3). Blank names drop `, {name},` mechanically. */
function namePart(name: string): string {
  return name.trim() ? `, \u201c${isolate(name)}\u201d,` : '';
}
export function confirmOpenShowTitle(linkName: string): string {
  return `Open \u201c${isolate(linkName)}\u201d?`;
}
export function confirmOpenShowBody(currentName: string, linkName: string): string {
  return `This replaces your current show${namePart(currentName)} including its cues, shells and sky, with a copy of \u201c${isolate(linkName)}\u201d. Display settings stay as they are.`;
}
export const CONFIRM_OPEN_ACTION = 'Open copy';
export const CONFIRM_NEW_TITLE = 'Start a new show?';
export const CONFIRM_NEW_ACTION = 'Start new show';
export function confirmNewBody(currentName: string, cues: number): string {
  return `This replaces your current show${namePart(currentName)} and its ${cueCount(cues)} with an empty show. Display settings stay as they are.`;
}
export const CONFIRM_KEEP = 'Keep editing';
export function confirmRemoveShellTitle(shellName: string): string {
  return `Remove \u201c${isolate(shellName)}\u201d from the show?`;
}
export function confirmRemoveShellBody(n: number): string {
  return `Its ${n === 1 ? '1 cue is' : `${n} cues are`} deleted too. Your other cues don't change.`;
}
export const CONFIRM_REMOVE_KEEP = 'Keep it';
export const CONFIRM_REMOVE_ACTION = 'Remove shell and cues';

/** Library item failures (phase-6.md §13.1). */
export function mineGoneNote(name: string): string {
  return `\u201c${isolate(name)}\u201d was deleted, so it can't be added. Nothing changed.`;
}
export function mineOfflineNote(name: string): string {
  return `Couldn't load \u201c${isolate(name)}\u201d. Check your connection, then try again.`;
}
export function mineServerNote(name: string): string {
  return `Couldn't load \u201c${isolate(name)}\u201d right now. Try again in a moment.`;
}
export function mineNewerNote(name: string): string {
  return `\u201c${isolate(name)}\u201d was saved by a newer version of the app. Reload to use it.`;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// ---------------------------------------------------------------------------------------------
// Issue paths (phase-6.md §15, Peach N1): cues by launch time, shells by name, against the
// document that was sent or applied.
// ---------------------------------------------------------------------------------------------

/** What the labels need from the document: anything shaped like a show, possibly invalid. */
export interface ShowForLabels {
  readonly cues?: unknown;
  readonly shells?: unknown;
}

function cueHandle(doc: ShowForLabels, i: number): string {
  const cues = Array.isArray(doc.cues) ? doc.cues : [];
  const cue: unknown = cues[i];
  const t = typeof cue === 'object' && cue !== null ? (cue as { t?: unknown }).t : undefined;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= SHOW_LIMITS.duration.max
    ? `Cue at ${formatTime(t)}`
    : `Cue ${i + 1}`;
}

function quoteKey(key: string): string {
  return `\u201c${key.replace(/[\\"]/g, (c) => `\\${c}`)}\u201d`;
}

/** `{shellName}`: the embedded shell's non-blank name, else `shell “{key}”`. */
export function embeddedShellName(doc: ShowForLabels, key: string): string {
  const shells = typeof doc.shells === 'object' && doc.shells !== null ? doc.shells : {};
  const shell: unknown = Object.hasOwn(shells, key)
    ? (shells as Record<string, unknown>)[key]
    : null;
  const name =
    typeof shell === 'object' && shell !== null ? (shell as { name?: unknown }).name : null;
  return typeof name === 'string' && name.trim() ? isolate(name) : `shell ${quoteKey(key)}`;
}

/** Splits `shells.<key>` / `shells["<key>"]` from the rest of the path. */
function splitShellPath(path: string): { key: string; rest: string } | null {
  const plain = /^shells\.([A-Za-z_$][\w$-]*)(.*)$/.exec(path);
  if (plain) return { key: plain[1], rest: plain[2].replace(/^\./, '') };
  const bracket = /^shells\["((?:[^"\\]|\\.)*)"\](.*)$/.exec(path);
  if (bracket)
    return { key: bracket[1].replace(/\\(["\\])/g, '$1'), rest: bracket[2].replace(/^\./, '') };
  return null;
}

/** A show path in field language (phase-6.md §15). */
export function showFieldLabel(path: string, doc: ShowForLabels): string {
  if (path === 'sky.gravity') return 'Gravity (Sky)';
  if (path === 'sky.wind') return 'Wind (Sky)';
  if (path === 'name') return 'Name';
  if (path === 'duration') return 'Duration';
  const cue = /^cues\[(\d+)\](?:\.(\w+))?$/.exec(path);
  if (cue) {
    const handle = cueHandle(doc, Number(cue[1]));
    if (!cue[2]) return handle;
    return `${(Object.hasOwn(CUE_FIELD_LABELS, cue[2]) ? CUE_FIELD_LABELS[cue[2]] : undefined) ?? cue[2]} (${handle})`;
  }
  const shell = splitShellPath(path);
  if (shell) {
    const name = embeddedShellName(doc, shell.key);
    if (!shell.rest) return name;
    const brk = /^breaks\[(\d+)\](?:\.(\w+))?$/.exec(shell.rest);
    if (brk) {
      const n = Number(brk[1]) + 1;
      return brk[2] ? `${fieldLabel(brk[2])} (${name}, Break ${n})` : `Break ${n} (${name})`;
    }
    return `${fieldLabel(shell.rest)} (${name})`;
  }
  return fieldLabel(path);
}

/** `issueReason` for a show issue, with §15 labels and the codes deferred to this review. */
export function showIssueReason(issue: ShellIssue, doc: ShowForLabels): string {
  const label = showFieldLabel(issue.path, doc);
  const cue = /^cues\[(\d+)\]\.(\w+)$/.exec(issue.path);
  switch (issue.code as string) {
    case 'key-format': {
      const key = typeof issue.value === 'string' ? issue.value : '';
      return `shell key ${quoteKey(key)} isn't valid: use up to 12 letters, digits, - or _, starting with a letter`;
    }
    case 'duplicate-id':
      return typeof issue.value === 'string'
        ? `Cue id ${issue.value} is used by more than one cue`
        : 'A cue id is used by more than one cue';
    case 'unknown-shell':
      return `${label} names a shell this show doesn't have`;
  }
  if (cue && issue.code === 'out-of-range') {
    const field = cue[2] as keyof typeof CUE_LIMITS;
    const range = Object.hasOwn(CUE_LIMITS, field) ? CUE_LIMITS[field] : null;
    const value =
      typeof issue.value === 'number' && Number.isFinite(issue.value) ? ` ${issue.value}` : '';
    return range
      ? `${label}${value} is outside ${range.min} to ${range.max}`
      : `${label}${value} is out of range`;
  }
  if (issue.path === 'duration' && issue.code === 'out-of-range') {
    return `Duration is outside ${SHOW_LIMITS.duration.min} to ${SHOW_LIMITS.duration.max}`;
  }
  if (
    issue.code === 'unknown-property' ||
    issue.code === 'too-long' ||
    issue.code === 'name-format'
  ) {
    return issueReason(issue);
  }
  // Reword the shell-relative reason with the show label in place of the shell one.
  const shell = splitShellPath(issue.path);
  const inner = shell ? shell.rest : cue ? cue[2] : issue.path;
  const reason = issueReason({ ...issue, path: inner });
  const innerLabel = fieldLabel(inner);
  return reason.startsWith(innerLabel) ? label + reason.slice(innerLabel.length) : reason;
}

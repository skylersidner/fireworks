/**
 * Copy for share-link pages (docs/fireworks-app/design/phase-5.md §7.3, §8.4, §9), verbatim. A
 * message is a heading, paragraphs and the buttons it offers. Never built from a server `message`
 * or a document's `version` value (Boo C15).
 */

/** Where the visitor came in: the player (`/s/`) or the working-copy link (`/c/`). */
import { isolate } from './bidi';

export type LinkSurface = 'player' | 'copy';

export type LinkAction = 'home' | 'builder' | 'reload' | 'retry';

/** A creation's kind when the response said it; null when it's unknown. */
export type LinkKind = 'shell' | 'show' | null;

export interface LinkMessage {
  readonly heading: string;
  readonly body: readonly string[];
  /** The first is the primary button. */
  readonly actions: readonly { readonly action: LinkAction; readonly label: string }[];
  /** `<title>`. */
  readonly title: string;
}

export const SITE_TITLE = 'Fireworks Sandbox';

/** The `<title>` of a playing or opening creation: no curly quotes (§8.1); the name isolated (Boo C3). */
export function creationTitle(name: string): string {
  return `${isolate(name)} · ${SITE_TITLE}`;
}

/** Kind unknown (phase-6.md §10.4, D2): the link could have been either kind. */
const NOTHING_CHANGED = 'Nothing in the designer or the Show Builder has changed.';
const DESIGNER_UNCHANGED = "Your shell in the designer hasn't changed.";
const BUILDER_UNCHANGED = "Your show in the Show Builder hasn't changed.";
const GO_TO_DESIGNER = { action: 'home', label: 'Go to the designer' } as const;
const GO_TO_BUILDER = { action: 'builder', label: 'Go to the Show Builder' } as const;
const TRY_AGAIN = { action: 'retry', label: 'Try again' } as const;

/** §9: one page for a bad-format code and a 404, on both surfaces. */
export function notFoundMessage(surface: LinkSurface): LinkMessage {
  const body = [
    'The link may be mistyped or cut short, or the creation was deleted. Share links are case-sensitive, so check capital letters too.',
  ];
  if (surface === 'copy') body.push(NOTHING_CHANGED);
  return {
    heading: 'Nothing plays at this link',
    body,
    actions: [surface === 'copy' ? GO_TO_DESIGNER : { action: 'home', label: 'Make your own' }],
    title: `Link not found · ${SITE_TITLE}`,
  };
}

/** §7.3 / §8.4: the document's `version` is newer than this bundle (show: phase-6.md §10.4). */
export function newerVersionMessage(surface: LinkSurface, kind: LinkKind = 'shell'): LinkMessage {
  if (surface === 'copy' && kind === 'show') {
    return {
      heading: 'This show needs a newer version of the app.',
      body: [
        'It was saved by a newer version of Fireworks Sandbox than this page has. Reload to open it.',
      ],
      actions: [{ action: 'reload', label: 'Reload' }, GO_TO_BUILDER],
      title: SITE_TITLE,
    };
  }
  return surface === 'copy'
    ? {
        heading: 'This shell needs a newer version of the app.',
        body: [
          'It was saved by a newer version of Fireworks Sandbox than this page has. Reload to open it.',
        ],
        actions: [{ action: 'reload', label: 'Reload' }, GO_TO_DESIGNER],
        title: SITE_TITLE,
      }
    : {
        heading: 'This creation needs a newer version of the app.',
        body: [
          'It was saved by a newer version of Fireworks Sandbox than this page has. Reload to play it.',
        ],
        actions: [{ action: 'reload', label: 'Reload' }],
        title: SITE_TITLE,
      };
}

/** §7.3 / §8.4: normalize rejected a current-version document (show: phase-6.md §10.4). */
export function invalidMessage(surface: LinkSurface, kind: LinkKind = 'shell'): LinkMessage {
  if (surface === 'copy' && kind === 'show') {
    return {
      heading: "This show can't be opened.",
      body: [`Its saved data isn't valid in this version of the app. ${BUILDER_UNCHANGED}`],
      actions: [GO_TO_BUILDER],
      title: SITE_TITLE,
    };
  }
  return surface === 'copy'
    ? {
        heading: "This shell can't be opened.",
        body: [`Its saved data isn't valid in this version of the app. ${DESIGNER_UNCHANGED}`],
        actions: [GO_TO_DESIGNER],
        title: SITE_TITLE,
      }
    : {
        heading: "This creation can't be played.",
        body: ["Its saved data isn't valid in this version of the app."],
        actions: [{ action: 'home', label: 'Make your own' }],
        title: SITE_TITLE,
      };
}

/** §7.3 / §8.4 status 0, 429 and 5xx, kind unknown (phase-6.md §10.4). Never "doesn't exist" (Boo C12). */
export function loadFailureMessage(
  surface: LinkSurface,
  failure: 'network' | 'rate-limited' | 'server',
  when: string,
): LinkMessage {
  const copy = surface === 'copy';
  const extra = copy ? [GO_TO_DESIGNER] : [];
  if (failure === 'network') {
    return {
      heading: "Can't reach the server.",
      body: [
        copy
          ? `The shared creation couldn't be loaded. Check your connection and try again. ${NOTHING_CHANGED}`
          : "This creation couldn't be loaded. Check your connection and try again.",
      ],
      actions: [TRY_AGAIN, ...extra],
      title: SITE_TITLE,
    };
  }
  if (failure === 'rate-limited') {
    return {
      heading: 'Too many requests right now.',
      body: [`Try again ${when}.`],
      actions: [TRY_AGAIN, ...extra],
      title: SITE_TITLE,
    };
  }
  return {
    heading: 'Something went wrong on the server.',
    body: [copy ? `Try again in a moment. ${NOTHING_CHANGED}` : 'Try again in a moment.'],
    actions: [TRY_AGAIN, ...extra],
    title: SITE_TITLE,
  };
}

/**
 * §6 `{when}` from `Retry-After` seconds: under 60 s `in {n} seconds`; up to 90 minutes
 * `in {m} minutes`, rounded up; longer `in about {h} hours`; unknown `in a minute`.
 */
export function retryWhen(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'in a minute';
  if (seconds < 60) {
    const n = Math.max(1, Math.ceil(seconds));
    return `in ${n} ${n === 1 ? 'second' : 'seconds'}`;
  }
  if (seconds <= 90 * 60) {
    const m = Math.ceil(seconds / 60);
    return `in ${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  const h = Math.round(seconds / 3600);
  return `in about ${h} ${h === 1 ? 'hour' : 'hours'}`;
}

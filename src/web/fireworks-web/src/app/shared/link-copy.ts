/**
 * Copy for share-link pages (docs/fireworks-app/design/phase-5.md §7.3, §8.4, §9), verbatim. A
 * message is a heading, paragraphs and the buttons it offers. Never built from a server `message`
 * or a document's `version` value (Boo C15).
 */

/** Where the visitor came in: the player (`/s/`) or the working-copy link (`/c/`). */
import { isolate } from './bidi';

export type LinkSurface = 'player' | 'copy';

export type LinkAction = 'home' | 'reload' | 'retry';

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

const DESIGNER_UNCHANGED = "Your shell in the designer hasn't changed.";
const GO_TO_DESIGNER = { action: 'home', label: 'Go to the designer' } as const;
const TRY_AGAIN = { action: 'retry', label: 'Try again' } as const;

/** §9: one page for a bad-format code and a 404, on both surfaces. */
export function notFoundMessage(surface: LinkSurface): LinkMessage {
  const body = [
    'The link may be mistyped or cut short, or the creation was deleted. Share links are case-sensitive, so check capital letters too.',
  ];
  if (surface === 'copy') body.push(DESIGNER_UNCHANGED);
  return {
    heading: 'Nothing plays at this link',
    body,
    actions: [surface === 'copy' ? GO_TO_DESIGNER : { action: 'home', label: 'Make your own' }],
    title: `Link not found · ${SITE_TITLE}`,
  };
}

/** §7.3 / §8.4: the document's `version` is newer than this bundle. */
export function newerVersionMessage(surface: LinkSurface): LinkMessage {
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

/** §7.3 / §8.4: normalize rejected a current-version document (validator drift). */
export function invalidMessage(surface: LinkSurface): LinkMessage {
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

/** §8.2 coordinator default (Q4): a show until Phase 6. The draft is untouched. */
export function showNotSupportedMessage(): LinkMessage {
  return {
    heading: "This show can't be played yet.",
    body: ['Shows arrive in a later version of Fireworks Sandbox.'],
    actions: [GO_TO_DESIGNER],
    title: SITE_TITLE,
  };
}

/** §7.3 / §8.4 status 0, 429 and 5xx. Never "doesn't exist" (Boo C12). */
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
          ? `The shared shell couldn't be loaded. Check your connection and try again. ${DESIGNER_UNCHANGED}`
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
    body: [copy ? `Try again in a moment. ${DESIGNER_UNCHANGED}` : 'Try again in a moment.'],
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

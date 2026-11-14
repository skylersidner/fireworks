import { Observable, catchError, map, of } from 'rxjs';
import type { ShellAdjustment } from '../../engine/model/normalize';
import { openShell } from '../../engine/model/open';
import { SHELL_VERSION, type ShellDocument } from '../../engine/model/shell';
import { CreationsService, toCreationError } from './creations';
import type { CreationResponse } from './models';
import { isShareCode } from './share-code';

/**
 * What a share link opened as (plan Phase 5; schema.md §8.3, §11.1; Boo C4, C5, C12). The player
 * and `/c/:code` both read a link through `openCreation`, so neither can skip a check:
 *
 *   route code → §9 pattern (no request on failure) → GET → runtime `kind` → response `shareCode`
 *   → `openShell` (upgrade, then lenient normalize) → the caller plays or edits `shell`.
 *
 * - `not-found`: a bad code, a 404, or a `kind` that is neither `'shell'` nor `'show'`. One page
 *   for all of them (C12).
 * - `show`: a show before Phase 6 (coordinator default for Q4).
 * - `newer`: the document's `version` is a number above this bundle's; the reload copy.
 * - `invalid`: anything else that won't open (normalize failure, a bad response code, a version
 *   that isn't a number); its `version` value is never shown (C15).
 * - `network`, `rate-limited`, `server`: couldn't load; never "doesn't exist".
 * - `shell`: `shell` is the normalized document, and its `name` is the one to display (C5).
 *   `response` is kept for the caller's `source`; its lineage field is never rendered (C10).
 */
export type OpenedCreation =
  | {
      readonly status: 'shell';
      readonly shell: ShellDocument;
      readonly response: CreationResponse;
    }
  | { readonly status: 'show' | 'not-found' | 'newer' | 'invalid' | 'network' | 'server' }
  | { readonly status: 'rate-limited'; readonly retryAfterSeconds: number | null };

/** Fetches and opens the creation at `code`. Never errors; one GET at most (none for a bad code). */
export function openCreation(
  creations: CreationsService,
  code: string,
): Observable<OpenedCreation> {
  if (!isShareCode(code)) return of({ status: 'not-found' });
  return creations.getByShareCode(code).pipe(
    map((response) => classifyCreation(response)),
    catchError((error: unknown) => {
      const e = toCreationError(error);
      switch (e.kind) {
        case 'not-found':
          return of<OpenedCreation>({ status: 'not-found' });
        case 'network':
          return of<OpenedCreation>({ status: 'network' });
        case 'rate-limited':
          return of<OpenedCreation>({
            status: 'rate-limited',
            retryAfterSeconds: e.retryAfterSeconds,
          });
        default:
          return of<OpenedCreation>({ status: 'server' });
      }
    }),
  );
}

/** The checks after the GET, pure. Logs adjustments and failures by code and path only (C16). */
export function classifyCreation(response: unknown): OpenedCreation {
  if (typeof response !== 'object' || response === null) return { status: 'invalid' };
  const r = response as CreationResponse;
  const kind: unknown = r.kind;
  if (kind === 'show') return { status: 'show' };
  if (kind !== 'shell') return { status: 'not-found' };
  if (!isShareCode(r.shareCode)) return { status: 'invalid' };

  const opened = openShell(r.document);
  if (!opened.ok) {
    const version = opened.errors.find((e) => e.code === 'version');
    const newer =
      version !== undefined && typeof version.value === 'number' && version.value > SHELL_VERSION;
    console.warn(`Creation ${r.shareCode} could not be opened:`, issueList(opened.errors));
    return { status: newer ? 'newer' : 'invalid' };
  }
  if (opened.adjustments.length) {
    // schema.md §8.3: a current-version document the lenient walk had to adjust.
    console.warn(`Creation ${r.shareCode} was adjusted on open:`, issueList(opened.adjustments));
  }
  return { status: 'shell', shell: opened.shell, response: r };
}

function issueList(items: readonly (ShellAdjustment | { path: string; code: string })[]): string[] {
  return items.map((i) => `${'kind' in i ? i.kind : i.code} ${i.path || '(root)'}`);
}

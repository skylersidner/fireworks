import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { CreationError, CreationsService, toCreationError } from './creations';
import { CreationKind, CreationResponse } from './models';
import { isShareCode } from './share-code';

/**
 * Save on a working copy (plan Phase 5 "Links and Save"; schema.md §11.2, §11.4). The decision is
 * pure (`saveChoices`, `planSave`, `fallbackPlan`, `sourceFrom`); `saveCreation` runs it over
 * CreationsService. Shells use it now and shows in Phase 6, so nothing here knows a document's
 * shape.
 */

/** The server's write limit (schema.md §2.5): 256 KiB of UTF-8 request body. */
export const MAX_BODY_BYTES = 262_144;

/**
 * The saved record a working copy came from: client state in the draft, never in a document
 * (schema.md §7, §11.2). Set only by a link load (`/c/:code`) or a successful save, both through
 * `sourceFrom`. `isOwner` is a snapshot that picks which Save choices to show; the server decides
 * (a PUT on a record no longer owned is 404). `updatedAt` is an opaque token (compare strings),
 * kept for the future `If-Match` precondition (§11.4).
 */
export interface CreationSource {
  readonly shareCode: string;
  readonly kind: CreationKind;
  readonly isOwner: boolean;
  readonly updatedAt: string;
  /**
   * The saved record's name, for copy only ("Update original changes what the share link for
   * {name} plays", phase-5.md §2.2; Rosalina's Y1). Never decides anything. The server's name, so
   * a blank name reads "Custom".
   */
  readonly name: string;
}

/** What the Save control offers. `save` is the single, no-choice Save. */
export type SaveChoice = 'save' | 'update' | 'saveAsNew';

/** The request one save attempt sends. */
export type SavePlan =
  | { readonly request: 'create' }
  | { readonly request: 'update'; readonly shareCode: string }
  | { readonly request: 'remix'; readonly shareCode: string };

/** The draft's `source` after a save or link load: always the record just read or written. */
export function sourceFrom(response: CreationResponse): CreationSource {
  return {
    shareCode: response.shareCode,
    kind: response.kind,
    isOwner: response.isOwner,
    updatedAt: response.updatedAt,
    name: response.name,
  };
}

/**
 * The choices Save offers (§11.4): fresh work and a non-owner's copy get one Save; an owned copy
 * gets "Update original" and "Save as new". How they're presented is Rosalina's call.
 */
export function saveChoices(source: CreationSource | null): readonly SaveChoice[] {
  return source?.isOwner ? ['update', 'saveAsNew'] : ['save'];
}

/**
 * The request for a Save (§11.4):
 *  - no `source` → `POST api/creations`;
 *  - owned source → `update` is PUT, `saveAsNew` is `POST …/remix`;
 *  - any other source → `POST …/remix`, whatever `choice` says (there is no choice to make).
 *
 * Throws on a caller bug: a choice that `saveChoices` didn't offer, or a source of another kind
 * than the document being saved (the designer never holds a show's source; `/c/:code` dispatches
 * on `kind`).
 */
export function planSave(
  source: CreationSource | null,
  choice: SaveChoice,
  kind: CreationKind,
): SavePlan {
  if (!saveChoices(source).includes(choice)) {
    throw new Error(`planSave: '${choice}' isn't offered for this working copy`);
  }
  if (source === null) return { request: 'create' };
  if (source.kind !== kind) {
    throw new Error(`planSave: a ${kind} can't be saved over a ${source.kind}'s source`);
  }
  if (choice === 'update') return { request: 'update', shareCode: source.shareCode };
  return { request: 'remix', shareCode: source.shareCode };
}

/**
 * The automatic retry after a failed attempt, or null for none (§11.2; phase-5.md §6). Only a 404
 * from `…/remix` retries by itself: the visitor already asked for a new record, so a plain
 * `POST api/creations` gives them exactly that (never another remix: remix looks the source up
 * too, so retrying it would loop). A 404 from PUT doesn't: the visitor asked to change an existing
 * link, so the caller asks first and then sends a plain create. Nothing else retries.
 */
export function fallbackPlan(failed: SavePlan, error: CreationError): SavePlan | null {
  if (error.kind !== 'not-found') return null;
  return failed.request === 'remix' ? { request: 'create' } : null;
}

export interface SaveRequest {
  readonly source: CreationSource | null;
  readonly choice: SaveChoice;
  readonly kind: CreationKind;
  /** The working copy, already validated strictly by the caller (`validateShell`/`validateShow`, §8.3). */
  readonly document: unknown;
}

/**
 * How a save ended. Never an Observable error: a failure is a value, so a subscriber can't forget
 * it (every creation call suppresses the generic toast).
 *
 * - `request` is what wrote (or last failed): `create` after a fallback.
 * - `fellBack` is true when the source was gone and the copy was saved as new instead. That's a
 *   success with a caveat (`rosalina-partial-failure-is-success-with-caveat.md`); the copy is F10.
 * - `source` is the record just written; the caller stores it in the draft.
 */
export type SaveOutcome =
  | {
      readonly ok: true;
      readonly request: SavePlan['request'];
      readonly fellBack: boolean;
      readonly response: CreationResponse;
      readonly source: CreationSource;
    }
  | {
      readonly ok: false;
      readonly request: SavePlan['request'];
      readonly fellBack: boolean;
      readonly error: CreationError;
    };

/**
 * Runs one Save: the planned request, then at most one fallback (§11.2): at most two requests,
 * never two remixes, and never a retry after PUT. A response whose `shareCode` fails the §9 pattern
 * is an `unexpected` failure, so a bad code is never stored or copied (Boo C4). Throws synchronously on the caller bugs `planSave` rejects.
 */
export function saveCreation(
  creations: CreationsService,
  { source, choice, kind, document }: SaveRequest,
): Observable<SaveOutcome> {
  const plan = planSave(source, choice, kind);
  return attempt(creations, plan, kind, document, false).pipe(
    switchMap((outcome) => {
      if (outcome.ok) return of(outcome);
      const retry = fallbackPlan(plan, outcome.error);
      return retry ? attempt(creations, retry, kind, document, true) : of(outcome);
    }),
  );
}

function attempt(
  creations: CreationsService,
  plan: SavePlan,
  kind: CreationKind,
  document: unknown,
  fellBack: boolean,
): Observable<SaveOutcome> {
  const call =
    plan.request === 'create'
      ? creations.create(kind, document)
      : plan.request === 'update'
        ? creations.update(plan.shareCode, document)
        : creations.remix(plan.shareCode, document);
  return call.pipe(
    map((response): SaveOutcome =>
      isShareCode(response?.shareCode)
        ? { ok: true, request: plan.request, fellBack, response, source: sourceFrom(response) }
        : {
            ok: false,
            request: plan.request,
            fellBack,
            error: { kind: 'unexpected', status: 200 },
          },
    ),
    catchError((error: unknown) =>
      of<SaveOutcome>({
        ok: false,
        request: plan.request,
        fellBack,
        error: toCreationError(error),
      }),
    ),
  );
}

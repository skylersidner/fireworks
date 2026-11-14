import { HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { ApiService } from './api';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import {
  CreateCreationRequest,
  CreationKind,
  CreationListPage,
  CreationResponse,
  RemixCreationRequest,
  UpdateCreationRequest,
  ValidationIssue,
} from './models';
import { isShareCode } from './share-code';

/** `GET api/me/creations` query (schema.md §2.2.1). Absent parameters take the server defaults (1, 24, both kinds). */
export interface CreationListQuery {
  page?: number;
  pageSize?: number;
  kind?: CreationKind;
}

/**
 * Every creation call renders its own failure (inline validation, the player's not-found page,
 * the Save-failure copy, My creations' notices), so all of them carry SUPPRESS_ERROR_TOAST and the
 * interceptor's generic toast never doubles a page's own message (the reference's custom-moves
 * convention). The interceptor still logs method, URL and status. **The cost:** a caller that
 * ignores an error shows nothing, so every subscriber must handle `error` (map it with
 * `toCreationError`).
 */
function inlineErrorContext(): HttpContext {
  return new HttpContext().set(SUPPRESS_ERROR_TOAST, true);
}

/**
 * The creations endpoints (plan Phase 5; schema.md §2.3), a thin mirror of CreationsController.
 * Methods emit the raw HttpErrorResponse on failure; callers map it with `toCreationError`. Save
 * decisions (which request a Save sends, the 404 fallback) live in `creation-save.ts`, not here.
 *
 * Bodies are sent as compact JSON (HttpClient's `JSON.stringify` with no indent), which matters:
 * the pretty-printed worst-case show is over the 256 KiB limit (schema.md §2.5).
 */
@Injectable({
  providedIn: 'root',
})
export class CreationsService {
  private readonly api = inject(ApiService);

  /** `POST api/creations` → 201. */
  create(kind: CreationKind, document: unknown): Observable<CreationResponse> {
    return this.api.post<CreateCreationRequest, CreationResponse>(
      '/api/creations',
      { kind, document },
      inlineErrorContext(),
    );
  }

  /** `GET api/creations/{code}` → 200. Public. A malformed code is a 404 with no request. */
  getByShareCode(shareCode: string): Observable<CreationResponse> {
    if (!isShareCode(shareCode)) return notFoundWithoutRequest(shareCode);
    return this.api.get<CreationResponse>(itemPath(shareCode), inlineErrorContext());
  }

  /** `PUT api/creations/{code}` → 200, "Update original". Owner only; anything else is 404. */
  update(shareCode: string, document: unknown): Observable<CreationResponse> {
    if (!isShareCode(shareCode)) return notFoundWithoutRequest(shareCode);
    return this.api.put<UpdateCreationRequest, CreationResponse>(
      itemPath(shareCode),
      { document },
      inlineErrorContext(),
    );
  }

  /** `DELETE api/creations/{code}` → 204. Owner only; a repeat is 404. */
  delete(shareCode: string): Observable<void> {
    if (!isShareCode(shareCode)) return notFoundWithoutRequest(shareCode);
    return this.api.delete(itemPath(shareCode), inlineErrorContext());
  }

  /**
   * `POST api/creations/{code}/remix` → 201, with the edited working copy as the body (never an
   * empty copy of the source). Needs `canWrite`, not ownership of the source.
   */
  remix(shareCode: string, document: unknown): Observable<CreationResponse> {
    if (!isShareCode(shareCode)) return notFoundWithoutRequest(shareCode);
    return this.api.post<RemixCreationRequest, CreationResponse>(
      `${itemPath(shareCode)}/remix`,
      { document },
      inlineErrorContext(),
    );
  }

  /**
   * `GET api/me/creations` → 200, newest first. 403 when writes are off: `/mine` checks
   * `session.canWrite()` and doesn't call this at all in that state (plan Phase 5).
   */
  listMine(query: CreationListQuery = {}): Observable<CreationListPage> {
    const params: string[] = [];
    if (query.page !== undefined) params.push(`page=${encodeURIComponent(query.page)}`);
    if (query.pageSize !== undefined) params.push(`pageSize=${encodeURIComponent(query.pageSize)}`);
    if (query.kind !== undefined) params.push(`kind=${encodeURIComponent(query.kind)}`);
    const path = params.length ? `/api/me/creations?${params.join('&')}` : '/api/me/creations';
    return this.api.get<CreationListPage>(path, inlineErrorContext());
  }
}

/** The one place an item URL is built. Only ever called with a code that passed `isShareCode`. */
function itemPath(shareCode: string): string {
  return `/api/creations/${shareCode}`;
}

function notFoundWithoutRequest(shareCode: string): Observable<never> {
  return throwError(
    () =>
      new HttpErrorResponse({
        status: 404,
        statusText: 'Not Found',
        url: `/api/creations/${encodeURIComponent(shareCode)}`,
        error: null,
      }),
  );
}

// ---------------------------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------------------------

/**
 * A failed creation call, by what the UI must do about it (Rosalina writes the copy, F10). Keyed
 * on the status, never on a body's text: the 404 body is fixed and the 429 body is unspecified
 * (schema.md §2.7).
 *
 * - `validation` (400): a stale tab or a client bug (§8.3). `errors` and `truncated` come from the
 *   §2.4 body; a 400 without it (a `{ message }` only body) has `errors: []`.
 * - `forbidden` (403): writes are off (`canWrite` false, or it changed since `api/me` loaded).
 * - `not-found` (404): unknown code, deleted, or not owned (indistinguishable by design, §10).
 * - `too-large` (413): over 256 KiB. Through Railway's edge it may arrive as a reset instead, which
 *   is `network` (schema.md §2.5; Boo S5 decides the copy once measured).
 * - `rate-limited` (429): `retryAfterSeconds` from `Retry-After`, or null when absent/unreadable.
 * - `network` (status 0): no response at all (offline, reset, CORS).
 * - `unexpected`: anything else (415, 409, 5xx, a non-HTTP error), with its status when there is one.
 */
export type CreationError =
  | {
      readonly kind: 'validation';
      readonly status: 400;
      readonly message: string | null;
      readonly errors: readonly ValidationIssue[];
      readonly truncated: boolean;
    }
  | { readonly kind: 'forbidden'; readonly status: 403 }
  | { readonly kind: 'not-found'; readonly status: 404 }
  | { readonly kind: 'too-large'; readonly status: 413 }
  | {
      readonly kind: 'rate-limited';
      readonly status: 429;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly kind: 'network'; readonly status: 0 }
  | { readonly kind: 'unexpected'; readonly status: number | null };

/** Maps whatever a creation call threw to a `CreationError`. `now` is for the HTTP-date form of `Retry-After`. */
export function toCreationError(error: unknown, now: number = Date.now()): CreationError {
  if (!(error instanceof HttpErrorResponse)) return { kind: 'unexpected', status: null };
  switch (error.status) {
    case 0:
      return { kind: 'network', status: 0 };
    case 400:
      return validationError(error.error);
    case 403:
      return { kind: 'forbidden', status: 403 };
    case 404:
      return { kind: 'not-found', status: 404 };
    case 413:
      return { kind: 'too-large', status: 413 };
    case 429:
      return {
        kind: 'rate-limited',
        status: 429,
        retryAfterSeconds: parseRetryAfter(error.headers?.get('Retry-After') ?? null, now),
      };
    default:
      return { kind: 'unexpected', status: error.status };
  }
}

/**
 * The §2.4 body, read defensively: the body is server input, so only well-formed issues are kept
 * (each with string `path`, `code` and `message`), and only an explicit `true` is truncated.
 */
function validationError(body: unknown): CreationError {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const rawErrors = Array.isArray(record['errors']) ? (record['errors'] as unknown[]) : [];
  const errors: ValidationIssue[] = [];
  for (const item of rawErrors) {
    if (typeof item !== 'object' || item === null) continue;
    const { path, code, message } = item as Record<string, unknown>;
    if (typeof path === 'string' && typeof code === 'string' && typeof message === 'string') {
      errors.push({ path, code, message });
    }
  }
  return {
    kind: 'validation',
    status: 400,
    message: typeof record['message'] === 'string' ? record['message'] : null,
    errors,
    truncated: record['truncated'] === true,
  };
}

/**
 * `Retry-After` is delay-seconds (what the API sends: an integer, rounded up) or an HTTP-date
 * (RFC 9110 §10.2.3). A date in the past is 0. Anything else is null.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number(trimmed);
  if (!/[A-Za-z]/.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

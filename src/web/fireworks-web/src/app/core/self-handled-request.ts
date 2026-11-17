import { HttpErrorResponse, HttpRequest } from '@angular/common/http';

/**
 * Requests whose failures are handled entirely by whoever made them, and which no global error
 * interceptor should touch. One shared predicate rather than an inline `includes()` in each
 * interceptor, so the exemption list cannot drift when a second interceptor arrives (Phase 8).
 *
 * Current entries:
 *  - /health/live  ApiStatusService's availability probe; the designer shows its own banner.
 *                  Toasting as well would show the same outage twice.
 *  - /api/me       SessionService turns a failure into `status: 'unavailable'` and canWrite false.
 *                  One outage, one message (designer-2c.md §6.3 item 2).
 */
const SELF_HANDLED_PATHS: ReadonlySet<string> = new Set(['/health/live', '/api/me']);

export function isSelfHandledRequest(request: HttpRequest<unknown>): boolean {
  return SELF_HANDLED_PATHS.has(pathOf(request.url));
}

/**
 * The request's path alone. `request.url` excludes HttpParams but can still carry a literal query
 * or fragment, and with a non-empty `apiBaseUrl` it is absolute. Matching the exact path means
 * `/api/x?next=/health/live` or `/health/live-ish` is never exempted. If `apiBaseUrl` ever gains
 * a path prefix, the entries here must gain it too (self-handled-request.spec.ts pins today's
 * same-origin shape).
 */
function pathOf(url: string): string {
  const pathAndMore = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, '');
  return pathAndMore.split(/[?#]/, 1)[0] || '/';
}

/**
 * True for a 401 from an `/api` call other than `api/me` itself: the server says this visitor is
 * signed out (an expired session, or a sign-out in another tab). httpErrorInterceptor skips its
 * generic toast for these and authInterceptor reloads the session; the page words it
 * (phase-8.md §9.1, §7).
 */
export function isSignedOutError(request: HttpRequest<unknown>, error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 401) return false;
  const path = pathOf(request.url);
  return /^\/api(\/|$)/.test(path) && path !== '/api/me';
}

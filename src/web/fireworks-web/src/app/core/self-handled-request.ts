import { HttpRequest } from '@angular/common/http';

/**
 * Requests whose failures are handled entirely by whoever made them, and which no global error
 * interceptor should touch. One shared predicate rather than an inline `includes()` in each
 * interceptor, so the exemption list cannot drift when a second interceptor arrives (Phase 8).
 *
 * Current entries:
 *  - /health/live  The root App's API-availability probe renders its own modal. Toasting as well
 *                  would show the same failure twice.
 */
const SELF_HANDLED_PATHS: ReadonlySet<string> = new Set(['/health/live']);

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

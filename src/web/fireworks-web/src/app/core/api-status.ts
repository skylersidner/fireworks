import { Injectable, computed, inject, signal } from '@angular/core';
import { HealthService } from './health';
import { SessionService } from './session';

export type ApiStatus = 'checking' | 'available' | 'unavailable';

/**
 * App-wide API availability, from one `GET /health/live` probe that the root App starts. Pages
 * read `status` instead of probing again, so a cold start issues exactly one probe whatever the
 * route (app.startup.spec.ts).
 *
 * Nothing here blocks: anonymous play never needs the server (plan §3.4). The designer shows a
 * non-blocking banner when the API is unavailable (designer-2c.md §6.3), and `/status` shows the
 * same state as text. The probe is also the only visible check that the dev proxy's /health rule
 * works, since a broken proxy rule otherwise fails silently.
 *
 * `bannerStatus` is what the designer's and builder's API banner follows: the probe combined with
 * the session's `api/me` load, so a failed `api/me` with a healthy server still explains the hidden
 * save bar (phase-6.md §19.2 B1; Skyler, 2026-11-14). It reads only the session's load status,
 * never who the user is. `retry()` is the banner's Try again: it re-probes and reloads the session,
 * so the save bar comes back on recovery.
 */
@Injectable({
  providedIn: 'root',
})
export class ApiStatusService {
  private readonly healthService = inject(HealthService);
  private readonly current = signal<ApiStatus>('checking');

  private readonly session = inject(SessionService);

  readonly status = this.current.asReadonly();

  /**
   * `checking` while either request is in flight, unless the probe has already failed; then
   * `unavailable` if either failed. Hosts hide the banner on a first `checking`, so nothing shows
   * while `api/me` is still loading (Phase 5 N1).
   */
  readonly bannerStatus = computed<ApiStatus>(() => {
    const health = this.current();
    const session = this.session.status();
    if (health === 'unavailable') return 'unavailable';
    if (health === 'checking' || session === 'loading') return 'checking';
    return session === 'unavailable' ? 'unavailable' : 'available';
  });

  /** Probes `/health/live`. A second call while one is in flight is ignored. */
  check(): void {
    if (this.inFlight) return;
    this.inFlight = true;
    this.current.set('checking');
    this.healthService.getLiveness().subscribe({
      next: () => {
        this.inFlight = false;
        this.current.set('available');
      },
      error: () => {
        this.inFlight = false;
        this.current.set('unavailable');
      },
    });
  }

  /**
   * The banner's Try again: re-probe `/health/live` and reload `api/me`. The banner disables its
   * button while `bannerStatus` is `checking`, so a reload only overlaps another when the probe
   * failed before the first `api/me` answered; the later answer wins, which is harmless.
   */
  retry(): void {
    this.check();
    this.session.load().subscribe();
  }

  private inFlight = false;
}

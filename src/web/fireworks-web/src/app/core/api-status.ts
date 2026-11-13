import { Injectable, inject, signal } from '@angular/core';
import { HealthService } from './health';

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
 */
@Injectable({
  providedIn: 'root',
})
export class ApiStatusService {
  private readonly healthService = inject(HealthService);
  private readonly current = signal<ApiStatus>('checking');

  readonly status = this.current.asReadonly();

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

  private inFlight = false;
}

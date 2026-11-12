import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiService } from './api';
import { MeResponse } from './models';

export type SessionStatus = 'loading' | 'ready' | 'unavailable';

/**
 * The only source of identity in the client (plan §3.4). Pages and stores read `currentUser` and
 * `canWrite` from here and never assume who the user is.
 *
 * `canWrite` mirrors `api/me`'s `canWrite` (OQ20): false in production until Phase 8, true in
 * Development. It is false until `api/me` has answered and stays false if it fails, so write
 * controls (Save, Remix, Delete) are hidden by default rather than shown and left to 403.
 */
@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private readonly api = inject(ApiService);

  private readonly user = signal<MeResponse | null>(null);
  private readonly loadStatus = signal<SessionStatus>('loading');

  readonly currentUser = this.user.asReadonly();
  readonly status = this.loadStatus.asReadonly();
  readonly canWrite = computed(() => this.user()?.canWrite === true);

  /**
   * Fetches `api/me` into `currentUser`. The returned observable completes once the session has
   * settled and never errors. A failure leaves `currentUser` null and `canWrite` false; the HTTP
   * error interceptor has already toasted it.
   *
   * app.config.ts subscribes to this from an initializer WITHOUT returning it, so the first render
   * does not wait on `api/me`. That is safe only while no route guard reads identity: write
   * controls start hidden and appear when `canWrite` turns true. When Phase 8 adds guards, return
   * this observable from `provideAppInitializer` instead (the reference app's AuthService pattern),
   * or the first `canMatch` runs against a null user.
   */
  load(): Observable<void> {
    this.loadStatus.set('loading');
    return this.api.get<MeResponse>('api/me').pipe(
      map((me) => {
        this.user.set(me);
        this.loadStatus.set('ready');
      }),
      catchError(() => {
        this.user.set(null);
        this.loadStatus.set('unavailable');
        return of(undefined);
      }),
    );
  }
}

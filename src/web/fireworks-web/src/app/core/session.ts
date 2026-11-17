import { HttpContext } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, ReplaySubject, catchError, map, of, switchMap, take } from 'rxjs';
import { ApiService } from './api';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import { MeResponse } from './models';

export type SessionStatus = 'loading' | 'ready' | 'unavailable';

/**
 * The only source of identity in the client (plan §3.4). Pages and stores read `currentUser`,
 * `isAuthenticated` and `canWrite` from here and never assume who the user is.
 *
 * `canWrite` mirrors `api/me`'s `canWrite`, which since Phase 8 equals `isAuthenticated` (Boo A42).
 * It is false until `api/me` has answered and stays false if it fails, so write requests are never
 * sent on a guess (A40). `status()` is the only reliable "decided" signal.
 *
 * app.config.ts subscribes to `load()` from an initializer WITHOUT returning it, so the first render
 * does not wait on `api/me` (phase-8-auth.md §6.1: only the save bar and `/mine` read identity, and
 * both wait on `status()`; there are no route guards). Code that must act once the first answer is
 * in waits on `settled()`.
 */
@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private readonly api = inject(ApiService);

  private readonly user = signal<MeResponse | null>(null);
  private readonly loadStatus = signal<SessionStatus>('loading');
  private readonly firstSettled = new ReplaySubject<void>(1);

  readonly currentUser = this.user.asReadonly();
  readonly status = this.loadStatus.asReadonly();
  readonly canWrite = computed(() => this.user()?.canWrite === true);
  readonly isAuthenticated = computed(() => this.user()?.isAuthenticated === true);
  /** The signed-in name as Google gave it (text only, Boo C1), or '' when blank or signed out. */
  readonly displayName = computed(() =>
    this.isAuthenticated() ? (this.user()?.displayName ?? '').trim() : '',
  );
  /** `signedInWith` (absent reads as null, schema.md §2.8). */
  readonly signedInWith = computed(() => this.user()?.signedInWith ?? null);

  /**
   * Emits once, when the first `load()` has settled (either way), then completes; a late
   * subscriber gets it at once. The return flow and the restore refresh wait on it.
   */
  settled(): Observable<void> {
    return this.firstSettled.pipe(take(1));
  }

  /**
   * Fetches `api/me` into `currentUser`. The returned observable completes once the session has
   * settled and never errors. A failure leaves `currentUser` null and `canWrite` false. It is
   * self-handled (core/self-handled-request.ts), so the interceptor does not toast it: one outage
   * shows one message, the designer's API banner.
   */
  load(): Observable<void> {
    this.loadStatus.set('loading');
    return this.api.get<MeResponse>('api/me').pipe(
      map((me) => {
        this.user.set(me);
        this.loadStatus.set('ready');
        this.firstSettled.next();
      }),
      catchError(() => {
        this.user.set(null);
        this.loadStatus.set('unavailable');
        this.firstSettled.next();
        return of(undefined);
      }),
    );
  }

  /**
   * `POST api/auth/logout` (always 204), then one `load()`. Emits `true` once the session has
   * reloaded, or `false` when the logout request failed (the session is left as it was). Never
   * errors; the caller words the failure (phase-8.md §2.2), so the generic toast is suppressed.
   * The local draft is kept (Skyler, 2026-11-16).
   */
  signOut(): Observable<boolean> {
    const context = new HttpContext().set(SUPPRESS_ERROR_TOAST, true);
    return this.api.post<null, unknown>('api/auth/logout', null, context).pipe(
      take(1),
      switchMap(() => this.load()),
      map(() => true),
      catchError(() => of(false)),
    );
  }
}

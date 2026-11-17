import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { isSignedOutError } from './self-handled-request';
import { SessionService } from './session';

/**
 * The 401 handler (phase-8-auth.md §6.1), placed AFTER httpErrorInterceptor in app.config.ts. A 401
 * from any `/api` call except `api/me` reloads the session once, so the save bar and `/mine` switch
 * to their signed-out form, and rethrows. **It never retries the request** (Boo A41). A reload
 * already in flight isn't doubled.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (isSignedOutError(req, error) && session.status() !== 'loading') {
        session.load().subscribe();
      }
      return throwError(() => error);
    }),
  );
};

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import { NotificationService } from './notifications';
import { isSelfHandledRequest } from './self-handled-request';

/**
 * The fallback toast for a call that doesn't render its own error (designer-2c.md §6.3 item 3).
 * It never quotes a method, URL or status: those go to the console only.
 */
export const GENERIC_ERROR_MESSAGE =
  'Something went wrong talking to the server. Try again in a moment.';

/**
 * Logs every failed request (method, URL, status) and shows the generic error toast, unless the
 * request is self-handled (core/self-handled-request.ts) or opted out with SUPPRESS_ERROR_TOAST.
 * Rethrows, so the caller still sees the error.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const notificationService = inject(NotificationService);
  const isSelfHandled = isSelfHandledRequest(req) || req.context.get(SUPPRESS_ERROR_TOAST);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        console.error(`HTTP ${error.status} ${req.method} ${req.urlWithParams}`);
        if (!isSelfHandled) {
          notificationService.error(GENERIC_ERROR_MESSAGE);
        }
      } else {
        console.error(`Unexpected HTTP pipeline error for ${req.method} ${req.urlWithParams}`);
        if (!isSelfHandled) {
          notificationService.error(GENERIC_ERROR_MESSAGE);
        }
      }

      return throwError(() => error);
    }),
  );
};

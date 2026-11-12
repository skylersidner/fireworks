import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import { NotificationService } from './notifications';
import { isSelfHandledRequest } from './self-handled-request';

/**
 * Logs every failed request and shows a generic error toast, unless the request is self-handled
 * (core/self-handled-request.ts) or opted out with SUPPRESS_ERROR_TOAST. Rethrows, so the caller
 * still sees the error.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const notificationService = inject(NotificationService);
  const isSelfHandled = isSelfHandledRequest(req) || req.context.get(SUPPRESS_ERROR_TOAST);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        console.error(`HTTP ${error.status} ${req.method} ${req.urlWithParams}`);
        if (!isSelfHandled) {
          const message =
            error.status > 0
              ? `Request failed (${error.status}) for ${req.method} ${req.urlWithParams}`
              : `Request failed for ${req.method} ${req.urlWithParams}`;
          notificationService.error(message);
        }
      } else {
        console.error(`Unexpected HTTP pipeline error for ${req.method} ${req.urlWithParams}`);
        if (!isSelfHandled) {
          notificationService.error(
            `Unexpected request failure for ${req.method} ${req.urlWithParams}`,
          );
        }
      }

      return throwError(() => error);
    }),
  );
};

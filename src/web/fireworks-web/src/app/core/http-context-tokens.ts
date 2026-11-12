import { HttpContextToken } from '@angular/common/http';

/**
 * Set on a request whose caller renders its own error message. Suppresses only
 * httpErrorInterceptor's generic "Request failed (...)" toast, so the caller's message is the
 * only one shown.
 */
export const SUPPRESS_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

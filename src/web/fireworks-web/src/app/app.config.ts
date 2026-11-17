import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { authInterceptor } from './core/auth-interceptor';
import { httpErrorInterceptor } from './core/http-error-interceptor';
import { ClientConfigLoader } from './core/client-config-loader';
import { SessionService } from './core/session';

import { routes } from './app.routes';

/**
 * Zoneless: Angular 22 is zoneless by default, so there is no zone.js in `polyfills` and no
 * `provideZonelessChangeDetection()` here, exactly as the reference app bootstraps. State changes
 * reach the view through signals.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(
      withInterceptors([
        // ORDER IS LOAD-BEARING once there is more than one entry. Angular builds the chain with
        // reduceRight, so [A, B, C] becomes A(next: B(next: C(next: backend))). The array is
        // REQUEST order; error responses travel back through it in reverse, so the LAST entry is
        // the FIRST to see an error. An interceptor that must swallow an error before the generic
        // toast fires goes AFTER this one. authInterceptor (Phase 8) reloads the session on a 401
        // and never retries; httpErrorInterceptor skips its toast for that 401.
        httpErrorInterceptor,
        authInterceptor,
      ]),
    ),
    provideRouter(routes),
    // Deliberately subscribes and returns void: identity loads in the background and the first
    // render does not wait for it. There are no route guards (phase-8-auth.md §6.3); code that
    // must wait for the answer uses SessionService.settled().
    provideAppInitializer(() => {
      inject(SessionService).load().subscribe();
    }),
    // The playback knobs (seek budget, checkpoints), also in the background: until they arrive,
    // or if the request fails, ClientConfigStore's defaults apply.
    provideAppInitializer(() => {
      inject(ClientConfigLoader).load().subscribe();
    }),
  ],
};

import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
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
        // toast fires (the reference app's 401 handler, Phase 8 here) goes AFTER this one.
        httpErrorInterceptor,
      ]),
    ),
    provideRouter(routes),
    // Deliberately subscribes and returns void: identity loads in the background and the first
    // render does not wait for it. See SessionService.load() for when this has to change.
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
